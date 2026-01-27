#!/bin/bash
set -e

echo "🚀 MemoryRouter Cloudflare Workers Deployment"
echo "=============================================="

cd "$(dirname "$0")/.."

# Check if wrangler is authenticated
echo ""
echo "1. Checking authentication..."
if ! npx wrangler whoami > /dev/null 2>&1; then
    echo "❌ Not authenticated. Running wrangler login..."
    npx wrangler login
fi
echo "✅ Authenticated with Cloudflare"

# Create KV namespaces
echo ""
echo "2. Creating KV namespaces..."

# Function to create KV namespace and extract ID
create_kv() {
    local name=$1
    local preview=$2
    local output
    
    if [ "$preview" == "--preview" ]; then
        output=$(npx wrangler kv namespace create "$name" --preview 2>&1) || true
    else
        output=$(npx wrangler kv namespace create "$name" 2>&1) || true
    fi
    
    # Check if already exists
    if echo "$output" | grep -q "already exists"; then
        echo "   KV namespace $name$preview already exists"
        # List namespaces to get ID
        npx wrangler kv namespace list | grep -A1 "\"title\": \"$name" | grep "id" | awk -F'"' '{print $4}'
    else
        echo "$output" | grep -oP 'id = "\K[^"]+'
    fi
}

# Create namespaces
VECTORS_KV_ID=$(npx wrangler kv namespace create "VECTORS_KV" 2>&1 | grep -oP 'id = "\K[^"]+' || echo "existing")
METADATA_KV_ID=$(npx wrangler kv namespace create "METADATA_KV" 2>&1 | grep -oP 'id = "\K[^"]+' || echo "existing")
VECTORS_KV_PREVIEW_ID=$(npx wrangler kv namespace create "VECTORS_KV" --preview 2>&1 | grep -oP 'id = "\K[^"]+' || echo "existing")
METADATA_KV_PREVIEW_ID=$(npx wrangler kv namespace create "METADATA_KV" --preview 2>&1 | grep -oP 'id = "\K[^"]+' || echo "existing")

echo "   VECTORS_KV: $VECTORS_KV_ID"
echo "   METADATA_KV: $METADATA_KV_ID"
echo "✅ KV namespaces ready"

# Create R2 bucket
echo ""
echo "3. Creating R2 bucket..."
npx wrangler r2 bucket create memoryrouter-vectors 2>&1 | grep -v "error" || true
echo "✅ R2 bucket ready"

# List all KV namespaces to get IDs
echo ""
echo "4. Listing KV namespace IDs..."
npx wrangler kv namespace list

# Deploy
echo ""
echo "5. Deploying worker..."
npx wrangler deploy

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "  1. Update wrangler.toml with the KV IDs shown above"
echo "  2. Add custom domain: npx wrangler domains add app.memoryrouter.ai"
echo "  3. Test: curl https://memoryrouter.<subdomain>.workers.dev/health"
