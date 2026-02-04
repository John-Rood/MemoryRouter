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
import { CreditCard, Plus, TrendingUp, Wallet, History, Sparkles, CheckCircle2, XCircle, Loader2, RefreshCw, Activity, Zap } from "lucide-react";
import { useBilling } from "@/contexts/billing-context";

const FREE_TIER_LIMIT = 50000000;
const presetAmounts = [5, 10, 20, 50, 100];

interface UsageStats {
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  dailyUsage: Array<{
    date: string;
    requests: number;
    tokens_in: number;
    tokens_out: number;
  }>;
}

export default function BillingPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { billing: contextBilling, refreshBilling, isRefreshing } = useBilling();
  
  const [isAddingFunds, setIsAddingFunds] = useState(false);
  const [selectedAmount, setSelectedAmount] = useState(20);
  const [customAmount, setCustomAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isAddingPaymentMethod, setIsAddingPaymentMethod] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [localAutoReup, setLocalAutoReup] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(true);
  
  // Use context billing data (already fetched by layout - no double fetch!)
  const billing = {
    creditBalanceCents: contextBilling?.creditBalanceCents ?? 0,
    freeTierTokensUsed: contextBilling?.freeTierTokensUsed ?? 0,
    freeTierLimit: FREE_TIER_LIMIT,
    autoReupEnabled: localAutoReup ?? contextBilling?.autoReupEnabled ?? true,
    autoReupAmountCents: contextBilling?.autoReupAmountCents ?? 2000,
    autoReupTriggerCents: contextBilling?.autoReupTriggerCents ?? 500,
    hasPaymentMethod: contextBilling?.hasPaymentMethod ?? false,
  };
  
  const transactions = (contextBilling?.transactions || []).map(t => ({
    id: t.id,
    type: t.type,
    amountCents: t.amount_cents,
    description: t.description,
    createdAt: new Date(t.created_at).toLocaleString(),
    balanceAfterCents: 0,
  }));
  
  const balanceDollars = (billing.creditBalanceCents / 100).toFixed(2);
  const freeTierPercent = Math.min(100, (billing.freeTierTokensUsed / billing.freeTierLimit) * 100);
  const freeTierRemaining = billing.freeTierLimit - billing.freeTierTokensUsed;
  
  // Fetch usage data
  useEffect(() => {
    async function fetchUsage() {
      try {
        const response = await fetch("/api/billing/usage");
        if (response.ok) {
          const data = await response.json();
          setUsage(data);
        }
      } catch (error) {
        console.error("Failed to fetch usage:", error);
      } finally {
        setIsLoadingUsage(false);
      }
    }
    fetchUsage();
  }, []);
  
  // Handle success/canceled URL params
  useEffect(() => {
    const success = searchParams.get("success");
    const canceled = searchParams.get("canceled");
    const setupSuccess = searchParams.get("setup_success");
    const setupCanceled = searchParams.get("setup_canceled");
    const amount = searchParams.get("amount");
    
    if (success === "true") {
      setNotification({
        type: "success",
        message: amount ? `Successfully added $${parseFloat(amount).toFixed(2)} to your account!` : "Payment successful! Credits have been added to your account.",
      });
      // Clear URL params and refresh billing data
      router.replace("/billing", { scroll: false });
      // Wait a bit for webhook to process, then refresh
      setTimeout(() => refreshBilling(), 2000);
    } else if (canceled === "true") {
      setNotification({
        type: "error",
        message: "Payment was canceled. No charges were made.",
      });
      router.replace("/billing", { scroll: false });
    } else if (setupSuccess === "true") {
      setNotification({
        type: "success",
        message: "Payment method added successfully! You can now use auto-reup.",
      });
      router.replace("/billing", { scroll: false });
      // Wait a bit for webhook to process, then refresh
      setTimeout(() => refreshBilling(), 2000);
    } else if (setupCanceled === "true") {
      setNotification({
        type: "error",
        message: "Payment method setup was canceled.",
      });
      router.replace("/billing", { scroll: false });
    }
  }, [searchParams, router, refreshBilling]);
  
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
  
  const handleAddPaymentMethod = async () => {
    setIsAddingPaymentMethod(true);
    
    try {
      const response = await fetch("/api/billing/setup-payment-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to start payment setup");
      }
      
      if (data.url) {
        // Redirect to Stripe Checkout (setup mode)
        window.location.href = data.url;
      } else {
        throw new Error("No setup URL returned");
      }
    } catch (error) {
      console.error("Error setting up payment method:", error);
      setNotification({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to set up payment method. Please try again.",
      });
      setIsAddingPaymentMethod(false);
    }
  };
  
  const toggleAutoReup = () => {
    setLocalAutoReup(!billing.autoReupEnabled);
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
        <Card className="glass-card border-border/10">
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
      
      {/* Usage Stats */}
      <Card className="glass-card border-border/10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              API Usage (Last 30 Days)
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={() => {
              setIsLoadingUsage(true);
              fetch("/api/billing/usage")
                .then(r => r.json())
                .then(setUsage)
                .finally(() => setIsLoadingUsage(false));
            }} disabled={isLoadingUsage}>
              <RefreshCw className={`h-4 w-4 ${isLoadingUsage ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingUsage ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : usage ? (
            <div className="space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="stat-card rounded-lg px-4 py-3">
                  <p className="text-xs text-muted-foreground mb-1">Total Requests</p>
                  <p className="text-2xl font-bold text-primary">{usage.totalRequests.toLocaleString()}</p>
                </div>
                <div className="stat-card rounded-lg px-4 py-3">
                  <p className="text-xs text-muted-foreground mb-1">Tokens In</p>
                  <p className="text-2xl font-bold">{(usage.totalTokensIn / 1000).toFixed(1)}K</p>
                </div>
                <div className="stat-card rounded-lg px-4 py-3">
                  <p className="text-xs text-muted-foreground mb-1">Tokens Out</p>
                  <p className="text-2xl font-bold">{(usage.totalTokensOut / 1000).toFixed(1)}K</p>
                </div>
              </div>
              
              {/* Daily Usage Chart (simple bar chart) */}
              {usage.dailyUsage.length > 0 ? (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-3">Daily Requests</p>
                  <div className="flex items-end gap-1 h-24">
                    {usage.dailyUsage.slice(0, 14).reverse().map((day, i) => {
                      const maxRequests = Math.max(...usage.dailyUsage.map(d => d.requests), 1);
                      const height = (day.requests / maxRequests) * 100;
                      return (
                        <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                          <div 
                            className="w-full bg-primary/60 rounded-t hover:bg-primary transition-colors"
                            style={{ height: `${Math.max(height, 2)}%` }}
                            title={`${day.date}: ${day.requests} requests`}
                          />
                          {i % 2 === 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(day.date).getDate()}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No usage data yet. Start making API calls to see your usage.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No usage data available
            </p>
          )}
        </CardContent>
      </Card>
      
      {/* Auto-Reup Settings */}
      <Card className="glass-card border-border/10">
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
          
          {billing.autoReupEnabled && !billing.hasPaymentMethod && (
            <Alert className="border-amber-500/50 bg-amber-500/10">
              <CreditCard className="h-4 w-4 text-amber-500" />
              <AlertTitle className="text-amber-500">Payment method required</AlertTitle>
              <AlertDescription>
                Auto-reup needs a saved payment method.{" "}
                <button 
                  onClick={handleAddPaymentMethod}
                  className="underline hover:text-foreground font-medium"
                  disabled={isAddingPaymentMethod}
                >
                  Add one now
                </button>
              </AlertDescription>
            </Alert>
          )}
          
          {billing.autoReupEnabled && (
            <div className="grid gap-4 md:grid-cols-2 pt-4 border-t border-border/10">
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
      <Card className="glass-card border-border/10">
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
                  <CreditCard className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-medium">Card on file</p>
                  <p className="text-sm text-muted-foreground">
                    Ready for auto-reup
                  </p>
                </div>
              </div>
              <Button 
                variant="outline" 
                onClick={handleAddPaymentMethod}
                disabled={isAddingPaymentMethod}
              >
                {isAddingPaymentMethod ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Update"
                )}
              </Button>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-4">No payment method on file</p>
              <Button 
                className="btn-neon" 
                onClick={handleAddPaymentMethod}
                disabled={isAddingPaymentMethod}
              >
                {isAddingPaymentMethod ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Redirecting...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Payment Method
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Transaction History */}
      <Card className="glass-card border-border/10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Transaction History
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={refreshBilling} disabled={isRefreshing}>
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isRefreshing && transactions.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No transactions yet</p>
              <p className="text-sm mt-1">Add funds to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between py-3 border-b border-border/10 last:border-0">
                  <div>
                    <p className="font-medium">{tx.description}</p>
                    <p className="text-sm text-muted-foreground">{tx.createdAt}</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-mono font-medium ${tx.type === 'credit' ? 'text-neon-green' : 'text-destructive'}`}>
                      {tx.type === 'credit' ? '+' : '-'}${Math.abs(tx.amountCents / 100).toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
