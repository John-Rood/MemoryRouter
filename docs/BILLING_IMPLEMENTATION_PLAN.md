# MemoryRouter Billing Implementation Plan
## Parallel Balance Checking & Usage Tracking

**Version:** 1.0  
**Date:** February 2, 2026  
**Status:** Ready for Implementation  
**Estimated Time:** 6-8 hours

---

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Parallel Balance Check Architecture](#2-parallel-balance-check-architecture)
3. [Request Flow Diagram](#3-request-flow-diagram)
4. [Blocked User Cache Design](#4-blocked-user-cache-design)
5. [Usage Recording](#5-usage-recording)
6. [Balance Deduction](#6-balance-deduction)
7. [Edge Cases](#7-edge-cases)
8. [Implementation Steps](#8-implementation-steps)
9. [Testing Plan](#9-testing-plan)

---

## 1. Architecture Overview

### Current State
- ✅ D1 schema exists with `accounts`, `billing`, `transactions`, `usage_records` tables
- ✅ `BillingService` class exists in `/workers/src/services/billing.ts`
- ✅ `recordUsage()` in `/workers/src/services/usage.ts` (fire-and-forget)
- ✅ `BILLING_ENABLED = false` toggle in `chat.ts`
- ❌ No parallel balance checking
- ❌ No blocked user cache
- ❌ No abort mechanism for insufficient balance

### Target State
```
┌─────────────────────────────────────────────────────────────────────┐
│                        REQUEST FLOW                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Request In                                                           │
│      │                                                               │
│      ▼                                                               │
│  ┌────────────────────┐                                              │
│  │ Check Blocked Cache│◄─── KV lookup: `blocked:user:{userId}`       │
│  │     (< 1ms)        │     If found → INSTANT REJECT (402)          │
│  └────────┬───────────┘                                              │
│           │ Not blocked                                              │
│           ▼                                                           │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │           PARALLEL EXECUTION (Promise.all)                      │  │
│  │                                                                  │  │
│  │  ┌─────────────────────┐    ┌─────────────────────────────────┐ │  │
│  │  │   Balance Check     │    │      LLM Request Processing      │ │  │
│  │  │   (D1 query)        │    │  - Memory retrieval              │ │  │
│  │  │   ~5-15ms           │    │  - Embedding                     │ │  │
│  │  │                     │    │  - Forward to provider           │ │  │
│  │  └──────────┬──────────┘    └──────────────┬────────────────────┘ │  │
│  │             │                              │                     │  │
│  │             ▼                              │                     │  │
│  │  ┌─────────────────────┐                   │                     │  │
│  │  │ Insufficient?       │                   │                     │  │
│  │  │ balance < threshold │                   │                     │  │
│  │  └──────────┬──────────┘                   │                     │  │
│  │             │ YES                          │                     │  │
│  │             ▼                              │                     │  │
│  │  ┌─────────────────────┐                   │                     │  │
│  │  │ Add to Blocked Cache│◄──────────────────┤                     │  │
│  │  │ (KV write)          │   ABORT SIGNAL    │                     │  │
│  │  └─────────────────────┘                   │                     │  │
│  │                                            │                     │  │
│  └────────────────────────────────────────────┼─────────────────────┘  │
│                                               │                       │
│                                               ▼                       │
│                              ┌────────────────────────────────────┐   │
│                              │  If aborted → 402 Payment Required │   │
│                              │  If OK → Stream/Return Response    │   │
│                              └────────────────┬───────────────────┘   │
│                                               │                       │
│                                               ▼                       │
│                              ┌────────────────────────────────────┐   │
│                              │  Record Usage (waitUntil)          │   │
│                              │  Deduct Balance (waitUntil)        │   │
│                              │  Check Auto-Reup (waitUntil)       │   │
│                              └────────────────────────────────────┘   │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Principle: Zero Latency Impact
The balance check runs **in parallel** with request processing. We don't wait for it before starting the LLM call. If the check completes and finds insufficient balance, we set an abort flag that prevents the response from being streamed/returned.

---

## 2. Parallel Balance Check Architecture

### 2.1 New File: `/workers/src/services/balance-guard.ts`

```typescript
/**
 * MemoryRouter Balance Guard
 * 
 * Parallel balance checking with zero latency impact.
 * Uses KV cache for blocked users to enable instant rejection.
 */

import { BillingService, BalanceCheck } from './billing';

// ============================================================================
// TYPES
// ============================================================================

export interface BalanceGuardResult {
  allowed: boolean;
  cached: boolean;           // Was this from cache?
  balanceCheck?: BalanceCheck;
  reason?: 'insufficient_balance' | 'suspended' | 'cap_reached' | 'blocked_cache';
  blockedAt?: number;
}

export interface BlockedUserRecord {
  userId: string;
  reason: 'insufficient_balance' | 'suspended' | 'cap_reached';
  balance_cents: number;
  free_tokens_remaining: number;
  blockedAt: number;
  ttlMs: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Blocked user cache TTL: 5 minutes (re-check periodically) */
const BLOCKED_USER_TTL_MS = 5 * 60 * 1000;

/** KV key prefix for blocked users */
const BLOCKED_KEY_PREFIX = 'blocked:user:';

// ============================================================================
// BALANCE GUARD CLASS
// ============================================================================

export class BalanceGuard {
  private kv: KVNamespace;
  private billing: BillingService;
  private abortController: AbortController | null = null;

  constructor(kv: KVNamespace, db: D1Database) {
    this.kv = kv;
    this.billing = new BillingService(db);
  }

  /**
   * Check blocked user cache (instant rejection path)
   * Call this FIRST before any processing
   */
  async checkBlockedCache(userId: string): Promise<BlockedUserRecord | null> {
    const key = `${BLOCKED_KEY_PREFIX}${userId}`;
    const cached = await this.kv.get(key, 'json') as BlockedUserRecord | null;
    
    if (cached) {
      // Check if TTL expired
      const age = Date.now() - cached.blockedAt;
      if (age > cached.ttlMs) {
        // Expired - delete and return null (will recheck)
        await this.kv.delete(key);
        return null;
      }
      return cached;
    }
    
    return null;
  }

  /**
   * Add user to blocked cache
   */
  async addToBlockedCache(
    userId: string,
    reason: BlockedUserRecord['reason'],
    balance_cents: number,
    free_tokens_remaining: number
  ): Promise<void> {
    const key = `${BLOCKED_KEY_PREFIX}${userId}`;
    const record: BlockedUserRecord = {
      userId,
      reason,
      balance_cents,
      free_tokens_remaining,
      blockedAt: Date.now(),
      ttlMs: BLOCKED_USER_TTL_MS,
    };
    
    // Store with TTL (KV expirationTtl in seconds)
    await this.kv.put(key, JSON.stringify(record), {
      expirationTtl: Math.ceil(BLOCKED_USER_TTL_MS / 1000),
    });
  }

  /**
   * Remove user from blocked cache (e.g., after top-up)
   */
  async removeFromBlockedCache(userId: string): Promise<void> {
    const key = `${BLOCKED_KEY_PREFIX}${userId}`;
    await this.kv.delete(key);
  }

  /**
   * Check balance from D1 (parallel path)
   * Returns a promise that resolves when check is complete
   */
  async checkBalanceAsync(userId: string): Promise<BalanceGuardResult> {
    try {
      const balanceCheck = await this.billing.checkBalance(userId);
      
      if (!balanceCheck.can_process_request) {
        // Add to blocked cache for instant rejection of subsequent requests
        let reason: BlockedUserRecord['reason'] = 'insufficient_balance';
        if (balanceCheck.status === 'suspended') reason = 'suspended';
        if (balanceCheck.status === 'cap_reached') reason = 'cap_reached';
        
        await this.addToBlockedCache(
          userId,
          reason,
          balanceCheck.balance_cents,
          balanceCheck.free_tokens_remaining
        );
        
        return {
          allowed: false,
          cached: false,
          balanceCheck,
          reason,
        };
      }
      
      return {
        allowed: true,
        cached: false,
        balanceCheck,
      };
    } catch (error) {
      // On D1 error, allow request (fail open for availability)
      // Log for alerting
      console.error('[BALANCE_GUARD] D1 check failed, allowing request:', error);
      return {
        allowed: true,
        cached: false,
      };
    }
  }

  /**
   * Create an abort signal for this request
   * The parallel balance check can call abort() if insufficient balance
   */
  createAbortController(): AbortController {
    this.abortController = new AbortController();
    return this.abortController;
  }

  /**
   * Signal that request should be aborted
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Check if request was aborted
   */
  isAborted(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createBalanceGuard(kv: KVNamespace, db: D1Database): BalanceGuard {
  return new BalanceGuard(kv, db);
}

// ============================================================================
// ERROR RESPONSE BUILDERS
// ============================================================================

export function buildInsufficientBalanceResponse(
  reason: string,
  balance_cents: number,
  free_tokens_remaining: number
): Response {
  return new Response(JSON.stringify({
    error: {
      message: 'Insufficient balance to process request',
      type: 'insufficient_balance',
      code: 'payment_required',
      details: {
        reason,
        balance_cents,
        free_tokens_remaining,
        top_up_url: 'https://app.memoryrouter.ai/billing',
      },
    },
  }), {
    status: 402,
    headers: {
      'Content-Type': 'application/json',
      'X-MemoryRouter-Payment-Required': 'true',
    },
  });
}

export function buildBlockedUserResponse(record: BlockedUserRecord): Response {
  return new Response(JSON.stringify({
    error: {
      message: 'Account blocked due to insufficient balance',
      type: 'blocked',
      code: 'payment_required',
      details: {
        reason: record.reason,
        balance_cents: record.balance_cents,
        free_tokens_remaining: record.free_tokens_remaining,
        blocked_at: new Date(record.blockedAt).toISOString(),
        top_up_url: 'https://app.memoryrouter.ai/billing',
        hint: 'Add credits to unblock your account',
      },
    },
  }), {
    status: 402,
    headers: {
      'Content-Type': 'application/json',
      'X-MemoryRouter-Blocked': 'true',
      'X-MemoryRouter-Blocked-Reason': record.reason,
    },
  });
}
```

### 2.2 Parallel Execution Pattern

```typescript
// In chat.ts - the key pattern for zero-latency balance checking

// 1. Check blocked cache FIRST (instant)
const blockedRecord = await balanceGuard.checkBlockedCache(userId);
if (blockedRecord) {
  return buildBlockedUserResponse(blockedRecord);
}

// 2. Create abort controller
const abortController = balanceGuard.createAbortController();

// 3. Start balance check in parallel (don't await yet)
const balanceCheckPromise = balanceGuard.checkBalanceAsync(userId).then(result => {
  if (!result.allowed) {
    // Signal abort - response streaming should check this
    balanceGuard.abort();
  }
  return result;
});

// 4. Continue with normal request processing (memory retrieval, etc.)
// ... all the existing code ...

// 5. Before forwarding to provider, check if aborted
if (balanceGuard.isAborted()) {
  const result = await balanceCheckPromise;
  return buildInsufficientBalanceResponse(
    result.reason!,
    result.balanceCheck?.balance_cents ?? 0,
    result.balanceCheck?.free_tokens_remaining ?? 0
  );
}

// 6. Forward to provider
const providerResponse = await forwardToProvider(...);

// 7. For streaming: check abort signal during stream
// 8. For non-streaming: wait for balance check to complete
```

---

## 3. Request Flow Diagram

### 3.1 Happy Path (User Has Balance)

```
┌──────────┐    ┌───────────────┐    ┌───────────────┐    ┌──────────────┐
│ Request  │───►│ Check Blocked │───►│   Parallel    │───►│  Forward to  │
│ Arrives  │    │ Cache (KV)    │    │  Balance +    │    │  Provider    │
│          │    │ [< 1ms]       │    │  LLM Request  │    │              │
└──────────┘    └───────┬───────┘    └───────┬───────┘    └──────┬───────┘
                        │                    │                   │
                        │ Not blocked        │                   │
                        ▼                    │                   ▼
                ┌───────────────┐            │           ┌──────────────┐
                │ Balance OK    │◄───────────┘           │  Response    │
                │ (checked in   │                        │  Returned    │
                │  parallel)    │                        └──────┬───────┘
                └───────────────┘                               │
                                                                ▼
                                                        ┌──────────────┐
                                                        │ Record Usage │
                                                        │ (waitUntil)  │
                                                        │              │
                                                        │ Deduct Bal   │
                                                        │ (waitUntil)  │
                                                        └──────────────┘
```

### 3.2 Blocked User Path (Cached)

```
┌──────────┐    ┌───────────────┐    ┌──────────────┐
│ Request  │───►│ Check Blocked │───►│ INSTANT 402  │
│ Arrives  │    │ Cache (KV)    │    │ Response     │
│          │    │ [< 1ms]       │    │              │
└──────────┘    └───────────────┘    └──────────────┘
                        │
                        │ FOUND IN CACHE
                        │
                        ▼
                ┌───────────────────────────────┐
                │ No D1 query                    │
                │ No LLM request                 │
                │ No memory retrieval            │
                │                               │
                │ Total time: ~1-2ms            │
                └───────────────────────────────┘
```

### 3.3 Insufficient Balance (First Detection)

```
┌──────────┐    ┌───────────────┐    ┌───────────────────────────────────┐
│ Request  │───►│ Check Blocked │───►│        PARALLEL EXECUTION          │
│ Arrives  │    │ Cache (KV)    │    │                                   │
│          │    │ [< 1ms]       │    │  ┌─────────────┐  ┌─────────────┐ │
└──────────┘    └───────┬───────┘    │  │  Balance    │  │   Memory    │ │
                        │            │  │  Check (D1) │  │  Retrieval  │ │
                        │ Not in     │  │  [5-15ms]   │  │  [10-50ms]  │ │
                        │ cache      │  └──────┬──────┘  └──────┬──────┘ │
                        ▼            │         │                │       │
                                     │         ▼                │       │
                                     │  ┌─────────────┐         │       │
                                     │  │ INSUFFICIENT│◄────────┘       │
                                     │  │ Balance!    │  ABORT SIGNAL   │
                                     │  └──────┬──────┘                 │
                                     │         │                         │
                                     └─────────┼─────────────────────────┘
                                               │
                                               ▼
                                     ┌───────────────────┐
                                     │ Add to Blocked    │
                                     │ Cache (KV)        │
                                     │                   │
                                     │ Return 402        │
                                     │ (LLM not called)  │
                                     └───────────────────┘
```

---

## 4. Blocked User Cache Design

### 4.1 Storage: Cloudflare KV
- **Why KV over DO?** KV is faster for simple key lookups (~1ms globally)
- **Why not in-memory?** Workers are stateless; cache must survive request isolation

### 4.2 Key Format
```
blocked:user:{userId}
```

Examples:
```
blocked:user:google_117234567890123456789
blocked:user:github_12345678
blocked:user:mk_abc123def456
```

### 4.3 Value Schema
```typescript
interface BlockedUserRecord {
  userId: string;
  reason: 'insufficient_balance' | 'suspended' | 'cap_reached';
  balance_cents: number;
  free_tokens_remaining: number;
  blockedAt: number;        // Unix timestamp ms
  ttlMs: number;            // 300000 (5 minutes)
}
```

### 4.4 TTL Strategy

| Scenario | TTL | Rationale |
|----------|-----|-----------|
| Insufficient balance | 5 minutes | User might top up; check periodically |
| Monthly cap reached | 5 minutes | Same |
| Account suspended | 30 minutes | Requires admin action, less frequent check |

### 4.5 Cache Invalidation

The blocked cache must be invalidated when:
1. User tops up balance (Stripe webhook)
2. Admin unsuspends account
3. New billing period starts

```typescript
// In webhook handler for Stripe payment success
await balanceGuard.removeFromBlockedCache(userId);

// In admin unsuspend endpoint
await balanceGuard.removeFromBlockedCache(userId);

// In billing period reset cron
await balanceGuard.removeFromBlockedCache(userId);
```

---

## 5. Usage Recording

### 5.1 What Gets Recorded

| Field | Description | Source |
|-------|-------------|--------|
| `timestamp` | Request time (Unix ms) | `Date.now()` |
| `memoryKey` | User's memory key | `userContext.memoryKey.key` |
| `sessionId` | Optional session | `X-Session-ID` header |
| `model` | Model used | Request body |
| `provider` | Provider (openai, anthropic, etc.) | Detected from model |
| `inputTokens` | User's original input | Count from messages |
| `outputTokens` | Model response | Response usage or estimate |
| `memoryTokensRetrieved` | Tokens from memory search | `retrieval.tokenCount` |
| `memoryTokensInjected` | Tokens actually injected | After truncation |
| `latencyEmbeddingMs` | Embedding time | Measured |
| `latencyMrMs` | Total MR processing | Measured |
| `latencyProviderMs` | Provider round-trip | Measured |

### 5.2 Usage Recording Flow

```typescript
// After successful response (in chat.ts)

if (env.VECTORS_D1) {
  const usageEvent: UsageEvent = {
    timestamp: Date.now(),
    memoryKey: userContext.memoryKey.key,
    sessionId: sessionId,
    model: body.model,
    provider: provider,
    inputTokens: responseUsage?.prompt_tokens ?? countMessagesTokens(body.messages),
    outputTokens: responseUsage?.completion_tokens ?? estimateTokens(assistantResponse),
    memoryTokensRetrieved: retrieval?.tokenCount ?? 0,
    memoryTokensInjected: memoryTokensUsed,
    latencyEmbeddingMs: embeddingMs,
    latencyMrMs: mrProcessingTime,
    latencyProviderMs: providerTime,
    requestType: 'chat',
  };
  
  // Fire-and-forget via waitUntil
  ctx.waitUntil(recordUsage(env.VECTORS_D1, usageEvent));
  
  // Also record billing (memory tokens only)
  ctx.waitUntil(recordBillingUsage(env.VECTORS_D1, userId, memoryTokensUsed, body.model, provider));
}
```

### 5.3 Update to `usage.ts`

Add a new function for billing-specific usage:

```typescript
/**
 * Record billable usage (memory tokens only)
 * Updates account balance and creates transaction
 */
export async function recordBillingUsage(
  db: D1Database,
  userId: string,
  memoryTokens: number,
  model: string,
  provider: string
): Promise<void> {
  if (memoryTokens === 0) return;
  
  try {
    const billing = new BillingService(db);
    
    await billing.recordUsage({
      accountId: userId,
      requestId: crypto.randomUUID(),
      model,
      provider,
      inputTokens: 0,      // Not billed
      memoryTokens,        // BILLED
      outputTokens: 0,     // Not billed
      truncationApplied: false,
    });
  } catch (error) {
    console.error('[BILLING] Failed to record usage:', error);
    // Don't throw - billing should never break requests
  }
}
```

---

## 6. Balance Deduction

### 6.1 Pricing Model
- **Rate:** $1 per 1M memory tokens = $0.000001/token = 0.0001 cents/token
- **Free tier:** 50M tokens
- **Billed:** Only memory tokens (injected context)

### 6.2 Deduction Flow

Already implemented in `BillingService.recordUsage()`:

```typescript
// 1. Calculate cost
const costCents = Math.ceil(memoryTokens * 0.0001);

// 2. Check free tier
if (account.free_tokens_remaining > 0) {
  freeTokensUsed = Math.min(memoryTokens, account.free_tokens_remaining);
  paidTokensUsed = memoryTokens - freeTokensUsed;
}

// 3. Deduct balance
const newBalance = account.balance_cents - Math.ceil(paidTokensUsed * 0.0001);

// 4. Update account
await db.prepare(`
  UPDATE accounts SET
    free_tokens_remaining = ?,
    balance_cents = ?,
    lifetime_tokens_used = ?,
    period_tokens_used = ?,
    period_spend_cents = ?
  WHERE id = ?
`).bind(newFreeTokens, newBalance, ...).run();

// 5. Create transaction record
await db.prepare(`
  INSERT INTO transactions (account_id, type, amount_cents, ...)
  VALUES (?, 'charge', ?, ...)
`).bind(userId, -costCents, ...).run();
```

### 6.3 D1 Queries

**Check Balance (fast path):**
```sql
SELECT 
  balance_cents,
  free_tokens_remaining,
  status,
  monthly_cap_cents,
  period_spend_cents
FROM accounts 
WHERE id = ?
```

**Deduct Balance (after request):**
```sql
UPDATE accounts SET
  balance_cents = balance_cents - ?,
  free_tokens_remaining = free_tokens_remaining - ?,
  lifetime_tokens_used = lifetime_tokens_used + ?,
  period_tokens_used = period_tokens_used + ?,
  period_spend_cents = period_spend_cents + ?,
  updated_at = unixepoch()
WHERE id = ?
```

**Record Transaction:**
```sql
INSERT INTO transactions (
  account_id, created_at, type, amount_cents,
  balance_before_cents, balance_after_cents,
  usage_record_id, description
) VALUES (?, unixepoch(), 'charge', ?, ?, ?, ?, ?)
```

---

## 7. Edge Cases

### 7.1 Balance Check Fails (D1 Timeout)

**Policy:** Fail OPEN (allow request)

```typescript
async checkBalanceAsync(userId: string): Promise<BalanceGuardResult> {
  try {
    const balanceCheck = await this.billing.checkBalance(userId);
    // ... normal processing
  } catch (error) {
    // D1 unavailable - allow request, log alert
    console.error('[BALANCE_GUARD] D1 check failed:', error);
    
    // Track for alerting
    ctx.waitUntil(alertOps('D1_BALANCE_CHECK_FAILED', { userId, error }));
    
    return {
      allowed: true,  // FAIL OPEN
      cached: false,
    };
  }
}
```

**Rationale:** Availability > strict billing enforcement. We can reconcile later.

### 7.2 User Tops Up Mid-Request

**Scenario:** User has $0, request starts, user tops up, request completes.

**Solution:** Balance is re-checked during usage recording:
1. Request proceeds (fail open if initial check fails)
2. Usage recording happens in `waitUntil`
3. At that point, new balance is used
4. No issue - they have balance now

**Edge case:** Request was already rejected (402) but user topped up:
- Next request will clear blocked cache (TTL expired or webhook cleared it)
- User retries and succeeds

### 7.3 Race Conditions with Concurrent Requests

**Scenario:** User sends 100 requests at once, each uses 1M tokens, balance is $50.

**Problem:** All 100 might pass the parallel check before any deduction.

**Solution:** Accept this as billing "float" with limits:

```typescript
// In balance check - add a buffer threshold
const CONCURRENT_REQUEST_BUFFER_CENTS = 500; // $5 buffer

const canProcess = 
  account.free_tokens_remaining > 0 || 
  account.balance_cents > CONCURRENT_REQUEST_BUFFER_CENTS;
```

**Mitigation strategies:**
1. Rate limiting at API gateway level (separate concern)
2. Per-minute token caps in billing settings
3. Accept small over-draft, reconcile monthly

### 7.4 Free Tier Handling

```typescript
async checkBalanceAsync(userId: string): Promise<BalanceGuardResult> {
  const balanceCheck = await this.billing.checkBalance(userId);
  
  // User can process if:
  // 1. Has free tokens remaining, OR
  // 2. Has positive balance
  const canProcess = 
    balanceCheck.free_tokens_remaining > 0 || 
    balanceCheck.balance_cents > 0;
  
  if (!canProcess) {
    // Only block if BOTH are exhausted
    await this.addToBlockedCache(...);
    return { allowed: false, ... };
  }
  
  return { allowed: true, ... };
}
```

### 7.5 Account Not Found

```typescript
async checkBalanceAsync(userId: string): Promise<BalanceGuardResult> {
  const account = await this.billing.getAccount(userId);
  
  if (!account) {
    // No account = can't bill = block request
    // This shouldn't happen if auth is working correctly
    console.error('[BALANCE_GUARD] Account not found:', userId);
    
    return {
      allowed: false,
      cached: false,
      reason: 'suspended', // Treat as suspended
    };
  }
  
  // ... continue with balance check
}
```

### 7.6 Streaming Abort

For streaming responses, we need to check the abort signal during the stream:

```typescript
// In streaming handler
return stream(c, async (streamWriter) => {
  const reader = providerResponse.body?.getReader();
  
  try {
    while (true) {
      // Check abort before each chunk
      if (balanceGuard.isAborted()) {
        // Stop streaming, return error
        await streamWriter.write(
          'data: {"error": "Insufficient balance", "code": "payment_required"}\n\n'
        );
        break;
      }
      
      const { done, value } = await reader.read();
      if (done) break;
      
      await streamWriter.write(decoder.decode(value));
    }
  } finally {
    reader.releaseLock();
  }
});
```

---

## 8. Implementation Steps

### Phase 1: Balance Guard Infrastructure (2 hours)

1. **Create `/workers/src/services/balance-guard.ts`**
   - [ ] `BalanceGuard` class
   - [ ] `checkBlockedCache()` method
   - [ ] `addToBlockedCache()` method
   - [ ] `removeFromBlockedCache()` method
   - [ ] `checkBalanceAsync()` method
   - [ ] Abort controller integration
   - [ ] Error response builders

2. **Add KV namespace binding**
   - [ ] Update `wrangler.toml` to add `BLOCKED_USERS_KV` (or reuse `METADATA_KV`)

### Phase 2: Integrate into Chat Route (2 hours)

3. **Update `/workers/src/routes/chat.ts`**
   - [ ] Import `BalanceGuard`
   - [ ] Add blocked cache check at request start
   - [ ] Add parallel balance check
   - [ ] Add abort check before provider forward
   - [ ] Add abort check in streaming loop
   - [ ] Update usage recording to include billing

4. **Enable billing**
   - [ ] Change `BILLING_ENABLED = true`
   - [ ] Test with free tier accounts

### Phase 3: Webhook Integration (1 hour)

5. **Update Stripe webhook handler**
   - [ ] On `checkout.session.completed`: clear blocked cache
   - [ ] On `invoice.payment_succeeded`: clear blocked cache
   - [ ] On `customer.subscription.deleted`: potentially block

6. **Add admin endpoints**
   - [ ] `POST /admin/users/:id/unblock` - clears blocked cache
   - [ ] `GET /admin/blocked-users` - list currently blocked

### Phase 4: Testing & Monitoring (2 hours)

7. **Unit tests**
   - [ ] Test blocked cache operations
   - [ ] Test balance check with various balances
   - [ ] Test abort mechanism
   - [ ] Test concurrent request handling

8. **Integration tests**
   - [ ] Test full flow: request → balance check → usage recording
   - [ ] Test blocked user rejection
   - [ ] Test top-up → unblock flow

9. **Monitoring**
   - [ ] Add metrics for blocked requests
   - [ ] Add metrics for balance check latency
   - [ ] Alert on D1 failures

---

## 9. Testing Plan

### 9.1 Unit Tests

```typescript
// tests/balance-guard.test.ts

describe('BalanceGuard', () => {
  describe('checkBlockedCache', () => {
    it('returns null when user not blocked');
    it('returns record when user is blocked');
    it('returns null when TTL expired');
    it('deletes expired records');
  });
  
  describe('addToBlockedCache', () => {
    it('stores with correct TTL');
    it('includes all required fields');
  });
  
  describe('checkBalanceAsync', () => {
    it('allows when free tokens available');
    it('allows when balance positive');
    it('blocks when both exhausted');
    it('blocks when account suspended');
    it('blocks when monthly cap reached');
    it('allows on D1 error (fail open)');
    it('adds to blocked cache on denial');
  });
  
  describe('abort', () => {
    it('signals abort controller');
    it('isAborted returns true after abort');
  });
});
```

### 9.2 Integration Tests

```typescript
// tests/billing-integration.test.ts

describe('Billing Flow', () => {
  describe('Request with balance', () => {
    it('completes successfully');
    it('records usage');
    it('deducts from balance');
    it('creates transaction');
  });
  
  describe('Request without balance', () => {
    it('returns 402');
    it('adds to blocked cache');
    it('second request is instant 402');
  });
  
  describe('After top-up', () => {
    it('clears blocked cache');
    it('subsequent request succeeds');
  });
  
  describe('Free tier', () => {
    it('uses free tokens first');
    it('switches to paid when free exhausted');
    it('blocks when both exhausted');
  });
});
```

### 9.3 Load Testing

```bash
# Simulate burst of requests from blocked user
ab -n 1000 -c 100 \
  -H "Authorization: Bearer mk_blocked_user" \
  https://api.memoryrouter.ai/v1/chat/completions

# Expect: 100% 402 responses, avg latency < 5ms
```

### 9.4 Manual Testing Checklist

- [ ] Create new account, verify 50M free tokens
- [ ] Make request, verify free tokens decrease
- [ ] Exhaust free tokens, verify switch to balance
- [ ] Exhaust balance, verify 402 response
- [ ] Verify second request is instant 402 (cached)
- [ ] Top up via Stripe, verify request succeeds
- [ ] Verify blocked cache cleared after top-up
- [ ] Test streaming abort mid-response

---

## Appendix A: Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `/workers/src/services/balance-guard.ts` | CREATE | New balance guard service |
| `/workers/src/routes/chat.ts` | MODIFY | Integrate balance checking |
| `/workers/src/services/usage.ts` | MODIFY | Add billing usage function |
| `/workers/wrangler.toml` | MODIFY | Add KV binding if needed |
| `/dashboard/src/app/api/webhooks/stripe/route.ts` | MODIFY | Clear blocked cache on payment |
| `/workers/src/routes/admin.ts` | MODIFY | Add unblock endpoint |

## Appendix B: Environment Variables

```toml
# wrangler.toml additions (if using separate KV)

[[kv_namespaces]]
binding = "BLOCKED_CACHE_KV"
id = "your-kv-namespace-id"
```

Or reuse `METADATA_KV` with the `blocked:user:` prefix (recommended for simplicity).

## Appendix C: Estimated Costs

| Operation | Cost | Frequency |
|-----------|------|-----------|
| KV read (blocked check) | $0.50/1M reads | Every request |
| KV write (block user) | $5/1M writes | On block events |
| D1 read (balance check) | $0.75/1M reads | Every request |
| D1 write (usage record) | $1/1M writes | Every request |

For 1M requests/month:
- KV: ~$0.50 (reads) + ~$0.01 (writes) = **$0.51**
- D1: ~$0.75 (reads) + ~$1.00 (writes) = **$1.75**
- **Total: ~$2.26/month** for billing infrastructure

---

*MemoryRouter Billing Implementation Plan v1.0 — February 2026*
