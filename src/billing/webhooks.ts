/**
 * Stripe Webhook Handlers
 * 
 * Handles all Stripe webhook events with idempotency.
 * 
 * Reference: memoryrouter-stripe-spec.md Section 6
 */

import { Hono } from 'hono';
import {
  isEventProcessed,
  logStripeEvent,
  markEventProcessed,
  updateUserBilling,
  startGracePeriod,
  suspendAccount,
  restoreAccount,
  getUserBilling,
} from './service';

// =============================================================================
// TYPES
// =============================================================================

interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
    previous_attributes?: Record<string, unknown>;
  };
}

interface StripeCustomer {
  id: string;
  email?: string;
}

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  current_period_start: number;
  current_period_end: number;
  items?: {
    data: Array<{ id: string }>;
  };
}

interface StripeInvoice {
  id: string;
  customer: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  status: string;
  period_start?: number;
  period_end?: number;
  due_date?: number;
  hosted_invoice_url?: string;
  invoice_pdf?: string;
}

interface StripePaymentMethod {
  id: string;
  customer: string;
  card?: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
  };
}

// =============================================================================
// STUB: User lookup by Stripe customer ID
// =============================================================================

/**
 * Find user by Stripe customer ID
 * In production: Query users table WHERE stripe_customer_id = $1
 */
async function findUserByStripeCustomer(customerId: string): Promise<{ userId: string } | null> {
  // STUB: In production, query database
  // For now, use a simple mapping
  const STUB_CUSTOMER_MAP: Record<string, string> = {
    'cus_test123': 'user_002',
  };
  
  const userId = STUB_CUSTOMER_MAP[customerId];
  return userId ? { userId } : null;
}

/**
 * Find user by email
 * In production: Query users table WHERE email = $1
 */
async function findUserByEmail(email: string): Promise<{ userId: string } | null> {
  // STUB
  const STUB_EMAIL_MAP: Record<string, string> = {
    'test@example.com': 'user_001',
    'paid@example.com': 'user_002',
  };
  
  const userId = STUB_EMAIL_MAP[email];
  return userId ? { userId } : null;
}

// =============================================================================
// WEBHOOK HANDLER REGISTRY
// =============================================================================

type WebhookHandler = (event: StripeWebhookEvent) => Promise<void>;

const webhookHandlers: Record<string, WebhookHandler> = {
  'customer.created': handleCustomerCreated,
  'customer.updated': handleCustomerUpdated,
  'customer.subscription.created': handleSubscriptionCreated,
  'customer.subscription.updated': handleSubscriptionUpdated,
  'customer.subscription.deleted': handleSubscriptionDeleted,
  'invoice.created': handleInvoiceCreated,
  'invoice.paid': handleInvoicePaid,
  'invoice.payment_failed': handleInvoicePaymentFailed,
  'payment_method.attached': handlePaymentMethodAttached,
  'payment_method.detached': handlePaymentMethodDetached,
};

// =============================================================================
// EVENT HANDLERS
// =============================================================================

/**
 * customer.created
 * Create Stripe customer ID mapping
 */
async function handleCustomerCreated(event: StripeWebhookEvent): Promise<void> {
  const customer = event.data.object as unknown as StripeCustomer;
  
  if (!customer.email) {
    console.log('[WEBHOOK] customer.created: No email, skipping');
    return;
  }
  
  const user = await findUserByEmail(customer.email);
  if (!user) {
    console.log(`[WEBHOOK] customer.created: No user found for email ${customer.email}`);
    return;
  }
  
  await updateUserBilling(user.userId, {
    stripeCustomerId: customer.id,
  });
  
  console.log(`[WEBHOOK] customer.created: Linked ${customer.id} to user ${user.userId}`);
}

/**
 * customer.updated
 * Handle email or payment method changes
 */
async function handleCustomerUpdated(event: StripeWebhookEvent): Promise<void> {
  const customer = event.data.object as unknown as StripeCustomer;
  const previousAttributes = event.data.previous_attributes;
  
  const user = await findUserByStripeCustomer(customer.id);
  if (!user) {
    console.log(`[WEBHOOK] customer.updated: No user for customer ${customer.id}`);
    return;
  }
  
  // Update email if changed
  if (previousAttributes?.email && customer.email) {
    await updateUserBilling(user.userId, {
      billingEmail: customer.email,
    });
    console.log(`[WEBHOOK] customer.updated: Updated email for user ${user.userId}`);
  }
}

/**
 * customer.subscription.created
 * New subscription created
 */
async function handleSubscriptionCreated(event: StripeWebhookEvent): Promise<void> {
  const subscription = event.data.object as unknown as StripeSubscription;
  
  const user = await findUserByStripeCustomer(subscription.customer);
  if (!user) {
    console.log(`[WEBHOOK] subscription.created: No user for customer ${subscription.customer}`);
    return;
  }
  
  await updateUserBilling(user.userId, {
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    billingStatus: 'active',
  });
  
  console.log(`[WEBHOOK] subscription.created: Subscription ${subscription.id} for user ${user.userId}`);
}

/**
 * customer.subscription.updated
 * Handle status changes, period changes
 */
async function handleSubscriptionUpdated(event: StripeWebhookEvent): Promise<void> {
  const subscription = event.data.object as unknown as StripeSubscription;
  const previousAttributes = event.data.previous_attributes;
  
  const user = await findUserByStripeCustomer(subscription.customer);
  if (!user) {
    console.log(`[WEBHOOK] subscription.updated: No user for customer ${subscription.customer}`);
    return;
  }
  
  // Update subscription status
  await updateUserBilling(user.userId, {
    stripeSubscriptionStatus: subscription.status,
  });
  
  // Handle status transitions
  const previousStatus = previousAttributes?.status as string | undefined;
  
  if (previousStatus && previousStatus !== subscription.status) {
    if (subscription.status === 'past_due') {
      // Payment failed, start grace period
      await startGracePeriod(user.userId);
      console.log(`[WEBHOOK] subscription.updated: Started grace period for user ${user.userId}`);
    } else if (subscription.status === 'active' && previousStatus === 'past_due') {
      // Payment recovered
      await restoreAccount(user.userId);
      console.log(`[WEBHOOK] subscription.updated: Restored account for user ${user.userId}`);
    } else if (subscription.status === 'canceled') {
      // Subscription canceled
      await updateUserBilling(user.userId, {
        billingStatus: 'free',
        stripeSubscriptionId: undefined,
      });
      console.log(`[WEBHOOK] subscription.updated: Subscription canceled for user ${user.userId}`);
    }
  }
}

/**
 * customer.subscription.deleted
 * Subscription ended/canceled
 */
async function handleSubscriptionDeleted(event: StripeWebhookEvent): Promise<void> {
  const subscription = event.data.object as unknown as StripeSubscription;
  
  const user = await findUserByStripeCustomer(subscription.customer);
  if (!user) {
    return;
  }
  
  await updateUserBilling(user.userId, {
    stripeSubscriptionId: undefined,
    stripeSubscriptionStatus: 'canceled',
    billingStatus: 'free',
  });
  
  console.log(`[WEBHOOK] subscription.deleted: Subscription ended for user ${user.userId}`);
}

/**
 * invoice.created
 * New invoice created
 */
async function handleInvoiceCreated(event: StripeWebhookEvent): Promise<void> {
  const invoice = event.data.object as unknown as StripeInvoice;
  
  const user = await findUserByStripeCustomer(invoice.customer);
  if (!user) {
    return;
  }
  
  // STUB: In production, upsert to invoices table
  console.log(`[WEBHOOK] invoice.created: Invoice ${invoice.id} for user ${user.userId}, amount $${invoice.amount_due / 100}`);
}

/**
 * invoice.paid
 * Invoice successfully paid
 */
async function handleInvoicePaid(event: StripeWebhookEvent): Promise<void> {
  const invoice = event.data.object as unknown as StripeInvoice;
  
  const user = await findUserByStripeCustomer(invoice.customer);
  if (!user) {
    return;
  }
  
  // Ensure user is active
  await updateUserBilling(user.userId, {
    billingStatus: 'active',
    gracePeriodEndsAt: undefined,
  });
  
  // STUB: In production, update invoices table
  console.log(`[WEBHOOK] invoice.paid: Invoice ${invoice.id} paid for user ${user.userId}`);
}

/**
 * invoice.payment_failed
 * Payment attempt failed
 */
async function handleInvoicePaymentFailed(event: StripeWebhookEvent): Promise<void> {
  const invoice = event.data.object as unknown as StripeInvoice;
  
  const user = await findUserByStripeCustomer(invoice.customer);
  if (!user) {
    return;
  }
  
  const billing = await getUserBilling(user.userId);
  
  if (billing?.billingStatus === 'active') {
    // First failure - start grace period
    await startGracePeriod(user.userId);
    console.log(`[WEBHOOK] invoice.payment_failed: Started grace period for user ${user.userId}`);
  } else if (billing?.billingStatus === 'grace_period') {
    // Check if grace period expired
    if (billing.gracePeriodEndsAt && new Date() > billing.gracePeriodEndsAt) {
      await suspendAccount(user.userId);
      console.log(`[WEBHOOK] invoice.payment_failed: Suspended account for user ${user.userId}`);
    } else {
      console.log(`[WEBHOOK] invoice.payment_failed: User ${user.userId} still in grace period`);
    }
  }
}

/**
 * payment_method.attached
 * Payment method added to customer
 */
async function handlePaymentMethodAttached(event: StripeWebhookEvent): Promise<void> {
  const paymentMethod = event.data.object as unknown as StripePaymentMethod;
  
  const user = await findUserByStripeCustomer(paymentMethod.customer);
  if (!user) {
    return;
  }
  
  // Update user flags
  await updateUserBilling(user.userId, {
    hasPaymentMethod: true,
  });
  
  // If user was on free tier and exhausted, transition to paid
  const billing = await getUserBilling(user.userId);
  if (billing?.billingStatus === 'free' && billing.totalTokensUsed >= BigInt(50_000_000)) {
    await updateUserBilling(user.userId, {
      billingStatus: 'active',
    });
    console.log(`[WEBHOOK] payment_method.attached: Transitioned user ${user.userId} to paid`);
  }
  
  console.log(`[WEBHOOK] payment_method.attached: PM ${paymentMethod.id} for user ${user.userId}`);
}

/**
 * payment_method.detached
 * Payment method removed
 */
async function handlePaymentMethodDetached(event: StripeWebhookEvent): Promise<void> {
  const paymentMethod = event.data.object as unknown as StripePaymentMethod;
  
  // Note: Customer ID might not be set on detached event
  // In production, look up by payment method ID in our cache
  console.log(`[WEBHOOK] payment_method.detached: PM ${paymentMethod.id} removed`);
}

// =============================================================================
// MAIN WEBHOOK PROCESSOR
// =============================================================================

/**
 * Process a Stripe webhook event
 */
async function processStripeEvent(event: StripeWebhookEvent): Promise<{ processed: boolean }> {
  // Idempotency check
  if (await isEventProcessed(event.id)) {
    return { processed: false };
  }
  
  // Log event
  await logStripeEvent(event.id, event.type, event.data);
  
  // Find handler
  const handler = webhookHandlers[event.type];
  
  if (!handler) {
    console.log(`[WEBHOOK] Unhandled event type: ${event.type}`);
    await markEventProcessed(event.id);
    return { processed: true };
  }
  
  try {
    await handler(event);
    await markEventProcessed(event.id);
    return { processed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await markEventProcessed(event.id, message);
    throw error;
  }
}

// =============================================================================
// WEBHOOK ROUTES
// =============================================================================

const webhookRoutes = new Hono();

/**
 * POST /webhooks/stripe
 * Main webhook endpoint
 */
webhookRoutes.post('/stripe', async (c) => {
  // Get signature header (for verification in production)
  const signature = c.req.header('stripe-signature');
  
  if (!signature) {
    console.log('[WEBHOOK] Warning: No Stripe signature header');
    // In production, reject without signature
  }
  
  try {
    // Parse event
    // In production, use stripe.webhooks.constructEvent for verification
    const event = await c.req.json() as StripeWebhookEvent;
    
    if (!event.id || !event.type) {
      return c.json({ error: 'Invalid event format' }, 400);
    }
    
    // Process event
    const result = await processStripeEvent(event);
    
    if (!result.processed) {
      return c.json({ message: 'Event already processed' }, 200);
    }
    
    return c.json({ received: true }, 200);
  } catch (error) {
    console.error('[WEBHOOK] Error processing event:', error);
    
    // Return 200 to prevent retries for non-retryable errors
    // In production, analyze error type to determine appropriate response
    return c.json({ 
      error: 'Processing failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 200);
  }
});

export default webhookRoutes;
export { processStripeEvent };
