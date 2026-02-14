# MemoryRouter: Native + Core Modular Architecture Refactor Plan

**Date:** 2026-02-14  
**Author:** Architecture Analysis (Claudius)  
**Version:** 1.0

---

## 1. Executive Summary

**The Problem:** MemoryRouter's storage logic is duplicated across provider routes (`chat.ts`, `anthropic.ts`), with each implementing ~65-100 lines of identical storage code. Delete/clear operations only affect the Durable Object, leaving stale data in D1 that returns via the cold-start fallback race.

**The Solution:** Consolidate ALL memory operations into two core service modules (`memory-core.ts` for storage/delete/clear, `memory-retrieval.ts` for search), then refactor provider routes to ONLY handle format transformation. D1 sync fixes become single-point changes.

**The Result:** One function per operation. Bug fixes apply once. New providers add with zero storage code. D1 stays in sync because mirror logic lives in exactly one place.

---

## 2. Current Architecture Problems

### 2.1 Duplicated Storage Logic

| File | Function | Lines | Operations |
|------|----------|-------|------------|
| `chat.ts` | `storeConversationDO()` | 933-1030 (~100 lines) | /store-chunked → embed → storeToVault → mirrorToD1 → mirrorBufferToD1 |
| `anthropic.ts` | `storeToMemory()` | 484-547 (~65 lines) | /store-chunked → embed → storeToVault → mirrorToD1 → mirrorBufferToD1 |
| `google.ts` | *none* | — | No storage implementation (retrieval only) |

**Code Reference — chat.ts:storeConversationDO():**
```typescript
// Lines 933-1030: ~100 lines doing exactly what anthropic.ts does
async function storeConversationDO(...): Promise<void> {
  const stub = resolveVaultForStore(doNamespace, memoryKey, sessionId);
  
  for (const item of contentToProcess) {
    const chunkResponse = await stub.fetch(new Request('https://do/store-chunked', {...}));
    const chunkResult = await chunkResponse.json();
    
    for (const chunkContent of chunkResult.chunksToEmbed) {
      const embedding = await generateEmbedding(chunkContent, ...);
      const storeResult = await storeToVault(stub, embedding, chunkContent, ...);
      
      // D1 mirror
      if (d1 && storeResult.stored && ctx) {
        ctx.waitUntil(mirrorToD1(d1, memoryKey, ...));
      }
    }
    
    // Buffer mirror
    if (d1 && ctx) {
      const bufferRes = await stub.fetch(new Request('https://do/buffer', { method: 'GET' }));
      if (bufferRes.ok) {
        ctx.waitUntil(mirrorBufferToD1(d1, memoryKey, ...));
      }
    }
  }
}
```

**Code Reference — anthropic.ts:storeToMemory():**
```typescript
// Lines 484-547: Same logic, different function signature
async function storeToMemory(
  env: AnthropicEnv, ctx: ExecutionContext, memoryKey: string, ...
): Promise<void> {
  const stub = resolveVaultForStore(env.VAULT_DO, memoryKey, sessionId);
  
  // Store user message
  const chunkRes = await stub.fetch(new Request('https://do/store-chunked', {...}));
  const chunkResult = await chunkRes.json();
  for (const chunk of chunkResult.chunksToEmbed) {
    const embedding = await generateEmbedding(chunk, ...);
    const storeResult = await storeToVault(stub, embedding, chunk, ...);
    if (env.VECTORS_D1 && storeResult.stored) {
      ctx.waitUntil(mirrorToD1(env.VECTORS_D1, memoryKey, ...));
    }
  }
  
  // Store assistant response (same pattern)
  // Buffer mirror (same pattern)
}
```

### 2.2 Broken D1 Sync Operations

From the audit (`2026-02-14-do-d1-sync-audit.md`):

| Operation | DO Status | D1 Status | Impact |
|-----------|-----------|-----------|--------|
| `DELETE /v1/memory` | ✅ `/clear` called | ❌ `chunks` untouched | Stale data returns from D1 fallback |
| `/reset` endpoint | ✅ Full reset | ❌ `chunks` untouched | Same issue after reset |
| Archival purge | ✅ `/delete` with `olderThan` | ❌ Old chunks remain | Storage bloat in D1 |
| Buffer clear | ✅ `pending_buffer` cleared | ❌ `clearBufferFromD1()` never called | Buffer inconsistency |

**Code Reference — index.ts DELETE handler (lines 344-405):**
```typescript
v1.delete('/memory', async (c) => {
  // ...
  const coreStub = c.env.VAULT_DO.get(coreId);
  clearPromises.push(coreStub.fetch(new Request(`https://do${endpoint}`, { method: 'POST' })));
  // ❌ NO D1 CLEAR — This is the bug
  
  return c.json({ deleted: true, message: 'Memory cleared successfully' });
});
```

### 2.3 Missing D1 Functions

`d1-search.ts` has `clearBufferFromD1()` (line 270) but:
- **Not exported** to routes that need it
- **Never called** anywhere in the codebase

Missing functions entirely:
- `clearChunksFromD1(memoryKey, sessionId?)` — Delete all chunks for a key
- `purgeOldChunksFromD1(memoryKey, olderThan)` — Delete chunks older than timestamp

### 2.4 Scattered Retrieval Logic

Memory retrieval is also duplicated, though less severely:

| File | Lines | Pattern |
|------|-------|---------|
| `chat.ts` | 178-270 | DO+D1 race, buffer merge, window balancing |
| `anthropic.ts` | 115-165 | D1 only (simpler), buffer fetch |
| `google.ts` | 100-145 | D1 only, buffer fetch |

The race logic (DO vs D1, first wins) only exists in `chat.ts`. Native endpoints fall back to D1-only which is slower.

---

## 3. Proposed Architecture

### 3.1 Module Structure

```
workers/src/
├── services/
│   ├── memory-core.ts        # NEW: ALL write/delete/clear operations
│   ├── memory-retrieval.ts   # NEW: ALL search operations (DO+D1 race)
│   ├── d1-search.ts          # MODIFIED: Add missing clear functions
│   ├── kronos-do.ts          # KEEP: Low-level DO helpers
│   └── do-router.ts          # KEEP: Vault resolution
├── routes/
│   ├── chat.ts               # MODIFIED: Format transform only
│   ├── anthropic.ts          # MODIFIED: Format transform only
│   └── google.ts             # MODIFIED: Format transform only + add storage
└── index.ts                  # MODIFIED: Use memory-core for DELETE
```

### 3.2 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PROVIDER ROUTES                                │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐       │
│  │    chat.ts        │  │   anthropic.ts    │  │    google.ts      │       │
│  │  (OpenAI format)  │  │ (Anthropic format)│  │  (Gemini format)  │       │
│  │                   │  │                   │  │                   │       │
│  │ • Parse request   │  │ • Parse request   │  │ • Parse request   │       │
│  │ • Extract content │  │ • Extract content │  │ • Extract content │       │
│  │ • Inject memory   │  │ • Inject memory   │  │ • Inject memory   │       │
│  │ • Forward to LLM  │  │ • Forward to LLM  │  │ • Forward to LLM  │       │
│  │ • Extract response│  │ • Extract response│  │ • Extract response│       │
│  │ • Format output   │  │ • Format output   │  │ • Format output   │       │
│  └─────────┬─────────┘  └─────────┬─────────┘  └─────────┬─────────┘       │
│            │                      │                      │                 │
│            └──────────────────────┼──────────────────────┘                 │
│                                   │                                        │
│                    CALLS          ▼          CALLS                         │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                         CORE SERVICES                              │   │
│  │  ┌──────────────────────────┐  ┌──────────────────────────────┐   │   │
│  │  │    memory-core.ts        │  │    memory-retrieval.ts       │   │   │
│  │  │                          │  │                              │   │   │
│  │  │ • storeConversation()    │  │ • searchMemory()             │   │   │
│  │  │ • clearMemory()          │  │   - DO+D1 race               │   │   │
│  │  │ • deleteOldMemory()      │  │   - Buffer merge             │   │   │
│  │  │                          │  │   - Window balancing         │   │   │
│  │  │ (ALL D1 mirrors here)    │  │                              │   │   │
│  │  └────────────┬─────────────┘  └──────────────┬───────────────┘   │   │
│  │               │                               │                    │   │
│  └───────────────┼───────────────────────────────┼────────────────────┘   │
│                  │                               │                        │
└──────────────────┼───────────────────────────────┼────────────────────────┘
                   │                               │
                   ▼                               ▼
    ┌──────────────────────────────────────────────────────────────┐
    │                      PERSISTENCE LAYER                       │
    │                                                              │
    │   ┌─────────────────────┐         ┌─────────────────────┐   │
    │   │   Durable Object    │         │    D1 Database      │   │
    │   │   (SQLite inside)   │         │  (Cold-start cache) │   │
    │   │                     │         │                     │   │
    │   │  • vectors table    │ ──────► │  • chunks table     │   │
    │   │  • items table      │ mirror  │  • buffers table    │   │
    │   │  • pending_buffer   │         │                     │   │
    │   └─────────────────────┘         └─────────────────────┘   │
    │                                                              │
    └──────────────────────────────────────────────────────────────┘
```

---

## 4. Core Memory Service Design

### 4.1 memory-core.ts — Write Operations

```typescript
// services/memory-core.ts

import { DurableObjectNamespace, ExecutionContext, D1Database } from '@cloudflare/workers-types';
import { resolveVaultForStore } from './do-router';
import { storeToVault } from './kronos-do';
import { generateEmbedding, EmbeddingConfig } from './providers';
import { mirrorToD1, mirrorBufferToD1, clearChunksFromD1, clearBufferFromD1, purgeOldChunksFromD1 } from './d1-search';

// ==================== TYPES ====================

export interface StoreConversationParams {
  /** Durable Object namespace binding */
  doNamespace: DurableObjectNamespace;
  /** User's memory key (e.g., "mk_xxx") */
  memoryKey: string;
  /** Optional session ID for session-scoped memory */
  sessionId?: string;
  /** Messages from the conversation */
  messages: Array<{ role: string; content: string; memory?: boolean }>;
  /** Assistant's response text */
  assistantResponse: string;
  /** Model used (for metadata) */
  model: string;
  /** Storage options */
  options: {
    storeInput: boolean;   // Store user messages
    storeResponse: boolean; // Store assistant responses
  };
  /** Embedding configuration (Cloudflare AI binding) */
  embeddingConfig: EmbeddingConfig;
  /** D1 database for mirroring (optional) */
  d1?: D1Database;
  /** Execution context for waitUntil */
  ctx: ExecutionContext;
}

export interface StoreResult {
  stored: boolean;
  chunksStored: number;
  tokensStored: number;
  bufferedTokens: number;
}

export interface ClearMemoryParams {
  /** Durable Object namespace binding */
  doNamespace: DurableObjectNamespace;
  /** User's memory key */
  memoryKey: string;
  /** Optional session ID (clears session vault only) */
  sessionId?: string;
  /** Full reset (allows new embedding dimensions) */
  fullReset?: boolean;
  /** D1 database for clearing mirror */
  d1?: D1Database;
}

export interface ClearResult {
  doCleared: boolean;
  d1Cleared: boolean;
  sessionCleared: boolean;
}

export interface PurgeOldMemoryParams {
  /** Durable Object namespace binding */
  doNamespace: DurableObjectNamespace;
  /** User's memory key */
  memoryKey: string;
  /** Delete vectors older than this timestamp (ms since epoch) */
  olderThan: number;
  /** D1 database for purging mirror */
  d1?: D1Database;
}

export interface PurgeResult {
  doDeleted: number;
  d1Deleted: number;
  bytesReclaimed: number;
}

// ==================== STORE ====================

/**
 * Store conversation to memory (Durable Object + D1 mirror).
 * 
 * This is THE ONLY function that stores to memory.
 * All provider routes call this — no duplicated storage logic.
 * 
 * Flow:
 * 1. Extract last user message + assistant response
 * 2. Send to DO /store-chunked for intelligent 300-token chunking
 * 3. Embed each complete chunk via Cloudflare AI
 * 4. Store to DO via /store
 * 5. Mirror to D1 for cold-start fallback (fire-and-forget)
 * 6. Mirror buffer state to D1
 */
export async function storeConversation(params: StoreConversationParams): Promise<StoreResult> {
  const {
    doNamespace,
    memoryKey,
    sessionId,
    messages,
    assistantResponse,
    model,
    options,
    embeddingConfig,
    d1,
    ctx,
  } = params;

  const requestId = crypto.randomUUID();
  const stub = resolveVaultForStore(doNamespace, memoryKey, sessionId);
  const vaultType: 'core' | 'session' = sessionId ? 'session' : 'core';

  let chunksStored = 0;
  let tokensStored = 0;
  let bufferedTokens = 0;

  // Collect content to process — ONLY last user message + new assistant response
  const contentToProcess: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  if (options.storeInput) {
    const lastUserMsg = [...messages]
      .reverse()
      .find(m => m.role === 'user' && m.memory !== false);
    if (lastUserMsg) {
      contentToProcess.push({ role: 'user', content: lastUserMsg.content });
    }
  }

  if (options.storeResponse && assistantResponse) {
    contentToProcess.push({ role: 'assistant', content: assistantResponse });
  }

  if (contentToProcess.length === 0) {
    return { stored: false, chunksStored: 0, tokensStored: 0, bufferedTokens: 0 };
  }

  // Process each content item through DO's chunking buffer
  for (const item of contentToProcess) {
    // Send to DO's chunking endpoint
    const chunkResponse = await stub.fetch(new Request('https://do/store-chunked', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: item.content,
        role: item.role,
      }),
    }));

    const chunkResult = await chunkResponse.json() as {
      chunksToEmbed: string[];
      bufferTokens: number;
    };

    bufferedTokens = chunkResult.bufferTokens;

    // Embed and store each complete chunk
    for (const chunkContent of chunkResult.chunksToEmbed) {
      const embedding = await generateEmbedding(chunkContent, undefined, undefined, embeddingConfig);
      const storeResult = await storeToVault(stub, embedding, chunkContent, item.role, model, requestId);

      if (storeResult.stored) {
        chunksStored++;
        tokensStored += storeResult.tokenCount || Math.ceil(chunkContent.length / 4);

        // Mirror to D1 (fire-and-forget via waitUntil)
        if (d1) {
          const timestamp = Date.now();
          const tokenCount = Math.ceil(chunkContent.length / 4);
          ctx.waitUntil(
            mirrorToD1(
              d1,
              memoryKey,
              vaultType,
              sessionId,
              chunkContent,
              item.role,
              embedding,
              timestamp,
              tokenCount,
              model
            ).catch(err => console.error('[MEMORY-CORE] D1 mirror failed:', err))
          );
        }
      }
    }
  }

  // Mirror buffer state to D1 (fire-and-forget)
  if (d1 && bufferedTokens >= 0) {
    const bufferRes = await stub.fetch(new Request('https://do/buffer', { method: 'GET' }));
    if (bufferRes.ok) {
      const bufferData = await bufferRes.json() as { content: string; tokenCount: number; lastUpdated: number };
      if (bufferData.content) {
        ctx.waitUntil(
          mirrorBufferToD1(
            d1,
            memoryKey,
            vaultType,
            sessionId,
            bufferData.content,
            bufferData.tokenCount,
            bufferData.lastUpdated || Date.now()
          ).catch(err => console.error('[MEMORY-CORE] D1 buffer mirror failed:', err))
        );
      }
    }
  }

  return {
    stored: chunksStored > 0,
    chunksStored,
    tokensStored,
    bufferedTokens,
  };
}

// ==================== CLEAR ====================

/**
 * Clear all memory for a key (Durable Object + D1).
 * 
 * This is THE ONLY function that clears memory.
 * Called by DELETE /v1/memory and any other clear operations.
 */
export async function clearMemory(params: ClearMemoryParams): Promise<ClearResult> {
  const { doNamespace, memoryKey, sessionId, fullReset, d1 } = params;
  const endpoint = fullReset ? '/reset' : '/clear';

  let doCleared = false;
  let d1Cleared = false;

  // Clear DO (core and/or session vault)
  try {
    const clearPromises: Promise<Response>[] = [];

    // Clear/reset core vault
    const coreId = doNamespace.idFromName(`${memoryKey}:core`);
    const coreStub = doNamespace.get(coreId);
    clearPromises.push(coreStub.fetch(new Request(`https://do${endpoint}`, { method: 'POST' })));

    // Clear/reset session vault if session ID provided
    if (sessionId) {
      const sessionDoId = doNamespace.idFromName(`${memoryKey}:session:${sessionId}`);
      const sessionStub = doNamespace.get(sessionDoId);
      clearPromises.push(sessionStub.fetch(new Request(`https://do${endpoint}`, { method: 'POST' })));
    }

    await Promise.all(clearPromises);
    doCleared = true;
  } catch (error) {
    console.error('[MEMORY-CORE] DO clear failed:', error);
  }

  // Clear D1 mirror
  if (d1) {
    try {
      await clearChunksFromD1(d1, memoryKey, sessionId);
      await clearBufferFromD1(d1, memoryKey, sessionId);
      d1Cleared = true;
    } catch (error) {
      console.error('[MEMORY-CORE] D1 clear failed:', error);
    }
  }

  return {
    doCleared,
    d1Cleared,
    sessionCleared: !!sessionId,
  };
}

// ==================== PURGE OLD ====================

/**
 * Purge old memory vectors (archival cleanup).
 * 
 * This is THE ONLY function that purges old data.
 * Called by archival service for storage management.
 */
export async function purgeOldMemory(params: PurgeOldMemoryParams): Promise<PurgeResult> {
  const { doNamespace, memoryKey, olderThan, d1 } = params;

  let doDeleted = 0;
  let d1Deleted = 0;
  let bytesReclaimed = 0;

  // Purge from DO
  try {
    const coreId = doNamespace.idFromName(`${memoryKey}:core`);
    const coreStub = doNamespace.get(coreId);
    
    const response = await coreStub.fetch(new Request('https://do/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ olderThan }),
    }));
    
    const result = await response.json() as { deleted: number; bytesDeleted: number };
    doDeleted = result.deleted || 0;
    bytesReclaimed = result.bytesDeleted || 0;
  } catch (error) {
    console.error('[MEMORY-CORE] DO purge failed:', error);
  }

  // Purge from D1 mirror
  if (d1) {
    try {
      d1Deleted = await purgeOldChunksFromD1(d1, memoryKey, olderThan);
    } catch (error) {
      console.error('[MEMORY-CORE] D1 purge failed:', error);
    }
  }

  return {
    doDeleted,
    d1Deleted,
    bytesReclaimed,
  };
}
```

### 4.2 memory-retrieval.ts — Read Operations

```typescript
// services/memory-retrieval.ts

import { DurableObjectNamespace, D1Database } from '@cloudflare/workers-types';
import { resolveVaultsForQuery } from './do-router';
import { buildSearchPlan, executeSearchPlan } from './kronos-do';
import { searchD1, getBufferFromD1, D1SearchConfig, DEFAULT_D1_SEARCH_CONFIG } from './d1-search';
import { generateEmbedding, EmbeddingConfig } from './providers';
import type { MemoryRetrievalResult, MemoryChunk } from '../types/do';

// ==================== TYPES ====================

export interface SearchMemoryParams {
  /** Durable Object namespace binding */
  doNamespace: DurableObjectNamespace;
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
  kronosConfig?: {
    hotWindowHours: number;
    workingWindowDays: number;
    longtermWindowDays: number;
  };
}

export interface SearchResult {
  /** Retrieved memory chunks */
  chunks: MemoryChunk[];
  /** Total token count */
  tokenCount: number;
  /** Breakdown by time window */
  windowBreakdown: { hot: number; working: number; longterm: number };
  /** Pending buffer content (if any) */
  buffer?: { content: string; tokenCount: number; lastUpdated: number };
  /** Search latency metrics */
  metrics: {
    embeddingMs: number;
    raceMs: number;
    winner: 'do' | 'd1' | 'none';
  };
}

// ==================== SEARCH ====================

/**
 * Search memory with DO+D1 race (fastest wins).
 * 
 * This is THE ONLY function that searches memory.
 * All provider routes call this — no duplicated search logic.
 * 
 * Flow:
 * 1. Generate query embedding via Cloudflare AI
 * 2. Race DO search vs D1 search (fastest wins)
 * 3. Merge buffer content
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
    kronosConfig = {
      hotWindowHours: 4,
      workingWindowDays: 3,
      longtermWindowDays: 90,
    },
  } = params;

  // Generate query embedding
  const embedStart = Date.now();
  const queryEmbedding = await generateEmbedding(query, undefined, undefined, embeddingConfig);
  const embeddingMs = Date.now() - embedStart;

  // Resolve which vaults to query
  const vaults = resolveVaultsForQuery(doNamespace, memoryKey, sessionId);

  // Build search plan
  const plan = buildSearchPlan(vaults, limit, kronosConfig);

  // ===== RACE: DO vs D1 — fastest wins =====
  const raceStart = Date.now();

  type RaceResult = {
    source: 'do' | 'd1';
    result: MemoryRetrievalResult;
    time: number;
  };

  // DO search promise
  const doPromise = executeSearchPlan(plan, queryEmbedding)
    .then(r => ({ source: 'do' as const, result: r, time: Date.now() - raceStart }))
    .catch(() => null);

  // D1 search promise
  const d1Promise = searchD1(
    d1,
    queryEmbedding,
    memoryKey,
    sessionId,
    limit,
    kronosConfig as D1SearchConfig
  )
    .then(r => ({ source: 'd1' as const, result: r, time: Date.now() - raceStart }))
    .catch(() => null);

  // Buffer promise (separate from race, we'll merge it)
  const bufferPromise = getBufferFromD1(d1, memoryKey, sessionId).catch(() => null);

  // Race: first successful result wins
  const doRace = doPromise.then(r => r?.result ? r : Promise.reject('no result'));
  const d1Race = d1Promise.then(r => r?.result ? r : Promise.reject('no result'));

  let winner: RaceResult | null = null;
  try {
    winner = await Promise.any([doRace, d1Race]) as RaceResult;
  } catch {
    // Both failed
    winner = null;
  }

  const raceMs = Date.now() - raceStart;
  const raceWinner = winner?.source || 'none';

  // Build result
  let chunks: MemoryChunk[] = [];
  let tokenCount = 0;
  let windowBreakdown = { hot: 0, working: 0, longterm: 0 };
  let buffer: { content: string; tokenCount: number; lastUpdated: number } | undefined;

  if (winner?.result) {
    chunks = winner.result.chunks;
    tokenCount = winner.result.tokenCount;
    windowBreakdown = winner.result.windowBreakdown;

    // If DO won, extract buffer from response
    if (winner.source === 'do') {
      const doBuffer = (winner.result as any).buffer;
      if (doBuffer?.content && doBuffer.tokenCount > 0) {
        buffer = {
          content: doBuffer.content,
          tokenCount: doBuffer.tokenCount,
          lastUpdated: doBuffer.lastUpdated || Date.now(),
        };
      }
    }

    // If D1 won, get buffer separately
    if (winner.source === 'd1') {
      const d1Buffer = await bufferPromise;
      if (d1Buffer?.content && d1Buffer.tokenCount > 0) {
        buffer = d1Buffer;
      }
    }
  }

  // Merge buffer into chunks if present
  if (buffer?.content && buffer.tokenCount > 0) {
    chunks.push({
      id: -1,
      role: 'system' as const,
      content: buffer.content,
      timestamp: buffer.lastUpdated,
      score: 1.0,
      window: 'hot' as const,
      source: 'buffer',
    });
    tokenCount += buffer.tokenCount;
  }

  return {
    chunks,
    tokenCount,
    windowBreakdown,
    buffer,
    metrics: {
      embeddingMs,
      raceMs,
      winner: raceWinner,
    },
  };
}
```

### 4.3 d1-search.ts — New Functions to Add

```typescript
// Add to services/d1-search.ts (lines ~280+)

/**
 * Clear all chunks for a memory key from D1.
 * Called by memory-core.ts when clearing memory.
 */
export async function clearChunksFromD1(
  db: D1Database,
  memoryKey: string,
  sessionId?: string
): Promise<number> {
  let result;
  
  if (sessionId) {
    // Clear specific session
    result = await db.prepare(`
      DELETE FROM chunks 
      WHERE memory_key = ? AND session_id = ?
    `).bind(memoryKey, sessionId).run();
  } else {
    // Clear core vault (no session_id)
    result = await db.prepare(`
      DELETE FROM chunks 
      WHERE memory_key = ? AND (session_id IS NULL OR session_id = '')
    `).bind(memoryKey).run();
  }
  
  return result.meta.changes || 0;
}

/**
 * Purge old chunks from D1 (archival cleanup).
 * Called by memory-core.ts during archival purge.
 */
export async function purgeOldChunksFromD1(
  db: D1Database,
  memoryKey: string,
  olderThan: number
): Promise<number> {
  const result = await db.prepare(`
    DELETE FROM chunks 
    WHERE memory_key = ? AND timestamp < ?
  `).bind(memoryKey, olderThan).run();
  
  return result.meta.changes || 0;
}

// Note: clearBufferFromD1 already exists at line 270 but needs to be EXPORTED
// Change line 270 from:
//   async function clearBufferFromD1(...
// To:
//   export async function clearBufferFromD1(...
```

---

## 5. Provider Route Refactor

### 5.1 chat.ts Changes

**Before:** 100+ lines of storage code in `storeConversationDO()`

**After:** ~10 lines calling core service

```typescript
// routes/chat.ts — AFTER refactor

import { storeConversation, StoreConversationParams } from '../services/memory-core';
import { searchMemory, SearchResult } from '../services/memory-retrieval';

// In the handler, REPLACE inline storeConversationDO call with:
if (memoryOptions.mode !== 'off' && memoryOptions.mode !== 'read') {
  ctx.waitUntil(
    storeConversation({
      doNamespace: env.VAULT_DO!,
      memoryKey: userContext.memoryKey.key,
      sessionId,
      messages: body.messages,
      assistantResponse: fullResponse,
      model: body.model,
      options: {
        storeInput: memoryOptions.storeInput,
        storeResponse: memoryOptions.storeResponse,
      },
      embeddingConfig: getEmbeddingConfig(env)!,
      d1: env.VECTORS_D1,
      ctx,
    })
  );
}

// REPLACE inline search code with:
const searchResult = await searchMemory({
  doNamespace: env.VAULT_DO!,
  d1: env.VECTORS_D1!,
  memoryKey: userContext.memoryKey.key,
  sessionId,
  query: extractQuery(augmentedMessages),
  limit: memoryOptions.contextLimit,
  embeddingConfig: getEmbeddingConfig(env)!,
  kronosConfig: {
    hotWindowHours: parseInt(env.HOT_WINDOW_HOURS || '4'),
    workingWindowDays: parseInt(env.WORKING_WINDOW_DAYS || '3'),
    longtermWindowDays: parseInt(env.LONGTERM_WINDOW_DAYS || '90'),
  },
});

// DELETE the entire storeConversationDO function (lines 933-1030)
// DELETE the entire storeConversationKV function (lines 1032-1060)
```

**Net change:** -150 lines, +20 lines = **-130 lines**

### 5.2 anthropic.ts Changes

**Before:** 65 lines of storage code in `storeToMemory()`

**After:** ~10 lines calling core service

```typescript
// routes/anthropic.ts — AFTER refactor

import { storeConversation } from '../services/memory-core';
import { searchMemory } from '../services/memory-retrieval';

// REPLACE storeToMemory() call with:
if (isMemoryWrite && fullText) {
  ctx.waitUntil(
    storeConversation({
      doNamespace: env.VAULT_DO!,
      memoryKey: userContext.memoryKey.key,
      sessionId,
      messages,
      assistantResponse: fullText,
      model: rawBody.model as string,
      options: { storeInput: true, storeResponse: true },
      embeddingConfig: { ai: env.AI },
      d1: env.VECTORS_D1,
      ctx,
    })
  );
}

// REPLACE inline D1 search with searchMemory():
const searchResult = await searchMemory({
  doNamespace: env.VAULT_DO!,
  d1: env.VECTORS_D1,
  memoryKey: userContext.memoryKey.key,
  sessionId,
  query: buildQuery(messages, rawBody.system as string | undefined),
  limit: 30,
  embeddingConfig: { ai: env.AI },
});

// DELETE the entire storeToMemory function (lines 484-547)
```

**Net change:** -65 lines, +15 lines = **-50 lines**

### 5.3 google.ts Changes

**Current:** No storage implementation (memory is read-only)

**After:** Add storage using core service

```typescript
// routes/google.ts — AFTER refactor

import { storeConversation } from '../services/memory-core';
import { searchMemory } from '../services/memory-retrieval';

// ADD storage in background:
c.executionCtx.waitUntil(
  (async () => {
    // Extract assistant response from Google format
    const responseData = JSON.parse(new TextDecoder().decode(responseBody));
    const assistantText = responseData.candidates?.[0]?.content?.parts
      ?.filter((p: any) => p.text)
      ?.map((p: any) => p.text)
      ?.join('\n') || '';

    if (assistantText) {
      await storeConversation({
        doNamespace: c.env.VAULT_DO!,
        memoryKey: userContext.memoryKey.key,
        sessionId: undefined,
        messages: body.contents.map(c => ({
          role: c.role === 'model' ? 'assistant' : 'user',
          content: getPartsText(c.parts),
        })),
        assistantResponse: assistantText,
        model: `google/${model}`,
        options: { storeInput: true, storeResponse: true },
        embeddingConfig: { ai: c.env.AI },
        d1: c.env.VECTORS_D1,
        ctx: c.executionCtx,
      });
    }
  })()
);

// REPLACE inline D1 search with searchMemory():
const searchResult = await searchMemory({
  doNamespace: c.env.VAULT_DO!,
  d1: c.env.VECTORS_D1,
  memoryKey: userContext.memoryKey.key,
  sessionId: undefined,
  query: buildQuery(body.contents),
  limit: 30,
  embeddingConfig: { ai: c.env.AI },
});
```

**Net change:** +30 lines (adding missing storage)

---

## 6. DO/D1 Sync Fix

### 6.1 How the New Architecture Solves the Sync Problem

With the refactored architecture:

| Operation | Old Behavior | New Behavior |
|-----------|--------------|--------------|
| Store | DO + D1 (scattered in routes) | `storeConversation()` handles both |
| Clear | DO only (D1 ignored) | `clearMemory()` handles both |
| Purge | DO only (D1 ignored) | `purgeOldMemory()` handles both |
| Buffer clear | Never called | `clearMemory()` calls `clearBufferFromD1()` |

### 6.2 index.ts Changes

```typescript
// index.ts — AFTER refactor

import { clearMemory, ClearMemoryParams } from './services/memory-core';

v1.delete('/memory', async (c) => {
  const userContext = c.get('userContext');
  const sessionId = c.req.header('X-Session-ID');
  const fullReset = c.req.query('reset') === 'true';

  if (c.env.USE_DURABLE_OBJECTS === 'true' && c.env.VAULT_DO) {
    const result = await clearMemory({
      doNamespace: c.env.VAULT_DO,
      memoryKey: userContext.memoryKey.key,
      sessionId,
      fullReset,
      d1: c.env.VECTORS_D1,
    });

    return c.json({
      key: userContext.memoryKey.key,
      sessionCleared: result.sessionCleared,
      deleted: result.doCleared,
      d1Synced: result.d1Cleared,
      reset: fullReset,
      message: fullReset ? 'Memory reset (new dimensions allowed)' : 'Memory cleared successfully',
    });
  }

  // Legacy KV+R2 path unchanged
  // ...
});
```

### 6.3 archival.ts Changes

```typescript
// services/archival.ts — AFTER refactor

import { purgeOldMemory } from './memory-core';

// In purgeOldVectors():
async function purgeOldVectors(
  memoryKey: string,
  olderThan: number,
  doNamespace: DurableObjectNamespace,
  d1?: D1Database
): Promise<PurgeResult> {
  return purgeOldMemory({
    doNamespace,
    memoryKey,
    olderThan,
    d1,
  });
}
```

---

## 7. Migration Plan

### Phase 1: Foundation (Day 1)

| Step | Task | Dependencies | Files |
|------|------|--------------|-------|
| 1.1 | Add `clearChunksFromD1()` to d1-search.ts | None | d1-search.ts |
| 1.2 | Add `purgeOldChunksFromD1()` to d1-search.ts | None | d1-search.ts |
| 1.3 | Export `clearBufferFromD1()` (already exists) | None | d1-search.ts |
| 1.4 | Create `memory-core.ts` with all functions | 1.1, 1.2, 1.3 | memory-core.ts |
| 1.5 | Create `memory-retrieval.ts` with search function | None | memory-retrieval.ts |

### Phase 2: Route Migration (Day 2)

| Step | Task | Dependencies | Files |
|------|------|--------------|-------|
| 2.1 | Refactor chat.ts to use memory-core | 1.4, 1.5 | chat.ts |
| 2.2 | Refactor anthropic.ts to use memory-core | 1.4, 1.5 | anthropic.ts |
| 2.3 | Add storage to google.ts using memory-core | 1.4, 1.5 | google.ts |
| 2.4 | Update index.ts DELETE handler | 1.4 | index.ts |
| 2.5 | Update archival.ts purge function | 1.4 | archival.ts |

### Phase 3: Cleanup & Testing (Day 3)

| Step | Task | Dependencies | Files |
|------|------|--------------|-------|
| 3.1 | Delete old `storeConversationDO()` from chat.ts | 2.1 | chat.ts |
| 3.2 | Delete old `storeToMemory()` from anthropic.ts | 2.2 | anthropic.ts |
| 3.3 | Add integration tests for D1 sync | All | tests/ |
| 3.4 | Deploy to staging, verify D1 clears properly | 3.3 | — |
| 3.5 | Deploy to production | 3.4 | — |

### Dependency Graph

```
1.1, 1.2, 1.3 ─┬─► 1.4 ──┬─► 2.1 ──► 3.1
               │         │
               │         ├─► 2.2 ──► 3.2
               │         │
               │         ├─► 2.3
               │         │
               │         ├─► 2.4
               │         │
               │         └─► 2.5
               │
               └─► 1.5 ──┘

                         All 2.x ──► 3.3 ──► 3.4 ──► 3.5
```

---

## 8. Risk Assessment

### 8.1 Potential Issues

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| D1 query performance regression | Low | Medium | Benchmark before/after; D1 is already proven |
| Race condition in clear operation | Low | High | Use transaction-like pattern (DO first, D1 second) |
| Missing edge case in migration | Medium | Low | Comprehensive test coverage; staged rollout |
| Buffer sync timing issues | Low | Low | Buffer is eventually consistent; acceptable |
| Memory leak in race promises | Low | Medium | Proper promise cleanup in searchMemory |

### 8.2 Rollback Strategy

Each phase can be rolled back independently:

1. **Phase 1:** Just adds new functions, no breaking changes
2. **Phase 2:** Keep old functions as fallbacks, feature flag new code
3. **Phase 3:** Don't delete old code until stable in production

### 8.3 Testing Checklist

```
[ ] Unit tests for memory-core.ts
    [ ] storeConversation() stores to DO and D1
    [ ] clearMemory() clears both DO and D1
    [ ] purgeOldMemory() purges both DO and D1

[ ] Unit tests for memory-retrieval.ts
    [ ] searchMemory() returns results from DO
    [ ] searchMemory() falls back to D1 when DO is slow
    [ ] Buffer is merged into results

[ ] Integration tests
    [ ] DELETE /v1/memory clears D1 chunks
    [ ] Archival purge removes D1 chunks
    [ ] Google route stores to memory
    [ ] All providers return identical memory for same key

[ ] Performance tests
    [ ] Store latency unchanged
    [ ] Search latency unchanged
    [ ] D1 clear performance acceptable
```

---

## 9. Appendix: File Sizes Before/After

| File | Before (lines) | After (lines) | Delta |
|------|----------------|---------------|-------|
| chat.ts | ~1060 | ~910 | -150 |
| anthropic.ts | ~550 | ~500 | -50 |
| google.ts | ~200 | ~230 | +30 |
| memory-core.ts | 0 | ~250 | +250 |
| memory-retrieval.ts | 0 | ~150 | +150 |
| d1-search.ts | ~280 | ~320 | +40 |
| index.ts | ~550 | ~530 | -20 |
| **TOTAL** | ~2640 | ~2890 | +250 |

Net increase is ~250 lines, but:
- **Duplication eliminated:** ~200 lines of copy-pasted code removed
- **Single source of truth:** All memory ops in 2 files
- **Future providers:** Zero storage code needed
- **D1 sync fixed:** Automatically works everywhere

---

## 10. Summary

**Key Architectural Decisions:**

1. **One store function** — `storeConversation()` in `memory-core.ts`
2. **One clear function** — `clearMemory()` in `memory-core.ts`
3. **One search function** — `searchMemory()` in `memory-retrieval.ts`
4. **D1 sync by design** — Mirror logic lives in exactly one place
5. **Routes are thin** — Only format transformation, no business logic

**Implementation Timeline:**

- **Day 1:** Foundation (new services, D1 functions)
- **Day 2:** Route migration (use new services)
- **Day 3:** Cleanup, testing, deploy

**Success Metrics:**

- DELETE /v1/memory clears D1 ✓
- Archival purge removes D1 data ✓
- All providers use same storage code ✓
- Google route stores to memory ✓
- Net code reduction after removing duplication ✓

---

*End of Architecture Refactor Plan*
