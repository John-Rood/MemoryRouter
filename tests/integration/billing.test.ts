/**
 * Billing Integration Tests
 * 
 * Reference: memoryrouter-test-strategy.md Section 4.5
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware } from '../../src/middleware/auth';
import { billingRoutes, webhookRoutes, quotaCheckMiddleware, updateUserBilling } from '../../src/billing';
import { PRICING } from '../../src/billing/types';

// Setup test app
function createTestApp() {
  const app = new Hono();
  
  // Webhooks (no auth)
  app.route('/webhooks', webhookRoutes);
  
  // API routes (with auth)
  const v1 = new Hono();
  v1.use('*', authMiddleware);
  v1.route('/billing', billingRoutes);
  
  app.route('/v1', v1);
  
  return app;
}

describe('Billing API Integration', () => {
  const app = createTestApp();

  describe('GET /v1/billing', () => {
    it('returns billing overview for authenticated user', async () => {
      // Setup test user
      await updateUserBilling('user_001', {
        hasPaymentMethod: false,
        totalTokensUsed: BigInt(5_000_000),
        billingStatus: 'free',
      });

      const res = await app.request('/v1/billing', {
        headers: {
          'Authorization': 'Bearer mk_test_key',
        },
      });

      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.status).toBe('free');
      expect(data.usage.current_period.tokens_used).toBe(5_000_000);
      expect(data.usage.free_tier.remaining).toBe(5_000_000);
    });

    it('requires authentication', async () => {
      const res = await app.request('/v1/billing');
      expect(res.status).toBe(401);
    });

    it('returns correct data for paid user', async () => {
      await updateUserBilling('user_002', {
        hasPaymentMethod: true,
        totalTokensUsed: BigInt(15_000_000),
        billingStatus: 'active',
        stripeCustomerId: 'cus_test',
      });

      const res = await app.request('/v1/billing', {
        headers: {
          'Authorization': 'Bearer mk_user2_project',
        },
      });

      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.status).toBe('active');
      expect(data.plan).toBe('usage_based');
      expect(data.next_invoice).toBeDefined();
    });
  });

  describe('GET /v1/billing/usage', () => {
    it('returns usage details with defaults', async () => {
      const res = await app.request('/v1/billing/usage', {
        headers: {
          'Authorization': 'Bearer mk_test_key',
        },
      });

      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.period).toBeDefined();
      expect(data.totals).toBeDefined();
      expect(data.breakdown).toBeDefined();
    });

    it('accepts date range parameters', async () => {
      const res = await app.request('/v1/billing/usage?start_date=2026-01-01&end_date=2026-01-25', {
        headers: {
          'Authorization': 'Bearer mk_test_key',
        },
      });

      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.period.start).toBe('2026-01-01');
      expect(data.period.end).toBe('2026-01-25');
    });
  });

  describe('GET /v1/billing/payment-methods', () => {
    it('returns empty list for free user', async () => {
      await updateUserBilling('user_001', {
        hasPaymentMethod: false,
        billingStatus: 'free',
      });

      const res = await app.request('/v1/billing/payment-methods', {
        headers: {
          'Authorization': 'Bearer mk_test_key',
        },
      });

      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.payment_methods).toHaveLength(0);
      expect(data.has_payment_method).toBe(false);
    });

    it('returns payment methods for paid user', async () => {
      await updateUserBilling('user_002', {
        hasPaymentMethod: true,
        billingStatus: 'active',
      });

      const res = await app.request('/v1/billing/payment-methods', {
        headers: {
          'Authorization': 'Bearer mk_user2_project',
        },
      });

      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.payment_methods.length).toBeGreaterThan(0);
      expect(data.has_payment_method).toBe(true);
    });
  });

  describe('POST /v1/billing/payment-methods', () => {
    it('adds payment method and transitions to paid if exhausted', async () => {
      await updateUserBilling('user_001', {
        hasPaymentMethod: false,
        totalTokensUsed: BigInt(PRICING.FREE_TIER_TOKENS + 1_000_000),
        billingStatus: 'free',
      });

      const res = await app.request('/v1/billing/payment-methods', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer mk_test_key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          payment_method_id: 'pm_test_123',
          set_default: true,
        }),
      });

      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.billing_status).toBe('active');
    });

    it('requires payment_method_id', async () => {
      const res = await app.request('/v1/billing/payment-methods', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer mk_test_key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /v1/billing/quota', () => {
    it('returns quota status', async () => {
      await updateUserBilling('user_001', {
        hasPaymentMethod: false,
        totalTokensUsed: BigInt(7_000_000),
        billingStatus: 'free',
      });

      const res = await app.request('/v1/billing/quota', {
        headers: {
          'Authorization': 'Bearer mk_test_key',
        },
      });

      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.status).toBe('free');
      expect(data.tokens_used).toBe(7_000_000);
      expect(data.tokens_remaining).toBe(3_000_000);
      expect(data.percent_used).toBe(70);
    });
  });

  describe('POST /v1/billing/setup-intent', () => {
    it('returns setup intent for card collection', async () => {
      const res = await app.request('/v1/billing/setup-intent', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer mk_test_key',
        },
      });

      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.client_secret).toBeDefined();
      expect(data.stripe_publishable_key).toBeDefined();
    });
  });

  describe('GET /v1/billing/invoices', () => {
    it('returns invoice history for paid user', async () => {
      await updateUserBilling('user_002', {
        hasPaymentMethod: true,
        billingStatus: 'active',
      });

      const res = await app.request('/v1/billing/invoices', {
        headers: {
          'Authorization': 'Bearer mk_user2_project',
        },
      });

      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.invoices).toBeDefined();
      expect(data.total_count).toBeDefined();
    });

    it('returns empty for free user', async () => {
      await updateUserBilling('user_001', {
        hasPaymentMethod: false,
        billingStatus: 'free',
      });

      const res = await app.request('/v1/billing/invoices', {
        headers: {
          'Authorization': 'Bearer mk_test_key',
        },
      });

      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.invoices).toHaveLength(0);
    });
  });
});

describe('Stripe Webhook Integration', () => {
  const app = createTestApp();

  function createWebhookEvent(type: string, data: object) {
    return {
      id: `evt_test_${Date.now()}`,
      type,
      data: {
        object: data,
      },
    };
  }

  describe('POST /webhooks/stripe', () => {
    it('handles invoice.paid webhook', async () => {
      const event = createWebhookEvent('invoice.paid', {
        id: 'inv_test_123',
        customer: 'cus_test123',
        amount_paid: 1000,
        status: 'paid',
      });

      const res = await app.request('/webhooks/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'test_signature',
        },
        body: JSON.stringify(event),
      });

      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.received).toBe(true);
    });

    it('handles invoice.payment_failed webhook', async () => {
      const event = createWebhookEvent('invoice.payment_failed', {
        id: 'inv_test_456',
        customer: 'cus_test123',
        amount_due: 1000,
        status: 'open',
      });

      const res = await app.request('/webhooks/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'test_signature',
        },
        body: JSON.stringify(event),
      });

      expect(res.status).toBe(200);
    });

    it('handles customer.subscription.deleted webhook', async () => {
      const event = createWebhookEvent('customer.subscription.deleted', {
        id: 'sub_test_123',
        customer: 'cus_test123',
        status: 'canceled',
      });

      const res = await app.request('/webhooks/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'test_signature',
        },
        body: JSON.stringify(event),
      });

      expect(res.status).toBe(200);
    });

    it('handles payment_method.attached webhook', async () => {
      const event = createWebhookEvent('payment_method.attached', {
        id: 'pm_test_789',
        customer: 'cus_test123',
        card: {
          brand: 'visa',
          last4: '4242',
          exp_month: 12,
          exp_year: 2028,
        },
      });

      const res = await app.request('/webhooks/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'test_signature',
        },
        body: JSON.stringify(event),
      });

      expect(res.status).toBe(200);
    });

    it('rejects invalid event format', async () => {
      const res = await app.request('/webhooks/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'test_signature',
        },
        body: JSON.stringify({ invalid: 'format' }),
      });

      expect(res.status).toBe(400);
    });

    it('handles idempotency - same event twice', async () => {
      const eventId = `evt_idempotency_${Date.now()}`;
      const event = {
        id: eventId,
        type: 'invoice.paid',
        data: {
          object: {
            id: 'inv_test',
            customer: 'cus_test123',
            amount_paid: 500,
            status: 'paid',
          },
        },
      };

      // First request
      const res1 = await app.request('/webhooks/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'test_signature',
        },
        body: JSON.stringify(event),
      });

      expect(res1.status).toBe(200);

      // Second request with same event ID
      const res2 = await app.request('/webhooks/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'test_signature',
        },
        body: JSON.stringify(event),
      });

      expect(res2.status).toBe(200);
      const data = await res2.json();
      expect(data.message).toBe('Event already processed');
    });
  });
});

describe('Quota Check Middleware Integration', () => {
  it('blocks requests when free tier exhausted', async () => {
    const app = new Hono();
    
    app.use('*', authMiddleware);
    app.use('*', quotaCheckMiddleware);
    app.get('/test', (c) => c.json({ message: 'ok' }));
    
    // Set user to exhausted free tier
    await updateUserBilling('user_001', {
      hasPaymentMethod: false,
      totalTokensUsed: BigInt(PRICING.FREE_TIER_TOKENS + 1),
      billingStatus: 'free',
    });

    const res = await app.request('/test', {
      headers: {
        'Authorization': 'Bearer mk_test_key',
      },
    });

    expect(res.status).toBe(402);
    
    const data = await res.json();
    expect(data.error.code).toBe('FREE_TIER_EXHAUSTED');
    expect(data.error.action.type).toBe('add_payment_method');
  });

  it('allows requests for paid users over free tier', async () => {
    const app = new Hono();
    
    app.use('*', authMiddleware);
    app.use('*', quotaCheckMiddleware);
    app.get('/test', (c) => c.json({ message: 'ok' }));
    
    await updateUserBilling('user_002', {
      hasPaymentMethod: true,
      totalTokensUsed: BigInt(50_000_000),
      billingStatus: 'active',
    });

    const res = await app.request('/test', {
      headers: {
        'Authorization': 'Bearer mk_user2_project',
      },
    });

    expect(res.status).toBe(200);
  });

  it('adds quota headers to response', async () => {
    const app = new Hono();
    
    app.use('*', authMiddleware);
    app.use('*', quotaCheckMiddleware);
    app.get('/test', (c) => c.json({ message: 'ok' }));
    
    await updateUserBilling('user_001', {
      hasPaymentMethod: false,
      totalTokensUsed: BigInt(5_000_000),
      billingStatus: 'free',
    });

    const res = await app.request('/test', {
      headers: {
        'Authorization': 'Bearer mk_test_key',
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-MemoryRouter-Quota-Used')).toBeDefined();
    expect(res.headers.get('X-MemoryRouter-Quota-Remaining')).toBeDefined();
  });

  it('adds warning headers during grace period', async () => {
    const app = new Hono();
    
    app.use('*', authMiddleware);
    app.use('*', quotaCheckMiddleware);
    app.get('/test', (c) => c.json({ message: 'ok' }));
    
    const gracePeriodEnd = new Date();
    gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 5);
    
    await updateUserBilling('user_001', {
      hasPaymentMethod: true,
      totalTokensUsed: BigInt(50_000_000),
      billingStatus: 'grace_period',
      gracePeriodEndsAt: gracePeriodEnd,
    });

    const res = await app.request('/test', {
      headers: {
        'Authorization': 'Bearer mk_test_key',
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Billing-Warning')).toBeDefined();
    expect(res.headers.get('X-Grace-Period-Ends')).toBeDefined();
  });
});
