import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body.amount || body.amount < 5) {
    return NextResponse.json({ error: "Minimum amount is $5" }, { status: 400 });
  }
  return NextResponse.json({ success: true, newBalance: 35.42, tokensAdded: body.amount * 1_000_000 });
}
