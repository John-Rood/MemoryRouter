import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import Stripe from "stripe";
import { verifyToken } from "@/lib/auth/jwt";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

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
    
    const { amount } = await request.json();
    
    // Validate amount
    if (!amount || typeof amount !== "number" || amount < 5) {
      return NextResponse.json({ error: "Minimum amount is $5" }, { status: 400 });
    }
    
    if (amount > 10000) {
      return NextResponse.json({ error: "Maximum amount is $10,000" }, { status: 400 });
    }
    
    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
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
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing?success=true&amount=${amount}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing?canceled=true`,
      metadata: {
        userId: payload.userId,
        email: payload.email || "",
        amount: amount.toString(),
      },
    });
    
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
