# MemoryRouter Cloudflare Workers Deployment Guide

**Status:** Ready for deployment - requires Cloudflare authentication

## Quick Deploy Steps

### Step 1: Authenticate with Cloudflare

**Option A: Browser OAuth (recommended)**
```bash
cd /Users/johnkodarood/Documents/GitHub/MemoryRouter/workers
npx wrangler login
```
This will open a browser - click "Allow" to authorize Wrangler.

**Option B: API Token (for CI/headless)**
1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Create Token → Use "Edit Cloudflare Workers" template
3. Set the token as environment variable:
```bash
export CLOUDFLARE_API_TOKEN="your-token-here"
```

### Step 2: Create KV Namespaces

```bash
# Create production KV namespaces
npx wrangler kv namespace create "VECTORS_KV"
npx wrangler kv namespace create "METADATA_KV"

# Create preview KV namespaces (for local dev)
npx wrangler kv namespace create "VECTORS_KV" --preview
npx wrangler kv namespace create "METADATA_KV" --preview
```

Save the IDs that are output!

### Step 3: Create R2 Bucket

```bash
npx wrangler r2 bucket create memoryrouter-vectors
```

### Step 4: Update wrangler.toml

Edit `wrangler.toml` and replace the placeholder IDs with the actual IDs from steps 2-3.

### Step 5: Set Secrets (Optional - for OpenAI embeddings)

```bash
npx wrangler secret put OPENAI_API_KEY
# Enter your OpenAI API key when prompted
```

### Step 6: Deploy

```bash
npm run deploy
# or: npx wrangler deploy
```

### Step 7: Add Custom Domain

```bash
npx wrangler domains add app.memoryrouter.ai
```

Or configure in Cloudflare Dashboard:
1. Go to Workers & Pages
2. Select "memoryrouter"
3. Settings → Triggers → Custom Domains
4. Add "app.memoryrouter.ai"

## One-Click Deploy Script

Run this after authenticating:

```bash
./scripts/deploy.sh
```

## Testing

After deployment:

```bash
# Test health endpoint
curl https://memoryrouter.<your-subdomain>.workers.dev/health

# Or with custom domain (after DNS propagation)
curl https://app.memoryrouter.ai/health
```

## Local Development

```bash
npx wrangler dev --local
# API available at http://localhost:8787
```

## DNS Configuration

The domain `memoryrouter.ai` needs a CNAME or proxied A record:
- Name: `app`
- Target: `memoryrouter.<account>.workers.dev` (or use Workers route)

This is usually auto-configured when adding a custom domain via Wrangler.

## Troubleshooting

### "You are not authenticated"
Run `npx wrangler login` and complete the browser flow.

### "KV namespace not found"
Make sure the IDs in wrangler.toml match the ones from `wrangler kv namespace create`.

### CORS issues
The worker includes CORS headers. If issues persist, check the frontend URL in the CORS config.
