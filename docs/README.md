# MemoryRouter API Documentation

**Your AI remembers everything.** Change one URL, get persistent memory across all your AI conversations.

```python
# Before: Stateless AI with amnesia
client = OpenAI(api_key="sk-xxx")

# After: AI with perfect memory
client = OpenAI(api_key="mk_xxx", base_url="https://api.memoryrouter.ai/v1")
```

---

## Quick Start (5 minutes)

### Step 1: Get Your Memory Key

1. Go to [app.memoryrouter.ai](https://app.memoryrouter.ai)
2. Sign in with Google
3. Add your OpenAI/Anthropic API key(s) in Settings
4. Copy your Memory Key (`mk_xxxxxxxxxxxxxxxx`)

### Step 2: Swap One Line

**Python (OpenAI SDK):**
```python
from openai import OpenAI

client = OpenAI(
    api_key="mk_xxxxxxxxxxxxxxxx",  # Your Memory Key
    base_url="https://api.memoryrouter.ai/v1"
)

response = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "My name is Alice"}]
)
print(response.choices[0].message.content)
```

**JavaScript:**
```javascript
import OpenAI from 'openai';

const client = new OpenAI({
    apiKey: 'mk_xxxxxxxxxxxxxxxx',
    baseURL: 'https://api.memoryrouter.ai/v1'
});

const response = await client.chat.completions.create({
    model: 'openai/gpt-4o',
    messages: [{ role: 'user', content: 'My name is Alice' }]
});
```

**curl:**
```bash
curl -X POST https://api.memoryrouter.ai/v1/chat/completions \
  -H "Authorization: Bearer mk_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "My name is Alice"}]
  }'
```

### Step 3: Watch the Memory Work

```python
# First request - introduce yourself
client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "My name is Alice and I love hiking"}]
)

# Later (even days later) - the AI remembers
response = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "What are my hobbies?"}]
)
# Response: "Based on our previous conversation, you mentioned you love hiking!"
```

---

## How It Works

MemoryRouter sits between your app and your AI provider:
1. **Retrieves** relevant past conversations using semantic search
2. **Injects** context into your prompt automatically  
3. **Forwards** to your chosen AI provider (OpenAI, Anthropic, etc.)
4. **Stores** new conversations for future retrieval
5. **Returns** the response (100% OpenAI-compatible format)

---

## Supported Models

| Provider | Example Models | Prefix |
|----------|---------------|--------|
| OpenAI | gpt-4o, gpt-4o-mini, o1 | `openai/` |
| Anthropic | claude-3-5-sonnet, claude-3-opus | `anthropic/` |
| Google | gemini-1.5-pro, gemini-2.0-flash | `google/` |
| xAI | grok-beta | `xai/` |
| DeepSeek | deepseek-chat | `deepseek/` |

---

## Documentation

- **[Authentication](./authentication.md)** — Headers, key types, pass-through mode
- **[API Reference](./api-reference.md)** — All endpoints with examples
- **[Code Examples](./examples.md)** — Python, JavaScript, curl, and more

---

## Links

- **Dashboard**: [app.memoryrouter.ai](https://app.memoryrouter.ai)
- **API**: `https://api.memoryrouter.ai/v1`

---

*MemoryRouter — Same memory, any model.* 🧠
