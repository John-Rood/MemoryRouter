import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import Stripe from "stripe";
import { verifyToken } from "@/lib/auth/jwt";
import { getBilling, updateBilling } from "@/lib/api/workers-client";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/**
 * Create or retrieve a Stripe Customer for the user
 */
async function getOrCreateStripeCustomer(
  userId: string,
  email: string
): Promise<string> {
  // Check if user already has a Stripe customer ID
  const { billing } = await getBilling(userId);
  
  if (billing.stripe_customer_id) {
    // Verify the customer still exists in Stripe
    try {
      await stripe.customers.retrieve(billing.stripe_customer_id);
      return billing.stripe_customer_id;
    } catch {
      // Customer was deleted, create a new one
      console.log(`Stripe customer ${billing.stripe_customer_id} not found, creating new one`);
    }
  }
  
  // Create new Stripe customer
  const customer = await stripe.customers.create({
    email,
    metadata: {
      userId,
    },
  });
  
  // Save customer ID to database
  await updateBilling(userId, {
    stripeCustomerId: customer.id,
  });
  
  return customer.id;
}

export async function POST(request: NextRequest) {
  try {
    // Get user from session
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("mr_session")?.value;
    
    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    const payload = await verifyToken(accessToken);
    if (!payload) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }
    
    // Get or create Stripe customer
    const customerId = await getOrCreateStripeCustomer(
      payload.userId,
      payload.email || ""
    );
    
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
    
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Error creating setup session:", error);
    return NextResponse.json(
      { error: "Failed to create payment setup session" },
      { status: 500 }
    );
  }
}
