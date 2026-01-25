# MemoryRouter Architecture Specification

**Version:** 2.0  
**Created:** 2026-01-25  
**Updated:** 2026-01-25  
**Status:** Final Draft  

---

## 1. Overview

MemoryRouter is an API proxy that wraps AI provider APIs (OpenAI, Anthropic, OpenRouter) and adds persistent, model-agnostic memory to every request/response cycle.

### Core Principles

> **"Every $1 spent on memory saves $2-3 on inference."**

> **"Same memory, any model."**

> **"You control what gets remembered."**

### What Makes MemoryRouter Unique

| Feature | MemoryRouter | Everyone Else |
|---------|--------------|---------------|
| Persistent memory across sessions | ✅ | Some tools (limited) |
| **Model-agnostic memory** | ✅ | ❌ Nobody |
| **Selective memory control** | ✅ | ❌ Nobody |
| **KRONOS 3D temporal engine** | ✅ | ❌ Nobody |
| Works with 100+ models | ✅ | Varies |
| BYOK (no inference markup) | ✅ | Rare |

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MEMORYROUTER FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Developer App                                                             │
│        │                                                                    │
│        ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                      api.memoryrouter.ai                            │  │
│   ├─────────────────────────────────────────────────────────────────────┤  │
│   │                                                                     │  │
│   │  1. Authenticate (Memory Key)                                       │  │
│   │  2. Determine target model + provider                               │  │
│   │  3. Retrieve relevant memory (KRONOS RAG)                           │  │
│   │  4. Format context for target model                                 │  │
│   │  5. Inject memory context into request                              │  │
│   │  6. Forward to provider (using user's API key)                      │  │
│   │  7. Stream response back                                            │  │
│   │  8. Store in memory (respecting selective memory flags)             │  │
│   │  9. Meter memory tokens                                             │  │
│   │                                                                     │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│        │                                                                    │
│        ▼                                                                    │
│   AI Provider (OpenAI, Anthropic, Google, etc.)                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Key Concepts

### 2.1 BYOK (Bring Your Own Key)

Users store their existing AI provider API keys with MemoryRouter:
- OpenAI API keys
- Anthropic API keys  
- OpenRouter API keys
- Google AI API keys
- Any other supported provider

**We never charge for inference.** The user pays their provider directly. We only charge for memory operations.

### 2.2 Model-Agnostic Memory (KEY DIFFERENTIATOR)

**Memory Keys are completely independent of Provider Keys.**

This means:
- The same memory context works with ANY model from ANY provider
- Ask Claude to analyze, switch to GPT to write, switch to Llama to iterate—all share the same memory
- Memory is portable across your entire AI stack

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MODEL-AGNOSTIC MEMORY ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   User Account                                                              │
│   │                                                                         │
│   ├── Provider Keys (stored separately)                                     │
│   │   ├── Anthropic: sk-ant-xxx                                            │
│   │   ├── OpenAI: sk-xxx                                                   │
│   │   ├── OpenRouter: sk-or-xxx                                            │
│   │   └── Google: AIza-xxx                                                 │
│   │                                                                         │
│   └── Memory Keys (independent of providers)                                │
│       ├── mk_project_alpha ──────────┐                                     │
│       ├── mk_project_beta ───────────┼──► Each memory key works with       │
│       ├── mk_user_12345 ─────────────┤    ANY provider/model               │
│       └── mk_customer_support ───────┘                                     │
│                                                                             │
│   API Call Example:                                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  POST /v1/chat/completions                                          │  │
│   │  Authorization: Bearer mk_project_alpha                             │  │
│   │  {                                                                  │  │
│   │    "model": "anthropic/claude-3-opus",  ← Can be ANY model          │  │
│   │    "messages": [...]                                                │  │
│   │  }                                                                  │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   Same memory key, different models:                                        │
│   • Request 1: model="anthropic/claude-3-opus" → Uses mk_project_alpha     │
│   • Request 2: model="openai/gpt-4" → Uses same mk_project_alpha           │
│   • Request 3: model="meta/llama-3-70b" → Uses same mk_project_alpha       │
│                                                                             │
│   All three requests share the SAME memory context!                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Use case:** "I used Claude Opus to deeply understand my codebase. Then I switched to GPT-4 for documentation because it's better at prose. Then I used Haiku for quick iterations because it's cheap. All three had the SAME context."

### 2.3 Selective Memory (KEY DIFFERENTIATOR)

Not everything should be remembered. Users have **message-level control** over what gets stored.

```javascript
// Default: everything gets stored
{
  "messages": [
    { "role": "user", "content": "Analyze this code" }  // Stored ✓
  ]
}

// Selective: control what gets remembered
{
  "messages": [
    { 
      "role": "user", 
      "content": "Here's 50 pages of reference docs...",
      "memory": false  // NOT stored (ephemeral context)
    },
    { 
      "role": "user", 
      "content": "Now analyze the auth flow"  // Stored ✓
    }
  ]
}
```

**Use cases:**
- **Security:** Send sensitive data for this query only, don't persist
- **Context stuffing:** Include large reference docs without bloating memory
- **One-off queries:** Analyze something without polluting project memory
- **Refinement:** Remember final decisions, forget the 20 iterations

**Memory control options:**

| Level | How | Effect |
|-------|-----|--------|
| Message | `"memory": false` on message | That message not stored |
| Request | `X-Memory-Store: false` header | Nothing from request stored |
| Response | `X-Memory-Store-Response: false` header | Input stored, output not stored |

### 2.4 Memory Keys

- Each Memory Key = a unique, isolated memory context
- One Memory Key per user, per conversation, per project—whatever granularity needed
- Memory Keys are cheap to create (sub-millisecond)
- Ephemeral keys: if never used, never persisted (no bloat)
- **Strict isolation:** Memory keys cannot access each other's data

```
Memory Key: mk_project_alpha
├── All conversations using this key share context
├── Works with any model (Claude, GPT, Llama, etc.)
├── Multiple users/processes can write simultaneously
└── Isolated from all other memory keys
```

### 2.5 Concurrent Access

Multiple users or processes can use the same memory key simultaneously:
- All writes go to the same vector store
- No coordination needed—KRONOS handles it
- "Throw it all in and let RAG sort it out"

### 2.6 Memory Tokens

We meter usage in **memory tokens**:
- Input text that gets embedded → memory tokens
- Output text that gets stored → memory tokens  
- Retrieved context (RAG) → memory tokens

**Pricing:** $1.00 per 1M memory tokens

### 2.7 Data Retention & Privacy

- **Retention:** 90 days from last use
- **Ephemeral keys:** Deleted immediately if never used
- **Manual deletion:** Users can delete memory via API anytime
- **No export:** Memory stays in MemoryRouter (vendor lock-in by design)
- **Strict isolation:** Memory keys are cryptographically isolated

---

## 3. System Architecture

### 3.1 Component Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MEMORYROUTER ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐       │
│  │   API Gateway   │     │  Memory Service │     │  Billing Service│       │
│  │   (Edge/CDN)    │────▶│    (KRONOS)     │────▶│   (Stripe)      │       │
│  └─────────────────┘     └─────────────────┘     └─────────────────┘       │
│           │                      │                                          │
│           │                      ▼                                          │
│           │              ┌─────────────────┐                               │
│           │              │  Vector Store   │                               │
│           │              │  (VectorVault)  │                               │
│           │              └─────────────────┘                               │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐     ┌─────────────────┐                               │
│  │ Provider Router │────▶│ Model Formatter │                               │
│  │ (Multi-provider)│     │ (Per-model)     │                               │
│  └─────────────────┘     └─────────────────┘                               │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │                      AI Providers                                │       │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │       │
│  │  │  OpenAI  │  │Anthropic │  │  Google  │  │ OpenRouter│        │       │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Components

| Component | Purpose | Technology |
|-----------|---------|------------|
| **API Gateway** | Request routing, rate limiting, auth | Cloudflare Workers / Fastify |
| **Memory Service** | KRONOS RAG engine | Node.js + VectorVault |
| **Vector Store** | Embedding storage + retrieval | VectorVault (cloud) |
| **Model Formatter** | Per-model context injection | Centralized formatter module |
| **Provider Router** | Multi-provider API forwarding | OpenRouter-compatible proxy |
| **Billing Service** | Usage metering + Stripe integration | Node.js + Stripe |
| **Database** | User accounts, keys, metadata | PostgreSQL / Supabase |

---

## 4. Model-Specific Formatting

Different models respond better to different context injection formats. We maintain a **single centralized formatter** that's kept up-to-date with best practices.

### 4.1 Formatter Module

```javascript
// formatters.js — Single source of truth for all model formatting

const formatters = {
  // Anthropic models prefer XML-style tags
  'claude': (context) => `<memory_context>
${context}
</memory_context>

Use the above context from previous conversations to inform your response.`,

  // OpenAI models prefer markdown
  'gpt': (context) => `## Relevant Memory
---
${context}
---

Use this context to inform your response.`,

  // Llama/Meta models
  'llama': (context) => `[MEMORY_CONTEXT]
${context}
[/MEMORY_CONTEXT]

The above is relevant context from previous conversations.`,

  // Google models
  'gemini': (context) => `<context type="memory">
${context}
</context>`,

  // Default fallback
  'default': (context) => `Relevant context from previous conversations:

${context}

Use this context to inform your response, but don't reference it directly unless asked.`
};

function getFormatter(model) {
  if (model.includes('claude')) return formatters['claude'];
  if (model.includes('gpt')) return formatters['gpt'];
  if (model.includes('llama')) return formatters['llama'];
  if (model.includes('gemini')) return formatters['gemini'];
  return formatters['default'];
}

function formatMemoryContext(model, context) {
  const formatter = getFormatter(model);
  return formatter(context);
}

module.exports = { formatMemoryContext, formatters };
```

### 4.2 Keeping Formatters Updated

- Formatters live in a single file
- Research-backed: we test what works best per model
- Easy to update without changing core logic
- Can A/B test different formats

---

## 5. API Design

### 5.1 Base URL

```
https://api.memoryrouter.ai/v1
```

Drop-in replacement for:
- `https://api.openai.com/v1`
- `https://api.anthropic.com/v1`
- `https://openrouter.ai/api/v1`

### 5.2 Authentication

```
Authorization: Bearer mk_xxxxxxxxxxxxxxxx
```

The Memory Key (`mk_*`) authenticates the request AND identifies the memory context.

### 5.3 Model Selection

Specify the model using OpenRouter-style model strings:

```javascript
{
  "model": "anthropic/claude-3-opus",    // Anthropic
  "model": "openai/gpt-4-turbo",         // OpenAI
  "model": "google/gemini-pro",          // Google
  "model": "meta-llama/llama-3-70b",     // Via OpenRouter
}
```

We automatically route to the correct provider based on the model string and use the user's stored API key for that provider.

### 5.4 Supported Endpoints

**Chat Completions (OpenAI-compatible):**
```
POST /v1/chat/completions
```

**Messages (Anthropic-compatible):**
```
POST /v1/messages
```

### 5.5 Memory Control

**Message-level selective memory:**
```javascript
{
  "model": "anthropic/claude-3-opus",
  "messages": [
    { 
      "role": "user", 
      "content": "Reference docs...",
      "memory": false  // Don't store this message
    },
    { 
      "role": "user", 
      "content": "Analyze the auth"  // Stored normally
    }
  ]
}
```

**Request-level headers:**

| Header | Values | Description |
|--------|--------|-------------|
| `X-Memory-Mode` | `auto`, `read`, `write`, `off` | Control memory read/write |
| `X-Memory-Store` | `true`, `false` | Store this request's content |
| `X-Memory-Store-Response` | `true`, `false` | Store the response |
| `X-Memory-Context-Limit` | integer | Max context tokens to retrieve |
| `X-Memory-Recency-Bias` | `low`, `medium`, `high` | Prefer recent vs semantic |

**Default:** `auto` (read + write enabled, all content stored, balanced retrieval)

---

## 6. Request Flow (Detailed)

### 6.1 Complete Processing Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         REQUEST PROCESSING PIPELINE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Step 1: AUTHENTICATE                                                       │
│  ├── Validate Memory Key (mk_xxx)                                          │
│  ├── Look up user account                                                   │
│  └── Check credits/billing status                                           │
│                                                                             │
│  Step 2: PARSE MODEL & PROVIDER                                             │
│  ├── Extract model from request (e.g., "anthropic/claude-3-opus")          │
│  ├── Determine provider (Anthropic)                                         │
│  ├── Look up user's API key for that provider                              │
│  └── Validate provider key exists and is active                            │
│                                                                             │
│  Step 3: RETRIEVE MEMORY (KRONOS RAG)                                       │
│  ├── Extract query from messages (last user message + any system context)  │
│  ├── Embed query (text-embedding-3-large)                                   │
│  ├── Search memory across 3 temporal windows:                               │
│  │   ├── HOT (12 hours) — immediate context                                │
│  │   ├── WORKING (3 days) — recent history                                 │
│  │   └── LONG-TERM (90 days) — full knowledge                              │
│  ├── Retrieve top-K relevant chunks (equal allocation across windows)      │
│  └── Dedupe and rank results                                                │
│                                                                             │
│  Step 4: FORMAT CONTEXT FOR MODEL                                           │
│  ├── Get formatter for target model (Claude, GPT, Llama, etc.)             │
│  ├── Apply model-specific formatting                                        │
│  └── Generate formatted context block                                       │
│                                                                             │
│  Step 5: AUGMENT REQUEST                                                    │
│  ├── Inject formatted memory context as system message                      │
│  ├── Preserve original messages                                             │
│  ├── Include ephemeral content (memory: false) without flagging for storage│
│  └── Construct final augmented request                                      │
│                                                                             │
│  Step 6: FORWARD TO PROVIDER                                                │
│  ├── Route to correct provider API                                          │
│  ├── Use user's stored API key                                              │
│  ├── Stream response back to client                                         │
│  └── Capture full response for memory storage                               │
│                                                                             │
│  Step 7: STORE IN MEMORY (SELECTIVE)                                        │
│  ├── Filter messages: skip any with memory: false                          │
│  ├── Check X-Memory-Store header                                            │
│  ├── Store qualifying messages (user + assistant)                           │
│  ├── Embed and index in vector store                                        │
│  └── Update temporal window membership                                      │
│                                                                             │
│  Step 8: METER + BILL                                                       │
│  ├── Count memory tokens:                                                   │
│  │   ├── Input tokens (only stored messages)                               │
│  │   ├── Output tokens (if stored)                                         │
│  │   └── Retrieved tokens (RAG context)                                    │
│  ├── Update usage counters                                                  │
│  └── Deduct from credits or meter for invoice                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Example: Cross-Model Workflow

```javascript
// Request 1: Use Claude to analyze
POST /v1/chat/completions
Authorization: Bearer mk_project_alpha
{
  "model": "anthropic/claude-3-opus",
  "messages": [
    { "role": "user", "content": "Analyze this codebase architecture" }
  ]
}
// → Claude analyzes, response stored in mk_project_alpha memory

// Request 2: Use GPT to write docs (SAME memory key)
POST /v1/chat/completions
Authorization: Bearer mk_project_alpha
{
  "model": "openai/gpt-4-turbo",
  "messages": [
    { "role": "user", "content": "Write documentation for the auth module" }
  ]
}
// → GPT has context from Claude's analysis!
// → GPT writes docs, response added to same memory

// Request 3: Use Haiku for quick iteration (SAME memory key)
POST /v1/chat/completions
Authorization: Bearer mk_project_alpha
{
  "model": "anthropic/claude-3-haiku",
  "messages": [
    { "role": "user", "content": "Add error handling to the login function" }
  ]
}
// → Haiku knows the architecture AND the docs!
```

---

## 7. KRONOS Memory Engine

### 7.1 Three-Dimensional Context

KRONOS retrieves memory across three dimensions:

| Dimension | Description | Implementation |
|-----------|-------------|----------------|
| **Semantic** | What you're talking about | Vector similarity search |
| **Temporal** | When it happened | Time-windowed tables |
| **Spatial** | Where it happened | Location metadata (future) |

### 7.2 Temporal Windows

| Window | Duration | Purpose |
|--------|----------|---------|
| **HOT** | 12 hours | Immediate conversation context |
| **WORKING** | 3 days | Recent session history |
| **LONG-TERM** | 90 days | Full knowledge base |

### 7.3 Equal Allocation Retrieval

For N context chunks requested, allocate equally across windows:

```
N = 12 → 4 from HOT, 4 from WORKING, 4 from LONG-TERM
```

This ensures recent context surfaces even if semantically weaker—because "what we just talked about" often matters more than "the most similar thing ever."

### 7.4 Memory Storage Schema

```sql
-- Per Memory Key, stored in VectorVault
CREATE TABLE memories (
  id UUID PRIMARY KEY,
  memory_key TEXT NOT NULL,           -- mk_xxx
  role TEXT NOT NULL,                  -- 'user' | 'assistant'
  content TEXT NOT NULL,
  embedding VECTOR(3072),              -- text-embedding-3-large
  token_count INTEGER,
  model TEXT,                          -- Model that generated/received this
  provider TEXT,                       -- Provider used
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB                       -- Custom tags, request_id, etc.
);

CREATE INDEX idx_memories_key ON memories(memory_key);
CREATE INDEX idx_memories_created ON memories(created_at);
CREATE INDEX idx_memories_key_time ON memories(memory_key, created_at DESC);
```

---

## 8. Database Schema

### 8.1 Users

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  stripe_customer_id TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 8.2 Provider Keys (Separate from Memory Keys)

```sql
CREATE TABLE provider_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,              -- 'openai' | 'anthropic' | 'openrouter' | 'google'
  encrypted_key TEXT NOT NULL,         -- Encrypted with KMS
  nickname TEXT,                       -- User-friendly name
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(user_id, provider)            -- One key per provider per user
);

CREATE INDEX idx_provider_keys_user ON provider_keys(user_id);
```

### 8.3 Memory Keys (Independent of Provider Keys)

```sql
CREATE TABLE memory_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,            -- 'mk_xxx' (exposed to user)
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  -- NOTE: No provider_key_id — memory keys are provider-agnostic!
  name TEXT,                           -- User-friendly name
  is_ephemeral BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMP,
  memory_token_count BIGINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP                 -- 90 days from last use
);

CREATE INDEX idx_memory_keys_key ON memory_keys(key);
CREATE INDEX idx_memory_keys_user ON memory_keys(user_id);
```

### 8.4 Usage Records

```sql
CREATE TABLE usage_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_key_id UUID REFERENCES memory_keys(id) ON DELETE CASCADE,
  request_id TEXT,
  model TEXT,                          -- Model used for this request
  provider TEXT,                       -- Provider used
  memory_tokens_in INTEGER,            -- Tokens embedded (stored input)
  memory_tokens_out INTEGER,           -- Tokens stored (assistant response)
  memory_tokens_retrieved INTEGER,     -- Tokens from RAG context
  memory_tokens_ephemeral INTEGER,     -- Tokens sent but not stored
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_usage_memory_key ON usage_records(memory_key_id);
CREATE INDEX idx_usage_created ON usage_records(created_at);
```

---

## 9. API Endpoints (Management)

### 9.1 Authentication

```
POST /v1/auth/register
POST /v1/auth/login
POST /v1/auth/logout
GET  /v1/auth/me
```

### 9.2 Provider Keys

```
GET    /v1/provider-keys              # List provider keys
POST   /v1/provider-keys              # Add provider key
DELETE /v1/provider-keys/:id          # Remove provider key
PATCH  /v1/provider-keys/:id          # Update (nickname, rotate key)
```

### 9.3 Memory Keys

```
GET    /v1/memory-keys                # List memory keys
POST   /v1/memory-keys                # Create memory key (instant, sub-ms)
DELETE /v1/memory-keys/:id            # Delete memory key + all memory
PATCH  /v1/memory-keys/:id            # Update name, settings
```

### 9.4 Memory Management

```
GET    /v1/memory/:key/search         # Search memory (debugging)
DELETE /v1/memory/:key                # Clear all memory for key
GET    /v1/memory/:key/stats          # Memory stats (count, tokens, etc.)
```

### 9.5 Usage & Billing

```
GET    /v1/usage                      # Usage summary
GET    /v1/usage/detailed             # Detailed usage records
GET    /v1/billing                    # Current balance, invoices
POST   /v1/billing/add-credits        # Add prepaid credits
```

---

## 10. Pricing & Metering

### 10.1 Memory Token Calculation

```
Memory Tokens = Stored Input + Stored Output + Retrieved Context

Where:
- Stored Input = tokens in messages where memory ≠ false
- Stored Output = tokens in assistant response (if stored)
- Retrieved Context = tokens in RAG context injected
- Ephemeral tokens (memory: false) = NOT counted
```

### 10.2 Pricing

| Tier | Price | Includes |
|------|-------|----------|
| **Pay As You Go** | $1.00 / 1M tokens | No minimum, billed monthly |
| **Pro** | $49/mo | 100M tokens included, then $0.80/1M |
| **Team** | $199/mo | 500M tokens included, then $0.60/1M |
| **Enterprise** | Custom | Volume discounts, SLA, support |

### 10.3 Free Tier (Launch)

- 10M memory tokens free
- 3 provider keys
- 10 memory keys
- 7-day retention (vs 90-day paid)

---

## 11. Infrastructure

### 11.1 Hosting

| Component | Platform | Region |
|-----------|----------|--------|
| API Gateway | Cloudflare Workers | Global edge |
| Memory Service | Google Cloud Run | us-central1 |
| Vector Store | VectorVault Cloud | us-central1 |
| Database | Supabase (PostgreSQL) | us-central1 |
| Secrets | Google Secret Manager | us-central1 |

### 11.2 Scaling

- **API Gateway:** Auto-scales globally (Cloudflare)
- **Memory Service:** Cloud Run auto-scaling (0 to N instances)
- **Vector Store:** VectorVault managed scaling
- **Database:** Supabase auto-scaling

### 11.3 Security

- All provider keys encrypted at rest (AES-256-GCM)
- TLS 1.3 for all connections
- Memory keys are randomly generated (cryptographically secure)
- Strict memory isolation between keys
- SOC 2 compliance (roadmap)

---

## 12. Design Decisions (Locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Memory isolation | Strict (no sharing) | Privacy, simplicity, security |
| Model formatting | Centralized formatter file | Easy to maintain and update |
| Memory-provider coupling | Decoupled (agnostic) | Killer feature, flexibility |
| Selective memory | Message-level control | Maximum user control |
| Concurrent access | Allowed (no locking) | Simplicity, let RAG handle it |
| Export | Not supported | Vendor lock-in, simplicity |
| Data retention | 90 days | Balance storage cost vs utility |

---

## 13. Launch Roadmap

### Phase 1: MVP (Week 1-2)
- [ ] Basic proxy with memory injection
- [ ] Multi-provider support (OpenAI, Anthropic)
- [ ] Memory key creation
- [ ] Model-specific formatters
- [ ] Selective memory (message-level)
- [ ] Simple billing (Stripe prepaid credits)
- [ ] Landing page + waitlist

### Phase 2: Beta (Week 3-4)
- [ ] OpenRouter integration (100+ models)
- [ ] Dashboard UI
- [ ] Usage analytics
- [ ] 10-20 beta users
- [ ] Documentation

### Phase 3: Public Launch (Week 5-6)
- [ ] Production infrastructure
- [ ] Free tier
- [ ] Full documentation
- [ ] HN + Product Hunt launch

### Phase 4: Growth (Month 2+)
- [ ] Team features
- [ ] Webhooks
- [ ] SDKs (Python, TypeScript)
- [ ] Enterprise features

---

## 14. Success Metrics

| Metric | Target (Month 1) | Target (Month 6) |
|--------|------------------|------------------|
| Beta users | 100 | 5,000 |
| Memory tokens processed | 1B | 100B |
| MRR | $1,000 | $50,000 |
| Avg token savings for users | 2x | 3x |
| P99 latency (memory retrieval) | <100ms | <50ms |
| Cross-model usage rate | 20% | 40% |

---

## 15. Taglines

> **"Same memory, any model."**

> **"Every $1 on memory saves $2-3 on inference."**

> **"The AI memory layer that works with every model."**

> **"Stop paying for AI to forget."**

> **"You control what gets remembered."**

---

*MemoryRouter v2.0: Model-agnostic memory with selective control. 🧠⚡*
