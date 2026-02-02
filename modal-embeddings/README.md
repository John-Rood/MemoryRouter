# MemoryRouter Embedding Service

Self-hosted BGE-large-en-v1.5 embeddings on Modal. ~100x cheaper than OpenAI.

## Deploy

```bash
# Install Modal CLI
pip install modal

# Authenticate
modal token new

# Deploy
cd modal-embeddings
modal deploy app.py
```

## Endpoints

After deploy, you'll get a URL like: `https://memoryrouter-embeddings--web.modal.run`

### Health Check
```bash
curl https://memoryrouter-embeddings--web.modal.run/health
```

### Embed (native)
```bash
curl https://memoryrouter-embeddings--web.modal.run/embed \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"texts": ["hello world", "semantic search"]}'
```

### Embed (OpenAI-compatible)
```bash
curl https://memoryrouter-embeddings--web.modal.run/v1/embeddings \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"input": ["hello world"]}'
```

## Cost Comparison

| Provider | Cost per 1M tokens |
|----------|-------------------|
| OpenAI text-embedding-3-large | $0.13 |
| Cloudflare Workers AI BGE | $0.20 |
| **Modal BGE (this)** | **~$0.001-0.005** |

## Architecture

```
MemoryRouter Worker
        ↓
modal-embeddings (T4 GPU)
        ↓
BGE-large-en-v1.5 (1024 dims)
```

- Auto-scales 0→N containers based on load
- Keep-warm ping every 4 min prevents cold starts
- Container stays warm 5 min after last request

## Model Info

- **Model:** dunzhang/stella_en_400M_v5
- **Dimensions:** 1024
- **Max tokens:** 512
- **MTEB Score:** 66.15 (beats OpenAI's 64.6!)
- **License:** MIT

### Why Stella?
Stella 400M is the top retrieval-focused embedding model that:
- Beats BGE-large (64.23) and OpenAI (64.6) on MTEB
- MIT licensed for commercial use
- 400M params fits on T4 GPU
- Works with sentence-transformers
