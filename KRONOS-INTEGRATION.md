# KRONOS Integration Specification for MemoryRouter

**Version:** 1.0  
**Created:** 2026-01-25  
**Status:** Implementation Ready  

---

## 1. Overview

This document specifies how MemoryRouter integrates KRONOS (the time-windowed memory engine) with VectorVault (the vector storage infrastructure) to deliver model-agnostic, temporally-aware memory.

### Core Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MEMORYROUTER + KRONOS + VECTORVAULT                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Client Request                                                            │
│        │                                                                    │
│        ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                      MemoryRouter API                               │  │
│   │   • Authenticate memory key (mk_xxx)                                │  │
│   │   • Parse model/provider                                            │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│        │                                                                    │
│        ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                      KRONOS Memory Engine                            │  │
│   │   ┌───────────┐   ┌───────────┐   ┌───────────┐                    │  │
│   │   │ 🔥 HOT    │   │ 🧠 WORKING│   │ 📚 LONG   │                    │  │
│   │   │  (4h)    │   │   (3d)    │   │  TERM     │                    │  │
│   │   └─────┬─────┘   └─────┬─────┘   └─────┬─────┘                    │  │
│   │         │               │               │                           │  │
│   │         └───────────────┼───────────────┘                           │  │
│   │                         ▼                                           │  │
│   │              Equal Allocation Merge                                 │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│        │                                                                    │
│        ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                     VectorVault Cloud                                │  │
│   │   • Per-memory-key vault isolation                                  │  │
│   │   • FAISS vector index (HNSW)                                       │  │
│   │   • Temporal metadata for window filtering                           │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. KRONOS Time Windows for MemoryRouter

### 2.1 Window Configuration

| Window | Duration | Purpose | Rebuild Frequency |
|--------|----------|---------|-------------------|
| **HOT** | 4 hours | Current conversation/session context | Hourly |
| **WORKING** | 3 days | Recent interactions across sessions | Every 6 hours |
| **LONG-TERM** | 90 days | Full memory (limited by retention) | On write (incremental) |

### 2.2 MemoryRouter-Specific Considerations

Unlike Clawdbot (single-agent), MemoryRouter serves **thousands of memory keys** simultaneously. This changes the architecture:

| Aspect | Clawdbot KRONOS | MemoryRouter KRONOS |
|--------|-----------------|---------------------|
| Storage | Single SQLite per agent | One VectorVault per memory key |
| Windows | Physical tables per window | Metadata-filtered queries |
| Rebuild | Shadow-swap tables | Lazy rebuild on access |
| Scale | 1 agent, ~50k chunks | 10k+ memory keys, millions of chunks |

### 2.3 Window Implementation Strategy

Instead of maintaining three separate vaults per memory key (expensive), we use a **single vault with temporal metadata filtering**:

```javascript
// Each chunk stored with temporal metadata
const chunkMetadata = {
  created_at: Date.now(),           // When this memory was created
  role: 'user' | 'assistant',       // Message role
  model: 'anthropic/claude-3-opus', // Model that processed this
  request_id: 'req_xxx',            // For debugging/billing
  memory_key: 'mk_xxx',             // Partition key (redundant but useful)
};

// Window filtering happens at query time
function getWindowCutoff(window) {
  const now = Date.now();
  switch (window) {
    case 'hot':      return now - (4 * 60 * 60 * 1000);  // 4 hours
    case 'working':  return now - (3 * 24 * 60 * 60 * 1000); // 3 days
    case 'longterm': return now - (90 * 24 * 60 * 60 * 1000); // 90 days
  }
}
```

---

## 3. VectorVault Integration

### 3.1 Vault Naming Convention

Each memory key gets its own isolated VectorVault:

```
VectorVault Cloud Storage:
├── memoryrouter-mk_abc123/          # Memory key 1
│   ├── vectors.faiss
│   ├── mapping.json
│   ├── items/
│   └── meta/
├── memoryrouter-mk_def456/          # Memory key 2
│   └── ...
└── memoryrouter-mk_ghi789/          # Memory key 3
    └── ...
```

### 3.2 VectorVault Client Singleton

```typescript
// src/memory/vault-pool.ts

import { Vault } from 'vectorvault';

interface VaultPoolOptions {
  vectorvaultApiKey: string;
  openaiKey: string;
  maxCached: number;
}

class VaultPool {
  private cache: Map<string, { vault: Vault; lastAccess: number }> = new Map();
  private config: VaultPoolOptions;

  constructor(config: VaultPoolOptions) {
    this.config = config;
  }

  /**
   * Get or create a vault for a memory key.
   * Vaults are lazily initialized and cached.
   */
  async getVault(memoryKey: string): Promise<Vault> {
    const cached = this.cache.get(memoryKey);
    if (cached) {
      cached.lastAccess = Date.now();
      return cached.vault;
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.config.maxCached) {
      this.evictOldest();
    }

    // Create new vault (lazy - doesn't create storage until first write)
    const vault = new Vault({
      user: 'memoryrouter',
      api_key: this.config.vectorvaultApiKey,
      openai_key: this.config.openaiKey,
      vault: `memoryrouter-${memoryKey}`,
    });

    this.cache.set(memoryKey, { vault, lastAccess: Date.now() });
    return vault;
  }

  private evictOldest(): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.cache) {
      if (entry.lastAccess < oldestTime) {
        oldest = key;
        oldestTime = entry.lastAccess;
      }
    }
    
    if (oldest) {
      this.cache.delete(oldest);
    }
  }

  /**
   * Explicitly close a vault (memory key deletion).
   */
  async closeVault(memoryKey: string): Promise<void> {
    this.cache.delete(memoryKey);
  }
}

// Singleton instance
let pool: VaultPool | null = null;

export function initVaultPool(config: VaultPoolOptions): VaultPool {
  pool = new VaultPool(config);
  return pool;
}

export function getVaultPool(): VaultPool {
  if (!pool) throw new Error('VaultPool not initialized');
  return pool;
}
```

### 3.3 Vault Initialization (Lazy)

Vaults are created **on first write only**:

```typescript
// Vault doesn't create cloud storage until data is added
const vault = await vaultPool.getVault('mk_abc123');

// This is instant - no storage allocated yet
// Storage only created when:
vault.add("First memory content", { meta: { created_at: Date.now() } });
vault.get_vectors();  // Generates embeddings
vault.save();         // NOW storage is allocated
```

This prevents bloat from unused/ephemeral memory keys.

---

## 4. Memory Retrieval Flow

### 4.1 Complete Retrieval Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MEMORY RETRIEVAL FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. EXTRACT QUERY                                                           │
│     └── Last user message + system context → query string                   │
│                                                                             │
│  2. GET VAULT                                                               │
│     └── VaultPool.getVault(memoryKey) → Vault instance                     │
│                                                                             │
│  3. SEARCH EACH WINDOW (parallel)                                           │
│     ┌─────────────────────────────────────────────────────────────────┐    │
│     │  HOT (4h)                                                      │    │
│     │  vault.get_similar(query, { n: N/3, filter: created_at > 4h }) │    │
│     └─────────────────────────────────────────────────────────────────┘    │
│     ┌─────────────────────────────────────────────────────────────────┐    │
│     │  WORKING (3d)                                                   │    │
│     │  vault.get_similar(query, { n: N/3, filter: created_at > 3d })  │    │
│     └─────────────────────────────────────────────────────────────────┘    │
│     ┌─────────────────────────────────────────────────────────────────┐    │
│     │  LONG-TERM (90d)                                                │    │
│     │  vault.get_similar(query, { n: N/3, filter: created_at > 90d }) │    │
│     └─────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  4. MERGE & DEDUPE                                                          │
│     └── Combine results, dedupe by content hash, sort by score             │
│                                                                             │
│  5. BACKFILL (if sparse)                                                    │
│     └── If HOT has < N/3, pull extra from WORKING or LONG-TERM            │
│                                                                             │
│  6. FORMAT FOR MODEL                                                        │
│     └── Apply model-specific formatter (Claude XML, GPT markdown, etc.)   │
│                                                                             │
│  7. INJECT INTO REQUEST                                                     │
│     └── Prepend formatted context to system message                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Implementation

```typescript
// src/memory/kronos-retriever.ts

interface RetrievalOptions {
  memoryKey: string;
  query: string;
  maxResults?: number;
  minScore?: number;
  recencyBias?: 'low' | 'medium' | 'high';
}

interface RetrievedMemory {
  content: string;
  role: 'user' | 'assistant';
  score: number;
  window: 'hot' | 'working' | 'longterm';
  createdAt: number;
  model?: string;
}

const WINDOW_DURATIONS = {
  hot: 4 * 60 * 60 * 1000,        // 4 hours
  working: 3 * 24 * 60 * 60 * 1000, // 3 days
  longterm: 90 * 24 * 60 * 60 * 1000, // 90 days
};

async function retrieveMemory(opts: RetrievalOptions): Promise<RetrievedMemory[]> {
  const { memoryKey, query, maxResults = 12, minScore = 0.1 } = opts;
  
  const vault = await getVaultPool().getVault(memoryKey);
  const now = Date.now();

  // Calculate allocation per window
  const { hot, working, longterm } = allocatePerWindow(maxResults);

  // Parallel search across all windows
  const [hotResults, workingResults, longtermResults] = await Promise.all([
    searchWindow(vault, query, 'hot', hot, now - WINDOW_DURATIONS.hot),
    searchWindow(vault, query, 'working', working, now - WINDOW_DURATIONS.working),
    searchWindow(vault, query, 'longterm', longterm, now - WINDOW_DURATIONS.longterm),
  ]);

  // Merge and dedupe
  let results = mergeAndDedupe([...hotResults, ...workingResults, ...longtermResults]);

  // Filter by minimum score
  results = results.filter(r => r.score >= minScore);

  // Backfill if needed
  results = await backfillIfSparse(vault, query, results, maxResults, now);

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, maxResults);
}

function allocatePerWindow(n: number): { hot: number; working: number; longterm: number } {
  const base = Math.floor(n / 3);
  const remainder = n % 3;
  return {
    hot: base + (remainder > 0 ? 1 : 0),
    working: base + (remainder > 1 ? 1 : 0),
    longterm: base,
  };
}

async function searchWindow(
  vault: Vault,
  query: string,
  window: string,
  limit: number,
  cutoffMs: number
): Promise<RetrievedMemory[]> {
  if (limit === 0) return [];

  try {
    // VectorVault get_similar with metadata filter
    const results = await vault.get_similar(query, {
      n: limit * 2, // Fetch extra in case some are filtered
    });

    // Filter by temporal window
    return results
      .filter((r: any) => r.meta?.created_at >= cutoffMs)
      .slice(0, limit)
      .map((r: any) => ({
        content: r.text,
        role: r.meta?.role || 'user',
        score: r.score,
        window: window as any,
        createdAt: r.meta?.created_at || 0,
        model: r.meta?.model,
      }));
  } catch (err) {
    // Empty vault or search error - return empty
    console.warn(`[KRONOS] Window ${window} search failed:`, err);
    return [];
  }
}

function mergeAndDedupe(results: RetrievedMemory[]): RetrievedMemory[] {
  const seen = new Map<string, RetrievedMemory>();
  
  for (const result of results) {
    // Hash content for deduplication
    const contentKey = hashContent(result.content);
    const existing = seen.get(contentKey);
    
    // Keep highest scored version
    if (!existing || result.score > existing.score) {
      seen.set(contentKey, result);
    }
  }
  
  return Array.from(seen.values());
}

async function backfillIfSparse(
  vault: Vault,
  query: string,
  results: RetrievedMemory[],
  maxResults: number,
  now: number
): Promise<RetrievedMemory[]> {
  if (results.length >= maxResults) return results;

  const deficit = maxResults - results.length;
  
  // Pull more from long-term (most likely to have content)
  const additional = await searchWindow(
    vault, 
    query, 
    'longterm', 
    deficit, 
    now - WINDOW_DURATIONS.longterm
  );

  return mergeAndDedupe([...results, ...additional]);
}

function hashContent(content: string): string {
  // Simple hash for deduplication
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

export { retrieveMemory, RetrievalOptions, RetrievedMemory };
```

### 4.3 Context Formatting

```typescript
// src/memory/context-formatter.ts

interface FormattedContext {
  systemPrefix: string;
  tokenCount: number;
}

const formatters: Record<string, (memories: RetrievedMemory[]) => string> = {
  // Anthropic models prefer XML
  claude: (memories) => `<memory_context>
${memories.map(m => `<memory role="${m.role}" window="${m.window}">
${m.content}
</memory>`).join('\n')}
</memory_context>

Use the above context from previous conversations to inform your response. Do not explicitly reference "memory" unless asked.`,

  // OpenAI models prefer markdown
  gpt: (memories) => `## Relevant Memory
---
${memories.map(m => `**[${m.role}]** ${m.content}`).join('\n\n')}
---

Use this context to inform your response.`,

  // Llama/Meta models
  llama: (memories) => `[MEMORY_CONTEXT]
${memories.map(m => `[${m.role.toUpperCase()}] ${m.content}`).join('\n')}
[/MEMORY_CONTEXT]

The above is relevant context from previous conversations.`,

  // Google Gemini
  gemini: (memories) => `<context type="memory">
${memories.map(m => `<entry role="${m.role}">${m.content}</entry>`).join('\n')}
</context>`,

  // Default fallback
  default: (memories) => `Relevant context from previous conversations:

${memories.map(m => `[${m.role}]: ${m.content}`).join('\n\n')}

Use this context to inform your response, but don't reference it directly unless asked.`,
};

function getFormatter(model: string): (memories: RetrievedMemory[]) => string {
  if (model.includes('claude')) return formatters.claude;
  if (model.includes('gpt')) return formatters.gpt;
  if (model.includes('llama')) return formatters.llama;
  if (model.includes('gemini')) return formatters.gemini;
  return formatters.default;
}

function formatMemoryContext(model: string, memories: RetrievedMemory[]): FormattedContext {
  if (memories.length === 0) {
    return { systemPrefix: '', tokenCount: 0 };
  }

  const formatter = getFormatter(model);
  const systemPrefix = formatter(memories);
  
  // Rough token count (4 chars ≈ 1 token)
  const tokenCount = Math.ceil(systemPrefix.length / 4);

  return { systemPrefix, tokenCount };
}

export { formatMemoryContext, FormattedContext };
```

---

## 5. Memory Storage Flow

### 5.1 Complete Storage Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MEMORY STORAGE FLOW                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. RESPONSE COMPLETES                                                      │
│     └── Full response captured (streaming accumulated)                      │
│                                                                             │
│  2. FILTER MESSAGES                                                         │
│     ├── Skip messages with `memory: false`                                 │
│     ├── Skip if X-Memory-Store: false header                               │
│     └── Skip response if X-Memory-Store-Response: false                    │
│                                                                             │
│  3. PREPARE CHUNKS                                                          │
│     ├── User messages → individual chunks                                  │
│     └── Assistant response → chunk (or split if >4000 tokens)             │
│                                                                             │
│  4. ADD METADATA                                                            │
│     └── { created_at, role, model, request_id, memory_key }               │
│                                                                             │
│  5. EMBED & STORE                                                           │
│     ├── vault.add(text, meta)                                              │
│     ├── vault.get_vectors()  ← Batched embedding                           │
│     └── vault.save()         ← Persist to VectorVault Cloud               │
│                                                                             │
│  6. METER TOKENS                                                            │
│     └── Record tokens for billing                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Implementation

```typescript
// src/memory/kronos-storer.ts

interface StorageOptions {
  memoryKey: string;
  requestId: string;
  model: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    memory?: boolean;  // Selective memory control
  }>;
  assistantResponse: string;
  storeInput?: boolean;      // From X-Memory-Store header
  storeResponse?: boolean;   // From X-Memory-Store-Response header
}

interface StorageResult {
  storedCount: number;
  tokenCount: number;
  skippedCount: number;
}

async function storeMemory(opts: StorageOptions): Promise<StorageResult> {
  const {
    memoryKey,
    requestId,
    model,
    messages,
    assistantResponse,
    storeInput = true,
    storeResponse = true,
  } = opts;

  const vault = await getVaultPool().getVault(memoryKey);
  const now = Date.now();
  
  let storedCount = 0;
  let tokenCount = 0;
  let skippedCount = 0;

  // Store input messages
  if (storeInput) {
    for (const msg of messages) {
      // Skip system messages
      if (msg.role === 'system') continue;
      
      // Skip if memory: false (selective memory)
      if (msg.memory === false) {
        skippedCount++;
        continue;
      }

      // Split large messages into chunks
      const chunks = chunkText(msg.content, 4000);
      
      for (const chunk of chunks) {
        vault.add(chunk, {
          created_at: now,
          role: msg.role,
          model,
          request_id: requestId,
          memory_key: memoryKey,
        });
        storedCount++;
        tokenCount += estimateTokens(chunk);
      }
    }
  }

  // Store assistant response
  if (storeResponse && assistantResponse) {
    const chunks = chunkText(assistantResponse, 4000);
    
    for (const chunk of chunks) {
      vault.add(chunk, {
        created_at: now,
        role: 'assistant',
        model,
        request_id: requestId,
        memory_key: memoryKey,
      });
      storedCount++;
      tokenCount += estimateTokens(chunk);
    }
  }

  // Only save if we stored something
  if (storedCount > 0) {
    await vault.get_vectors();  // Generate embeddings
    await vault.save();          // Persist to cloud
  }

  return { storedCount, tokenCount, skippedCount };
}

function chunkText(text: string, maxTokens: number): string[] {
  const maxChars = maxTokens * 4;  // ~4 chars per token
  
  if (text.length <= maxChars) return [text];
  
  const chunks: string[] = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    // Try to break at paragraph or sentence
    let breakPoint = maxChars;
    
    if (remaining.length > maxChars) {
      const paragraphBreak = remaining.lastIndexOf('\n\n', maxChars);
      const sentenceBreak = remaining.lastIndexOf('. ', maxChars);
      
      if (paragraphBreak > maxChars * 0.5) {
        breakPoint = paragraphBreak + 2;
      } else if (sentenceBreak > maxChars * 0.5) {
        breakPoint = sentenceBreak + 2;
      }
    } else {
      breakPoint = remaining.length;
    }
    
    chunks.push(remaining.slice(0, breakPoint).trim());
    remaining = remaining.slice(breakPoint).trim();
  }
  
  return chunks;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export { storeMemory, StorageOptions, StorageResult };
```

### 5.3 Batched Embedding Strategy

For high-throughput, batch embedding calls:

```typescript
// src/memory/embedding-batcher.ts

interface EmbeddingBatch {
  memoryKey: string;
  texts: string[];
  metadata: any[];
}

class EmbeddingBatcher {
  private pending: Map<string, EmbeddingBatch> = new Map();
  private flushInterval: NodeJS.Timeout;
  
  constructor(private flushIntervalMs = 100) {
    this.flushInterval = setInterval(() => this.flushAll(), flushIntervalMs);
  }

  async add(memoryKey: string, text: string, meta: any): Promise<void> {
    let batch = this.pending.get(memoryKey);
    if (!batch) {
      batch = { memoryKey, texts: [], metadata: [] };
      this.pending.set(memoryKey, batch);
    }
    
    batch.texts.push(text);
    batch.metadata.push(meta);
  }

  async flushAll(): Promise<void> {
    const batches = Array.from(this.pending.values());
    this.pending.clear();

    await Promise.all(batches.map(batch => this.flushBatch(batch)));
  }

  private async flushBatch(batch: EmbeddingBatch): Promise<void> {
    if (batch.texts.length === 0) return;

    const vault = await getVaultPool().getVault(batch.memoryKey);
    
    for (let i = 0; i < batch.texts.length; i++) {
      vault.add(batch.texts[i], batch.metadata[i]);
    }
    
    await vault.get_vectors();  // Batch embedding call
    await vault.save();
  }

  stop(): void {
    clearInterval(this.flushInterval);
  }
}

export const embeddingBatcher = new EmbeddingBatcher();
```

---

## 6. Shadow-Swap Strategy for MemoryRouter

### 6.1 The Challenge

With metadata-filtered windows (not physical tables), traditional shadow-swap doesn't apply. Instead, we need:

1. **Temporal cleanup** — Expire chunks older than 90 days
2. **Index optimization** — Periodically rebuild FAISS indices
3. **Zero-downtime** — No query interruption during maintenance

### 6.2 Lazy Maintenance Strategy

```typescript
// src/memory/vault-maintenance.ts

interface MaintenanceStatus {
  lastCleanup: number;
  lastOptimize: number;
  chunkCount: number;
}

const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;  // Daily
const OPTIMIZE_INTERVAL = 7 * 24 * 60 * 60 * 1000;  // Weekly

class VaultMaintenance {
  private status: Map<string, MaintenanceStatus> = new Map();

  /**
   * Check if maintenance is needed (called on vault access).
   * Maintenance runs lazily - only when vault is accessed.
   */
  async checkAndMaintain(memoryKey: string, vault: Vault): Promise<void> {
    const status = this.status.get(memoryKey) || {
      lastCleanup: 0,
      lastOptimize: 0,
      chunkCount: 0,
    };

    const now = Date.now();

    // Check if cleanup needed
    if (now - status.lastCleanup > CLEANUP_INTERVAL) {
      await this.cleanup(memoryKey, vault);
      status.lastCleanup = now;
    }

    // Check if optimization needed (less frequent)
    if (now - status.lastOptimize > OPTIMIZE_INTERVAL) {
      await this.optimize(memoryKey, vault);
      status.lastOptimize = now;
    }

    this.status.set(memoryKey, status);
  }

  /**
   * Remove chunks older than retention period (90 days).
   */
  private async cleanup(memoryKey: string, vault: Vault): Promise<void> {
    const cutoff = Date.now() - (90 * 24 * 60 * 60 * 1000);
    
    try {
      // Get all items and filter by age
      const allItems = await vault.get_items();
      const expiredIds: string[] = [];

      for (const item of allItems) {
        if (item.meta?.created_at && item.meta.created_at < cutoff) {
          expiredIds.push(item.id);
        }
      }

      if (expiredIds.length > 0) {
        await vault.delete_items(expiredIds);
        await vault.save();
        console.log(`[Maintenance] ${memoryKey}: Cleaned ${expiredIds.length} expired chunks`);
      }
    } catch (err) {
      console.warn(`[Maintenance] ${memoryKey}: Cleanup failed:`, err);
    }
  }

  /**
   * Rebuild FAISS index for better performance.
   * VectorVault handles this internally via get_vectors() on modified data.
   */
  private async optimize(memoryKey: string, vault: Vault): Promise<void> {
    try {
      // Force re-index by getting vectors (VectorVault optimizes internally)
      await vault.get_vectors();
      await vault.save();
      console.log(`[Maintenance] ${memoryKey}: Index optimized`);
    } catch (err) {
      console.warn(`[Maintenance] ${memoryKey}: Optimization failed:`, err);
    }
  }
}

export const vaultMaintenance = new VaultMaintenance();
```

### 6.3 Background Maintenance Queue

For high-traffic vaults, defer maintenance to background:

```typescript
// src/memory/maintenance-queue.ts

interface MaintenanceJob {
  memoryKey: string;
  type: 'cleanup' | 'optimize';
  scheduledAt: number;
}

class MaintenanceQueue {
  private queue: MaintenanceJob[] = [];
  private processing = false;

  schedule(memoryKey: string, type: 'cleanup' | 'optimize'): void {
    // Dedupe - don't schedule if already queued
    const existing = this.queue.find(
      j => j.memoryKey === memoryKey && j.type === type
    );
    if (existing) return;

    this.queue.push({
      memoryKey,
      type,
      scheduledAt: Date.now(),
    });

    this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    const job = this.queue.shift()!;

    try {
      const vault = await getVaultPool().getVault(job.memoryKey);
      
      if (job.type === 'cleanup') {
        await vaultMaintenance.cleanup(job.memoryKey, vault);
      } else {
        await vaultMaintenance.optimize(job.memoryKey, vault);
      }
    } catch (err) {
      console.error(`[MaintenanceQueue] Failed:`, job, err);
    }

    this.processing = false;
    
    // Process next after small delay
    setTimeout(() => this.processNext(), 100);
  }
}

export const maintenanceQueue = new MaintenanceQueue();
```

---

## 7. Scaling Considerations

### 7.1 Multi-Tenant Isolation

| Concern | Solution |
|---------|----------|
| Memory isolation | One vault per memory key (namespace `memoryrouter-{mk_xxx}`) |
| Cross-contamination | VectorVault enforces vault isolation |
| Key enumeration | Memory keys are UUIDs (non-guessable) |
| Rate limiting | Per-user and per-key limits |

### 7.2 Performance at Scale

| Metric | Target | Strategy |
|--------|--------|----------|
| Vault pool size | 1,000 hot vaults | LRU eviction, lazy loading |
| Search latency (p99) | <100ms | VectorVault Cloud edge caching |
| Storage latency (p99) | <500ms | Batched embeddings, async persistence |
| Memory per vault | ~10MB | FAISS IVF + PQ compression |

### 7.3 VectorVault Cloud Scaling

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    VECTORVAULT CLOUD ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   MemoryRouter API (Cloud Run)                                              │
│        │                                                                    │
│        ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                    VectorVault Cloud API                            │  │
│   │   • Sub-second responses (99.9% SLA)                                │  │
│   │   • Auto-scaling                                                    │  │
│   │   • Edge caching for hot vaults                                     │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│        │                                                                    │
│        ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                    Distributed Storage                              │  │
│   │   • 10k+ concurrent vaults                                          │  │
│   │   • Geographic replication                                          │  │
│   │   • Automatic backup                                                │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.4 Horizontal Scaling Pattern

```typescript
// Multiple MemoryRouter instances share VaultPool state via VectorVault Cloud

// Instance 1                    Instance 2
//     │                             │
//     └──────────┬──────────────────┘
//                ▼
//        VectorVault Cloud
//         (shared state)
//                │
//     ┌──────────┼──────────┐
//     ▼          ▼          ▼
//   Vault 1    Vault 2    Vault 3
//  (mk_abc)   (mk_def)   (mk_ghi)
```

No cross-instance coordination needed — VectorVault Cloud handles consistency.

---

## 8. Complete API/Code Patterns

### 8.1 Request Handler Integration

```typescript
// src/handlers/chat.ts

import { retrieveMemory } from '../memory/kronos-retriever';
import { storeMemory } from '../memory/kronos-storer';
import { formatMemoryContext } from '../memory/context-formatter';
import { forwardToProvider } from '../providers/router';
import { meterUsage } from '../billing/meter';

interface ChatRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    memory?: boolean;
  }>;
}

async function handleChatCompletion(
  memoryKey: string,
  request: ChatRequest,
  headers: Record<string, string>
): Promise<Response> {
  const requestId = generateRequestId();
  const model = request.model;

  // Parse memory control headers
  const memoryMode = headers['x-memory-mode'] || 'auto';
  const storeInput = headers['x-memory-store'] !== 'false';
  const storeResponse = headers['x-memory-store-response'] !== 'false';
  const contextLimit = parseInt(headers['x-memory-context-limit'] || '12');

  // 1. RETRIEVE: Get relevant memory context
  let retrievedTokens = 0;
  let augmentedMessages = [...request.messages];

  if (memoryMode === 'auto' || memoryMode === 'read') {
    // Extract query from last user message
    const userMessages = request.messages.filter(m => m.role === 'user');
    const query = userMessages[userMessages.length - 1]?.content || '';

    if (query) {
      const memories = await retrieveMemory({
        memoryKey,
        query,
        maxResults: contextLimit,
      });

      if (memories.length > 0) {
        const { systemPrefix, tokenCount } = formatMemoryContext(model, memories);
        retrievedTokens = tokenCount;

        // Prepend to system message or create one
        const systemIdx = augmentedMessages.findIndex(m => m.role === 'system');
        if (systemIdx >= 0) {
          augmentedMessages[systemIdx] = {
            ...augmentedMessages[systemIdx],
            content: systemPrefix + '\n\n' + augmentedMessages[systemIdx].content,
          };
        } else {
          augmentedMessages.unshift({
            role: 'system',
            content: systemPrefix,
          });
        }
      }
    }
  }

  // 2. FORWARD: Send to provider
  const providerResponse = await forwardToProvider(model, {
    ...request,
    messages: augmentedMessages,
  });

  // Capture full response (for storage + streaming)
  const fullResponse = await captureStreamedResponse(providerResponse);

  // 3. STORE: Save to memory (async, don't block response)
  if (memoryMode === 'auto' || memoryMode === 'write') {
    setImmediate(async () => {
      try {
        const result = await storeMemory({
          memoryKey,
          requestId,
          model,
          messages: request.messages,
          assistantResponse: fullResponse.content,
          storeInput,
          storeResponse,
        });

        // 4. METER: Record usage
        await meterUsage({
          memoryKey,
          requestId,
          model,
          tokensStored: result.tokenCount,
          tokensRetrieved: retrievedTokens,
          tokensSkipped: result.skippedCount,
        });
      } catch (err) {
        console.error(`[Storage] Failed for ${requestId}:`, err);
      }
    });
  }

  return providerResponse;
}

export { handleChatCompletion };
```

### 8.2 Memory Key Lifecycle

```typescript
// src/memory/memory-key-lifecycle.ts

/**
 * Create a new memory key.
 * Keys are "virtual" until first write (no storage allocated).
 */
async function createMemoryKey(userId: string, name?: string): Promise<string> {
  const key = `mk_${generateSecureId()}`;
  
  // Just store metadata - vault created lazily on first use
  await db.memoryKeys.insert({
    key,
    user_id: userId,
    name: name || null,
    is_ephemeral: true,  // Becomes false on first write
    created_at: Date.now(),
  });

  return key;
}

/**
 * Delete a memory key and all associated memory.
 */
async function deleteMemoryKey(memoryKey: string): Promise<void> {
  // 1. Delete from vault pool cache
  await getVaultPool().closeVault(memoryKey);

  // 2. Delete VectorVault cloud storage
  const vault = new Vault({
    user: 'memoryrouter',
    api_key: config.vectorvaultApiKey,
    vault: `memoryrouter-${memoryKey}`,
  });
  await vault.delete_vault();

  // 3. Delete metadata
  await db.memoryKeys.delete({ key: memoryKey });
  await db.usageRecords.delete({ memory_key: memoryKey });
}

/**
 * Clear memory but keep the key.
 */
async function clearMemory(memoryKey: string): Promise<void> {
  const vault = await getVaultPool().getVault(memoryKey);
  
  // Get all items and delete
  const items = await vault.get_items();
  const ids = items.map((i: any) => i.id);
  
  if (ids.length > 0) {
    await vault.delete_items(ids);
    await vault.save();
  }

  // Reset usage counters
  await db.memoryKeys.update(
    { key: memoryKey },
    { memory_token_count: 0 }
  );
}

export { createMemoryKey, deleteMemoryKey, clearMemory };
```

### 8.3 Search Endpoint (Debugging/Admin)

```typescript
// src/handlers/memory-search.ts

interface SearchRequest {
  query: string;
  limit?: number;
  window?: 'hot' | 'working' | 'longterm' | 'all';
}

async function handleMemorySearch(
  memoryKey: string,
  request: SearchRequest
): Promise<RetrievedMemory[]> {
  const { query, limit = 10, window = 'all' } = request;

  if (window === 'all') {
    return retrieveMemory({
      memoryKey,
      query,
      maxResults: limit,
    });
  }

  // Search specific window
  const vault = await getVaultPool().getVault(memoryKey);
  const cutoff = Date.now() - WINDOW_DURATIONS[window];

  return searchWindow(vault, query, window, limit, cutoff);
}

export { handleMemorySearch };
```

---

## 9. Configuration Reference

```typescript
// src/config/kronos.ts

export const KRONOS_CONFIG = {
  // Temporal windows
  windows: {
    hot: {
      durationMs: 4 * 60 * 60 * 1000,     // 4 hours
      rebuildIntervalMs: 60 * 60 * 1000,   // Hourly (lazy)
    },
    working: {
      durationMs: 3 * 24 * 60 * 60 * 1000, // 3 days
      rebuildIntervalMs: 6 * 60 * 60 * 1000, // Every 6 hours (lazy)
    },
    longterm: {
      durationMs: 90 * 24 * 60 * 60 * 1000, // 90 days (retention limit)
      rebuildIntervalMs: null,              // Incremental only
    },
  },

  // Search defaults
  search: {
    defaultMaxResults: 12,
    minScore: 0.1,
    allocationStrategy: 'equal',  // N/3 per window
    enableBackfill: true,
  },

  // Storage
  storage: {
    maxChunkTokens: 4000,
    batchFlushMs: 100,
    embeddingModel: 'text-embedding-3-large',
    embeddingDimensions: 3072,
  },

  // Vault pool
  vaultPool: {
    maxCached: 1000,
    evictionPolicy: 'lru',
  },

  // Maintenance
  maintenance: {
    cleanupIntervalMs: 24 * 60 * 60 * 1000,  // Daily
    optimizeIntervalMs: 7 * 24 * 60 * 60 * 1000,  // Weekly
    runInBackground: true,
  },
};
```

---

## 10. Implementation Checklist

### Phase 1: Core Integration
- [ ] VaultPool singleton with LRU caching
- [ ] KRONOS retriever with temporal windowing
- [ ] Context formatters (Claude, GPT, Llama, Gemini)
- [ ] Memory storer with selective memory support
- [ ] Basic maintenance (cleanup, optimize)

### Phase 2: Production Hardening
- [ ] Batched embedding for throughput
- [ ] Background maintenance queue
- [ ] Error handling and retries
- [ ] Metrics and logging
- [ ] Rate limiting per memory key

### Phase 3: Optimization
- [ ] Warm vault preloading for frequent keys
- [ ] Query caching for repeated searches
- [ ] Compression for large memories
- [ ] Cross-region replication

---

## 11. Testing Strategy

```typescript
// tests/kronos-integration.test.ts

describe('KRONOS Integration', () => {
  describe('Temporal Windowing', () => {
    it('returns results from all three windows', async () => {
      // Create vault with chunks at different ages
      // Verify allocation is ~N/3 per window
    });

    it('backfills when recent windows are sparse', async () => {
      // Create vault with only long-term chunks
      // Verify backfill pulls from long-term
    });

    it('respects minimum score threshold', async () => {
      // Add low-relevance chunks
      // Verify they're filtered out
    });
  });

  describe('Selective Memory', () => {
    it('skips messages with memory: false', async () => {
      // Store message with memory: false
      // Verify it's not in vault
    });

    it('respects X-Memory-Store header', async () => {
      // Send request with header
      // Verify nothing stored
    });
  });

  describe('Cross-Model Memory', () => {
    it('memory persists across different models', async () => {
      // Store with Claude, retrieve with GPT
      // Verify context available
    });
  });
});
```

---

## 12. Observability

### Key Metrics

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `kronos.search.latency_ms` | Search latency (p99) | > 200ms |
| `kronos.store.latency_ms` | Store latency (p99) | > 1000ms |
| `kronos.vault_pool.size` | Active vaults in pool | > 800 (of 1000) |
| `kronos.vault_pool.evictions` | Evictions per minute | > 100/min |
| `kronos.maintenance.queue_depth` | Pending maintenance jobs | > 1000 |

### Logging

```typescript
const log = createLogger('kronos');

// Key events
log.info({ memoryKey, window, count: results.length, latencyMs }, 'search complete');
log.info({ memoryKey, stored: count, skipped, latencyMs }, 'store complete');
log.warn({ memoryKey, error }, 'vault access failed');
log.error({ memoryKey, error }, 'maintenance failed');
```

---

*KRONOS for MemoryRouter: Temporal memory at scale. 🧠⚡*
