import { NextResponse } from "next/server";
import Stripe from "stripe";

export async function GET() {
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    
    if (!key) {
      return NextResponse.json({ 
        error: "STRIPE_SECRET_KEY not set",
        keyExists: false 
      }, { status: 500 });
    }
    
    // Log key info (not the actual key)
    console.log(`[test-stripe] Key starts with: ${key.substring(0, 12)}`);
    console.log(`[test-stripe] Key length: ${key.length}`);
    
    const stripe = new Stripe(key);
    
    // Try a simple API call
    const customers = await stripe.customers.list({ limit: 1 });
    
    return NextResponse.json({ 
      success: true,
      keyPrefix: key.substring(0, 12),
      keyLength: key.length,
      customersFound: customers.data.length,
      stripeConnected: true
    });
  } catch (error) {
    console.error("[test-stripe] Error:", error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : "Unknown error",
      keyPrefix: process.env.STRIPE_SECRET_KEY?.substring(0, 12) || "NOT_SET",
      keyLength: process.env.STRIPE_SECRET_KEY?.length || 0,
    }, { status: 500 });
  }
}
