import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }
  
  // TODO: Verify signature, process webhook
  const body = await request.text();
  console.log("Stripe webhook received:", body.slice(0, 100));
  
  return NextResponse.json({ received: true });
}
