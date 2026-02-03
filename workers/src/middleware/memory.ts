/**
 * Memory Middleware - KRONOS Integration
 * Handles memory retrieval and storage with temporal windows.
 * 
 * This module provides the legacy KV+R2 memory path.
 * The new Durable Objects path uses services/kronos-do.ts instead.
 * Both paths are feature-flagged via USE_DURABLE_OBJECTS.
 */

import { Context } from 'hono';
import { StorageManager } from '../services/storage';
import { SearchResult, VectorMetadata } from '../vectors/workers-index';
import { formatMemoryContext } from '../formatters';

/**
 * KRONOS time windows
 */
export interface KronosConfig {
  hotWindowHours: number;      // Default: 4 hours
  workingWindowDays: number;   // Default: 3 days
  longtermWindowDays: number;  // Default: 90 days
}

export const DEFAULT_KRONOS_CONFIG: KronosConfig = {
  hotWindowHours: 4,
  workingWindowDays: 3,
  longtermWindowDays: 90,
};

/**
 * Memory options from request headers
 */
export interface MemoryOptions {
  mode: 'on' | 'read' | 'write' | 'off';
  storeInput: boolean;
  storeResponse: boolean;
  contextLimit: number;
}

/**
 * Parse memory options from request headers or query params
 * Query params override headers for easier testing
 */
export function parseMemoryOptions(c: Context): MemoryOptions {
  const url = new URL(c.req.url);
  
  // Query param shortcuts: ?memory=false or ?memory=off
  const memoryParam = url.searchParams.get('memory');
  if (memoryParam === 'false' || memoryParam === 'off') {
    return { mode: 'off', storeInput: false, storeResponse: false, contextLimit: 30 };
  }
  
  // Full control via headers or query params (query params take precedence)
  const rawMode = url.searchParams.get('mode') ?? c.req.header('X-Memory-Mode') ?? 'on';
  // Normalize legacy values: all → on, none → off, selective → read
  let mode: MemoryOptions['mode'];
  if (rawMode === 'all') {
    mode = 'on';
  } else if (rawMode === 'none') {
    mode = 'off';
  } else if (rawMode === 'selective') {
    mode = 'read';
  } else {
    mode = rawMode as MemoryOptions['mode'];
  }
  const storeInput = (url.searchParams.get('store') ?? c.req.header('X-Memory-Store')) !== 'false';
  const storeResponse = (url.searchParams.get('store_response') ?? c.req.header('X-Memory-Store-Response')) !== 'false';
  const contextLimit = parseInt(url.searchParams.get('limit') ?? c.req.header('X-Memory-Context-Limit') ?? '30', 10);
  
  return { mode, storeInput, storeResponse, contextLimit };
}

/**
 * Memory param names to strip from request body before forwarding to provider
 */
const MEMORY_BODY_PARAMS = ['memory', 'memory_mode', 'memory_store', 'memory_store_response', 'memory_limit'] as const;

/**
 * Parse memory options from request body and strip them
 * Body params override headers/query for convenience
 * Returns updated options and cleaned body
 */
export function parseMemoryOptionsFromBody(
  body: Record<string, unknown>,
  baseOptions: MemoryOptions
): { options: MemoryOptions; cleanBody: Record<string, unknown> } {
  const options = { ...baseOptions };
  
  // Check for memory=false shorthand
  if (body.memory === false || body.memory === 'false' || body.memory === 'off') {
    options.mode = 'off';
    options.storeInput = false;
    options.storeResponse = false;
  } else if (body.memory !== undefined) {
    // memory=true means use defaults (auto mode)
    if (body.memory === true || body.memory === 'true' || body.memory === 'on') {
      options.mode = 'on';
    }
  }
  
  // Granular overrides (normalize legacy values)
  if (body.memory_mode !== undefined) {
    const mode = body.memory_mode as string;
    // Normalize legacy values: all → on, none → off, selective → read
    if (mode === 'all') {
      options.mode = 'on';
    } else if (mode === 'none') {
      options.mode = 'off';
    } else if (mode === 'selective') {
      options.mode = 'read';
    } else {
      options.mode = mode as MemoryOptions['mode'];
    }
  }
  if (body.memory_store !== undefined) {
    options.storeInput = body.memory_store === true || body.memory_store === 'true';
    options.storeResponse = body.memory_store === true || body.memory_store === 'true';
  }
  if (body.memory_store_response !== undefined) {
    options.storeResponse = body.memory_store_response === true || body.memory_store_response === 'true';
  }
  if (body.memory_limit !== undefined) {
    options.contextLimit = parseInt(String(body.memory_limit), 10) || 30;
  }
  
  // Strip memory params from body before forwarding
  const cleanBody = { ...body };
  for (const param of MEMORY_BODY_PARAMS) {
    delete cleanBody[param];
  }
  
  return { options, cleanBody };
}

/**
 * Extract session_id from request body.
 * Falls back to header (already extracted in auth middleware).
 */
export function extractSessionId(
  body: Record<string, unknown>,
  headerSessionId?: string
): string | undefined {
  // Body takes precedence over header
  if (body.session_id && typeof body.session_id === 'string') {
    return body.session_id;
  }
  return headerSessionId;
}

/**
 * Memory retrieval result
 */
export interface MemoryRetrievalResult {
  chunks: MemoryChunk[];
  tokenCount: number;
  windowBreakdown: {
    hot: number;
    working: number;
    longterm: number;
  };
}

export interface MemoryChunk {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  score: number;
  window: 'hot' | 'working' | 'longterm';
  /** Which vault this came from (core, session, ephemeral) — used by DO path */
  source?: string;
}

/**
 * KRONOS Memory Manager
 * Handles retrieval across temporal windows
 */
export class KronosMemoryManager {
  private storage: StorageManager;
  private config: KronosConfig;

  constructor(storage: StorageManager, config: KronosConfig = DEFAULT_KRONOS_CONFIG) {
    this.storage = storage;
    this.config = config;
  }

  /**
   * Get timestamp cutoffs for KRONOS windows
   */
  private getWindowCutoffs(): { hot: number; working: number; longterm: number } {
    const now = Date.now();
    return {
      hot: now - this.config.hotWindowHours * 60 * 60 * 1000,
      working: now - this.config.workingWindowDays * 24 * 60 * 60 * 1000,
      longterm: now - this.config.longtermWindowDays * 24 * 60 * 60 * 1000,
    };
  }

  /**
   * Allocate results equally across windows
   * N/3 per window with remainder distributed
   */
  private allocatePerWindow(total: number): { hot: number; working: number; longterm: number } {
    const base = Math.floor(total / 3);
    const remainder = total % 3;
    return {
      hot: base + (remainder > 0 ? 1 : 0),
      working: base + (remainder > 1 ? 1 : 0),
      longterm: base,
    };
  }

  /**
   * Assign a result to its KRONOS window based on timestamp
   */
  private getWindow(timestamp: number, cutoffs: { hot: number; working: number; longterm: number }): 'hot' | 'working' | 'longterm' {
    if (timestamp >= cutoffs.hot) return 'hot';
    if (timestamp >= cutoffs.working) return 'working';
    return 'longterm';
  }

  /**
   * Search memory with KRONOS equal allocation
   */
  async search(
    memoryKey: string,
    queryEmbedding: Float32Array,
    totalLimit: number = 30
  ): Promise<MemoryRetrievalResult> {
    const cutoffs = this.getWindowCutoffs();
    const allocation = this.allocatePerWindow(totalLimit);
    
    // Search each window
    const [hotResults, workingResults, longtermResults] = await Promise.all([
      this.searchWindow(memoryKey, queryEmbedding, cutoffs.hot, Date.now(), allocation.hot),
      this.searchWindow(memoryKey, queryEmbedding, cutoffs.working, cutoffs.hot, allocation.working),
      this.searchWindow(memoryKey, queryEmbedding, cutoffs.longterm, cutoffs.working, allocation.longterm),
    ]);
    
    // Get metadata for all results
    const allIds = [
      ...hotResults.map(r => r.id),
      ...workingResults.map(r => r.id),
      ...longtermResults.map(r => r.id),
    ];
    
    const metadataMap = await this.storage.getMetadataBatch(memoryKey, allIds);
    
    // Build chunks with metadata
    const chunks: MemoryChunk[] = [];
    
    const addChunks = (results: SearchResult[], window: 'hot' | 'working' | 'longterm') => {
      for (const result of results) {
        const meta = metadataMap.get(result.id);
        if (meta) {
          chunks.push({
            id: result.id,
            role: meta.role,
            content: meta.content,
            timestamp: meta.timestamp,
            score: result.score,
            window,
          });
        }
      }
    };
    
    addChunks(hotResults, 'hot');
    addChunks(workingResults, 'working');
    addChunks(longtermResults, 'longterm');
    
    // Sort by timestamp (most recent first within each window)
    chunks.sort((a, b) => b.timestamp - a.timestamp);
    
    // Estimate token count (rough: ~4 chars per token)
    const totalContent = chunks.map(c => c.content).join('');
    const tokenCount = Math.ceil(totalContent.length / 4);
    
    return {
      chunks,
      tokenCount,
      windowBreakdown: {
        hot: hotResults.length,
        working: workingResults.length,
        longterm: longtermResults.length,
      },
    };
  }

  /**
   * Search a specific time window
   */
  private async searchWindow(
    memoryKey: string,
    query: Float32Array,
    minTimestamp: number,
    maxTimestamp: number,
    limit: number
  ): Promise<SearchResult[]> {
    if (limit <= 0) return [];
    
    return this.storage.search(memoryKey, query, {
      limit,
      minTimestamp,
      maxTimestamp,
    });
  }

  /**
   * Store a chunk in memory
   */
  async store(
    memoryKey: string,
    embedding: Float32Array,
    content: string,
    role: 'user' | 'assistant',
    model?: string,
    requestId?: string
  ): Promise<number> {
    const vectorId = await this.storage.getNextVectorId(memoryKey);
    const timestamp = Date.now();
    
    // Create content hash
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
    
    const metadata: VectorMetadata = {
      id: vectorId,
      memoryKey,
      role,
      content,
      contentHash,
      timestamp,
      model,
      requestId,
    };
    
    await this.storage.storeVector(memoryKey, vectorId, embedding, metadata);
    
    return vectorId;
  }
}

/**
 * Message type for compatibility
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  memory?: boolean;
}

/**
 * Extract query from messages for embedding.
 * 
 * Uses last user message + recent conversation history (up to TARGET_TOKENS)
 * for better semantic context. Without history, queries like "tell me more"
 * or "yes" have no semantic meaning on their own.
 */
export function extractQuery(messages: ChatMessage[], targetTokens: number = 200): string {
  // Filter out system messages for the query (they're usually instructions, not content)
  const conversationMessages = messages.filter(m => m.role !== 'system');
  
  if (conversationMessages.length === 0) {
    return '';
  }
  
  // Estimate tokens (~4 chars per token)
  const estimateTokens = (text: string) => Math.ceil(text.length / 4);
  
  // Build query from recent messages, working backwards
  const queryParts: string[] = [];
  let tokenCount = 0;
  
  // Start from the end (most recent messages)
  for (let i = conversationMessages.length - 1; i >= 0 && tokenCount < targetTokens; i--) {
    const msg = conversationMessages[i];
    const formatted = `[${msg.role.toUpperCase()}] ${msg.content}`;
    const msgTokens = estimateTokens(formatted);
    
    // Always include the last message, then add more if under budget
    if (queryParts.length === 0 || tokenCount + msgTokens <= targetTokens) {
      queryParts.unshift(formatted);
      tokenCount += msgTokens;
    } else {
      break;
    }
  }
  
  return queryParts.join('\n\n');
}

/**
 * Inject memory context into messages
 */
export function injectContext(
  messages: ChatMessage[],
  context: string,
  model: string
): ChatMessage[] {
  if (!context) {
    return messages;
  }
  
  // Format context for the specific model
  const formattedContext = formatMemoryContext(model, context);
  
  // Find existing system message
  const systemIndex = messages.findIndex(m => m.role === 'system');
  
  if (systemIndex >= 0) {
    // Prepend memory context to existing system message
    const updated = [...messages];
    updated[systemIndex] = {
      ...updated[systemIndex],
      content: `${formattedContext}\n\n${updated[systemIndex].content}`,
    };
    return updated;
  }
  
  // Add new system message at the beginning
  return [
    { role: 'system' as const, content: formattedContext },
    ...messages,
  ];
}

/**
 * Format relative time (e.g., "3 hours ago")
 * Makes temporal reasoning intuitive for the AI
 */
function formatRelativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  const minutes = Math.floor(delta / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years} year${years > 1 ? 's' : ''} ago`;
  if (months > 0) return `${months} month${months > 1 ? 's' : ''} ago`;
  if (weeks > 0) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} min ago`;
  return 'just now';
}

/**
 * Format timestamp with relative time first, absolute time in parentheses
 * Example: "3 hours ago (Sun, Feb 1, 3:15 PM)"
 */
function formatTimestamp(timestamp: number): string {
  const relative = formatRelativeTime(timestamp);
  const date = new Date(timestamp);
  const absolute = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${relative} (${absolute})`;
}

/**
 * Format retrieval results into context string with timestamps
 */
export function formatRetrievalAsContext(retrieval: MemoryRetrievalResult): string {
  if (retrieval.chunks.length === 0) {
    return '';
  }
  
  // Separate buffer (current conversation) from past memories
  const pastChunks = retrieval.chunks.filter(c => c.source !== 'buffer');
  const bufferChunk = retrieval.chunks.find(c => c.source === 'buffer');
  
  const parts: string[] = [];
  
  // Format current conversation buffer FIRST (most recent at top)
  if (bufferChunk && bufferChunk.content) {
    parts.push(`[MOST RECENT]\n${bufferChunk.content}`);
  }
  
  // Format past memories after
  if (pastChunks.length > 0) {
    const pastFormatted = pastChunks
      .map((chunk, index) => {
        const time = formatTimestamp(chunk.timestamp);
        return `[${index + 1}] (${time}) ${chunk.content}`;
      })
      .join('\n\n');
    parts.push(pastFormatted);
  }
  
  return parts.join('\n\n---\n\n');
}
