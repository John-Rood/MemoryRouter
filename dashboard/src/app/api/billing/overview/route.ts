import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "active",
    creditBalance: 15.42,
    creditTokens: 15_420_000,
    autoReup: { enabled: true, amount: 20, trigger: 5, monthlyCap: null },
  });
}
