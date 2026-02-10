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
import { CreditCard, Plus, TrendingUp, Wallet, History, Sparkles, CheckCircle2, XCircle, Loader2, RefreshCw, Activity, Zap, Save, DollarSign } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBilling } from "@/contexts/billing-context";

// Card brand icons - using proper brand logos
function CardBrandIcon({ brand }: { brand: string | null }) {
  const brandLower = brand?.toLowerCase() || '';
  
  if (brandLower === 'visa') {
    return (
      <svg viewBox="0 0 750 471" className="h-6 w-9">
        <rect width="750" height="471" rx="40" fill="#1A1F71"/>
        <path d="M278.2 334.2h-60.2l37.6-232.1h60.3l-37.7 232.1zm246.8-226.4c-11.9-4.7-30.6-9.7-53.9-9.7-59.5 0-101.4 31.6-101.7 76.9-.4 33.4 29.9 52.1 52.7 63.2 23.4 11.4 31.3 18.7 31.2 28.9-.2 15.6-18.7 22.7-36 22.7-24.1 0-36.9-3.5-56.6-12.2l-7.8-3.7-8.4 52.2c14.1 6.5 40.1 12.1 67.1 12.4 63.3 0 104.4-31.2 104.8-79.6.2-26.5-15.8-46.7-50.6-63.3-21.1-10.8-34-18-33.9-28.9 0-9.7 10.9-20 34.5-20 19.7-.3 34 4.2 45.1 8.9l5.4 2.7 8.1-50.5zm157.9-5.7h-46.7c-14.5 0-25.3 4.2-31.7 19.4l-89.8 214.4h63.5s10.4-28.8 12.7-35.1h77.4c1.8 8.2 7.4 35.1 7.4 35.1h56.1l-48.9-233.8zm-74.5 150.8c5-13.5 24.2-65.6 24.2-65.6-.4.6 5-13.6 8-22.4l4.1 20.3s11.6 56.1 14 67.7h-50.3zm-408.5-150.8l-59.1 158.3-6.3-32.3c-10.9-37.2-45.1-77.5-83.3-97.7l54.1 203.5h63.8l94.9-231.8h-64.1z" fill="#fff"/>
        <path d="M131.9 102.1H34.8l-.8 5c75.5 19.3 125.5 65.9 146.3 121.9l-21.1-107c-3.6-14.6-14.1-19.3-27.3-19.9z" fill="#F9A533"/>
      </svg>
    );
  }
  
  if (brandLower === 'mastercard') {
    return (
      <svg viewBox="0 0 750 471" className="h-6 w-9">
        <rect width="750" height="471" rx="40" fill="#000"/>
        <circle cx="299" cy="235.5" r="140" fill="#EB001B"/>
        <circle cx="451" cy="235.5" r="140" fill="#F79E1B"/>
        <path d="M375 130.5c-34.5 28.5-56.5 71.4-56.5 119.5s22 91 56.5 119.5c34.5-28.5 56.5-71.4 56.5-119.5s-22-91-56.5-119.5z" fill="#FF5F00"/>
      </svg>
    );
  }
  
  if (brandLower === 'amex' || brandLower === 'american express') {
    return (
      <svg viewBox="0 0 750 471" className="h-6 w-9">
        <rect width="750" height="471" rx="40" fill="#006FCF"/>
        <path d="M0 221h51.8l11.7-28.1h26.2L101.4 221h102v-21.5l9.1 21.5h52.8l9.1-21.8V221h253v-45.3h-5c-4.4 0-5.7-0.6-5.7-5.8v-39.7h10.7v-27.6h-56.5c-4.1 0-7 0.5-9.9 4.9l-30.3 47.1-33-47.1c-2.4-3.4-6.6-4.9-12.9-4.9h-54.2v21.2l-10.2-21.2h-55.7l-29.6 66.7v-66.7h-64.9l-8 19.6h-21.9l-8.1-19.6H30.3L0 175.7v45.3zm227.7-27.6l-47.1-90.8h26.1l30.2 59.7 28.5-59.7h25.3l-46.8 90.8h-16.2zm-119.5 0v-90.8h27v17.9h38.7v22.4h-38.7v17.5h38.7v23h-38.7v10h-27zm343.2 0v-90.8h76.1v22.4h-49.6v13.5h48.4v22.4h-48.4v10.1h49.6v22.4h-76.1zm-135.9 0v-90.8h25.7v68.1h44.7v22.7h-70.4zm114.9 0v-90.8h26.3l39.7 59.5v-59.5h26v90.8h-25.6l-40.4-60.8v60.8h-26zm-391.3 0l43.7-90.8h30.9l43.5 90.8h-29.9l-8.1-19.6h-44.3l-8 19.6h-27.8zm63-39.7l-12.9-33.8-13.5 33.8h26.4z" fill="#fff"/>
        <path d="M750 339.6v-119h-51.2l-29.7 46.6-31.5-46.6H531.4v21.2l-10.2-21.2h-92.8l-10.2 21.2v-21.2H312.7l-13 30.3-13.4-30.3h-87.2v21.2l-9.1-21.2H136l-42.5 89.3v29.7h71.3l8.1-19.6h18.1l8.1 19.6h140v-15l12.5 15h76.9V374.4l1.7 3.2h28.3l1.7-3.2v17.2h145.7v-32.9c4.7 1 9.7 1.5 17 1.5h25.6v31.4h49.5v-32.7c7.9 5 18.3 6.1 28.9 6.1h51.2v-25.6h-5c-4.4 0-5.7-.6-5.7-5.8v-39.7h10.7v-27.6h-56.5c-4.1 0-7 .5-9.9 4.9l-30.3 47.1-33-47.1c-2.4-3.4-6.6-4.9-12.9-4.9h-54.2v21.2l-10.2-21.2h-55.7l-29.6 66.7v-66.7h-64.9l-8 19.6h-21.9l-8.1-19.6h-47.7l-42.1 91.7h30.2l8.1-19.6h44l8.1 19.6h76.5v-68.7l27.4 68.7h23.7l27-68.1v68.1H406l.1-90.8h-61.3l-25 58.7-27.2-58.7h-61.9v68.7l-37.9-68.7h-52.2l-42.1 90.8h30.2l8.1-19.6h44l8.1 19.6h76.5v-68.7l27.4 68.7h23.7l27-68.1v68.1h26.5v-90.8h-66.2zm217 0h-26.4v23h26.4c7.6 0 12.2-4.2 12.2-11.6 0-7.3-4.5-11.4-12.2-11.4zm-217-50.5l-12.9-33.8-13.5 33.8h26.4zm-293.2 50.5l-12.9-33.8-13.5 33.8h26.4z" fill="#fff"/>
      </svg>
    );
  }
  
  if (brandLower === 'discover') {
    return (
      <svg viewBox="0 0 750 471" className="h-6 w-9">
        <rect width="750" height="471" rx="40" fill="#fff" stroke="#ddd" strokeWidth="2"/>
        <path d="M375 130c-79.5 0-144 64.5-144 144s64.5 144 144 144c40.3 0 76.8-16.6 103-43.3-32.9 22.7-72.9 36-116 36-112.1 0-203-90.9-203-203S249.9 4.7 362 4.7c43.1 0 83.1 13.3 116 36-26.2-26.7-62.7-43.3-103-43.3z" fill="#F47216"/>
        <text x="100" y="270" fontFamily="Arial, sans-serif" fontSize="90" fontWeight="bold" fill="#000">DISCOVER</text>
      </svg>
    );
  }
  
  // Default credit card icon
  return <CreditCard className="h-5 w-5 text-muted-foreground" />;
}

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
  const [localReupAmount, setLocalReupAmount] = useState<number | null>(null);
  const [localReupTrigger, setLocalReupTrigger] = useState<number | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsChanged, setSettingsChanged] = useState(false);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(true);
  
  // Use context billing data (already fetched by layout - no double fetch!)
  const billing = {
    creditBalanceCents: contextBilling?.creditBalanceCents ?? 0,
    freeTierTokensUsed: contextBilling?.freeTierTokensUsed ?? 0,
    freeTierLimit: FREE_TIER_LIMIT,
    autoReupEnabled: localAutoReup ?? contextBilling?.autoReupEnabled ?? true,
    autoReupAmountCents: localReupAmount ?? contextBilling?.autoReupAmountCents ?? 2000,
    autoReupTriggerCents: localReupTrigger ?? contextBilling?.autoReupTriggerCents ?? 500,
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
  
  // Refresh billing on mount to get card info from Stripe
  useEffect(() => {
    refreshBilling();
  }, [refreshBilling]);
  
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
  
  // Track changes to auto-reup settings
  const hasUnsavedChanges = () => {
    if (localAutoReup !== null && localAutoReup !== (contextBilling?.autoReupEnabled ?? true)) return true;
    if (localReupAmount !== null && localReupAmount !== (contextBilling?.autoReupAmountCents ?? 2000)) return true;
    if (localReupTrigger !== null && localReupTrigger !== (contextBilling?.autoReupTriggerCents ?? 500)) return true;
    return false;
  };

  const toggleAutoReup = async () => {
    const newValue = !billing.autoReupEnabled;
    setLocalAutoReup(newValue);
    
    // Auto-save toggle immediately
    try {
      const response = await fetch("/api/billing/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoReupEnabled: newValue }),
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update");
      }
      
      await refreshBilling();
      setLocalAutoReup(null); // Clear local state after successful save
    } catch (error) {
      console.error("Failed to toggle auto-reup:", error);
      setNotification({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to update auto-reup setting",
      });
      setLocalAutoReup(null); // Revert to server state
    }
  };

  const handleReupAmountChange = (value: string) => {
    const amount = parseInt(value);
    setLocalReupAmount(amount);
    setSettingsChanged(true);
  };

  const handleReupTriggerChange = (value: string) => {
    const trigger = parseInt(value);
    setLocalReupTrigger(trigger);
    setSettingsChanged(true);
  };

  const saveAutoReupSettings = async () => {
    if (!hasUnsavedChanges()) return;
    
    setIsSavingSettings(true);
    
    try {
      const payload: Record<string, number | boolean> = {};
      if (localReupAmount !== null) payload.autoReupAmountCents = localReupAmount;
      if (localReupTrigger !== null) payload.autoReupTriggerCents = localReupTrigger;
      
      const response = await fetch("/api/billing/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to save settings");
      }
      
      setNotification({
        type: "success",
        message: "Auto-reup settings saved successfully!",
      });
      
      await refreshBilling();
      
      // Clear local state after successful save
      setLocalReupAmount(null);
      setLocalReupTrigger(null);
      setSettingsChanged(false);
    } catch (error) {
      console.error("Failed to save settings:", error);
      setNotification({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to save settings",
      });
    } finally {
      setIsSavingSettings(false);
    }
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
              
              {/* Daily Usage Chart */}
              {usage.dailyUsage.length > 0 ? (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-4">Daily Requests</p>
                  <div className="space-y-2">
                    {usage.dailyUsage.slice(0, 7).map((day) => {
                      const maxRequests = Math.max(...usage.dailyUsage.slice(0, 7).map(d => d.requests), 1);
                      const width = (day.requests / maxRequests) * 100;
                      const [, month, dayNum] = day.date.split('-');
                      return (
                        <div key={day.date} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-10 text-right">
                            {parseInt(month)}/{parseInt(dayNum)}
                          </span>
                          <div className="flex-1 h-6 bg-muted/30 rounded overflow-hidden">
                            <div 
                              className="h-full bg-primary/60 rounded transition-all"
                              style={{ width: `${Math.max(width, 2)}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium w-12 text-right">{day.requests}</span>
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
            <div className="space-y-4 pt-4 border-t border-border/10">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="reup-amount">Recharge Amount</Label>
                  <Select 
                    value={billing.autoReupAmountCents.toString()} 
                    onValueChange={handleReupAmountChange}
                  >
                    <SelectTrigger id="reup-amount" className="bg-muted/50">
                      <SelectValue placeholder="Select amount" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1000">$10</SelectItem>
                      <SelectItem value="2000">$20</SelectItem>
                      <SelectItem value="5000">$50</SelectItem>
                      <SelectItem value="10000">$100</SelectItem>
                      <SelectItem value="20000">$200</SelectItem>
                      <SelectItem value="50000">$500</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Amount charged when balance is low
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reup-trigger">Trigger When Below</Label>
                  <Select 
                    value={billing.autoReupTriggerCents.toString()} 
                    onValueChange={handleReupTriggerChange}
                  >
                    <SelectTrigger id="reup-trigger" className="bg-muted/50">
                      <SelectValue placeholder="Select threshold" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="500">$5</SelectItem>
                      <SelectItem value="1000">$10</SelectItem>
                      <SelectItem value="2500">$25</SelectItem>
                      <SelectItem value="5000">$50</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Recharge triggers at this balance
                  </p>
                </div>
              </div>
              
              {hasUnsavedChanges() && (
                <div className="flex justify-end pt-2">
                  <Button 
                    className="btn-neon" 
                    onClick={saveAutoReupSettings}
                    disabled={isSavingSettings}
                  >
                    {isSavingSettings ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save Settings
                      </>
                    )}
                  </Button>
                </div>
              )}
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
                <div className="w-12 h-8 rounded flex items-center justify-center overflow-hidden">
                  <CardBrandIcon brand={contextBilling?.cardBrand || null} />
                </div>
                <div>
                  <p className="font-medium">
                    {contextBilling?.cardBrand && contextBilling?.cardLast4
                      ? `${contextBilling.cardBrand.charAt(0).toUpperCase() + contextBilling.cardBrand.slice(1)} •••• ${contextBilling.cardLast4}`
                      : "Card on file"}
                  </p>
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
