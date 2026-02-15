/**
 * MemoryRouter Balance Guard Service
 * 
 * Parallel balance checking with zero latency impact.
 * Uses KV cache for blocked users to enable instant rejection.
 * 
 * Architecture:
 * 1. Check blocked cache (KV, <1ms) → instant 402 if blocked
 * 2. Run balance check (D1) in parallel with memory retrieval
 * 3. Before LLM call: if balance check failed → 402 (no wasted LLM call)
 * 4. After response: record usage, deduct balance (waitUntil)
 * 
 * Key principle: FAIL OPEN on D1 errors (availability > strict enforcement)
 * 
 * D1 Schema (actual tables):
 * - memory_keys: { id, key, user_id } — maps mk_xxx to OAuth user ID
 * - users: { id, internal_user_id } — OAuth ID like google_123
 * - billing: { user_id, credit_balance_cents, free_tier_tokens_used, ... }
 */

// ============================================================================
// TYPES
// ============================================================================

/** Internal balance check result (from D1 query) */
interface InternalBalanceCheck {
  balance_cents: number;
  free_tokens_remaining: number;
  can_process_request: boolean;
  monthly_cap_reached: boolean;
  status: 'ok' | 'low_balance' | 'suspended' | 'cap_reached' | 'no_user';
}

export interface BalanceGuardResult {
  allowed: boolean;
  cached: boolean;           // Was this from cache?
  balanceCheck?: InternalBalanceCheck;
  reason?: 'insufficient_balance' | 'suspended' | 'cap_reached' | 'blocked_cache' | 'account_not_found';
  blockedAt?: number;
}

export interface BlockedUserRecord {
  userId: string;
  reason: 'insufficient_balance' | 'suspended' | 'cap_reached';
  balance_cents: number;
  free_tokens_remaining: number;
  blockedAt: number;
  ttlMs: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Blocked user cache TTL: 5 minutes (re-check periodically) */
const BLOCKED_USER_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Suspended accounts get longer TTL (requires admin action) */
const SUSPENDED_USER_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** KV key prefix for blocked users */
const BLOCKED_KEY_PREFIX = 'blocked:user:';

/** Free tier limit: 50M tokens */
const FREE_TIER_LIMIT = 50_000_000;

// ============================================================================
// BALANCE GUARD CLASS
// ============================================================================

export class BalanceGuard {
  private kv: KVNamespace;
  private db: D1Database;

  constructor(kv: KVNamespace, db: D1Database) {
    this.kv = kv;
    this.db = db;
  }

  /**
   * Check blocked user cache (instant rejection path)
   * Call this FIRST before any processing - <1ms latency
   */
  async checkBlockedCache(userId: string): Promise<BlockedUserRecord | null> {
    try {
      const key = `${BLOCKED_KEY_PREFIX}${userId}`;
      const cached = await this.kv.get(key, 'json') as BlockedUserRecord | null;
      
      if (cached) {
        // KV handles TTL expiration automatically, but double-check
        const age = Date.now() - cached.blockedAt;
        if (age > cached.ttlMs) {
          // Expired - delete and return null (will recheck via D1)
          await this.kv.delete(key).catch(() => {}); // Best effort delete
          return null;
        }
        return cached;
      }
      
      return null;
    } catch (error) {
      // KV error - log and continue (fail open)
      console.error('[BALANCE_GUARD] KV read error:', error);
      return null;
    }
  }

  /**
   * Add user to blocked cache
   */
  async addToBlockedCache(
    userId: string,
    reason: BlockedUserRecord['reason'],
    balance_cents: number,
    free_tokens_remaining: number
  ): Promise<void> {
    try {
      const key = `${BLOCKED_KEY_PREFIX}${userId}`;
      const ttlMs = reason === 'suspended' ? SUSPENDED_USER_TTL_MS : BLOCKED_USER_TTL_MS;
      
      const record: BlockedUserRecord = {
        userId,
        reason,
        balance_cents,
        free_tokens_remaining,
        blockedAt: Date.now(),
        ttlMs,
      };
      
      // Store with TTL (KV expirationTtl in seconds)
      await this.kv.put(key, JSON.stringify(record), {
        expirationTtl: Math.ceil(ttlMs / 1000),
      });
      
      console.log(`[BALANCE_GUARD] Added to blocked cache: ${userId} (${reason})`);
    } catch (error) {
      // KV error - log but don't throw (billing shouldn't break requests)
      console.error('[BALANCE_GUARD] KV write error:', error);
    }
  }

  /**
   * Remove user from blocked cache (e.g., after top-up via Stripe webhook)
   */
  async removeFromBlockedCache(userId: string): Promise<boolean> {
    try {
      const key = `${BLOCKED_KEY_PREFIX}${userId}`;
      await this.kv.delete(key);
      console.log(`[BALANCE_GUARD] Removed from blocked cache: ${userId}`);
      return true;
    } catch (error) {
      console.error('[BALANCE_GUARD] KV delete error:', error);
      return false;
    }
  }

  /**
   * Check balance from D1 (parallel path)
   * Returns a promise that resolves when check is complete
   * 
   * FAIL OPEN: On D1 errors, allows request (availability > enforcement)
   * 
   * Single JOIN query for minimal latency:
   * memory_keys JOIN billing → get all billing info in one round trip
   */
  async checkBalanceAsync(memoryKey: string): Promise<BalanceGuardResult> {
    try {
      // Single query with JOIN — one D1 round trip instead of two
      const row = await this.db
        .prepare(`
          SELECT 
            mk.user_id,
            b.credit_balance_cents,
            b.free_tier_tokens_used,
            b.free_tier_exhausted,
            b.monthly_cap_cents,
            b.monthly_spend_cents
          FROM memory_keys mk
          LEFT JOIN billing b ON b.user_id = mk.user_id
          WHERE mk.id = ? OR mk.key = ?
        `)
        .bind(memoryKey, memoryKey)
        .first() as {
          user_id: string;
          credit_balance_cents: number | null;
          free_tier_tokens_used: number | null;
          free_tier_exhausted: number | null;
          monthly_cap_cents: number | null;
          monthly_spend_cents: number | null;
        } | null;
      
      if (!row) {
        // Memory key not in D1 — user hasn't completed onboarding
        // FAIL OPEN: Allow request, billing will be skipped
        console.log(`[BALANCE_GUARD] Memory key ${memoryKey} not in D1 — allowing (fail open)`);
        return {
          allowed: true,
          cached: false,
        };
      }
      
      // LEFT JOIN means billing columns may be null if no billing record
      if (row.credit_balance_cents === null) {
        // No billing record — user hasn't been billed yet
        // FAIL OPEN: Allow request (new user, free tier)
        console.log(`[BALANCE_GUARD] No billing record for user ${row.user_id} — allowing (fail open)`);
        return {
          allowed: true,
          cached: false,
        };
      }
      
      // Extract billing data (now guaranteed non-null)
      const billingRow = {
        credit_balance_cents: row.credit_balance_cents,
        free_tier_tokens_used: row.free_tier_tokens_used ?? 0,
        free_tier_exhausted: row.free_tier_exhausted ?? 0,
        monthly_cap_cents: row.monthly_cap_cents,
        monthly_spend_cents: row.monthly_spend_cents ?? 0,
      };
      
      // Calculate free tokens remaining
      const freeTokensRemaining = Math.max(0, FREE_TIER_LIMIT - billingRow.free_tier_tokens_used);
      
      // Check monthly cap
      const monthlyCap = billingRow.monthly_cap_cents;
      const monthlyCapReached = monthlyCap !== null && billingRow.monthly_spend_cents >= monthlyCap;
      
      // User can process if:
      // 1. Has free tokens remaining, OR
      // 2. Has positive paid balance
      // AND
      // 3. Monthly cap not reached
      const canProcess = !monthlyCapReached && (
        freeTokensRemaining > 0 || 
        billingRow.credit_balance_cents > 0
      );
      
      const balanceCheck: InternalBalanceCheck = {
        balance_cents: billingRow.credit_balance_cents,
        free_tokens_remaining: freeTokensRemaining,
        can_process_request: canProcess,
        monthly_cap_reached: monthlyCapReached,
        status: monthlyCapReached ? 'cap_reached' : (canProcess ? 'ok' : 'low_balance'),
      };
      
      if (!canProcess) {
        // Add to blocked cache for instant rejection of subsequent requests
        let reason: BlockedUserRecord['reason'] = 'insufficient_balance';
        if (monthlyCapReached) reason = 'cap_reached';
        
        await this.addToBlockedCache(
          memoryKey,
          reason,
          billingRow.credit_balance_cents,
          freeTokensRemaining
        );
        
        return {
          allowed: false,
          cached: false,
          balanceCheck,
          reason,
        };
      }
      
      return {
        allowed: true,
        cached: false,
        balanceCheck,
      };
    } catch (error) {
      // FAIL OPEN: On D1 error, allow request (availability > enforcement)
      // Log for alerting/monitoring
      console.error('[BALANCE_GUARD] D1 check failed, ALLOWING REQUEST (fail open):', error);
      
      return {
        allowed: true,  // FAIL OPEN
        cached: false,
      };
    }
  }

  /**
   * Record usage after successful request (called in waitUntil)
   * Updates the D1 billing table:
   * - Free tier deduction first
   * - Paid balance deduction second
   * - Transaction creation
   * 
   * D1 Schema:
   * - memory_keys: { id, user_id } — maps mk_xxx to OAuth user ID
   * - billing: { user_id, credit_balance_cents, free_tier_tokens_used }
   * - transactions: { user_id, type, amount_cents, ... }
   */
  async recordUsageAndDeduct(
    memoryKey: string,
    memoryTokens: number,
    model: string,
    provider: string,
    sessionId?: string
  ): Promise<void> {
    if (memoryTokens === 0) {
      return; // Nothing to bill
    }
    
    try {
      // Step 1: Look up user_id from memory_keys table
      const memKeyRow = await this.db
        .prepare('SELECT user_id FROM memory_keys WHERE id = ? OR key = ?')
        .bind(memoryKey, memoryKey)
        .first() as { user_id: string } | null;
      
      if (!memKeyRow) {
        // Memory key not in D1 — can't bill
        console.log(`[BALANCE_GUARD] Memory key ${memoryKey} not in D1 — skipping billing`);
        return;
      }
      
      const userId = memKeyRow.user_id;
      
      // Step 2: Get current billing info
      const billingRow = await this.db
        .prepare(`
          SELECT credit_balance_cents, free_tier_tokens_used
          FROM billing WHERE user_id = ?
        `)
        .bind(userId)
        .first() as {
          credit_balance_cents: number;
          free_tier_tokens_used: number;
        } | null;
      
      if (!billingRow) {
        // No billing record — can't bill
        console.log(`[BALANCE_GUARD] No billing record for user ${userId} — skipping billing`);
        return;
      }
      
      // Step 3: Calculate billing
      const freeTokensRemaining = Math.max(0, FREE_TIER_LIMIT - billingRow.free_tier_tokens_used);
      
      let freeTokensUsed = 0;
      let paidTokensUsed = 0;
      
      if (freeTokensRemaining > 0) {
        // Use free tier first
        freeTokensUsed = Math.min(memoryTokens, freeTokensRemaining);
        paidTokensUsed = memoryTokens - freeTokensUsed;
      } else {
        // All paid
        paidTokensUsed = memoryTokens;
      }
      
      // Cost: $0.50 per 1M tokens = $0.0000005 per token = 0.00005 cents per token
      // Store precise fractional cents (SQLite handles floats in INTEGER columns)
      const costCents = parseFloat((paidTokensUsed * 0.00005).toFixed(4));
      
      // Step 4: Update billing record
      const newFreeTokensUsed = billingRow.free_tier_tokens_used + freeTokensUsed;
      const newBalance = Math.max(0, billingRow.credit_balance_cents - costCents);
      const freeExhausted = newFreeTokensUsed >= FREE_TIER_LIMIT ? 1 : 0;
      
      await this.db
        .prepare(`
          UPDATE billing SET
            free_tier_tokens_used = ?,
            free_tier_exhausted = ?,
            credit_balance_cents = ?,
            monthly_spend_cents = monthly_spend_cents + ?,
            updated_at = datetime('now')
          WHERE user_id = ?
        `)
        .bind(newFreeTokensUsed, freeExhausted, newBalance, costCents, userId)
        .run();
      
      // Step 5: Record transaction if there was a cost
      if (costCents > 0) {
        const txId = `tx_${crypto.randomUUID().replace(/-/g, '')}`;
        const now = new Date().toISOString();
        await this.db
          .prepare(`
            INSERT INTO transactions (
              id, user_id, type, amount_cents, 
              description, balance_after_cents, created_at
            ) VALUES (?, ?, 'usage', ?, ?, ?, ?)
          `)
          .bind(
            txId,
            userId,
            -costCents,
            `Usage: ${memoryTokens.toLocaleString()} tokens (${model})`,
            newBalance,
            now
          )
          .run();
      }
      
      console.log(`[BALANCE_GUARD] Recorded usage: ${memoryKey} (${userId}) - ${memoryTokens} tokens, cost=${costCents}c`);
    } catch (error) {
      // Billing should never break requests - log and continue
      console.error('[BALANCE_GUARD] Failed to record usage:', error);
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a balance guard instance
 * Requires METADATA_KV and VECTORS_D1 bindings
 */
export function createBalanceGuard(kv: KVNamespace, db: D1Database): BalanceGuard {
  return new BalanceGuard(kv, db);
}

// ============================================================================
// ERROR RESPONSE BUILDERS
// ============================================================================

/**
 * Build 402 response for insufficient balance (fresh detection from D1)
 */
export function buildInsufficientBalanceResponse(
  reason: string,
  balance_cents: number,
  free_tokens_remaining: number
): Response {
  return new Response(JSON.stringify({
    error: {
      message: 'Insufficient balance to process request',
      type: 'insufficient_balance',
      code: 'payment_required',
      details: {
        reason,
        balance_cents,
        free_tokens_remaining,
        top_up_url: 'https://app.memoryrouter.ai/billing',
        hint: 'Add credits to continue using MemoryRouter',
      },
    },
  }), {
    status: 402,
    headers: {
      'Content-Type': 'application/json',
      'X-MemoryRouter-Payment-Required': 'true',
      'X-MemoryRouter-Reason': reason,
    },
  });
}

/**
 * Build 402 response for blocked user (cached — instant rejection)
 */
export function buildBlockedUserResponse(record: BlockedUserRecord): Response {
  const secondsBlocked = Math.floor((Date.now() - record.blockedAt) / 1000);
  const ttlRemaining = Math.max(0, Math.floor((record.ttlMs - (Date.now() - record.blockedAt)) / 1000));
  
  return new Response(JSON.stringify({
    error: {
      message: 'Account blocked due to insufficient balance',
      type: 'blocked',
      code: 'payment_required',
      details: {
        reason: record.reason,
        balance_cents: record.balance_cents,
        free_tokens_remaining: record.free_tokens_remaining,
        blocked_at: new Date(record.blockedAt).toISOString(),
        blocked_for_seconds: secondsBlocked,
        recheck_in_seconds: ttlRemaining,
        top_up_url: 'https://app.memoryrouter.ai/billing',
        hint: 'Add credits to unblock your account. Balance is rechecked periodically.',
      },
    },
  }), {
    status: 402,
    headers: {
      'Content-Type': 'application/json',
      'X-MemoryRouter-Blocked': 'true',
      'X-MemoryRouter-Blocked-Reason': record.reason,
      'X-MemoryRouter-Blocked-For': String(secondsBlocked),
      'X-MemoryRouter-Recheck-In': String(ttlRemaining),
    },
  });
}

// ============================================================================
// ADMIN ENDPOINT HELPERS
// ============================================================================

/**
 * List all blocked users (for admin dashboard)
 * Note: KV list is eventually consistent
 */
export async function listBlockedUsers(kv: KVNamespace): Promise<BlockedUserRecord[]> {
  try {
    const listResult = await kv.list({ prefix: BLOCKED_KEY_PREFIX });
    const records: BlockedUserRecord[] = [];
    
    for (const key of listResult.keys) {
      const record = await kv.get(key.name, 'json') as BlockedUserRecord | null;
      if (record) {
        records.push(record);
      }
    }
    
    return records;
  } catch (error) {
    console.error('[BALANCE_GUARD] Failed to list blocked users:', error);
    return [];
  }
}
