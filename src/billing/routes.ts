/**
 * Billing API Routes
 * 
 * RESTful endpoints for billing management.
 * All routes require authentication.
 * 
 * Reference: memoryrouter-stripe-spec.md Section 5
 */

import { Hono } from 'hono';
import { getUserContext } from '../middleware/auth';
import {
  getBillingOverview,
  getUsageDetails,
  getPaymentMethods,
  getInvoices,
  transitionToPaid,
  updateUserBilling,
  getUserBilling,
} from './service';
import { PRICING } from './types';

// =============================================================================
// ROUTES
// =============================================================================

const billingRoutes = new Hono();

/**
 * GET /v1/billing
 * Get billing overview
 */
billingRoutes.get('/', async (c) => {
  const userContext = getUserContext(c);
  const overview = await getBillingOverview(userContext.userId);
  return c.json(overview);
});

/**
 * GET /v1/billing/usage
 * Get detailed usage breakdown
 */
billingRoutes.get('/usage', async (c) => {
  const userContext = getUserContext(c);
  
  // Parse query params
  const startDate = c.req.query('start_date') ?? getDefaultStartDate();
  const endDate = c.req.query('end_date') ?? getDefaultEndDate();
  const granularity = (c.req.query('granularity') as 'hourly' | 'daily' | 'monthly') ?? 'daily';
  const memoryKey = c.req.query('memory_key');
  
  const usage = await getUsageDetails(
    userContext.userId,
    startDate,
    endDate,
    granularity,
    memoryKey
  );
  
  return c.json(usage);
});

/**
 * GET /v1/billing/payment-methods
 * List payment methods
 */
billingRoutes.get('/payment-methods', async (c) => {
  const userContext = getUserContext(c);
  const methods = await getPaymentMethods(userContext.userId);
  return c.json(methods);
});

/**
 * POST /v1/billing/payment-methods
 * Add a payment method
 */
billingRoutes.post('/payment-methods', async (c) => {
  const userContext = getUserContext(c);
  
  const body = await c.req.json<{
    payment_method_id: string;
    set_default?: boolean;
  }>();
  
  if (!body.payment_method_id) {
    return c.json({
      error: {
        type: 'invalid_request',
        message: 'payment_method_id is required',
      },
    }, 400);
  }
  
  // Check if this is a free tier user transitioning to paid
  const billing = await getUserBilling(userContext.userId);
  const needsSubscription = billing && 
    billing.billingStatus === 'free' && 
    billing.totalTokensUsed >= BigInt(PRICING.FREE_TIER_TOKENS);
  
  if (needsSubscription) {
    // Create subscription
    const result = await transitionToPaid(userContext.userId, body.payment_method_id);
    
    if (!result.success) {
      return c.json({
        error: {
          type: 'payment_error',
          message: result.error ?? 'Failed to create subscription',
        },
      }, 400);
    }
  } else {
    // Just add the payment method
    await updateUserBilling(userContext.userId, {
      hasPaymentMethod: true,
    });
  }
  
  // Return updated payment method info
  const methods = await getPaymentMethods(userContext.userId);
  const newMethod = methods.payment_methods.find(m => m.id === body.payment_method_id) ?? {
    id: body.payment_method_id,
    brand: 'visa',
    last4: '4242',
    is_default: body.set_default ?? false,
  };
  
  return c.json({
    success: true,
    payment_method: newMethod,
    billing_status: needsSubscription ? 'active' : (billing?.billingStatus ?? 'free'),
  });
});

/**
 * DELETE /v1/billing/payment-methods/:id
 * Remove a payment method
 */
billingRoutes.delete('/payment-methods/:id', async (c) => {
  const userContext = getUserContext(c);
  const paymentMethodId = c.req.param('id');
  
  // STUB: In production:
  // 1. stripe.paymentMethods.detach(paymentMethodId)
  // 2. Check if user has any remaining payment methods
  // 3. Update hasPaymentMethod flag
  
  console.log(`[BILLING] Removing payment method ${paymentMethodId} for user ${userContext.userId}`);
  
  // Check remaining payment methods
  const methods = await getPaymentMethods(userContext.userId);
  const remaining = methods.payment_methods.filter(m => m.id !== paymentMethodId);
  
  if (remaining.length === 0) {
    await updateUserBilling(userContext.userId, {
      hasPaymentMethod: false,
    });
  }
  
  return c.json({
    success: true,
    warning: remaining.length === 0 
      ? 'You have no payment methods. Service will be suspended when you exceed the free tier.'
      : undefined,
  });
});

/**
 * POST /v1/billing/setup-intent
 * Create a Stripe SetupIntent for adding cards
 */
billingRoutes.post('/setup-intent', async (c) => {
  const userContext = getUserContext(c);
  
  // STUB: In production:
  // 1. Get or create Stripe customer
  // 2. const setupIntent = await stripe.setupIntents.create({
  //      customer: stripeCustomerId,
  //      payment_method_types: ['card'],
  //    });
  
  console.log(`[BILLING] Creating setup intent for user ${userContext.userId}`);
  
  // Return stub data
  // In production, return real client_secret from Stripe
  return c.json({
    client_secret: `seti_stub_${Date.now()}_secret_stub`,
    stripe_publishable_key: process.env.STRIPE_PUBLISHABLE_KEY ?? 'pk_test_stub',
  });
});

/**
 * GET /v1/billing/invoices
 * List invoice history
 */
billingRoutes.get('/invoices', async (c) => {
  const userContext = getUserContext(c);
  
  const limit = parseInt(c.req.query('limit') ?? '10', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const status = c.req.query('status');
  
  const invoices = await getInvoices(
    userContext.userId,
    limit,
    offset,
    status
  );
  
  return c.json(invoices);
});

/**
 * GET /v1/billing/invoices/:id
 * Get single invoice details
 */
billingRoutes.get('/invoices/:id', async (c) => {
  const userContext = getUserContext(c);
  const invoiceId = c.req.param('id');
  
  // STUB: In production, query invoices table
  const invoices = await getInvoices(userContext.userId, 100, 0);
  const invoice = invoices.invoices.find(inv => inv.id === invoiceId);
  
  if (!invoice) {
    return c.json({
      error: {
        type: 'not_found',
        message: 'Invoice not found',
      },
    }, 404);
  }
  
  return c.json({
    ...invoice,
    line_items: [
      {
        description: `Memory Tokens (${(invoice.tokens_billed ?? 0) / 1_000_000}M @ $0.50/M)`,
        quantity: invoice.tokens_billed ?? 0,
        unit_amount_usd: 0.000001,
        total_usd: invoice.amount_usd,
      },
    ],
  });
});

/**
 * POST /v1/billing/portal-session
 * Create a Stripe Customer Portal session
 */
billingRoutes.post('/portal-session', async (c) => {
  const userContext = getUserContext(c);
  
  const billing = await getUserBilling(userContext.userId);
  
  if (!billing?.stripeCustomerId) {
    return c.json({
      error: {
        type: 'not_found',
        message: 'No billing account found. Add a payment method first.',
      },
    }, 400);
  }
  
  // STUB: In production:
  // const session = await stripe.billingPortal.sessions.create({
  //   customer: billing.stripeCustomerId,
  //   return_url: 'https://memoryrouter.ai/billing',
  // });
  
  console.log(`[BILLING] Creating portal session for user ${userContext.userId}`);
  
  return c.json({
    url: `https://billing.stripe.com/session/stub_${Date.now()}`,
  });
});

/**
 * GET /v1/billing/quota
 * Get current quota status (lightweight check)
 */
billingRoutes.get('/quota', async (c) => {
  const userContext = getUserContext(c);
  const billing = await getUserBilling(userContext.userId);
  
  if (!billing) {
    return c.json({
      status: 'free',
      tokens_used: 0,
      tokens_remaining: PRICING.FREE_TIER_TOKENS,
      percent_used: 0,
      free_tier: {
        limit: PRICING.FREE_TIER_TOKENS,
        exhausted: false,
      },
    });
  }
  
  const tokensUsed = Number(billing.totalTokensUsed);
  const remaining = billing.hasPaymentMethod 
    ? Infinity 
    : Math.max(0, PRICING.FREE_TIER_TOKENS - tokensUsed);
  
  return c.json({
    status: billing.billingStatus,
    tokens_used: tokensUsed,
    tokens_remaining: remaining,
    percent_used: Math.min(100, (tokensUsed / PRICING.FREE_TIER_TOKENS) * 100),
    free_tier: {
      limit: PRICING.FREE_TIER_TOKENS,
      exhausted: !billing.hasPaymentMethod && tokensUsed >= PRICING.FREE_TIER_TOKENS,
    },
    has_payment_method: billing.hasPaymentMethod,
  });
});

// =============================================================================
// HELPERS
// =============================================================================

function getDefaultStartDate(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
}

function getDefaultEndDate(): string {
  return new Date().toISOString().split('T')[0];
}

export default billingRoutes;
