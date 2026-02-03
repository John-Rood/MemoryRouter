"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, Zap, TrendingUp, Sparkles, ArrowUpRight, RefreshCw, Loader2 } from "lucide-react";

interface Stats {
  totalMemoryKeys: number;
  totalRequests: number;
  totalTokensStored: number;
  totalTokensRetrieved: number;
  estimatedSavings: string;
}

interface DailyUsage {
  date: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
}

const formatTokens = (tokens: number) => {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toString();
};

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard/stats");
      if (response.ok) {
        const data = await response.json();
        setStats(data.stats);
        setDailyUsage(data.dailyUsage || []);
      }
    } catch (error) {
      console.error("Failed to fetch stats:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Get last 7 days of usage for the chart
  const chartData = dailyUsage.slice(-7);
  const maxRequests = Math.max(...chartData.map(d => d.requests), 1);

  if (isLoading) {
    return (
      <div className="space-y-8 animate-pulse">
        {/* Header skeleton */}
        <div>
          <div className="h-9 w-40 bg-muted/50 rounded" />
          <div className="h-5 w-56 bg-muted/30 rounded mt-2" />
        </div>
        
        {/* Stats cards skeleton */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="glass-card border-border/50">
              <CardHeader className="pb-2">
                <div className="h-4 w-24 bg-muted/50 rounded" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-16 bg-muted/50 rounded" />
                <div className="h-3 w-32 bg-muted/30 rounded mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
        
        {/* Chart skeleton */}
        <Card className="glass-card border-border/50">
          <CardHeader>
            <div className="h-6 w-40 bg-muted/50 rounded" />
            <div className="h-4 w-32 bg-muted/30 rounded mt-1" />
          </CardHeader>
          <CardContent>
            <div className="h-[200px] flex items-end gap-2">
              {[...Array(7)].map((_, i) => (
                <div key={i} className="flex-1 bg-muted/30 rounded-t" style={{ height: `${30 + Math.random() * 100}px` }} />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-text">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Your AI memory at a glance
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={fetchStats}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="glass-card border-border/50 hover:border-primary/20 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Memory Keys
            </CardTitle>
            <Brain className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalMemoryKeys || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Active memory contexts
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-border/50 hover:border-primary/20 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tokens Stored
            </CardTitle>
            <Zap className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(stats?.totalTokensStored || 0)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              In your memory vault
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-border/50 hover:border-primary/20 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              API Requests
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(stats?.totalRequests || 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Total requests processed
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-border/50 hover:border-primary/20 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Est. Savings
            </CardTitle>
            <Sparkles className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold money-gradient">${stats?.estimatedSavings || "0.00"}</div>
            <p className="text-xs text-muted-foreground mt-1">
              From memory reuse
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Usage Chart */}
      <Card className="glass-card border-border/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Usage (Last 7 Days)</CardTitle>
              <CardDescription>Daily API request volume</CardDescription>
            </div>
            {chartData.length > 0 && (
              <Badge variant="outline" className="border-primary/30 text-primary">
                {chartData.reduce((sum, d) => sum + d.requests, 0).toLocaleString()} requests
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <div className="h-[200px] flex items-end gap-2">
              {chartData.map((day, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-2">
                  <div className="w-full flex flex-col items-center">
                    <span className="text-xs text-muted-foreground mb-1">
                      {day.requests.toLocaleString()}
                    </span>
                    <div
                      className="w-full bg-primary/20 rounded-t relative overflow-hidden"
                      style={{ height: `${Math.max((day.requests / maxRequests) * 150, 4)}px` }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-t from-primary/40 to-primary/10" />
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <TrendingUp className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No usage data yet</p>
                <p className="text-sm">Start making API requests to see your usage</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="glass-card border-border/50 hover:border-primary/20 transition-colors group cursor-pointer"
              onClick={() => window.location.href = '/keys'}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-lg bg-primary/10">
                  <Brain className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Manage Keys</h3>
                  <p className="text-sm text-muted-foreground">Create and manage API keys</p>
                </div>
              </div>
              <ArrowUpRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-border/50 hover:border-primary/20 transition-colors group cursor-pointer"
              onClick={() => window.location.href = '/billing'}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-lg bg-primary/10">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Billing & Usage</h3>
                  <p className="text-sm text-muted-foreground">View credits and add funds</p>
                </div>
              </div>
              <ArrowUpRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
