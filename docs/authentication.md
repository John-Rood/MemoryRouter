# Authentication

MemoryRouter uses a two-key system: your **Memory Key** authenticates with MemoryRouter, and your **Provider Keys** authenticate with AI providers.

---

## Memory Key (`mk_xxx`)

Your Memory Key is your API key for MemoryRouter. It identifies your memory vault and tracks usage.

**Get your key**: [app.memoryrouter.ai](https://app.memoryrouter.ai) → API Keys

### Usage

**Standard (Authorization header):**
```bash
curl -X POST https://api.memoryrouter.ai/v1/chat/completions \
  -H "Authorization: Bearer mk_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"model": "openai/gpt-4o", "messages": [...]}'
```

**Anthropic SDK style (x-api-key):**
```bash
curl -X POST https://api.memoryrouter.ai/v1/chat/completions \
  -H "x-api-key: mk_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"model": "anthropic/claude-3-5-sonnet", "messages": [...]}'
```

---

## Provider Keys

Your actual API keys for OpenAI, Anthropic, Google, etc. Two options:

### Option 1: Store in Dashboard (Recommended)

1. Go to [app.memoryrouter.ai](https://app.memoryrouter.ai) → Settings
2. Add your provider keys (encrypted at rest)
3. Just use your Memory Key — MemoryRouter handles the rest

```python
client = OpenAI(
    api_key="mk_xxx",
    base_url="https://api.memoryrouter.ai/v1"
)
```

### Option 2: Pass-Through Mode (BYOK)

Send your provider key with each request:

**Using X-Memory-Key + Authorization:**
```bash
curl -X POST https://api.memoryrouter.ai/v1/chat/completions \
  -H "X-Memory-Key: mk_xxxxxxxxxxxxxxxx" \
  -H "Authorization: Bearer sk-your-openai-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "openai/gpt-4o", "messages": [...]}'
```

**Python example:**
```python
client = OpenAI(
    api_key="sk-your-openai-key",  # Goes to provider
    base_url="https://api.memoryrouter.ai/v1",
    default_headers={
        "X-Memory-Key": "mk_xxxxxxxxxxxxxxxx"  # MemoryRouter auth
    }
)
```

---

## Authentication Headers Summary

| Header | Purpose | When to Use |
|--------|---------|-------------|
| `Authorization: Bearer mk_xxx` | Memory Key auth | Standard usage |
| `x-api-key: mk_xxx` | Memory Key auth | Anthropic SDK compatibility |
| `X-Memory-Key: mk_xxx` | Memory Key auth | Pass-through mode |
| `Authorization: Bearer sk-xxx` | Provider key | Pass-through mode |
| `X-Provider-Key: sk-xxx` | Provider key | Alternative pass-through |

---

## Multiple Memory Keys

Create separate keys for different apps or users. Each key has isolated memory.

```python
# App 1
app1_client = OpenAI(api_key="mk_app1_xxx", base_url="https://api.memoryrouter.ai/v1")

# App 2 (completely separate memory)
app2_client = OpenAI(api_key="mk_app2_xxx", base_url="https://api.memoryrouter.ai/v1")
```

---

## Error Responses

**401 - Missing authentication:**
```json
{"error": "Missing or invalid authentication", "hint": "Use: Authorization: Bearer mk_xxx"}
```

**400 - Missing provider key:**
```json
{"error": "No API key configured for provider: openai", "hint": "Add your openai API key in settings, or pass X-Provider-Key header"}
```
