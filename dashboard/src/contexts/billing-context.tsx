"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export interface BillingData {
  creditBalanceCents: number;
  freeTierTokensUsed: number;
  freeTierExhausted: boolean;
  autoReupEnabled: boolean;
  autoReupAmountCents: number;
  autoReupTriggerCents: number;
  monthlyCapCents: number | null;
  monthlySpendCents: number;
  stripeCustomerId: string | null;
  hasPaymentMethod: boolean;
  cardBrand: string | null;
  cardLast4: string | null;
  transactions: Array<{
    id: string;
    type: string;
    amount_cents: number;
    description: string;
    created_at: string;
  }>;
}

interface BillingContextValue {
  billing: BillingData | null;
  setBilling: (billing: BillingData) => void;
  refreshBilling: () => Promise<void>;
  isRefreshing: boolean;
}

const BillingContext = createContext<BillingContextValue | null>(null);

export function BillingProvider({ 
  children, 
  initialBilling 
}: { 
  children: ReactNode; 
  initialBilling: BillingData | null;
}) {
  const [billing, setBilling] = useState<BillingData | null>(initialBilling);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshBilling = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/billing/overview");
      if (response.ok) {
        const data = await response.json();
        setBilling({
          creditBalanceCents: Math.round(data.creditBalance * 100),
          freeTierTokensUsed: data.freeTierTokensUsed || 0,
          freeTierExhausted: data.freeTierExhausted || false,
          autoReupEnabled: data.autoReup?.enabled ?? true,
          autoReupAmountCents: Math.round((data.autoReup?.amount || 20) * 100),
          autoReupTriggerCents: Math.round((data.autoReup?.trigger || 5) * 100),
          monthlyCapCents: data.autoReup?.monthlyCap ? Math.round(data.autoReup.monthlyCap * 100) : null,
          monthlySpendCents: 0,
          stripeCustomerId: data.stripeCustomerId || null,
          hasPaymentMethod: data.hasPaymentMethod || false,
          cardBrand: data.cardBrand || null,
          cardLast4: data.cardLast4 || null,
          transactions: data.transactions?.map((t: { id: string; type: string; amount: number; description: string; createdAt: string }) => ({
            id: t.id,
            type: t.type,
            amount_cents: Math.round(t.amount * 100),
            description: t.description,
            created_at: t.createdAt,
          })) || [],
        });
      }
    } catch (error) {
      console.error("Failed to refresh billing:", error);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  return (
    <BillingContext.Provider value={{ billing, setBilling, refreshBilling, isRefreshing }}>
      {children}
    </BillingContext.Provider>
  );
}

export function useBilling() {
  const context = useContext(BillingContext);
  if (!context) {
    throw new Error("useBilling must be used within a BillingProvider");
  }
  return context;
}
