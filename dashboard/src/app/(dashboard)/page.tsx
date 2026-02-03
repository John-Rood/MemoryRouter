"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Zap, Clock, TrendingUp } from "lucide-react";

// Mock data for MVP (will be replaced with real data from Workers API)
const mockStats = {
  tokensStored: 2450000,
  tokensRetrieved: 18200000,
  requestCount: 847,
  estimatedSavings: 142.50,
  activeSince: "Jan 15, 2026",
};

const mockUsageHistory = [
  { date: "Jan 27", stored: 125000, retrieved: 890000 },
  { date: "Jan 28", stored: 180000, retrieved: 1200000 },
  { date: "Jan 29", stored: 220000, retrieved: 1450000 },
  { date: "Jan 30", stored: 195000, retrieved: 1320000 },
  { date: "Jan 31", stored: 280000, retrieved: 1680000 },
  { date: "Feb 1", stored: 310000, retrieved: 1890000 },
  { date: "Feb 2", stored: 245000, retrieved: 1540000 },
];

function formatTokens(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toString();
}

export default function OverviewPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold gradient-text">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Monitor your memory usage and savings
        </p>
      </div>
      
      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="glass-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tokens Stored</CardTitle>
            <Zap className="h-4 w-4 text-neon-green" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(mockStats.tokensStored)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Total memory capacity used
            </p>
          </CardContent>
        </Card>
        
        <Card className="glass-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tokens Retrieved</CardTitle>
            <BarChart3 className="h-4 w-4 text-neon-blue" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(mockStats.tokensRetrieved)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Context injected into prompts
            </p>
          </CardContent>
        </Card>
        
        <Card className="glass-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">API Requests</CardTitle>
            <Clock className="h-4 w-4 text-neon-purple" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockStats.requestCount.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Total requests this month
            </p>
          </CardContent>
        </Card>
        
        <Card className="glass-card border-border/50 border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Est. Savings</CardTitle>
            <TrendingUp className="h-4 w-4 text-neon-green" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold money-gradient">${mockStats.estimatedSavings.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Inference costs avoided
            </p>
          </CardContent>
        </Card>
      </div>
      
      {/* Usage Chart */}
      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle>Usage Over Time</CardTitle>
          <CardDescription>Daily token storage and retrieval</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] flex items-end justify-between gap-2">
            {mockUsageHistory.map((day, i) => (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full flex flex-col gap-1 items-center">
                  {/* Retrieved bar */}
                  <div 
                    className="w-full bg-neon-blue/30 rounded-t"
                    style={{ height: `${(day.retrieved / 2000000) * 200}px` }}
                  />
                  {/* Stored bar */}
                  <div 
                    className="w-full bg-neon-green/50 rounded-t"
                    style={{ height: `${(day.stored / 400000) * 50}px` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{day.date.split(' ')[1]}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t border-border/30">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-neon-green/50"></div>
              <span className="text-xs text-muted-foreground">Stored</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-neon-blue/30"></div>
              <span className="text-xs text-muted-foreground">Retrieved</span>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="glass-card border-border/50 hover:border-primary/30 transition-colors cursor-pointer" onClick={() => window.location.href = '/keys'}>
          <CardHeader>
            <CardTitle className="text-lg">Manage Keys</CardTitle>
            <CardDescription>Create and manage your memory keys</CardDescription>
          </CardHeader>
        </Card>
        
        <Card className="glass-card border-border/50 hover:border-primary/30 transition-colors cursor-pointer" onClick={() => window.location.href = '/billing'}>
          <CardHeader>
            <CardTitle className="text-lg">Add Credits</CardTitle>
            <CardDescription>Top up your balance for continued service</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
