/**
 * MemoryRouter Core Types
 * 
 * V1 API types matching the product spec (memoryrouter-product-spec.md)
 * Sections 4, 5, 6
 */

// =============================================================================
// PROVIDERS
// =============================================================================

export type Provider = 'openai' | 'anthropic' | 'openrouter' | 'google';

// =============================================================================
// MESSAGES
// =============================================================================

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** MemoryRouter extension: if false, don't store this message */
  memory?: boolean;
}

// =============================================================================
// CHAT COMPLETIONS (OpenAI-compatible)
// =============================================================================

export interface ChatCompletionRequest {
  model: string;
  messages: Message[];
  /** MemoryRouter extension: session isolation */
  session_id?: string;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  [key: string]: unknown;
}

// =============================================================================
// ANTHROPIC MESSAGES API
// =============================================================================

export interface AnthropicMessageRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
    /** MemoryRouter extension */
    memory?: boolean;
  }>;
  system?: string | Array<{ type: string; text: string }>;
  /** MemoryRouter extension */
  session_id?: string;
  max_tokens: number;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  [key: string]: unknown;
}

// =============================================================================
// MEMORY OPTIONS (from headers)
// =============================================================================

export interface MemoryOptions {
  mode: 'auto' | 'read' | 'write' | 'off';
  storeRequest: boolean;
  storeResponse: boolean;
  contextLimit: number;
  recencyBias: 'low' | 'medium' | 'high';
  sessionId: string | null;
}

// =============================================================================
// KRONOS TEMPORAL WINDOWS
// =============================================================================

export type KronosWindow = 'hot' | 'working' | 'long_term' | 'archive';

export interface KronosWindowConfig {
  name: KronosWindow;
  label: string;
  /** Max age in milliseconds */
  maxAge: number;
  /** Min age in milliseconds (0 = now) */
  minAge: number;
}

export const KRONOS_WINDOWS: KronosWindowConfig[] = [
  { name: 'hot',       label: '🔥 HOT',       minAge: 0,                    maxAge: 15 * 60 * 1000 },          // < 15 min
  { name: 'working',   label: '🧠 WORKING',   minAge: 15 * 60 * 1000,      maxAge: 4 * 60 * 60 * 1000 },     // 15 min - 4 hours
  { name: 'long_term', label: '📚 LONG-TERM', minAge: 4 * 60 * 60 * 1000,  maxAge: 3 * 24 * 60 * 60 * 1000 }, // 4 hours - 3 days
  { name: 'archive',   label: '🏛️ ARCHIVE',   minAge: 3 * 24 * 60 * 60 * 1000, maxAge: Infinity },            // 3+ days
];

// =============================================================================
// MEMORY CHUNKS
// =============================================================================

export interface MemoryChunk {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  sessionId?: string;
  model?: string;
  provider?: string;
  tokenCount: number;
  similarity?: number;
  window?: KronosWindow;
  metadata?: Record<string, unknown>;
}

export interface MemoryRetrievalResult {
  chunks: MemoryChunk[];
  tokenCount: number;
  windowBreakdown: Record<KronosWindow, number>;
  query: string;
}

export interface MemoryStoreInput {
  memoryKey: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// SESSION
// =============================================================================

export interface SessionInfo {
  sessionId: string;
  memoryKey: string;
  createdAt: Date;
  lastUsedAt: Date;
  chunkCount: number;
  tokenCount: number;
}

// =============================================================================
// MEMORY KEY
// =============================================================================

export interface MemoryKeyInfo {
  key: string;
  userId: string;
  name?: string;
  isActive: boolean;
  createdAt: Date;
  lastUsedAt?: Date;
  sessionCount?: number;
}

// =============================================================================
// USER CONTEXT (set by auth middleware)
// =============================================================================

export interface UserContext {
  memoryKey: MemoryKeyInfo;
  providerKeys: Record<string, string>;
  userId: string;
}

// =============================================================================
// API RESPONSES
// =============================================================================

export interface ErrorResponse {
  error: {
    type: string;
    message: string;
    code: string;
    [key: string]: unknown;
  };
}

export interface SessionListResponse {
  sessions: SessionInfo[];
  total: number;
  memory_key: string;
}

export interface MemoryKeyListResponse {
  memory_keys: Array<{
    id: string;
    key: string;
    name?: string;
    is_active: boolean;
    created_at: string;
    last_used_at?: string;
    session_count?: number;
  }>;
  total: number;
}

export interface MemoryKeyCreateResponse {
  key: string;
  name?: string;
  created_at: string;
}
