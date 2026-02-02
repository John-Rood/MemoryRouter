#!/bin/bash
# Model Validation Script
# Tests every model in the catalog with a simple ping
# All models must pass before deploying model updates
#
# Usage: ./scripts/validate-models.sh [staging|production]
#
# Requires: MEMORYROUTER_API_KEY environment variable

set -e

ENV="${1:-staging}"

if [ "$ENV" = "staging" ]; then
  API_BASE="https://memoryrouter-staging.roodbiz.workers.dev"
elif [ "$ENV" = "production" ]; then
  API_BASE="https://api.memoryrouter.ai"
else
  echo "Usage: $0 [staging|production]"
  exit 1
fi

# Use env var or default test key
API_KEY="${MEMORYROUTER_API_KEY:-mk_320bced307f0441f}"

echo "🔍 Model Validation Script"
echo "Environment: $ENV"
echo "API Base: $API_BASE"
echo ""

# Get all models from API
echo "📥 Fetching model list..."
MODELS=$(curl -s "$API_BASE/v1/models" \
  -H "Authorization: Bearer $API_KEY" | \
  jq -r '.providers[].models[]' 2>/dev/null)

if [ -z "$MODELS" ]; then
  echo "❌ Failed to fetch models"
  exit 1
fi

TOTAL=$(echo "$MODELS" | wc -l | tr -d ' ')
echo "Found $TOTAL models to test"
echo ""

# Track results
PASSED=0
FAILED=0
FAILED_MODELS=""

# Test each model
for MODEL in $MODELS; do
  # Skip models that don't support chat completions
  if [[ "$MODEL" == *"embed"* ]] || [[ "$MODEL" == *"whisper"* ]] || [[ "$MODEL" == *"tts"* ]] || [[ "$MODEL" == *"dall-e"* ]] || [[ "$MODEL" == *"image"* ]] || [[ "$MODEL" == *"moderation"* ]]; then
    echo "⏭️  $MODEL (skipped - not a chat model)"
    continue
  fi
  
  # Ping the model with minimal tokens
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -H "X-Memory-Store: false" \
    -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":5}" \
    --max-time 30 2>/dev/null)
  
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')
  
  # Check for success
  if [ "$HTTP_CODE" = "200" ]; then
    # Verify we got a response
    CONTENT=$(echo "$BODY" | jq -r '.choices[0].message.content // empty' 2>/dev/null)
    if [ -n "$CONTENT" ]; then
      echo "✅ $MODEL"
      PASSED=$((PASSED + 1))
    else
      echo "❌ $MODEL (no content in response)"
      FAILED=$((FAILED + 1))
      FAILED_MODELS="$FAILED_MODELS\n  - $MODEL"
    fi
  else
    ERROR=$(echo "$BODY" | jq -r '.error // .provider_error.error.message // "Unknown error"' 2>/dev/null)
    echo "❌ $MODEL (HTTP $HTTP_CODE: $ERROR)"
    FAILED=$((FAILED + 1))
    FAILED_MODELS="$FAILED_MODELS\n  - $MODEL: $ERROR"
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Results: $PASSED passed, $FAILED failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $FAILED -gt 0 ]; then
  echo ""
  echo "Failed models:"
  echo -e "$FAILED_MODELS"
  echo ""
  echo "❌ VALIDATION FAILED - Do not deploy until all models pass"
  exit 1
else
  echo ""
  echo "✅ ALL MODELS PASSED - Safe to deploy"
  exit 0
fi
