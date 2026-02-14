/**
 * User Management API Routes
 * Dashboard calls these to persist users in D1
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sendWelcomeEmail } from '../services/email';
import { saveProviderKeys, type ProviderKeys } from '../middleware/auth';

interface Env {
  VECTORS_D1: D1Database;
  METADATA_KV: KVNamespace;
  DASHBOARD_API_KEY: string;
  RESEND_API_KEY: string;
}

// Create router
const users = new Hono<{ Bindings: Env }>();

// CORS for dashboard
users.use('*', cors({
  origin: ['https://app.memoryrouter.ai', 'http://localhost:3000'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Dashboard-Key'],
  credentials: true,
}));

// Auth middleware - validate dashboard API key
users.use('*', async (c, next) => {
  const dashboardKey = c.req.header('X-Dashboard-Key');
  
  // Allow requests from same worker (internal)
  if (c.req.header('X-Internal-Request') === 'true') {
    return next();
  }
  
  // Validate dashboard key
  if (!dashboardKey || dashboardKey !== c.env.DASHBOARD_API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  return next();
});

// ============================================================================
// POST /api/users/upsert - Create or update user from OAuth
// ============================================================================
users.post('/upsert', async (c) => {
  const body = await c.req.json() as {
    provider: 'google' | 'github';
    providerId: string;
    email: string;
    name?: string;
    avatarUrl?: string;
  };

  const { provider, providerId, email, name, avatarUrl } = body;

  if (!provider || !providerId || !email) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const userId = `${provider}_${providerId}`;
  const internalUserId = `usr_${userId.replace(/[^a-z0-9]/gi, '').slice(0, 24)}`;
  const now = new Date().toISOString();

  try {
    // Check if user exists
    const existing = await c.env.VECTORS_D1.prepare(
      `SELECT * FROM users WHERE id = ?`
    ).bind(userId).first();

    let isNew = false;

    if (existing) {
      // Update existing user
      await c.env.VECTORS_D1.prepare(`
        UPDATE users 
        SET name = ?, avatar_url = ?, updated_at = ?
        WHERE id = ?
      `).bind(
        name || existing.name || null, 
        avatarUrl || existing.avatar_url || null, 
        now, 
        userId
      ).run();
    } else {
      // Create new user
      isNew = true;
      
      const providerColumn = provider === 'google' ? 'google_id' : 'github_id';
      
      await c.env.VECTORS_D1.prepare(`
        INSERT INTO users (id, ${providerColumn}, email, name, avatar_url, internal_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        userId, 
        providerId, 
        email, 
        name || null, 
        avatarUrl || null, 
        internalUserId, 
        now, 
        now
      ).run();

      // Create billing record
      await c.env.VECTORS_D1.prepare(`
        INSERT INTO billing (user_id, created_at, updated_at)
        VALUES (?, ?, ?)
      `).bind(userId, now, now).run();
    }

    // Fetch full user
    const user = await c.env.VECTORS_D1.prepare(
      `SELECT * FROM users WHERE id = ?`
    ).bind(userId).first();

    // Send welcome email for new users (fire and forget)
    if (isNew && email && c.env.RESEND_API_KEY) {
      // Use waitUntil to not block the response
      c.executionCtx.waitUntil(
        sendWelcomeEmail(c.env.RESEND_API_KEY, email, name || 'there')
          .then(result => {
            if (result.success) {
              console.log(`[User] Welcome email sent to ${email}, id: ${result.id}`);
            } else {
              console.error(`[User] Failed to send welcome email to ${email}:`, result.error);
            }
          })
          .catch(err => console.error('[User] Welcome email error:', err))
      );
    }

    return c.json({ user, isNew });

  } catch (error) {
    console.error('User upsert failed:', error);
    return c.json({ 
      error: 'Failed to upsert user',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// ============================================================================
// GET /api/users/:userId - Get user by ID
// ============================================================================
users.get('/:userId', async (c) => {
  const userId = c.req.param('userId');

  try {
    const user = await c.env.VECTORS_D1.prepare(
      `SELECT * FROM users WHERE id = ?`
    ).bind(userId).first();

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json({ user });
  } catch (error) {
    console.error('Get user failed:', error);
    return c.json({ error: 'Failed to get user' }, 500);
  }
});

// ============================================================================
// GET /api/users/:userId/billing - Get user's billing info
// ============================================================================
users.get('/:userId/billing', async (c) => {
  const userId = c.req.param('userId');

  try {
    const billing = await c.env.VECTORS_D1.prepare(
      `SELECT * FROM billing WHERE user_id = ?`
    ).bind(userId).first();

    if (!billing) {
      return c.json({ error: 'Billing record not found' }, 404);
    }

    // Get recent transactions
    const { results: transactions } = await c.env.VECTORS_D1.prepare(`
      SELECT * FROM transactions 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 10
    `).bind(userId).all();

    return c.json({ billing, transactions });
  } catch (error) {
    console.error('Get billing failed:', error);
    return c.json({ error: 'Failed to get billing' }, 500);
  }
});

// ============================================================================
// POST /api/users/:userId/billing - Update billing settings
// ============================================================================
users.post('/:userId/billing', async (c) => {
  const userId = c.req.param('userId');
  const body = await c.req.json() as {
    autoReupEnabled?: boolean;
    autoReupAmountCents?: number;
    autoReupTriggerCents?: number;
    monthlyCapCents?: number | null;
    stripeCustomerId?: string;
    stripeDefaultPaymentMethodId?: string;
    hasPaymentMethod?: boolean;
  };

  const now = new Date().toISOString();

  try {
    // Build update query dynamically
    const updates: string[] = ['updated_at = ?'];
    const values: (string | number | null)[] = [now];

    if (body.autoReupEnabled !== undefined) {
      updates.push('auto_reup_enabled = ?');
      values.push(body.autoReupEnabled ? 1 : 0);
    }
    if (body.autoReupAmountCents !== undefined) {
      updates.push('auto_reup_amount_cents = ?');
      values.push(body.autoReupAmountCents);
    }
    if (body.autoReupTriggerCents !== undefined) {
      updates.push('auto_reup_trigger_cents = ?');
      values.push(body.autoReupTriggerCents);
    }
    if (body.monthlyCapCents !== undefined) {
      updates.push('monthly_cap_cents = ?');
      values.push(body.monthlyCapCents);
    }
    if (body.stripeCustomerId !== undefined) {
      updates.push('stripe_customer_id = ?');
      values.push(body.stripeCustomerId);
    }
    if (body.stripeDefaultPaymentMethodId !== undefined) {
      updates.push('stripe_default_payment_method_id = ?');
      values.push(body.stripeDefaultPaymentMethodId);
    }
    if (body.hasPaymentMethod !== undefined) {
      updates.push('has_payment_method = ?');
      values.push(body.hasPaymentMethod ? 1 : 0);
    }

    values.push(userId);

    await c.env.VECTORS_D1.prepare(`
      UPDATE billing SET ${updates.join(', ')} WHERE user_id = ?
    `).bind(...values).run();

    const billing = await c.env.VECTORS_D1.prepare(
      `SELECT * FROM billing WHERE user_id = ?`
    ).bind(userId).first();

    return c.json({ billing });
  } catch (error) {
    console.error('Update billing failed:', error);
    return c.json({ error: 'Failed to update billing' }, 500);
  }
});

// ============================================================================
// POST /api/users/:userId/credit - Add credit to user's balance
// ============================================================================
users.post('/:userId/credit', async (c) => {
  const userId = c.req.param('userId');
  const body = await c.req.json() as {
    amountCents: number;
    description: string;
    stripePaymentIntentId?: string;
  };

  const { amountCents, description, stripePaymentIntentId } = body;

  if (!amountCents || !description) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const now = new Date().toISOString();
  const transactionId = `txn_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

  try {
    // Get current balance
    const billing = await c.env.VECTORS_D1.prepare(
      `SELECT credit_balance_cents FROM billing WHERE user_id = ?`
    ).bind(userId).first() as { credit_balance_cents: number } | null;

    if (!billing) {
      return c.json({ error: 'Billing record not found' }, 404);
    }

    const newBalance = billing.credit_balance_cents + amountCents;

    // Update balance
    await c.env.VECTORS_D1.prepare(`
      UPDATE billing SET credit_balance_cents = ?, updated_at = ? WHERE user_id = ?
    `).bind(newBalance, now, userId).run();

    // Create transaction record
    await c.env.VECTORS_D1.prepare(`
      INSERT INTO transactions (id, user_id, type, amount_cents, description, balance_after_cents, stripe_payment_intent_id, created_at)
      VALUES (?, ?, 'credit', ?, ?, ?, ?, ?)
    `).bind(transactionId, userId, amountCents, description, newBalance, stripePaymentIntentId || null, now).run();

    return c.json({ 
      success: true, 
      newBalanceCents: newBalance,
      transactionId 
    });
  } catch (error) {
    console.error('Add credit failed:', error);
    return c.json({ error: 'Failed to add credit' }, 500);
  }
});

// ============================================================================
// GET /api/users/:userId/usage - Get user's usage stats
// ============================================================================
users.get('/:userId/usage', async (c) => {
  const userId = c.req.param('userId');

  try {
    // Get user's memory keys
    const { results: memoryKeys } = await c.env.VECTORS_D1.prepare(`
      SELECT key FROM memory_keys WHERE user_id = ?
    `).bind(userId).all() as { results: { key: string }[] };

    if (memoryKeys.length === 0) {
      return c.json({ 
        totalRequests: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        dailyUsage: []
      });
    }

    const keys = memoryKeys.map(k => k.key);
    const placeholders = keys.map(() => '?').join(',');

    // Get aggregate usage from usage_daily (rolled up historical data)
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startDate = thirtyDaysAgo.toISOString().split('T')[0];

    const { results: dailyUsage } = await c.env.VECTORS_D1.prepare(`
      SELECT date, 
             SUM(request_count) as requests,
             SUM(input_tokens) as tokens_in,
             SUM(output_tokens) as tokens_out
      FROM usage_daily
      WHERE memory_key IN (${placeholders})
        AND date >= ?
      GROUP BY date
      ORDER BY date DESC
    `).bind(...keys, startDate).all();

    // ALSO get events from usage_events (not yet rolled up into usage_daily)
    // Query full 30 days since rollups may not have run yet
    const thirtyDaysAgoTs = thirtyDaysAgo.getTime();
    const { results: recentEvents } = await c.env.VECTORS_D1.prepare(`
      SELECT 
        date(timestamp / 1000, 'unixepoch') as date,
        COUNT(*) as requests,
        SUM(input_tokens) as tokens_in,
        SUM(output_tokens) as tokens_out
      FROM usage_events
      WHERE memory_key IN (${placeholders})
        AND timestamp >= ?
      GROUP BY date(timestamp / 1000, 'unixepoch')
    `).bind(...keys, thirtyDaysAgoTs).all();

    // Merge today's events with daily rollups
    const usageByDate = new Map<string, { date: string; requests: number; tokens_in: number; tokens_out: number }>();
    
    for (const day of dailyUsage as any[]) {
      usageByDate.set(day.date, {
        date: day.date,
        requests: day.requests || 0,
        tokens_in: day.tokens_in || 0,
        tokens_out: day.tokens_out || 0,
      });
    }

    for (const day of recentEvents as any[]) {
      const existing = usageByDate.get(day.date);
      if (existing) {
        existing.requests += day.requests || 0;
        existing.tokens_in += day.tokens_in || 0;
        existing.tokens_out += day.tokens_out || 0;
      } else {
        usageByDate.set(day.date, {
          date: day.date,
          requests: day.requests || 0,
          tokens_in: day.tokens_in || 0,
          tokens_out: day.tokens_out || 0,
        });
      }
    }

    // Convert to sorted array
    const mergedUsage = Array.from(usageByDate.values())
      .sort((a, b) => b.date.localeCompare(a.date));

    // Calculate totals
    let totalRequests = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;

    for (const day of mergedUsage) {
      totalRequests += day.requests || 0;
      totalTokensIn += day.tokens_in || 0;
      totalTokensOut += day.tokens_out || 0;
    }

    return c.json({
      totalRequests,
      totalTokensIn,
      totalTokensOut,
      dailyUsage: mergedUsage
    });
  } catch (error) {
    console.error('Get usage failed:', error);
    return c.json({ error: 'Failed to get usage' }, 500);
  }
});

// ============================================================================
// GET /api/users/:userId/memory-keys - List user's memory keys
// ============================================================================
users.get('/:userId/memory-keys', async (c) => {
  const userId = c.req.param('userId');

  try {
    const { results: keys } = await c.env.VECTORS_D1.prepare(`
      SELECT * FROM memory_keys 
      WHERE user_id = ? 
      ORDER BY created_at DESC
    `).bind(userId).all();

    return c.json({ keys });
  } catch (error) {
    console.error('List memory keys failed:', error);
    return c.json({ error: 'Failed to list memory keys' }, 500);
  }
});

// ============================================================================
// POST /api/users/:userId/memory-keys - Create memory key
// ============================================================================
users.post('/:userId/memory-keys', async (c) => {
  const userId = c.req.param('userId');
  const body = await c.req.json() as { name?: string };

  const keyId = `mk_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = new Date().toISOString();

  try {
    // Insert into D1
    await c.env.VECTORS_D1.prepare(`
      INSERT INTO memory_keys (id, key, user_id, name, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(keyId, keyId, userId, body.name || 'New Key', now).run();

    // Also store in KV for fast auth lookups
    const keyInfo = {
      key: keyId,
      userId,
      name: body.name || 'New Key',
      isActive: true,
      createdAt: Date.now(),
    };
    await c.env.METADATA_KV.put(`auth:${keyId}`, JSON.stringify(keyInfo));

    // Index by user
    const userKeysKey = `user:${userId}:memory_keys`;
    const existingKeys = await c.env.METADATA_KV.get(userKeysKey, 'json') as string[] | null;
    const keysList = existingKeys || [];
    keysList.push(keyId);
    await c.env.METADATA_KV.put(userKeysKey, JSON.stringify(keysList));

    const key = await c.env.VECTORS_D1.prepare(
      `SELECT * FROM memory_keys WHERE id = ?`
    ).bind(keyId).first();

    return c.json({ key }, 201);
  } catch (error) {
    console.error('Create memory key failed:', error);
    return c.json({ error: 'Failed to create memory key' }, 500);
  }
});

// ============================================================================
// DELETE /api/users/:userId/memory-keys/:keyId - Delete memory key
// ============================================================================
users.delete('/:userId/memory-keys/:keyId', async (c) => {
  const userId = c.req.param('userId');
  const keyId = c.req.param('keyId');

  try {
    // Verify ownership
    const key = await c.env.VECTORS_D1.prepare(
      `SELECT * FROM memory_keys WHERE id = ? AND user_id = ?`
    ).bind(keyId, userId).first();

    if (!key) {
      return c.json({ error: 'Key not found or unauthorized' }, 404);
    }

    // Delete from D1
    await c.env.VECTORS_D1.prepare(
      `DELETE FROM memory_keys WHERE id = ?`
    ).bind(keyId).run();

    // Deactivate in KV (don't delete - keep for audit)
    const kvKey = await c.env.METADATA_KV.get(`auth:${keyId}`, 'json') as any;
    if (kvKey) {
      kvKey.isActive = false;
      await c.env.METADATA_KV.put(`auth:${keyId}`, JSON.stringify(kvKey));
    }

    return c.json({ success: true, deleted: keyId });
  } catch (error) {
    console.error('Delete memory key failed:', error);
    return c.json({ error: 'Failed to delete memory key' }, 500);
  }
});

// ============================================================================
// POST /api/users/:userId/provider-keys - Save provider API key
// ============================================================================
users.post('/:userId/provider-keys', async (c) => {
  const userId = c.req.param('userId');
  const body = await c.req.json() as {
    provider: string;
    apiKey: string;
    nickname?: string;
  };

  const { provider, apiKey, nickname } = body;

  if (!provider || !apiKey) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const keyId = `pk_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const keyHint = apiKey.slice(-4);
  const now = new Date().toISOString();

  // For MVP, store key in plain text (TODO: encrypt with user-specific key)
  // In production, use encryption with a key derived from user's auth

  try {
    // Upsert into D1 (one key per provider per user)
    await c.env.VECTORS_D1.prepare(`
      INSERT INTO provider_keys (id, user_id, provider, encrypted_key, key_hint, nickname, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, provider) DO UPDATE SET
        encrypted_key = excluded.encrypted_key,
        key_hint = excluded.key_hint,
        nickname = excluded.nickname,
        is_active = 1,
        last_verified_at = excluded.created_at
    `).bind(keyId, userId, provider, apiKey, keyHint, nickname || provider || null, now).run();

    // Also update KV for fast lookups (inlines into auth records for single-lookup auth)
    const providerKeys = await c.env.METADATA_KV.get(`user:${userId}:provider_keys`, 'json') as Record<string, string> || {};
    providerKeys[provider] = apiKey;
    await saveProviderKeys(userId, providerKeys as ProviderKeys, c.env.METADATA_KV);

    return c.json({ 
      success: true, 
      provider, 
      keyHint,
      message: `${provider} API key saved` 
    });
  } catch (error) {
    console.error('Save provider key failed:', error);
    return c.json({ error: 'Failed to save provider key' }, 500);
  }
});

// ============================================================================
// GET /api/users/:userId/provider-keys - List provider keys (hints only)
// ============================================================================
users.get('/:userId/provider-keys', async (c) => {
  const userId = c.req.param('userId');

  try {
    const { results: keys } = await c.env.VECTORS_D1.prepare(`
      SELECT id, provider, key_hint, nickname, is_active, last_verified_at, created_at
      FROM provider_keys 
      WHERE user_id = ? AND is_active = 1
      ORDER BY created_at DESC
    `).bind(userId).all();

    return c.json({ keys });
  } catch (error) {
    console.error('List provider keys failed:', error);
    return c.json({ error: 'Failed to list provider keys' }, 500);
  }
});

// ============================================================================
// DELETE /api/users/:userId/provider-keys/:provider - Remove provider key
// ============================================================================
users.delete('/:userId/provider-keys/:provider', async (c) => {
  const userId = c.req.param('userId');
  const provider = c.req.param('provider');

  try {
    // Deactivate in D1
    await c.env.VECTORS_D1.prepare(`
      UPDATE provider_keys SET is_active = 0 WHERE user_id = ? AND provider = ?
    `).bind(userId, provider).run();

    // Remove from KV (inlines into auth records for single-lookup auth)
    const providerKeys = await c.env.METADATA_KV.get(`user:${userId}:provider_keys`, 'json') as Record<string, string> || {};
    delete providerKeys[provider];
    await saveProviderKeys(userId, providerKeys as ProviderKeys, c.env.METADATA_KV);

    return c.json({ success: true, deleted: provider });
  } catch (error) {
    console.error('Delete provider key failed:', error);
    return c.json({ error: 'Failed to delete provider key' }, 500);
  }
});

// ============================================================================
// POST /api/users/:userId/onboarding/complete - Mark onboarding complete
// ============================================================================
users.post('/:userId/onboarding/complete', async (c) => {
  const userId = c.req.param('userId');
  const now = new Date().toISOString();

  try {
    await c.env.VECTORS_D1.prepare(`
      UPDATE users SET onboarding_completed = 1, updated_at = ? WHERE id = ?
    `).bind(now, userId).run();

    return c.json({ success: true });
  } catch (error) {
    console.error('Complete onboarding failed:', error);
    return c.json({ error: 'Failed to complete onboarding' }, 500);
  }
});

// ============================================================================
// ARCHIVAL STORAGE ENDPOINTS
// ============================================================================

// GET /api/users/:userId/archival - Get archival storage info
// Archival is automatic: has payment method = data kept forever, no payment = purged at 90 days
users.get('/:userId/archival', async (c) => {
  const userId = c.req.param('userId');

  try {
    // Get billing record - archival is automatic based on payment method
    const billing = await c.env.VECTORS_D1.prepare(
      `SELECT has_payment_method, archival_bytes_total, archival_cost_cents, archival_last_calculated
       FROM billing WHERE user_id = ?`
    ).bind(userId).first();

    if (!billing) {
      return c.json({ error: 'Billing record not found' }, 404);
    }

    // Get per-key archival breakdown
    const { results: keys } = await c.env.VECTORS_D1.prepare(
      `SELECT memory_key, vectors_total, vectors_archived, bytes_archived, 
              calculated_at, oldest_vector_at, newest_vector_at
       FROM archival_storage WHERE user_id = ? ORDER BY bytes_archived DESC`
    ).bind(userId).all();

    // Get recent billing history
    const { results: history } = await c.env.VECTORS_D1.prepare(
      `SELECT billing_month, bytes_archived, gb_archived, cost_cents, reported_to_stripe
       FROM archival_billing_records WHERE user_id = ? 
       ORDER BY billing_month DESC LIMIT 12`
    ).bind(userId).all();

    const bytesTotal = (billing.archival_bytes_total as number) || 0;
    const hasPaymentMethod = Boolean(billing.has_payment_method);
    const GB = 1024 * 1024 * 1024;

    return c.json({
      // Archival is automatic: has payment method = keep forever
      enabled: hasPaymentMethod,
      hasPaymentMethod,
      retentionPolicy: hasPaymentMethod 
        ? 'Data kept forever. Billed at $0.10/GB/month for data older than 90 days.'
        : 'Data older than 90 days will be automatically purged. Add a payment method to retain all data.',
      storage: {
        bytesTotal,
        gbTotal: bytesTotal / GB,
        estimatedMonthlyCostCents: billing.archival_cost_cents || 0,
        lastCalculated: billing.archival_last_calculated,
      },
      keys: keys || [],
      billingHistory: history || [],
      pricing: {
        centsPerGbMonth: 10,
        dollarsPerGbMonth: 0.10,
      },
    });
  } catch (error) {
    console.error('Get archival info failed:', error);
    return c.json({ error: 'Failed to get archival info' }, 500);
  }
});

// POST /api/users/:userId/archival - Archival is now automatic based on payment method
// This endpoint is deprecated but kept for backwards compatibility
users.post('/:userId/archival', async (c) => {
  const userId = c.req.param('userId');

  try {
    const billing = await c.env.VECTORS_D1.prepare(
      `SELECT has_payment_method FROM billing WHERE user_id = ?`
    ).bind(userId).first();

    if (!billing) {
      return c.json({ error: 'Billing record not found' }, 404);
    }

    const hasPaymentMethod = Boolean(billing.has_payment_method);

    return c.json({ 
      success: true,
      enabled: hasPaymentMethod,
      message: hasPaymentMethod
        ? 'Archival is automatically enabled. Data older than 90 days is retained and billed at $0.10/GB/month.'
        : 'Add a payment method to automatically retain all data. Without a payment method, data older than 90 days will be purged.',
      note: 'Archival is now automatic based on payment method. No manual toggle required.',
    });
  } catch (error) {
    console.error('Get archival status failed:', error);
    return c.json({ error: 'Failed to get archival status' }, 500);
  }
});

export { users };
