import { NextRequest, NextResponse } from "next/server";

export async function GET(_request: NextRequest) {
  return NextResponse.json({ keys: [] });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const keyId = "mk_" + Math.random().toString(36).slice(2, 14);
  return NextResponse.json({ success: true, key: { id: keyId, name: body.name || keyId } });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  return NextResponse.json({ success: true, deleted: searchParams.get("id") });
}
