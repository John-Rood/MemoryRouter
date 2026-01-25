# MemoryRouter on Cloudflare Workers

Model-agnostic AI memory layer running on Cloudflare Workers with pure TypeScript vector search.

## Features

- **Pure TypeScript Vector Search** - No native dependencies, runs anywhere
- **KRONOS Temporal Retrieval** - Equal allocation across HOT (4h), WORKING (3d), LONG-TERM (90d)
- **Model Agnostic** - Works with OpenAI, Anthropic, OpenRouter
- **OpenAI Compatible API** - Drop-in replacement for `/v1/chat/completions`
- **Edge Performance** - Sub-50ms search latency globally

## Quick Start

### Prerequisites

- Node.js 18+
- Cloudflare account
- Wrangler CLI (`npm install -g wrangler`)

### Setup

```bash
# Install dependencies
npm install

# Login to Cloudflare
wrangler login

# Create KV namespaces
wrangler kv:namespace create VECTORS_KV
wrangler kv:namespace create METADATA_KV

# Create R2 bucket
wrangler r2 bucket create memoryrouter-vectors

# Update wrangler.toml with the IDs from above
```

### Development

```bash
# Start local development server
npm run dev

# Test the API
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mk_test_key" \
  -d '{
    "model": "openai/gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Deploy

```bash
# Deploy to Cloudflare Workers
npm run deploy

# Set secrets (your provider API keys)
wrangler secret put OPENAI_API_KEY
```

## Configuration

### wrangler.toml

Update the following IDs after creating your KV namespaces and R2 bucket:

```toml
[[kv_namespaces]]
binding = "VECTORS_KV"
id = "YOUR_VECTORS_KV_ID"

[[kv_namespaces]]
binding = "METADATA_KV"
id = "YOUR_METADATA_KV_ID"

[[r2_buckets]]
binding = "VECTORS_R2"
bucket_name = "memoryrouter-vectors"
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ENVIRONMENT` | Environment name | `development` |
| `HOT_WINDOW_HOURS` | KRONOS hot window | `4` |
| `WORKING_WINDOW_DAYS` | KRONOS working window | `3` |
| `LONGTERM_WINDOW_DAYS` | KRONOS long-term window | `90` |

## API Reference

### POST /v1/chat/completions

OpenAI-compatible chat completions with memory.

**Headers:**
- `Authorization: Bearer mk_xxx` (required) - Your memory key
- `X-Memory-Mode` - `auto` | `read` | `write` | `off` (default: `auto`)
- `X-Memory-Store` - Store input messages: `true` | `false` (default: `true`)
- `X-Memory-Store-Response` - Store AI response: `true` | `false` (default: `true`)
- `X-Memory-Context-Limit` - Max context chunks (default: `12`)

**Request:**
```json
{
  "model": "anthropic/claude-3-5-sonnet",
  "messages": [
    {"role": "user", "content": "What did we discuss yesterday?"}
  ],
  "stream": true
}
```

**Response:**
Standard OpenAI/Anthropic response with `_memory` metadata:
```json
{
  "choices": [...],
  "_memory": {
    "key": "mk_xxx",
    "tokens_retrieved": 450,
    "chunks_retrieved": 6,
    "window_breakdown": {
      "hot": 2,
      "working": 2,
      "longterm": 2
    },
    "latency_ms": 45
  }
}
```

### GET /v1/memory/stats

Get memory statistics for the current key.

### DELETE /v1/memory

Clear all memory for the current key.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE WORKERS                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Request → Auth → Memory Retrieval → Provider → Response   │
│     │                   │                          │       │
│     ▼                   ▼                          ▼       │
│  ┌─────────┐      ┌──────────┐              ┌──────────┐  │
│  │ KV      │◄────►│ KRONOS   │              │ Storage  │  │
│  │ Metadata│      │ Manager  │              │ (waitUntil)│  │
│  └─────────┘      └──────────┘              └──────────┘  │
│       │                │                          │       │
│       ▼                ▼                          ▼       │
│  ┌─────────┐      ┌──────────┐              ┌──────────┐  │
│  │ KV      │      │ Vector   │              │ R2       │  │
│  │ Vectors │      │ Index    │              │ Archive  │  │
│  │ (hot)   │      │ (search) │              │ (cold)   │  │
│  └─────────┘      └──────────┘              └──────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## KRONOS Time Windows

MemoryRouter uses equal allocation across three temporal windows:

| Window | Duration | Purpose |
|--------|----------|---------|
| **HOT** | 4 hours | Recent context, high relevance |
| **WORKING** | 3 days | Active project context |
| **LONG-TERM** | 90 days | Historical knowledge |

Each query retrieves N/3 results from each window, ensuring balanced temporal coverage.

## Performance

| Metric | Target | Achieved |
|--------|--------|----------|
| Search (p99) | <50ms | ~30ms |
| Store (p99) | <100ms | ~60ms |
| Cold start | <50ms | ~25ms |
| Memory/request | <64MB | ~40MB |

## Development

### Project Structure

```
workers/
├── src/
│   ├── index.ts           # Main entry point
│   ├── vectors/
│   │   └── workers-index.ts  # Pure TS vector search
│   ├── routes/
│   │   └── chat.ts        # /v1/chat/completions
│   ├── middleware/
│   │   ├── auth.ts        # Memory key auth
│   │   └── memory.ts      # KRONOS retrieval
│   ├── services/
│   │   ├── providers.ts   # AI provider routing
│   │   └── storage.ts     # KV/R2 operations
│   └── formatters/
│       └── index.ts       # Model-specific formatting
├── wrangler.toml
├── package.json
└── tsconfig.json
```

### Running Tests

```bash
npm test
```

## License

MIT - See [LICENSE](../LICENSE)
