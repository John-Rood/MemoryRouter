import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserBilling } from "@/lib/auth/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  console.log(`[billing/overview] Request started`);
  
  // Get current user from session
  const authStart = Date.now();
  const user = await getCurrentUser(request);
  console.log(`[billing/overview] Auth took ${Date.now() - authStart}ms`);
  
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  try {
    // Fetch billing from Workers API
    const billingStart = Date.now();
    const billing = await getUserBilling(user.userId);
    console.log(`[billing/overview] Billing fetch took ${Date.now() - billingStart}ms`);
    
    // Convert cents to dollars for display
    const creditBalance = billing.creditBalanceCents / 100;
    const creditTokens = Math.floor(billing.creditBalanceCents * 1000); // $1 = ~1M tokens at $0.001/1k
    
    // Fetch card info from Stripe if customer exists
    let cardBrand: string | null = null;
    let cardLast4: string | null = null;
    
    if (billing.stripeCustomerId && billing.hasPaymentMethod) {
      try {
        const customer = await stripe.customers.retrieve(billing.stripeCustomerId, {
          expand: ['invoice_settings.default_payment_method'],
        });
        
        if (customer && !customer.deleted) {
          // Try invoice_settings.default_payment_method first
          const defaultPm = customer.invoice_settings?.default_payment_method;
          if (defaultPm && typeof defaultPm !== 'string' && defaultPm.card) {
            cardBrand = defaultPm.card.brand;
            cardLast4 = defaultPm.card.last4;
          }
          
          // If no default, list customer's payment methods
          if (!cardBrand) {
            const paymentMethods = await stripe.paymentMethods.list({
              customer: billing.stripeCustomerId,
              type: 'card',
              limit: 1,
            });
            if (paymentMethods.data.length > 0 && paymentMethods.data[0].card) {
              cardBrand = paymentMethods.data[0].card.brand;
              cardLast4 = paymentMethods.data[0].card.last4;
            }
          }
        }
      } catch (error) {
        console.error('[billing/overview] Failed to fetch card info from Stripe:', error);
        // Continue without card info — not critical
      }
    }
    
    console.log(`[billing/overview] Total time: ${Date.now() - startTime}ms`);
    
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
      cardBrand,
      cardLast4,
      stripeCustomerId: billing.stripeCustomerId,
      transactions: billing.transactions?.slice(0, 50).map(t => ({
        id: t.id,
        type: t.type,
        amount: t.amount_cents / 100,
        description: t.description,
        createdAt: t.created_at,
      })) || [],
    });
  } catch (error) {
    console.error(`[billing/overview] Error after ${Date.now() - startTime}ms:`, error);
    return NextResponse.json({ error: "Failed to get billing" }, { status: 500 });
  }
}
