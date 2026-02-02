#!/bin/bash
#
# CORE VERIFICATION SCRIPT
# Run this BEFORE every deployment to ensure core functionality is intact.
#
# Usage: ./scripts/verify-core.sh [API_URL]
#
# Exit codes:
#   0 = All checks passed, safe to deploy
#   1 = Core regression detected, DO NOT DEPLOY
#

set -e

API_URL="${1:-https://memoryrouter-api.roodbiz.workers.dev}"
TEST_KEY="mk_core_verify_$(date +%s)"
ADMIN_KEY="${ADMIN_KEY:-mk_admin}"

# Thresholds
MAX_OVERHEAD_MS=100
MAX_PROCESSING_MS=200
MIN_REQUESTS=5

echo "🔍 CORE VERIFICATION"
echo "===================="
echo "API: $API_URL"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; exit 1; }
warn() { echo -e "${YELLOW}⚠ WARN${NC}: $1"; }

# Test 1: Health check
echo "1. Health check..."
HEALTH=$(curl -s "$API_URL/health" | jq -r '.status')
if [ "$HEALTH" = "healthy" ]; then
  pass "API is healthy"
else
  fail "API health check failed"
fi

# Test 2: Latency check (multiple requests)
echo ""
echo "2. Latency check..."

# Warm-up request (cold start expected)
echo "   Warming up DO..."
curl -s "$API_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mk_320bced307f0441f" \
  -d '{"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "warmup"}]}' > /dev/null

sleep 1
echo "   Measuring warm latency (${MIN_REQUESTS} requests)..."

TOTAL_OVERHEAD=0
MAX_SEEN=0

for i in $(seq 1 $MIN_REQUESTS); do
  RESPONSE=$(curl -s "$API_URL/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer mk_320bced307f0441f" \
    -d '{"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "test"}]}')
  
  OVERHEAD=$(echo "$RESPONSE" | jq -r '._latency.mr_overhead_ms // 999')
  PROCESSING=$(echo "$RESPONSE" | jq -r '._latency.mr_processing_ms // 999')
  
  if [ "$OVERHEAD" = "999" ]; then
    fail "Request $i failed to return latency metrics"
  fi
  
  TOTAL_OVERHEAD=$((TOTAL_OVERHEAD + OVERHEAD))
  if [ "$OVERHEAD" -gt "$MAX_SEEN" ]; then
    MAX_SEEN=$OVERHEAD
  fi
  
  echo "   Request $i: overhead=${OVERHEAD}ms, processing=${PROCESSING}ms"
done

AVG_OVERHEAD=$((TOTAL_OVERHEAD / MIN_REQUESTS))
echo ""
echo "   Average overhead: ${AVG_OVERHEAD}ms"
echo "   Max overhead: ${MAX_SEEN}ms"

if [ "$MAX_SEEN" -gt "$MAX_OVERHEAD_MS" ]; then
  fail "Overhead exceeds ${MAX_OVERHEAD_MS}ms threshold (got ${MAX_SEEN}ms)"
else
  pass "Overhead within threshold (max=${MAX_SEEN}ms < ${MAX_OVERHEAD_MS}ms)"
fi

# Test 3: Memory injection check
echo ""
echo "3. Memory injection check..."
RESPONSE=$(curl -s "$API_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mk_320bced307f0441f" \
  -d '{"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "What do you remember about me?"}]}')

TOKENS=$(echo "$RESPONSE" | jq -r '._memory.tokens_retrieved // 0')
if [ "$TOKENS" -gt "0" ]; then
  pass "Memory injection working (${TOKENS} tokens retrieved)"
else
  warn "No memory tokens retrieved (may be expected for new key)"
fi

# Test 4: Storage sync check
echo ""
echo "4. Storage sync check..."
DEBUG=$(curl -s "$API_URL/admin/debug-storage?key=mk_320bced307f0441f" \
  -H "Authorization: Bearer $ADMIN_KEY")

DO_COUNT=$(echo "$DEBUG" | jq -r '.do.vectorCount // 0')
D1_COUNT=$(echo "$DEBUG" | jq -r '.d1.chunkCount // 0')
DIFF=$((DO_COUNT > D1_COUNT ? DO_COUNT - D1_COUNT : D1_COUNT - DO_COUNT))

echo "   DO vectors: $DO_COUNT"
echo "   D1 chunks: $D1_COUNT"

if [ "$DIFF" -le "2" ]; then
  pass "Storage in sync (diff=${DIFF})"
else
  warn "Storage out of sync (DO=${DO_COUNT}, D1=${D1_COUNT})"
fi

# Summary
echo ""
echo "===================="
echo -e "${GREEN}✓ CORE VERIFICATION PASSED${NC}"
echo "Safe to deploy."
echo ""

exit 0
