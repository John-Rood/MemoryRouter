/**
 * D1 Vector Search
 * 
 * Fast fallback search when Durable Objects are cold.
 * Brute-force cosine similarity over D1 vectors.
 * 
 * Performance: ~30-50ms for 1000 vectors (vs 2500ms DO cold start)
 */

import type { MemoryChunk, MemoryRetrievalResult } from '../types/do';

export interface D1SearchConfig {
  hotWindowHours: number;
  workingWindowDays: number;
  longtermWindowDays: number;
}

export const DEFAULT_D1_SEARCH_CONFIG: D1SearchConfig = {
  hotWindowHours: 4,
  workingWindowDays: 3,
  longtermWindowDays: 90,
};

/**
 * Search D1 for vectors matching a memory key.
 * Uses brute-force cosine similarity in JS.
 * 
 * @param db - D1 database binding
 * @param queryEmbedding - Query vector (Float32Array)
 * @param memoryKey - User's memory key
 * @param sessionId - Optional session ID for session vault
 * @param limit - Max results to return
 * @param config - KRONOS time window config
 */
export async function searchD1(
  db: D1Database,
  queryEmbedding: Float32Array,
  memoryKey: string,
  sessionId?: string,
  limit: number = 30,
  config: D1SearchConfig = DEFAULT_D1_SEARCH_CONFIG
): Promise<MemoryRetrievalResult> {
  const now = Date.now();
  const hotCutoff = now - config.hotWindowHours * 60 * 60 * 1000;
  const workingCutoff = now - config.workingWindowDays * 24 * 60 * 60 * 1000;
  const longtermCutoff = now - config.longtermWindowDays * 24 * 60 * 60 * 1000;

  // Query D1 for all vectors in the time range
  // Core vault: no session_id filter
  // Session vault: filter by session_id
  const sql = sessionId
    ? `SELECT id, content, role, embedding, timestamp, token_count
       FROM chunks
       WHERE memory_key = ? AND session_id = ? AND timestamp > ?
       ORDER BY timestamp DESC
       LIMIT 2000`
    : `SELECT id, content, role, embedding, timestamp, token_count
       FROM chunks
       WHERE memory_key = ? AND (session_id IS NULL OR session_id = '') AND timestamp > ?
       ORDER BY timestamp DESC
       LIMIT 2000`;

  const params = sessionId
    ? [memoryKey, sessionId, longtermCutoff]
    : [memoryKey, longtermCutoff];

  const result = await db.prepare(sql).bind(...params).all();

  if (!result.results || result.results.length === 0) {
    return {
      chunks: [],
      tokenCount: 0,
      windowBreakdown: { hot: 0, working: 0, longterm: 0 },
    };
  }

  // Normalize query vector for cosine similarity
  const normalizedQuery = normalizeVector(queryEmbedding);

  // Compute cosine similarity for each vector
  const scored: Array<{
    id: number;
    content: string;
    role: string;
    timestamp: number;
    tokenCount: number;
    score: number;
    window: 'hot' | 'working' | 'longterm';
  }> = [];

  for (const row of result.results) {
    // Decode embedding from BLOB
    const embeddingBlob = row.embedding as ArrayBuffer;
    const embedding = new Float32Array(embeddingBlob);

    // Normalize stored vector (embeddings may not be pre-normalized)
    const normalizedEmbedding = normalizeVector(embedding);

    // Cosine similarity (dot product of normalized vectors)
    const score = dotProduct(normalizedQuery, normalizedEmbedding);

    // Determine time window
    const timestamp = row.timestamp as number;
    let window: 'hot' | 'working' | 'longterm';
    if (timestamp > hotCutoff) {
      window = 'hot';
    } else if (timestamp > workingCutoff) {
      window = 'working';
    } else {
      window = 'longterm';
    }

    scored.push({
      id: row.id as number,
      content: row.content as string,
      role: row.role as string,
      timestamp,
      tokenCount: row.token_count as number,
      score,
      window,
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Take top N with KRONOS window balancing
  // Allocate ~1/3 per window, but fill from available
  const perWindow = Math.ceil(limit / 3);
  const windowCounts = { hot: 0, working: 0, longterm: 0 };
  const chunks: MemoryChunk[] = [];

  // First pass: fill each window up to allocation
  for (const item of scored) {
    if (windowCounts[item.window] < perWindow && chunks.length < limit) {
      chunks.push({
        id: item.id,
        content: item.content,
        role: item.role as 'user' | 'assistant' | 'system',
        timestamp: item.timestamp,
        score: item.score,
        window: item.window,
        source: 'd1-fallback',
      });
      windowCounts[item.window]++;
    }
  }

  // Second pass: fill remaining slots with highest scores
  if (chunks.length < limit) {
    for (const item of scored) {
      if (chunks.length >= limit) break;
      if (!chunks.find(c => c.id === item.id)) {
        chunks.push({
          id: item.id,
          content: item.content,
          role: item.role as 'user' | 'assistant' | 'system',
          timestamp: item.timestamp,
          score: item.score,
          window: item.window,
          source: 'd1-fallback',
        });
        windowCounts[item.window]++;
      }
    }
  }

  // Calculate token count
  const totalContent = chunks.map(c => c.content).join('');
  const tokenCount = Math.ceil(totalContent.length / 4);

  return {
    chunks,
    tokenCount,
    windowBreakdown: windowCounts,
  };
}

/**
 * Mirror a chunk to D1 for persistence.
 * Called via waitUntil after DO store.
 */
export async function mirrorToD1(
  db: D1Database,
  memoryKey: string,
  vaultType: 'core' | 'session',
  sessionId: string | undefined,
  content: string,
  role: string,
  embedding: Float32Array,
  timestamp: number,
  tokenCount: number,
  model?: string,
  contentHash?: string
): Promise<void> {
  const embeddingBlob = new Uint8Array(embedding.buffer);

  await db.prepare(`
    INSERT INTO chunks (memory_key, vault_type, session_id, content, role, embedding, timestamp, token_count, model, content_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    memoryKey,
    vaultType,
    sessionId || null,
    content,
    role,
    embeddingBlob,
    timestamp,
    tokenCount,
    model || null,
    contentHash || null
  ).run();
}

/**
 * Mirror buffer content to D1 for cold-start fallback.
 * Uses UPSERT to keep only latest buffer state.
 */
export async function mirrorBufferToD1(
  db: D1Database,
  memoryKey: string,
  vaultType: 'core' | 'session',
  sessionId: string | undefined,
  content: string,
  tokenCount: number,
  lastUpdated: number
): Promise<void> {
  await db.prepare(`
    INSERT INTO buffers (memory_key, vault_type, session_id, content, token_count, last_updated)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (memory_key, vault_type, session_id) 
    DO UPDATE SET content = excluded.content, token_count = excluded.token_count, last_updated = excluded.last_updated
  `).bind(
    memoryKey,
    vaultType,
    sessionId || '',
    content,
    tokenCount,
    lastUpdated
  ).run();
}

/**
 * Fetch buffer content from D1 for cold-start fallback.
 */
export async function getBufferFromD1(
  db: D1Database,
  memoryKey: string,
  sessionId?: string
): Promise<{ content: string; tokenCount: number; lastUpdated: number } | null> {
  const vaultType = sessionId ? 'session' : 'core';
  const result = await db.prepare(`
    SELECT content, token_count, last_updated
    FROM buffers
    WHERE memory_key = ? AND vault_type = ? AND session_id = ?
  `).bind(memoryKey, vaultType, sessionId || '').first();

  if (!result) return null;

  return {
    content: result.content as string,
    tokenCount: result.token_count as number,
    lastUpdated: result.last_updated as number,
  };
}

/**
 * Clear buffer from D1 (called when buffer is flushed to chunks).
 */
export async function clearBufferFromD1(
  db: D1Database,
  memoryKey: string,
  sessionId?: string
): Promise<void> {
  const vaultType = sessionId ? 'session' : 'core';
  await db.prepare(`
    DELETE FROM buffers WHERE memory_key = ? AND vault_type = ? AND session_id = ?
  `).bind(memoryKey, vaultType, sessionId || '').run();
}

/**
 * Check if DO is likely warm based on recent D1 activity.
 * Optional optimization — can skip if latency is acceptable.
 */
export async function checkWarmthFromD1(
  db: D1Database,
  memoryKey: string
): Promise<boolean> {
  const warmThreshold = Date.now() - 25000; // 25 seconds (before hibernation)
  
  const result = await db.prepare(`
    SELECT MAX(created_at) as last_write
    FROM chunks
    WHERE memory_key = ?
  `).bind(memoryKey).first();

  if (!result || !result.last_write) return false;
  
  // D1 stores datetime as ISO string
  const lastWrite = new Date(result.last_write as string).getTime();
  return lastWrite > warmThreshold;
}

// ==================== Vector Math ====================

function normalizeVector(vec: Float32Array): Float32Array {
  let magnitude = 0;
  for (let i = 0; i < vec.length; i++) {
    magnitude += vec[i] * vec[i];
  }
  magnitude = Math.sqrt(magnitude);

  if (magnitude === 0) return vec;

  const normalized = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    normalized[i] = vec[i] / magnitude;
  }
  return normalized;
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}
