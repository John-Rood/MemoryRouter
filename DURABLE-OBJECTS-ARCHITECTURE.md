# MemoryRouter: Durable Objects Architecture

**The edge-native AI memory platform. No Python. No Cloud Run. No external databases. Just Workers + Durable Objects + R2.**

---

## The Core Insight

VectorVault TypeScript uses native Float32Array vectors with brute-force kNN search. No FAISS. No Annoy. No native bindings. No index rebuild step.

**You add a vector → it's immediately searchable.** That's the edge advantage.

Durable Objects let us keep those vectors **alive in memory between requests**. First request loads them. Every request after that? Sub-millisecond search. No reload. No cold start.

---

## Architecture

```
Customer Request
       ↓
┌─────────────────────────────────────────────┐
│          Cloudflare Worker (Edge)            │
│                                             │
│  1. Authenticate (mk_xxx memory key)        │
│  2. Parse model + provider                  │
│  3. KRONOS decides which vaults to query    │
│  4. Fan out to Durable Objects (parallel)   │
│  5. Merge results                           │
│  6. Format context for target model         │
│  7. Forward to AI provider (user's API key) │
│  8. Stream response back                    │
│  9. Store new memories in vault DO          │
│  10. Meter usage (memory tokens)            │
│                                             │
└──────────────┬──────────────────────────────┘
               │
               │ parallel queries
               ▼
┌──────────────────────────────────────────────┐
│         Durable Objects (Per Vault)           │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  core-{memory_key}                     │  │
│  │  ├── Float32Arrays in memory (HOT)     │  │
│  │  ├── SQLite persistence (WARM)         │  │
│  │  └── Base knowledge, always loaded     │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  session-{memory_key}-{session_id}     │  │
│  │  ├── Float32Arrays in memory (HOT)     │  │
│  │  ├── SQLite persistence (WARM)         │  │
│  │  └── Per-user/conversation context     │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  ephemeral-{memory_key}-{conv_id}      │  │
│  │  ├── Float32Arrays in memory (HOT)     │  │
│  │  ├── Short-lived, auto-expires         │  │
│  │  └── Single conversation context       │  │
│  └────────────────────────────────────────┘  │
│                                              │
└──────────────────────────────────────────────┘
               │
               │ cold backup (async)
               ▼
┌──────────────────────────────────────────────┐
│              R2 (Cold Storage)                │
│  └── Vault snapshots as JSONL (backup/export)│
└──────────────────────────────────────────────┘
```

---

## Storage Tiers

| Tier | Where | Latency | When |
|------|-------|---------|------|
| **HOT** | DO memory — Float32Arrays loaded | **< 1ms** | Vault is active (DO alive) |
| **WARM** | DO SQLite — built-in persistent storage | **10-50ms** | First request wakes DO, loads vectors |
| **COLD** | R2 — JSONL vault snapshots | **50-200ms** | Backup, export, disaster recovery |

The magic: **Durable Objects stay alive between requests.** Once a vault's vectors are loaded into memory, they stay there. Cloudflare manages hibernation automatically — when a DO goes idle, it hibernates. When the next request comes, it wakes up and reloads from SQLite.

---

## Why Durable Objects (Not KV + R2)

| | KV + R2 (current) | Durable Objects |
|---|---|---|
| **Vector search** | Load from KV every request | Already in memory |
| **First request** | ~60ms (KV fetch) | ~10-50ms (SQLite load) |
| **Repeat requests** | ~60ms (KV fetch again) | **< 1ms** (already loaded) |
| **Write** | Serialize → KV put (~60ms) | In-memory + SQLite write |
| **Consistency** | Eventually consistent | **Strongly consistent** |
| **Isolation** | Shared KV namespace | Per-vault instance |
| **Coordination** | None (race conditions) | Single-threaded per DO |

The killer advantage: **KV re-fetches every request. DOs stay hot.** For a product where users send multiple requests per session, the DO stays alive and every search is sub-millisecond.

---

## KRONOS on Durable Objects

KRONOS retrieves memory across temporal windows:

| Window | Duration | Purpose |
|--------|----------|---------|
| **HOT** | 4 hours | What we just talked about |
| **WORKING** | 3 days | Recent conversation history |
| **LONG-TERM** | 90 days | Full knowledge base |

Each vault DO stores timestamps with every vector. KRONOS filtering happens **inside the DO** — the Worker tells the DO "give me top-4 results from the last 4 hours" and the DO's `searchFast()` method handles timestamp filtering on the already-loaded Float32Arrays.

```
Worker: "Search core vault, HOT window (last 4hrs), top 4"
   → core DO: searches in-memory vectors with timestamp filter → returns 4 results

Worker: "Search core vault, WORKING window (last 3 days), top 4"
   → core DO: searches with different timestamp filter → returns 4 results

Worker: "Search session vault, all windows, top 4"
   → session DO: searches in-memory vectors → returns 4 results

Worker: merges all results → formats for model → forwards to provider
```

---

## What We Already Have

| Component | Status | Notes |
|-----------|--------|-------|
| `WorkersVectorIndex` | ✅ Done | Pure TS, Float32Array, serialize/deserialize, searchFast, KRONOS time filtering |
| `StorageManager` | 🔄 Refactor | Currently KV+R2, needs to become DO-aware |
| Worker routes | ✅ Done | Hono app, /v1/chat/completions, /v1/messages |
| Auth middleware | ✅ Done | mk_xxx validation |
| Memory middleware | ✅ Done | Memory injection/storage |
| Provider routing | ✅ Done | OpenAI, Anthropic forwarding |
| Model formatters | ✅ Done | Per-model context formatting |
| KRONOS | ✅ Done | 4-window temporal retrieval |
| Billing | ✅ Done | Stripe integration, memory token metering |

**What needs to be built:**
- `VaultDurableObject` class (wraps WorkersVectorIndex with SQLite persistence)
- DO routing logic (Worker → correct DO based on memory key + vault type)
- DO ↔ Worker communication protocol
- Migration from KV+R2 to DO storage
- Wrangler config updates for DO bindings

---

## The Stack

```
Language:       TypeScript (100%)
Runtime:        Cloudflare Workers
Persistence:    Durable Objects (SQLite)
Cold Storage:   R2 (JSONL snapshots)
Vectors:        VectorVault TS (Float32Array, brute-force kNN)
Auth:           JWT + memory keys (mk_xxx)
Billing:        Stripe (memory token metering)
AI Providers:   OpenAI, Anthropic, Google, OpenRouter (BYOK)
Framework:      Hono
```

No Python. No Redis. No GCS. No Cloud Run. No native bindings. No external vector database.

**One codebase. One language. Edge-native. Sub-millisecond memory.**

---

## The Business Model

MemoryRouter charges for **memory tokens** — not inference.

Users bring their own API keys (BYOK). They pay OpenAI/Anthropic directly for inference. They pay us for memory: storing, retrieving, and managing context across models.

**$1.00 per 1M memory tokens.** That's it.

The same memory works with **any model**. Start with Claude, switch to GPT, iterate with Haiku — all share the same context. Nobody else does this.

---

*MemoryRouter: Same memory, any model. Built at the edge. ⚡🧠*
