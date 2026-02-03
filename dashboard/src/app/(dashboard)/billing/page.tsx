"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CreditCard, Plus, TrendingUp, Wallet, History, Sparkles, CheckCircle2, XCircle, Loader2 } from "lucide-react";

// Mock data
const mockBilling = {
  creditBalanceCents: 2450,
  freeTierTokensUsed: 12500000,
  freeTierLimit: 50000000,
  autoReupEnabled: true,
  autoReupAmountCents: 2000,
  autoReupTriggerCents: 500,
  hasPaymentMethod: true,
  paymentMethod: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2027 },
};

const mockTransactions = [
  { id: "1", type: "credit", amountCents: 2000, description: "Added $20.00 credits", createdAt: "2026-02-01 14:32", balanceAfterCents: 2450 },
  { id: "2", type: "debit", amountCents: -50, description: "Memory usage - 100K tokens", createdAt: "2026-02-01 12:15", balanceAfterCents: 450 },
  { id: "3", type: "credit", amountCents: 500, description: "Auto-reup $5.00", createdAt: "2026-01-31 09:00", balanceAfterCents: 500 },
  { id: "4", type: "free_tier", amountCents: 0, description: "Free tier activated - 50M tokens", createdAt: "2026-01-15 10:00", balanceAfterCents: 0 },
];

const presetAmounts = [5, 10, 20, 50, 100];

export default function BillingPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [billing, setBilling] = useState(mockBilling);
  const [isAddingFunds, setIsAddingFunds] = useState(false);
  const [selectedAmount, setSelectedAmount] = useState(20);
  const [customAmount, setCustomAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  
  const balanceDollars = (billing.creditBalanceCents / 100).toFixed(2);
  const freeTierPercent = Math.min(100, (billing.freeTierTokensUsed / billing.freeTierLimit) * 100);
  const freeTierRemaining = billing.freeTierLimit - billing.freeTierTokensUsed;
  
  // Handle success/canceled URL params
  useEffect(() => {
    const success = searchParams.get("success");
    const canceled = searchParams.get("canceled");
    const amount = searchParams.get("amount");
    
    if (success === "true") {
      setNotification({
        type: "success",
        message: amount ? `Successfully added $${parseFloat(amount).toFixed(2)} to your account!` : "Payment successful! Credits have been added to your account.",
      });
      // Clear URL params after showing notification
      router.replace("/billing", { scroll: false });
    } else if (canceled === "true") {
      setNotification({
        type: "error",
        message: "Payment was canceled. No charges were made.",
      });
      router.replace("/billing", { scroll: false });
    }
  }, [searchParams, router]);
  
  // Auto-dismiss notification after 5 seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);
  
  const handleAddFunds = async () => {
    const amount = customAmount ? parseFloat(customAmount) : selectedAmount;
    
    if (isNaN(amount) || amount < 5) {
      setNotification({ type: "error", message: "Minimum amount is $5" });
      return;
    }
    
    if (amount > 10000) {
      setNotification({ type: "error", message: "Maximum amount is $10,000" });
      return;
    }
    
    setIsLoading(true);
    
    try {
      const response = await fetch("/api/billing/add-funds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to create checkout session");
      }
      
      if (data.url) {
        // Redirect to Stripe Checkout
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (error) {
      console.error("Error adding funds:", error);
      setNotification({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to add funds. Please try again.",
      });
      setIsLoading(false);
      setIsAddingFunds(false);
    }
  };
  
  const toggleAutoReup = () => {
    setBilling({ ...billing, autoReupEnabled: !billing.autoReupEnabled });
  };
  
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold gradient-text">Billing</h1>
        <p className="text-muted-foreground mt-1">
          Manage your credits, payment methods, and billing settings
        </p>
      </div>
      
      {/* Notification */}
      {notification && (
        <Alert variant={notification.type === "success" ? "default" : "destructive"} className={notification.type === "success" ? "border-neon-green/50 bg-neon-green/10" : ""}>
          {notification.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 text-neon-green" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          <AlertTitle>{notification.type === "success" ? "Success" : "Error"}</AlertTitle>
          <AlertDescription>{notification.message}</AlertDescription>
        </Alert>
      )}
      
      {/* Balance Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Credit Balance */}
        <Card className="glass-card border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              Credit Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold money-gradient">${balanceDollars}</span>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Available for memory operations
            </p>
            <Dialog open={isAddingFunds} onOpenChange={setIsAddingFunds}>
              <DialogTrigger asChild>
                <Button className="btn-neon mt-4 w-full">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Funds
                </Button>
              </DialogTrigger>
              <DialogContent className="glass-card">
                <DialogHeader>
                  <DialogTitle>Add Funds</DialogTitle>
                  <DialogDescription>
                    Add credits to your account. All funds are non-refundable.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="grid grid-cols-5 gap-2">
                    {presetAmounts.map((amount) => (
                      <Button
                        key={amount}
                        variant={selectedAmount === amount && !customAmount ? "default" : "outline"}
                        className={selectedAmount === amount && !customAmount ? "btn-neon" : ""}
                        onClick={() => {
                          setSelectedAmount(amount);
                          setCustomAmount("");
                        }}
                        disabled={isLoading}
                      >
                        ${amount}
                      </Button>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="custom">Custom Amount</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input
                        id="custom"
                        type="number"
                        min="5"
                        max="10000"
                        step="0.01"
                        placeholder="Enter amount"
                        className="pl-7 bg-muted/50"
                        value={customAmount}
                        onChange={(e) => setCustomAmount(e.target.value)}
                        disabled={isLoading}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Minimum $5, maximum $10,000</p>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Total: <span className="font-medium text-foreground">${customAmount || selectedAmount}</span>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setIsAddingFunds(false)} disabled={isLoading}>
                    Cancel
                  </Button>
                  <Button className="btn-neon" onClick={handleAddFunds} disabled={isLoading}>
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Redirecting...
                      </>
                    ) : (
                      <>Pay ${customAmount || selectedAmount}</>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
        
        {/* Free Tier */}
        <Card className="glass-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-neon-purple" />
              Free Tier
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold">{(freeTierRemaining / 1000000).toFixed(1)}M</span>
              <span className="text-muted-foreground">tokens remaining</span>
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Used</span>
                <span>{(billing.freeTierTokensUsed / 1000000).toFixed(1)}M / 50M</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-neon rounded-full transition-all" 
                  style={{ width: `${freeTierPercent}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Auto-Reup Settings */}
      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Auto-Reup
          </CardTitle>
          <CardDescription>
            Automatically add funds when your balance drops below a threshold
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Auto-Reup</Label>
              <p className="text-sm text-muted-foreground">
                Never run out of credits unexpectedly
              </p>
            </div>
            <Switch 
              checked={billing.autoReupEnabled} 
              onCheckedChange={toggleAutoReup}
            />
          </div>
          
          {billing.autoReupEnabled && (
            <div className="grid gap-4 md:grid-cols-2 pt-4 border-t border-border/30">
              <div className="space-y-2">
                <Label>Reup Amount</Label>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold">${(billing.autoReupAmountCents / 100).toFixed(0)}</span>
                  <span className="text-muted-foreground">per charge</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Trigger Threshold</Label>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold">${(billing.autoReupTriggerCents / 100).toFixed(2)}</span>
                  <span className="text-muted-foreground">balance trigger</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Payment Method */}
      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Payment Method
          </CardTitle>
        </CardHeader>
        <CardContent>
          {billing.hasPaymentMethod ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-8 bg-muted rounded flex items-center justify-center">
                  <span className="text-xs font-bold uppercase">{billing.paymentMethod.brand}</span>
                </div>
                <div>
                  <p className="font-medium">•••• {billing.paymentMethod.last4}</p>
                  <p className="text-sm text-muted-foreground">
                    Expires {billing.paymentMethod.expMonth}/{billing.paymentMethod.expYear}
                  </p>
                </div>
              </div>
              <Button variant="outline">Update</Button>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-4">No payment method on file</p>
              <Button className="btn-neon">
                <Plus className="h-4 w-4 mr-2" />
                Add Payment Method
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Transaction History */}
      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Transaction History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {mockTransactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between py-3 border-b border-border/30 last:border-0">
                <div>
                  <p className="font-medium">{tx.description}</p>
                  <p className="text-sm text-muted-foreground">{tx.createdAt}</p>
                </div>
                <div className="text-right">
                  <p className={`font-mono font-medium ${tx.amountCents >= 0 ? 'text-neon-green' : 'text-destructive'}`}>
                    {tx.amountCents >= 0 ? '+' : ''}${(tx.amountCents / 100).toFixed(2)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Balance: ${(tx.balanceAfterCents / 100).toFixed(2)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
