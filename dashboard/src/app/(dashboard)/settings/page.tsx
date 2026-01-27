"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertCircle } from "lucide-react";
import { PRICING, REUP_AMOUNTS, REUP_TRIGGERS, MONTHLY_CAPS } from "@/lib/constants";

export default function SettingsPage() {
  const [autoReup, setAutoReup] = useState(true);
  const [reupAmount, setReupAmount] = useState(PRICING.DEFAULT_REUP_AMOUNT.toString());
  const [customReup, setCustomReup] = useState("");
  const [triggerAmount, setTriggerAmount] = useState(PRICING.DEFAULT_REUP_TRIGGER.toString());
  const [customTrigger, setCustomTrigger] = useState("");
  const [monthlyCap, setMonthlyCap] = useState("none");
  const [customCap, setCustomCap] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    console.log("Save settings");
    setTimeout(() => setSaving(false), 1000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Configure auto-reup and account preferences.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Auto-Reup</CardTitle>
          <CardDescription>Automatically add credits when your balance runs low.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <Label htmlFor="auto-reup" className="text-sm font-medium">Auto-reup enabled</Label>
            <Switch id="auto-reup" checked={autoReup} onCheckedChange={setAutoReup} />
          </div>

          {autoReup && (
            <>
              <Separator />
              <div className="space-y-3">
                <Label className="text-sm font-medium">Reup Amount</Label>
                <RadioGroup value={reupAmount} onValueChange={setReupAmount} className="flex flex-wrap gap-2">
                  {REUP_AMOUNTS.map((amount) => (
                    <div key={amount} className="flex items-center">
                      <RadioGroupItem value={amount.toString()} id={`reup-${amount}`} className="peer sr-only" />
                      <Label htmlFor={`reup-${amount}`} className="flex cursor-pointer items-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 hover:bg-accent transition-colors">
                        ${amount}
                      </Label>
                    </div>
                  ))}
                  <div className="flex items-center">
                    <RadioGroupItem value="custom" id="reup-custom" className="peer sr-only" />
                    <Label htmlFor="reup-custom" className="flex cursor-pointer items-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 hover:bg-accent transition-colors">Custom</Label>
                  </div>
                </RadioGroup>
                {reupAmount === "custom" && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">$</span>
                    <Input type="number" min={PRICING.MIN_REUP_AMOUNT} value={customReup} onChange={(e) => setCustomReup(e.target.value)} className="w-32" />
                  </div>
                )}
              </div>

              <Separator />
              <div className="space-y-3">
                <Label className="text-sm font-medium">When to Reup</Label>
                <RadioGroup value={triggerAmount} onValueChange={setTriggerAmount} className="flex flex-wrap gap-2">
                  {REUP_TRIGGERS.map((amount) => (
                    <div key={amount} className="flex items-center">
                      <RadioGroupItem value={amount.toString()} id={`trigger-${amount}`} className="peer sr-only" />
                      <Label htmlFor={`trigger-${amount}`} className="flex cursor-pointer items-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 hover:bg-accent transition-colors">${amount}</Label>
                    </div>
                  ))}
                  <div className="flex items-center">
                    <RadioGroupItem value="custom" id="trigger-custom" className="peer sr-only" />
                    <Label htmlFor="trigger-custom" className="flex cursor-pointer items-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 hover:bg-accent transition-colors">Custom</Label>
                  </div>
                </RadioGroup>
                {triggerAmount === "custom" && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">$</span>
                    <Input type="number" min={1} value={customTrigger} onChange={(e) => setCustomTrigger(e.target.value)} className="w-32" />
                  </div>
                )}
              </div>

              <Separator />
              <div className="space-y-3">
                <Label className="text-sm font-medium">Monthly Spending Cap</Label>
                <RadioGroup value={monthlyCap} onValueChange={setMonthlyCap} className="flex flex-wrap gap-2">
                  <div className="flex items-center">
                    <RadioGroupItem value="none" id="cap-none" className="peer sr-only" />
                    <Label htmlFor="cap-none" className="flex cursor-pointer items-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 hover:bg-accent transition-colors">No limit</Label>
                  </div>
                  {MONTHLY_CAPS.map((amount) => (
                    <div key={amount} className="flex items-center">
                      <RadioGroupItem value={amount.toString()} id={`cap-${amount}`} className="peer sr-only" />
                      <Label htmlFor={`cap-${amount}`} className="flex cursor-pointer items-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 hover:bg-accent transition-colors">${amount}</Label>
                    </div>
                  ))}
                  <div className="flex items-center">
                    <RadioGroupItem value="custom" id="cap-custom" className="peer sr-only" />
                    <Label htmlFor="cap-custom" className="flex cursor-pointer items-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 hover:bg-accent transition-colors">Custom</Label>
                  </div>
                </RadioGroup>
                {monthlyCap === "custom" && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">$</span>
                    <Input type="number" min={10} value={customCap} onChange={(e) => setCustomCap(e.target.value)} className="w-32" />
                  </div>
                )}
                <div className="flex items-start gap-2 rounded-md bg-muted px-3 py-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <p className="text-xs text-muted-foreground">When cap is reached, API requests will return 402.</p>
                </div>
              </div>
            </>
          )}

          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Account</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Email</Label>
              <p className="text-sm text-muted-foreground">john@example.com</p>
            </div>
            <Button variant="outline" size="sm">Change</Button>
          </div>
          <Separator />
          <Button variant="destructive" size="sm">Delete Account</Button>
        </CardContent>
      </Card>
    </div>
  );
}
