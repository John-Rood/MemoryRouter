"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { REUP_AMOUNTS, REUP_TRIGGERS, MONTHLY_CAPS, PRICING } from "@/lib/constants";
import { formatCurrency } from "@/lib/utils";
import { mockUser } from "@/lib/mock-data";
import { Info } from "lucide-react";

export default function SettingsPage() {
  const [autoReup, setAutoReup] = useState(true);
  const [reupAmount, setReupAmount] = useState(String(PRICING.DEFAULT_REUP_AMOUNT));
  const [reupTrigger, setReupTrigger] = useState(String(PRICING.DEFAULT_REUP_TRIGGER));
  const [monthlyCap, setMonthlyCap] = useState("off");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your auto-reup preferences and account settings.</p>
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
                <RadioGroup value={reupAmount} onValueChange={setReupAmount} className="flex flex-wrap gap-3">
                  {REUP_AMOUNTS.map((amount) => (
                    <div key={amount} className="flex items-center space-x-2">
                      <RadioGroupItem value={String(amount)} id={`reup-${amount}`} />
                      <Label htmlFor={`reup-${amount}`} className="cursor-pointer text-sm">{formatCurrency(amount)}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <Separator />
              <div className="space-y-3">
                <Label className="text-sm font-medium">When to Reup</Label>
                <p className="text-xs text-muted-foreground">Trigger reup when balance drops below this amount</p>
                <RadioGroup value={reupTrigger} onValueChange={setReupTrigger} className="flex flex-wrap gap-3">
                  {REUP_TRIGGERS.map((amount) => (
                    <div key={amount} className="flex items-center space-x-2">
                      <RadioGroupItem value={String(amount)} id={`trigger-${amount}`} />
                      <Label htmlFor={`trigger-${amount}`} className="cursor-pointer text-sm">{formatCurrency(amount)}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <Separator />
              <div className="space-y-3">
                <Label className="text-sm font-medium">Monthly Spending Cap</Label>
                <RadioGroup value={monthlyCap} onValueChange={setMonthlyCap} className="flex flex-wrap gap-3">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="off" id="cap-off" />
                    <Label htmlFor="cap-off" className="cursor-pointer text-sm">No limit</Label>
                  </div>
                  {MONTHLY_CAPS.map((cap) => (
                    <div key={cap} className="flex items-center space-x-2">
                      <RadioGroupItem value={String(cap)} id={`cap-${cap}`} />
                      <Label htmlFor={`cap-${cap}`} className="cursor-pointer text-sm">{formatCurrency(cap)}</Label>
                    </div>
                  ))}
                </RadioGroup>
                <div className="flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">When cap is reached, API requests will return 402 until the next billing cycle.</p>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Account</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div><Label className="text-sm font-medium">Email</Label><p className="text-sm text-muted-foreground">{mockUser.email}</p></div>
            <Button variant="outline" size="sm">Change</Button>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div><Label className="text-sm font-medium">Password</Label><p className="text-sm text-muted-foreground">{"\u2022".repeat(12)}</p></div>
            <Button variant="outline" size="sm">Change</Button>
          </div>
          <Separator />
          <Button variant="destructive" size="sm">Delete Account</Button>
        </CardContent>
      </Card>
    </div>
  );
}
