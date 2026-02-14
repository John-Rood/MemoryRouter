/**
 * MemoryRouter Balance Checkpoint Service
 * 
 * CHARGE FIRST, SERVE SECOND.
 * 
 * Before serving any request that uses tokens, this service:
 * 1. Calculates the projected balance after the request
 * 2. If balance would go negative AND user has payment method → charge $20 FIRST
 * 3. Only then allow the request to proceed
 * 
 * Pricing: $0.50 per 1M memory tokens = $0.0000005/token = 0.00005 cents/token
 * Free tier: 50M memory tokens
 */

// ============================================================================
// TYPES
// ============================================================================

export interface EnsureBalanceResult {
  allowed: boolean;
  charged?: boolean;
  amountCharged?: number;  // cents
  paymentIntentId?: string;
  error?: 'payment_failed' | 'no_payment_method' | 'account_not_found' | 'stripe_error';
  errorMessage?: string;
  // Debug info
  projectedBalance?: number;
  freeTokensRemaining?: number;
  costCents?: number;
}

export interface StripeCharger {
  (customerId: string, paymentMethodId: string, amountCents: number): Promise<string>;
}

export interface BillingRecord {
  user_id: string;
  credit_balance_cents: number;
  free_tier_tokens_used: number;
  free_tier_exhausted: number;
  auto_reup_enabled: number;
  auto_reup_amount_cents: number;
  auto_reup_trigger_cents: number;
  monthly_cap_cents: number | null;
  monthly_spend_cents: number;
  stripe_customer_id: string | null;
  stripe_default_payment_method_id: string | null;
  has_payment_method: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Price per memory token in cents: $0.50/1M = 0.00005 cents/token */
const CENTS_PER_TOKEN = 0.00005;

/** Free tier limit: 50M tokens */
const FREE_TIER_LIMIT = 50_000_000;

/** Default auto-reup amount: $20 = 2000 cents */
const DEFAULT_AUTO_REUP_AMOUNT = 2000;

// ============================================================================
// STRIPE CHARGING
// ============================================================================

/**
 * Create a Stripe charge using off-session payment
 * Returns the PaymentIntent ID on success
 */
export async function chargeStripe(
  stripeSecretKey: string,
  customerId: string,
  paymentMethodId: string,
  amountCents: number
): Promise<string> {
  // Stripe API endpoint for creating PaymentIntents
  const url = 'https://api.stripe.com/v1/payment_intents';
  
  const body = new URLSearchParams({
    amount: amountCents.toString(),
    currency: 'usd',
    customer: customerId,
    payment_method: paymentMethodId,
    off_session: 'true',
    confirm: 'true',
    statement_descriptor: 'MEMORYROUTER',
    description: `MemoryRouter auto-reup: $${(amountCents / 100).toFixed(2)}`,
    'metadata[type]': 'auto_reup',
    'metadata[source]': 'balance_checkpoint',
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const result = await response.json() as {
    id?: string;
    status?: string;
    error?: { message: string; type: string; code?: string };
  };

  if (!response.ok || result.error) {
    const errorMsg = result.error?.message || 'Unknown Stripe error';
    console.error('[BALANCE_CHECKPOINT] Stripe charge failed:', errorMsg);
    throw new Error(`Stripe charge failed: ${errorMsg}`);
  }

  // Check payment status
  if (result.status !== 'succeeded') {
    console.error('[BALANCE_CHECKPOINT] Payment not succeeded:', result.status);
    throw new Error(`Payment not succeeded: ${result.status}`);
  }

  console.log(`[BALANCE_CHECKPOINT] Stripe charge succeeded: ${result.id} for $${(amountCents / 100).toFixed(2)}`);
  return result.id!;
}

// ============================================================================
// BALANCE CHECKPOINT
// ============================================================================

/**
 * Ensure sufficient balance for a request.
 * CHARGE FIRST if balance would go negative.
 * 
 * @param db - D1 database
 * @param memoryKey - The memory key (used to look up user_id via memory_keys table)
 * @param tokensNeeded - Estimated tokens for this request
 * @param stripeSecretKey - Stripe secret key for charging (optional, disables charging if not provided)
 * @returns Result indicating if request is allowed and if charge was made
 */
export async function ensureBalance(
  db: D1Database,
  memoryKey: string,
  tokensNeeded: number,
  stripeSecretKey?: string
): Promise<EnsureBalanceResult> {
  try {
    // Step 1: Look up user_id from memory_keys table
    const memKeyRow = await db
      .prepare('SELECT user_id FROM memory_keys WHERE id = ? OR key = ?')
      .bind(memoryKey, memoryKey)
      .first() as { user_id: string } | null;

    if (!memKeyRow) {
      // Memory key not in D1 — FAIL OPEN (allow request, can't bill)
      console.log(`[BALANCE_CHECKPOINT] Memory key ${memoryKey} not in D1 — allowing (fail open)`);
      return { allowed: true };
    }

    const userId = memKeyRow.user_id;

    // Step 2: Get billing record
    const billing = await db
      .prepare(`
        SELECT 
          user_id, credit_balance_cents, free_tier_tokens_used, free_tier_exhausted,
          auto_reup_enabled, auto_reup_amount_cents, auto_reup_trigger_cents,
          monthly_cap_cents, monthly_spend_cents,
          stripe_customer_id, stripe_default_payment_method_id, has_payment_method
        FROM billing WHERE user_id = ?
      `)
      .bind(userId)
      .first() as BillingRecord | null;

    if (!billing) {
      // No billing record — FAIL OPEN (allow request, can't bill)
      console.log(`[BALANCE_CHECKPOINT] No billing record for user ${userId} — allowing (fail open)`);
      return { allowed: true };
    }

    // Step 3: Calculate projected balance
    const freeTokensRemaining = Math.max(0, FREE_TIER_LIMIT - billing.free_tier_tokens_used);
    
    // First use free tokens, then paid
    const freeTokensToUse = Math.min(tokensNeeded, freeTokensRemaining);
    const paidTokensNeeded = tokensNeeded - freeTokensToUse;
    
    // Cost in cents (rounded up)
    const costCents = Math.ceil(paidTokensNeeded * CENTS_PER_TOKEN);
    
    // Projected balance after this request
    const projectedBalance = billing.credit_balance_cents - costCents;

    console.log(`[BALANCE_CHECKPOINT] User ${userId}: tokens=${tokensNeeded}, free=${freeTokensRemaining}, paidNeeded=${paidTokensNeeded}, cost=${costCents}c, balance=${billing.credit_balance_cents}c, projected=${projectedBalance}c`);

    // Step 4: If projected balance >= 0, we're good
    if (projectedBalance >= 0) {
      return {
        allowed: true,
        projectedBalance,
        freeTokensRemaining,
        costCents,
      };
    }

    // Step 5: Need to charge — check if we can
    if (!billing.has_payment_method || !billing.stripe_customer_id || !billing.stripe_default_payment_method_id) {
      console.log(`[BALANCE_CHECKPOINT] User ${userId} needs funds but no payment method`);
      return {
        allowed: false,
        error: 'no_payment_method',
        errorMessage: 'Insufficient balance and no payment method on file. Please add a card to continue.',
        projectedBalance,
        freeTokensRemaining,
        costCents,
      };
    }

    if (!stripeSecretKey) {
      console.log(`[BALANCE_CHECKPOINT] User ${userId} needs funds but Stripe not configured`);
      return {
        allowed: false,
        error: 'stripe_error',
        errorMessage: 'Billing system temporarily unavailable. Please try again later.',
        projectedBalance,
        freeTokensRemaining,
        costCents,
      };
    }

    // Step 6: Charge Stripe FIRST
    const chargeAmount = billing.auto_reup_amount_cents || DEFAULT_AUTO_REUP_AMOUNT;
    
    console.log(`[BALANCE_CHECKPOINT] Charging user ${userId}: $${(chargeAmount / 100).toFixed(2)}`);

    let paymentIntentId: string;
    try {
      paymentIntentId = await chargeStripe(
        stripeSecretKey,
        billing.stripe_customer_id,
        billing.stripe_default_payment_method_id,
        chargeAmount
      );
    } catch (error) {
      console.error(`[BALANCE_CHECKPOINT] Stripe charge failed for user ${userId}:`, error);
      return {
        allowed: false,
        error: 'payment_failed',
        errorMessage: error instanceof Error ? error.message : 'Payment failed. Please check your card.',
        projectedBalance,
        freeTokensRemaining,
        costCents,
      };
    }

    // Step 7: Add funds to balance
    const newBalance = billing.credit_balance_cents + chargeAmount;
    const now = new Date().toISOString();
    const txId = `tx_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    await db.batch([
      // Update balance
      db.prepare(`
        UPDATE billing SET 
          credit_balance_cents = ?,
          updated_at = ?
        WHERE user_id = ?
      `).bind(newBalance, now, userId),
      
      // Record transaction
      db.prepare(`
        INSERT INTO transactions (id, user_id, type, amount_cents, description, balance_after_cents, stripe_payment_intent_id, created_at)
        VALUES (?, ?, 'credit', ?, ?, ?, ?, ?)
      `).bind(
        txId,
        userId,
        chargeAmount,
        `Auto-reup: $${(chargeAmount / 100).toFixed(2)}`,
        newBalance,
        paymentIntentId,
        now
      ),
    ]);

    console.log(`[BALANCE_CHECKPOINT] Charged user ${userId}: $${(chargeAmount / 100).toFixed(2)}, new balance: $${(newBalance / 100).toFixed(2)}`);

    return {
      allowed: true,
      charged: true,
      amountCharged: chargeAmount,
      paymentIntentId,
      projectedBalance: newBalance - costCents,
      freeTokensRemaining,
      costCents,
    };

  } catch (error) {
    // On unexpected errors, FAIL OPEN for availability
    console.error('[BALANCE_CHECKPOINT] Unexpected error, allowing request:', error);
    return { allowed: true };
  }
}

// ============================================================================
// TOKEN ESTIMATION
// ============================================================================

/**
 * Estimate tokens from content length
 * Rule of thumb: ~4 characters per token
 */
export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

/**
 * Estimate tokens for upload items
 */
export function estimateUploadTokens(items: Array<{ content: string }>): number {
  let total = 0;
  for (const item of items) {
    total += estimateTokens(item.content);
  }
  return total;
}

// ============================================================================
// ERROR RESPONSE BUILDERS
// ============================================================================

// ============================================================================
// POST-USAGE AUTO-REUP CHECK
// ============================================================================

export interface CheckReupResult {
  recharged: boolean;
  amountCharged?: number;  // cents
  newBalance?: number;     // cents after recharge
  paymentIntentId?: string;
  error?: string;
}

/**
 * Check if auto-reup is needed after usage deduction.
 * 
 * Called in waitUntil AFTER recordUsageAndDeduct().
 * If balance fell below threshold AND auto-reup is enabled AND has payment method:
 *   → Charge auto_reup_amount_cents
 *   → Record transaction
 *   → Update balance
 * 
 * Example: User has $6, uses $2 worth, now has $4. Threshold is $5.
 *          This function detects $4 < $5 and triggers recharge.
 * 
 * @param db - D1 database
 * @param memoryKey - The memory key (used to look up user_id)
 * @param stripeSecretKey - Stripe secret key for charging
 * @returns Result with recharge status
 */
export async function checkAndReupIfNeeded(
  db: D1Database,
  memoryKey: string,
  stripeSecretKey?: string
): Promise<CheckReupResult> {
  try {
    // Step 1: Look up user_id from memory_keys table
    const memKeyRow = await db
      .prepare('SELECT user_id FROM memory_keys WHERE id = ? OR key = ?')
      .bind(memoryKey, memoryKey)
      .first() as { user_id: string } | null;

    if (!memKeyRow) {
      // Memory key not in D1 — nothing to do
      return { recharged: false };
    }

    const userId = memKeyRow.user_id;

    // Step 2: Get billing record with all auto-reup fields
    const billing = await db
      .prepare(`
        SELECT 
          credit_balance_cents,
          auto_reup_enabled,
          auto_reup_amount_cents,
          auto_reup_trigger_cents,
          stripe_customer_id,
          stripe_default_payment_method_id,
          has_payment_method
        FROM billing WHERE user_id = ?
      `)
      .bind(userId)
      .first() as {
        credit_balance_cents: number;
        auto_reup_enabled: number;
        auto_reup_amount_cents: number;
        auto_reup_trigger_cents: number;
        stripe_customer_id: string | null;
        stripe_default_payment_method_id: string | null;
        has_payment_method: number;
      } | null;

    if (!billing) {
      return { recharged: false };
    }

    // Step 3: Check if reup is needed
    const balanceBelowThreshold = billing.credit_balance_cents < billing.auto_reup_trigger_cents;
    const autoReupEnabled = billing.auto_reup_enabled === 1;
    const hasPaymentMethod = billing.has_payment_method === 1 && 
                             billing.stripe_customer_id && 
                             billing.stripe_default_payment_method_id;

    console.log(`[AUTO_REUP_CHECK] User ${userId}: balance=${billing.credit_balance_cents}c, threshold=${billing.auto_reup_trigger_cents}c, enabled=${autoReupEnabled}, hasPayment=${!!hasPaymentMethod}`);

    if (!balanceBelowThreshold) {
      // Balance is fine, no reup needed
      return { recharged: false };
    }

    if (!autoReupEnabled) {
      console.log(`[AUTO_REUP_CHECK] User ${userId}: Below threshold but auto-reup disabled`);
      return { recharged: false };
    }

    if (!hasPaymentMethod) {
      console.log(`[AUTO_REUP_CHECK] User ${userId}: Below threshold but no payment method`);
      return { recharged: false };
    }

    if (!stripeSecretKey) {
      console.log(`[AUTO_REUP_CHECK] User ${userId}: Below threshold but Stripe not configured`);
      return { recharged: false, error: 'stripe_not_configured' };
    }

    // Step 4: Charge Stripe
    const chargeAmount = billing.auto_reup_amount_cents || DEFAULT_AUTO_REUP_AMOUNT;
    
    console.log(`[AUTO_REUP_CHECK] Charging user ${userId}: $${(chargeAmount / 100).toFixed(2)} (balance fell below threshold)`);

    let paymentIntentId: string;
    try {
      paymentIntentId = await chargeStripe(
        stripeSecretKey,
        billing.stripe_customer_id!,
        billing.stripe_default_payment_method_id!,
        chargeAmount
      );
    } catch (error) {
      console.error(`[AUTO_REUP_CHECK] Stripe charge failed for user ${userId}:`, error);
      return {
        recharged: false,
        error: error instanceof Error ? error.message : 'Stripe charge failed',
      };
    }

    // Step 5: Update balance and record transaction
    const newBalance = billing.credit_balance_cents + chargeAmount;
    const now = new Date().toISOString();
    const txId = `tx_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    await db.batch([
      // Update balance
      db.prepare(`
        UPDATE billing SET 
          credit_balance_cents = ?,
          updated_at = ?
        WHERE user_id = ?
      `).bind(newBalance, now, userId),
      
      // Record transaction
      db.prepare(`
        INSERT INTO transactions (id, user_id, type, amount_cents, description, balance_after_cents, stripe_payment_intent_id, created_at)
        VALUES (?, ?, 'auto_reup', ?, ?, ?, ?, ?)
      `).bind(
        txId,
        userId,
        chargeAmount,
        `Auto-reup (balance below $${(billing.auto_reup_trigger_cents / 100).toFixed(2)} threshold): $${(chargeAmount / 100).toFixed(2)}`,
        newBalance,
        paymentIntentId,
        now
      ),
    ]);

    console.log(`[AUTO_REUP_CHECK] Recharged user ${userId}: $${(chargeAmount / 100).toFixed(2)}, new balance: $${(newBalance / 100).toFixed(2)}`);

    return {
      recharged: true,
      amountCharged: chargeAmount,
      newBalance,
      paymentIntentId,
    };

  } catch (error) {
    // On unexpected errors, log but don't throw (this runs in waitUntil)
    console.error('[AUTO_REUP_CHECK] Unexpected error:', error);
    return {
      recharged: false,
      error: error instanceof Error ? error.message : 'Unexpected error',
    };
  }
}

// ============================================================================
// ERROR RESPONSE BUILDERS
// ============================================================================

/**
 * Build 402 Payment Required response
 */
export function buildPaymentRequiredResponse(result: EnsureBalanceResult): Response {
  let message: string;
  let hint: string;

  switch (result.error) {
    case 'no_payment_method':
      message = 'Insufficient balance to process request';
      hint = 'Add a payment method at https://app.memoryrouter.ai/settings/billing to continue';
      break;
    case 'payment_failed':
      message = 'Payment failed';
      hint = 'Please update your payment method at https://app.memoryrouter.ai/settings/billing';
      break;
    default:
      message = 'Payment required';
      hint = 'Please add credits at https://app.memoryrouter.ai/settings/billing';
  }

  return new Response(JSON.stringify({
    error: {
      message,
      type: result.error || 'payment_required',
      code: 'payment_required',
      details: {
        projected_balance_cents: result.projectedBalance,
        free_tokens_remaining: result.freeTokensRemaining,
        estimated_cost_cents: result.costCents,
        top_up_url: 'https://app.memoryrouter.ai/settings/billing',
        hint,
      },
    },
  }), {
    status: 402,
    headers: {
      'Content-Type': 'application/json',
      'X-MemoryRouter-Payment-Required': 'true',
      'X-MemoryRouter-Error': result.error || 'payment_required',
    },
  });
}
