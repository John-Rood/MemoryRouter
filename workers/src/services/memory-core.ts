/**
 * Memory Core Service
 * 
 * THE ONLY place that handles memory storage, clearing, and purging.
 * All provider routes use these functions — no duplicated logic.
 * 
 * Key operations:
 * - storeConversation() — Store to DO + mirror to D1
 * - clearMemory() — Clear DO + D1 (fixes the D1 sync bug!)
 * - purgeOldMemory() — Purge old from DO + D1
 */

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
  /** Whether D1 mirroring succeeded for all chunks */
  d1Synced: boolean;
  /** Number of chunks successfully mirrored to D1 */
  d1ChunksSynced: number;
  /** D1 sync errors (if any) */
  d1Errors?: string[];
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
}

// ==================== STORE CONVERSATION ====================

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
  // (users send full history each request; we don't want to re-process old messages)
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
    return { stored: false, chunksStored: 0, tokensStored: 0, bufferedTokens: 0, d1Synced: true, d1ChunksSynced: 0 };
  }

  // Track D1 mirror operations for sync status
  const d1MirrorPromises: Promise<{ success: boolean; error?: string }>[] = [];
  let d1ChunksSynced = 0;
  const d1Errors: string[] = [];

  try {
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
          tokensStored += Math.ceil(chunkContent.length / 4);

          // Mirror to D1 — track success/failure
          if (d1) {
            const timestamp = Date.now();
            const tokenCount = Math.ceil(chunkContent.length / 4);
            const mirrorPromise = mirrorToD1(
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
            )
              .then(() => ({ success: true }))
              .catch(err => {
                console.error('[MEMORY-CORE] D1 mirror failed:', err);
                return { success: false, error: String(err) };
              });
            
            d1MirrorPromises.push(mirrorPromise);
          }
        }
      }
    }

    // Mirror buffer state to D1
    if (d1 && bufferedTokens >= 0) {
      const bufferRes = await stub.fetch(new Request('https://do/buffer', { method: 'GET' }));
      if (bufferRes.ok) {
        const bufferData = await bufferRes.json() as { content: string; tokenCount: number; lastUpdated: number };
        if (bufferData.content) {
          const bufferMirrorPromise = mirrorBufferToD1(
            d1,
            memoryKey,
            vaultType,
            sessionId,
            bufferData.content,
            bufferData.tokenCount,
            bufferData.lastUpdated || Date.now()
          )
            .then(() => ({ success: true }))
            .catch(err => {
              console.error('[MEMORY-CORE] D1 buffer mirror failed:', err);
              return { success: false, error: String(err) };
            });
          
          d1MirrorPromises.push(bufferMirrorPromise);
        }
      }
    }

    // Wait for all D1 operations and track results
    if (d1MirrorPromises.length > 0) {
      const results = await Promise.all(d1MirrorPromises);
      for (const result of results) {
        if (result.success) {
          d1ChunksSynced++;
        } else if (result.error) {
          d1Errors.push(result.error);
        }
      }
    }
  } catch (error) {
    console.error('[MEMORY-CORE] Store failed:', error);
    return { 
      stored: false, 
      chunksStored: 0, 
      tokensStored: 0, 
      bufferedTokens: 0,
      d1Synced: false,
      d1ChunksSynced: 0,
      d1Errors: [String(error)],
    };
  }

  const d1Synced = d1 ? (d1Errors.length === 0 && d1ChunksSynced === d1MirrorPromises.length) : true;

  return {
    stored: chunksStored > 0,
    chunksStored,
    tokensStored,
    bufferedTokens,
    d1Synced,
    d1ChunksSynced,
    ...(d1Errors.length > 0 ? { d1Errors } : {}),
  };
}

// ==================== CLEAR MEMORY ====================

/**
 * Clear all memory for a key (Durable Object + D1).
 * 
 * This is THE ONLY function that clears memory.
 * Called by DELETE /v1/memory and any other clear operations.
 * 
 * THIS FIXES THE D1 SYNC BUG — D1 chunks are now cleared alongside DO.
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
    console.log(`[MEMORY-CORE] DO cleared: ${memoryKey}${sessionId ? `:${sessionId}` : ''}`);
  } catch (error) {
    console.error('[MEMORY-CORE] DO clear failed:', error);
  }

  // Clear D1 mirror — THIS IS THE FIX!
  if (d1) {
    try {
      // Clear chunks
      const chunksDeleted = await clearChunksFromD1(d1, memoryKey, sessionId);
      console.log(`[MEMORY-CORE] D1 chunks cleared: ${chunksDeleted} rows`);
      
      // Clear buffer
      await clearBufferFromD1(d1, memoryKey, sessionId);
      console.log(`[MEMORY-CORE] D1 buffer cleared`);
      
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

// ==================== PURGE OLD MEMORY ====================

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

  // Purge from DO
  try {
    const coreId = doNamespace.idFromName(`${memoryKey}:core`);
    const coreStub = doNamespace.get(coreId);
    
    const response = await coreStub.fetch(new Request('https://do/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ olderThan }),
    }));
    
    const result = await response.json() as { deleted: number };
    doDeleted = result.deleted || 0;
    console.log(`[MEMORY-CORE] DO purged: ${doDeleted} vectors older than ${new Date(olderThan).toISOString()}`);
  } catch (error) {
    console.error('[MEMORY-CORE] DO purge failed:', error);
  }

  // Purge from D1 mirror
  if (d1) {
    try {
      d1Deleted = await purgeOldChunksFromD1(d1, memoryKey, olderThan);
      console.log(`[MEMORY-CORE] D1 purged: ${d1Deleted} chunks`);
    } catch (error) {
      console.error('[MEMORY-CORE] D1 purge failed:', error);
    }
  }

  return {
    doDeleted,
    d1Deleted,
  };
}
