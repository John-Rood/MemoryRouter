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
  console.log(`[setup-payment] Getting billing for user ${userId}`);
  const { billing } = await getBilling(userId);
  console.log(`[setup-payment] Got billing, stripe_customer_id: ${billing.stripe_customer_id}`);
  
  if (billing.stripe_customer_id) {
    // Verify the customer still exists in Stripe
    try {
      await stripe.customers.retrieve(billing.stripe_customer_id);
      console.log(`[setup-payment] Existing customer valid: ${billing.stripe_customer_id}`);
      return billing.stripe_customer_id;
    } catch {
      // Customer was deleted, create a new one
      console.log(`[setup-payment] Stripe customer ${billing.stripe_customer_id} not found, creating new one`);
    }
  }
  
  // Create new Stripe customer
  console.log(`[setup-payment] Creating new Stripe customer for ${email}`);
  const customer = await stripe.customers.create({
    email,
    metadata: {
      userId,
    },
  });
  console.log(`[setup-payment] Created customer: ${customer.id}`);
  
  // Save customer ID to database
  await updateBilling(userId, {
    stripeCustomerId: customer.id,
  });
  console.log(`[setup-payment] Saved customer ID to database`);
  
  return customer.id;
}

export async function POST(request: NextRequest) {
  console.log(`[setup-payment] POST request received`);
  
  try {
    const stripe = getStripe();
    
    // Get user from session
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("mr_session")?.value;
    
    if (!accessToken) {
      console.log(`[setup-payment] No access token`);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    const payload = await verifyToken(accessToken);
    if (!payload) {
      console.log(`[setup-payment] Invalid token`);
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }
    
    console.log(`[setup-payment] User: ${payload.userId}, email: ${payload.email}`);
    
    // Get or create Stripe customer
    const customerId = await getOrCreateStripeCustomer(
      payload.userId,
      payload.email || ""
    );
    
    console.log(`[setup-payment] Got customerId: ${customerId}`);
    
    // Create Stripe Checkout session in setup mode (saves card without charging)
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      payment_method_types: ["card"],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing?setup_success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing?setup_canceled=true`,
      metadata: {
        userId: payload.userId,
        email: payload.email || "",
      },
    });
    
    console.log(`[setup-payment] Created checkout session: ${session.id}, url: ${session.url}`);
    
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("[setup-payment] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to create payment setup session: ${message}` },
      { status: 500 }
    );
  }
}
