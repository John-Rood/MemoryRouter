import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getUsage } from "@/lib/api/workers-client";

// Generate array of last N days with 0s for missing data
function fillMissingDays(
  dailyUsage: Array<{ date: string; requests: number; tokens_in: number; tokens_out: number }>,
  days: number = 7
): Array<{ date: string; requests: number; tokens_in: number; tokens_out: number }> {
  const result: Array<{ date: string; requests: number; tokens_in: number; tokens_out: number }> = [];
  const usageMap = new Map(dailyUsage.map(d => [d.date, d]));
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    
    const existing = usageMap.get(dateStr);
    result.push(existing || { date: dateStr, requests: 0, tokens_in: 0, tokens_out: 0 });
  }
  
  return result;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  try {
    const usage = await getUsage(user.userId);
    
    // Fill in missing days with 0s for consistent 7-day display
    const filledDailyUsage = fillMissingDays(usage.dailyUsage || [], 7);
    
    return NextResponse.json({
      ...usage,
      dailyUsage: filledDailyUsage,
    });
  } catch (error) {
    console.error("[billing/usage] Error:", error);
    
    // Return 7 days of zeros on error
    const emptyDays = fillMissingDays([], 7);
    
    return NextResponse.json({ 
      totalRequests: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      dailyUsage: emptyDays
    });
  }
}
