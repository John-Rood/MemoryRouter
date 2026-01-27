import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ enabled: true, amount: 20, trigger: 5, monthlyCap: null });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  return NextResponse.json({ success: true, settings: body });
}
