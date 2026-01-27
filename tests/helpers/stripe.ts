/**
 * Stripe Test Helpers
 * 
 * Utilities for creating mock Stripe webhooks and metering events.
 * Defines the expected interface that the Stripe implementation must conform to.
 */

import crypto from 'crypto';

// =============================================================================
// REQUIRED WEBHOOK EVENTS
// The implementation must handle these event types
// =============================================================================

export const REQUIRED_WEBHOOK_EVENTS = [
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
] as const;

export type WebhookEventType = typeof REQUIRED_WEBHOOK_EVENTS[number] | string;

// =============================================================================
// WEBHOOK SIGNATURE HELPERS
// =============================================================================

/**
 * Create a Stripe webhook signature
 * Uses the same algorithm as Stripe's webhook verification
 */
function createStripeSignature(payload: string, secret: string, timestamp: number): string {
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
  
  return `t=${timestamp},v1=${signature}`;
}

/**
 * Verify a Stripe webhook signature
 * Simplified version - in production use stripe.webhooks.constructEvent
 */
export function verifyStripeSignature(
  payload: string,
  signature: string,
  secret: string,
  toleranceSeconds: number = 300
): boolean {
  const parts = signature.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    acc[key] = value;
    return acc;
  }, {} as Record<string, string>);

  const timestamp = parseInt(parts.t || '0', 10);
  const providedSig = parts.v1;

  if (!timestamp || !providedSig) {
    return false;
  }

  // Check timestamp is not too old
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return false;
  }

  // Verify signature
  const signedPayload = `${timestamp}.${payload}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(providedSig),
    Buffer.from(expectedSig)
  );
}

// =============================================================================
// WEBHOOK FACTORY FUNCTIONS
// =============================================================================

interface WebhookResult {
  payload: StripeWebhookPayload;
  signature: string;
}

interface StripeWebhookPayload {
  id: string;
  object: 'event';
  type: string;
  created: number;
  data: {
    object: any;
  };
}

/**
 * Create a generic Stripe webhook with proper signature
 */
export function createStripeWebhook(
  type: WebhookEventType,
  data: Record<string, any>,
  secret: string = 'whsec_test_secret'
): WebhookResult {
  const timestamp = Math.floor(Date.now() / 1000);
  
  const payload: StripeWebhookPayload = {
    id: `evt_${generateId()}`,
    object: 'event',
    type,
    created: timestamp,
    data: {
      object: data,
    },
  };

  const payloadString = JSON.stringify(payload);
  const signature = createStripeSignature(payloadString, secret, timestamp);

  return { payload, signature };
}

/**
 * Create an invoice.paid webhook
 */
export function createInvoicePaidWebhook(
  customerId: string,
  amountPaid: number = 1000,
  secret: string = 'whsec_test_secret'
): WebhookResult {
  return createStripeWebhook('invoice.paid', {
    id: `in_${generateId()}`,
    object: 'invoice',
    customer: customerId,
    amount_paid: amountPaid,
    currency: 'usd',
    status: 'paid',
    subscription: `sub_${generateId()}`,
    lines: {
      data: [
        {
          id: `il_${generateId()}`,
          object: 'line_item',
          amount: amountPaid,
          description: 'MemoryRouter Pro - Memory Tokens',
        },
      ],
    },
  }, secret);
}

/**
 * Create a customer.subscription.created webhook
 */
export function createSubscriptionCreatedWebhook(
  customerId: string,
  secret: string = 'whsec_test_secret'
): WebhookResult {
  const subscriptionId = `sub_${generateId()}`;
  const subscriptionItemId = `si_${generateId()}`;
  
  return createStripeWebhook('customer.subscription.created', {
    id: subscriptionId,
    object: 'subscription',
    customer: customerId,
    status: 'active',
    items: {
      data: [
        {
          id: subscriptionItemId,
          object: 'subscription_item',
          price: {
            id: `price_memory_tokens`,
            object: 'price',
            unit_amount: 100, // $1 per 1M tokens
            currency: 'usd',
            recurring: {
              interval: 'month',
              usage_type: 'metered',
            },
          },
        },
      ],
    },
    current_period_start: Math.floor(Date.now() / 1000),
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  }, secret);
}

/**
 * Create a customer.subscription.deleted webhook
 */
export function createSubscriptionDeletedWebhook(
  customerId: string,
  subscriptionId: string,
  secret: string = 'whsec_test_secret'
): WebhookResult {
  return createStripeWebhook('customer.subscription.deleted', {
    id: subscriptionId,
    object: 'subscription',
    customer: customerId,
    status: 'canceled',
    ended_at: Math.floor(Date.now() / 1000),
  }, secret);
}

/**
 * Create an invoice.payment_failed webhook
 */
export function createPaymentFailedWebhook(
  customerId: string,
  secret: string = 'whsec_test_secret'
): WebhookResult {
  return createStripeWebhook('invoice.payment_failed', {
    id: `in_${generateId()}`,
    object: 'invoice',
    customer: customerId,
    amount_due: 1500,
    currency: 'usd',
    status: 'open',
    attempt_count: 1,
    next_payment_attempt: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
  }, secret);
}

// =============================================================================
// METERING SERVICE
// =============================================================================

interface UsageRecord {
  id: string;
  subscriptionItemId: string;
  quantity: number;
  timestamp: Date;
  action: 'increment' | 'set';
}

interface UsageReportResult {
  id: string;
  object: 'usage_record';
  quantity: number;
  subscription_item: string;
  timestamp: number;
}

interface BatchUsageItem {
  subscriptionItemId: string;
  quantity: number;
  action?: 'increment' | 'set';
}

interface CurrentUsageResult {
  total_usage: number;
  period: {
    start: Date;
    end: Date;
  };
}

/**
 * Create a mock metering service for testing
 * Defines the expected interface for usage metering
 */
export function createMockMeteringService() {
  const records: UsageRecord[] = [];
  let idCounter = 1;

  return {
    /**
     * Report usage for a subscription item
     */
    async reportUsage(
      subscriptionItemId: string,
      quantity: number,
      action: 'increment' | 'set' = 'increment'
    ): Promise<UsageReportResult> {
      const record: UsageRecord = {
        id: `mbur_${generateId()}`,
        subscriptionItemId,
        quantity,
        timestamp: new Date(),
        action,
      };
      records.push(record);

      return {
        id: record.id,
        object: 'usage_record',
        quantity,
        subscription_item: subscriptionItemId,
        timestamp: Math.floor(record.timestamp.getTime() / 1000),
      };
    },

    /**
     * Batch report usage for multiple subscription items
     */
    async batchReportUsage(items: BatchUsageItem[]): Promise<UsageReportResult[]> {
      const results: UsageReportResult[] = [];
      
      for (const item of items) {
        const result = await this.reportUsage(
          item.subscriptionItemId,
          item.quantity,
          item.action || 'increment'
        );
        results.push(result);
      }
      
      return results;
    },

    /**
     * Get current usage for a subscription item
     */
    async getCurrentUsage(subscriptionItemId: string): Promise<CurrentUsageResult> {
      const itemRecords = records.filter(r => r.subscriptionItemId === subscriptionItemId);
      const totalUsage = itemRecords.reduce((sum, r) => sum + r.quantity, 0);
      
      // Assume monthly billing period
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      
      return {
        total_usage: totalUsage,
        period: {
          start: periodStart,
          end: periodEnd,
        },
      };
    },

    /**
     * Test helper: Get all recorded usage
     */
    _getRecords(): UsageRecord[] {
      return [...records];
    },

    /**
     * Test helper: Clear all records
     */
    _clear(): void {
      records.length = 0;
    },
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function generateId(): string {
  return crypto.randomBytes(12).toString('hex');
}

// =============================================================================
// TYPE EXPORTS (for implementation to use)
// =============================================================================

export type { 
  WebhookResult, 
  StripeWebhookPayload,
  UsageRecord,
  UsageReportResult,
  BatchUsageItem,
  CurrentUsageResult,
};
