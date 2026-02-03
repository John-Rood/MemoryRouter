# MemoryRouter API Flags Specification

**Version:** 1.0  
**Updated:** 2026-02-02

---

## Overview

MemoryRouter accepts custom fields in the request body and headers that control memory behavior. These fields are **stripped before forwarding** to the downstream LLM provider — the provider never sees them.

---

## Request Body Fields

### `memory_mode`

Controls how memory is used for this request.

| Value | Behavior |
|-------|----------|
| `on` | **Default.** Read from memory + write to memory. Full memory loop. |
| `off` | No memory operations. Pure passthrough to provider. |
| `read` | Read from memory (inject context) but don't store this conversation. |
| `write` | Write to memory but don't retrieve/inject past context. |

**Type:** `string`  
**Required:** No (defaults to `on`)

```json
{
  "model": "gpt-4o",
  "messages": [...],
  "memory_mode": "read"
}
```

**Use Cases:**
- `off` — Stateless queries, testing, sensitive data you don't want stored
- `read` — Reference past context without polluting memory with this exchange
- `write` — Seed memory with information without retrieval overhead
- `on` — Normal operation (recommended default)

---

### `session_id`

Associates this request with a specific conversation session. Enables session-scoped memory retrieval.

**Type:** `string`  
**Required:** No  
**Format:** Any string (recommended: `user-123-thread-456` or UUID)

```json
{
  "model": "gpt-4o",
  "messages": [...],
  "session_id": "user-123-conv-abc"
}
```

**Behavior:**
- When provided, memory retrieval prioritizes vectors from this session
- Session vectors are stored separately and retrieved with higher relevance
- Enables "conversation continuity" across multiple requests
- If also provided in header, **body takes precedence**

---

### Per-Message `memory` Flag

Controls whether an individual message is stored in memory.

**Type:** `boolean`  
**Required:** No (defaults to `true`)  
**Location:** On individual message objects within `messages[]`

```json
{
  "model": "gpt-4o",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant.",
      "memory": false
    },
    {
      "role": "user", 
      "content": "Remember that my favorite color is blue."
    },
    {
      "role": "assistant",
      "content": "Got it! I'll remember that blue is your favorite color.",
      "memory": true
    }
  ]
}
```

**Behavior:**
- `memory: false` — This message is NOT stored in the vault
- `memory: true` (or omitted) — This message IS stored in the vault
- Useful for excluding system prompts, PII, or ephemeral context from storage
- Works with any `memory_mode` that includes writing (`on` or `write`)

---

## Request Headers

### `X-Session-ID`

Alternative way to pass session ID (if not in body).

**Type:** `string`  
**Required:** No

```
X-Session-ID: user-123-conv-abc
```

**Priority:** Body `session_id` takes precedence over header.

---

### `X-Memory-Mode`

Alternative way to pass memory mode (if not in body).

**Type:** `string`  
**Values:** `on` | `off` | `read` | `write`  
**Required:** No

```
X-Memory-Mode: read
```

**Priority:** Body `memory_mode` takes precedence over header.

---

### `Authorization`

Your MemoryRouter memory key for authentication.

**Type:** `string`  
**Required:** Yes  
**Format:** `Bearer mk_xxxxxxxxxxxxxxxxxxxx`

```
Authorization: Bearer mk_abc123def456...
```

---

### `X-Provider-Key`

Override the provider API key for this request (BYOK mode).

**Type:** `string`  
**Required:** No (uses MemoryRouter's key if not provided)

```
X-Provider-Key: sk-proj-abc123...
```

**Note:** When provided, the request uses YOUR API key with the provider. Useful for enterprise customers who want to use their own rate limits/billing.

---

## Response Headers

MemoryRouter returns these headers with timing and memory metrics:

| Header | Description |
|--------|-------------|
| `X-MR-Processing-Ms` | Time spent on memory operations (retrieval + storage) |
| `X-MR-Overhead-Ms` | Total MemoryRouter overhead (processing + routing) |
| `X-Provider-Response-Ms` | Time waiting for the LLM provider |
| `X-Total-Ms` | End-to-end request time |
| `X-Memory-Tokens-Retrieved` | Tokens of memory context injected |
| `X-Memory-Chunks-Retrieved` | Number of memory chunks retrieved |
| `X-Session-ID` | Echo of the session ID used (if any) |
| `X-Embedding-Ms` | Time spent generating embeddings |

---

## Complete Example

### Request

```bash
curl -X POST https://api.memoryrouter.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mk_abc123def456" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {
        "role": "system",
        "content": "You are a helpful assistant.",
        "memory": false
      },
      {
        "role": "user",
        "content": "What did we discuss yesterday about the project?"
      }
    ],
    "memory_mode": "on",
    "session_id": "user-john-project-alpha"
  }'
```

### Response Headers

```
X-MR-Processing-Ms: 45
X-MR-Overhead-Ms: 52
X-Provider-Response-Ms: 1234
X-Total-Ms: 1286
X-Memory-Tokens-Retrieved: 2048
X-Memory-Chunks-Retrieved: 8
X-Session-ID: user-john-project-alpha
```

---

## Field Stripping

All MemoryRouter-specific fields are **removed** before forwarding to the provider:

**Stripped from body:**
- `memory_mode`
- `session_id`
- `memory` (from individual messages)

**Never forwarded:**
- `X-Memory-Mode` header
- `X-Session-ID` header
- `X-Provider-Key` header (used for routing, not forwarded)

The downstream LLM receives a clean, standard request matching its native API format.

---

## Compatibility

These flags work with all supported providers:
- OpenAI (GPT-4, GPT-4o, o1, o3)
- Anthropic (Claude 3.5, Claude 4)
- Google (Gemini 2.0, Gemini 2.5)
- Meta (Llama 3, Llama 4)
- Mistral (Mistral Large, Codestral)
- DeepSeek (DeepSeek V3, R1)
- xAI (Grok)
- OpenRouter (all models)

---

*MemoryRouter — Same memory, any model. 🧠⚡*
