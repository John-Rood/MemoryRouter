import { requireUser, getUserBilling } from '@/lib/auth/server';
import { Sidebar } from "@/components/sidebar";
import { BillingProvider } from "@/contexts/billing-context";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const layoutStart = Date.now();
  console.log(`[DashboardLayout] Starting render`);
  
  const userStart = Date.now();
  const user = await requireUser();
  console.log(`[DashboardLayout] requireUser took ${Date.now() - userStart}ms`);
  
  const billingStart = Date.now();
  const billing = await getUserBilling(user.id);
  console.log(`[DashboardLayout] getUserBilling took ${Date.now() - billingStart}ms`);
  
  console.log(`[DashboardLayout] Total server time: ${Date.now() - layoutStart}ms`);
  
  // Transform billing for context
  const billingData = billing ? {
    creditBalanceCents: billing.creditBalanceCents,
    freeTierTokensUsed: billing.freeTierTokensUsed,
    freeTierExhausted: billing.freeTierExhausted,
    autoReupEnabled: billing.autoReupEnabled,
    autoReupAmountCents: billing.autoReupAmountCents,
    autoReupTriggerCents: billing.autoReupTriggerCents,
    monthlyCapCents: billing.monthlyCapCents,
    monthlySpendCents: billing.monthlySpendCents,
    stripeCustomerId: billing.stripeCustomerId,
    hasPaymentMethod: billing.hasPaymentMethod,
    transactions: billing.transactions || [],
  } : null;
  
  return (
    <BillingProvider initialBilling={billingData}>
      <div className="flex flex-col lg:flex-row min-h-screen">
        {/* Ambient background */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-0 left-1/4 w-[400px] h-[400px] bg-neon-green/3 rounded-full blur-[150px]"></div>
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-neon-blue/3 rounded-full blur-[150px]"></div>
        </div>
        
        <Sidebar 
          user={{ 
            email: user.email, 
            name: user.name || undefined,
            avatarUrl: user.avatarUrl || undefined,
          }} 
          creditBalanceCents={billing?.creditBalanceCents || 0}
        />
        <main className="flex-1 overflow-auto relative">
          <div className="container max-w-6xl py-6 px-4 lg:px-8 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </BillingProvider>
  );
}
