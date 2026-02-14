/**
 * Debug Headers Service
 * 
 * Consistent debug header generation for ALL providers.
 * Includes latency metrics, memory info, and truncation details.
 * 
 * Used by all provider routes: chat.ts, anthropic.ts, google.ts
 */

import type { TruncationResult, TruncationDetails } from './truncation';
import type { MemoryOptions } from './memory-options';

// ==================== TYPES ====================

export interface LatencyMetrics {
  startTime: number;
  embeddingMs?: number;
  raceMs?: number;
  raceWinner?: 'do' | 'd1' | 'none';
  postProcessMs?: number;
  mrProcessingMs: number;
  providerResponseMs?: number;
  totalMs?: number;
}

export interface MemoryMetrics {
  tokensRetrieved: number;
  chunksRetrieved: number;
  tokensInjected: number;
  injectionFormat?: string;
}

// ==================== HEADER BUILDERS ====================

/**
 * Build all memory-related response headers.
 * Consistent format for ALL providers.
 */
export function buildMemoryHeaders(
  metrics: LatencyMetrics,
  memory: MemoryMetrics,
  options: MemoryOptions,
  truncation?: TruncationResult | null
): Headers {
  const headers = new Headers();

  // Memory metrics
  headers.set('X-Memory-Tokens-Retrieved', String(memory.tokensRetrieved));
  headers.set('X-Memory-Chunks-Retrieved', String(memory.chunksRetrieved));
  headers.set('X-Memory-Tokens-Injected', String(memory.tokensInjected));
  if (memory.injectionFormat) {
    headers.set('X-Memory-Injection-Format', memory.injectionFormat);
  }

  // Options
  headers.set('X-Memory-Mode', options.mode);
  if (options.sessionId) {
    headers.set('X-Session-ID', options.sessionId);
  }

  // Latency breakdown
  if (metrics.embeddingMs !== undefined) {
    headers.set('X-Embedding-Ms', String(metrics.embeddingMs));
  }
  if (metrics.raceMs !== undefined) {
    headers.set('X-Race-Ms', String(metrics.raceMs));
  }
  if (metrics.raceWinner) {
    headers.set('X-Race-Winner', metrics.raceWinner);
  }
  if (metrics.postProcessMs !== undefined) {
    headers.set('X-PostProcess-Ms', String(metrics.postProcessMs));
  }
  headers.set('X-MR-Processing-Ms', String(metrics.mrProcessingMs));
  if (metrics.providerResponseMs !== undefined) {
    headers.set('X-Provider-Response-Ms', String(metrics.providerResponseMs));
  }
  if (metrics.totalMs !== undefined) {
    headers.set('X-Total-Ms', String(metrics.totalMs));
  }
  headers.set('X-MR-Overhead-Ms', String(metrics.mrProcessingMs - (metrics.embeddingMs || 0)));

  // Truncation
  if (truncation?.truncated) {
    headers.set('X-MemoryRouter-Truncated', 'true');
    headers.set('X-MemoryRouter-Tokens-Removed', String(truncation.tokensRemoved));
    headers.set('X-MemoryRouter-Truncated-Details', buildTruncationHeaderValue(truncation.truncationDetails));
  }

  return headers;
}

/**
 * Build truncation details header value
 */
export function buildTruncationHeaderValue(details: TruncationDetails): string {
  const parts: string[] = [];
  
  if (details.conversationMessagesRemoved > 0) {
    parts.push(`conv:${details.conversationMessagesRemoved}`);
  }
  if (details.archiveChunksRemoved > 0) {
    parts.push(`archive:${details.archiveChunksRemoved}`);
  }
  if (details.longtermChunksRemoved > 0) {
    parts.push(`longterm:${details.longtermChunksRemoved}`);
  }
  if (details.workingChunksRemoved > 0) {
    parts.push(`working:${details.workingChunksRemoved}`);
  }
  if (details.hotChunksRemoved > 0) {
    parts.push(`hot:${details.hotChunksRemoved}`);
  }
  
  return parts.join(',') || 'none';
}

/**
 * Add memory headers to existing response headers
 */
export function addMemoryHeadersToResponse(
  responseHeaders: Headers,
  metrics: LatencyMetrics,
  memory: MemoryMetrics,
  options: MemoryOptions,
  truncation?: TruncationResult | null
): void {
  const memoryHeaders = buildMemoryHeaders(metrics, memory, options, truncation);
  for (const [key, value] of memoryHeaders.entries()) {
    responseHeaders.set(key, value);
  }
}

// ==================== DEBUG BODY BUILDER ====================

/**
 * Build debug response body (only included when debug mode enabled)
 */
export function buildDebugBody(
  searchResult: { chunks: unknown[]; tokenCount: number; windowBreakdown: unknown; metrics?: unknown } | null,
  truncation: TruncationResult | null,
  metrics: LatencyMetrics,
  options: MemoryOptions,
  originalMessages: unknown[],
  augmentedMessages: unknown[],
  model: string,
  provider: string
): Record<string, unknown> {
  return {
    _memory: searchResult ? {
      tokens_retrieved: searchResult.tokenCount,
      memories_retrieved: searchResult.chunks.length,
      window_breakdown: searchResult.windowBreakdown,
      memories: searchResult.chunks,
    } : null,
    _latency: {
      embedding_ms: metrics.embeddingMs,
      race_ms: metrics.raceMs,
      race_winner: metrics.raceWinner,
      post_process_ms: metrics.postProcessMs,
      mr_processing_ms: metrics.mrProcessingMs,
      mr_overhead_ms: metrics.mrProcessingMs - (metrics.embeddingMs || 0),
      provider_ms: metrics.providerResponseMs,
      total_ms: metrics.totalMs,
    },
    _truncation: truncation?.truncated ? {
      truncated: true,
      tokens_removed: truncation.tokensRemoved,
      details: truncation.truncationDetails,
    } : null,
    _options: {
      mode: options.mode,
      context_limit: options.contextLimit,
      session_id: options.sessionId,
    },
    _debug: {
      original_messages: originalMessages,
      augmented_messages: augmentedMessages,
      model,
      provider,
    },
  };
}

/**
 * Check if debug mode is enabled from request
 */
export function isDebugMode(c: { req: { header: (name: string) => string | undefined; query: (name: string) => string | undefined } }): boolean {
  return c.req.header('X-Debug') === 'true' || c.req.query('debug') === 'true';
}
