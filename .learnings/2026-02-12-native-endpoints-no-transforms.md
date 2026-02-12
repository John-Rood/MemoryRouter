# Native Endpoints, No Transforms — Learnings from 2026-02-12

## What Happened
MemoryRouter was transforming Anthropic and Google requests/responses through an OpenAI compatibility layer. This stripped thinking blocks, tool_use, metadata, and many provider-specific fields.

## Root Cause
The `/v1/chat/completions` endpoint tried to be a universal translator:
- `transformForAnthropic()` converted OpenAI format → Anthropic, but only passed 6 fields (dropped thinking, tools, top_k, top_p, metadata, etc.)
- `transformAnthropicToOpenAI()` converted response back, only extracting `type: 'text'` blocks — thinking blocks were completely nuked
- Google had the same pattern with `transformToGoogle()` / `transformFromGoogle()`

## The Fix
**Native endpoints, no transforms:**
- `/v1/chat/completions` → OpenAI-compatible providers ONLY (openai, openrouter, xai, cerebras, deepseek, azure, ollama, mistral)
- `/v1/messages` → Anthropic native pass-through (full body forwarded, full response returned untouched)
- `/v1/models/{model}:generateContent` → Google native pass-through

Each endpoint: inject memory into the provider's native system field → forward the FULL body → return the FULL response → extract text in background for storage only.

## Prevention
- **Never transform between provider formats.** MemoryRouter is a wrapper that ADDS memory, never subtracts anything.
- **Response body is sacred.** Memory metadata goes in HTTP headers only.
- **New providers get their own native endpoint.** Don't force them through an OpenAI shim.
