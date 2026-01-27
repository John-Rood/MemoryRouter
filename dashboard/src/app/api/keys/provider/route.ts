import { NextRequest, NextResponse } from "next/server";

export async function GET(_request: NextRequest) {
  return NextResponse.json({ keys: [] });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  return NextResponse.json({ success: true, key: { id: "pk_new", provider: body.provider } });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  return NextResponse.json({ success: true, deleted: searchParams.get("id") });
}
