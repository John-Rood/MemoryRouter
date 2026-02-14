/**
 * Memory Billing Service
 * 
 * Unified billing interface for all providers.
 * Wraps balance-guard.ts and balance-checkpoint.ts into a single interface.
 * 
 * Used by all provider routes: chat.ts, anthropic.ts, google.ts
 */

import { 
  BalanceGuard, 
  createBalanceGuard, 
  buildBlockedUserResponse,
  type BlockedUserRecord,
} from './balance-guard';
import {
  ensureBalance,
  buildPaymentRequiredResponse,
  checkAndReupIfNeeded,
  type EnsureBalanceResult,
} from './balance-checkpoint';

// ==================== TYPES ====================

export interface BillingContext {
  kv: KVNamespace;
  db: D1Database;
  stripeKey?: string;
}

export interface BillingCheckResult {
  allowed: boolean;
  response?: Response;  // Pre-built 402 response if blocked
  charged?: boolean;
  amountCharged?: number;
  paymentIntentId?: string;
}

export interface UsageRecordParams {
  ctx: BillingContext;
  userId: string;
  totalTokens: number;
  model: string;
  provider: string;
  sessionId?: string;
}

// ==================== BILLING CHECK ====================

/**
 * Run pre-request billing check.
 * Call this BEFORE the LLM call — returns 402 if blocked.
 * 
 * Flow:
 * 1. Check blocked cache (instant rejection)
 * 2. Check balance + auto-charge if needed
 * 3. Return allowed=true to proceed, or allowed=false with 402 response
 */
export async function checkBillingBeforeRequest(
  ctx: BillingContext,
  userId: string,
  estimatedTokens: number = 1000
): Promise<BillingCheckResult> {
  const balanceGuard = createBalanceGuard(ctx.kv, ctx.db);

  // Step 1: Check blocked cache (fast path)
  const blockedRecord = await balanceGuard.checkBlockedCache(userId);
  if (blockedRecord) {
    console.log(`[BILLING] Blocked user (cached): ${userId} - ${blockedRecord.reason}`);
    return {
      allowed: false,
      response: buildBlockedUserResponse(blockedRecord),
    };
  }

  // Step 2: Ensure balance (may auto-charge)
  const ensureResult = await ensureBalance(ctx.db, userId, estimatedTokens, ctx.stripeKey);

  if (!ensureResult.allowed) {
    console.log(`[BILLING] Balance check failed: ${userId} - ${ensureResult.error}`);

    // Add to blocked cache for subsequent requests
    if (ensureResult.error === 'no_payment_method') {
      await balanceGuard.addToBlockedCache(
        userId,
        'insufficient_balance',
        ensureResult.projectedBalance ?? 0,
        ensureResult.freeTokensRemaining ?? 0
      );
    }

    return {
      allowed: false,
      response: buildPaymentRequiredResponse(ensureResult),
    };
  }

  // Log auto-charge if it happened
  if (ensureResult.charged) {
    console.log(`[BILLING] Auto-charged ${userId}: $${((ensureResult.amountCharged || 0) / 100).toFixed(2)} (PI: ${ensureResult.paymentIntentId})`);
  }

  return {
    allowed: true,
    charged: ensureResult.charged,
    amountCharged: ensureResult.amountCharged,
    paymentIntentId: ensureResult.paymentIntentId,
  };
}

// ==================== USAGE RECORDING ====================

/**
 * Record usage after successful request.
 * Call via ctx.waitUntil() — fire-and-forget.
 * 
 * Flow:
 * 1. Deduct tokens from user balance
 * 2. Check if balance fell below threshold
 * 3. Auto-reup if needed
 */
export async function recordBillingAfterRequest(
  params: UsageRecordParams
): Promise<void> {
  const { ctx, userId, totalTokens, model, provider, sessionId } = params;
  
  if (totalTokens <= 0) return;

  const balanceGuard = createBalanceGuard(ctx.kv, ctx.db);

  // Deduct usage
  await balanceGuard.recordUsageAndDeduct(userId, totalTokens, model, provider, sessionId);

  // Check if we need to auto-reup
  await checkAndReupIfNeeded(ctx.db, userId, ctx.stripeKey);

  console.log(`[BILLING] Recorded usage: ${userId} - ${totalTokens} tokens (${model})`);
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Check if billing is enabled based on environment
 */
export function isBillingEnabled(env: { 
  VECTORS_D1?: D1Database; 
  METADATA_KV?: KVNamespace;
}): boolean {
  return !!(env.VECTORS_D1 && env.METADATA_KV);
}

/**
 * Create a billing context from environment
 */
export function createBillingContext(env: {
  METADATA_KV?: KVNamespace;
  VECTORS_D1?: D1Database;
  STRIPE_SECRET_KEY?: string;
}): BillingContext | null {
  if (!env.METADATA_KV || !env.VECTORS_D1) {
    return null;
  }
  
  return {
    kv: env.METADATA_KV,
    db: env.VECTORS_D1,
    stripeKey: env.STRIPE_SECRET_KEY,
  };
}

/**
 * Estimate tokens from content length
 * Rule of thumb: ~4 characters per token
 */
export function estimateTokensFromContent(content: string): number {
  return Math.ceil(content.length / 4);
}

/**
 * Calculate billable tokens from provider response or estimate
 * @param providerTokens - Token count from provider (if available)
 * @param inputMessages - Input messages for fallback estimation
 * @param outputContent - Output content for fallback estimation
 */
export function calculateBillableTokens(
  providerTokens: { prompt?: number; completion?: number } | undefined,
  inputMessages: Array<{ content: string }>,
  outputContent: string
): number {
  // Use provider tokens if available
  if (providerTokens?.prompt !== undefined || providerTokens?.completion !== undefined) {
    return (providerTokens.prompt ?? 0) + (providerTokens.completion ?? 0);
  }
  
  // Fallback to estimation
  const inputTokens = inputMessages.reduce((sum, msg) => sum + estimateTokensFromContent(msg.content), 0);
  const outputTokens = estimateTokensFromContent(outputContent);
  return inputTokens + outputTokens;
}
