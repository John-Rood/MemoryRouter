import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { 
  getProviderKeys, 
  saveProviderKey, 
  deleteProviderKey 
} from "@/lib/api/workers-client";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  try {
    const { keys } = await getProviderKeys(user.userId);
    
    // Transform to dashboard format (never expose the full key!)
    const formattedKeys = keys.map(k => ({
      id: k.id,
      provider: k.provider,
      keyHint: k.key_hint, // Last 4 chars only
      nickname: k.nickname,
      isActive: k.is_active === 1,
      lastVerifiedAt: k.last_verified_at,
      createdAt: k.created_at,
    }));
    
    return NextResponse.json({ keys: formattedKeys });
  } catch (error) {
    console.error("Failed to get provider keys:", error);
    return NextResponse.json({ error: "Failed to get provider keys" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  try {
    const body = await request.json();
    const { provider, apiKey, nickname } = body;
    
    if (!provider || !apiKey) {
      return NextResponse.json({ error: "Missing provider or apiKey" }, { status: 400 });
    }
    
    const result = await saveProviderKey(user.userId, { provider, apiKey, nickname });
    
    return NextResponse.json({ 
      success: true, 
      provider: result.provider,
      keyHint: result.keyHint,
    });
  } catch (error) {
    console.error("Failed to save provider key:", error);
    return NextResponse.json({ error: "Failed to save provider key" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser(request);
  
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");
  
  if (!provider) {
    return NextResponse.json({ error: "Missing provider" }, { status: 400 });
  }
  
  try {
    await deleteProviderKey(user.userId, provider);
    return NextResponse.json({ success: true, deleted: provider });
  } catch (error) {
    console.error("Failed to delete provider key:", error);
    return NextResponse.json({ error: "Failed to delete provider key" }, { status: 500 });
  }
}
