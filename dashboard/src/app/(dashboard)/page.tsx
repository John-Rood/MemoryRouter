"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Zap, PiggyBank, Plus, Copy, BookOpen, Key, ArrowRight } from "lucide-react";
import { formatTokens } from "@/lib/constants";

const mockData = {
  creditBalance: 15.42,
  creditTokens: 15_420_000,
  tokensUsed: 36_200_000,
  tokensSaved: 142_800_000,
  savingsUsd: 428,
  weeklyUsage: [
    { day: "Mon", stored: 320_000, retrieved: 890_000 },
    { day: "Tue", stored: 450_000, retrieved: 1_200_000 },
    { day: "Wed", stored: 580_000, retrieved: 1_500_000 },
    { day: "Thu", stored: 720_000, retrieved: 1_800_000 },
    { day: "Fri", stored: 890_000, retrieved: 2_100_000 },
    { day: "Sat", stored: 540_000, retrieved: 1_400_000 },
    { day: "Sun", stored: 380_000, retrieved: 1_000_000 },
  ],
  activeKeys: [
    { name: "main-assistant", sessions: 3 },
    { name: "user-12345", sessions: 1 },
    { name: "project-alpha", sessions: 2 },
  ],
};

function UsageChart({ data }: { data: { day: string; stored: number; retrieved: number }[] }) {
  const maxVal = Math.max(...data.map((d) => d.stored + d.retrieved));
  return (
    <div className="flex items-end gap-2 h-40">
      {data.map((d) => {
        const sH = (d.stored / maxVal) * 100;
        const rH = (d.retrieved / maxVal) * 100;
        return (
          <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex flex-col justify-end h-[120px] gap-0.5">
              <div className="w-full bg-muted-foreground/20 rounded-t-sm" style={{ height: `${rH}%` }} />
              <div className="w-full bg-primary rounded-t-sm" style={{ height: `${sH}%` }} />
            </div>
            <span className="text-xs text-muted-foreground">{d.day}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function OverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Welcome back, John</h1>
        <p className="text-muted-foreground">Here&apos;s what&apos;s happening with your AI memory.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Credit Balance</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${mockData.creditBalance.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">{formatTokens(mockData.creditTokens)} tokens</p>
            <Link href="/billing">
              <Button variant="outline" size="sm" className="mt-3"><Plus className="mr-1 h-3 w-3" />Add Funds</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Tokens Used</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(mockData.tokensUsed)}</div>
            <p className="text-xs text-muted-foreground">this month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Tokens Saved</CardTitle>
            <PiggyBank className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(mockData.tokensSaved)}</div>
            <p className="text-xs text-muted-foreground">from memory</p>
            <p className="mt-1 text-sm text-green-500">${mockData.savingsUsd} saved</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Usage This Week</CardTitle>
        </CardHeader>
        <CardContent>
          <UsageChart data={mockData.weeklyUsage} />
          <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-primary" />Stored
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-muted-foreground/20" />Retrieved (free)
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Active Memory Keys</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {mockData.activeKeys.map((key) => (
              <div key={key.name} className="flex items-center justify-between text-sm">
                <span className="font-mono text-muted-foreground">{key.name}</span>
                <Badge variant="secondary">{key.sessions} {key.sessions === 1 ? "session" : "sessions"}</Badge>
              </div>
            ))}
            <Link href="/keys">
              <Button variant="ghost" size="sm" className="w-full mt-2">View All <ArrowRight className="ml-1 h-3 w-3" /></Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Quick Actions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Link href="/keys">
              <Button variant="outline" size="sm" className="w-full justify-start"><Key className="mr-2 h-4 w-4" />New Memory Key</Button>
            </Link>
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => navigator.clipboard.writeText("mr_live_xxxxxxxxxxxxxxxxxxxx")}>
              <Copy className="mr-2 h-4 w-4" />Copy API Key
            </Button>
            <a href="https://docs.memoryrouter.ai" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="w-full justify-start"><BookOpen className="mr-2 h-4 w-4" />View Docs</Button>
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
