# MemoryRouter API

**Model-agnostic AI memory layer** — Same memory, any model.

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment (copy and edit)
cp .env.example .env
# Add your API keys to .env

# Run development server
npm run dev

# Build for production
npm run build
npm start
```

## API Usage

### Authentication
All requests require a Memory Key in the Authorization header:
```
Authorization: Bearer mk_xxx
```

### Chat Completions
OpenAI-compatible endpoint with automatic memory injection.

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mk_test_key" \
  -d '{
    "model": "anthropic/claude-3-opus",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

### Supported Models
Use OpenRouter-style model strings:
- `openai/gpt-4` → Routes to OpenAI
- `anthropic/claude-3-opus` → Routes to Anthropic
- `meta-llama/llama-3-70b` → Routes via OpenRouter
- `gpt-4`, `claude-3-opus` → Auto-detected

### Memory Control Headers
| Header | Values | Description |
|--------|--------|-------------|
| `X-Memory-Mode` | `auto`, `read`, `write`, `off` | Control memory read/write |
| `X-Memory-Store` | `true`, `false` | Store this request's content |
| `X-Memory-Store-Response` | `true`, `false` | Store the response |
| `X-Memory-Context-Limit` | integer | Max context tokens to retrieve |
| `X-Memory-Recency-Bias` | `low`, `medium`, `high` | Prefer recent vs semantic |

### Selective Memory (Message Level)
```json
{
  "messages": [
    { 
      "role": "user", 
      "content": "Reference docs...",
      "memory": false  // NOT stored
    },
    { 
      "role": "user", 
      "content": "Analyze the auth flow"  // Stored ✓
    }
  ]
}
```

## Project Structure

```
/src
  /routes
    chat.ts         # /v1/chat/completions proxy
  /middleware
    auth.ts         # Memory key validation
    memory.ts       # RAG injection + storage
  /services
    providers.ts    # OpenAI, Anthropic, OpenRouter forwarding
    vectorvault.ts  # Memory storage (stub)
  /formatters
    index.ts        # Model-specific memory injection formats
  server.ts         # Main entry
```

## Test Memory Keys
For development, these keys are pre-configured:
- `mk_test_key` - Test Project
- `mk_demo` - Demo

## Environment Variables
```bash
PORT=3000
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
OPENROUTER_API_KEY=sk-or-xxx
```

## What's Stubbed (MVP)
- **VectorVault integration**: Memory retrieval/storage logs actions but doesn't persist
- **User database**: Memory keys are hardcoded for testing
- **Provider keys**: Read from environment variables

## Next Steps
1. Wire up VectorVault for actual memory storage
2. Add PostgreSQL for user/key management
3. Implement billing/metering
4. Add dashboard UI

---

*MemoryRouter: Every $0.50 on memory saves $2-3 on inference.* 🧠⚡
