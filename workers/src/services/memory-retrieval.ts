/**
 * Memory Retrieval Service
 * 
 * THE ONLY place that handles memory search.
 * All provider routes use this function — no duplicated search logic.
 * 
 * Features:
 * - DO+D1 race (fastest wins)
 * - Buffer merge
 * - KRONOS window balancing
 */

import { resolveVaultsForQuery } from './do-router';
import { buildSearchPlan, executeSearchPlan } from './kronos-do';
import { searchD1, getBufferFromD1 } from './d1-search';
import { generateEmbedding, EmbeddingConfig } from './providers';
import { KronosConfig, DEFAULT_KRONOS_CONFIG } from './kronos-config';
import type { MemoryChunk, MemoryRetrievalResult } from '../types/do';

// ==================== TYPES ====================

export interface SearchMemoryParams {
  /** Durable Object namespace binding (required for DO+D1 race) */
  doNamespace?: DurableObjectNamespace;
  /** D1 database for fallback search */
  d1: D1Database;
  /** User's memory key */
  memoryKey: string;
  /** Optional session ID */
  sessionId?: string;
  /** Query text to search for */
  query: string;
  /** Max chunks to return */
  limit?: number;
  /** Embedding configuration */
  embeddingConfig: EmbeddingConfig;
  /** KRONOS time window config */
  kronosConfig?: KronosConfig;
  /** Use DO+D1 race (true) or D1-only (false) */
  useRace?: boolean;
}

export interface SearchResult {
  /** Retrieved memory chunks (sorted by relevance) */
  chunks: MemoryChunk[];
  /** Total token count */
  tokenCount: number;
  /** Breakdown by time window */
  windowBreakdown: { hot: number; working: number; longterm: number };
  /** Pending buffer content (merged into chunks) */
  buffer?: { content: string; tokenCount: number; lastUpdated: number };
  /** Search performance metrics */
  metrics: {
    embeddingMs: number;
    raceMs: number;
    winner: 'do' | 'd1' | 'none';
    totalChunksSearched: number;
  };
}

// ==================== SEARCH MEMORY ====================

/**
 * Search memory with DO+D1 race (fastest wins).
 * 
 * This is THE ONLY function that searches memory.
 * All provider routes call this — no duplicated search logic.
 * 
 * Flow:
 * 1. Generate query embedding via Cloudflare AI
 * 2. Race DO search vs D1 search (fastest wins)
 * 3. Merge buffer content into results
 * 4. Return unified result with metrics
 */
export async function searchMemory(params: SearchMemoryParams): Promise<SearchResult> {
  const {
    doNamespace,
    d1,
    memoryKey,
    sessionId,
    query,
    limit = 30,
    embeddingConfig,
    kronosConfig = DEFAULT_KRONOS_CONFIG,
    useRace = true,
  } = params;

  // Generate query embedding
  const embedStart = Date.now();
  const queryEmbedding = await generateEmbedding(query, undefined, undefined, embeddingConfig);
  const embeddingMs = Date.now() - embedStart;
  console.log(`[MEMORY-RETRIEVAL] Embedding: ${embeddingMs}ms`);

  // ===== NO DO or race disabled: D1-only path =====
  if (!doNamespace || !useRace) {
    const d1Start = Date.now();
    const d1Result = await searchD1(d1, queryEmbedding, memoryKey, sessionId, limit, kronosConfig);
    const d1Buffer = await getBufferFromD1(d1, memoryKey, sessionId);
    const d1Ms = Date.now() - d1Start;

    console.log(`[MEMORY-RETRIEVAL] D1-only search: ${d1Ms}ms, ${d1Result.chunks.length} chunks`);

    return buildSearchResult(d1Result, d1Buffer, {
      embeddingMs,
      raceMs: d1Ms,
      winner: 'd1',
      totalChunksSearched: d1Result.chunks.length,
    });
  }

  // ===== DO-FIRST with D1 FALLBACK =====
  // DO has the full vector index (all chunks). D1 only has the last 2000.
  // Strategy: try DO first with a timeout. If DO is cold (>2s), fall back to D1.
  const raceStart = Date.now();
  const DO_TIMEOUT_MS = 2000;

  // Resolve which vaults to query
  const vaults = resolveVaultsForQuery(doNamespace, memoryKey, sessionId);
  const plan = buildSearchPlan(vaults, limit, kronosConfig);

  type RaceResult = {
    source: 'do' | 'd1';
    result: MemoryRetrievalResult;
    time: number;
  };

  // Start DO search immediately
  const doPromise = executeSearchPlan(plan, queryEmbedding)
    .then(r => ({ source: 'do' as const, result: r, time: Date.now() - raceStart }))
    .catch(() => null);

  // Start D1 search in parallel (backup)
  const d1Promise = searchD1(d1, queryEmbedding, memoryKey, sessionId, limit, kronosConfig)
    .then(r => ({ source: 'd1' as const, result: r, time: Date.now() - raceStart }))
    .catch(() => null);

  const bufferPromise = getBufferFromD1(d1, memoryKey, sessionId).catch(() => null);

  // Wait for DO with a timeout — prefer DO because it has full coverage
  let winner: RaceResult | null = null;

  const doWithTimeout = Promise.race([
    doPromise,
    new Promise<null>(resolve => setTimeout(() => resolve(null), DO_TIMEOUT_MS)),
  ]);

  const doResult = await doWithTimeout;
  if (doResult?.result && doResult.result.chunks.length > 0) {
    // DO responded in time with results — use it (full coverage)
    winner = doResult;
  } else {
    // DO timed out or returned empty — fall back to D1
    const d1Result = await d1Promise;
    if (d1Result?.result) {
      winner = d1Result;
    } else if (doResult?.result) {
      // D1 also empty but DO had a result (even if empty) — use DO
      winner = doResult;
    }
  }

  const raceMs = Date.now() - raceStart;
  const raceWinner = winner?.source || 'none';
  console.log(`[MEMORY-RETRIEVAL] Search: source=${raceWinner}, time=${winner?.time}ms, totalMs=${raceMs}ms`);

  // Handle buffer based on race winner
  let bufferData: { content: string; tokenCount: number; lastUpdated: number } | null = null;

  if (winner?.source === 'do') {
    // DO response includes buffer — extract it
    const doBuffer = (winner.result as MemoryRetrievalResult).buffer;
    if (doBuffer?.content && doBuffer.tokenCount > 0) {
      bufferData = {
        content: doBuffer.content,
        tokenCount: doBuffer.tokenCount,
        lastUpdated: doBuffer.lastUpdated || Date.now(),
      };
    }
  } else if (winner?.source === 'd1') {
    // D1 won — await buffer promise
    const d1Buffer = await bufferPromise;
    if (d1Buffer?.content && d1Buffer.tokenCount > 0) {
      bufferData = d1Buffer;
    }
  }

  return buildSearchResult(
    winner?.result || { chunks: [], tokenCount: 0, windowBreakdown: { hot: 0, working: 0, longterm: 0 } },
    bufferData,
    {
      embeddingMs,
      raceMs,
      winner: raceWinner,
      totalChunksSearched: winner?.result.chunks.length || 0,
    }
  );
}

// ==================== RESULT BUILDER ====================

/**
 * Build final SearchResult with buffer merged into chunks
 */
function buildSearchResult(
  retrieval: MemoryRetrievalResult,
  buffer: { content: string; tokenCount: number; lastUpdated: number } | null,
  metrics: SearchResult['metrics']
): SearchResult {
  const chunks = [...retrieval.chunks];
  let tokenCount = retrieval.tokenCount;
  const windowBreakdown = { ...retrieval.windowBreakdown };

  // Merge buffer as a special "hot" chunk
  if (buffer?.content && buffer.tokenCount > 0) {
    chunks.push({
      id: -1, // Special buffer ID
      role: 'system' as const,
      content: buffer.content,
      timestamp: buffer.lastUpdated,
      score: 1.0, // Buffer always has max relevance
      window: 'hot' as const,
      source: 'buffer',
    });
    tokenCount += buffer.tokenCount;
    windowBreakdown.hot++;
  }

  return {
    chunks,
    tokenCount,
    windowBreakdown,
    buffer: buffer || undefined,
    metrics,
  };
}

// ==================== QUERY EXTRACTION ====================

/**
 * Extract query text from OpenAI-format messages.
 * Takes last N messages for context.
 */
export function extractQueryFromOpenAI(
  messages: Array<{ role: string; content: string }>,
  limit: number = 3
): string {
  const parts: string[] = [];
  const recent = messages.slice(-limit);
  
  for (const msg of recent) {
    if (!msg.content) continue;
    const role = msg.role.toUpperCase();
    parts.push(`[${role}] ${msg.content}`);
  }
  
  return parts.join('\n\n');
}

/**
 * Extract query text from Anthropic-format messages.
 * Handles both string and content block formats.
 */
export function extractQueryFromAnthropic(
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>,
  system?: string,
  limit: number = 3
): string {
  const parts: string[] = [];
  const recent = messages.slice(-limit);
  
  for (const msg of recent) {
    let text: string;
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter(c => c.type === 'text' && c.text)
        .map(c => c.text!)
        .join('\n');
    } else {
      continue;
    }
    
    const role = msg.role.toUpperCase();
    parts.push(`[${role}] ${text}`);
  }
  
  return parts.join('\n\n');
}

/**
 * Extract query text from Google/Gemini-format contents.
 */
export function extractQueryFromGoogle(
  contents: Array<{ role: string; parts: Array<{ text?: string }> }>,
  limit: number = 3
): string {
  const parts: string[] = [];
  const recent = contents.slice(-limit);
  
  for (const content of recent) {
    const text = content.parts
      .filter(p => p.text)
      .map(p => p.text!)
      .join('\n');
    
    if (!text) continue;
    
    const role = content.role === 'model' ? 'ASSISTANT' : 'USER';
    parts.push(`[${role}] ${text}`);
  }
  
  return parts.join('\n\n');
}
