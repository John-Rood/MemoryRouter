/**
 * Truncation Service
 * Intelligently truncates messages and memories when context window would be exceeded.
 * 
 * TRUNCATION PRIORITY (first to cut → last to cut):
 * 1. OLDEST CONVERSATION HISTORY — Remove oldest user/assistant messages
 * 2. ARCHIVE WINDOW MEMORIES — Memories from 3+ days ago
 * 3. LONG-TERM WINDOW MEMORIES — Memories from 4h-3d ago
 * 4. WORKING WINDOW MEMORIES — Memories from 15m-4h ago
 * 5. HOT WINDOW MEMORIES — Last resort, memories from <15min ago
 * 
 * NEVER TRUNCATE: System prompt, core memory, last user message
 */

import { MemoryChunk, MemoryRetrievalResult } from '../types/do';
import { ChatMessage } from '../middleware/memory';

// ==================== Context Window Registry ====================

/**
 * Context window sizes for known models (in tokens)
 * Add new models as needed
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4-turbo-preview': 128000,
  'gpt-4': 8192,
  'gpt-4-32k': 32768,
  'gpt-3.5-turbo': 16384,
  'gpt-3.5-turbo-16k': 16384,
  'o1': 200000,
  'o1-preview': 128000,
  'o1-mini': 128000,
  'o3-mini': 200000,
  
  // Anthropic
  'claude-3-opus': 200000,
  'claude-3-opus-20240229': 200000,
  'claude-3-sonnet': 200000,
  'claude-3-sonnet-20240229': 200000,
  'claude-3-haiku': 200000,
  'claude-3-haiku-20240307': 200000,
  'claude-3.5-sonnet': 200000,
  'claude-3-5-sonnet-20240620': 200000,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-5-haiku-20241022': 200000,
  'claude-sonnet-4-20250514': 200000,
  'claude-opus-4-20250514': 200000,
  
  // Google
  'gemini-pro': 1000000,
  'gemini-1.5-pro': 1000000,
  'gemini-1.5-flash': 1000000,
  'gemini-flash': 1000000,
  'gemini-2.0-flash': 1000000,
  
  // xAI
  'grok-2': 131072,
  'grok-2-mini': 131072,
  'grok-beta': 131072,
  
  // Cerebras (Llama)
  'llama-3.3-70b': 128000,
  'llama3.1-8b': 128000,
  'llama3.1-70b': 128000,
  
  // Meta Llama (OpenRouter)
  'meta-llama/llama-3.1-8b-instruct': 128000,
  'meta-llama/llama-3.1-70b-instruct': 128000,
  'meta-llama/llama-3.1-405b-instruct': 128000,
  
  // Mistral (OpenRouter)
  'mistral/mistral-large': 128000,
  'mistral/mistral-medium': 32000,
  'mistral/mistral-small': 32000,
};

/** Default context window for unknown models */
const DEFAULT_CONTEXT_WINDOW = 8192;

/** Safety margin - target this percentage of context window */
const SAFETY_MARGIN = 0.95;

// ==================== Types ====================

export interface TruncationResult {
  /** Messages after truncation */
  messages: ChatMessage[];
  /** Memory chunks after truncation */
  chunks: MemoryChunk[];
  /** Whether any truncation occurred */
  truncated: boolean;
  /** Total tokens removed */
  tokensRemoved: number;
  /** Details about what was truncated */
  truncationDetails: TruncationDetails;
}

export interface TruncationDetails {
  /** Number of conversation messages removed */
  conversationMessagesRemoved: number;
  /** Number of archive window chunks removed */
  archiveChunksRemoved: number;
  /** Number of long-term window chunks removed */
  longtermChunksRemoved: number;
  /** Number of working window chunks removed */
  workingChunksRemoved: number;
  /** Number of hot window chunks removed */
  hotChunksRemoved: number;
  /** Original token count */
  originalTokens: number;
  /** Final token count */
  finalTokens: number;
  /** Context window limit */
  contextWindow: number;
  /** Target tokens (context window * safety margin) */
  targetTokens: number;
}

// ==================== Token Counting ====================

/**
 * Estimate token count for a string.
 * Uses ~4 chars per token as a rough approximation.
 * This is conservative (overestimates slightly) which is safer.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // ~4 characters per token on average
  // Add 10% buffer for special tokens and encoding overhead
  return Math.ceil(text.length / 4 * 1.1);
}

/**
 * Count tokens in a message (including role overhead)
 */
export function countMessageTokens(message: ChatMessage): number {
  // Role token overhead: ~4 tokens for role markers
  const roleOverhead = 4;
  return estimateTokens(message.content) + roleOverhead;
}

/**
 * Count tokens in an array of messages
 */
export function countMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, msg) => sum + countMessageTokens(msg), 0);
}

/**
 * Count tokens in memory chunks
 */
export function countChunksTokens(chunks: MemoryChunk[]): number {
  return chunks.reduce((sum, chunk) => sum + estimateTokens(chunk.content), 0);
}

/**
 * Get the context window size for a model
 */
export function getContextWindow(model: string): number {
  // Normalize model name (strip provider prefix, lowercase)
  const normalizedModel = model.toLowerCase()
    .replace(/^(anthropic|openai|google|xai|cerebras)\//, '');
  
  // Direct match
  if (CONTEXT_WINDOWS[normalizedModel]) {
    return CONTEXT_WINDOWS[normalizedModel];
  }
  
  // Partial match (e.g., "claude-3-5-sonnet" matches "claude-3.5-sonnet")
  for (const [key, value] of Object.entries(CONTEXT_WINDOWS)) {
    if (normalizedModel.includes(key) || key.includes(normalizedModel)) {
      return value;
    }
  }
  
  // Pattern-based fallback
  if (normalizedModel.includes('claude')) return 200000;
  if (normalizedModel.includes('gpt-4o')) return 128000;
  if (normalizedModel.includes('gpt-4')) return 8192;
  if (normalizedModel.includes('gpt-3.5')) return 16384;
  if (normalizedModel.includes('gemini')) return 1000000;
  if (normalizedModel.includes('llama')) return 128000;
  if (normalizedModel.includes('mistral')) return 32000;
  if (normalizedModel.includes('grok')) return 131072;
  
  console.warn(`[TRUNCATION] Unknown model "${model}", using default context window: ${DEFAULT_CONTEXT_WINDOW}`);
  return DEFAULT_CONTEXT_WINDOW;
}

// ==================== Truncation Algorithm ====================

/**
 * Categorize chunks by KRONOS window with extended granularity
 */
function categorizeChunks(chunks: MemoryChunk[]): {
  hot: MemoryChunk[];      // <15 min
  working: MemoryChunk[];  // 15m-4h
  longterm: MemoryChunk[]; // 4h-3d
  archive: MemoryChunk[];  // 3d+
} {
  const now = Date.now();
  const fifteenMinAgo = now - 15 * 60 * 1000;
  const fourHoursAgo = now - 4 * 60 * 60 * 1000;
  const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
  
  const result = {
    hot: [] as MemoryChunk[],
    working: [] as MemoryChunk[],
    longterm: [] as MemoryChunk[],
    archive: [] as MemoryChunk[],
  };
  
  for (const chunk of chunks) {
    if (chunk.timestamp >= fifteenMinAgo) {
      result.hot.push(chunk);
    } else if (chunk.timestamp >= fourHoursAgo) {
      result.working.push(chunk);
    } else if (chunk.timestamp >= threeDaysAgo) {
      result.longterm.push(chunk);
    } else {
      result.archive.push(chunk);
    }
  }
  
  return result;
}

/**
 * Remove oldest chunks from an array, return tokens freed
 */
function truncateChunksOldestFirst(
  chunks: MemoryChunk[],
  targetTokensToRemove: number
): { remaining: MemoryChunk[]; tokensRemoved: number; chunksRemoved: number } {
  if (targetTokensToRemove <= 0 || chunks.length === 0) {
    return { remaining: chunks, tokensRemoved: 0, chunksRemoved: 0 };
  }
  
  // Sort by timestamp ascending (oldest first)
  const sorted = [...chunks].sort((a, b) => a.timestamp - b.timestamp);
  
  let tokensRemoved = 0;
  let chunksRemoved = 0;
  const remaining: MemoryChunk[] = [];
  
  for (const chunk of sorted) {
    if (tokensRemoved < targetTokensToRemove) {
      tokensRemoved += estimateTokens(chunk.content);
      chunksRemoved++;
    } else {
      remaining.push(chunk);
    }
  }
  
  return { remaining, tokensRemoved, chunksRemoved };
}

/**
 * Truncate messages and memories to fit within context window.
 * 
 * @param messages - The conversation messages
 * @param retrieval - Retrieved memory (can be null if no memory retrieved)
 * @param model - The model name (used to get context window)
 * @param injectedContextTokens - Pre-calculated tokens for the formatted memory injection
 * @returns TruncationResult with truncated messages/chunks and metadata
 */
export function truncateToFit(
  messages: ChatMessage[],
  retrieval: MemoryRetrievalResult | null,
  model: string,
  injectedContextTokens?: number
): TruncationResult {
  const contextWindow = getContextWindow(model);
  const targetTokens = Math.floor(contextWindow * SAFETY_MARGIN);
  
  // Calculate current token count
  const messageTokens = countMessagesTokens(messages);
  const memoryTokens = injectedContextTokens ?? (retrieval ? countChunksTokens(retrieval.chunks) : 0);
  let totalTokens = messageTokens + memoryTokens;
  
  const details: TruncationDetails = {
    conversationMessagesRemoved: 0,
    archiveChunksRemoved: 0,
    longtermChunksRemoved: 0,
    workingChunksRemoved: 0,
    hotChunksRemoved: 0,
    originalTokens: totalTokens,
    finalTokens: totalTokens,
    contextWindow,
    targetTokens,
  };
  
  // If under target, no truncation needed
  if (totalTokens <= targetTokens) {
    return {
      messages,
      chunks: retrieval?.chunks ?? [],
      truncated: false,
      tokensRemoved: 0,
      truncationDetails: details,
    };
  }
  
  console.log(`[TRUNCATION] Need to remove ${totalTokens - targetTokens} tokens (${totalTokens} > ${targetTokens})`);
  
  let tokensToRemove = totalTokens - targetTokens;
  let totalTokensRemoved = 0;
  let truncatedMessages = [...messages];
  let truncatedChunks = retrieval?.chunks ? [...retrieval.chunks] : [];
  
  // ==================== STEP 1: Remove oldest conversation history ====================
  // Protect: system messages, last user message
  if (tokensToRemove > 0 && truncatedMessages.length > 2) {
    const systemMessages = truncatedMessages.filter(m => m.role === 'system');
    const nonSystemMessages = truncatedMessages.filter(m => m.role !== 'system');
    
    // Always keep the last user message
    const lastUserIndex = nonSystemMessages.map(m => m.role).lastIndexOf('user');
    const protectedLastUser = lastUserIndex >= 0 ? nonSystemMessages[lastUserIndex] : null;
    
    // Messages we can potentially remove (oldest first, excluding last user message)
    const removableMessages = nonSystemMessages.filter((_, i) => i !== lastUserIndex);
    
    // Remove from oldest (start of array) first
    while (tokensToRemove > 0 && removableMessages.length > 0) {
      const removed = removableMessages.shift()!;
      const removedTokens = countMessageTokens(removed);
      tokensToRemove -= removedTokens;
      totalTokensRemoved += removedTokens;
      details.conversationMessagesRemoved++;
    }
    
    // Rebuild messages array
    truncatedMessages = [
      ...systemMessages,
      ...removableMessages,
      ...(protectedLastUser ? [protectedLastUser] : []),
    ];
  }
  
  // ==================== STEP 2-5: Remove memories by window priority ====================
  if (tokensToRemove > 0 && truncatedChunks.length > 0) {
    const categorized = categorizeChunks(truncatedChunks);
    
    // Step 2: Archive window (3+ days)
    if (tokensToRemove > 0 && categorized.archive.length > 0) {
      const result = truncateChunksOldestFirst(categorized.archive, tokensToRemove);
      categorized.archive = result.remaining;
      tokensToRemove -= result.tokensRemoved;
      totalTokensRemoved += result.tokensRemoved;
      details.archiveChunksRemoved = result.chunksRemoved;
    }
    
    // Step 3: Long-term window (4h-3d)
    if (tokensToRemove > 0 && categorized.longterm.length > 0) {
      const result = truncateChunksOldestFirst(categorized.longterm, tokensToRemove);
      categorized.longterm = result.remaining;
      tokensToRemove -= result.tokensRemoved;
      totalTokensRemoved += result.tokensRemoved;
      details.longtermChunksRemoved = result.chunksRemoved;
    }
    
    // Step 4: Working window (15m-4h)
    if (tokensToRemove > 0 && categorized.working.length > 0) {
      const result = truncateChunksOldestFirst(categorized.working, tokensToRemove);
      categorized.working = result.remaining;
      tokensToRemove -= result.tokensRemoved;
      totalTokensRemoved += result.tokensRemoved;
      details.workingChunksRemoved = result.chunksRemoved;
    }
    
    // Step 5: Hot window (last resort, <15min)
    if (tokensToRemove > 0 && categorized.hot.length > 0) {
      const result = truncateChunksOldestFirst(categorized.hot, tokensToRemove);
      categorized.hot = result.remaining;
      tokensToRemove -= result.tokensRemoved;
      totalTokensRemoved += result.tokensRemoved;
      details.hotChunksRemoved = result.chunksRemoved;
    }
    
    // Rebuild chunks array (maintain recency order)
    truncatedChunks = [
      ...categorized.hot,
      ...categorized.working,
      ...categorized.longterm,
      ...categorized.archive,
    ].sort((a, b) => b.timestamp - a.timestamp);
  }
  
  // Calculate final token count
  details.finalTokens = details.originalTokens - totalTokensRemoved;
  
  const truncated = totalTokensRemoved > 0;
  if (truncated) {
    console.log(`[TRUNCATION] Removed ${totalTokensRemoved} tokens:`, {
      conversationMessages: details.conversationMessagesRemoved,
      archiveChunks: details.archiveChunksRemoved,
      longtermChunks: details.longtermChunksRemoved,
      workingChunks: details.workingChunksRemoved,
      hotChunks: details.hotChunksRemoved,
      finalTokens: details.finalTokens,
    });
  }
  
  return {
    messages: truncatedMessages,
    chunks: truncatedChunks,
    truncated,
    tokensRemoved: totalTokensRemoved,
    truncationDetails: details,
  };
}

/**
 * Build truncation header value for response
 */
export function buildTruncationHeader(details: TruncationDetails): string {
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
 * Rebuild MemoryRetrievalResult with truncated chunks
 */
export function rebuildRetrievalResult(
  original: MemoryRetrievalResult,
  truncatedChunks: MemoryChunk[]
): MemoryRetrievalResult {
  // Recalculate window breakdown
  const windowBreakdown = { hot: 0, working: 0, longterm: 0 };
  for (const chunk of truncatedChunks) {
    if (chunk.window === 'hot') windowBreakdown.hot++;
    else if (chunk.window === 'working') windowBreakdown.working++;
    else if (chunk.window === 'longterm') windowBreakdown.longterm++;
  }
  
  return {
    chunks: truncatedChunks,
    tokenCount: countChunksTokens(truncatedChunks),
    windowBreakdown,
  };
}
