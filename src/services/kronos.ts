/**
 * KRONOS Temporal Retrieval Engine
 * 
 * 3D Context Model:
 *   1. Semantic — vector similarity search
 *   2. Temporal — time-windowed filtering (HOT/WORKING/LONG-TERM/ARCHIVE)
 *   3. Recency — decay scoring within windows
 * 
 * Reference: memoryrouter-product-spec.md Section 4.5
 * 
 * Windows:
 *   HOT:       < 15 minutes
 *   WORKING:   15 min – 4 hours
 *   LONG-TERM: 4 hours – 3 days
 *   ARCHIVE:   3+ days
 * 
 * Equal Allocation: For N chunks, allocate N/4 per window.
 * If a window has fewer than its allocation, backfill from next window.
 */

import type { MemoryChunk, KronosWindow, MemoryRetrievalResult } from '../types';
import { KRONOS_WINDOWS } from '../types';

// =============================================================================
// KRONOS RETRIEVAL
// =============================================================================

export interface KronosRetrievalOptions {
  /** Total chunks to retrieve */
  limit: number;
  /** Recency bias weighting */
  recencyBias: 'low' | 'medium' | 'high';
}

/**
 * Classify a chunk into a KRONOS temporal window based on its timestamp
 */
export function classifyWindow(timestamp: Date, now: Date = new Date()): KronosWindow {
  const ageMs = now.getTime() - timestamp.getTime();
  
  for (const window of KRONOS_WINDOWS) {
    if (ageMs >= window.minAge && ageMs < window.maxAge) {
      return window.name;
    }
  }
  
  return 'archive';
}

/**
 * Apply recency decay scoring within a window
 * More recent items within a window score higher
 */
export function applyRecencyDecay(
  chunks: MemoryChunk[],
  recencyBias: 'low' | 'medium' | 'high',
  now: Date = new Date()
): MemoryChunk[] {
  const decayFactors: Record<string, number> = {
    low: 0.1,
    medium: 0.3,
    high: 0.6,
  };
  
  const factor = decayFactors[recencyBias];
  
  return chunks.map(chunk => {
    const ageMs = now.getTime() - chunk.timestamp.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    
    // Exponential decay: score = similarity * (1 - factor * decay)
    const decay = Math.exp(-ageHours / 24); // Half-life of ~24 hours
    const baseSimilarity = chunk.similarity ?? 0.5;
    const boostedScore = baseSimilarity * (1 - factor) + baseSimilarity * factor * decay;
    
    return {
      ...chunk,
      similarity: boostedScore,
    };
  });
}

/**
 * Partition chunks into KRONOS temporal windows
 */
export function partitionByWindow(
  chunks: MemoryChunk[],
  now: Date = new Date()
): Record<KronosWindow, MemoryChunk[]> {
  const windows: Record<KronosWindow, MemoryChunk[]> = {
    hot: [],
    working: [],
    long_term: [],
    archive: [],
  };
  
  for (const chunk of chunks) {
    const window = classifyWindow(chunk.timestamp, now);
    chunk.window = window;
    windows[window].push(chunk);
  }
  
  return windows;
}

/**
 * Equal allocation with backfill
 * 
 * For N total, allocate N/4 per window.
 * If a window has fewer results than its allocation,
 * redistribute the deficit to other windows.
 */
export function equalAllocate(
  windows: Record<KronosWindow, MemoryChunk[]>,
  total: number
): MemoryChunk[] {
  const windowNames: KronosWindow[] = ['hot', 'working', 'long_term', 'archive'];
  const perWindow = Math.ceil(total / windowNames.length);
  
  const selected: MemoryChunk[] = [];
  let deficit = 0;
  
  // First pass: take up to perWindow from each
  const remaining: Record<KronosWindow, MemoryChunk[]> = {
    hot: [],
    working: [],
    long_term: [],
    archive: [],
  };
  
  for (const name of windowNames) {
    const windowChunks = windows[name]
      .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
    
    const take = Math.min(perWindow, windowChunks.length);
    selected.push(...windowChunks.slice(0, take));
    remaining[name] = windowChunks.slice(take);
    
    if (take < perWindow) {
      deficit += perWindow - take;
    }
  }
  
  // Second pass: backfill deficit from windows that have extra
  if (deficit > 0) {
    for (const name of windowNames) {
      if (deficit <= 0) break;
      const extra = remaining[name];
      const take = Math.min(deficit, extra.length);
      selected.push(...extra.slice(0, take));
      deficit -= take;
    }
  }
  
  // Sort final result by relevance (similarity score descending)
  return selected
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, total);
}

/**
 * KRONOS temporal retrieval
 * 
 * Takes all candidate chunks (from vector search) and applies:
 * 1. Temporal window classification
 * 2. Recency decay scoring
 * 3. Equal allocation across windows
 */
export function kronosRetrieve(
  candidates: MemoryChunk[],
  options: KronosRetrievalOptions
): MemoryRetrievalResult {
  const now = new Date();
  
  // Step 1: Classify into temporal windows
  const windows = partitionByWindow(candidates, now);
  
  // Step 2: Apply recency decay within each window
  for (const windowName of Object.keys(windows) as KronosWindow[]) {
    windows[windowName] = applyRecencyDecay(windows[windowName], options.recencyBias, now);
  }
  
  // Step 3: Equal allocation with backfill
  const selected = equalAllocate(windows, options.limit);
  
  // Calculate token count
  const tokenCount = selected.reduce((sum, chunk) => sum + (chunk.tokenCount || 0), 0);
  
  // Window breakdown
  const windowBreakdown: Record<KronosWindow, number> = {
    hot: 0,
    working: 0,
    long_term: 0,
    archive: 0,
  };
  
  for (const chunk of selected) {
    if (chunk.window) {
      windowBreakdown[chunk.window]++;
    }
  }
  
  return {
    chunks: selected,
    tokenCount,
    windowBreakdown,
    query: '',
  };
}

/**
 * Format KRONOS retrieval result for logging
 */
export function formatKronosResult(result: MemoryRetrievalResult): string {
  const lines = [
    `[KRONOS] Retrieved ${result.chunks.length} chunks (${result.tokenCount} tokens)`,
    `  🔥 HOT: ${result.windowBreakdown.hot}`,
    `  🧠 WORKING: ${result.windowBreakdown.working}`,
    `  📚 LONG-TERM: ${result.windowBreakdown.long_term}`,
    `  🏛️ ARCHIVE: ${result.windowBreakdown.archive}`,
  ];
  return lines.join('\n');
}
