import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getUsage, getMemoryKeys } from "@/lib/api/workers-client";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  try {
    // Fetch usage stats and memory keys in parallel
    const [usageData, keysData] = await Promise.all([
      getUsage(user.userId),
      getMemoryKeys(user.userId),
    ]);
    
    // Calculate stats
    const totalRequests = usageData.totalRequests || 0;
    const totalTokensIn = usageData.totalTokensIn || 0;
    const totalTokensOut = usageData.totalTokensOut || 0;
    const totalTokens = totalTokensIn + totalTokensOut;
    
    // Estimate savings (rough calculation: tokens * $0.00001 saved vs not using memory)
    // This is a simplified estimate - memory retrieval saves re-processing
    const estimatedSavings = (totalTokensOut * 0.00003); // ~$0.03/1k output tokens saved
    
    return NextResponse.json({
      stats: {
        totalMemoryKeys: keysData.keys?.length || 0,
        totalRequests,
        totalTokensStored: totalTokensIn,
        totalTokensRetrieved: totalTokensOut,
        estimatedSavings: estimatedSavings.toFixed(2),
      },
      dailyUsage: usageData.dailyUsage?.map((d: { date: string; requests: number; tokens_in: number; tokens_out: number }) => ({
        date: d.date,
        requests: d.requests,
        tokensIn: d.tokens_in,
        tokensOut: d.tokens_out,
      })) || [],
    });
  } catch (error) {
    console.error("Failed to get dashboard stats:", error);
    // Return zeros on error
    return NextResponse.json({
      stats: {
        totalMemoryKeys: 0,
        totalRequests: 0,
        totalTokensStored: 0,
        totalTokensRetrieved: 0,
        estimatedSavings: "0.00",
      },
      dailyUsage: [],
    });
  }
}
