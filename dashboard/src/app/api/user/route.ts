import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  return NextResponse.json({ 
    email: user.email,
    name: user.name,
  });
}
