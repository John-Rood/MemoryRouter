# API Reference

Base URL: `https://api.memoryrouter.ai`

---

## POST /v1/chat/completions

Main endpoint for chat with memory. 100% OpenAI SDK compatible.

**Request:**
```bash
curl -X POST https://api.memoryrouter.ai/v1/chat/completions \
  -H "Authorization: Bearer mk_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "My name is Alice"}]
  }'
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | Yes | Model (e.g., `openai/gpt-4o`, `anthropic/claude-3-5-sonnet`) |
| `messages` | array | Yes | Array of message objects |
| `stream` | boolean | No | Enable streaming |
| `temperature` | number | No | Sampling temperature (0-2) |
| `max_tokens` | number | No | Maximum tokens to generate |

**Headers:**

| Header | Description |
|--------|-------------|
| `X-Session-ID` | Session ID for conversation grouping |
| `X-Memory-Mode` | `read`, `write`, or `off` |

**Response:**
```json
{
  "id": "chatcmpl-abc123",
  "choices": [{
    "message": {"role": "assistant", "content": "Nice to meet you, Alice!"},
    "finish_reason": "stop"
  }],
  "usage": {"prompt_tokens": 12, "completion_tokens": 15, "total_tokens": 27},
  "_memory": {
    "tokens_retrieved": 847,
    "chunks_retrieved": 12
  }
}
```

---

## POST /v1/messages

Native Anthropic endpoint for Claude models.

```bash
curl -X POST https://api.memoryrouter.ai/v1/messages \
  -H "x-api-key: mk_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

---

## GET /v1/memory/stats

Get memory statistics.

```bash
curl https://api.memoryrouter.ai/v1/memory/stats \
  -H "Authorization: Bearer mk_xxxxxxxxxxxxxxxx"
```

**Response:**
```json
{
  "vectorCount": 1247,
  "totalTokens": 89432,
  "oldestMemory": "2024-01-15T08:30:00Z",
  "newestMemory": "2024-02-03T14:22:00Z"
}
```

---

## DELETE /v1/memory

Clear all memory for your key.

```bash
curl -X DELETE https://api.memoryrouter.ai/v1/memory \
  -H "Authorization: Bearer mk_xxxxxxxxxxxxxxxx"
```

**With session scope:**
```bash
curl -X DELETE https://api.memoryrouter.ai/v1/memory \
  -H "Authorization: Bearer mk_xxxxxxxxxxxxxxxx" \
  -H "X-Session-ID: session-123"
```

---

## POST /v1/memory/warmup

Pre-load vectors for faster first request.

```bash
curl -X POST https://api.memoryrouter.ai/v1/memory/warmup \
  -H "Authorization: Bearer mk_xxxxxxxxxxxxxxxx"
```

---

## GET /v1/models

List available models based on configured provider keys.

```bash
curl https://api.memoryrouter.ai/v1/models \
  -H "Authorization: Bearer mk_xxxxxxxxxxxxxxxx"
```

---

## Pass-Through Endpoints

These forward to providers without memory injection:

- `POST /v1/embeddings` — Generate embeddings
- `POST /v1/audio/transcriptions` — Whisper transcription
- `POST /v1/audio/speech` — Text-to-speech
- `POST /v1/images/generations` — DALL-E images

---

## GET /health

Health check (no auth required).

```bash
curl https://api.memoryrouter.ai/health
```

---

## KRONOS Time Windows

Memory retrieval prioritizes recent context:

| Window | Timeframe | Purpose |
|--------|-----------|---------|
| HOT | Last 4 hours | Current conversation |
| WORKING | Last 3 days | Recent interactions |
| LONG-TERM | Last 90 days | Important facts |

---

## Error Codes

| Code | Meaning |
|------|---------|
| 400 | Bad request |
| 401 | Authentication failed |
| 402 | Insufficient balance |
| 429 | Rate limited |
| 500 | Internal error |
| 502 | Provider error |
