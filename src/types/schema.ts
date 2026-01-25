/**
 * Database Schema Types
 * 
 * KEY ARCHITECTURAL PRINCIPLE:
 * ============================
 * Memory Keys and Provider Keys are COMPLETELY DECOUPLED.
 * 
 * - Memory Key → User → VectorVault (memory storage)
 * - Provider Key → User (API keys for AI providers)
 * 
 * There is NO direct link between memory_keys and provider_keys tables.
 * This enables:
 *   1. Same memory works with ANY model/provider
 *   2. Provider keys can be rotated without affecting memory
 *   3. User can switch providers anytime, history preserved
 */

// =============================================================================
// USERS
// =============================================================================

export interface User {
  id: string;                    // UUID
  email: string;
  name?: string;
  stripeCustomerId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// MEMORY KEYS (independent of providers)
// =============================================================================

/**
 * Memory Key - a unique, isolated memory context
 * 
 * Each memory key = one VectorVault namespace
 * Can be used with ANY provider/model
 * 
 * Table: memory_keys
 */
export interface MemoryKey {
  id: string;                    // UUID (internal)
  key: string;                   // 'mk_xxx' (exposed to user)
  userId: string;                // FK → users.id
  
  // NOTE: NO reference to provider_keys!
  // Memory is completely provider-agnostic
  
  name?: string;                 // User-friendly name
  isEphemeral: boolean;          // Auto-delete if never used
  isActive: boolean;
  lastUsedAt?: Date;
  memoryTokenCount: number;      // Usage tracking
  createdAt: Date;
  expiresAt?: Date;              // 90 days from last use
}

// =============================================================================
// PROVIDER KEYS (independent of memory)
// =============================================================================

export type Provider = 'openai' | 'anthropic' | 'openrouter' | 'google';

/**
 * Provider Key - API key for an AI provider
 * 
 * Linked to USER, not to memory key!
 * One key per provider per user.
 * 
 * Table: provider_keys
 */
export interface ProviderKey {
  id: string;                    // UUID
  userId: string;                // FK → users.id (NOT memory_keys!)
  provider: Provider;
  encryptedKey: string;          // Encrypted with KMS
  nickname?: string;             // e.g., "Production OpenAI Key"
  isActive: boolean;
  lastUsedAt?: Date;
  createdAt: Date;
}

// =============================================================================
// USAGE RECORDS
// =============================================================================

/**
 * Usage Record - tracks memory token usage per request
 * 
 * Table: usage_records
 */
export interface UsageRecord {
  id: string;                    // UUID
  memoryKeyId: string;           // FK → memory_keys.id
  requestId?: string;            // For debugging
  
  // Model used (for analytics, not billing)
  model: string;
  provider: Provider;
  
  // Memory tokens (what we bill for)
  memoryTokensIn: number;        // Tokens embedded (stored input)
  memoryTokensOut: number;       // Tokens stored (assistant response)
  memoryTokensRetrieved: number; // Tokens from RAG context
  memoryTokensEphemeral: number; // Tokens sent but not stored
  
  createdAt: Date;
}

// =============================================================================
// MEMORY CHUNKS (stored in VectorVault)
// =============================================================================

/**
 * Memory Chunk - a piece of stored conversation
 * 
 * Stored in VectorVault, partitioned by memory key
 * 
 * Table: memories (in VectorVault)
 */
export interface MemoryChunk {
  id: string;                    // UUID
  memoryKey: string;             // Partition key (mk_xxx)
  role: 'user' | 'assistant';
  content: string;
  embedding: number[];           // 3072-dim (text-embedding-3-large)
  tokenCount: number;
  
  // Metadata (for filtering/debugging, not for routing)
  model?: string;                // Model that generated/received this
  provider?: Provider;           // Provider used
  metadata?: Record<string, unknown>;
  
  createdAt: Date;
}

// =============================================================================
// EXAMPLE: How the architecture works
// =============================================================================

/**
 * Example: User has 3 memory keys and 2 provider keys
 * 
 * User: user_001
 * 
 * Memory Keys (all share same provider keys):
 *   - mk_project_alpha  → VectorVault namespace for project alpha
 *   - mk_project_beta   → VectorVault namespace for project beta  
 *   - mk_personal       → VectorVault namespace for personal use
 * 
 * Provider Keys (shared across ALL memory keys):
 *   - openai: sk-xxx
 *   - anthropic: sk-ant-xxx
 * 
 * Request Flow:
 *   POST /v1/chat/completions
 *   Authorization: Bearer mk_project_alpha    ← Memory key
 *   {"model": "anthropic/claude-3-opus", ...} ← Determines provider
 * 
 *   1. Validate mk_project_alpha → userId = user_001
 *   2. Get provider keys for user_001 → {openai: "sk-xxx", anthropic: "sk-ant-xxx"}
 *   3. Model is "anthropic/claude-3-opus" → use anthropic key
 *   4. Retrieve memory from mk_project_alpha namespace
 *   5. Forward to Anthropic with sk-ant-xxx
 *   6. Store response in mk_project_alpha namespace
 * 
 * User can:
 *   - Rotate their Anthropic key anytime (memory preserved)
 *   - Use same memory key with OpenAI next request
 *   - Create new memory keys without adding provider keys
 */
