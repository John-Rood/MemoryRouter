#!/bin/bash
# Fetch model lists directly from each provider's API
# Updates static model catalog for UI dropdowns (debug page, etc.)
#
# This is NOT for runtime validation - model names are passthrough.
# This is just for showing users what models are available.
#
# Run weekly via cron, then deploy.
#
# Requires API keys as env vars:
#   OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, XAI_API_KEY

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKERS_DIR="$(dirname "$SCRIPT_DIR")"
MODELS_FILE="$WORKERS_DIR/src/config/models-native.json"

echo "🔄 Fetching models directly from providers..."
echo ""

# Initialize output
echo '{"fetched_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'", "providers": {}}' > /tmp/models-native.json

# ===== OpenAI =====
echo "📡 OpenAI..."
if [ -n "$OPENAI_API_KEY" ]; then
  OPENAI_MODELS=$(curl -s "https://api.openai.com/v1/models" \
    -H "Authorization: Bearer $OPENAI_API_KEY" | \
    jq '[.data[] | select(.id | test("gpt|o1|o3|davinci|turbo")) | .id] | sort | unique')
  
  jq --argjson models "$OPENAI_MODELS" '.providers.openai = $models' /tmp/models-native.json > /tmp/models-native2.json
  mv /tmp/models-native2.json /tmp/models-native.json
  echo "   ✅ $(echo $OPENAI_MODELS | jq 'length') models"
else
  echo "   ⚠️  OPENAI_API_KEY not set, skipping"
fi

# ===== Anthropic =====
echo "📡 Anthropic..."
if [ -n "$ANTHROPIC_API_KEY" ]; then
  ANTHROPIC_MODELS=$(curl -s "https://api.anthropic.com/v1/models" \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" | \
    jq '[.data[] | .id] | sort')
  
  jq --argjson models "$ANTHROPIC_MODELS" '.providers.anthropic = $models' /tmp/models-native.json > /tmp/models-native2.json
  mv /tmp/models-native2.json /tmp/models-native.json
  echo "   ✅ $(echo $ANTHROPIC_MODELS | jq 'length') models"
else
  echo "   ⚠️  ANTHROPIC_API_KEY not set, skipping"
fi

# ===== Google =====
echo "📡 Google..."
if [ -n "$GOOGLE_API_KEY" ]; then
  GOOGLE_MODELS=$(curl -s "https://generativelanguage.googleapis.com/v1/models?key=$GOOGLE_API_KEY" | \
    jq '[.models[] | .name | sub("models/"; "")] | sort')
  
  jq --argjson models "$GOOGLE_MODELS" '.providers.google = $models' /tmp/models-native.json > /tmp/models-native2.json
  mv /tmp/models-native2.json /tmp/models-native.json
  echo "   ✅ $(echo $GOOGLE_MODELS | jq 'length') models"
else
  echo "   ⚠️  GOOGLE_API_KEY not set, skipping"
fi

# ===== xAI =====
echo "📡 xAI..."
if [ -n "$XAI_API_KEY" ]; then
  XAI_MODELS=$(curl -s "https://api.x.ai/v1/models" \
    -H "Authorization: Bearer $XAI_API_KEY" | \
    jq '[.data[] | .id] | sort' 2>/dev/null || echo '[]')
  
  if [ "$XAI_MODELS" != "[]" ] && [ "$XAI_MODELS" != "null" ]; then
    jq --argjson models "$XAI_MODELS" '.providers.xai = $models' /tmp/models-native.json > /tmp/models-native2.json
    mv /tmp/models-native2.json /tmp/models-native.json
    echo "   ✅ $(echo $XAI_MODELS | jq 'length') models"
  else
    echo "   ⚠️  No models returned"
  fi
else
  echo "   ⚠️  XAI_API_KEY not set, skipping"
fi

# Copy to final location
cp /tmp/models-native.json "$MODELS_FILE"

echo ""
echo "📁 Written to: $MODELS_FILE"
echo ""
echo "Summary:"
jq -r '.providers | to_entries[] | "  \(.key): \(.value | length) models"' "$MODELS_FILE"
