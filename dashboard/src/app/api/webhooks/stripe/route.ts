import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

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

      console.log(`✅ Payment completed: $${amount} for user ${userId} (${email})`);
      console.log(`   Session ID: ${session.id}`);
      console.log(`   Payment Intent: ${session.payment_intent}`);

      // TODO: Add credits to user's balance in database
      // await db.insert(transactions).values({
      //   userId,
      //   type: 'credit',
      //   amountCents: Math.round(amount * 100),
      //   description: `Added $${amount.toFixed(2)} credits`,
      //   stripeSessionId: session.id,
      // });
      // 
      // await db.update(users)
      //   .set({ creditBalanceCents: sql`credit_balance_cents + ${Math.round(amount * 100)}` })
      //   .where(eq(users.id, userId));

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

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}
