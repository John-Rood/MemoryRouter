import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getUsage } from "@/lib/api/workers-client";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  try {
    const usage = await getUsage(user.userId);
    return NextResponse.json(usage);
  } catch (error) {
    console.error("[billing/usage] Error:", error);
    return NextResponse.json({ 
      totalRequests: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      dailyUsage: []
    });
  }
}
