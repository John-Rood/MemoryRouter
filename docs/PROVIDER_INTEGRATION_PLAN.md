# Provider Integration Plan: Preserving the Core

## 🛡️ THE CORE (Non-Negotiable)

What we have NOW that must be preserved:

```
✅ 55ms overhead for full memory processing
✅ Auth validation
✅ Vector search (DO + D1 fallback)
✅ Buffer fetch (bundled with search)
✅ Context injection
✅ Context-window-aware truncation
✅ 100% success rate on memory operations
```

**Rule #1: CORE COMES FIRST. Any changes must preserve these numbers.**

---

## 📊 Research: Build vs. Model from Library

### Option A: Use a Library (unified-llm, multi-llm-ts, abso-ai, etc.)

**Pros:**
- Less code to write
- Community maintained
- Handles edge cases we haven't hit yet

**Cons:**
- ⚠️ **Dependency risk** — library updates could break our core
- ⚠️ **Black box** — hard to debug when things break
- ⚠️ **Feature mismatch** — libraries optimize for different use cases (chat, not memory)
- ⚠️ **Streaming differences** — each library handles streaming differently
- ⚠️ **Bundle size** — adds weight to our edge worker

**Verdict:** TOO RISKY for our core. These libraries are designed for general chat, not memory injection.

---

### Option B: Build Our Own (Provider Packages Directly)

**Pros:**
- ✅ Full control
- ✅ No dependency surprises
- ✅ Optimized for OUR use case (memory injection)
- ✅ Can preserve exact request/response format
- ✅ Easier to debug

**Cons:**
- More initial work
- Need to handle provider-specific quirks
- Maintenance burden for new models

**Verdict:** SAFER. We control the code, we control the risk.

---

## 🔍 Current State Analysis

We ALREADY have formatters for:

| Provider | Request Transform | Response Transform | Streaming | Status |
|----------|-------------------|-------------------|-----------|--------|
| OpenAI | ✅ Native | ✅ Native | ✅ Native | **WORKING** |
| Anthropic | ✅ Custom | ✅ Custom | ✅ Custom | **WORKING** |
| Google/Gemini | ✅ Custom | ✅ Custom | ✅ Custom | **WORKING** |
| OpenRouter | ✅ OpenAI-compat | ✅ OpenAI-compat | ✅ OpenAI-compat | **WORKING** |
| xAI/Grok | ✅ OpenAI-compat | ✅ OpenAI-compat | ✅ OpenAI-compat | **WORKING** |
| Cerebras | ✅ OpenAI-compat | ✅ OpenAI-compat | ✅ OpenAI-compat | **WORKING** |

**The infrastructure already exists.** The issue is it's scattered and inconsistent.

---

## 🎯 Target Providers

| Provider | API Format | Streaming Format | Complexity |
|----------|------------|------------------|------------|
| 1. OpenAI | Native | SSE (OpenAI) | Low |
| 2. Anthropic | Custom | SSE (Custom) | Medium |
| 3. Google/Gemini | Custom | SSE (Custom) | Medium |
| 4. xAI/Grok | OpenAI-compat | SSE (OpenAI) | Low |
| 5. Cerebras | OpenAI-compat | SSE (OpenAI) | Low |
| 6. OpenRouter | OpenAI-compat | SSE (OpenAI) | Low |

**Key insight:** 4 of 6 providers are OpenAI-compatible. Only Anthropic and Gemini need custom formatters.

---

## 🏗️ Proposed Architecture

### Layer 1: Core Memory Engine (UNTOUCHED)
```
┌─────────────────────────────────────────────────┐
│              CORE MEMORY ENGINE                 │
│  - DO/D1 vector search                          │
│  - Buffer sync                                  │
│  - Truncation                                   │
│  - Context formatting                           │
│                                                 │
│  OUTPUT: augmentedMessages[], memoryMetadata    │
└─────────────────────────────────────────────────┘
                      │
                      ▼
```

### Layer 2: Provider Adapter (NEW - Clean Interface)
```
┌─────────────────────────────────────────────────┐
│            PROVIDER ADAPTER LAYER               │
│                                                 │
│  INPUT: augmentedMessages[], model, options     │
│                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ OpenAI   │ │Anthropic │ │ Google   │        │
│  │ Adapter  │ │ Adapter  │ │ Adapter  │        │
│  └──────────┘ └──────────┘ └──────────┘        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │   xAI    │ │ Cerebras │ │OpenRouter│        │
│  │ Adapter  │ │ Adapter  │ │ Adapter  │        │
│  └──────────┘ └──────────┘ └──────────┘        │
│                                                 │
│  OUTPUT: ProviderResponse (OpenAI format)       │
└─────────────────────────────────────────────────┘
```

### Each Adapter Implements:
```typescript
interface ProviderAdapter {
  name: string;
  
  // Transform OpenAI-format request → provider format
  transformRequest(req: OpenAIRequest): ProviderRequest;
  
  // Transform provider response → OpenAI format
  transformResponse(res: ProviderResponse): OpenAIResponse;
  
  // Handle streaming (return OpenAI-format SSE)
  transformStream(stream: ReadableStream): ReadableStream;
  
  // Build the fetch request
  buildRequest(transformed: ProviderRequest, apiKey: string): Request;
}
```

---

## 📋 Implementation Plan

### Phase 1: Refactor Without Changing Behavior (Day 1)

**Goal:** Extract current provider logic into clean adapter files WITHOUT changing functionality.

1. Create `src/adapters/` directory
2. Create base `ProviderAdapter` interface
3. Extract OpenAI logic → `adapters/openai.ts`
4. Extract Anthropic logic → `adapters/anthropic.ts`
5. Extract Google logic → `adapters/google.ts`
6. Create OpenAI-compat base → `adapters/openai-compat.ts`
7. xAI, Cerebras, OpenRouter extend OpenAI-compat

**Test:** All existing tests pass. Latency unchanged.

### Phase 2: Standardize Response Format (Day 2)

**Goal:** All providers return OpenAI-format responses.

1. Ensure Anthropic adapter returns OpenAI format
2. Ensure Google adapter returns OpenAI format
3. Standardize streaming SSE format
4. Add comprehensive tests for each provider

**Test:** Same response structure regardless of provider.

### Phase 3: Add Missing Providers (Day 3)

**Goal:** Fill any gaps in the 6 target providers.

1. Verify xAI/Grok works correctly
2. Verify Cerebras works correctly  
3. Add any missing model detection
4. Test all providers with real API calls

**Test:** All 6 providers working, same latency.

### Phase 4: Error Handling & Fallbacks (Day 4)

**Goal:** Graceful degradation.

1. Provider-specific error parsing
2. Rate limit handling
3. Timeout handling
4. Optional fallback to different provider

**Test:** Errors return meaningful messages, don't crash core.

---

## ⚠️ Risk Mitigation

### What Could Break the Core:

| Risk | Mitigation |
|------|------------|
| New code adds latency | Benchmark before/after each change |
| Streaming breaks | Keep streaming path separate, test thoroughly |
| Memory injection skipped | Add assertion that memory was injected |
| Provider error crashes worker | Wrap all provider calls in try/catch |

### Safety Checks:

```typescript
// Add to every request
if (!augmentedMessages.some(m => m.role === 'system' && m.content.includes('Memory'))) {
  console.error('[SAFETY] Memory injection may have failed!');
}
```

---

## 📁 Proposed File Structure

```
src/
├── adapters/
│   ├── index.ts           # Export all adapters, getAdapter()
│   ├── base.ts            # ProviderAdapter interface
│   ├── openai.ts          # OpenAI native
│   ├── openai-compat.ts   # Base for OpenAI-compatible providers
│   ├── anthropic.ts       # Anthropic Claude
│   ├── google.ts          # Google Gemini
│   ├── xai.ts             # xAI Grok (extends openai-compat)
│   ├── cerebras.ts        # Cerebras (extends openai-compat)
│   └── openrouter.ts      # OpenRouter (extends openai-compat)
├── services/
│   ├── providers.ts       # Provider detection (keep)
│   └── ...
└── routes/
    └── chat.ts            # Use adapters instead of inline transforms
```

---

## ✅ Success Criteria

1. **Latency:** mr_overhead stays ≤20ms on warm DO
2. **Reliability:** 100% success rate maintained
3. **Compatibility:** All 6 providers work with memory injection
4. **Response format:** All providers return OpenAI-format responses
5. **Streaming:** All providers stream correctly
6. **No regressions:** Existing tests still pass

---

## 🚀 Recommendation

**Build our own adapters using provider SDKs/APIs directly.**

Reasons:
1. We already have 80% of the code written
2. Libraries add unnecessary complexity and risk
3. Our use case (memory injection) is unique
4. Full control = full confidence

**Timeline:** 4 days to clean implementation, fully tested.

---

*Written: 2026-02-02 | Core comes first. Always.*
