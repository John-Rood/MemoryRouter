"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CreditCard, Plus, Trash2, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { formatTokens } from "@/lib/constants";

const mockBilling = {
  creditBalance: 15.42,
  creditTokens: 15_420_000,
  autoReup: { amount: 20, trigger: 5 },
  paymentMethods: [{ id: "pm_1", brand: "visa", last4: "4242", expMonth: 12, expYear: 2028, isDefault: true }],
  transactions: [
    { id: "tx_1", date: "Jan 26, 2026", description: "Auto-reup", amount: 20.0, balance: 35.42, type: "credit" as const },
    { id: "tx_2", date: "Jan 24, 2026", description: "Auto-reup", amount: 20.0, balance: 15.42, type: "credit" as const },
  ],
  usage: { tokensStored: 36_200_000, storedCost: 36.2, tokensRetrieved: 142_800_000, savedUsd: 428 },
};

export default function BillingPage() {
  const [addingFunds, setAddingFunds] = useState(false);

  const handleAddFunds = async (amount: number) => {
    setAddingFunds(true);
    console.log("Add funds:", amount);
    setTimeout(() => setAddingFunds(false), 1000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="text-muted-foreground">Manage credits, payment methods, and view history.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Credit Balance</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center py-4">
            <p className="text-4xl font-bold">${mockBilling.creditBalance.toFixed(2)}</p>
            <p className="text-sm text-muted-foreground mt-1">{formatTokens(mockBilling.creditTokens)} tokens</p>
            <p className="text-xs text-muted-foreground mt-2">Auto-reup: ${mockBilling.autoReup.amount} when balance &lt; ${mockBilling.autoReup.trigger}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {[20, 50, 100].map((amount) => (
              <Button key={amount} variant="outline" onClick={() => handleAddFunds(amount)} disabled={addingFunds}>
                <Plus className="mr-1 h-3 w-3" />Add ${amount}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Payment Method</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {mockBilling.paymentMethods.map((pm) => (
            <div key={pm.id} className="flex items-center justify-between rounded-md border px-4 py-3">
              <div className="flex items-center gap-3">
                <CreditCard className="h-8 w-8 text-muted-foreground" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm uppercase">{pm.brand}</span>
                    <span className="text-sm text-muted-foreground">**** {pm.last4}</span>
                    {pm.isDefault && <Badge variant="secondary" className="text-xs">DEFAULT</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">Expires {pm.expMonth}/{pm.expYear}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm"><Plus className="mr-1 h-3 w-3" />Add Payment Method</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Transaction History</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-0">
            {mockBilling.transactions.map((tx, i) => (
              <div key={tx.id}>
                <div className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full ${tx.type === "credit" ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}>
                      {tx.type === "credit" ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{tx.description}</p>
                      <p className="text-xs text-muted-foreground">{tx.date}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-medium ${tx.type === "credit" ? "text-green-500" : "text-red-500"}`}>
                      {tx.type === "credit" ? "+" : "-"}${tx.amount.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">${tx.balance.toFixed(2)}</p>
                  </div>
                </div>
                {i < mockBilling.transactions.length - 1 && <Separator />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage Summary</CardTitle>
          <CardDescription>This month</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Tokens stored</span>
            <div className="text-right">
              <span>{formatTokens(mockBilling.usage.tokensStored)}</span>
              <span className="text-muted-foreground ml-2">${mockBilling.usage.storedCost.toFixed(2)}</span>
            </div>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Tokens retrieved</span>
            <div className="text-right">
              <span>{formatTokens(mockBilling.usage.tokensRetrieved)}</span>
              <Badge variant="secondary" className="ml-2 text-xs">FREE</Badge>
            </div>
          </div>
          <Separator />
          <div className="flex items-start gap-2 rounded-md bg-green-500/10 px-4 py-3">
            <p className="text-sm font-medium text-green-500">
              Memory saved you an estimated ${mockBilling.usage.savedUsd} in inference costs this month.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
