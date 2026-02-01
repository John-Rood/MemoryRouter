/**
 * KRONOS with Durable Objects
 * 
 * KRONOS temporal retrieval across multiple vault DOs.
 * 
 * WITHIN a single DO:
 *   - Vectors have timestamps → searchFast(query, k, minTimestamp)
 *   - HOT/WORKING/LONG-TERM are just timestamp filters
 * 
 * ACROSS DOs:
 *   - Core vault: all time ranges (base knowledge accumulates)
 *   - Session vault: typically recent session context
 *   - Worker merges results from multiple DOs
 * 
 * EQUAL ALLOCATION:
 *   40 total → ~13 HOT + ~13 WORKING + ~13 LONG-TERM (equal allocation)
 *   With 2 vaults: each gets 2 HOT + 2 WORKING + 2 LONG-TERM
 */

import type {
  KronosConfig,
  KronosSearchPlan,
  MemoryChunk,
  MemoryRetrievalResult,
  VaultReference,
  DOSearchResponse,
} from '../types/do';

import { DEFAULT_KRONOS_CONFIG } from '../types/do';

/**
 * Build a KRONOS search plan for a request.
 * 
 * Creates a plan that specifies which vaults to query,
 * which time windows to search, and how many results per window.
 * 
 * @param vaults - Resolved vault references (from resolveVaultsForQuery)
 * @param totalLimit - Total number of results across all vaults and windows
 * @param config - KRONOS time window configuration
 */
export function buildSearchPlan(
  vaults: VaultReference[],
  totalLimit: number = 40,
  config: KronosConfig = DEFAULT_KRONOS_CONFIG
): KronosSearchPlan {
  const now = Date.now();
  const cutoffs = {
    hot: now - config.hotWindowHours * 60 * 60 * 1000,
    working: now - config.workingWindowDays * 24 * 60 * 60 * 1000,
    longterm: now - config.longtermWindowDays * 24 * 60 * 60 * 1000,
  };

  return {
    vaults: vaults.map(vault => {
      const vaultAllocation = Math.ceil(totalLimit * vault.allocation);
      const perWindow = Math.ceil(vaultAllocation / 3);

      return {
        stub: vault.stub,
        type: vault.type,
        windows: [
          {
            name: 'hot' as const,
            minTimestamp: cutoffs.hot,
            maxTimestamp: now,
            allocation: perWindow,
          },
          {
            name: 'working' as const,
            minTimestamp: cutoffs.working,
            maxTimestamp: cutoffs.hot,
            allocation: perWindow,
          },
          {
            name: 'longterm' as const,
            minTimestamp: cutoffs.longterm,
            maxTimestamp: cutoffs.working,
            allocation: perWindow,
          },
        ],
      };
    }),
    totalLimit,
  };
}

/**
 * Execute a KRONOS search plan.
 * 
 * Sends parallel requests to all vault DOs across all time windows,
 * then merges, deduplicates, and ranks results.
 * 
 * @param plan - The search plan from buildSearchPlan
 * @param queryEmbedding - The query vector
 */
export async function executeSearchPlan(
  plan: KronosSearchPlan,
  queryEmbedding: Float32Array
): Promise<MemoryRetrievalResult> {
  const queryArray = Array.from(queryEmbedding);

  // Fan out parallel requests to all vaults × all windows
  const windowPromises: Array<Promise<{
    type: string;
    window: string;
    results: Array<{
      id: number;
      score: number;
      content: string;
      role: string;
      timestamp: number;
    }>;
  }>> = [];

  for (const vault of plan.vaults) {
    for (const window of vault.windows) {
      const promise = vault.stub
        .fetch(new Request('https://do/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: queryArray,
            k: window.allocation,
            minTimestamp: window.minTimestamp,
            maxTimestamp: window.maxTimestamp,
          }),
        }))
        .then(res => res.json() as Promise<DOSearchResponse>)
        .then(data => ({
          type: vault.type,
          window: window.name,
          results: data.results ?? [],
        }))
        .catch(err => {
          // Don't fail the whole search if one vault/window errors
          console.error(`[KRONOS] Search failed for ${vault.type}/${window.name}:`, err);
          return {
            type: vault.type,
            window: window.name,
            results: [],
          };
        });

      windowPromises.push(promise);
    }
  }

  const allWindows = await Promise.all(windowPromises);

  // Merge results across all vaults and windows
  const chunks: MemoryChunk[] = [];
  const windowBreakdown = { hot: 0, working: 0, longterm: 0 };
  const seenContent = new Set<string>();

  for (const windowResult of allWindows) {
    const windowName = windowResult.window as 'hot' | 'working' | 'longterm';

    for (const result of windowResult.results) {
      // Dedup by content (same memory might exist in core + session)
      const contentKey = result.content.substring(0, 100);
      if (seenContent.has(contentKey)) continue;
      seenContent.add(contentKey);

      chunks.push({
        id: result.id,
        role: result.role as 'user' | 'assistant' | 'system',
        content: result.content,
        timestamp: result.timestamp,
        score: result.score,
        window: windowName,
        source: windowResult.type,
      });
      windowBreakdown[windowName]++;
    }
  }

  // Sort by score descending, take top totalLimit
  chunks.sort((a, b) => b.score - a.score);
  const topChunks = chunks.slice(0, plan.totalLimit);

  // Estimate tokens (~4 chars per token)
  const totalContent = topChunks.map(c => c.content).join('');
  const tokenCount = Math.ceil(totalContent.length / 4);

  return {
    chunks: topChunks,
    tokenCount,
    windowBreakdown,
  };
}

/**
 * Store a memory to a vault DO.
 * Convenience wrapper for the /store endpoint.
 */
export async function storeToVault(
  stub: DurableObjectStub,
  embedding: Float32Array,
  content: string,
  role: string,
  model?: string,
  requestId?: string
): Promise<{ id: number; stored: boolean }> {
  const response = await stub.fetch(new Request('https://do/store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embedding: Array.from(embedding),
      content,
      role,
      model,
      requestId,
    }),
  }));

  return response.json() as Promise<{ id: number; stored: boolean }>;
}
