import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserBilling } from "@/lib/auth/server";

export async function GET(request: NextRequest) {
  // Get current user from session
  const user = await getCurrentUser(request);
  
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  try {
    // Fetch billing from Workers API
    const billing = await getUserBilling(user.userId);
    
    // Convert cents to dollars for display
    const creditBalance = billing.creditBalanceCents / 100;
    const creditTokens = Math.floor(billing.creditBalanceCents * 1000); // $1 = ~1M tokens at $0.001/1k
    
    return NextResponse.json({
      status: billing.hasPaymentMethod ? "active" : "pending",
      creditBalance,
      creditTokens,
      freeTierTokensUsed: billing.freeTierTokensUsed,
      freeTierExhausted: billing.freeTierExhausted,
      autoReup: {
        enabled: billing.autoReupEnabled,
        amount: billing.autoReupAmountCents / 100,
        trigger: billing.autoReupTriggerCents / 100,
        monthlyCap: billing.monthlyCapCents ? billing.monthlyCapCents / 100 : null,
      },
      hasPaymentMethod: billing.hasPaymentMethod,
      stripeCustomerId: billing.stripeCustomerId,
      transactions: billing.transactions?.slice(0, 5).map(t => ({
        id: t.id,
        type: t.type,
        amount: t.amount_cents / 100,
        description: t.description,
        createdAt: t.created_at,
      })) || [],
    });
  } catch (error) {
    console.error("Failed to get billing:", error);
    return NextResponse.json({ error: "Failed to get billing" }, { status: 500 });
  }
}
