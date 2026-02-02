#!/bin/bash
# Update model lists from OpenRouter API
# Run via cron: weekly or on-demand
# Zero runtime latency — updates code, deploys to staging

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKERS_DIR="$(dirname "$SCRIPT_DIR")"
MODELS_FILE="$WORKERS_DIR/src/config/models.json"

echo "🔄 Fetching latest models from OpenRouter..."

# Fetch and process OpenRouter models
curl -s "https://openrouter.ai/api/v1/models" | jq '{
  fetched_at: now | todate,
  providers: {
    openai: [.data[] | select(.id | startswith("openai/")) | .id] | sort | unique,
    anthropic: [.data[] | select(.id | startswith("anthropic/")) | .id] | sort | unique,
    google: [.data[] | select(.id | startswith("google/")) | .id] | sort | unique,
    meta: [.data[] | select(.id | contains("llama") or contains("meta")) | .id] | sort | unique,
    mistral: [.data[] | select(.id | startswith("mistral")) | .id] | sort | unique,
    deepseek: [.data[] | select(.id | contains("deepseek")) | .id] | sort | unique,
    xai: [.data[] | select(.id | startswith("x-ai") or contains("grok")) | .id] | sort | unique
  },
  pricing: [.data[] | {id: .id, input: .pricing.prompt, output: .pricing.completion, context: .context_length}]
}' > "$MODELS_FILE"

MODEL_COUNT=$(jq '[.providers | to_entries[] | .value | length] | add' "$MODELS_FILE")
echo "✅ Fetched $MODEL_COUNT models"

# Show summary
echo ""
echo "Provider breakdown:"
jq -r '.providers | to_entries[] | "  \(.key): \(.value | length) models"' "$MODELS_FILE"

echo ""
echo "📁 Written to: $MODELS_FILE"
echo ""
echo "Next steps:"
echo "  1. Review changes: git diff"
echo "  2. Test: npm run verify:staging"
echo "  3. Deploy: npm run deploy:staging"
