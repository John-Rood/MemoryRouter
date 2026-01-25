#!/bin/bash
# MemoryRouter Workers Setup Script
# Run this to create all necessary Cloudflare resources

set -e

echo "🚀 MemoryRouter Workers Setup"
echo "=============================="
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ wrangler not found. Installing..."
    npm install -g wrangler
fi

# Check if logged in
echo "📋 Checking Cloudflare authentication..."
if ! wrangler whoami &> /dev/null; then
    echo "❌ Not logged in to Cloudflare. Please run: wrangler login"
    exit 1
fi

echo "✅ Authenticated with Cloudflare"
echo ""

# Create KV namespaces
echo "📦 Creating KV namespaces..."

VECTORS_KV=$(wrangler kv:namespace create VECTORS_KV 2>&1 | grep -o 'id = "[^"]*"' | cut -d'"' -f2)
VECTORS_KV_PREVIEW=$(wrangler kv:namespace create VECTORS_KV --preview 2>&1 | grep -o 'id = "[^"]*"' | cut -d'"' -f2)

METADATA_KV=$(wrangler kv:namespace create METADATA_KV 2>&1 | grep -o 'id = "[^"]*"' | cut -d'"' -f2)
METADATA_KV_PREVIEW=$(wrangler kv:namespace create METADATA_KV --preview 2>&1 | grep -o 'id = "[^"]*"' | cut -d'"' -f2)

echo "✅ VECTORS_KV: $VECTORS_KV"
echo "✅ METADATA_KV: $METADATA_KV"
echo ""

# Create R2 bucket
echo "📦 Creating R2 bucket..."
wrangler r2 bucket create memoryrouter-vectors 2>/dev/null || echo "  (bucket may already exist)"
echo "✅ R2 bucket: memoryrouter-vectors"
echo ""

# Update wrangler.toml
echo "📝 Updating wrangler.toml..."

# Create backup
cp wrangler.toml wrangler.toml.bak

# Update IDs in wrangler.toml
sed -i.tmp "s/REPLACE_WITH_KV_ID/$VECTORS_KV/g" wrangler.toml
sed -i.tmp "s/REPLACE_WITH_PREVIEW_KV_ID/$VECTORS_KV_PREVIEW/g" wrangler.toml
sed -i.tmp "s/REPLACE_WITH_METADATA_KV_ID/$METADATA_KV/g" wrangler.toml
sed -i.tmp "s/REPLACE_WITH_PREVIEW_METADATA_KV_ID/$METADATA_KV_PREVIEW/g" wrangler.toml
rm -f wrangler.toml.tmp

echo "✅ wrangler.toml updated"
echo ""

echo "=============================="
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. npm install"
echo "2. npm run dev     # Start local development"
echo "3. npm run deploy  # Deploy to Cloudflare"
echo ""
echo "Optional: Set your OpenAI API key for embeddings:"
echo "  wrangler secret put OPENAI_API_KEY"
echo ""
