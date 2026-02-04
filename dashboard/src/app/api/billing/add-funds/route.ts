import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import Stripe from "stripe";
import { verifyToken } from "@/lib/auth/jwt";
import { getBilling, updateBilling } from "@/lib/api/workers-client";

// Initialize Stripe lazily to avoid build-time issues
function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  return new Stripe(key);
}

/**
 * Create or retrieve a Stripe Customer for the user
 */
async function getOrCreateStripeCustomer(
  userId: string,
  email: string
): Promise<string> {
  const stripe = getStripe();
  
  // Check if user already has a Stripe customer ID
  console.log(`[add-funds] Getting billing for user ${userId}`);
  const { billing } = await getBilling(userId);
  console.log(`[add-funds] Got billing, stripe_customer_id: ${billing.stripe_customer_id}`);
  
  if (billing.stripe_customer_id) {
    // Verify the customer still exists in Stripe
    try {
      await stripe.customers.retrieve(billing.stripe_customer_id);
      console.log(`[add-funds] Existing customer valid: ${billing.stripe_customer_id}`);
      return billing.stripe_customer_id;
    } catch {
      // Customer was deleted, create a new one
      console.log(`[add-funds] Stripe customer ${billing.stripe_customer_id} not found, creating new one`);
    }
  }
  
  // Create new Stripe customer
  console.log(`[add-funds] Creating new Stripe customer for ${email}`);
  const customer = await stripe.customers.create({
    email,
    metadata: {
      userId,
    },
  });
  console.log(`[add-funds] Created customer: ${customer.id}`);
  
  // Save customer ID to database
  await updateBilling(userId, {
    stripeCustomerId: customer.id,
  });
  console.log(`[add-funds] Saved customer ID to database`);
  
  return customer.id;
}

export async function POST(request: NextRequest) {
  console.log(`[add-funds] POST request received`);
  
  try {
    const stripe = getStripe();
    
    // Get user from session
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("mr_session")?.value;
    
    if (!accessToken) {
      console.log(`[add-funds] No access token`);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    const payload = await verifyToken(accessToken);
    if (!payload) {
      console.log(`[add-funds] Invalid token`);
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }
    
    console.log(`[add-funds] User: ${payload.userId}, email: ${payload.email}`);
    
    const { amount } = await request.json();
    console.log(`[add-funds] Amount requested: ${amount}`);
    
    // Validate amount
    if (!amount || typeof amount !== "number" || amount < 5) {
      return NextResponse.json({ error: "Minimum amount is $5" }, { status: 400 });
    }
    
    if (amount > 10000) {
      return NextResponse.json({ error: "Maximum amount is $10,000" }, { status: 400 });
    }
    
    // Get or create Stripe customer (so we can save their card for auto-reup)
    const customerId = await getOrCreateStripeCustomer(
      payload.userId,
      payload.email || ""
    );
    
    console.log(`[add-funds] Got customerId: ${customerId}`);
    
    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "MemoryRouter Credits",
              description: `$${amount.toFixed(2)} in API credits`,
            },
            unit_amount: Math.round(amount * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        statement_descriptor: "MEMORYROUTER",
        // Save the card for future use (auto-reup)
        setup_future_usage: "off_session",
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing?success=true&amount=${amount}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing?canceled=true`,
      metadata: {
        userId: payload.userId,
        email: payload.email || "",
        amount: amount.toString(),
      },
    });
    
    console.log(`[add-funds] Created checkout session: ${session.id}, url: ${session.url}`);
    
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("[add-funds] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to create checkout session: ${message}` },
      { status: 500 }
    );
  }
}
