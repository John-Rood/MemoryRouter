/**
 * VectorVault Memory Service
 * 
 * Handles memory storage and retrieval with KRONOS temporal windows.
 * Session-aware: each session_id gets its own isolated vault.
 * 
 * STUB IMPLEMENTATION: In production, this connects to VectorVault Cloud.
 * For V1, we use an in-memory store to demonstrate the full flow.
 * 
 * Reference: memoryrouter-product-spec.md Sections 4.2, 4.5, 6
 */

import type { 
  MemoryChunk, 
  MemoryRetrievalResult, 
  MemoryStoreInput,
  SessionInfo,
  KronosWindow,
} from '../types';
import { kronosRetrieve, formatKronosResult } from './kronos';

// =============================================================================
// IN-MEMORY STORE (stub for V1 — replace with VectorVault Cloud)
// =============================================================================

/**
 * In-memory vault storage
 * Key format: `${memoryKey}::${sessionId}`
 */
const vaultStore: Map<string, MemoryChunk[]> = new Map();

/**
 * Session metadata store
 * Key format: `${memoryKey}::${sessionId}`
 */
const sessionStore: Map<string, SessionInfo> = new Map();

function vaultKey(memoryKey: string, sessionId: string): string {
  return `${memoryKey}::${sessionId}`;
}

function generateId(): string {
  // Use crypto for UUID-like IDs
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// =============================================================================
// SIMPLE SIMILARITY (stub — production uses embeddings)
// =============================================================================

/**
 * Simple keyword-based similarity for stub implementation
 * In production: embed query with text-embedding-3-large, cosine similarity
 */
function simpleSimilarity(query: string, content: string): number {
  const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const contentWords = new Set(content.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  
  if (queryWords.size === 0 || contentWords.size === 0) return 0;
  
  let matches = 0;
  for (const word of queryWords) {
    if (contentWords.has(word)) matches++;
  }
  
  return matches / Math.max(queryWords.size, 1);
}

/**
 * Estimate token count from text
 * ~4 characters per token for English text
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// =============================================================================
// RETRIEVAL
// =============================================================================

/**
 * Retrieve relevant memory chunks using KRONOS temporal engine
 * 
 * Flow:
 * 1. Get all chunks from the session vault
 * 2. Score each chunk by similarity to query
 * 3. Pass to KRONOS for temporal windowing + equal allocation
 */
export async function retrieveMemory(
  memoryKey: string,
  sessionId: string,
  query: string,
  options: { limit?: number; recencyBias?: 'low' | 'medium' | 'high' } = {}
): Promise<MemoryRetrievalResult> {
  const limit = options.limit ?? 12;
  const recencyBias = options.recencyBias ?? 'medium';
  const key = vaultKey(memoryKey, sessionId);
  
  console.log(`[VECTORVAULT] Retrieve from vault: ${key}`);
  console.log(`[VECTORVAULT] Query: "${query.substring(0, 80)}..."`);
  console.log(`[VECTORVAULT] Limit: ${limit}, Recency: ${recencyBias}`);
  
  // Get all chunks from the vault
  const chunks = vaultStore.get(key) ?? [];
  
  if (chunks.length === 0) {
    console.log('[VECTORVAULT] No chunks in vault — empty session');
    return {
      chunks: [],
      tokenCount: 0,
      windowBreakdown: { hot: 0, working: 0, long_term: 0, archive: 0 },
      query,
    };
  }
  
  // Score each chunk by similarity
  const scored = chunks.map(chunk => ({
    ...chunk,
    similarity: simpleSimilarity(query, chunk.content),
  }));
  
  // Filter to chunks with any relevance (or return most recent if nothing matches)
  const relevant = scored.filter(c => c.similarity > 0);
  const candidates = relevant.length > 0 
    ? relevant 
    : scored.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, limit);
  
  // Pass to KRONOS for temporal retrieval
  const result = kronosRetrieve(candidates, { limit, recencyBias });
  result.query = query;
  
  console.log(formatKronosResult(result));
  
  return result;
}

// =============================================================================
// STORAGE
// =============================================================================

/**
 * Store a message in the session vault
 * 
 * Flow:
 * 1. Create a MemoryChunk with metadata
 * 2. Append to the session's vault
 * 3. Update session metadata
 * 
 * In production: embed with text-embedding-3-large, store in VectorVault Cloud
 */
export async function storeMemory(input: MemoryStoreInput): Promise<MemoryChunk> {
  const key = vaultKey(input.memoryKey, input.sessionId);
  const tokenCount = estimateTokens(input.content);
  
  const chunk: MemoryChunk = {
    id: generateId(),
    role: input.role,
    content: input.content,
    timestamp: new Date(),
    sessionId: input.sessionId,
    model: input.model,
    provider: input.provider,
    tokenCount,
    metadata: input.metadata,
  };
  
  // Append to vault
  if (!vaultStore.has(key)) {
    vaultStore.set(key, []);
  }
  vaultStore.get(key)!.push(chunk);
  
  // Update session metadata
  updateSessionMeta(input.memoryKey, input.sessionId, tokenCount);
  
  console.log(`[VECTORVAULT] Stored chunk: ${chunk.id} (${chunk.role}, ${tokenCount} tokens)`);
  
  return chunk;
}

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

/**
 * Update session metadata after a store operation
 */
function updateSessionMeta(memoryKey: string, sessionId: string, newTokens: number): void {
  const key = vaultKey(memoryKey, sessionId);
  const existing = sessionStore.get(key);
  const chunks = vaultStore.get(key) ?? [];
  
  if (existing) {
    existing.lastUsedAt = new Date();
    existing.chunkCount = chunks.length;
    existing.tokenCount += newTokens;
  } else {
    sessionStore.set(key, {
      sessionId,
      memoryKey,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      chunkCount: chunks.length,
      tokenCount: newTokens,
    });
  }
}

/**
 * Ensure session exists (lazy initialization)
 * Called on first use — creates session metadata if it doesn't exist
 */
export async function ensureSession(memoryKey: string, sessionId: string): Promise<SessionInfo> {
  const key = vaultKey(memoryKey, sessionId);
  
  if (!sessionStore.has(key)) {
    const session: SessionInfo = {
      sessionId,
      memoryKey,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      chunkCount: 0,
      tokenCount: 0,
    };
    sessionStore.set(key, session);
    console.log(`[VECTORVAULT] Created new session: ${sessionId} for key: ${memoryKey}`);
    return session;
  }
  
  const session = sessionStore.get(key)!;
  session.lastUsedAt = new Date();
  return session;
}

/**
 * List all sessions for a memory key
 */
export async function listSessions(memoryKey: string): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = [];
  
  for (const [key, session] of sessionStore.entries()) {
    if (key.startsWith(`${memoryKey}::`)) {
      sessions.push(session);
    }
  }
  
  return sessions.sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime());
}

/**
 * Get a specific session's info
 */
export async function getSession(memoryKey: string, sessionId: string): Promise<SessionInfo | null> {
  const key = vaultKey(memoryKey, sessionId);
  return sessionStore.get(key) ?? null;
}

/**
 * Delete a session and all its memory
 */
export async function deleteSession(memoryKey: string, sessionId: string): Promise<boolean> {
  const key = vaultKey(memoryKey, sessionId);
  const existed = sessionStore.has(key) || vaultStore.has(key);
  
  sessionStore.delete(key);
  vaultStore.delete(key);
  
  console.log(`[VECTORVAULT] Deleted session: ${sessionId} for key: ${memoryKey}`);
  return existed;
}

/**
 * Search session memory (for debugging)
 */
export async function searchSession(
  memoryKey: string, 
  sessionId: string, 
  query: string,
  limit: number = 10
): Promise<MemoryChunk[]> {
  const key = vaultKey(memoryKey, sessionId);
  const chunks = vaultStore.get(key) ?? [];
  
  if (!query) {
    return chunks.slice(-limit);
  }
  
  return chunks
    .map(c => ({ ...c, similarity: simpleSimilarity(query, c.content) }))
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, limit);
}

// =============================================================================
// MEMORY STATS
// =============================================================================

/**
 * Get memory stats for a key (all sessions combined)
 */
export async function getMemoryStats(memoryKey: string): Promise<{
  totalChunks: number;
  totalTokens: number;
  sessionCount: number;
  lastUsed: Date | null;
}> {
  let totalChunks = 0;
  let totalTokens = 0;
  let sessionCount = 0;
  let lastUsed: Date | null = null;
  
  for (const [key, session] of sessionStore.entries()) {
    if (key.startsWith(`${memoryKey}::`)) {
      sessionCount++;
      totalChunks += session.chunkCount;
      totalTokens += session.tokenCount;
      
      if (!lastUsed || session.lastUsedAt > lastUsed) {
        lastUsed = session.lastUsedAt;
      }
    }
  }
  
  return { totalChunks, totalTokens, sessionCount, lastUsed };
}

/**
 * Clear all memory for a key (all sessions)
 */
export async function clearMemory(memoryKey: string): Promise<number> {
  let cleared = 0;
  
  for (const key of [...vaultStore.keys()]) {
    if (key.startsWith(`${memoryKey}::`)) {
      vaultStore.delete(key);
      cleared++;
    }
  }
  
  for (const key of [...sessionStore.keys()]) {
    if (key.startsWith(`${memoryKey}::`)) {
      sessionStore.delete(key);
    }
  }
  
  console.log(`[VECTORVAULT] Cleared all memory for key: ${memoryKey} (${cleared} vaults)`);
  return cleared;
}
