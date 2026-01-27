/**
 * Billing Types
 * 
 * Defines all TypeScript interfaces for the billing system.
 * Reference: memoryrouter-stripe-spec.md
 */

// =============================================================================
// CONSTANTS
// =============================================================================

export const PRICING = {
  /** Price per million tokens in USD */
  PRICE_PER_MILLION_TOKENS: 1.00,
  
  /** Free tier token limit */
  FREE_TIER_TOKENS: 50_000_000,
  
  /** Default auto-reup amount in USD */
  DEFAULT_REUP_AMOUNT: 20.00,
  
  /** Default trigger point (reup when balance drops to this) */
  DEFAULT_REUP_TRIGGER: 5.00,
  
  /** Minimum reup amount in USD */
  MIN_REUP_AMOUNT: 5.00,
  
  /** Grace period in days after payment failure */
  GRACE_PERIOD_DAYS: 7,
  
  /** Data retention in days from last use */
  DATA_RETENTION_DAYS: 90,
} as const;

// =============================================================================
// BILLING STATUS
// =============================================================================

/**
 * User billing status
 * 
 * States:
 * - free: User is on free tier, no payment method required yet
 * - active: Paid user with valid subscription
 * - past_due: Payment failed but within retry window
 * - grace_period: Payment failed, in 7-day grace period
 * - suspended: Grace period expired, access blocked
 * - enterprise: Custom enterprise plan
 */
export type BillingStatus = 
  | 'free' 
  | 'active' 
  | 'past_due' 
  | 'grace_period' 
  | 'suspended' 
  | 'enterprise';

/**
 * Plan type
 */
export type PlanType = 'free' | 'usage_based' | 'enterprise';

// =============================================================================
// USER BILLING FIELDS
// =============================================================================

/**
 * Extended user fields for billing
 * These are added to the users table
 */
export interface UserBillingFields {
  /** Stripe customer ID (cus_xxx) */
  stripeCustomerId?: string;
  
  /** Stripe subscription ID (sub_xxx) */
  stripeSubscriptionId?: string;
  
  /** Subscription status from Stripe */
  stripeSubscriptionStatus?: string;
  
  /** Whether user has at least one payment method */
  hasPaymentMethod: boolean;
  
  /** Total tokens used across all time */
  totalTokensUsed: bigint;
  
  /** Total tokens reported to Stripe */
  totalTokensReported: bigint;
  
  /** Current billing status */
  billingStatus: BillingStatus;
  
  /** When free tier was exhausted */
  freeTierExhaustedAt?: Date;
  
  /** Email for billing notifications */
  billingEmail?: string;
  
  /** When grace period ends (after payment failure) */
  gracePeriodEndsAt?: Date;
}

// =============================================================================
// USAGE RECORDS
// =============================================================================

/**
 * Usage record for a single request
 * Stored in: usage_records table
 */
export interface UsageRecord {
  id: string;
  userId: string;
  memoryKeyId?: string;
  requestId?: string;
  
  /** Input tokens that were stored */
  tokensInput: number;
  
  /** Output tokens that were stored */
  tokensOutput: number;
  
  /** Retrieved tokens (RAG context - free) */
  tokensRetrieved: number;
  
  /** Ephemeral tokens (memory:false - not charged) */
  tokensEphemeral: number;
  
  /** Model used */
  model?: string;
  
  /** Provider used */
  provider?: string;
  
  /** Calculated cost in USD */
  costUsd: number;
  
  createdAt: Date;
}

/**
 * Create usage record input
 */
export interface CreateUsageRecordInput {
  userId: string;
  memoryKeyId?: string;
  requestId?: string;
  tokensInput: number;
  tokensOutput: number;
  tokensRetrieved?: number;
  tokensEphemeral?: number;
  model?: string;
  provider?: string;
}

// =============================================================================
// DAILY USAGE SUMMARY
// =============================================================================

/**
 * Daily aggregated usage
 * Stored in: daily_usage_summary table
 */
export interface DailyUsageSummary {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  
  tokensInput: bigint;
  tokensOutput: bigint;
  tokensTotal: bigint;
  tokensRetrieved: bigint;
  
  requestCount: number;
  
  aggregatedAt: Date;
}

// =============================================================================
// BILLING PERIODS
// =============================================================================

/**
 * Billing period status
 */
export type BillingPeriodStatus = 'active' | 'closed' | 'invoiced' | 'paid';

/**
 * Billing period tracking
 * Stored in: billing_periods table
 */
export interface BillingPeriod {
  id: string;
  userId: string;
  
  /** Period start date */
  periodStart: Date;
  
  /** Period end date */
  periodEnd: Date;
  
  /** Tokens used during period */
  tokensUsed: bigint;
  
  /** Tokens above free tier */
  tokensBillable: bigint;
  
  /** Stripe invoice ID */
  stripeInvoiceId?: string;
  
  /** Whether usage was reported to Stripe */
  reportedToStripe: boolean;
  
  /** When reported to Stripe */
  reportedAt?: Date;
  
  /** Units reported (in millions of tokens) */
  unitsReported?: number;
  
  status: BillingPeriodStatus;
  
  createdAt: Date;
}

// =============================================================================
// STRIPE EVENTS (IDEMPOTENCY)
// =============================================================================

/**
 * Stripe event log for idempotency
 * Stored in: stripe_events table
 */
export interface StripeEvent {
  id: string;          // Stripe event ID (evt_xxx)
  type: string;        // Event type
  data: unknown;       // Event data (JSON)
  processed: boolean;
  processedAt?: Date;
  error?: string;
  createdAt: Date;
}

// =============================================================================
// PAYMENT METHODS
// =============================================================================

/**
 * Cached payment method info
 * Stored in: payment_methods table
 */
export interface PaymentMethod {
  id: string;
  userId: string;
  stripePaymentMethodId: string;
  
  /** Card brand (visa, mastercard, etc.) */
  brand?: string;
  
  /** Last 4 digits */
  last4?: string;
  
  /** Expiry month */
  expMonth?: number;
  
  /** Expiry year */
  expYear?: number;
  
  isDefault: boolean;
  
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// INVOICES
// =============================================================================

/**
 * Invoice status
 */
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';

/**
 * Cached invoice info
 * Stored in: invoices table
 */
export interface Invoice {
  id: string;
  userId: string;
  stripeInvoiceId: string;
  billingPeriodId?: string;
  
  status: InvoiceStatus;
  
  /** Amount due in cents */
  amountDue: number;
  
  /** Amount paid in cents */
  amountPaid: number;
  
  currency: string;
  
  /** Stripe hosted invoice URL */
  hostedInvoiceUrl?: string;
  
  /** PDF download URL */
  invoicePdf?: string;
  
  periodStart?: Date;
  periodEnd?: Date;
  dueDate?: Date;
  paidAt?: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

/**
 * GET /v1/billing response
 */
export interface BillingOverviewResponse {
  status: BillingStatus;
  plan: PlanType;
  
  usage: {
    current_period: {
      start: string;
      end: string;
      tokens_used: number;
      tokens_billable: number;
      estimated_cost_usd: number;
      days_remaining: number;
    };
    all_time: {
      tokens_used: number;
      total_spent_usd: number;
    };
    free_tier: {
      limit: number;
      used: number;
      remaining: number;
      exhausted: boolean;
      exhausted_at?: string;
    };
  };
  
  payment_method?: {
    has_payment_method: boolean;
    brand?: string;
    last4?: string;
    exp_month?: number;
    exp_year?: number;
  };
  
  next_invoice?: {
    estimated_amount_usd: number;
    due_date: string;
  };
  
  savings?: {
    estimated_inference_saved_usd: number;
    tokens_retrieved_free: number;
    context_reuse_ratio: number;
  };
}

/**
 * GET /v1/billing/usage response
 */
export interface UsageDetailsResponse {
  period: {
    start: string;
    end: string;
  };
  totals: {
    tokens_input: number;
    tokens_output: number;
    tokens_retrieved: number;
    tokens_total: number;
    cost_usd: number;
  };
  breakdown: Array<{
    date: string;
    tokens_input: number;
    tokens_output: number;
    tokens_total: number;
    requests: number;
    cost_usd: number;
  }>;
  by_memory_key?: Array<{
    memory_key: string;
    name?: string;
    tokens_total: number;
    percentage: number;
  }>;
}

/**
 * GET /v1/billing/payment-methods response
 */
export interface PaymentMethodsResponse {
  payment_methods: Array<{
    id: string;
    brand?: string;
    last4?: string;
    exp_month?: number;
    exp_year?: number;
    is_default: boolean;
  }>;
  has_payment_method: boolean;
}

/**
 * GET /v1/billing/invoices response
 */
export interface InvoicesResponse {
  invoices: Array<{
    id: string;
    period_start: string;
    period_end: string;
    amount_usd: number;
    status: InvoiceStatus;
    paid_at?: string;
    tokens_billed?: number;
    pdf_url?: string;
    hosted_url?: string;
  }>;
  total_count: number;
  has_more: boolean;
}

// =============================================================================
// QUOTA CHECK
// =============================================================================

/**
 * Result of a quota check
 */
export interface QuotaCheckResult {
  /** Whether request is allowed */
  allowed: boolean;
  
  /** Reason if not allowed */
  reason?: 'FREE_TIER_EXHAUSTED' | 'ACCOUNT_SUSPENDED' | 'QUOTA_EXCEEDED';
  
  /** Current tokens used */
  tokensUsed: bigint;
  
  /** Tokens remaining (Infinity for paid users) */
  tokensRemaining: number | typeof Infinity;
  
  /** Whether user is in free tier */
  isFreeTier: boolean;
  
  /** Whether payment method is required */
  paymentRequired: boolean;
  
  /** Warning message (e.g., for grace period) */
  warning?: string;
  
  /** When grace period ends */
  gracePeriodEndsAt?: Date;
}

// =============================================================================
// TOKEN COUNTING
// =============================================================================

/**
 * Input for token metering
 */
export interface TokenMeteringInput {
  /** Request messages */
  messages: Array<{
    role: string;
    content: string;
    memory?: boolean;
  }>;
  
  /** Response content */
  responseContent?: string;
  
  /** Whether to store request (from header) */
  storeRequest: boolean;
  
  /** Whether to store response (from header) */
  storeResponse: boolean;
  
  /** Retrieved context (for stats, free) */
  retrievedContext?: string;
}

/**
 * Result of token counting
 */
export interface TokenCountResult {
  /** Input tokens that will be stored (billable) */
  storedInputTokens: number;
  
  /** Output tokens that will be stored (billable) */
  storedOutputTokens: number;
  
  /** Retrieved tokens (free) */
  retrievedTokens: number;
  
  /** Ephemeral tokens (not stored, not charged) */
  ephemeralTokens: number;
  
  /** Total billable tokens */
  billableTokens: number;
  
  /** Cost in USD */
  costUsd: number;
}
