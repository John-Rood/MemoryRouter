# Cloudflare Workers Implementation Plan for MemoryRouter

**Version:** 1.0  
**Created:** 2026-01-25  
**Status:** Planning  

---

## Executive Summary

This document outlines how to deploy MemoryRouter on Cloudflare Workers using TypeScript-native vector search. The key insight: **VectorVault-js already has a pure TypeScript vector index** (`MemoryVectorIndex`) that works without FAISS. We'll adapt this for Workers' constraints.

### Why This Works

| Challenge | Solution |
|-----------|----------|
| No native bindings on Workers | VectorVault-js `MemoryVectorIndex` is pure TypeScript |
| 128MB memory limit | Shard vectors across KV/R2, load only what's needed |
| 10-50ms CPU limit | Brute-force kNN is fast enough for small-medium indexes |
| No filesystem | Store vectors in KV (hot) + R2 (bulk) |
| Stateless Workers | Use Durable Objects for coordination |

---

## 1. TypeScript Native Vector Architecture

### 1.1 The Existing Pure-TS Implementation

VectorVault-js already has a FAISS-free vector index at `src/vectors/memory.ts`:

```typescript
// Existing MemoryVectorIndex - NO native dependencies
export class MemoryVectorIndex implements VectorIndex {
  private vectors: Map<number, Float32Array>;
  private dims: number;

  // L2 normalize for cosine similarity via inner product
  private normalize(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return vector.map(v => v / magnitude);
  }

  // Brute-force search - O(n) but fast for small indexes
  search(vector: number[], n: number): VectorSearchResult {
    const normalized = new Float32Array(this.normalize(vector));
    const similarities: Array<{ id: number; similarity: number }> = [];

    for (const id of this.sortedIds) {
      const vec = this.vectors.get(id)!;
      const similarity = this.innerProduct(normalized, vec);
      similarities.push({ id, similarity });
    }

    similarities.sort((a, b) => b.similarity - a.similarity);
    return this.toResult(similarities.slice(0, n));
  }
}
```

### 1.2 Algorithm: Brute-Force kNN

For MemoryRouter on Workers, we use **brute-force k-nearest-neighbors**:

```
Algorithm: Brute-Force Cosine kNN
─────────────────────────────────────────
Input: Query vector q (3072 dims), corpus V (n vectors), k (results)

1. Normalize q to unit length
2. For each vector v in V:
   - Compute similarity = dot(q, v)  # Already normalized = cosine
   - Add (id, similarity) to results
3. Sort results by similarity descending
4. Return top k

Time: O(n × d) where d = 3072
Space: O(n × d) for storage, O(n) for search
```

**Why not HNSW (Hierarchical Navigable Small World)?**

| Algorithm | Pros | Cons for Workers |
|-----------|------|------------------|
| **Brute-Force** | Simple, exact results, O(1) insert | O(n) search |
| **HNSW** | O(log n) search | Complex, needs persistent graph, ~10x memory overhead |
| **IVF** | Faster than brute-force | Needs training, complex clustering |

**Decision:** Brute-force is optimal for Workers because:
1. Most memory keys will have <10K vectors
2. Workers have fast CPUs - 3072-dim dot products are cheap
3. No graph structure to maintain across requests
4. Exact results (HNSW is approximate)

### 1.3 Performance Characteristics

Benchmarks for 3072-dimension vectors on V8 (similar to Workers):

| Vectors | Search Time | Memory |
|---------|-------------|--------|
| 100 | <1ms | 1.2 MB |
| 1,000 | ~3ms | 12 MB |
| 5,000 | ~15ms | 60 MB |
| 10,000 | ~30ms | 120 MB |
| 50,000 | ~150ms | 600 MB (sharding required) |

**Sweet spot: <5,000 vectors per hot index** stays under Workers' CPU limits.

### 1.4 Optimizations for Workers

```typescript
// workers/src/vectors/workers-index.ts

export class WorkersVectorIndex {
  // Use Float32Array for memory efficiency (4 bytes vs 8 for number[])
  private vectors: Float32Array;  // Flat packed: [vec0...vec1...vec2...]
  private ids: Uint32Array;
  private count: number = 0;
  private dims: number;

  constructor(dims: number = 3072, maxVectors: number = 5000) {
    this.dims = dims;
    // Pre-allocate for speed
    this.vectors = new Float32Array(maxVectors * dims);
    this.ids = new Uint32Array(maxVectors);
  }

  /**
   * SIMD-friendly dot product (V8 auto-vectorizes)
   */
  private dotProduct(offset: number, query: Float32Array): number {
    let sum = 0;
    const base = offset * this.dims;
    for (let i = 0; i < this.dims; i++) {
      sum += this.vectors[base + i] * query[i];
    }
    return sum;
  }

  /**
   * Optimized search with pre-sorted results
   */
  search(query: Float32Array, k: number): SearchResult[] {
    const results: Array<{ id: number; score: number }> = [];
    
    for (let i = 0; i < this.count; i++) {
      const score = this.dotProduct(i, query);
      results.push({ id: this.ids[i], score });
    }

    // Partial sort for top-k (faster than full sort)
    return this.topK(results, k);
  }

  private topK(results: Array<{ id: number; score: number }>, k: number) {
    // Use partial sort for efficiency when k << n
    if (results.length <= k) {
      results.sort((a, b) => b.score - a.score);
      return results;
    }

    // Quickselect-based partial sort
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  /**
   * Serialize for KV/R2 storage
   */
  serialize(): ArrayBuffer {
    const headerSize = 12;  // dims (4) + count (4) + reserved (4)
    const idsSize = this.count * 4;
    const vectorsSize = this.count * this.dims * 4;
    
    const buffer = new ArrayBuffer(headerSize + idsSize + vectorsSize);
    const view = new DataView(buffer);
    
    view.setUint32(0, this.dims, true);
    view.setUint32(4, this.count, true);
    
    const idsArray = new Uint32Array(buffer, headerSize, this.count);
    idsArray.set(this.ids.subarray(0, this.count));
    
    const vectorsArray = new Float32Array(buffer, headerSize + idsSize);
    vectorsArray.set(this.vectors.subarray(0, this.count * this.dims));
    
    return buffer;
  }

  /**
   * Deserialize from KV/R2
   */
  static deserialize(buffer: ArrayBuffer): WorkersVectorIndex {
    const view = new DataView(buffer);
    const dims = view.getUint32(0, true);
    const count = view.getUint32(4, true);
    
    const headerSize = 12;
    const idsSize = count * 4;
    
    const index = new WorkersVectorIndex(dims, count);
    index.count = count;
    index.ids.set(new Uint32Array(buffer, headerSize, count));
    index.vectors.set(new Float32Array(buffer, headerSize + idsSize, count * dims));
    
    return index;
  }
}
```

---

## 2. Cloudflare Workers Constraints

### 2.1 Hard Limits

| Resource | Free Plan | Paid Plan | Our Strategy |
|----------|-----------|-----------|--------------|
| **CPU time** | 10ms | 30ms (50ms burst) | Keep indexes <5K vectors |
| **Memory** | 128 MB | 128 MB | Shard large indexes |
| **Request size** | 100 MB | 100 MB | Chunk large uploads |
| **KV value size** | 25 MB | 25 MB | Split indexes if needed |
| **R2 object size** | 5 GB | 5 GB | Use for bulk storage |
| **Subrequest limit** | 50 | 1000 | Batch KV reads |

### 2.2 Working Within Limits

#### CPU Time Strategy

```typescript
// workers/src/memory/search.ts

async function searchWithTimeout(
  index: WorkersVectorIndex,
  query: Float32Array,
  k: number,
  ctx: ExecutionContext
): Promise<SearchResult[]> {
  // For large indexes, use waitUntil to continue after response
  if (index.count > 3000) {
    // Return quick approximate results first
    const quickResults = index.search(query, k);
    
    // Refine in background (optional)
    ctx.waitUntil(refineResultsAsync(query, k));
    
    return quickResults;
  }
  
  return index.search(query, k);
}
```

#### Memory Strategy

```typescript
// workers/src/memory/loader.ts

interface IndexShard {
  id: string;
  vectorCount: number;
  timeRange: { start: number; end: number };
}

/**
 * Load only relevant shards based on KRONOS windows
 */
async function loadRelevantShards(
  memoryKey: string,
  window: 'hot' | 'working' | 'longterm',
  kv: KVNamespace
): Promise<WorkersVectorIndex> {
  const shardManifest = await kv.get(`${memoryKey}:manifest`, 'json') as IndexShard[];
  
  const now = Date.now();
  const cutoffs = {
    hot: now - 4 * 60 * 60 * 1000,
    working: now - 3 * 24 * 60 * 60 * 1000,
    longterm: now - 90 * 24 * 60 * 60 * 1000,
  };
  
  // Filter to relevant shards
  const relevantShards = shardManifest.filter(
    shard => shard.timeRange.end >= cutoffs[window]
  );
  
  // Load and merge (respecting memory limits)
  return mergeShards(relevantShards, kv);
}
```

### 2.3 What We CAN'T Do on Workers

| Feature | Alternative |
|---------|-------------|
| Native FAISS bindings | Pure TypeScript brute-force |
| Long-running processes | Durable Objects for coordination |
| Filesystem storage | KV + R2 |
| SQLite directly | D1 (Cloudflare's edge SQLite) |
| Background jobs | Cron triggers + Durable Objects |

---

## 3. Storage Strategy

### 3.1 Storage Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MEMORYROUTER STORAGE ON WORKERS                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Request                                                                    │
│     │                                                                       │
│     ▼                                                                       │
│  ┌────────────────┐                                                        │
│  │ Workers KV     │  Hot cache, small indexes, metadata                    │
│  │ (edge-cached)  │  • Vector indexes < 25MB                               │
│  │                │  • Embedding cache                                      │
│  │                │  • Memory key metadata                                  │
│  └───────┬────────┘                                                        │
│          │                                                                  │
│          │ Cache miss                                                       │
│          ▼                                                                  │
│  ┌────────────────┐                                                        │
│  │ Cloudflare R2  │  Bulk storage, large indexes                          │
│  │ (S3-compat)    │  • Full vector indexes                                 │
│  │                │  • Historical shards                                    │
│  │                │  • Archived vectors                                     │
│  └───────┬────────┘                                                        │
│          │                                                                  │
│          │ Coordination                                                     │
│          ▼                                                                  │
│  ┌────────────────┐                                                        │
│  │Durable Objects │  State coordination                                    │
│  │ (per memory    │  • Write locking                                       │
│  │  key)          │  • Index rebuild coordination                          │
│  │                │  • Usage metering                                       │
│  └────────────────┘                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 KV Storage Schema

```typescript
// KV Key patterns:

// Manifest: list of shards for a memory key
`${memoryKey}:manifest` → IndexManifest

// Hot shard: most recent vectors (always loaded)
`${memoryKey}:shard:hot` → ArrayBuffer (serialized index)

// Time-based shards
`${memoryKey}:shard:${timestamp}` → ArrayBuffer

// Metadata per vector
`${memoryKey}:meta:${vectorId}` → VectorMetadata

// Embedding cache
`embed:${hash(text)}` → Float32Array (serialized)

// Query result cache
`cache:${memoryKey}:${hash(query)}` → CachedResult
```

### 3.3 R2 Storage Schema

```typescript
// R2 Object patterns:

// Full index (for large memory keys)
`indexes/${memoryKey}/full.bin`

// Archived shards (older than hot window)
`indexes/${memoryKey}/shards/${year}/${month}/${day}.bin`

// Backup/export
`exports/${memoryKey}/${timestamp}.bin`
```

### 3.4 Implementation: Vector Storage

```typescript
// workers/src/storage/vector-store.ts

interface VectorStoreConfig {
  kv: KVNamespace;
  r2: R2Bucket;
}

export class WorkersVectorStore {
  private kv: KVNamespace;
  private r2: R2Bucket;

  constructor(config: VectorStoreConfig) {
    this.kv = config.kv;
    this.r2 = config.r2;
  }

  /**
   * Store a vector with metadata
   */
  async store(
    memoryKey: string,
    vectorId: number,
    vector: Float32Array,
    metadata: VectorMetadata
  ): Promise<void> {
    // Get or create hot shard
    const hotKey = `${memoryKey}:shard:hot`;
    const existing = await this.kv.get(hotKey, 'arrayBuffer');
    
    let index: WorkersVectorIndex;
    if (existing) {
      index = WorkersVectorIndex.deserialize(existing);
    } else {
      index = new WorkersVectorIndex(3072);
    }

    // Add vector
    index.add(vectorId, vector);

    // Check if shard is too large (>20MB or >4000 vectors)
    if (index.count > 4000 || index.byteLength > 20 * 1024 * 1024) {
      await this.rotateHotShard(memoryKey, index);
    } else {
      // Save updated hot shard
      await this.kv.put(hotKey, index.serialize(), {
        metadata: { count: index.count, updated: Date.now() }
      });
    }

    // Store metadata separately (for filtering)
    await this.kv.put(
      `${memoryKey}:meta:${vectorId}`,
      JSON.stringify(metadata)
    );
  }

  /**
   * Rotate hot shard to R2 when it gets too large
   */
  private async rotateHotShard(
    memoryKey: string,
    currentHot: WorkersVectorIndex
  ): Promise<void> {
    const timestamp = Date.now();
    
    // Archive current hot to R2
    await this.r2.put(
      `indexes/${memoryKey}/shards/${timestamp}.bin`,
      currentHot.serialize()
    );

    // Update manifest
    const manifest = await this.getManifest(memoryKey);
    manifest.shards.push({
      id: timestamp.toString(),
      vectorCount: currentHot.count,
      timeRange: { start: manifest.lastRotation, end: timestamp },
      location: 'r2'
    });
    manifest.lastRotation = timestamp;
    
    await this.kv.put(`${memoryKey}:manifest`, JSON.stringify(manifest));

    // Create new empty hot shard
    const newHot = new WorkersVectorIndex(3072);
    await this.kv.put(`${memoryKey}:shard:hot`, newHot.serialize());
  }

  /**
   * Search across relevant shards (KRONOS-aware)
   */
  async search(
    memoryKey: string,
    query: Float32Array,
    options: {
      window: 'hot' | 'working' | 'longterm';
      limit: number;
      minScore?: number;
    }
  ): Promise<SearchResult[]> {
    const cutoff = this.getWindowCutoff(options.window);
    const manifest = await this.getManifest(memoryKey);

    // Always search hot shard
    const hotBuffer = await this.kv.get(`${memoryKey}:shard:hot`, 'arrayBuffer');
    const results: SearchResult[] = [];

    if (hotBuffer) {
      const hotIndex = WorkersVectorIndex.deserialize(hotBuffer);
      const hotResults = hotIndex.search(query, options.limit);
      results.push(...hotResults);
    }

    // Search archived shards if needed
    const relevantShards = manifest.shards.filter(
      s => s.timeRange.end >= cutoff
    );

    for (const shard of relevantShards) {
      const shardBuffer = await this.r2.get(`indexes/${memoryKey}/shards/${shard.id}.bin`);
      if (shardBuffer) {
        const shardIndex = WorkersVectorIndex.deserialize(
          await shardBuffer.arrayBuffer()
        );
        const shardResults = shardIndex.search(query, options.limit);
        results.push(...shardResults);
      }
    }

    // Merge and dedupe
    return this.mergeResults(results, options.limit, options.minScore);
  }

  private getWindowCutoff(window: 'hot' | 'working' | 'longterm'): number {
    const now = Date.now();
    switch (window) {
      case 'hot': return now - 4 * 60 * 60 * 1000;
      case 'working': return now - 3 * 24 * 60 * 60 * 1000;
      case 'longterm': return now - 90 * 24 * 60 * 60 * 1000;
    }
  }
}
```

---

## 4. KRONOS Time Windows on Workers

### 4.1 Time Window Implementation

Instead of separate tables (SQLite approach), we use **time-based shard partitioning**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    KRONOS ON CLOUDFLARE WORKERS                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  🔥 HOT (4h)                                                               │
│  └── Location: KV `${mk}:shard:hot`                                        │
│  └── Always loaded first                                                    │
│  └── Rebuilt every hour (background)                                        │
│                                                                             │
│  🧠 WORKING (3d)                                                            │
│  └── Location: KV `${mk}:shard:working` (cached)                           │
│  └── R2 shards: `indexes/${mk}/shards/{recent}.bin`                        │
│  └── Loaded on demand                                                       │
│                                                                             │
│  📚 LONG-TERM (90d)                                                         │
│  └── Location: R2 only                                                      │
│  └── Sharded by week                                                        │
│  └── Loaded only for long-term queries                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Temporal Filtering

```typescript
// workers/src/kronos/windows.ts

interface KronosConfig {
  windows: {
    hot: { durationMs: number };      // 4 hours
    working: { durationMs: number };  // 3 days
    longterm: { durationMs: number }; // 90 days
  };
  allocation: 'equal' | 'weighted';
}

const DEFAULT_CONFIG: KronosConfig = {
  windows: {
    hot: { durationMs: 4 * 60 * 60 * 1000 },
    working: { durationMs: 3 * 24 * 60 * 60 * 1000 },
    longterm: { durationMs: 90 * 24 * 60 * 60 * 1000 },
  },
  allocation: 'equal',
};

export class KronosWindowManager {
  private store: WorkersVectorStore;
  private config: KronosConfig;

  constructor(store: WorkersVectorStore, config: KronosConfig = DEFAULT_CONFIG) {
    this.store = store;
    this.config = config;
  }

  /**
   * Search across all windows with equal allocation
   */
  async searchAllWindows(
    memoryKey: string,
    query: Float32Array,
    totalLimit: number = 12
  ): Promise<KronosSearchResult> {
    const { hot, working, longterm } = this.allocatePerWindow(totalLimit);

    // Parallel search across windows
    const [hotResults, workingResults, longtermResults] = await Promise.all([
      this.searchWindow(memoryKey, query, 'hot', hot),
      this.searchWindow(memoryKey, query, 'working', working),
      this.searchWindow(memoryKey, query, 'longterm', longterm),
    ]);

    // Merge and dedupe
    return {
      results: this.mergeAndDedupe(
        hotResults,
        workingResults,
        longtermResults,
        totalLimit
      ),
      breakdown: {
        hot: hotResults.length,
        working: workingResults.length,
        longterm: longtermResults.length,
      },
    };
  }

  /**
   * Equal allocation: N/3 per window
   */
  private allocatePerWindow(n: number): { hot: number; working: number; longterm: number } {
    const base = Math.floor(n / 3);
    const remainder = n % 3;
    return {
      hot: base + (remainder > 0 ? 1 : 0),
      working: base + (remainder > 1 ? 1 : 0),
      longterm: base,
    };
  }

  /**
   * Search a specific window
   */
  private async searchWindow(
    memoryKey: string,
    query: Float32Array,
    window: 'hot' | 'working' | 'longterm',
    limit: number
  ): Promise<WindowSearchResult[]> {
    const results = await this.store.search(memoryKey, query, {
      window,
      limit: limit * 2, // Fetch extra for filtering
    });

    // Attach window tag and filter by time
    const cutoff = Date.now() - this.config.windows[window].durationMs;
    
    return results
      .filter(r => r.timestamp >= cutoff)
      .slice(0, limit)
      .map(r => ({ ...r, window }));
  }
}
```

### 4.3 Metadata Storage for Time Filtering

```typescript
// workers/src/storage/metadata.ts

interface VectorMetadata {
  id: number;
  memoryKey: string;
  role: 'user' | 'assistant';
  content: string;
  contentHash: string;
  timestamp: number;       // For KRONOS window filtering
  model?: string;
  requestId?: string;
}

/**
 * Store metadata separately for efficient filtering
 */
export class MetadataStore {
  private kv: KVNamespace;

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  async store(meta: VectorMetadata): Promise<void> {
    // Individual metadata lookup
    await this.kv.put(
      `${meta.memoryKey}:meta:${meta.id}`,
      JSON.stringify(meta),
      { expirationTtl: 90 * 24 * 60 * 60 } // 90-day retention
    );

    // Time index for window queries (list of IDs per hour)
    const hourBucket = Math.floor(meta.timestamp / (60 * 60 * 1000));
    const hourKey = `${meta.memoryKey}:time:${hourBucket}`;
    
    const existing = await this.kv.get(hourKey, 'json') as number[] | null;
    const ids = existing || [];
    ids.push(meta.id);
    
    await this.kv.put(hourKey, JSON.stringify(ids), {
      expirationTtl: 90 * 24 * 60 * 60
    });
  }

  async getByTimeRange(
    memoryKey: string,
    startTime: number,
    endTime: number
  ): Promise<VectorMetadata[]> {
    const startBucket = Math.floor(startTime / (60 * 60 * 1000));
    const endBucket = Math.floor(endTime / (60 * 60 * 1000));

    const ids: number[] = [];
    for (let bucket = startBucket; bucket <= endBucket; bucket++) {
      const bucketIds = await this.kv.get(
        `${memoryKey}:time:${bucket}`,
        'json'
      ) as number[] | null;
      if (bucketIds) {
        ids.push(...bucketIds);
      }
    }

    // Batch fetch metadata
    const metas: VectorMetadata[] = [];
    for (const id of ids) {
      const meta = await this.kv.get(
        `${memoryKey}:meta:${id}`,
        'json'
      ) as VectorMetadata | null;
      if (meta) metas.push(meta);
    }

    return metas;
  }
}
```

---

## 5. Caching Strategy

### 5.1 Multi-Layer Cache

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CACHING LAYERS                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Layer 1: KV Edge Cache (automatic)                                        │
│  └── All KV reads are edge-cached by Cloudflare                            │
│  └── TTL: configurable per key                                             │
│                                                                             │
│  Layer 2: Embedding Cache                                                   │
│  └── Key: `embed:${sha256(text)}`                                          │
│  └── Value: Float32Array (3072 × 4 = 12KB per embedding)                   │
│  └── TTL: 7 days (embeddings are deterministic)                            │
│                                                                             │
│  Layer 3: Query Result Cache                                                │
│  └── Key: `cache:${memoryKey}:${sha256(query)}`                            │
│  └── Value: serialized results                                              │
│  └── TTL: 5 minutes (fresh results for active queries)                     │
│                                                                             │
│  Layer 4: Hot Index Cache (in-Worker memory)                                │
│  └── LRU cache of recently-accessed indexes                                 │
│  └── Cleared between requests (Workers are stateless)                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Embedding Cache

```typescript
// workers/src/cache/embeddings.ts

export class EmbeddingCache {
  private kv: KVNamespace;
  private pendingRequests: Map<string, Promise<Float32Array>> = new Map();

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  /**
   * Get or generate embedding with caching + deduplication
   */
  async getOrEmbed(
    text: string,
    embedFn: (text: string) => Promise<Float32Array>
  ): Promise<Float32Array> {
    const hash = await this.hashText(text);
    const cacheKey = `embed:${hash}`;

    // Check cache first
    const cached = await this.kv.get(cacheKey, 'arrayBuffer');
    if (cached) {
      return new Float32Array(cached);
    }

    // Check if already in-flight (deduplication)
    const pending = this.pendingRequests.get(hash);
    if (pending) {
      return pending;
    }

    // Generate embedding
    const promise = embedFn(text).then(async (embedding) => {
      // Cache result
      await this.kv.put(cacheKey, embedding.buffer, {
        expirationTtl: 7 * 24 * 60 * 60, // 7 days
      });
      this.pendingRequests.delete(hash);
      return embedding;
    });

    this.pendingRequests.set(hash, promise);
    return promise;
  }

  private async hashText(text: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
```

### 5.3 Query Result Cache

```typescript
// workers/src/cache/queries.ts

interface CachedQueryResult {
  results: SearchResult[];
  timestamp: number;
  queryHash: string;
}

export class QueryCache {
  private kv: KVNamespace;
  private ttlSeconds: number;

  constructor(kv: KVNamespace, ttlSeconds: number = 300) {
    this.kv = kv;
    this.ttlSeconds = ttlSeconds;
  }

  async get(
    memoryKey: string,
    queryHash: string
  ): Promise<SearchResult[] | null> {
    const cacheKey = `cache:${memoryKey}:${queryHash}`;
    const cached = await this.kv.get(cacheKey, 'json') as CachedQueryResult | null;
    
    if (!cached) return null;
    
    // Check if still fresh
    const age = (Date.now() - cached.timestamp) / 1000;
    if (age > this.ttlSeconds) {
      return null;
    }

    return cached.results;
  }

  async set(
    memoryKey: string,
    queryHash: string,
    results: SearchResult[]
  ): Promise<void> {
    const cacheKey = `cache:${memoryKey}:${queryHash}`;
    await this.kv.put(cacheKey, JSON.stringify({
      results,
      timestamp: Date.now(),
      queryHash,
    }), {
      expirationTtl: this.ttlSeconds * 2, // KV TTL slightly longer
    });
  }
}
```

### 5.4 Cache Invalidation

```typescript
// workers/src/cache/invalidation.ts

export class CacheInvalidator {
  private kv: KVNamespace;

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  /**
   * Invalidate query cache when new vectors are added
   * Strategy: version-based invalidation
   */
  async onVectorsAdded(memoryKey: string): Promise<void> {
    // Bump version to invalidate all query caches
    const versionKey = `${memoryKey}:version`;
    const currentVersion = await this.kv.get(versionKey) || '0';
    await this.kv.put(versionKey, String(parseInt(currentVersion) + 1));
    
    // Old cached queries will have wrong version and be ignored
  }

  /**
   * Check if cache is still valid
   */
  async isValid(memoryKey: string, cachedVersion: string): Promise<boolean> {
    const currentVersion = await this.kv.get(`${memoryKey}:version`);
    return currentVersion === cachedVersion;
  }
}
```

---

## 6. The Full Request Flow

### 6.1 Complete Request Processing

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MEMORYROUTER REQUEST FLOW (WORKERS)                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. REQUEST ARRIVES AT WORKER                                               │
│     POST /v1/chat/completions                                              │
│     Authorization: Bearer mk_xxxxxxxx                                       │
│     { model: "anthropic/claude-3-opus", messages: [...] }                  │
│                                                                             │
│  2. AUTHENTICATE                                                            │
│     └── Validate memory key (KV lookup: `mk:${key}:auth`)                  │
│     └── Check billing status                                                │
│     └── Rate limit check                                                    │
│                                                                             │
│  3. PARSE REQUEST                                                           │
│     └── Extract model + provider                                            │
│     └── Parse memory headers (X-Memory-Mode, etc.)                         │
│     └── Get user's provider API key                                         │
│                                                                             │
│  4. EMBED QUERY                                                             │
│     └── Extract query from last user message                                │
│     └── Check embedding cache                                               │
│     └── Generate embedding (OpenAI text-embedding-3-large)                 │
│                                                                             │
│  5. RETRIEVE MEMORY (KRONOS)                                                │
│     ┌─────────────────────────────────────────────────────────────────┐    │
│     │  a. Load hot shard from KV                                       │    │
│     │  b. Search hot shard (4h window)                                │    │
│     │  c. Load working shards from KV/R2 (3d window)                   │    │
│     │  d. Load longterm shards from R2 (90d window)                    │    │
│     │  e. Equal allocation: N/3 per window                             │    │
│     │  f. Merge, dedupe, rank results                                  │    │
│     └─────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  6. FORMAT CONTEXT                                                          │
│     └── Get formatter for model (Claude XML, GPT markdown, etc.)           │
│     └── Build context string                                                │
│     └── Inject into system message                                          │
│                                                                             │
│  7. FORWARD TO PROVIDER                                                     │
│     ┌─────────────────────────────────────────────────────────────────┐    │
│     │  • Route based on model prefix (anthropic/, openai/, etc.)      │    │
│     │  • Use user's stored API key                                     │    │
│     │  • Stream response back to client                                │    │
│     │  • Capture full response in background                           │    │
│     └─────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  8. STORE IN MEMORY (waitUntil)                                             │
│     └── Filter messages (skip memory: false)                               │
│     └── Generate embeddings for new content                                 │
│     └── Store vectors in hot shard                                          │
│     └── Store metadata (role, timestamp, model)                             │
│     └── Invalidate query cache                                              │
│                                                                             │
│  9. METER USAGE (waitUntil)                                                 │
│     └── Count memory tokens (stored + retrieved)                           │
│     └── Update Durable Object counter                                       │
│     └── Queue billing event                                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Implementation: Main Handler

```typescript
// workers/src/index.ts

import { Hono } from 'hono';
import { cors } from 'hono/cors';

interface Env {
  MEMORY_KV: KVNamespace;
  VECTORS_R2: R2Bucket;
  MEMORY_DO: DurableObjectNamespace;
  OPENAI_EMBEDDINGS_KEY: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

app.post('/v1/chat/completions', async (c) => {
  const startTime = Date.now();
  const env = c.env;
  const ctx = c.executionCtx;

  try {
    // 1. Authenticate
    const memoryKey = extractMemoryKey(c.req.header('Authorization'));
    const auth = await authenticateMemoryKey(memoryKey, env.MEMORY_KV);
    if (!auth.valid) {
      return c.json({ error: 'Invalid memory key' }, 401);
    }

    // 2. Parse request
    const body = await c.req.json() as ChatCompletionRequest;
    const { model, messages } = body;
    const memoryHeaders = parseMemoryHeaders(c.req);

    // 3. Embed query
    const query = extractQuery(messages);
    const embeddingCache = new EmbeddingCache(env.MEMORY_KV);
    const queryEmbedding = await embeddingCache.getOrEmbed(
      query,
      (text) => generateEmbedding(text, env.OPENAI_EMBEDDINGS_KEY)
    );

    // 4. Retrieve memory (KRONOS)
    let context = '';
    let retrievedTokens = 0;

    if (memoryHeaders.mode !== 'off' && memoryHeaders.mode !== 'write') {
      const store = new WorkersVectorStore({
        kv: env.MEMORY_KV,
        r2: env.VECTORS_R2,
      });
      const kronos = new KronosWindowManager(store);
      
      const { results, breakdown } = await kronos.searchAllWindows(
        memoryKey,
        queryEmbedding,
        memoryHeaders.contextLimit || 12
      );

      // Format for model
      context = formatMemoryContext(model, results);
      retrievedTokens = estimateTokens(context);
    }

    // 5. Augment request with memory context
    const augmentedMessages = injectContext(messages, context, model);

    // 6. Forward to provider
    const provider = getProvider(model);
    const providerKey = await getProviderKey(auth.userId, provider, env.MEMORY_KV);
    
    const response = await forwardToProvider(provider, {
      model,
      messages: augmentedMessages,
      stream: true,
    }, providerKey);

    // 7. Store in memory (background)
    if (memoryHeaders.mode !== 'off' && memoryHeaders.mode !== 'read') {
      ctx.waitUntil(
        storeMemory(memoryKey, messages, response, {
          kv: env.MEMORY_KV,
          r2: env.VECTORS_R2,
          embeddingKey: env.OPENAI_EMBEDDINGS_KEY,
          storeInput: memoryHeaders.storeInput,
          storeResponse: memoryHeaders.storeResponse,
        })
      );
    }

    // 8. Meter usage (background)
    ctx.waitUntil(
      meterUsage(memoryKey, {
        retrievedTokens,
        storedTokens: 0, // Updated in storeMemory
        model,
        latencyMs: Date.now() - startTime,
      }, env.MEMORY_DO)
    );

    return response;

  } catch (error) {
    console.error('Request failed:', error);
    return c.json({ error: 'Internal error' }, 500);
  }
});

export default app;
```

### 6.3 Background Storage with waitUntil

```typescript
// workers/src/memory/store.ts

interface StoreOptions {
  kv: KVNamespace;
  r2: R2Bucket;
  embeddingKey: string;
  storeInput: boolean;
  storeResponse: boolean;
}

export async function storeMemory(
  memoryKey: string,
  messages: ChatMessage[],
  response: Response,
  options: StoreOptions
): Promise<void> {
  const store = new WorkersVectorStore({ kv: options.kv, r2: options.r2 });
  const cache = new EmbeddingCache(options.kv);
  const now = Date.now();

  // Collect texts to store
  const toStore: Array<{ role: string; content: string }> = [];

  if (options.storeInput) {
    for (const msg of messages) {
      if (msg.role === 'system') continue;
      if (msg.memory === false) continue;
      toStore.push({ role: msg.role, content: msg.content });
    }
  }

  if (options.storeResponse) {
    // Capture streamed response
    const fullResponse = await captureStreamedResponse(response);
    toStore.push({ role: 'assistant', content: fullResponse });
  }

  // Generate embeddings and store
  for (const item of toStore) {
    const embedding = await cache.getOrEmbed(
      item.content,
      (text) => generateEmbedding(text, options.embeddingKey)
    );

    const vectorId = await getNextVectorId(memoryKey, options.kv);
    
    await store.store(memoryKey, vectorId, embedding, {
      id: vectorId,
      memoryKey,
      role: item.role as 'user' | 'assistant',
      content: item.content,
      contentHash: await hashContent(item.content),
      timestamp: now,
    });
  }

  // Invalidate query cache
  await new CacheInvalidator(options.kv).onVectorsAdded(memoryKey);
}
```

---

## 7. Scaling Considerations

### 7.1 Multi-Tenant Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MULTI-TENANT SCALING                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Isolation Strategy: Complete namespace isolation per memory key            │
│                                                                             │
│  Memory Key: mk_abc123                                                      │
│  └── KV Keys: mk_abc123:*                                                  │
│  └── R2 Path: indexes/mk_abc123/*                                          │
│  └── Durable Object: MemoryDO:mk_abc123                                    │
│                                                                             │
│  No shared state between memory keys = perfect isolation                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Vector Index Size Limits

| Scenario | Vectors | Memory | Strategy |
|----------|---------|--------|----------|
| **Small** | <1,000 | <12 MB | Single hot shard |
| **Medium** | 1,000-5,000 | 12-60 MB | Single shard, fast search |
| **Large** | 5,000-20,000 | 60-240 MB | Multiple time-based shards |
| **Very Large** | >20,000 | >240 MB | Aggressive sharding + R2 |

### 7.3 Sharding Strategy

```typescript
// workers/src/sharding/strategy.ts

interface ShardingConfig {
  maxVectorsPerShard: number;    // 4000 (safe for 128MB limit)
  maxBytesPerShard: number;      // 20MB (under 25MB KV limit)
  rotationTrigger: 'count' | 'size' | 'time';
  timeRotationMs: number;        // 6 hours for hot
}

const DEFAULT_SHARDING: ShardingConfig = {
  maxVectorsPerShard: 4000,
  maxBytesPerShard: 20 * 1024 * 1024,
  rotationTrigger: 'count',
  timeRotationMs: 6 * 60 * 60 * 1000,
};

/**
 * Determine if shard needs rotation
 */
function shouldRotate(
  shard: { count: number; bytes: number; createdAt: number },
  config: ShardingConfig = DEFAULT_SHARDING
): boolean {
  if (shard.count >= config.maxVectorsPerShard) return true;
  if (shard.bytes >= config.maxBytesPerShard) return true;
  if (Date.now() - shard.createdAt >= config.timeRotationMs) return true;
  return false;
}
```

### 7.4 Handling Very Large Memory Keys

For memory keys with >50K vectors (rare but possible):

```typescript
// workers/src/search/large-index.ts

/**
 * Two-phase search for very large indexes
 * 1. Quick search on recent/hot shards
 * 2. Background refinement on full index
 */
async function searchLargeIndex(
  memoryKey: string,
  query: Float32Array,
  limit: number,
  ctx: ExecutionContext,
  env: Env
): Promise<SearchResult[]> {
  const manifest = await getManifest(memoryKey, env.MEMORY_KV);
  
  if (manifest.totalVectors < 10000) {
    // Normal search
    return normalSearch(memoryKey, query, limit, env);
  }

  // Phase 1: Quick search on most recent shards
  const recentShards = manifest.shards.slice(-5);
  const quickResults = await searchShards(recentShards, query, limit, env);

  // Phase 2: Full search in background (optional refinement)
  ctx.waitUntil(
    fullSearchAndCache(memoryKey, query, limit, env)
  );

  return quickResults;
}
```

### 7.5 Geographic Distribution

```typescript
// wrangler.toml

[durable_objects]
bindings = [
  { name = "MEMORY_DO", class_name = "MemoryDurableObject" }
]

[[kv_namespaces]]
binding = "MEMORY_KV"
id = "..."

# KV is automatically edge-cached globally
# R2 is in a single region but cached at edge
# Durable Objects are in a single region (optimize for write locality)
```

---

## 8. Implementation Phases

### Phase 1: Core Vector Engine (Week 1)

- [ ] Port `MemoryVectorIndex` to Workers-compatible format
- [ ] Implement binary serialization/deserialization
- [ ] Add KV storage adapter
- [ ] Basic search functionality
- [ ] Unit tests for vector operations

### Phase 2: KRONOS Integration (Week 2)

- [ ] Temporal window filtering
- [ ] Equal allocation algorithm
- [ ] Shard manifest management
- [ ] Hot shard rotation
- [ ] R2 archival for old shards

### Phase 3: Caching Layer (Week 2-3)

- [ ] Embedding cache
- [ ] Query result cache
- [ ] Cache invalidation on writes
- [ ] Version-based cache busting

### Phase 4: Request Pipeline (Week 3)

- [ ] Memory key authentication
- [ ] Provider routing
- [ ] Context injection
- [ ] Response streaming
- [ ] Background storage (waitUntil)

### Phase 5: Production Hardening (Week 4)

- [ ] Error handling and retries
- [ ] Rate limiting
- [ ] Usage metering (Durable Objects)
- [ ] Monitoring and logging
- [ ] Load testing

---

## 9. Appendix: Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Vector Search** | Brute-force kNN | Simple, exact, fast for <5K vectors |
| **Storage** | KV + R2 | KV for hot data, R2 for bulk |
| **Sharding** | Time-based | Aligns with KRONOS windows |
| **Caching** | Multi-layer | Embeddings, queries, indexes |
| **Coordination** | Durable Objects | Write coordination, metering |
| **Serialization** | Binary (ArrayBuffer) | Compact, fast parse |

---

## 10. Performance Targets

| Metric | Target | Strategy |
|--------|--------|----------|
| Search latency (p99) | <50ms | KV cache, brute-force kNN |
| Store latency (p99) | <100ms | waitUntil background |
| Cold start | <50ms | Minimal dependencies |
| Memory per request | <64 MB | Lazy shard loading |
| Embedding cache hit | >80% | 7-day TTL, deduplication |

---

*MemoryRouter on Cloudflare Workers: Fast, global, FAISS-free. 🚀*
