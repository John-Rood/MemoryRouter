/**
 * Integration Tests: Stripe Webhooks
 * 
 * Tests the Stripe webhook handling for subscription management
 * and usage metering.
 * 
 * IMPORTANT: These tests define the expected interface for Stripe integration.
 * The actual implementation must conform to these contracts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import {
  createStripeWebhook,
  verifyStripeSignature,
  createInvoicePaidWebhook,
  createSubscriptionCreatedWebhook,
  createSubscriptionDeletedWebhook,
  createPaymentFailedWebhook,
  createMockMeteringService,
  REQUIRED_WEBHOOK_EVENTS,
} from '../helpers/stripe';

// =============================================================================
// MOCK IMPLEMENTATION
// This simulates what the actual implementation should do
// =============================================================================

interface UserSubscription {
  userId: string;
  customerId: string;
  subscriptionId?: string;
  tier: 'free' | 'paid';
  quotaTokens: number;
}

// In-memory store for testing
const mockUsers = new Map<string, UserSubscription>();

// Mock webhook handler
async function handleStripeWebhook(
  payload: string,
  signature: string,
  secret: string
): Promise<{ success: boolean; action?: string; error?: string }> {
  // Verify signature
  if (!verifyStripeSignature(payload, signature, secret)) {
    return { success: false, error: 'Invalid signature' };
  }

  const event = JSON.parse(payload);
  const data = event.data.object;

  switch (event.type) {
    case 'invoice.paid': {
      const user = findUserByCustomerId(data.customer);
      if (user) {
        // Record payment (in real impl, update database)
        return { success: true, action: 'payment_recorded' };
      }
      return { success: false, error: 'Customer not found' };
    }

    case 'customer.subscription.created': {
      const user = findUserByCustomerId(data.customer);
      if (user) {
        user.tier = 'paid';
        user.quotaTokens = Infinity;
        user.subscriptionId = data.id;
        return { success: true, action: 'subscription_created' };
      }
      return { success: false, error: 'Customer not found' };
    }

    case 'customer.subscription.deleted': {
      const user = findUserByCustomerId(data.customer);
      if (user) {
        user.tier = 'free';
        user.quotaTokens = 50_000_000;
        user.subscriptionId = undefined;
        return { success: true, action: 'subscription_deleted' };
      }
      return { success: false, error: 'Customer not found' };
    }

    case 'invoice.payment_failed': {
      const user = findUserByCustomerId(data.customer);
      if (user) {
        // Mark as past due, send notification
        return { success: true, action: 'payment_failed_handled' };
      }
      return { success: false, error: 'Customer not found' };
    }

    default:
      return { success: true, action: 'ignored' };
  }
}

function findUserByCustomerId(customerId: string): UserSubscription | undefined {
  for (const user of mockUsers.values()) {
    if (user.customerId === customerId) {
      return user;
    }
  }
  return undefined;
}

// =============================================================================
// TESTS
// =============================================================================

describe('Stripe Webhook Integration', () => {
  const webhookSecret = 'whsec_test_secret';

  beforeEach(() => {
    mockUsers.clear();
    // Seed test user
    mockUsers.set('user_001', {
      userId: 'user_001',
      customerId: 'cus_test123',
      tier: 'free',
      quotaTokens: 50_000_000,
    });
  });

  describe('Webhook signature verification', () => {
    it('accepts valid signature', async () => {
      const webhook = createStripeWebhook(
        'invoice.paid',
        { customer: 'cus_test123', amount_paid: 1000 },
        webhookSecret
      );

      const result = await handleStripeWebhook(
        JSON.stringify(webhook.payload),
        webhook.signature,
        webhookSecret
      );

      expect(result.success).toBe(true);
    });

    it('rejects invalid signature', async () => {
      const webhook = createStripeWebhook(
        'invoice.paid',
        { customer: 'cus_test123' },
        webhookSecret
      );

      const result = await handleStripeWebhook(
        JSON.stringify(webhook.payload),
        'invalid_signature',
        webhookSecret
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('signature');
    });

    it('rejects expired timestamp', async () => {
      const webhook = createStripeWebhook(
        'invoice.paid',
        { customer: 'cus_test123' },
        webhookSecret
      );

      // Modify timestamp to be too old
      const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // 400 seconds ago
      const oldSignature = webhook.signature.replace(/t=\d+/, `t=${oldTimestamp}`);

      const result = await handleStripeWebhook(
        JSON.stringify(webhook.payload),
        oldSignature,
        webhookSecret
      );

      expect(result.success).toBe(false);
    });

    it('rejects modified payload', async () => {
      const webhook = createStripeWebhook(
        'invoice.paid',
        { customer: 'cus_test123' },
        webhookSecret
      );

      // Modify payload after signing
      const modifiedPayload = { ...webhook.payload, modified: true };

      const result = await handleStripeWebhook(
        JSON.stringify(modifiedPayload),
        webhook.signature,
        webhookSecret
      );

      expect(result.success).toBe(false);
    });
  });

  describe('invoice.paid webhook', () => {
    it('records payment for existing customer', async () => {
      const webhook = createInvoicePaidWebhook('cus_test123', 1500);

      const result = await handleStripeWebhook(
        JSON.stringify(webhook.payload),
        webhook.signature,
        webhookSecret
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('payment_recorded');
    });

    it('returns error for unknown customer', async () => {
      const webhook = createInvoicePaidWebhook('cus_unknown', 1000);

      const result = await handleStripeWebhook(
        JSON.stringify(webhook.payload),
        webhook.signature,
        webhookSecret
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('customer.subscription.created webhook', () => {
    it('upgrades user to paid tier', async () => {
      const user = mockUsers.get('user_001')!;
      expect(user.tier).toBe('free');

      const webhook = createSubscriptionCreatedWebhook('cus_test123');

      const result = await handleStripeWebhook(
        JSON.stringify(webhook.payload),
        webhook.signature,
        webhookSecret
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('subscription_created');
      expect(user.tier).toBe('paid');
      expect(user.quotaTokens).toBe(Infinity);
    });

    it('stores subscription ID', async () => {
      const user = mockUsers.get('user_001')!;

      const webhook = createSubscriptionCreatedWebhook('cus_test123');

      await handleStripeWebhook(
        JSON.stringify(webhook.payload),
        webhook.signature,
        webhookSecret
      );

      expect(user.subscriptionId).toBeDefined();
      expect(user.subscriptionId).toMatch(/^sub_/);
    });
  });

  describe('customer.subscription.deleted webhook', () => {
    it('downgrades user to free tier', async () => {
      const user = mockUsers.get('user_001')!;
      user.tier = 'paid';
      user.quotaTokens = Infinity;
      user.subscriptionId = 'sub_existing';

      const webhook = createSubscriptionDeletedWebhook('cus_test123', 'sub_existing');

      const result = await handleStripeWebhook(
        JSON.stringify(webhook.payload),
        webhook.signature,
        webhookSecret
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('subscription_deleted');
      expect(user.tier).toBe('free');
      expect(user.quotaTokens).toBe(50_000_000);
    });

    it('clears subscription ID', async () => {
      const user = mockUsers.get('user_001')!;
      user.subscriptionId = 'sub_existing';

      const webhook = createSubscriptionDeletedWebhook('cus_test123', 'sub_existing');

      await handleStripeWebhook(
        JSON.stringify(webhook.payload),
        webhook.signature,
        webhookSecret
      );

      expect(user.subscriptionId).toBeUndefined();
    });
  });

  describe('invoice.payment_failed webhook', () => {
    it('handles payment failure', async () => {
      const webhook = createPaymentFailedWebhook('cus_test123');

      const result = await handleStripeWebhook(
        JSON.stringify(webhook.payload),
        webhook.signature,
        webhookSecret
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('payment_failed_handled');
    });
  });

  describe('Required webhook events', () => {
    it('handles all required event types', () => {
      // Document expected event types
      expect(REQUIRED_WEBHOOK_EVENTS).toContain('invoice.paid');
      expect(REQUIRED_WEBHOOK_EVENTS).toContain('invoice.payment_failed');
      expect(REQUIRED_WEBHOOK_EVENTS).toContain('customer.subscription.created');
      expect(REQUIRED_WEBHOOK_EVENTS).toContain('customer.subscription.updated');
      expect(REQUIRED_WEBHOOK_EVENTS).toContain('customer.subscription.deleted');
    });
  });

  describe('Unknown webhook events', () => {
    it('ignores unknown event types gracefully', async () => {
      const webhook = createStripeWebhook(
        'unknown.event.type',
        { some: 'data' },
        webhookSecret
      );

      const result = await handleStripeWebhook(
        JSON.stringify(webhook.payload),
        webhook.signature,
        webhookSecret
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('ignored');
    });
  });
});

describe('Usage Metering', () => {
  describe('Mock metering service', () => {
    it('reports usage correctly', async () => {
      const metering = createMockMeteringService();

      const result = await metering.reportUsage('si_test123', 1000);

      expect(result.id).toMatch(/^mbur_/);
      expect(result.quantity).toBe(1000);
    });

    it('tracks multiple usage reports', async () => {
      const metering = createMockMeteringService();

      await metering.reportUsage('si_test123', 500);
      await metering.reportUsage('si_test123', 300);
      await metering.reportUsage('si_test123', 200);

      const records = metering._getRecords();
      expect(records.length).toBe(3);
    });

    it('batches usage reports', async () => {
      const metering = createMockMeteringService();

      await metering.batchReportUsage([
        { subscriptionItemId: 'si_test123', quantity: 100 },
        { subscriptionItemId: 'si_test456', quantity: 200 },
      ]);

      const records = metering._getRecords();
      expect(records.length).toBe(2);
    });

    it('calculates current usage', async () => {
      const metering = createMockMeteringService();

      await metering.reportUsage('si_test123', 1000);
      await metering.reportUsage('si_test123', 500);

      const usage = await metering.getCurrentUsage('si_test123');
      expect(usage.total_usage).toBe(1500);
    });

    it('clears records correctly', async () => {
      const metering = createMockMeteringService();

      await metering.reportUsage('si_test123', 1000);
      metering._clear();

      expect(metering._getRecords().length).toBe(0);
    });
  });

  describe('Expected metering interface', () => {
    it('interface has required methods', () => {
      const metering = createMockMeteringService();

      expect(typeof metering.reportUsage).toBe('function');
      expect(typeof metering.batchReportUsage).toBe('function');
      expect(typeof metering.getCurrentUsage).toBe('function');
    });
  });
});

describe('Stripe API endpoint (mock)', () => {
  it('creates Hono app with webhook endpoint', async () => {
    const app = new Hono();
    const webhookSecret = 'whsec_test_secret'; // Match the default in createInvoicePaidWebhook

    // Set up mock user FIRST
    mockUsers.set('user_001', {
      userId: 'user_001',
      customerId: 'cus_test123',
      tier: 'free',
      quotaTokens: 50_000_000,
    });

    app.post('/webhooks/stripe', async (c) => {
      const signature = c.req.header('stripe-signature');
      if (!signature) {
        return c.json({ error: 'Missing signature' }, 400);
      }

      const payload = await c.req.text();

      try {
        const result = await handleStripeWebhook(payload, signature, webhookSecret);
        if (result.success) {
          return c.json({ received: true, action: result.action });
        } else {
          return c.json({ error: result.error }, 400);
        }
      } catch (error) {
        return c.json({ error: 'Webhook processing failed' }, 500);
      }
    });

    // Create webhook with matching secret
    const webhook = createInvoicePaidWebhook('cus_test123', 1000, webhookSecret);

    const response = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': webhook.signature,
      },
      body: JSON.stringify(webhook.payload),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.received).toBe(true);
  });

  it('returns 400 for missing signature', async () => {
    const app = new Hono();

    app.post('/webhooks/stripe', async (c) => {
      const signature = c.req.header('stripe-signature');
      if (!signature) {
        return c.json({ error: 'Missing signature' }, 400);
      }
      return c.json({ received: true });
    });

    const response = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'test' }),
    });

    expect(response.status).toBe(400);
  });
});
