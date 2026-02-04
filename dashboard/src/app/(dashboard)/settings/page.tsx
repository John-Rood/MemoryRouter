"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, Bell, Shield, Trash2 } from "lucide-react";

export default function SettingsPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [retentionDays, setRetentionDays] = useState("90");
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [lowBalanceAlert, setLowBalanceAlert] = useState(true);
  const [usageReports, setUsageReports] = useState(false);
  
  const handleSaveProfile = () => {
    // In production, this would update the user via API
    alert("Profile saved!");
  };
  
  const handleDeleteAccount = () => {
    if (confirm("Are you sure you want to delete your account? This action cannot be undone.")) {
      alert("Account deletion requested");
    }
  };
  
  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold gradient-text">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Manage your account and preferences
        </p>
      </div>
      
      {/* Profile Settings */}
      <Card className="glass-card border-border/10">
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4" />
            Profile
          </CardTitle>
          <CardDescription className="text-xs">Your account information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-sm">Display Name</Label>
              <Input 
                id="name" 
                value={name} 
                onChange={(e) => setName(e.target.value)}
                className="bg-muted/50 h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm">Email</Label>
              <Input 
                id="email" 
                type="email" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)}
                className="bg-muted/50 h-9"
                disabled
              />
              <p className="text-xs text-muted-foreground">Email cannot be changed</p>
            </div>
          </div>
          <Button onClick={handleSaveProfile} size="sm">Save Changes</Button>
        </CardContent>
      </Card>
      
      {/* Memory Settings */}
      <Card className="glass-card border-border/10">
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" />
            Memory Settings
          </CardTitle>
          <CardDescription className="text-xs">Configure default memory behavior</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 px-4 pb-4">
          <div className="space-y-1.5">
            <Label htmlFor="retention" className="text-sm">Default Retention Period</Label>
            <Select value={retentionDays} onValueChange={setRetentionDays}>
              <SelectTrigger className="w-[180px] bg-muted/50 h-9">
                <SelectValue placeholder="Select retention" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="60">60 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
                <SelectItem value="180">180 days</SelectItem>
                <SelectItem value="365">365 days</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              How long to retain memories before automatic cleanup
            </p>
          </div>
        </CardContent>
      </Card>
      
      {/* Notification Settings */}
      <Card className="glass-card border-border/10">
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" />
            Notifications
          </CardTitle>
          <CardDescription className="text-xs">Choose what alerts you receive</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm">Email Notifications</Label>
              <p className="text-xs text-muted-foreground">
                Receive important account updates via email
              </p>
            </div>
            <Switch 
              checked={emailNotifications} 
              onCheckedChange={setEmailNotifications}
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm">Low Balance Alerts</Label>
              <p className="text-xs text-muted-foreground">
                Get notified when your credit balance is low
              </p>
            </div>
            <Switch 
              checked={lowBalanceAlert} 
              onCheckedChange={setLowBalanceAlert}
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm">Weekly Usage Reports</Label>
              <p className="text-xs text-muted-foreground">
                Receive a summary of your usage each week
              </p>
            </div>
            <Switch 
              checked={usageReports} 
              onCheckedChange={setUsageReports}
            />
          </div>
        </CardContent>
      </Card>
      
      {/* Danger Zone */}
      <Card className="glass-card border-destructive/30">
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <Trash2 className="h-4 w-4" />
            Danger Zone
          </CardTitle>
          <CardDescription className="text-xs">Irreversible actions</CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="font-medium text-sm">Delete Account</p>
              <p className="text-xs text-muted-foreground">
                Permanently delete your account and all associated data
              </p>
            </div>
            <Button 
              variant="destructive" 
              onClick={handleDeleteAccount}
              size="sm"
            >
              Delete Account
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
