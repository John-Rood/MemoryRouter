import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { updateBilling } from "@/lib/api/workers-client";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const WORKERS_API_URL = process.env.WORKERS_API_URL || "https://api.memoryrouter.ai";
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY;

/**
 * Credit user balance via Workers API
 */
async function creditUserBalance(
  userId: string,
  amountCents: number,
  description: string,
  stripePaymentIntentId?: string
): Promise<{ success: boolean; newBalanceCents?: number; error?: string }> {
  if (!DASHBOARD_API_KEY) {
    console.error("[STRIPE-WEBHOOK] DASHBOARD_API_KEY not configured");
    return { success: false, error: "API key not configured" };
  }

  try {
    const response = await fetch(`${WORKERS_API_URL}/api/users/${userId}/credit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dashboard-Key": DASHBOARD_API_KEY,
      },
      body: JSON.stringify({
        amountCents,
        description,
        stripePaymentIntentId,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[STRIPE-WEBHOOK] Workers API error: ${response.status} - ${error}`);
      return { success: false, error: `Workers API error: ${response.status}` };
    }

    const result = await response.json() as { success: boolean; newBalanceCents: number };
    return { success: true, newBalanceCents: result.newBalanceCents };
  } catch (error) {
    console.error("[STRIPE-WEBHOOK] Failed to call Workers API:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    // If webhook secret is configured, verify the signature
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } else {
      // For development without webhook secret
      event = JSON.parse(body) as Stripe.Event;
      console.warn("⚠️ Webhook signature verification skipped - STRIPE_WEBHOOK_SECRET not set");
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`Webhook signature verification failed: ${errorMessage}`);
    return NextResponse.json(
      { error: "Webhook signature verification failed" },
      { status: 400 }
    );
  }

  // Handle the event
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const email = session.metadata?.email;
      const amount = parseFloat(session.metadata?.amount || "0");
      const amountCents = Math.round(amount * 100);
      const paymentIntentId = typeof session.payment_intent === "string" 
        ? session.payment_intent 
        : session.payment_intent?.id;

      console.log(`✅ Payment completed: $${amount} for user ${userId} (${email})`);
      console.log(`   Session ID: ${session.id}`);
      console.log(`   Payment Intent: ${paymentIntentId}`);

      if (!userId) {
        console.error("[STRIPE-WEBHOOK] No userId in session metadata");
        break;
      }

      // Credit user's balance via Workers API
      const result = await creditUserBalance(
        userId,
        amountCents,
        `Added $${amount.toFixed(2)} credits`,
        paymentIntentId
      );

      if (result.success) {
        console.log(`✅ Credited ${amountCents} cents to user ${userId}. New balance: ${result.newBalanceCents} cents`);
      } else {
        console.error(`❌ Failed to credit user ${userId}: ${result.error}`);
        // Note: We still return 200 to Stripe to prevent retries
        // The credit can be reconciled manually if needed
      }

      break;
    }

    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(`⏰ Checkout session expired: ${session.id}`);
      break;
    }

    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      console.log(`❌ Payment failed: ${paymentIntent.id}`);
      console.log(`   Error: ${paymentIntent.last_payment_error?.message}`);
      break;
    }

    case "setup_intent.succeeded": {
      // User saved a payment method via setup mode checkout
      const setupIntent = event.data.object as Stripe.SetupIntent;
      const customerId = typeof setupIntent.customer === "string"
        ? setupIntent.customer
        : setupIntent.customer?.id;
      
      console.log(`💳 Setup intent succeeded: ${setupIntent.id}`);
      console.log(`   Customer: ${customerId}`);
      console.log(`   Payment Method: ${setupIntent.payment_method}`);

      if (customerId) {
        // Get user ID from customer metadata
        try {
          const customer = await stripe.customers.retrieve(customerId);
          if (customer && !customer.deleted && customer.metadata?.userId) {
            const userId = customer.metadata.userId;
            
            // Set this payment method as default for the customer
            if (setupIntent.payment_method) {
              const paymentMethodId = typeof setupIntent.payment_method === "string"
                ? setupIntent.payment_method
                : setupIntent.payment_method.id;
              
              await stripe.customers.update(customerId, {
                invoice_settings: {
                  default_payment_method: paymentMethodId,
                },
              });
            }
            
            // Update hasPaymentMethod in database
            await updateBilling(userId, {
              hasPaymentMethod: true,
            });
            console.log(`✅ Updated hasPaymentMethod=true for user ${userId}`);
          }
        } catch (error) {
          console.error(`Failed to update payment method status:`, error);
        }
      }
      break;
    }

    case "payment_method.attached": {
      // Payment method attached to a customer (from checkout with setup_future_usage)
      const paymentMethod = event.data.object as Stripe.PaymentMethod;
      const customerId = typeof paymentMethod.customer === "string"
        ? paymentMethod.customer
        : paymentMethod.customer?.id;
      
      console.log(`💳 Payment method attached: ${paymentMethod.id}`);
      console.log(`   Customer: ${customerId}`);
      console.log(`   Type: ${paymentMethod.type}`);

      if (customerId && paymentMethod.type === "card") {
        try {
          const customer = await stripe.customers.retrieve(customerId);
          if (customer && !customer.deleted && customer.metadata?.userId) {
            const userId = customer.metadata.userId;
            
            // Set as default payment method
            await stripe.customers.update(customerId, {
              invoice_settings: {
                default_payment_method: paymentMethod.id,
              },
            });
            
            // Update hasPaymentMethod in database
            await updateBilling(userId, {
              hasPaymentMethod: true,
            });
            console.log(`✅ Updated hasPaymentMethod=true for user ${userId}`);
          }
        } catch (error) {
          console.error(`Failed to update payment method status:`, error);
        }
      }
      break;
    }

    case "payment_method.detached": {
      // Payment method removed from a customer
      const paymentMethod = event.data.object as Stripe.PaymentMethod;
      // Note: customer field is null after detachment, we get it from previous_attributes
      const previousCustomerId = (event.data as { previous_attributes?: { customer?: string } }).previous_attributes?.customer;
      
      console.log(`💳 Payment method detached: ${paymentMethod.id}`);
      console.log(`   Previous customer: ${previousCustomerId}`);

      if (previousCustomerId) {
        try {
          // Check if customer has any remaining payment methods
          const paymentMethods = await stripe.paymentMethods.list({
            customer: previousCustomerId,
            type: "card",
            limit: 1,
          });

          const customer = await stripe.customers.retrieve(previousCustomerId);
          if (customer && !customer.deleted && customer.metadata?.userId) {
            const userId = customer.metadata.userId;
            const hasRemainingMethods = paymentMethods.data.length > 0;

            if (!hasRemainingMethods) {
              // No payment methods left — update database
              await updateBilling(userId, {
                hasPaymentMethod: false,
              });
              console.log(`⚠️ Updated hasPaymentMethod=false for user ${userId} (no cards remaining)`);
            } else {
              console.log(`✅ User ${userId} still has ${paymentMethods.data.length} payment methods`);
            }
          }
        } catch (error) {
          console.error(`Failed to check remaining payment methods:`, error);
        }
      }
      break;
    }

    case "customer.deleted": {
      // Customer was deleted in Stripe
      const customer = event.data.object as Stripe.Customer;
      const userId = customer.metadata?.userId;
      
      console.log(`🗑️ Customer deleted: ${customer.id}`);

      if (userId) {
        try {
          await updateBilling(userId, {
            hasPaymentMethod: false,
          });
          console.log(`⚠️ Updated hasPaymentMethod=false for user ${userId} (customer deleted)`);
        } catch (error) {
          console.error(`Failed to update billing for deleted customer:`, error);
        }
      }
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}
