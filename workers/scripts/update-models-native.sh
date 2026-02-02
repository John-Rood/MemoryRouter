#!/bin/bash
# Fetch model lists directly from each provider's API
# Source API keys (for launchd runs)
[ -f ~/.clawdbot/model-sync.env ] && source ~/.clawdbot/model-sync.env
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
  # Filter: include gpt/o1/o3/davinci/turbo, exclude fine-tunes (ft:)
  OPENAI_MODELS=$(curl -s "https://api.openai.com/v1/models" \
    -H "Authorization: Bearer $OPENAI_API_KEY" | \
    jq '[.data[] | .id | select(test("gpt|o1-|o3-|davinci|turbo")) | select(startswith("ft:") | not)] | sort | unique')
  
  jq --argjson models "$OPENAI_MODELS" '.providers.openai = $models' /tmp/models-native.json > /tmp/models-native2.json
  mv /tmp/models-native2.json /tmp/models-native.json
  echo "   ✅ $(echo $OPENAI_MODELS | jq 'length') models"
else
  echo "   ⚠️  OPENAI_API_KEY not set, skipping"
fi

# ===== Anthropic =====
echo "📡 Anthropic..."
if [ -n "$ANTHROPIC_API_KEY" ]; then
  ANTHROPIC_RESPONSE=$(curl -s "https://api.anthropic.com/v1/models" \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01")
  
  # Check if response has data array (success) or error
  if echo "$ANTHROPIC_RESPONSE" | jq -e '.data' > /dev/null 2>&1; then
    ANTHROPIC_MODELS=$(echo "$ANTHROPIC_RESPONSE" | jq '[.data[] | .id] | sort')
    jq --argjson models "$ANTHROPIC_MODELS" '.providers.anthropic = $models' /tmp/models-native.json > /tmp/models-native2.json
    mv /tmp/models-native2.json /tmp/models-native.json
    echo "   ✅ $(echo $ANTHROPIC_MODELS | jq 'length') models"
  else
    echo "   ⚠️  API error, using static fallback"
    ANTHROPIC_MODELS='["claude-3-5-haiku-20241022","claude-3-5-haiku-latest","claude-3-5-sonnet-20240620","claude-3-5-sonnet-20241022","claude-3-5-sonnet-latest","claude-3-7-sonnet-20250219","claude-3-7-sonnet-latest","claude-3-haiku-20240307","claude-3-opus-20240229","claude-3-opus-latest","claude-3-sonnet-20240229","claude-opus-4-0-20250514","claude-opus-4-20250514","claude-sonnet-4-0-20250514","claude-sonnet-4-20250514"]'
    jq --argjson models "$ANTHROPIC_MODELS" '.providers.anthropic = $models' /tmp/models-native.json > /tmp/models-native2.json
    mv /tmp/models-native2.json /tmp/models-native.json
    echo "   ✅ $(echo $ANTHROPIC_MODELS | jq 'length') models (fallback)"
  fi
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

# Compare with existing file (ignore fetched_at timestamp)
EXISTING_MODELS=$(jq -S '.providers' "$MODELS_FILE" 2>/dev/null || echo '{}')
NEW_MODELS=$(jq -S '.providers' /tmp/models-native.json)

if [ "$EXISTING_MODELS" = "$NEW_MODELS" ]; then
  echo ""
  echo "✅ No changes detected. Exiting silently."
  exit 0
fi

# Changes detected! Find what's new
echo ""
echo "🆕 Changes detected! Identifying new models..."

# Get diff of model lists
DIFF_SUMMARY=""
for provider in openai anthropic google xai; do
  OLD_LIST=$(echo "$EXISTING_MODELS" | jq -r ".${provider} // [] | .[]" 2>/dev/null | sort)
  NEW_LIST=$(echo "$NEW_MODELS" | jq -r ".${provider} // [] | .[]" 2>/dev/null | sort)
  NEW_MODELS_LIST=$(comm -13 <(echo "$OLD_LIST") <(echo "$NEW_LIST") 2>/dev/null || true)
  if [ -n "$NEW_MODELS_LIST" ]; then
    DIFF_SUMMARY="${DIFF_SUMMARY}${provider}: $(echo "$NEW_MODELS_LIST" | tr '\n' ', ' | sed 's/,$//')\n"
  fi
done

# Copy to final location
cp /tmp/models-native.json "$MODELS_FILE"

echo ""
echo "📁 Written to: $MODELS_FILE"
echo ""
echo "Summary:"
jq -r '.providers | to_entries[] | "  \(.key): \(.value | length) models"' "$MODELS_FILE"

# Wake Clawdbot with the new models info
echo ""
echo "🔔 Waking Clawdbot to commit and deploy..."

# Use claudius agent to wake with the diff
WAKE_MSG="🆕 MODEL CATALOG UPDATE - New models detected!

${DIFF_SUMMARY}
The file is already updated at ~/apps/MemoryRouter/workers/src/config/models-native.json

Action needed:
1. cd ~/apps/MemoryRouter && git add workers/src/config/models-native.json
2. git commit -m 'chore: New models - [list them]'
3. git push origin main
4. cd workers && npm run deploy
5. Message John on Telegram (target=8541390285) with the new model list"

/Users/johnrood/.local/bin/claudius agent -m "$WAKE_MSG" --channel telegram --deliver 2>/dev/null || echo "⚠️ Could not wake agent"
