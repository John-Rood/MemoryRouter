# MemoryRouter D1 Intermediate State

**Version:** 1.0  
**Created:** 2026-02-01  
**Status:** Draft  

---

## Problem Statement

Current cold start latency is 2000-3000ms when a Durable Object wakes from hibernation. This happens because:

1. DO hibernates after ~30s of inactivity
2. On wake, SQLite data must be loaded into in-memory vector index
3. Loading 1000+ vectors with embeddings takes 2-3 seconds

Users experience this delay on their first request after idle periods.

---

## Proposed Solution

Add D1 as an **intermediate persistence layer** that enables:

1. **Fast fallback reads** — Query D1 directly when DO is cold (~10-50ms vs 2500ms)
2. **Background warming** — Start DO warm-up while returning D1 results
3. **Global consistency** — D1 is the source of truth, DOs are hot caches
4. **Admin capabilities** — Query vectors without waking DOs

---

## Architecture

### Current (DO-only)

```
Request → Worker → DO (wake 2500ms) → SQLite → Memory Index → Response
```

### Proposed (D1 + DO)

```
Request → Worker → Is DO warm?
                      ├── YES → DO Memory Index (2ms) → Response
                      └── NO  → D1 Query (30ms) → Response
                                  └── Background: Wake DO for next request
```

---

## D1 Schema

```sql
-- Memory chunks (main table)
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_key TEXT NOT NULL,           -- User's memory key (mk_xxx hash)
  vault_type TEXT NOT NULL,           -- 'core' | 'session'
  session_id TEXT,                    -- For session vaults
  content TEXT NOT NULL,
  role TEXT NOT NULL,                 -- 'user' | 'assistant' | 'system'
  embedding BLOB NOT NULL,            -- Float32Array as bytes (4KB for 1024 dims)
  timestamp REAL NOT NULL,
  token_count INTEGER DEFAULT 0,
  model TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes for fast queries
  INDEX idx_memory_key (memory_key),
  INDEX idx_memory_key_vault (memory_key, vault_type),
  INDEX idx_timestamp (memory_key, timestamp DESC)
);

-- Pending buffer (not yet chunked content)
CREATE TABLE pending_buffers (
  memory_key TEXT NOT NULL,
  vault_type TEXT NOT NULL,
  session_id TEXT,
  content TEXT NOT NULL,
  token_count INTEGER DEFAULT 0,
  last_updated REAL NOT NULL,
  PRIMARY KEY (memory_key, vault_type, session_id)
);

-- DO warm status (optional, for smart routing)
CREATE TABLE do_status (
  do_id TEXT PRIMARY KEY,             -- memory_key:vault_type:session_id
  last_active REAL NOT NULL,
  vector_count INTEGER DEFAULT 0,
  is_warm BOOLEAN DEFAULT FALSE
);
```

---

## Write Path

### Current
```
Store Request → DO → SQLite → Memory Index
```

### Proposed
```
Store Request → Worker
                  ├── D1 INSERT (async, don't wait)
                  └── DO → SQLite → Memory Index (existing path)
```

**Key principle:** D1 write is fire-and-forget. DO remains authoritative for immediate searchability. D1 catches up asynchronously.

```typescript
// In chat.ts store path
async function storeChunk(chunk: Chunk, env: Env) {
  // 1. Store in DO (blocking - for immediate searchability)
  await doStub.fetch('/store', { body: chunk });
  
  // 2. Mirror to D1 (non-blocking - for persistence)
  env.ctx.waitUntil(
    env.D1.prepare(`
      INSERT INTO chunks (memory_key, vault_type, content, role, embedding, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(chunk.memoryKey, chunk.vaultType, chunk.content, chunk.role, 
            new Uint8Array(chunk.embedding.buffer), chunk.timestamp)
      .run()
  );
}
```

---

## Read Path (The Magic)

### Smart Routing Logic

```typescript
async function searchMemory(query: Float32Array, memoryKey: string, env: Env) {
  const doId = `${memoryKey}:core`;
  
  // Check if DO was recently active (optional optimization)
  const isLikelyWarm = await checkDoWarmth(doId, env);
  
  if (isLikelyWarm) {
    // Fast path: DO is warm, use sub-ms search
    return await searchDO(query, memoryKey, env);
  }
  
  // Cold path: Query D1 while warming DO in background
  const [d1Results] = await Promise.all([
    searchD1(query, memoryKey, env),           // Returns in ~30ms
    warmDOInBackground(memoryKey, env),         // Fire and forget
  ]);
  
  return d1Results;
}
```

### D1 Vector Search

D1 doesn't have native vector search, so we do **brute-force cosine similarity** in SQL:

```typescript
async function searchD1(query: Float32Array, memoryKey: string, env: Env, limit = 30) {
  // Get all vectors for this memory key (with timestamp filtering for KRONOS)
  const now = Date.now();
  const hotCutoff = now - (4 * 60 * 60 * 1000);      // 4 hours
  const workingCutoff = now - (3 * 24 * 60 * 60 * 1000); // 3 days
  const longtermCutoff = now - (90 * 24 * 60 * 60 * 1000); // 90 days
  
  const rows = await env.D1.prepare(`
    SELECT id, content, role, embedding, timestamp,
           CASE 
             WHEN timestamp > ? THEN 'hot'
             WHEN timestamp > ? THEN 'working'
             ELSE 'longterm'
           END as window
    FROM chunks
    WHERE memory_key = ? AND timestamp > ?
    ORDER BY timestamp DESC
    LIMIT 1000
  `).bind(hotCutoff, workingCutoff, memoryKey, longtermCutoff).all();
  
  // Compute cosine similarity in JS
  const results = rows.results.map(row => {
    const embedding = new Float32Array(row.embedding);
    const score = cosineSimilarity(query, embedding);
    return { ...row, score };
  });
  
  // Sort by score, take top N
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
```

**Performance note:** For 1000 vectors × 1024 dims, this is ~4M float operations. Modern JS can do this in ~10-20ms. Combined with D1 query time (~10-30ms), total is ~30-50ms.

---

## DO Warmth Tracking

To avoid unnecessary D1 queries when DO is already warm:

```typescript
// Option 1: Durable Object Alarm (built-in)
// DO sets an alarm for 30s. If alarm fires, mark as cold.

// Option 2: D1 status table
async function checkDoWarmth(doId: string, env: Env): Promise<boolean> {
  const row = await env.D1.prepare(`
    SELECT is_warm, last_active FROM do_status WHERE do_id = ?
  `).bind(doId).first();
  
  if (!row) return false;
  
  // Consider warm if active in last 25 seconds (buffer before hibernation)
  const warmThreshold = Date.now() - 25000;
  return row.is_warm && row.last_active > warmThreshold;
}

// Called by DO on every request
async function markDoActive(doId: string, env: Env) {
  await env.D1.prepare(`
    INSERT OR REPLACE INTO do_status (do_id, last_active, is_warm)
    VALUES (?, ?, TRUE)
  `).bind(doId, Date.now()).run();
}
```

---

## Migration Strategy

### Phase 1: Add D1 Write Mirror (No risk)
- Add D1 binding
- Mirror all writes to D1 (fire-and-forget)
- DO remains authoritative
- D1 builds up data over time

### Phase 2: Add D1 Read Fallback
- Implement `searchD1()` function
- Add warmth checking
- Route cold requests to D1
- Measure latency improvements

### Phase 3: Optimize
- Tune warmth thresholds
- Add D1 read replicas for global performance
- Consider pre-computing frequently accessed queries

---

## Latency Comparison

| Scenario | Current | With D1 |
|----------|---------|---------|
| DO warm | 2ms | 2ms |
| DO cold (first request) | 2500ms | **50ms** |
| DO cold (subsequent) | 2500ms | 2ms (warmed) |
| Sustained idle, then burst | 2500ms per user | 50ms first, 2ms rest |

---

## Cost Considerations

**D1 Pricing (as of 2026):**
- Reads: $0.001 per million
- Writes: $1.00 per million
- Storage: $0.75/GB/month

**Estimated costs for 10K active users:**
- ~100K writes/day = $3/month
- ~500K reads/day = $0.50/month
- ~10GB storage = $7.50/month
- **Total: ~$11/month**

Negligible compared to cold start UX improvement.

---

## Edge Cases

### 1. D1 and DO out of sync
- DO is authoritative for recent writes
- D1 catches up asynchronously
- Search prefers DO when warm

### 2. D1 query returns stale data
- Acceptable for cold start scenario
- Next request hits warm DO with fresh data

### 3. Very large vaults (>10K vectors)
- D1 brute-force becomes slow
- Solution: Add approximate search or pagination
- Or: Always warm DO for large vaults

### 4. D1 is down
- Fall back to waiting for DO cold start
- Log error, alert

---

## Implementation Checklist

- [ ] Add D1 binding to wrangler.toml
- [ ] Create D1 database and tables
- [ ] Add write mirroring in store path
- [ ] Implement `searchD1()` function
- [ ] Add warmth tracking
- [ ] Implement smart routing
- [ ] Add metrics/logging
- [ ] Test latency improvements
- [ ] Monitor D1 costs

---

## Timeline Estimate

| Task | Hours |
|------|-------|
| D1 setup + schema | 0.5 |
| Write mirroring | 1 |
| D1 search function | 1.5 |
| Warmth tracking | 1 |
| Smart routing | 1 |
| Testing + tuning | 2 |
| **Total** | **7 hours** |

---

## Decision Points

1. **Warmth tracking method:** D1 table vs DO alarms?
2. **D1 search limit:** 1000 vectors max per query?
3. **Async write strategy:** `waitUntil` or queue?
4. **Rollout:** Feature flag or full deploy?

---

*MemoryRouter D1 Intermediate State Spec v1.0 — Cold starts are dead. ⚡*
