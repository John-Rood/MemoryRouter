"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { mockStats, mockTransactions, mockPaymentMethod } from "@/lib/mock-data";
import { formatCurrency, formatTokens } from "@/lib/utils";
import { CreditCard, Plus, Trash2 } from "lucide-react";

const ADD_AMOUNTS = [20, 50, 100];

export default function BillingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="text-muted-foreground">Manage your credits, payment methods, and view transaction history.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Credit Balance</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center">
            <div className="text-4xl font-bold">{formatCurrency(mockStats.creditBalance)}</div>
            <p className="text-sm text-muted-foreground">{formatTokens(mockStats.creditBalance * 1_000_000)} tokens</p>
          </div>
          <p className="text-center text-sm text-muted-foreground">Auto-reup: $20 when balance &lt; $5</p>
          <div className="flex items-center justify-center gap-3">
            {ADD_AMOUNTS.map((amount) => (
              <Button key={amount} variant="outline"><Plus className="mr-1 h-3 w-3" />Add {formatCurrency(amount)}</Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Payment Method</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-md border px-4 py-3">
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{mockPaymentMethod.brand} {"\u2022\u2022\u2022\u2022"} {mockPaymentMethod.last4}</span>
                  <Badge variant="secondary">DEFAULT</Badge>
                </div>
                <p className="text-xs text-muted-foreground">Expires {mockPaymentMethod.expiry}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
          </div>
          <Button variant="outline" size="sm"><Plus className="mr-1 h-4 w-4" />Add Payment Method</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Transaction History</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">Description</th>
                  <th className="pb-2 pr-4 text-right font-medium">Amount</th>
                  <th className="pb-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {mockTransactions.map((tx) => (
                  <tr key={tx.id} className="border-b last:border-0">
                    <td className="py-3 pr-4 text-sm text-muted-foreground">{tx.date}</td>
                    <td className="py-3 pr-4 text-sm">{tx.description}</td>
                    <td className="py-3 pr-4 text-right text-sm font-medium text-green-500">+{formatCurrency(tx.amount)}</td>
                    <td className="py-3 text-right text-sm">{formatCurrency(tx.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="ghost" className="mt-3 w-full" size="sm">Load More</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Usage Summary</CardTitle><CardDescription>This month</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">Tokens stored</span>
            <div className="text-right">
              <span className="text-sm font-medium">{formatTokens(mockStats.tokensUsed)}</span>
              <span className="ml-2 text-sm text-muted-foreground">{formatCurrency(mockStats.tokensUsed / 1_000_000)}</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">Tokens retrieved</span>
            <div className="text-right">
              <span className="text-sm font-medium">{formatTokens(mockStats.tokensSaved)}</span>
              <Badge variant="secondary" className="ml-2">FREE</Badge>
            </div>
          </div>
          <Separator />
          <div className="rounded-md border bg-green-500/10 px-4 py-3 text-center">
            <p className="text-sm font-medium text-green-500">Memory saved you an estimated {formatCurrency(mockStats.savingsAmount)} in inference costs this month.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
