/**
 * Billing Service
 * 
 * Core billing logic including:
 * - Quota checking
 * - Usage recording
 * - Stripe interactions
 * - Subscription management
 * 
 * Reference: memoryrouter-stripe-spec.md
 */

import {
  PRICING,
  BillingStatus,
  QuotaCheckResult,
  UsageRecord,
  CreateUsageRecordInput,
  DailyUsageSummary,
  BillingPeriod,
  PaymentMethod,
  Invoice,
  BillingOverviewResponse,
  UsageDetailsResponse,
  PaymentMethodsResponse,
  InvoicesResponse,
  StripeEvent,
  UserBillingFields,
} from './types';
import { 
  calculateCost, 
  checkRemainingQuota, 
  calculateBillableTokens,
  tokensToStripeUnits,
} from './tokens';

// =============================================================================
// STUB DATABASE (replace with real database in production)
// =============================================================================

/**
 * Simulated user billing data
 * In production: Query users table with billing columns
 */
const STUB_USER_BILLING: Record<string, UserBillingFields> = {
  'user_001': {
    hasPaymentMethod: false,
    totalTokensUsed: BigInt(3_500_000),
    totalTokensReported: BigInt(0),
    billingStatus: 'free',
  },
  'user_002': {
    stripeCustomerId: 'cus_test123',
    stripeSubscriptionId: 'sub_test123',
    hasPaymentMethod: true,
    totalTokensUsed: BigInt(15_000_000),
    totalTokensReported: BigInt(5_000_000),
    billingStatus: 'active',
  },
};

/**
 * Simulated usage records
 */
const STUB_USAGE_RECORDS: UsageRecord[] = [];

/**
 * Simulated Stripe events
 */
const STUB_STRIPE_EVENTS: Record<string, StripeEvent> = {};

// =============================================================================
// DATABASE FUNCTIONS (stubs for now)
// =============================================================================

/**
 * Get user billing info
 */
export async function getUserBilling(userId: string): Promise<UserBillingFields | null> {
  // STUB: In production, query users table
  return STUB_USER_BILLING[userId] ?? null;
}

/**
 * Update user billing fields
 */
export async function updateUserBilling(
  userId: string, 
  updates: Partial<UserBillingFields>
): Promise<void> {
  // STUB: In production, update users table
  const existing = STUB_USER_BILLING[userId];
  if (existing) {
    Object.assign(existing, updates);
  } else {
    STUB_USER_BILLING[userId] = {
      hasPaymentMethod: false,
      totalTokensUsed: BigInt(0),
      totalTokensReported: BigInt(0),
      billingStatus: 'free',
      ...updates,
    };
  }
}

/**
 * Record usage (fire-and-forget in request path)
 */
export async function recordUsage(input: CreateUsageRecordInput): Promise<void> {
  const record: UsageRecord = {
    id: `ur_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    userId: input.userId,
    memoryKeyId: input.memoryKeyId,
    requestId: input.requestId,
    tokensInput: input.tokensInput,
    tokensOutput: input.tokensOutput,
    tokensRetrieved: input.tokensRetrieved ?? 0,
    tokensEphemeral: input.tokensEphemeral ?? 0,
    model: input.model,
    provider: input.provider,
    costUsd: calculateCost(input.tokensInput + input.tokensOutput),
    createdAt: new Date(),
  };
  
  // STUB: In production, insert into usage_records table
  STUB_USAGE_RECORDS.push(record);
  
  // Update user totals
  const totalNewTokens = BigInt(input.tokensInput + input.tokensOutput);
  const existing = STUB_USER_BILLING[input.userId];
  if (existing) {
    existing.totalTokensUsed += totalNewTokens;
  } else {
    STUB_USER_BILLING[input.userId] = {
      hasPaymentMethod: false,
      totalTokensUsed: totalNewTokens,
      totalTokensReported: BigInt(0),
      billingStatus: 'free',
    };
  }
}

/**
 * Increment user token count atomically
 */
export async function incrementUserTokens(
  userId: string, 
  tokens: number
): Promise<void> {
  // STUB: In production, atomic UPDATE with increment
  const existing = STUB_USER_BILLING[userId];
  if (existing) {
    existing.totalTokensUsed += BigInt(tokens);
  }
}

/**
 * Check if Stripe event was already processed (idempotency)
 */
export async function isEventProcessed(eventId: string): Promise<boolean> {
  const event = STUB_STRIPE_EVENTS[eventId];
  return event?.processed ?? false;
}

/**
 * Log Stripe event
 */
export async function logStripeEvent(
  eventId: string,
  type: string,
  data: unknown
): Promise<void> {
  STUB_STRIPE_EVENTS[eventId] = {
    id: eventId,
    type,
    data,
    processed: false,
    createdAt: new Date(),
  };
}

/**
 * Mark Stripe event as processed
 */
export async function markEventProcessed(
  eventId: string, 
  error?: string
): Promise<void> {
  const event = STUB_STRIPE_EVENTS[eventId];
  if (event) {
    event.processed = true;
    event.processedAt = new Date();
    if (error) {
      event.error = error;
    }
  }
}

// =============================================================================
// QUOTA CHECKING
// =============================================================================

/**
 * Check if a request should be allowed based on quota
 * 
 * Logic:
 * 1. Enterprise users: always allowed
 * 2. Suspended users: always blocked
 * 3. Grace period users: allowed with warning
 * 4. Free tier: check if quota exhausted
 * 5. Paid users: always allowed
 */
export async function checkQuota(userId: string): Promise<QuotaCheckResult> {
  const billing = await getUserBilling(userId);
  
  if (!billing) {
    // New user, initialize with free tier
    await updateUserBilling(userId, {
      hasPaymentMethod: false,
      totalTokensUsed: BigInt(0),
      totalTokensReported: BigInt(0),
      billingStatus: 'free',
    });
    return {
      allowed: true,
      tokensUsed: BigInt(0),
      tokensRemaining: PRICING.FREE_TIER_TOKENS,
      isFreeTier: true,
      paymentRequired: false,
    };
  }
  
  // Enterprise users: no restrictions
  if (billing.billingStatus === 'enterprise') {
    return {
      allowed: true,
      tokensUsed: billing.totalTokensUsed,
      tokensRemaining: Infinity,
      isFreeTier: false,
      paymentRequired: false,
    };
  }
  
  // Suspended users: blocked
  if (billing.billingStatus === 'suspended') {
    return {
      allowed: false,
      reason: 'ACCOUNT_SUSPENDED',
      tokensUsed: billing.totalTokensUsed,
      tokensRemaining: 0,
      isFreeTier: false,
      paymentRequired: true,
    };
  }
  
  // Grace period users: allowed with warning
  if (billing.billingStatus === 'grace_period') {
    return {
      allowed: true,
      tokensUsed: billing.totalTokensUsed,
      tokensRemaining: Infinity,
      isFreeTier: false,
      paymentRequired: true,
      warning: 'Payment past due. Please update your payment method.',
      gracePeriodEndsAt: billing.gracePeriodEndsAt,
    };
  }
  
  // Check quota status
  const quota = checkRemainingQuota(
    billing.totalTokensUsed, 
    billing.hasPaymentMethod
  );
  
  // Free tier exhausted without payment method
  if (quota.isFreeTier && quota.exhausted) {
    return {
      allowed: false,
      reason: 'FREE_TIER_EXHAUSTED',
      tokensUsed: billing.totalTokensUsed,
      tokensRemaining: 0,
      isFreeTier: true,
      paymentRequired: true,
    };
  }
  
  // All other cases: allowed
  return {
    allowed: true,
    tokensUsed: billing.totalTokensUsed,
    tokensRemaining: quota.remaining,
    isFreeTier: quota.isFreeTier,
    paymentRequired: false,
  };
}

// =============================================================================
// BILLING OVERVIEW
// =============================================================================

/**
 * Get billing overview for dashboard
 */
export async function getBillingOverview(userId: string): Promise<BillingOverviewResponse> {
  const billing = await getUserBilling(userId);
  
  if (!billing) {
    // New user with no billing data
    return getDefaultBillingOverview();
  }
  
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysRemaining = Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  
  // Calculate current period usage
  const tokensUsed = Number(billing.totalTokensUsed);
  const freeTierLimit = PRICING.FREE_TIER_TOKENS;
  const tokensBillable = Math.max(0, tokensUsed - freeTierLimit);
  const estimatedCost = calculateCost(tokensBillable);
  
  // Determine plan type
  const plan = billing.billingStatus === 'enterprise' 
    ? 'enterprise' 
    : billing.hasPaymentMethod ? 'usage_based' : 'free';
  
  return {
    status: billing.billingStatus,
    plan,
    usage: {
      current_period: {
        start: periodStart.toISOString(),
        end: periodEnd.toISOString(),
        tokens_used: tokensUsed,
        tokens_billable: tokensBillable,
        estimated_cost_usd: estimatedCost,
        days_remaining: daysRemaining,
      },
      all_time: {
        tokens_used: tokensUsed,
        total_spent_usd: calculateCost(Number(billing.totalTokensReported)),
      },
      free_tier: {
        limit: freeTierLimit,
        used: Math.min(tokensUsed, freeTierLimit),
        remaining: Math.max(0, freeTierLimit - tokensUsed),
        exhausted: tokensUsed >= freeTierLimit,
        exhausted_at: billing.freeTierExhaustedAt?.toISOString(),
      },
    },
    payment_method: {
      has_payment_method: billing.hasPaymentMethod,
    },
    next_invoice: billing.hasPaymentMethod ? {
      estimated_amount_usd: estimatedCost,
      due_date: periodEnd.toISOString(),
    } : undefined,
    savings: {
      // Estimated savings: 3x the memory cost
      estimated_inference_saved_usd: estimatedCost * 3,
      tokens_retrieved_free: 0, // Would need to track this
      context_reuse_ratio: 0.75, // Would need to calculate
    },
  };
}

/**
 * Default billing overview for new users
 */
function getDefaultBillingOverview(): BillingOverviewResponse {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysRemaining = Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  
  return {
    status: 'free',
    plan: 'free',
    usage: {
      current_period: {
        start: periodStart.toISOString(),
        end: periodEnd.toISOString(),
        tokens_used: 0,
        tokens_billable: 0,
        estimated_cost_usd: 0,
        days_remaining: daysRemaining,
      },
      all_time: {
        tokens_used: 0,
        total_spent_usd: 0,
      },
      free_tier: {
        limit: PRICING.FREE_TIER_TOKENS,
        used: 0,
        remaining: PRICING.FREE_TIER_TOKENS,
        exhausted: false,
      },
    },
    payment_method: {
      has_payment_method: false,
    },
    savings: {
      estimated_inference_saved_usd: 0,
      tokens_retrieved_free: 0,
      context_reuse_ratio: 0,
    },
  };
}

// =============================================================================
// USAGE DETAILS
// =============================================================================

/**
 * Get detailed usage for a date range
 */
export async function getUsageDetails(
  userId: string,
  startDate: string,
  endDate: string,
  _granularity: 'hourly' | 'daily' | 'monthly' = 'daily',
  _memoryKeyId?: string
): Promise<UsageDetailsResponse> {
  // STUB: In production, query daily_usage_summary table
  // For now, return mock data based on user's total usage
  
  const billing = await getUserBilling(userId);
  const tokensUsed = Number(billing?.totalTokensUsed ?? BigInt(0));
  
  return {
    period: {
      start: startDate,
      end: endDate,
    },
    totals: {
      tokens_input: Math.floor(tokensUsed * 0.6),
      tokens_output: Math.floor(tokensUsed * 0.4),
      tokens_retrieved: Math.floor(tokensUsed * 0.8),
      tokens_total: tokensUsed,
      cost_usd: calculateCost(tokensUsed),
    },
    breakdown: [
      {
        date: startDate,
        tokens_input: Math.floor(tokensUsed * 0.6),
        tokens_output: Math.floor(tokensUsed * 0.4),
        tokens_total: tokensUsed,
        requests: 50,
        cost_usd: calculateCost(tokensUsed),
      },
    ],
  };
}

// =============================================================================
// PAYMENT METHODS
// =============================================================================

/**
 * Get payment methods for a user
 */
export async function getPaymentMethods(userId: string): Promise<PaymentMethodsResponse> {
  const billing = await getUserBilling(userId);
  
  // STUB: In production, query payment_methods table
  // For now, return based on hasPaymentMethod flag
  
  if (billing?.hasPaymentMethod) {
    return {
      payment_methods: [
        {
          id: 'pm_stub_123',
          brand: 'visa',
          last4: '4242',
          exp_month: 12,
          exp_year: 2028,
          is_default: true,
        },
      ],
      has_payment_method: true,
    };
  }
  
  return {
    payment_methods: [],
    has_payment_method: false,
  };
}

// =============================================================================
// INVOICES
// =============================================================================

/**
 * Get invoice history
 */
export async function getInvoices(
  userId: string,
  _limit: number = 10,
  _offset: number = 0,
  _status?: string
): Promise<InvoicesResponse> {
  // STUB: In production, query invoices table
  
  const billing = await getUserBilling(userId);
  
  if (!billing?.hasPaymentMethod) {
    return {
      invoices: [],
      total_count: 0,
      has_more: false,
    };
  }
  
  // Mock invoice data
  return {
    invoices: [
      {
        id: 'inv_stub_001',
        period_start: '2025-12-01T00:00:00Z',
        period_end: '2025-12-31T23:59:59Z',
        amount_usd: 5.43,
        status: 'paid',
        paid_at: '2026-01-01T00:05:00Z',
        tokens_billed: 5_430_000,
        pdf_url: 'https://stripe.com/invoice/stub.pdf',
        hosted_url: 'https://invoice.stripe.com/stub',
      },
    ],
    total_count: 1,
    has_more: false,
  };
}

// =============================================================================
// SUBSCRIPTION MANAGEMENT
// =============================================================================

/**
 * Create subscription for a user (after adding payment method)
 * 
 * In production, this would:
 * 1. Create Stripe customer if needed
 * 2. Create subscription with metered billing
 * 3. Update user billing fields
 */
export async function createSubscription(
  userId: string,
  paymentMethodId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // STUB: In production:
    // 1. stripe.customers.create / retrieve
    // 2. stripe.paymentMethods.attach
    // 3. stripe.subscriptions.create with metered price
    
    await updateUserBilling(userId, {
      stripeCustomerId: `cus_${Date.now()}`,
      stripeSubscriptionId: `sub_${Date.now()}`,
      hasPaymentMethod: true,
      billingStatus: 'active',
    });
    
    console.log(`[BILLING] Created subscription for user ${userId} with PM ${paymentMethodId}`);
    
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

// =============================================================================
// USAGE REPORTING TO STRIPE
// =============================================================================

/**
 * Report usage to Stripe at end of billing period
 * 
 * Called by scheduled job at end of each billing cycle.
 */
export async function reportUsageToStripe(userId: string): Promise<void> {
  const billing = await getUserBilling(userId);
  
  if (!billing?.stripeSubscriptionId) {
    return; // User not on paid plan
  }
  
  const billableTokens = calculateBillableTokens(
    billing.totalTokensUsed,
    billing.totalTokensReported
  );
  
  if (billableTokens <= 0) {
    return; // Nothing to report
  }
  
  const units = tokensToStripeUnits(billableTokens);
  
  // STUB: In production:
  // const subscription = await stripe.subscriptions.retrieve(billing.stripeSubscriptionId);
  // const subscriptionItemId = subscription.items.data[0].id;
  // await stripe.subscriptionItems.createUsageRecord(subscriptionItemId, {
  //   quantity: units,
  //   timestamp: Math.floor(Date.now() / 1000),
  //   action: 'set',
  // });
  
  console.log(`[BILLING] Reported ${units} units (${billableTokens} tokens) for user ${userId}`);
  
  await updateUserBilling(userId, {
    totalTokensReported: billing.totalTokensUsed,
  });
}

// =============================================================================
// GRACE PERIOD HANDLING
// =============================================================================

/**
 * Start grace period after payment failure
 */
export async function startGracePeriod(userId: string): Promise<void> {
  const gracePeriodEnd = new Date();
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + PRICING.GRACE_PERIOD_DAYS);
  
  await updateUserBilling(userId, {
    billingStatus: 'grace_period',
    gracePeriodEndsAt: gracePeriodEnd,
  });
  
  console.log(`[BILLING] Grace period started for user ${userId}, ends ${gracePeriodEnd.toISOString()}`);
}

/**
 * End grace period and suspend account
 */
export async function suspendAccount(userId: string): Promise<void> {
  await updateUserBilling(userId, {
    billingStatus: 'suspended',
    gracePeriodEndsAt: undefined,
  });
  
  console.log(`[BILLING] Account suspended for user ${userId}`);
}

/**
 * Restore account after payment
 */
export async function restoreAccount(userId: string): Promise<void> {
  await updateUserBilling(userId, {
    billingStatus: 'active',
    gracePeriodEndsAt: undefined,
  });
  
  console.log(`[BILLING] Account restored for user ${userId}`);
}

// =============================================================================
// FREE TIER TRANSITION
// =============================================================================

/**
 * Handle transition from free tier to paid
 * Called when user adds payment method after exhausting free tier
 */
export async function transitionToPaid(
  userId: string,
  paymentMethodId: string
): Promise<{ success: boolean; error?: string }> {
  const billing = await getUserBilling(userId);
  
  if (!billing) {
    return { success: false, error: 'User not found' };
  }
  
  // Mark free tier as exhausted
  if (!billing.freeTierExhaustedAt && billing.totalTokensUsed >= BigInt(PRICING.FREE_TIER_TOKENS)) {
    await updateUserBilling(userId, {
      freeTierExhaustedAt: new Date(),
    });
  }
  
  // Create subscription
  return createSubscription(userId, paymentMethodId);
}
