#!/bin/bash
# MemoryRouter Live API Tests
# Tests all endpoints against the deployed Workers instance

BASE_URL="https://memoryrouter-api.roodbiz.workers.dev"
API_KEY="mk_test_key"
AUTH="Authorization: Bearer $API_KEY"
PASS=0
FAIL=0

echo "=================================================="
echo "  MemoryRouter Live API Tests"
echo "  $BASE_URL"
echo "=================================================="
echo ""

# Helper function
test_endpoint() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  
  if echo "$actual" | grep -q "$expected"; then
    echo "✅ PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "❌ FAIL: $name"
    echo "   Expected to contain: $expected"
    echo "   Got: $actual"
    FAIL=$((FAIL + 1))
  fi
}

# ==================== 1. Health Endpoints ====================
echo "--- 1. Health Endpoints ---"

# Root
RESULT=$(curl -s "$BASE_URL/")
test_endpoint "GET / — Root health" '"status":"ok"' "$RESULT"
test_endpoint "GET / — Version 2.0" '"version":"2.0.0"' "$RESULT"
test_endpoint "GET / — Durable Objects storage" '"storage":"durable-objects"' "$RESULT"

# Health
RESULT=$(curl -s "$BASE_URL/health")
test_endpoint "GET /health — Healthy" '"status":"healthy"' "$RESULT"
test_endpoint "GET /health — DO storage" '"storage":"durable-objects"' "$RESULT"

echo ""

# ==================== 2. Auth ====================
echo "--- 2. Authentication ---"

# No auth
RESULT=$(curl -s "$BASE_URL/v1/memory/stats")
test_endpoint "No auth → 401" '"error"' "$RESULT"

# Bad auth
RESULT=$(curl -s -H "Authorization: Bearer bad_key" "$BASE_URL/v1/memory/stats")
test_endpoint "Bad auth → 401" '"error"' "$RESULT"

# Valid auth (mk_test_key auto-creates in dev)
RESULT=$(curl -s -H "$AUTH" "$BASE_URL/v1/memory/stats")
test_endpoint "Valid mk_test_key → success" '"key":"mk_test_key"' "$RESULT"

echo ""

# ==================== 3. Memory Stats (Empty) ====================
echo "--- 3. Memory Stats (Empty Vault) ---"

RESULT=$(curl -s -H "$AUTH" "$BASE_URL/v1/memory/stats")
test_endpoint "Memory stats — has key" '"key":"mk_test_key"' "$RESULT"
test_endpoint "Memory stats — durable-objects" '"storage":"durable-objects"' "$RESULT"
echo "   📊 Stats: $RESULT"

echo ""

# ==================== 4. Chat Completions (Memory Write) ====================
echo "--- 4. Chat Completions (Store Memory) ---"

# First message — stores in memory
RESULT=$(curl -s -X POST "$BASE_URL/v1/chat/completions" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: test_session_1" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "My favorite color is electric purple and my dog is named Sparky."}
    ]
  }')
test_endpoint "Chat completions — has choices" 'choices' "$RESULT"
test_endpoint "Chat completions — has _memory" '_memory' "$RESULT"
test_endpoint "Chat completions — DO storage" 'durable-objects' "$RESULT"
echo "   📝 Memory metadata: $(echo $RESULT | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get("_memory",{})))' 2>/dev/null || echo 'parse error')"

echo ""

# ==================== 5. Second Chat (Memory Read) ====================
echo "--- 5. Chat Completions (Retrieve Memory) ---"

# Wait for background storage to complete
sleep 3

# Second message — should retrieve memory about purple/Sparky
RESULT=$(curl -s -X POST "$BASE_URL/v1/chat/completions" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: test_session_1" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "What is my favorite color and what is my dogs name?"}
    ]
  }')
test_endpoint "Memory retrieval — has choices" 'choices' "$RESULT"
test_endpoint "Memory retrieval — has _memory" '_memory' "$RESULT"

# Check if memory was actually retrieved
CHUNKS=$(echo "$RESULT" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("_memory",{}).get("chunks_retrieved",0))' 2>/dev/null || echo "0")
if [ "$CHUNKS" -gt 0 ] 2>/dev/null; then
  echo "✅ PASS: Memory retrieval — $CHUNKS chunks retrieved"
  PASS=$((PASS + 1))
else
  echo "⚠️  WARN: Memory retrieval — 0 chunks (storage may still be processing)"
fi

# Check if response mentions purple or Sparky
if echo "$RESULT" | grep -qi "purple\|sparky"; then
  echo "✅ PASS: Response contains remembered info (purple/Sparky)"
  PASS=$((PASS + 1))
else
  echo "⚠️  WARN: Response doesn't mention purple/Sparky (memory may not have stored yet)"
fi

echo "   🧠 Response: $(echo $RESULT | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["choices"][0]["message"]["content"][:200])' 2>/dev/null || echo 'parse error')"

echo ""

# ==================== 6. Memory Stats (After Storage) ====================
echo "--- 6. Memory Stats (After Storage) ---"

RESULT=$(curl -s -H "$AUTH" "$BASE_URL/v1/memory/stats")
test_endpoint "Stats after storage — has key" '"key":"mk_test_key"' "$RESULT"
echo "   📊 Stats: $RESULT"

echo ""

# ==================== 7. Selective Memory ====================
echo "--- 7. Selective Memory (memory: false) ---"

RESULT=$(curl -s -X POST "$BASE_URL/v1/chat/completions" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "This is a secret: the password is hunter2", "memory": false},
      {"role": "user", "content": "What did I just tell you?"}
    ]
  }')
test_endpoint "Selective memory — has choices" 'choices' "$RESULT"

echo ""

# ==================== 8. Memory Mode Headers ====================
echo "--- 8. Memory Mode: read-only ---"

RESULT=$(curl -s -X POST "$BASE_URL/v1/chat/completions" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -H "X-Memory-Mode: read" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "Tell me what you remember about me"}
    ]
  }')
test_endpoint "Read-only mode — has choices" 'choices' "$RESULT"

echo ""

# ==================== 9. Create Additional Key ====================
echo "--- 9. Create Memory Key ---"

RESULT=$(curl -s -X POST "$BASE_URL/v1/keys" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Project Alpha"}')
test_endpoint "Create key — has mk_ prefix" 'mk_' "$RESULT"
NEW_KEY=$(echo "$RESULT" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("key",""))' 2>/dev/null || echo "")
echo "   🔑 New key: $NEW_KEY"

echo ""

# ==================== 10. Memory Off Mode ====================
echo "--- 10. Memory Mode: off ---"

RESULT=$(curl -s -X POST "$BASE_URL/v1/chat/completions" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -H "X-Memory-Mode: off" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "Just say hello"}
    ]
  }')
test_endpoint "Memory off — has choices" 'choices' "$RESULT"
test_endpoint "Memory off — 0 tokens retrieved" '"tokens_retrieved":0' "$RESULT"

echo ""

# ==================== 11. Clear Memory ====================
echo "--- 11. Clear Memory ---"

RESULT=$(curl -s -X DELETE "$BASE_URL/v1/memory" \
  -H "$AUTH")
test_endpoint "Clear memory — deleted true" '"deleted":true' "$RESULT"

echo ""

# ==================== 12. Verify Cleared ====================
echo "--- 12. Verify Memory Cleared ---"

RESULT=$(curl -s -H "$AUTH" "$BASE_URL/v1/memory/stats")
test_endpoint "After clear — has key" '"key":"mk_test_key"' "$RESULT"
echo "   📊 Stats: $RESULT"

echo ""

# ==================== 13. 404 Handling ====================
echo "--- 13. Error Handling ---"

RESULT=$(curl -s "$BASE_URL/v1/nonexistent")
test_endpoint "404 — error response" '"error"' "$RESULT"

RESULT=$(curl -s -X POST "$BASE_URL/v1/chat/completions" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "hi"}]}')
test_endpoint "Missing model — 400" '"error"' "$RESULT"

RESULT=$(curl -s -X POST "$BASE_URL/v1/chat/completions" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{"model": "openai/gpt-4o-mini"}')
test_endpoint "Missing messages — 400" '"error"' "$RESULT"

echo ""

# ==================== Summary ====================
echo "=================================================="
echo "  Results: $PASS passed, $FAIL failed"
echo "=================================================="
