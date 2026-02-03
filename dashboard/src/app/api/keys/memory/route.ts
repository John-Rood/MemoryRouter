import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { 
  getMemoryKeys, 
  createMemoryKey, 
  deleteMemoryKey 
} from "@/lib/api/workers-client";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  try {
    const { keys } = await getMemoryKeys(user.userId);
    
    // Transform to dashboard format
    const formattedKeys = keys.map(k => ({
      id: k.id,
      key: k.key,
      name: k.name,
      isActive: k.is_active === 1,
      tokensStored: k.tokens_stored,
      tokensRetrieved: k.tokens_retrieved,
      requestCount: k.request_count,
      lastUsedAt: k.last_used_at,
      createdAt: k.created_at,
    }));
    
    return NextResponse.json({ keys: formattedKeys });
  } catch (error) {
    console.error("Failed to get memory keys:", error);
    return NextResponse.json({ error: "Failed to get memory keys" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  try {
    const body = await request.json();
    const { key } = await createMemoryKey(user.userId, body.name);
    
    return NextResponse.json({ 
      success: true, 
      key: {
        id: key.id,
        key: key.key,
        name: key.name,
        isActive: key.is_active === 1,
        createdAt: key.created_at,
      }
    });
  } catch (error) {
    console.error("Failed to create memory key:", error);
    return NextResponse.json({ error: "Failed to create memory key" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser(request);
  
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  const { searchParams } = new URL(request.url);
  const keyId = searchParams.get("id");
  
  if (!keyId) {
    return NextResponse.json({ error: "Missing key id" }, { status: 400 });
  }
  
  try {
    await deleteMemoryKey(user.userId, keyId);
    return NextResponse.json({ success: true, deleted: keyId });
  } catch (error) {
    console.error("Failed to delete memory key:", error);
    return NextResponse.json({ error: "Failed to delete memory key" }, { status: 500 });
  }
}
