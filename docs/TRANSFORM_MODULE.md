# MemoryRouter Transform Module Specification

**Version:** 1.0  
**Created:** 2026-02-02  
**Status:** Master Build Plan  
**Author:** Engineering Team  
**Domain:** api.memoryrouter.ai  

> **THE MASTER PLAN:** This document specifies the complete Transform Module architecture for MemoryRouter — the system that enables any OpenAI-compatible application to gain persistent memory with a single URL change.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [API Endpoint Matrix](#3-api-endpoint-matrix)
4. [Provider Support](#4-provider-support)
5. [Memory Integration (KRONOS)](#5-memory-integration-kronos)
6. [Token Tracking](#6-token-tracking)
7. [Billing Integration](#7-billing-integration)
8. [Truncation Strategy](#8-truncation-strategy)
9. [Context Window Management](#9-context-window-management)
10. [Why Not Existing Packages](#10-why-not-existing-packages)
11. [Implementation Plan](#11-implementation-plan)
12. [What's Already Built](#12-whats-already-built)
13. [Open Questions (Resolved)](#13-open-questions-resolved)

---

## 1. Executive Summary

### The Vision: One Line of Code

```typescript
// Before (no memory)
const client = new OpenAI({ apiKey: "sk-..." });

// After (persistent memory forever)
const client = new OpenAI({
    apiKey: "mk_your_memory_key",
    baseURL: "https://api.memoryrouter.ai/v1"  // ← THIS IS THE ENTIRE PRODUCT
});
```

**That's it.** No SDK. No package. No install. No migration. No code changes beyond this single line.

### Why This Matters

Every AI API call is stateless. Your AI has amnesia. MemoryRouter solves this by:

1. **Intercepting** every request at our proxy
2. **Retrieving** relevant memories from the user's vault (semantic search + KRONOS time windows)
3. **Injecting** those memories into the request (formatted per provider)
4. **Forwarding** to the actual AI provider (OpenAI, Anthropic, Google, etc.)
5. **Extracting** new memories from the response
6. **Storing** them for future retrieval
7. **Returning** the response unchanged to the user

The user's code never knows the difference. They just get an AI that remembers.

### What Users Get

| Feature | Description |
|---------|-------------|
| **Drop-in replacement** | Works with existing OpenAI SDK code — zero changes |
| **Cross-session memory** | AI remembers conversations from days/weeks/months ago |
| **Cross-model memory** | Same memories work with GPT, Claude, Gemini, Llama |
| **Selective memory** | `memory: false` flag prevents sensitive data from being stored |
| **Core memory** | Deploy foundational knowledge via base.jsonl |
| **BYOK** | Bring your own API keys — we never touch inference costs |
| **Smart truncation** | Automatic context management when windows fill up |

### The Moat

Nobody else offers **model-agnostic, proxy-based persistent memory** with:
- Zero code changes required
- BYOK (no inference markup)
- Selective memory control
- KRONOS temporal windows
- Provider-agnostic transforms

We're not competing with Zep, Mem0, or Pinecone. Those are SDKs and databases. We're a **transparent proxy** that adds memory to any existing application.

---

## 2. Architecture Overview

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MEMORYROUTER TRANSFORM PIPELINE                       │
└─────────────────────────────────────────────────────────────────────────────┘

                            ┌─────────────────┐
                            │   User's App    │
                            │  (OpenAI SDK)   │
                            └────────┬────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            INBOUND PIPELINE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. VALIDATE                                                                │
│     ├─ Parse Authorization header (mk_xxx_yyy)                              │
│     ├─ Extract account ID + session ID                                      │
│     ├─ Verify account exists, has credits                                   │
│     └─ Load provider API keys from account                                  │
│                                                                             │
│  2. EXTRACT QUERY                                                           │
│     ├─ Parse request body (messages array)                                  │
│     ├─ Extract last user message for semantic search                        │
│     └─ Identify model → detect provider                                     │
│                                                                             │
│  3. RETRIEVE MEMORY                                                         │
│     ├─ Generate embedding for search query                                  │
│     ├─ Search across KRONOS windows (HOT → WORKING → LONG-TERM → ARCHIVE)   │
│     ├─ Apply recency weighting                                              │
│     ├─ Load core memory (base.jsonl) if configured                          │
│     └─ Return ranked memory chunks                                          │
│                                                                             │
│  4. COUNT TOKENS (pre-injection)                                            │
│     ├─ Count original message tokens                                        │
│     └─ Record for billing comparison                                        │
│                                                                             │
│  5. INJECT MEMORY                                                           │
│     ├─ Format memories for provider (XML for Claude, markdown for GPT)      │
│     ├─ Insert as system message or context block                            │
│     └─ Count tokens (post-injection)                                        │
│                                                                             │
│  6. TRUNCATE IF NEEDED                                                      │
│     ├─ Check against model's context window (95% safety margin)             │
│     ├─ Apply priority-based truncation (oldest history first)               │
│     ├─ Count tokens (post-truncation)                                       │
│     └─ Set truncation headers                                               │
│                                                                             │
│  7. TRANSFORM FOR PROVIDER                                                  │
│     ├─ OpenAI: pass through                                                 │
│     ├─ Anthropic: separate system messages, map roles                       │
│     ├─ Google: convert to contents/parts, systemInstruction                 │
│     └─ Others: apply OpenAI-compatible transforms                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │    AI Provider API    │
                         │  (OpenAI, Anthropic,  │
                         │   Google, etc.)       │
                         └───────────┬───────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            OUTBOUND PIPELINE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. PARSE RESPONSE                                                          │
│     ├─ Handle streaming (SSE) or non-streaming (JSON)                       │
│     ├─ Transform back to OpenAI format if needed (Google)                   │
│     └─ Extract full response content                                        │
│                                                                             │
│  2. COUNT TOKENS (output)                                                   │
│     └─ Count response tokens for billing                                    │
│                                                                             │
│  3. EXTRACT MEMORIES                                                        │
│     ├─ Parse user message and assistant response                            │
│     ├─ Check for memory: false flag (skip storage if set)                   │
│     ├─ Generate embeddings for new content                                  │
│     └─ Create memory chunks with timestamps                                 │
│                                                                             │
│  4. STORE MEMORIES                                                          │
│     ├─ Store in session's vector vault                                      │
│     ├─ Update KRONOS window metadata                                        │
│     └─ Index for future retrieval                                           │
│                                                                             │
│  5. RECORD BILLING                                                          │
│     ├─ Calculate: request tokens + memory tokens + response tokens          │
│     ├─ Write usage record to D1                                             │
│     └─ Update account balance                                               │
│                                                                             │
│  6. RETURN RESPONSE                                                         │
│     ├─ Add X-MemoryRouter-* headers                                         │
│     ├─ Return original response format                                      │
│     └─ Stream through if streaming was requested                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
                            ┌─────────────────┐
                            │   User's App    │
                            │   (response)    │
                            └─────────────────┘
```

### Data Flow Diagram

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Request    │───▶│   Validate   │───▶│   Retrieve   │───▶│   Inject     │
│   (OpenAI    │    │   + Auth     │    │   Memories   │    │   Context    │
│   format)    │    │              │    │   (KRONOS)   │    │              │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
                                                                    │
                    ┌──────────────┐    ┌──────────────┐            │
                    │   Return     │◀───│   Store      │◀───────────┘
                    │   Response   │    │   New        │    ┌──────────────┐
                    │   + Headers  │    │   Memories   │◀───│   Provider   │
                    └──────────────┘    └──────────────┘    │   Response   │
                                                            └──────────────┘
```

### Component Architecture

```
src/
├── routes/
│   ├── chat.ts              # POST /v1/chat/completions (memory-enhanced)
│   ├── completions.ts       # POST /v1/completions (memory-enhanced, legacy)
│   ├── passthrough.ts       # All pass-through endpoints (audio, images, etc.)
│   └── models.ts            # GET /v1/models (synthetic)
│
├── middleware/
│   ├── auth.ts              # Authentication + key parsing
│   ├── memory.ts            # Memory injection middleware
│   └── billing.ts           # Usage tracking middleware
│
├── services/
│   ├── providers.ts         # Provider detection + transforms
│   ├── truncation.ts        # Context window management
│   ├── memory-retrieval.ts  # KRONOS-based memory retrieval
│   ├── memory-storage.ts    # Memory extraction + storage
│   └── billing.ts           # D1 billing operations
│
├── formatters/
│   ├── openai.ts            # OpenAI format (passthrough)
│   ├── anthropic.ts         # Anthropic transform
│   ├── google.ts            # Gemini transform (already built)
│   └── memory-injection.ts  # Per-provider memory formatting
│
├── types/
│   ├── request.ts           # Request types
│   ├── response.ts          # Response types
│   └── do.ts                # Durable Objects types
│
└── index.ts                 # Hono app + route registration
```

---

## 3. API Endpoint Matrix

### Memory-Enhanced Endpoints

These endpoints receive full memory treatment: retrieval, injection, extraction, storage.

| Endpoint | Method | Description | Implementation Status |
|----------|--------|-------------|----------------------|
| `/v1/chat/completions` | POST | Main chat endpoint — inject memories, extract new ones | 🔄 In Progress |
| `/v1/completions` | POST | Legacy completions — same memory treatment | 📋 Planned |
| `/v1/assistants` | POST | Assistants API — memory-enhanced (V2) | 📋 Future |
| `/v1/threads` | POST | Threads API — memory-enhanced (V2) | 📋 Future |
| `/v1/threads/{id}/messages` | POST | Thread messages — memory-enhanced (V2) | 📋 Future |
| `/v1/threads/{id}/runs` | POST | Thread runs — memory-enhanced (V2) | 📋 Future |

#### Chat Completions Route Logic

```typescript
// routes/chat.ts
import { Hono } from 'hono';
import { detectProvider, forwardToProvider } from '../services/providers';
import { retrieveMemories, storeMemories } from '../services/memory';
import { truncateToFit } from '../services/truncation';
import { injectMemoryContext } from '../formatters/memory-injection';
import { countTokens, recordUsage } from '../services/billing';

export const chatRouter = new Hono();

chatRouter.post('/chat/completions', async (c) => {
  const startTime = Date.now();
  const userContext = getUserContext(c);
  
  // 1. Parse request
  const body = await c.req.json() as ChatCompletionRequest;
  const provider = detectProvider(body.model);
  
  // 2. Count pre-injection tokens
  const preInjectionTokens = countTokens(body.messages);
  
  // 3. Extract search query from last user message
  const lastUserMessage = body.messages
    .filter(m => m.role === 'user')
    .pop()?.content ?? '';
  
  // 4. Retrieve memories (KRONOS)
  const memories = await retrieveMemories({
    sessionId: userContext.sessionId,
    query: lastUserMessage,
    maxChunks: 20,
    windows: ['hot', 'working', 'longterm', 'archive'],
  });
  
  // 5. Inject memories into messages
  const messagesWithMemory = injectMemoryContext(
    body.messages,
    memories,
    provider
  );
  
  // 6. Count post-injection tokens
  const postInjectionTokens = countTokens(messagesWithMemory);
  
  // 7. Truncate if needed
  const { messages, truncated, truncationDetails } = truncateToFit(
    messagesWithMemory,
    memories,
    body.model
  );
  
  // 8. Forward to provider
  const providerRequest = { ...body, messages };
  const response = await forwardToProvider(
    provider,
    userContext.providerKeys[provider],
    providerRequest
  );
  
  // 9. Handle streaming vs non-streaming
  if (body.stream) {
    return handleStreamingResponse(c, response, {
      userContext,
      originalMessages: body.messages,
      truncated,
      truncationDetails,
      preInjectionTokens,
      postInjectionTokens,
    });
  }
  
  // 10. Parse response and extract content
  const responseBody = await response.json();
  const assistantContent = extractResponseContent(responseBody);
  
  // 11. Store new memories (unless memory: false)
  const shouldStore = body.messages.every(m => m.memory !== false);
  if (shouldStore && assistantContent) {
    await storeMemories({
      sessionId: userContext.sessionId,
      userMessage: lastUserMessage,
      assistantResponse: assistantContent,
    });
  }
  
  // 12. Record billing
  const outputTokens = countTokens([{ role: 'assistant', content: assistantContent }]);
  await recordUsage({
    accountId: userContext.accountId,
    requestTokens: preInjectionTokens,
    memoryTokens: postInjectionTokens - preInjectionTokens,
    responseTokens: outputTokens,
    model: body.model,
    latencyMs: Date.now() - startTime,
  });
  
  // 13. Return response with headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-MemoryRouter-Request-Tokens': String(preInjectionTokens),
    'X-MemoryRouter-Memory-Tokens': String(postInjectionTokens - preInjectionTokens),
    'X-MemoryRouter-Response-Tokens': String(outputTokens),
  };
  
  if (truncated) {
    headers['X-MemoryRouter-Truncated'] = 'true';
    headers['X-MemoryRouter-Truncated-Details'] = buildTruncationHeader(truncationDetails);
    headers['X-MemoryRouter-Tokens-Removed'] = String(truncationDetails.tokensRemoved);
  }
  
  return new Response(JSON.stringify(responseBody), { headers });
});
```

### Pass-Through Endpoints

These endpoints forward requests unchanged — no memory injection or extraction.

| Endpoint | Method | Description | Status |
|----------|--------|-------------|--------|
| `/v1/embeddings` | POST | Generate embeddings | ✅ Built |
| `/v1/audio/transcriptions` | POST | Whisper transcription | ✅ Built |
| `/v1/audio/translations` | POST | Whisper translation | ✅ Built |
| `/v1/audio/speech` | POST | Text-to-speech | ✅ Built |
| `/v1/images/generations` | POST | DALL-E generation | ✅ Built |
| `/v1/images/edits` | POST | DALL-E edits | ✅ Built |
| `/v1/images/variations` | POST | DALL-E variations | ✅ Built |
| `/v1/completions` | POST | Legacy completions (pass-through mode) | ✅ Built |
| `/v1/files` | POST/GET/DELETE | File operations | 📋 Planned |
| `/v1/fine-tuning/jobs` | POST/GET | Fine-tuning (pass-through) | 📋 Planned |
| `/v1/batches` | POST/GET | Batch API | 📋 Planned |

#### Pass-Through Implementation Pattern

```typescript
// Already implemented in passthrough.ts
router.post('/embeddings', async (c) => {
  const userContext = getUserContext(c);
  const body = await c.req.json();
  const provider = detectProvider(body.model);
  
  // Get API key for provider
  const apiKey = getProviderKey(userContext.providerKeys, provider, c.env);
  if (!apiKey) {
    return c.json({ error: `No API key for ${provider}` }, 400);
  }
  
  // Build headers and forward
  const headers = buildAuthHeaders(provider, apiKey);
  const endpoint = EMBEDDINGS_ENDPOINTS[provider];
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ ...body, model: getModelName(body.model) }),
  });
  
  // Forward response unchanged
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' },
  });
});
```

### Synthetic Endpoints

These endpoints return data we generate ourselves.

| Endpoint | Method | Description | Status |
|----------|--------|-------------|--------|
| `/v1/models` | GET | List supported models | 📋 Planned |
| `/health` | GET | Health check | ✅ Built |
| `/v1/memory/search` | POST | Direct memory search (API) | 📋 Planned |
| `/v1/memory/stats` | GET | Memory statistics | 📋 Planned |

#### Models Endpoint Implementation

```typescript
// routes/models.ts
const SUPPORTED_MODELS = [
  // OpenAI
  { id: 'openai/gpt-4o', object: 'model', owned_by: 'openai', context_window: 128000 },
  { id: 'openai/gpt-4o-mini', object: 'model', owned_by: 'openai', context_window: 128000 },
  { id: 'openai/gpt-4-turbo', object: 'model', owned_by: 'openai', context_window: 128000 },
  { id: 'openai/o1', object: 'model', owned_by: 'openai', context_window: 200000 },
  { id: 'openai/o1-mini', object: 'model', owned_by: 'openai', context_window: 128000 },
  
  // Anthropic
  { id: 'anthropic/claude-opus-4', object: 'model', owned_by: 'anthropic', context_window: 200000 },
  { id: 'anthropic/claude-sonnet-4', object: 'model', owned_by: 'anthropic', context_window: 200000 },
  { id: 'anthropic/claude-3-5-sonnet', object: 'model', owned_by: 'anthropic', context_window: 200000 },
  { id: 'anthropic/claude-3-5-haiku', object: 'model', owned_by: 'anthropic', context_window: 200000 },
  
  // Google
  { id: 'google/gemini-2.0-flash', object: 'model', owned_by: 'google', context_window: 1000000 },
  { id: 'google/gemini-1.5-pro', object: 'model', owned_by: 'google', context_window: 1000000 },
  { id: 'google/gemini-1.5-flash', object: 'model', owned_by: 'google', context_window: 1000000 },
  
  // xAI
  { id: 'xai/grok-2', object: 'model', owned_by: 'xai', context_window: 131072 },
  { id: 'xai/grok-2-mini', object: 'model', owned_by: 'xai', context_window: 131072 },
  
  // Cerebras
  { id: 'cerebras/llama-3.3-70b', object: 'model', owned_by: 'cerebras', context_window: 128000 },
  
  // OpenRouter (200+ models)
  { id: 'openrouter/meta-llama/llama-3.1-405b', object: 'model', owned_by: 'meta', context_window: 128000 },
  { id: 'openrouter/mistral/mistral-large', object: 'model', owned_by: 'mistral', context_window: 128000 },
  // ... more models
];

modelsRouter.get('/models', (c) => {
  return c.json({
    object: 'list',
    data: SUPPORTED_MODELS,
  });
});
```

---

## 4. Provider Support

MemoryRouter supports all providers that @unified-llm/core supports, plus additional providers via OpenRouter fallback.

### Provider Matrix

| Provider | API Format | Transform Required | Auth Header | Status |
|----------|------------|-------------------|-------------|--------|
| **OpenAI** | Native OpenAI | None (passthrough) | `Authorization: Bearer` | ✅ Built |
| **Anthropic** | Messages API | System separation, role mapping | `x-api-key` | ✅ Built |
| **Google Gemini** | GenerateContent | contents/parts, systemInstruction | `x-goog-api-key` | ✅ Built |
| **xAI** | OpenAI-compatible | Model name only | `Authorization: Bearer` | ✅ Built |
| **Cerebras** | OpenAI-compatible | Model name only | `Authorization: Bearer` | ✅ Built |
| **DeepSeek** | OpenAI-compatible | Model name only | `Authorization: Bearer` | 📋 Planned |
| **Azure OpenAI** | OpenAI + deployment | URL + API version | `api-key` | 📋 Planned |
| **Ollama** | OpenAI-compatible | Local URL | None | 📋 Planned |
| **Mistral** | OpenAI-compatible | Model name only | `Authorization: Bearer` | 📋 Planned |
| **OpenRouter** | OpenAI-compatible | Model routing | `Authorization: Bearer` | ✅ Built |

### Provider Detection Logic

```typescript
// services/providers.ts (already built)
export function detectProvider(model: string): Provider {
  const modelLower = model.toLowerCase();
  
  // Explicit provider prefix (recommended)
  if (modelLower.startsWith('anthropic/')) return 'anthropic';
  if (modelLower.startsWith('openai/')) return 'openai';
  if (modelLower.startsWith('google/')) return 'google';
  if (modelLower.startsWith('xai/')) return 'xai';
  if (modelLower.startsWith('cerebras/')) return 'cerebras';
  if (modelLower.startsWith('deepseek/')) return 'deepseek';
  if (modelLower.startsWith('azure/')) return 'azure';
  if (modelLower.startsWith('ollama/')) return 'ollama';
  if (modelLower.startsWith('mistral/')) return 'mistral';
  if (modelLower.startsWith('meta-llama/') || modelLower.startsWith('openrouter/')) return 'openrouter';
  
  // Infer from model name
  if (modelLower.includes('claude')) return 'anthropic';
  if (modelLower.includes('gpt') || modelLower.includes('o1') || modelLower.includes('o3')) return 'openai';
  if (modelLower.includes('gemini')) return 'google';
  if (modelLower.includes('grok')) return 'xai';
  if (modelLower.includes('llama') && modelLower.includes('cerebras')) return 'cerebras';
  if (modelLower.includes('deepseek')) return 'deepseek';
  
  // Default to OpenRouter for unknown models (200+ model fallback)
  return 'openrouter';
}
```

### Transform Patterns by Provider

#### OpenAI (Native — No Transform)

```typescript
function transformForOpenAI(body: ChatCompletionRequest): Record<string, unknown> {
  // OpenAI format is our canonical format — pass through
  return {
    ...body,
    model: getModelName(body.model), // Strip provider prefix
    messages: body.messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  };
}
```

#### Anthropic (System Separation + Role Mapping)

```typescript
function transformForAnthropic(body: ChatCompletionRequest): Record<string, unknown> {
  const messages = body.messages;
  
  // Anthropic requires system messages to be separate
  const systemMessages = messages.filter(m => m.role === 'system');
  const otherMessages = messages.filter(m => m.role !== 'system');
  
  const anthropicBody: Record<string, unknown> = {
    model: getModelName(body.model),
    messages: otherMessages.map(m => ({
      role: m.role,
      content: m.content,
    })),
    max_tokens: body.max_tokens ?? 4096, // Required for Anthropic
    stream: body.stream ?? false,
  };
  
  // Combine system messages into single system field
  if (systemMessages.length > 0) {
    anthropicBody.system = systemMessages.map(m => m.content).join('\n\n');
  }
  
  if (body.temperature !== undefined) {
    anthropicBody.temperature = body.temperature;
  }
  
  return anthropicBody;
}

// Response transform: Anthropic → OpenAI format
function transformFromAnthropic(response: AnthropicResponse): OpenAIResponse {
  return {
    id: response.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: response.content[0]?.text ?? '',
      },
      finish_reason: mapFinishReason(response.stop_reason),
    }],
    usage: {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens,
    },
  };
}
```

#### Google Gemini (Full Format Transform — Already Built)

```typescript
// formatters/google.ts (391 lines, fully implemented)
export function transformToGoogle(request: ChatCompletionRequest): GeminiRequest {
  const contents: GeminiContent[] = [];
  const systemParts: GeminiPart[] = [];
  
  for (const message of request.messages) {
    if (message.role === 'system') {
      // System messages become systemInstruction
      systemParts.push({ text: message.content });
    } else {
      // user/assistant → user/model
      contents.push({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      });
    }
  }
  
  const geminiRequest: GeminiRequest = { contents };
  
  if (systemParts.length > 0) {
    geminiRequest.systemInstruction = { parts: systemParts };
  }
  
  // Map generation config
  const generationConfig: GeminiGenerationConfig = {};
  if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
  if (request.max_tokens !== undefined) generationConfig.maxOutputTokens = request.max_tokens;
  
  if (Object.keys(generationConfig).length > 0) {
    geminiRequest.generationConfig = generationConfig;
  }
  
  return geminiRequest;
}

// Response transform: Gemini → OpenAI format
export function transformFromGoogle(response: GeminiResponse, model: string, requestId: string): OpenAIResponse {
  return {
    id: requestId,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: response.candidates.map((candidate, index) => ({
      index,
      message: {
        role: 'assistant' as const,
        content: candidate.content.parts.map(p => p.text).join(''),
      },
      finish_reason: mapFinishReason(candidate.finishReason),
    })),
    usage: response.usageMetadata ? {
      prompt_tokens: response.usageMetadata.promptTokenCount,
      completion_tokens: response.usageMetadata.candidatesTokenCount,
      total_tokens: response.usageMetadata.totalTokenCount,
    } : undefined,
  };
}

// Streaming transform (full implementation in google.ts)
export function createGoogleStreamTransformer(model: string, requestId: string): TransformStream {
  // Converts Gemini SSE → OpenAI SSE format
  // Already fully implemented
}
```

#### OpenAI-Compatible Providers (xAI, Cerebras, DeepSeek, Mistral)

```typescript
// These use OpenAI format with different base URLs
function transformForOpenAICompatible(
  body: ChatCompletionRequest,
  provider: Provider
): Record<string, unknown> {
  return {
    ...body,
    model: getModelName(body.model),
    messages: body.messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  };
}

// Provider configs (already built)
export const PROVIDER_CONFIGS: Record<Provider, ProviderConfig> = {
  openai: { baseUrl: 'https://api.openai.com/v1', authHeader: 'Authorization' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', authHeader: 'x-api-key' },
  google: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', authHeader: 'x-goog-api-key' },
  xai: { baseUrl: 'https://api.x.ai/v1', authHeader: 'Authorization' },
  cerebras: { baseUrl: 'https://api.cerebras.ai/v1', authHeader: 'Authorization' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', authHeader: 'Authorization' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', authHeader: 'Authorization' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', authHeader: 'Authorization' },
};
```

#### Azure OpenAI (Special Case)

```typescript
function transformForAzure(
  body: ChatCompletionRequest,
  deployment: string,
  apiVersion: string
): { body: Record<string, unknown>; endpoint: string } {
  // Azure uses deployment names instead of model names
  // URL format: https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version={version}
  
  return {
    body: {
      ...body,
      model: undefined, // Azure doesn't use model field
      messages: body.messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    },
    endpoint: `https://${userContext.azureResource}.openai.azure.com/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
  };
}
```

---

## 5. Memory Integration (KRONOS)

KRONOS (Knowledge Retrieval and Organized Narrative Ordering System) is our temporal memory architecture. It organizes memories by recency windows for optimal retrieval.

### KRONOS Time Windows

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          KRONOS TIME WINDOWS                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  HOT WINDOW                                                          │   │
│  │  < 15 minutes ago                                                    │   │
│  │  • Currently active conversation context                             │   │
│  │  • Highest retrieval priority                                        │   │
│  │  • Protected from truncation (almost never cut)                      │   │
│  │  • ~1.2x boost in relevance scoring                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                  ↓                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  WORKING WINDOW                                                      │   │
│  │  15 minutes - 4 hours ago                                            │   │
│  │  • Recent session context                                            │   │
│  │  • High retrieval priority                                           │   │
│  │  • Cut before hot, after archive                                     │   │
│  │  • ~1.1x boost in relevance scoring                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                  ↓                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  LONG-TERM WINDOW                                                    │   │
│  │  4 hours - 3 days ago                                                │   │
│  │  • Cross-session memories                                            │   │
│  │  • Standard retrieval priority                                       │   │
│  │  • Cut after archive, before working                                 │   │
│  │  • ~1.0x (baseline) relevance scoring                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                  ↓                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ARCHIVE WINDOW                                                      │   │
│  │  > 3 days ago                                                        │   │
│  │  • Long-term knowledge                                               │   │
│  │  • Lower retrieval priority                                          │   │
│  │  • First to be truncated (after conversation history)                │   │
│  │  • ~0.8x decay in relevance scoring                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Memory Retrieval Algorithm

```typescript
// services/memory-retrieval.ts
interface RetrievalOptions {
  sessionId: string;
  query: string;
  maxChunks: number;
  windows: ('hot' | 'working' | 'longterm' | 'archive')[];
}

interface MemoryChunk {
  id: string;
  content: string;
  embedding: Float32Array;
  timestamp: number;
  window: string;
  score?: number;
}

export async function retrieveMemories(options: RetrievalOptions): Promise<MemoryRetrievalResult> {
  const { sessionId, query, maxChunks, windows } = options;
  
  // 1. Generate query embedding
  const queryEmbedding = await generateEmbedding(query);
  
  // 2. Search across all windows
  const allChunks: MemoryChunk[] = [];
  
  for (const window of windows) {
    const chunks = await searchWindow(sessionId, window, queryEmbedding, maxChunks);
    allChunks.push(...chunks);
  }
  
  // 3. Apply recency weighting
  const now = Date.now();
  const scoredChunks = allChunks.map(chunk => ({
    ...chunk,
    score: calculateWeightedScore(chunk, now),
  }));
  
  // 4. Sort by weighted score (semantic relevance × recency boost)
  scoredChunks.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  
  // 5. Take top N chunks
  const selected = scoredChunks.slice(0, maxChunks);
  
  // 6. Calculate window breakdown for response headers
  const windowBreakdown = {
    hot: selected.filter(c => c.window === 'hot').length,
    working: selected.filter(c => c.window === 'working').length,
    longterm: selected.filter(c => c.window === 'longterm').length,
    archive: selected.filter(c => c.window === 'archive').length,
  };
  
  return {
    chunks: selected,
    tokenCount: countChunksTokens(selected),
    windowBreakdown,
  };
}

function calculateWeightedScore(chunk: MemoryChunk, now: number): number {
  const ageMs = now - chunk.timestamp;
  const semanticScore = chunk.score ?? 0;
  
  // Recency boost factors
  let recencyMultiplier: number;
  if (ageMs < 15 * 60 * 1000) {           // HOT: < 15 min
    recencyMultiplier = 1.2;
  } else if (ageMs < 4 * 60 * 60 * 1000) { // WORKING: 15min - 4h
    recencyMultiplier = 1.1;
  } else if (ageMs < 3 * 24 * 60 * 60 * 1000) { // LONG-TERM: 4h - 3d
    recencyMultiplier = 1.0;
  } else {                                  // ARCHIVE: > 3d
    recencyMultiplier = 0.8;
  }
  
  return semanticScore * recencyMultiplier;
}
```

### Memory Injection (Per-Provider Formatters)

Different AI models respond better to different context formatting:

```typescript
// formatters/memory-injection.ts
export function injectMemoryContext(
  messages: Message[],
  memories: MemoryRetrievalResult,
  provider: Provider
): Message[] {
  if (memories.chunks.length === 0) {
    return messages;
  }
  
  // Format memories based on provider
  const memoryContent = formatMemoriesForProvider(memories.chunks, provider);
  
  // Find or create system message
  const systemIndex = messages.findIndex(m => m.role === 'system');
  
  if (systemIndex >= 0) {
    // Append to existing system message
    const updatedMessages = [...messages];
    updatedMessages[systemIndex] = {
      ...updatedMessages[systemIndex],
      content: `${updatedMessages[systemIndex].content}\n\n${memoryContent}`,
    };
    return updatedMessages;
  } else {
    // Prepend new system message with memories
    return [
      { role: 'system', content: memoryContent },
      ...messages,
    ];
  }
}

function formatMemoriesForProvider(chunks: MemoryChunk[], provider: Provider): string {
  switch (provider) {
    case 'anthropic':
      return formatForClaude(chunks);
    case 'google':
      return formatForGemini(chunks);
    case 'openai':
    case 'xai':
    case 'cerebras':
    case 'deepseek':
    case 'mistral':
    default:
      return formatForGPT(chunks);
  }
}

// Claude responds best to XML tags
function formatForClaude(chunks: MemoryChunk[]): string {
  const memories = chunks.map((c, i) => 
    `<memory index="${i + 1}" age="${formatAge(c.timestamp)}">\n${c.content}\n</memory>`
  ).join('\n\n');
  
  return `<relevant_memories>
The following are relevant memories from previous conversations. Use them to provide context-aware responses.

${memories}
</relevant_memories>`;
}

// GPT and OpenAI-compatible models prefer markdown
function formatForGPT(chunks: MemoryChunk[]): string {
  const memories = chunks.map((c, i) =>
    `### Memory ${i + 1} (${formatAge(c.timestamp)})\n${c.content}`
  ).join('\n\n');
  
  return `## Relevant Memories
The following memories from previous conversations may be relevant:

${memories}

---
Use these memories to provide context-aware responses.`;
}

// Gemini works well with structured text
function formatForGemini(chunks: MemoryChunk[]): string {
  const memories = chunks.map((c, i) =>
    `[Memory ${i + 1} - ${formatAge(c.timestamp)}]\n${c.content}`
  ).join('\n\n');
  
  return `[RELEVANT MEMORIES]
${memories}

[END MEMORIES]
Use these memories for context-aware responses.`;
}

function formatAge(timestamp: number): string {
  const ageMs = Date.now() - timestamp;
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

### Memory Extraction & Storage

```typescript
// services/memory-storage.ts
interface StoreOptions {
  sessionId: string;
  userMessage: string;
  assistantResponse: string;
}

export async function storeMemories(options: StoreOptions): Promise<void> {
  const { sessionId, userMessage, assistantResponse } = options;
  const now = Date.now();
  
  // 1. Generate embeddings for both messages
  const [userEmbedding, assistantEmbedding] = await Promise.all([
    generateEmbedding(userMessage),
    generateEmbedding(assistantResponse),
  ]);
  
  // 2. Create memory chunks
  const chunks: MemoryChunk[] = [
    {
      id: crypto.randomUUID(),
      content: `User: ${userMessage}`,
      embedding: userEmbedding,
      timestamp: now,
      window: 'hot',
    },
    {
      id: crypto.randomUUID(),
      content: `Assistant: ${assistantResponse}`,
      embedding: assistantEmbedding,
      timestamp: now,
      window: 'hot',
    },
  ];
  
  // 3. Store in session's vector vault
  await vectorVault.store(sessionId, chunks);
  
  // 4. Update KRONOS metadata
  await updateKronosMetadata(sessionId, chunks.length);
}

// Memory flag handling
export function shouldStoreMessage(message: Message): boolean {
  // Explicit memory: false flag prevents storage
  if (message.memory === false) {
    return false;
  }
  return true;
}
```

### Core Memory (base.jsonl)

Core memory is foundational knowledge that's injected into every request.

```typescript
// services/core-memory.ts
interface CoreMemoryEntry {
  content: string;
  category?: string;
}

export async function loadCoreMemory(accountId: string): Promise<CoreMemoryEntry[]> {
  // Load from R2 bucket
  const key = `accounts/${accountId}/base.jsonl`;
  const file = await r2.get(key);
  
  if (!file) return [];
  
  const text = await file.text();
  const entries: CoreMemoryEntry[] = text
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
  
  return entries;
}

export function formatCoreMemory(entries: CoreMemoryEntry[]): string {
  if (entries.length === 0) return '';
  
  return `## Core Knowledge
${entries.map(e => `- ${e.content}`).join('\n')}
`;
}
```

---

## 6. Token Tracking

Token counting happens at 4 stages for accurate billing and context management.

### Token Counting Stages

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          TOKEN COUNTING STAGES                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  STAGE 1: PRE-INJECTION                                                     │
│  └─ Count original request messages (what user sent)                        │
│  └─ Used for: baseline comparison                                           │
│                                                                             │
│  STAGE 2: POST-INJECTION                                                    │
│  └─ Count messages + injected memories + core memory                        │
│  └─ Used for: memory token calculation (stage2 - stage1 = memory tokens)    │
│                                                                             │
│  STAGE 3: POST-TRUNCATION                                                   │
│  └─ Count after truncation applied (if needed)                              │
│  └─ Used for: actual context sent to provider                               │
│                                                                             │
│  STAGE 4: OUTPUT                                                            │
│  └─ Count response tokens from provider                                     │
│  └─ Used for: billing (response tokens)                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Token Counting Implementation

```typescript
// services/truncation.ts (already built)

/**
 * Estimate token count for a string.
 * Uses ~4 chars per token as a rough approximation.
 * Conservative (overestimates slightly) for safety.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // ~4 characters per token on average
  // Add 10% buffer for special tokens and encoding overhead
  return Math.ceil(text.length / 4 * 1.1);
}

/**
 * Count tokens in a message (including role overhead)
 */
export function countMessageTokens(message: Message): number {
  // Role token overhead: ~4 tokens for role markers
  const roleOverhead = 4;
  return estimateTokens(message.content) + roleOverhead;
}

/**
 * Count tokens in an array of messages
 */
export function countMessagesTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + countMessageTokens(msg), 0);
}

/**
 * Count tokens in memory chunks
 */
export function countChunksTokens(chunks: MemoryChunk[]): number {
  return chunks.reduce((sum, chunk) => sum + estimateTokens(chunk.content), 0);
}
```

### Model-Specific Tokenizers

```typescript
// services/tokenizers.ts
import { getEncoding } from 'js-tiktoken';

// Cache encoders by model family
const encoderCache = new Map<string, Tiktoken>();

export function countTokensAccurate(text: string, model: string): number {
  const modelLower = model.toLowerCase();
  
  // OpenAI models — use tiktoken for accuracy
  if (modelLower.includes('gpt') || modelLower.includes('o1') || modelLower.includes('o3')) {
    const encoder = getOrCreateEncoder('gpt-4o');
    return encoder.encode(text).length;
  }
  
  // Claude models — use cl100k_base approximation
  if (modelLower.includes('claude')) {
    const encoder = getOrCreateEncoder('claude');
    return encoder.encode(text).length;
  }
  
  // All other models — use estimation
  return estimateTokens(text);
}

function getOrCreateEncoder(family: string): Tiktoken {
  if (!encoderCache.has(family)) {
    // cl100k_base works for GPT-4, Claude approximation
    const encoding = getEncoding('cl100k_base');
    encoderCache.set(family, encoding);
  }
  return encoderCache.get(family)!;
}

// Token tracking record for billing
export interface TokenUsage {
  requestTokens: number;    // Original user request
  memoryTokens: number;     // Injected memories
  truncatedTokens: number;  // Tokens removed by truncation
  responseTokens: number;   // Provider response
  totalBillable: number;    // memory + response (what we charge for)
}
```

---

## 7. Billing Integration

### D1 Schema

```sql
-- accounts table
CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    
    -- Billing
    credits_remaining INTEGER NOT NULL DEFAULT 50000000, -- 50M free tier
    auto_reup_enabled INTEGER NOT NULL DEFAULT 0,
    auto_reup_amount INTEGER DEFAULT 50000000,  -- 50M tokens
    auto_reup_threshold INTEGER DEFAULT 5000000, -- Reup when below 5M
    monthly_cap INTEGER DEFAULT NULL,  -- Optional spending cap
    
    -- Provider keys (encrypted)
    openai_key_encrypted BLOB,
    anthropic_key_encrypted BLOB,
    google_key_encrypted BLOB,
    xai_key_encrypted BLOB,
    cerebras_key_encrypted BLOB,
    openrouter_key_encrypted BLOB
);

-- usage_records table (per-request)
CREATE TABLE usage_records (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    session_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    
    -- Token counts
    request_tokens INTEGER NOT NULL,
    memory_tokens INTEGER NOT NULL,
    response_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,
    
    -- Metadata
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    latency_ms INTEGER,
    truncated INTEGER NOT NULL DEFAULT 0,
    
    -- Indexes for analytics
    FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE INDEX idx_usage_account ON usage_records(account_id);
CREATE INDEX idx_usage_timestamp ON usage_records(timestamp);
CREATE INDEX idx_usage_session ON usage_records(session_id);

-- transactions table (credit purchases, auto-reups)
CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    
    type TEXT NOT NULL, -- 'purchase', 'auto_reup', 'refund'
    amount_cents INTEGER NOT NULL,
    credits_added INTEGER NOT NULL,
    stripe_payment_intent TEXT,
    
    FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE INDEX idx_transactions_account ON transactions(account_id);
```

### Billing Service

```typescript
// services/billing.ts
interface UsageRecord {
  accountId: string;
  sessionId: string;
  requestTokens: number;
  memoryTokens: number;
  responseTokens: number;
  model: string;
  provider: string;
  latencyMs?: number;
  truncated?: boolean;
}

export async function recordUsage(db: D1Database, record: UsageRecord): Promise<void> {
  const totalTokens = record.memoryTokens + record.responseTokens;
  
  // 1. Insert usage record
  await db.prepare(`
    INSERT INTO usage_records (
      id, account_id, session_id, request_tokens, memory_tokens,
      response_tokens, total_tokens, model, provider, latency_ms, truncated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    record.accountId,
    record.sessionId,
    record.requestTokens,
    record.memoryTokens,
    record.responseTokens,
    totalTokens,
    record.model,
    record.provider,
    record.latencyMs ?? null,
    record.truncated ? 1 : 0
  ).run();
  
  // 2. Deduct credits
  await db.prepare(`
    UPDATE accounts 
    SET credits_remaining = credits_remaining - ?
    WHERE id = ?
  `).bind(totalTokens, record.accountId).run();
  
  // 3. Check for auto-reup trigger
  const account = await db.prepare(`
    SELECT credits_remaining, auto_reup_enabled, auto_reup_amount, auto_reup_threshold
    FROM accounts WHERE id = ?
  `).bind(record.accountId).first();
  
  if (
    account?.auto_reup_enabled &&
    account.credits_remaining < (account.auto_reup_threshold ?? 5000000)
  ) {
    await triggerAutoReup(db, record.accountId, account.auto_reup_amount ?? 50000000);
  }
}

async function triggerAutoReup(db: D1Database, accountId: string, amount: number): Promise<void> {
  // 1. Charge Stripe
  const paymentIntent = await chargeStripe(accountId, amount);
  
  // 2. Add credits
  await db.prepare(`
    UPDATE accounts SET credits_remaining = credits_remaining + ? WHERE id = ?
  `).bind(amount, accountId).run();
  
  // 3. Record transaction
  await db.prepare(`
    INSERT INTO transactions (id, account_id, type, amount_cents, credits_added, stripe_payment_intent)
    VALUES (?, ?, 'auto_reup', ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    accountId,
    Math.ceil(amount / 1000000 * 100), // $1 per 1M = $0.000001 per token
    amount,
    paymentIntent.id
  ).run();
}
```

### Pricing Model

```typescript
// Pricing constants
const PRICING = {
  // $1 per 1M memory tokens
  PRICE_PER_MILLION: 100, // cents
  
  // Free tier
  FREE_TIER_TOKENS: 50_000_000, // 50M tokens
  
  // Auto-reup defaults
  DEFAULT_REUP_AMOUNT: 50_000_000,
  DEFAULT_REUP_THRESHOLD: 5_000_000,
  
  // What we charge for
  // - Memory tokens (injected context)
  // - Response tokens (what AI returns)
  // We do NOT charge for request tokens (user's original message)
};

function calculateCost(memoryTokens: number, responseTokens: number): number {
  const totalBillable = memoryTokens + responseTokens;
  return Math.ceil(totalBillable / 1_000_000 * PRICING.PRICE_PER_MILLION);
}
```

---

## 8. Truncation Strategy

### Priority Order (First to Cut → Last to Cut)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       TRUNCATION PRIORITY ORDER                              │
│                     (First to cut → Last to cut)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. OLDEST CONVERSATION HISTORY                                             │
│     └─ Remove oldest user/assistant message pairs                           │
│     └─ EXCEPT: Last user message (always keep)                              │
│                                                                             │
│  2. ARCHIVE WINDOW MEMORIES (3+ days old)                                   │
│     └─ Oldest archive memories first                                        │
│     └─ These are least likely to be contextually relevant                   │
│                                                                             │
│  3. LONG-TERM WINDOW MEMORIES (4h - 3d old)                                 │
│     └─ Older long-term memories first                                       │
│                                                                             │
│  4. WORKING WINDOW MEMORIES (15m - 4h old)                                  │
│     └─ Older working memories first                                         │
│                                                                             │
│  5. HOT WINDOW MEMORIES (< 15 min old) — PROTECTED                          │
│     └─ Only cut as absolute last resort                                     │
│     └─ These are critical for current conversation flow                     │
│                                                                             │
│  ════════════════════════════════════════════════════════════════════════   │
│  NEVER TRUNCATE:                                                            │
│  ════════════════════════════════════════════════════════════════════════   │
│                                                                             │
│  6. CORE MEMORY (base.jsonl)                                                │
│     └─ Foundational knowledge that defines the AI's capabilities            │
│                                                                             │
│  7. SYSTEM PROMPT                                                           │
│     └─ User's explicit instructions for the AI                              │
│                                                                             │
│  8. LAST USER MESSAGE                                                       │
│     └─ What the user actually asked — must always be present                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Truncation Algorithm (Already Implemented)

```typescript
// services/truncation.ts (463 lines, fully implemented)

export function truncateToFit(
  messages: ChatMessage[],
  retrieval: MemoryRetrievalResult | null,
  model: string,
  injectedContextTokens?: number
): TruncationResult {
  const contextWindow = getContextWindow(model);
  const targetTokens = Math.floor(contextWindow * SAFETY_MARGIN); // 95%
  
  // Calculate current token count
  const messageTokens = countMessagesTokens(messages);
  const memoryTokens = injectedContextTokens ?? (retrieval ? countChunksTokens(retrieval.chunks) : 0);
  let totalTokens = messageTokens + memoryTokens;
  
  // Initialize tracking
  const details: TruncationDetails = {
    conversationMessagesRemoved: 0,
    archiveChunksRemoved: 0,
    longtermChunksRemoved: 0,
    workingChunksRemoved: 0,
    hotChunksRemoved: 0,
    originalTokens: totalTokens,
    finalTokens: totalTokens,
    contextWindow,
    targetTokens,
  };
  
  // If under target, no truncation needed
  if (totalTokens <= targetTokens) {
    return { messages, chunks: retrieval?.chunks ?? [], truncated: false, tokensRemoved: 0, truncationDetails: details };
  }
  
  let tokensToRemove = totalTokens - targetTokens;
  let totalTokensRemoved = 0;
  let truncatedMessages = [...messages];
  let truncatedChunks = retrieval?.chunks ? [...retrieval.chunks] : [];
  
  // STEP 1: Remove oldest conversation history (protect system + last user)
  if (tokensToRemove > 0 && truncatedMessages.length > 2) {
    const systemMessages = truncatedMessages.filter(m => m.role === 'system');
    const nonSystemMessages = truncatedMessages.filter(m => m.role !== 'system');
    const lastUserIndex = nonSystemMessages.map(m => m.role).lastIndexOf('user');
    const protectedLastUser = lastUserIndex >= 0 ? nonSystemMessages[lastUserIndex] : null;
    const removableMessages = nonSystemMessages.filter((_, i) => i !== lastUserIndex);
    
    while (tokensToRemove > 0 && removableMessages.length > 0) {
      const removed = removableMessages.shift()!;
      const removedTokens = countMessageTokens(removed);
      tokensToRemove -= removedTokens;
      totalTokensRemoved += removedTokens;
      details.conversationMessagesRemoved++;
    }
    
    truncatedMessages = [...systemMessages, ...removableMessages, ...(protectedLastUser ? [protectedLastUser] : [])];
  }
  
  // STEPS 2-5: Remove memories by KRONOS window priority
  if (tokensToRemove > 0 && truncatedChunks.length > 0) {
    const categorized = categorizeChunks(truncatedChunks);
    
    // Step 2: Archive (3+ days)
    if (tokensToRemove > 0 && categorized.archive.length > 0) {
      const result = truncateChunksOldestFirst(categorized.archive, tokensToRemove);
      categorized.archive = result.remaining;
      tokensToRemove -= result.tokensRemoved;
      totalTokensRemoved += result.tokensRemoved;
      details.archiveChunksRemoved = result.chunksRemoved;
    }
    
    // Step 3: Long-term (4h - 3d)
    if (tokensToRemove > 0 && categorized.longterm.length > 0) {
      const result = truncateChunksOldestFirst(categorized.longterm, tokensToRemove);
      categorized.longterm = result.remaining;
      tokensToRemove -= result.tokensRemoved;
      totalTokensRemoved += result.tokensRemoved;
      details.longtermChunksRemoved = result.chunksRemoved;
    }
    
    // Step 4: Working (15m - 4h)
    if (tokensToRemove > 0 && categorized.working.length > 0) {
      const result = truncateChunksOldestFirst(categorized.working, tokensToRemove);
      categorized.working = result.remaining;
      tokensToRemove -= result.tokensRemoved;
      totalTokensRemoved += result.tokensRemoved;
      details.workingChunksRemoved = result.chunksRemoved;
    }
    
    // Step 5: Hot (< 15min) — last resort
    if (tokensToRemove > 0 && categorized.hot.length > 0) {
      const result = truncateChunksOldestFirst(categorized.hot, tokensToRemove);
      categorized.hot = result.remaining;
      tokensToRemove -= result.tokensRemoved;
      totalTokensRemoved += result.tokensRemoved;
      details.hotChunksRemoved = result.chunksRemoved;
    }
    
    // Rebuild chunks array
    truncatedChunks = [...categorized.hot, ...categorized.working, ...categorized.longterm, ...categorized.archive]
      .sort((a, b) => b.timestamp - a.timestamp);
  }
  
  details.finalTokens = details.originalTokens - totalTokensRemoved;
  
  return {
    messages: truncatedMessages,
    chunks: truncatedChunks,
    truncated: totalTokensRemoved > 0,
    tokensRemoved: totalTokensRemoved,
    truncationDetails: details,
  };
}
```

### Truncation Response Headers

```typescript
// Response headers when truncation occurs
const headers = {
  // Boolean flag
  'X-MemoryRouter-Truncated': 'true',
  
  // Detailed breakdown: "conv:3,archive:5,longterm:2"
  'X-MemoryRouter-Truncated-Details': buildTruncationHeader(details),
  
  // Total tokens removed
  'X-MemoryRouter-Tokens-Removed': String(details.tokensRemoved),
};

// Also included in response body for non-streaming
const responseWithTruncation = {
  ...originalResponse,
  _memoryrouter: {
    truncated: true,
    tokensRemoved: details.tokensRemoved,
    details: {
      conversationMessagesRemoved: details.conversationMessagesRemoved,
      archiveChunksRemoved: details.archiveChunksRemoved,
      longtermChunksRemoved: details.longtermChunksRemoved,
      workingChunksRemoved: details.workingChunksRemoved,
      hotChunksRemoved: details.hotChunksRemoved,
    },
  },
};
```

---

## 9. Context Window Management

### Model Context Window Registry

```typescript
// services/truncation.ts (already built)
const CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4-turbo-preview': 128000,
  'gpt-4': 8192,
  'gpt-4-32k': 32768,
  'gpt-3.5-turbo': 16384,
  'gpt-3.5-turbo-16k': 16384,
  'o1': 200000,
  'o1-preview': 128000,
  'o1-mini': 128000,
  'o3-mini': 200000,
  
  // Anthropic
  'claude-3-opus': 200000,
  'claude-3-opus-20240229': 200000,
  'claude-3-sonnet': 200000,
  'claude-3-sonnet-20240229': 200000,
  'claude-3-haiku': 200000,
  'claude-3-haiku-20240307': 200000,
  'claude-3.5-sonnet': 200000,
  'claude-3-5-sonnet-20240620': 200000,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-5-haiku-20241022': 200000,
  'claude-sonnet-4-20250514': 200000,
  'claude-opus-4-20250514': 200000,
  
  // Google
  'gemini-pro': 1000000,
  'gemini-1.5-pro': 1000000,
  'gemini-1.5-flash': 1000000,
  'gemini-flash': 1000000,
  'gemini-2.0-flash': 1000000,
  
  // xAI
  'grok-2': 131072,
  'grok-2-mini': 131072,
  'grok-beta': 131072,
  
  // Cerebras (Llama)
  'llama-3.3-70b': 128000,
  'llama3.1-8b': 128000,
  'llama3.1-70b': 128000,
  
  // Meta Llama (OpenRouter)
  'meta-llama/llama-3.1-8b-instruct': 128000,
  'meta-llama/llama-3.1-70b-instruct': 128000,
  'meta-llama/llama-3.1-405b-instruct': 128000,
  
  // Mistral (OpenRouter)
  'mistral/mistral-large': 128000,
  'mistral/mistral-medium': 32000,
  'mistral/mistral-small': 32000,
};

const DEFAULT_CONTEXT_WINDOW = 8192;
const SAFETY_MARGIN = 0.95; // Target 95% of window
```

### Dynamic Context Allocation

```typescript
// Context budget allocation
function allocateContextBudget(model: string): ContextBudget {
  const total = getContextWindow(model);
  const safeTotal = Math.floor(total * SAFETY_MARGIN);
  
  return {
    total: safeTotal,
    
    // Fixed allocations (guaranteed)
    systemPrompt: Math.min(8000, Math.floor(safeTotal * 0.1)),     // 10% or 8K
    coreMemory: Math.min(16000, Math.floor(safeTotal * 0.15)),    // 15% or 16K
    lastUserMessage: Math.min(4000, Math.floor(safeTotal * 0.05)), // 5% or 4K
    
    // Dynamic allocations (fill remaining)
    retrievedMemory: Math.floor(safeTotal * 0.35), // 35%
    conversationHistory: Math.floor(safeTotal * 0.35), // 35%
  };
}

interface ContextBudget {
  total: number;
  systemPrompt: number;
  coreMemory: number;
  lastUserMessage: number;
  retrievedMemory: number;
  conversationHistory: number;
}
```

---

## 10. Why Not Existing Packages

### LiteLLM

| Aspect | LiteLLM | MemoryRouter |
|--------|---------|--------------|
| **Language** | Python only | TypeScript (edge-native) |
| **Memory** | No memory layer | First-class memory with KRONOS |
| **Billing** | No billing | Per-request usage tracking |
| **Truncation** | Manual | Automatic priority-based |
| **Architecture** | Library | Proxy (no code changes) |
| **Deployment** | Server required | Cloudflare Workers (edge) |

### unified-llm (@unified-llm/core)

| Aspect | unified-llm | MemoryRouter |
|--------|-------------|--------------|
| **Memory** | Add-on via adapters | Baked into core pipeline |
| **Billing** | Not included | D1 + Stripe integrated |
| **Truncation** | Not included | KRONOS-aware truncation |
| **Token tracking** | Basic | 4-stage tracking for billing |
| **User model** | Single-user | Multi-tenant with sessions |

### Why We Build Our Own

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    WHY MEMORYROUTER IS DIFFERENT                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  EXISTING TOOLS (LiteLLM, unified-llm, Langchain):                          │
│  ├─ Provider routing        ✓                                               │
│  ├─ Response normalization  ✓                                               │
│  ├─ Memory integration      ❌ (bolted on, not baked in)                    │
│  ├─ Billing integration     ❌                                              │
│  ├─ Smart truncation        ❌                                              │
│  └─ Zero-code deployment    ❌ (all require code changes)                   │
│                                                                             │
│  MEMORYROUTER:                                                              │
│  ├─ Provider routing        ✓ (10+ providers)                               │
│  ├─ Response normalization  ✓ (OpenAI format canonical)                     │
│  ├─ Memory integration      ✓ (KRONOS, core memory, session memory)         │
│  ├─ Billing integration     ✓ (D1 + Stripe, per-request)                    │
│  ├─ Smart truncation        ✓ (priority-based, KRONOS-aware)                │
│  └─ Zero-code deployment    ✓ (ONE URL CHANGE)                              │
│                                                                             │
│  THE DIFFERENCE:                                                            │
│  Everything is unified into a single pipeline. Not separate concerns        │
│  that you wire together. Memory affects truncation affects billing          │
│  affects routing. They're inseparable.                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Implementation Plan

### Week 1: Core Transform Infrastructure

| Day | Task | Status |
|-----|------|--------|
| M | Set up Hono router structure, auth middleware | 📋 |
| T | Implement all provider transforms (OpenAI, Anthropic, Google, xAI, Cerebras) | 📋 |
| W | Add OpenRouter fallback, model detection | 📋 |
| Th | Streaming support for all providers | 📋 |
| F | Integration tests for provider transforms | 📋 |

**Deliverables:**
- All provider transforms working
- Streaming support
- Basic request → response flow

### Week 2: Memory Integration

| Day | Task | Status |
|-----|------|--------|
| M | Memory retrieval service (KRONOS windows) | 📋 |
| T | Memory injection formatters (per-provider) | 📋 |
| W | Memory extraction from responses | 📋 |
| Th | Vector storage integration (Cloudflare Vectorize) | 📋 |
| F | Core memory loading (base.jsonl) | 📋 |

**Deliverables:**
- Full memory pipeline working
- KRONOS retrieval with recency weighting
- Per-provider memory formatting

### Week 2-3: Truncation Strategy

| Day | Task | Status |
|-----|------|--------|
| M | Context window registry (all models) | ✅ Built |
| T | Token counting at all 4 stages | ✅ Built |
| W | Priority-based truncation algorithm | ✅ Built |
| Th | Truncation headers + response metadata | ✅ Built |
| F | Edge cases (huge messages, empty memories) | 📋 |

**Deliverables:**
- Smart truncation working
- Headers communicating truncation status
- All edge cases handled

### Week 3: Billing Integration

| Day | Task | Status |
|-----|------|--------|
| M | D1 schema deployment | 📋 |
| T | Usage recording service | 📋 |
| W | Credit deduction logic | 📋 |
| Th | Auto-reup implementation | 📋 |
| F | Stripe webhook integration | 📋 |

**Deliverables:**
- Full billing pipeline
- Per-request usage records
- Auto-reup working

### Week 4: Testing + Optimization

| Day | Task | Status |
|-----|------|--------|
| M | End-to-end integration tests | 📋 |
| T | Performance optimization (caching, batching) | 📋 |
| W | Error handling + edge cases | 📋 |
| Th | Documentation + API reference | 📋 |
| F | Production deployment checklist | 📋 |

**Deliverables:**
- Full test coverage
- Production-ready deployment
- API documentation

---

## 12. What's Already Built

### truncation.ts (463 lines) ✅

**Location:** `/workers/src/services/truncation.ts`

**Features:**
- Context window registry (35+ models)
- Token estimation (~4 chars/token + 10% buffer)
- Message token counting (including role overhead)
- Memory chunk token counting
- Priority-based truncation algorithm:
  1. Oldest conversation history
  2. Archive window (3+ days)
  3. Long-term window (4h-3d)
  4. Working window (15m-4h)
  5. Hot window (<15min)
- Truncation header builder
- Memory retrieval result rebuilder

**Key Functions:**
```typescript
estimateTokens(text: string): number
countMessageTokens(message: ChatMessage): number
countMessagesTokens(messages: ChatMessage[]): number
countChunksTokens(chunks: MemoryChunk[]): number
getContextWindow(model: string): number
truncateToFit(messages, retrieval, model, injectedTokens?): TruncationResult
buildTruncationHeader(details: TruncationDetails): string
rebuildRetrievalResult(original, truncatedChunks): MemoryRetrievalResult
```

### providers.ts ✅

**Location:** `/workers/src/services/providers.ts`

**Features:**
- Provider detection from model name
- Provider configs (baseUrl, authHeader)
- Transform functions:
  - `transformForAnthropic()` — system separation, role mapping
  - `transformForOpenAI()` — passthrough
  - `forwardToProvider()` — routes to correct endpoint
- Embedding generation (Cloudflare Workers AI, OpenAI, Modal)
- Response content extraction
- Streaming response capture

**Key Functions:**
```typescript
detectProvider(model: string): Provider
getModelName(model: string): string
forwardToProvider(provider, apiKey, body): Promise<Response>
generateEmbedding(text, apiKey, model?, config?): Promise<Float32Array>
extractResponseContent(provider, responseBody): string
captureStreamedResponse(response, provider): Promise<string>
```

### passthrough.ts (559 lines) ✅

**Location:** `/workers/src/routes/passthrough.ts`

**Features:**
- 8 pass-through endpoints:
  - `POST /embeddings`
  - `POST /audio/transcriptions`
  - `POST /audio/translations`
  - `POST /audio/speech`
  - `POST /images/generations`
  - `POST /images/edits`
  - `POST /images/variations`
  - `POST /completions` (legacy)
- Provider-specific auth header building
- Multipart form handling (audio, images)
- JSON body handling (embeddings, speech, completions)
- Streaming support for completions
- Error handling with helpful hints

### formatters/google.ts (391 lines) ✅

**Location:** `/workers/src/formatters/google.ts`

**Features:**
- Full Gemini request transform:
  - `messages` → `contents` + `systemInstruction`
  - `assistant` → `model` role
  - `max_tokens` → `generationConfig.maxOutputTokens`
- Full Gemini response transform:
  - `candidates` → `choices`
  - `usageMetadata` → `usage`
  - Finish reason mapping
- Streaming transform:
  - `createGoogleStreamTransformer()` — SSE format conversion
  - Handles partial chunks, buffering, [DONE] signal

**Key Functions:**
```typescript
transformToGoogle(request: ChatCompletionRequest): GeminiRequest
transformFromGoogle(response: GeminiResponse, model, requestId?): OpenAIResponse
transformStreamChunkFromGoogle(chunk, model, requestId, isFirst): OpenAIStreamResponse | null
createGoogleStreamTransformer(model, requestId): TransformStream
extractGoogleResponseContent(response: GeminiResponse): string
```

---

## 13. Open Questions (Resolved)

### 1. Token counting: tiktoken for OpenAI, estimates for others?

**RESOLVED: YES**

- **OpenAI models:** Use `js-tiktoken` with `cl100k_base` encoding for accurate counts
- **Anthropic models:** Use `cl100k_base` as approximation (similar tokenization)
- **All others:** Use character-based estimation (~4 chars/token + 10% buffer)

Rationale: Accuracy matters most for billing. OpenAI/Anthropic are the highest-volume providers, so we use accurate counting there. Estimation is conservative (slightly overestimates) for safety.

### 2. Truncation notification: header + response field?

**RESOLVED: BOTH**

Headers (always):
```
X-MemoryRouter-Truncated: true
X-MemoryRouter-Truncated-Details: conv:3,archive:5,longterm:2
X-MemoryRouter-Tokens-Removed: 15420
```

Response body (non-streaming only):
```json
{
  "choices": [...],
  "_memoryrouter": {
    "truncated": true,
    "tokensRemoved": 15420,
    "details": {
      "conversationMessagesRemoved": 3,
      "archiveChunksRemoved": 5,
      "longtermChunksRemoved": 2
    }
  }
}
```

Rationale: Headers work for streaming. Body provides richer data for non-streaming. Both for maximum flexibility.

### 3. Billing granularity: per-request records?

**RESOLVED: YES**

Every request creates a `usage_records` row with:
- request_tokens
- memory_tokens
- response_tokens
- total_tokens
- model
- provider
- latency_ms
- truncated

Rationale: Per-request granularity enables:
- Accurate per-session billing
- Usage analytics
- Debugging
- Future features (cost allocation per conversation)

### 4. Core memory: inject every request?

**RESOLVED: YES**

Core memory (base.jsonl) is injected into EVERY request, always at the start of the system prompt.

Rationale:
- Core memory defines the AI's foundational knowledge
- It should always be present for consistent behavior
- It's typically small (<5K tokens)
- Users expect consistent personality/knowledge

The truncation algorithm will NEVER cut core memory — it's protected alongside system prompts.

---

## Appendix A: API Key Format

MemoryRouter uses a structured API key format:

```
mk_{account_id}_{session_id}

Example: mk_acct_abc123_sess_xyz789
```

**Components:**
- `mk_` — MemoryRouter key prefix
- `{account_id}` — Links to billing/credits
- `{session_id}` — Links to memory vault (can be user ID, chat ID, etc.)

**Parsing:**
```typescript
function parseMemoryRouterKey(key: string): { accountId: string; sessionId: string } | null {
  if (!key.startsWith('mk_')) return null;
  const parts = key.slice(3).split('_');
  if (parts.length < 2) return null;
  
  return {
    accountId: parts[0],
    sessionId: parts.slice(1).join('_'), // Session ID can contain underscores
  };
}
```

---

## Appendix B: Response Headers Reference

| Header | Description | Example |
|--------|-------------|---------|
| `X-MemoryRouter-Request-Tokens` | Original request token count | `1542` |
| `X-MemoryRouter-Memory-Tokens` | Injected memory token count | `8240` |
| `X-MemoryRouter-Response-Tokens` | Response token count | `892` |
| `X-MemoryRouter-Total-Tokens` | Total billable tokens | `9132` |
| `X-MemoryRouter-Truncated` | Whether truncation occurred | `true` |
| `X-MemoryRouter-Truncated-Details` | What was truncated | `conv:3,archive:5` |
| `X-MemoryRouter-Tokens-Removed` | Tokens removed by truncation | `15420` |
| `X-MemoryRouter-Model` | Model used | `gpt-4o` |
| `X-MemoryRouter-Provider` | Provider routed to | `openai` |
| `X-MemoryRouter-Latency-Ms` | Total request latency | `1234` |

---

## Appendix C: Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `invalid_api_key` | 401 | API key format invalid or not found |
| `insufficient_credits` | 402 | Account has no credits remaining |
| `no_provider_key` | 400 | No API key configured for requested provider |
| `provider_error` | 502 | Upstream provider returned an error |
| `rate_limited` | 429 | Too many requests |
| `context_overflow` | 400 | Message too large even after truncation |
| `invalid_model` | 400 | Model not supported |

---

*MemoryRouter Transform Module Specification v1.0*  
*The master plan for building persistent memory into any AI application.*  
*One URL change. Zero code migration. Memory forever.* 🧠⚡
