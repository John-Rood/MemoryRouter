# MemoryRouter: Full Modularization Plan

**Date:** 2026-02-14  
**Author:** Architecture Analysis (Claudius)  
**Version:** 1.0  
**Prior Work:** [ARCHITECTURE_REFACTOR_PLAN.md](./ARCHITECTURE_REFACTOR_PLAN.md) — Covers memory-core.ts (storage) and memory-retrieval.ts (search)

---

## 1. Executive Summary

**The Problem:** `chat.ts` is the source of truth with 1089 lines containing ALL MemoryRouter features. `anthropic.ts` (551 lines) and `google.ts` (365 lines) are missing critical capabilities: truncation, DO+D1 race, KRONOS window config, full billing flow, and buffer handling.

**The Solution:** Extract EVERY MemoryRouter-specific function into shared services. Each capability gets ONE implementation. Provider routes become thin wrappers that only handle format transformation.

**The Result:** Feature parity across all providers. Bug fixes apply once. New providers add with zero business logic — just parse input, inject memory, forward, extract response, format output.

---

## 2. Current State Analysis

### 2.1 Feature Matrix: What Each Provider Has

| Feature | chat.ts | anthropic.ts | google.ts |
|---------|---------|--------------|-----------|
| **Memory Retrieval** | ✅ DO+D1 race | ⚠️ D1 only | ⚠️ D1 only |
| **Memory Storage** | ✅ Full | ✅ Full | ❌ Missing |
| **Truncation** | ✅ Full | ❌ Missing | ❌ Missing |
| **Buffer Handling** | ✅ DO+D1 merge | ⚠️ D1 only | ⚠️ D1 only |
| **KRONOS Config** | ✅ Env vars | ⚠️ Hardcoded | ⚠️ Hardcoded |
| **Billing Check** | ✅ ensureBalance + auto-charge | ⚠️ Basic check | ⚠️ Basic billing |
| **Usage Recording** | ✅ Full | ✅ Full | ⚠️ Partial |
| **Memory Options** | ✅ parseMemoryOptions + body | ⚠️ Inline parsing | ⚠️ No options |
| **Streaming** | ✅ Full | ✅ Full | ✅ Full |
| **Debug Headers** | ✅ Full latency breakdown | ⚠️ Basic | ⚠️ Basic |

### 2.2 Existing Services (Already Extracted)

| Service File | Status | What It Does |
|--------------|--------|--------------|
| `services/truncation.ts` | ✅ COMPLETE | truncateToFit, buildTruncationHeader, rebuildRetrievalResult, token counting |
| `services/balance-guard.ts` | ✅ COMPLETE | BalanceGuard class, blocked cache, balance check, usage deduction |
| `services/usage.ts` | ✅ COMPLETE | recordUsage, getKeyUsage, rollupDaily |
| `services/d1-search.ts` | ✅ COMPLETE | searchD1, mirrorToD1, mirrorBufferToD1, getBufferFromD1, clearBufferFromD1 |
| `services/do-router.ts` | ✅ COMPLETE | resolveVaultsForQuery, resolveVaultForStore |
| `services/kronos-do.ts` | ✅ COMPLETE | buildSearchPlan, executeSearchPlan, storeToVault |
| `services/providers.ts` | ✅ COMPLETE | detectProvider, forwardToProvider, generateEmbedding, extractResponseContent |
| `services/balance-checkpoint.ts` | ✅ COMPLETE | ensureBalance, buildPaymentRequiredResponse, checkAndReupIfNeeded |

### 2.3 What's NOT Yet Modularized

These capabilities exist ONLY in chat.ts and need extraction:

| Capability | Location in chat.ts | Lines | Problem |
|------------|---------------------|-------|---------|
| **DO+D1 Race Logic** | Lines 178-280 | ~100 | Duplicated inline, not callable by other routes |
| **KRONOS Config from Env** | Lines 210-214 | ~5 | Hardcoded in other routes as DEFAULT_KRONOS_CONFIG |
| **Memory Options Parsing** | Imports from middleware/memory | N/A | Other routes do inline ad-hoc parsing |
| **Buffer Merge with Race Winner** | Lines 245-270 | ~25 | Complex logic for DO vs D1 buffer handling |
| **Debug Headers Generation** | Lines 530-560 | ~30 | Full latency breakdown not in other routes |
| **Inline storeConversationDO** | Lines 878-982 | ~100 | Should use memory-core.ts from ARCHITECTURE_REFACTOR_PLAN |

---

## 3. Core Services Design

### 3.1 services/memory-options.ts — Parse Headers/Body into Options

**Purpose:** Centralize ALL memory option parsing. One function to extract options from any provider's request.

```typescript
// services/memory-options.ts

/**
 * Memory mode controls retrieval and storage behavior
 */
export type MemoryMode = 'default' | 'read' | 'write' | 'off' | 'none';

/**
 * Parsed memory options — same structure for ALL providers
 */
export interface MemoryOptions {
  /** Memory mode: default (read+write), read (no store), write (no retrieve), off/none (disabled) */
  mode: MemoryMode;
  /** Maximum tokens of memory to inject */
  contextLimit: number;
  /** Store user input messages */
  storeInput: boolean;
  /** Store assistant responses */
  storeResponse: boolean;
  /** Session ID for session-scoped memory */
  sessionId?: string;
}

/**
 * Default options when nothing is specified
 */
export const DEFAULT_MEMORY_OPTIONS: MemoryOptions = {
  mode: 'default',
  contextLimit: 8000,
  storeInput: true,
  storeResponse: true,
  sessionId: undefined,
};

/**
 * Parse memory options from HTTP headers.
 * Works for ANY provider — headers are provider-agnostic.
 * 
 * Headers:
 * - X-Memory-Mode: default | read | write | off | none
 * - X-Context-Limit: number (max tokens)
 * - X-Session-ID: string (session scope)
 * - X-Store-Input: true | false
 * - X-Store-Response: true | false
 */
export function parseMemoryOptionsFromHeaders(headers: Headers): MemoryOptions {
  const options: MemoryOptions = { ...DEFAULT_MEMORY_OPTIONS };

  // Memory mode
  const modeHeader = headers.get('X-Memory-Mode')?.toLowerCase();
  if (modeHeader && ['default', 'read', 'write', 'off', 'none'].includes(modeHeader)) {
    options.mode = modeHeader as MemoryMode;
  }

  // Context limit
  const limitHeader = headers.get('X-Context-Limit');
  if (limitHeader) {
    const parsed = parseInt(limitHeader, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 100000) {
      options.contextLimit = parsed;
    }
  }

  // Session ID
  const sessionHeader = headers.get('X-Session-ID');
  if (sessionHeader) {
    options.sessionId = sessionHeader;
  }

  // Store flags
  const storeInput = headers.get('X-Store-Input')?.toLowerCase();
  if (storeInput === 'false') options.storeInput = false;
  if (storeInput === 'true') options.storeInput = true;

  const storeResponse = headers.get('X-Store-Response')?.toLowerCase();
  if (storeResponse === 'false') options.storeResponse = false;
  if (storeResponse === 'true') options.storeResponse = true;

  // Mode implications
  if (options.mode === 'read') {
    options.storeInput = false;
    options.storeResponse = false;
  } else if (options.mode === 'write') {
    // Write-only: no retrieval, but store options remain
  } else if (options.mode === 'off' || options.mode === 'none') {
    options.storeInput = false;
    options.storeResponse = false;
  }

  return options;
}

/**
 * Parse memory options from request body fields.
 * Provider-agnostic — looks for common field names.
 * 
 * Body fields (all optional, stripped before forwarding):
 * - memory_mode: string
 * - context_limit: number
 * - session_id: string
 * - store_input: boolean
 * - store_response: boolean
 * 
 * Returns options AND cleaned body (without MR fields).
 */
export function parseMemoryOptionsFromBody(
  body: Record<string, unknown>,
  headerOptions: MemoryOptions
): { options: MemoryOptions; cleanBody: Record<string, unknown> } {
  const options: MemoryOptions = { ...headerOptions };
  const cleanBody: Record<string, unknown> = {};

  // Copy body, stripping MR-specific fields
  for (const [key, value] of Object.entries(body)) {
    if (['memory_mode', 'context_limit', 'session_id', 'store_input', 'store_response'].includes(key)) {
      continue; // Don't copy to cleanBody
    }
    cleanBody[key] = value;
  }

  // Parse body options (override headers)
  const bodyMode = body.memory_mode as string | undefined;
  if (bodyMode && ['default', 'read', 'write', 'off', 'none'].includes(bodyMode.toLowerCase())) {
    options.mode = bodyMode.toLowerCase() as MemoryMode;
  }

  const bodyLimit = body.context_limit as number | undefined;
  if (typeof bodyLimit === 'number' && bodyLimit > 0 && bodyLimit <= 100000) {
    options.contextLimit = bodyLimit;
  }

  const bodySessionId = body.session_id as string | undefined;
  if (bodySessionId) {
    options.sessionId = bodySessionId;
  }

  if (body.store_input === false) options.storeInput = false;
  if (body.store_input === true) options.storeInput = true;
  if (body.store_response === false) options.storeResponse = false;
  if (body.store_response === true) options.storeResponse = true;

  return { options, cleanBody };
}

/**
 * Strip per-message memory flags from messages array.
 * Some SDKs pass memory: false on individual messages.
 * 
 * Works for OpenAI format ({ role, content, memory? })
 * and Anthropic format ({ role, content: [blocks], memory? })
 */
export function stripMessageMemoryFlags<T extends { memory?: boolean }>(
  messages: T[]
): T[] {
  return messages.map(msg => {
    const { memory, ...rest } = msg;
    return rest as T;
  });
}

/**
 * Check if memory retrieval should happen based on options
 */
export function shouldRetrieveMemory(options: MemoryOptions): boolean {
  return options.mode !== 'off' && options.mode !== 'none' && options.mode !== 'write';
}

/**
 * Check if memory storage should happen based on options
 */
export function shouldStoreMemory(options: MemoryOptions): boolean {
  return options.mode !== 'off' && options.mode !== 'none' && options.mode !== 'read';
}
```

---

### 3.2 services/kronos-config.ts — Centralized Time Window Config

**Purpose:** Single source of truth for KRONOS time windows. No more hardcoded values.

```typescript
// services/kronos-config.ts

/**
 * KRONOS time window configuration.
 * Controls how memory is balanced across recency tiers.
 */
export interface KronosConfig {
  /** Hot window: last N hours (most recent, highest priority) */
  hotWindowHours: number;
  /** Working window: last N days (recent context) */
  workingWindowDays: number;
  /** Long-term window: last N days (historical knowledge) */
  longtermWindowDays: number;
}

/**
 * Default KRONOS configuration
 */
export const DEFAULT_KRONOS_CONFIG: KronosConfig = {
  hotWindowHours: 4,
  workingWindowDays: 3,
  longtermWindowDays: 90,
};

/**
 * Build KRONOS config from environment variables.
 * Falls back to defaults for any missing value.
 * 
 * Environment variables:
 * - HOT_WINDOW_HOURS: number (default: 4)
 * - WORKING_WINDOW_DAYS: number (default: 3)
 * - LONGTERM_WINDOW_DAYS: number (default: 90)
 */
export function getKronosConfig(env: {
  HOT_WINDOW_HOURS?: string;
  WORKING_WINDOW_DAYS?: string;
  LONGTERM_WINDOW_DAYS?: string;
}): KronosConfig {
  return {
    hotWindowHours: parseIntOrDefault(env.HOT_WINDOW_HOURS, DEFAULT_KRONOS_CONFIG.hotWindowHours),
    workingWindowDays: parseIntOrDefault(env.WORKING_WINDOW_DAYS, DEFAULT_KRONOS_CONFIG.workingWindowDays),
    longtermWindowDays: parseIntOrDefault(env.LONGTERM_WINDOW_DAYS, DEFAULT_KRONOS_CONFIG.longtermWindowDays),
  };
}

/**
 * Get timestamp cutoffs for each window
 */
export function getWindowCutoffs(config: KronosConfig): {
  hotCutoff: number;
  workingCutoff: number;
  longtermCutoff: number;
} {
  const now = Date.now();
  return {
    hotCutoff: now - config.hotWindowHours * 60 * 60 * 1000,
    workingCutoff: now - config.workingWindowDays * 24 * 60 * 60 * 1000,
    longtermCutoff: now - config.longtermWindowDays * 24 * 60 * 60 * 1000,
  };
}

/**
 * Classify a timestamp into a KRONOS window
 */
export function classifyWindow(
  timestamp: number,
  config: KronosConfig
): 'hot' | 'working' | 'longterm' | 'archive' {
  const cutoffs = getWindowCutoffs(config);
  
  if (timestamp > cutoffs.hotCutoff) return 'hot';
  if (timestamp > cutoffs.workingCutoff) return 'working';
  if (timestamp > cutoffs.longtermCutoff) return 'longterm';
  return 'archive';
}

function parseIntOrDefault(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}
```

---

### 3.3 services/memory-retrieval.ts — Unified Search with DO+D1 Race

**Purpose:** ONE function for memory retrieval that ALL providers use. Includes DO+D1 race, buffer merge, truncation-ready output.

```typescript
// services/memory-retrieval.ts

import { DurableObjectNamespace, D1Database } from '@cloudflare/workers-types';
import { resolveVaultsForQuery } from './do-router';
import { buildSearchPlan, executeSearchPlan } from './kronos-do';
import { searchD1, getBufferFromD1 } from './d1-search';
import { generateEmbedding, EmbeddingConfig } from './providers';
import { KronosConfig, DEFAULT_KRONOS_CONFIG } from './kronos-config';
import type { MemoryChunk, MemoryRetrievalResult } from '../types/do';

// ==================== TYPES ====================

export interface SearchMemoryParams {
  /** Durable Object namespace binding (required for DO+D1 race) */
  doNamespace?: DurableObjectNamespace;
  /** D1 database for fallback search */
  d1: D1Database;
  /** User's memory key */
  memoryKey: string;
  /** Optional session ID */
  sessionId?: string;
  /** Query text to search for */
  query: string;
  /** Max chunks to return */
  limit?: number;
  /** Embedding configuration */
  embeddingConfig: EmbeddingConfig;
  /** KRONOS time window config */
  kronosConfig?: KronosConfig;
  /** Use DO+D1 race (true) or D1-only (false) */
  useRace?: boolean;
}

export interface SearchResult {
  /** Retrieved memory chunks (sorted by relevance) */
  chunks: MemoryChunk[];
  /** Total token count */
  tokenCount: number;
  /** Breakdown by time window */
  windowBreakdown: { hot: number; working: number; longterm: number };
  /** Pending buffer content (merged into chunks) */
  buffer?: { content: string; tokenCount: number; lastUpdated: number };
  /** Search performance metrics */
  metrics: {
    embeddingMs: number;
    raceMs: number;
    winner: 'do' | 'd1' | 'none';
    totalChunksSearched: number;
  };
}

// ==================== SEARCH ====================

/**
 * Search memory with DO+D1 race (fastest wins).
 * 
 * This is THE ONLY function that searches memory.
 * All provider routes call this — no duplicated search logic.
 * 
 * Flow:
 * 1. Generate query embedding via Cloudflare AI
 * 2. Race DO search vs D1 search (fastest wins)
 * 3. Merge buffer content into results
 * 4. Return unified result with metrics
 */
export async function searchMemory(params: SearchMemoryParams): Promise<SearchResult> {
  const {
    doNamespace,
    d1,
    memoryKey,
    sessionId,
    query,
    limit = 30,
    embeddingConfig,
    kronosConfig = DEFAULT_KRONOS_CONFIG,
    useRace = true,
  } = params;

  // Generate query embedding
  const embedStart = Date.now();
  const queryEmbedding = await generateEmbedding(query, undefined, undefined, embeddingConfig);
  const embeddingMs = Date.now() - embedStart;

  // ===== NO DO or race disabled: D1-only path =====
  if (!doNamespace || !useRace) {
    const d1Start = Date.now();
    const d1Result = await searchD1(d1, queryEmbedding, memoryKey, sessionId, limit, kronosConfig);
    const d1Buffer = await getBufferFromD1(d1, memoryKey, sessionId);
    const d1Ms = Date.now() - d1Start;

    return buildSearchResult(d1Result, d1Buffer, {
      embeddingMs,
      raceMs: d1Ms,
      winner: 'd1',
      totalChunksSearched: d1Result.chunks.length,
    });
  }

  // ===== DO+D1 RACE: Fastest wins =====
  const raceStart = Date.now();

  // Resolve which vaults to query
  const vaults = resolveVaultsForQuery(doNamespace, memoryKey, sessionId);
  const plan = buildSearchPlan(vaults, limit, kronosConfig);

  type RaceResult = {
    source: 'do' | 'd1';
    result: MemoryRetrievalResult;
    time: number;
  };

  // Start ALL promises at once — no await until race completes
  const doPromise = executeSearchPlan(plan, queryEmbedding)
    .then(r => ({ source: 'do' as const, result: r, time: Date.now() - raceStart }))
    .catch(() => null);

  const d1Promise = searchD1(d1, queryEmbedding, memoryKey, sessionId, limit, kronosConfig)
    .then(r => ({ source: 'd1' as const, result: r, time: Date.now() - raceStart }))
    .catch(() => null);

  const bufferPromise = getBufferFromD1(d1, memoryKey, sessionId).catch(() => null);

  // Race: first successful result wins
  const doRace = doPromise.then(r => r?.result ? r : Promise.reject('no result'));
  const d1Race = d1Promise.then(r => r?.result ? r : Promise.reject('no result'));

  let winner: RaceResult | null = null;
  try {
    winner = await Promise.any([doRace, d1Race]) as RaceResult;
  } catch {
    // Both failed — empty result
    winner = null;
  }

  const raceMs = Date.now() - raceStart;
  const raceWinner = winner?.source || 'none';

  // Handle buffer based on race winner
  let bufferData: { content: string; tokenCount: number; lastUpdated: number } | null = null;

  if (winner?.source === 'do') {
    // DO response includes buffer — extract it
    const doBuffer = (winner.result as any).buffer;
    if (doBuffer?.content && doBuffer.tokenCount > 0) {
      bufferData = {
        content: doBuffer.content,
        tokenCount: doBuffer.tokenCount,
        lastUpdated: doBuffer.lastUpdated || Date.now(),
      };
    }
  } else if (winner?.source === 'd1') {
    // D1 won — await buffer promise
    const d1Buffer = await bufferPromise;
    if (d1Buffer?.content && d1Buffer.tokenCount > 0) {
      bufferData = d1Buffer;
    }
  }

  return buildSearchResult(winner?.result || { chunks: [], tokenCount: 0, windowBreakdown: { hot: 0, working: 0, longterm: 0 } }, bufferData, {
    embeddingMs,
    raceMs,
    winner: raceWinner,
    totalChunksSearched: winner?.result.chunks.length || 0,
  });
}

/**
 * Build final SearchResult with buffer merged into chunks
 */
function buildSearchResult(
  retrieval: MemoryRetrievalResult,
  buffer: { content: string; tokenCount: number; lastUpdated: number } | null,
  metrics: SearchResult['metrics']
): SearchResult {
  const chunks = [...retrieval.chunks];
  let tokenCount = retrieval.tokenCount;
  const windowBreakdown = { ...retrieval.windowBreakdown };

  // Merge buffer as a special "hot" chunk
  if (buffer?.content && buffer.tokenCount > 0) {
    chunks.push({
      id: -1, // Special buffer ID
      role: 'system' as const,
      content: buffer.content,
      timestamp: buffer.lastUpdated,
      score: 1.0, // Buffer always has max relevance
      window: 'hot' as const,
      source: 'buffer',
    });
    tokenCount += buffer.tokenCount;
    windowBreakdown.hot++;
  }

  return {
    chunks,
    tokenCount,
    windowBreakdown,
    buffer: buffer || undefined,
    metrics,
  };
}

// ==================== QUERY BUILDING ====================

/**
 * Extract query text from OpenAI-format messages.
 * Takes last N messages for context.
 */
export function extractQueryFromOpenAI(
  messages: Array<{ role: string; content: string }>,
  limit: number = 3
): string {
  const parts: string[] = [];
  const recent = messages.slice(-limit);
  
  for (const msg of recent) {
    const role = msg.role.toUpperCase();
    parts.push(`[${role}] ${msg.content}`);
  }
  
  return parts.join('\n\n');
}

/**
 * Extract query text from Anthropic-format messages.
 * Handles both string and content block formats.
 */
export function extractQueryFromAnthropic(
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>,
  system?: string,
  limit: number = 3
): string {
  const parts: string[] = [];
  const recent = messages.slice(-limit);
  
  for (const msg of recent) {
    let text: string;
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter(c => c.type === 'text' && c.text)
        .map(c => c.text!)
        .join('\n');
    } else {
      continue;
    }
    
    const role = msg.role.toUpperCase();
    parts.push(`[${role}] ${text}`);
  }
  
  return parts.join('\n\n');
}

/**
 * Extract query text from Google/Gemini-format contents.
 */
export function extractQueryFromGoogle(
  contents: Array<{ role: string; parts: Array<{ text?: string }> }>,
  limit: number = 3
): string {
  const parts: string[] = [];
  const recent = contents.slice(-limit);
  
  for (const content of recent) {
    const text = content.parts
      .filter(p => p.text)
      .map(p => p.text!)
      .join('\n');
    
    const role = content.role === 'model' ? 'ASSISTANT' : 'USER';
    parts.push(`[${role}] ${text}`);
  }
  
  return parts.join('\n\n');
}
```

---

### 3.4 services/memory-billing.ts — Unified Billing Flow

**Purpose:** Wrap balance-guard.ts and balance-checkpoint.ts into a single interface for ALL providers.

```typescript
// services/memory-billing.ts

import { 
  BalanceGuard, 
  createBalanceGuard, 
  buildBlockedUserResponse,
  buildInsufficientBalanceResponse,
  type BlockedUserRecord,
} from './balance-guard';
import {
  ensureBalance,
  buildPaymentRequiredResponse,
  checkAndReupIfNeeded,
  type EnsureBalanceResult,
} from './balance-checkpoint';

// ==================== TYPES ====================

export interface BillingContext {
  kv: KVNamespace;
  db: D1Database;
  stripeKey?: string;
}

export interface BillingCheckResult {
  allowed: boolean;
  response?: Response;  // Pre-built 402 response if blocked
  charged?: boolean;
  amountCharged?: number;
  paymentIntentId?: string;
}

// ==================== BILLING FUNCTIONS ====================

/**
 * Run pre-request billing check.
 * Call this BEFORE the LLM call — returns 402 if blocked.
 * 
 * Flow:
 * 1. Check blocked cache (instant rejection)
 * 2. Check balance + auto-charge if needed
 * 3. Return allowed=true to proceed, or allowed=false with 402 response
 */
export async function checkBillingBeforeRequest(
  ctx: BillingContext,
  userId: string,
  estimatedTokens: number = 1000
): Promise<BillingCheckResult> {
  const balanceGuard = createBalanceGuard(ctx.kv, ctx.db);

  // Step 1: Check blocked cache (fast path)
  const blockedRecord = await balanceGuard.checkBlockedCache(userId);
  if (blockedRecord) {
    console.log(`[BILLING] Blocked user (cached): ${userId} - ${blockedRecord.reason}`);
    return {
      allowed: false,
      response: buildBlockedUserResponse(blockedRecord),
    };
  }

  // Step 2: Ensure balance (may auto-charge)
  const ensureResult = await ensureBalance(ctx.db, userId, estimatedTokens, ctx.stripeKey);

  if (!ensureResult.allowed) {
    console.log(`[BILLING] Balance check failed: ${userId} - ${ensureResult.error}`);

    // Add to blocked cache for subsequent requests
    if (ensureResult.error === 'no_payment_method') {
      await balanceGuard.addToBlockedCache(
        userId,
        'insufficient_balance',
        ensureResult.projectedBalance ?? 0,
        ensureResult.freeTokensRemaining ?? 0
      );
    }

    return {
      allowed: false,
      response: buildPaymentRequiredResponse(ensureResult),
    };
  }

  // Log auto-charge if it happened
  if (ensureResult.charged) {
    console.log(`[BILLING] Auto-charged ${userId}: $${((ensureResult.amountCharged || 0) / 100).toFixed(2)} (PI: ${ensureResult.paymentIntentId})`);
  }

  return {
    allowed: true,
    charged: ensureResult.charged,
    amountCharged: ensureResult.amountCharged,
    paymentIntentId: ensureResult.paymentIntentId,
  };
}

/**
 * Record usage after successful request.
 * Call via ctx.waitUntil() — fire-and-forget.
 * 
 * Flow:
 * 1. Deduct tokens from user balance
 * 2. Check if balance fell below threshold
 * 3. Auto-reup if needed
 */
export async function recordBillingAfterRequest(
  ctx: BillingContext,
  userId: string,
  totalTokens: number,
  model: string,
  provider: string,
  sessionId?: string
): Promise<void> {
  if (totalTokens <= 0) return;

  const balanceGuard = createBalanceGuard(ctx.kv, ctx.db);

  // Deduct usage
  await balanceGuard.recordUsageAndDeduct(userId, totalTokens, model, provider, sessionId);

  // Check if we need to auto-reup
  await checkAndReupIfNeeded(ctx.db, userId, ctx.stripeKey);

  console.log(`[BILLING] Recorded usage: ${userId} - ${totalTokens} tokens (${model})`);
}

/**
 * Check if billing is enabled based on environment
 */
export function isBillingEnabled(env: { 
  VECTORS_D1?: D1Database; 
  METADATA_KV?: KVNamespace;
}): boolean {
  return !!(env.VECTORS_D1 && env.METADATA_KV);
}
```

---

### 3.5 services/debug-headers.ts — Latency and Debug Headers

**Purpose:** Consistent debug header generation for ALL providers.

```typescript
// services/debug-headers.ts

import type { SearchResult } from './memory-retrieval';
import type { TruncationResult } from './truncation';
import type { MemoryOptions } from './memory-options';

// ==================== TYPES ====================

export interface LatencyMetrics {
  startTime: number;
  embeddingMs?: number;
  raceMs?: number;
  raceWinner?: 'do' | 'd1' | 'none';
  postProcessMs?: number;
  mrProcessingMs: number;
  providerResponseMs?: number;
  totalMs?: number;
}

export interface MemoryMetrics {
  tokensRetrieved: number;
  chunksRetrieved: number;
  tokensInjected: number;
  injectionFormat?: string;
}

// ==================== HEADER BUILDERS ====================

/**
 * Build all memory-related response headers.
 * Consistent format for ALL providers.
 */
export function buildMemoryHeaders(
  metrics: LatencyMetrics,
  memory: MemoryMetrics,
  options: MemoryOptions,
  truncation?: TruncationResult
): Headers {
  const headers = new Headers();

  // Memory metrics
  headers.set('X-Memory-Tokens-Retrieved', String(memory.tokensRetrieved));
  headers.set('X-Memory-Chunks-Retrieved', String(memory.chunksRetrieved));
  headers.set('X-Memory-Tokens-Injected', String(memory.tokensInjected));
  if (memory.injectionFormat) {
    headers.set('X-Memory-Injection-Format', memory.injectionFormat);
  }

  // Options
  headers.set('X-Memory-Mode', options.mode);
  if (options.sessionId) {
    headers.set('X-Session-ID', options.sessionId);
  }

  // Latency breakdown
  if (metrics.embeddingMs !== undefined) {
    headers.set('X-Embedding-Ms', String(metrics.embeddingMs));
  }
  if (metrics.raceMs !== undefined) {
    headers.set('X-Race-Ms', String(metrics.raceMs));
  }
  if (metrics.raceWinner) {
    headers.set('X-Race-Winner', metrics.raceWinner);
  }
  if (metrics.postProcessMs !== undefined) {
    headers.set('X-PostProcess-Ms', String(metrics.postProcessMs));
  }
  headers.set('X-MR-Processing-Ms', String(metrics.mrProcessingMs));
  if (metrics.providerResponseMs !== undefined) {
    headers.set('X-Provider-Response-Ms', String(metrics.providerResponseMs));
  }
  if (metrics.totalMs !== undefined) {
    headers.set('X-Total-Ms', String(metrics.totalMs));
  }
  headers.set('X-MR-Overhead-Ms', String(metrics.mrProcessingMs - (metrics.embeddingMs || 0)));

  // Truncation
  if (truncation?.truncated) {
    headers.set('X-MemoryRouter-Truncated', 'true');
    headers.set('X-MemoryRouter-Tokens-Removed', String(truncation.tokensRemoved));
    
    const parts: string[] = [];
    if (truncation.truncationDetails.conversationMessagesRemoved > 0) {
      parts.push(`conv:${truncation.truncationDetails.conversationMessagesRemoved}`);
    }
    if (truncation.truncationDetails.archiveChunksRemoved > 0) {
      parts.push(`archive:${truncation.truncationDetails.archiveChunksRemoved}`);
    }
    if (truncation.truncationDetails.longtermChunksRemoved > 0) {
      parts.push(`longterm:${truncation.truncationDetails.longtermChunksRemoved}`);
    }
    if (truncation.truncationDetails.workingChunksRemoved > 0) {
      parts.push(`working:${truncation.truncationDetails.workingChunksRemoved}`);
    }
    if (truncation.truncationDetails.hotChunksRemoved > 0) {
      parts.push(`hot:${truncation.truncationDetails.hotChunksRemoved}`);
    }
    if (parts.length > 0) {
      headers.set('X-MemoryRouter-Truncated-Details', parts.join(','));
    }
  }

  return headers;
}

/**
 * Build debug response body (only included when debug mode enabled)
 */
export function buildDebugBody(
  searchResult: SearchResult | null,
  truncation: TruncationResult | null,
  metrics: LatencyMetrics,
  options: MemoryOptions,
  originalMessages: unknown[],
  augmentedMessages: unknown[],
  model: string,
  provider: string
): Record<string, unknown> {
  return {
    _memory: searchResult ? {
      tokens_retrieved: searchResult.tokenCount,
      memories_retrieved: searchResult.chunks.length,
      window_breakdown: searchResult.windowBreakdown,
      memories: searchResult.chunks,
    } : null,
    _latency: {
      embedding_ms: metrics.embeddingMs,
      race_ms: metrics.raceMs,
      race_winner: metrics.raceWinner,
      post_process_ms: metrics.postProcessMs,
      mr_processing_ms: metrics.mrProcessingMs,
      mr_overhead_ms: metrics.mrProcessingMs - (metrics.embeddingMs || 0),
      provider_ms: metrics.providerResponseMs,
      total_ms: metrics.totalMs,
    },
    _truncation: truncation?.truncated ? {
      truncated: true,
      tokens_removed: truncation.tokensRemoved,
      details: truncation.truncationDetails,
    } : null,
    _options: {
      mode: options.mode,
      context_limit: options.contextLimit,
      session_id: options.sessionId,
    },
    _debug: {
      original_messages: originalMessages,
      augmented_messages: augmentedMessages,
      model,
      provider,
    },
  };
}
```

---

## 4. Provider Route Refactor

### 4.1 chat.ts Changes

**Current:** 1089 lines with all logic inline

**After:** ~400 lines — thin wrapper calling services

```typescript
// routes/chat.ts — KEY CHANGES

import { parseMemoryOptionsFromHeaders, parseMemoryOptionsFromBody, shouldRetrieveMemory, shouldStoreMemory } from '../services/memory-options';
import { getKronosConfig } from '../services/kronos-config';
import { searchMemory, extractQueryFromOpenAI } from '../services/memory-retrieval';
import { checkBillingBeforeRequest, recordBillingAfterRequest, isBillingEnabled } from '../services/memory-billing';
import { buildMemoryHeaders, buildDebugBody } from '../services/debug-headers';
import { truncateToFit, rebuildRetrievalResult } from '../services/truncation';
import { storeConversation } from '../services/memory-core'; // From ARCHITECTURE_REFACTOR_PLAN

// In handler:

// 1. Parse options (one call)
let memoryOptions = parseMemoryOptionsFromHeaders(c.req.headers);
const { options, cleanBody } = parseMemoryOptionsFromBody(rawBody, memoryOptions);
memoryOptions = options;

// 2. KRONOS config from env (one call)
const kronosConfig = getKronosConfig(env);

// 3. Billing check (one call)
if (isBillingEnabled(env)) {
  const billingResult = await checkBillingBeforeRequest(
    { kv: env.METADATA_KV!, db: env.VECTORS_D1!, stripeKey: env.STRIPE_SECRET_KEY },
    userContext.memoryKey.key,
    memoryOptions.contextLimit
  );
  if (!billingResult.allowed) return billingResult.response!;
}

// 4. Memory retrieval (one call)
if (shouldRetrieveMemory(memoryOptions)) {
  const searchResult = await searchMemory({
    doNamespace: env.VAULT_DO,
    d1: env.VECTORS_D1!,
    memoryKey: userContext.memoryKey.key,
    sessionId: memoryOptions.sessionId,
    query: extractQueryFromOpenAI(body.messages),
    limit: memoryOptions.contextLimit,
    embeddingConfig: { ai: env.AI },
    kronosConfig,
    useRace: true,
  });
  
  // 5. Truncation (one call)
  truncationResult = truncateToFit(augmentedMessages, searchResult, body.model);
  // ... inject context
}

// 6. After response — storage + billing (fire-and-forget)
if (shouldStoreMemory(memoryOptions)) {
  ctx.waitUntil(storeConversation({ ... }));
}
ctx.waitUntil(recordBillingAfterRequest({ ... }));

// 7. Build headers (one call)
const headers = buildMemoryHeaders(metrics, memoryMetrics, memoryOptions, truncationResult);
```

**Deletions:**
- Delete `storeConversationDO()` (lines 878-982) — replaced by `memory-core.ts`
- Delete `storeConversationKV()` (lines 984-1030) — legacy, remove
- Delete inline KRONOS config (lines 210-214) — replaced by `getKronosConfig()`
- Delete inline race logic (lines 230-280) — replaced by `searchMemory()`

**Net change:** ~1089 → ~400 lines (**-689 lines**)

---

### 4.2 anthropic.ts Changes

**Current:** 551 lines, missing truncation/DO race

**After:** ~300 lines, gains ALL features

```typescript
// routes/anthropic.ts — KEY ADDITIONS

import { parseMemoryOptionsFromHeaders, shouldRetrieveMemory, shouldStoreMemory } from '../services/memory-options';
import { getKronosConfig } from '../services/kronos-config';
import { searchMemory, extractQueryFromAnthropic } from '../services/memory-retrieval';
import { checkBillingBeforeRequest, recordBillingAfterRequest, isBillingEnabled } from '../services/memory-billing';
import { buildMemoryHeaders } from '../services/debug-headers';
import { truncateToFit, rebuildRetrievalResult } from '../services/truncation'; // NEW!
import { storeConversation } from '../services/memory-core';

// NOW GAINS:
// ✅ DO+D1 race (via searchMemory with useRace: true)
// ✅ Truncation (via truncateToFit)
// ✅ KRONOS from env (via getKronosConfig)
// ✅ Full billing flow (via checkBillingBeforeRequest)
// ✅ Debug headers (via buildMemoryHeaders)
```

**Deletions:**
- Delete `storeToMemory()` (lines 450-520) — replaced by `storeConversation()`
- Delete inline D1-only search — replaced by `searchMemory()`
- Delete inline billing checks — replaced by `checkBillingBeforeRequest()`

**Net change:** ~551 → ~300 lines (**-251 lines**)

---

### 4.3 google.ts Changes

**Current:** 365 lines, missing storage/truncation/full billing

**After:** ~300 lines, gains ALL features

```typescript
// routes/google.ts — KEY ADDITIONS

import { parseMemoryOptionsFromHeaders, shouldRetrieveMemory, shouldStoreMemory } from '../services/memory-options';
import { getKronosConfig } from '../services/kronos-config';
import { searchMemory, extractQueryFromGoogle } from '../services/memory-retrieval';
import { checkBillingBeforeRequest, recordBillingAfterRequest, isBillingEnabled } from '../services/memory-billing';
import { buildMemoryHeaders } from '../services/debug-headers';
import { truncateToFit } from '../services/truncation'; // NEW!
import { storeConversation } from '../services/memory-core'; // NEW!

// NOW GAINS:
// ✅ Memory storage (was completely missing!)
// ✅ DO+D1 race (via searchMemory)
// ✅ Truncation (via truncateToFit)
// ✅ KRONOS from env (via getKronosConfig)
// ✅ Full billing flow (via checkBillingBeforeRequest)
// ✅ Debug headers (via buildMemoryHeaders)
// ✅ Memory options parsing (via parseMemoryOptionsFromHeaders)
```

**Deletions:**
- Delete inline D1-only search — replaced by `searchMemory()`
- Delete inline billing — replaced by `recordBillingAfterRequest()`

**Net change:** ~365 → ~300 lines, but **gains ~200 lines of capabilities**

---

## 5. Function Signature Reference

### 5.1 memory-options.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `parseMemoryOptionsFromHeaders` | `(headers: Headers) => MemoryOptions` | Parse X-Memory-* headers |
| `parseMemoryOptionsFromBody` | `(body: Record<string, unknown>, headerOptions: MemoryOptions) => { options: MemoryOptions; cleanBody: Record<string, unknown> }` | Parse body fields, return cleaned body |
| `stripMessageMemoryFlags` | `<T extends { memory?: boolean }>(messages: T[]) => T[]` | Remove memory flags from messages |
| `shouldRetrieveMemory` | `(options: MemoryOptions) => boolean` | Check if retrieval should happen |
| `shouldStoreMemory` | `(options: MemoryOptions) => boolean` | Check if storage should happen |

### 5.2 kronos-config.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `getKronosConfig` | `(env: { HOT_WINDOW_HOURS?: string; ... }) => KronosConfig` | Build config from env vars |
| `getWindowCutoffs` | `(config: KronosConfig) => { hotCutoff: number; ... }` | Get timestamp cutoffs |
| `classifyWindow` | `(timestamp: number, config: KronosConfig) => 'hot' \| 'working' \| 'longterm' \| 'archive'` | Classify timestamp into window |

### 5.3 memory-retrieval.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `searchMemory` | `(params: SearchMemoryParams) => Promise<SearchResult>` | Main search function (DO+D1 race) |
| `extractQueryFromOpenAI` | `(messages: Array<...>, limit?: number) => string` | Build query from OpenAI messages |
| `extractQueryFromAnthropic` | `(messages: Array<...>, system?: string, limit?: number) => string` | Build query from Anthropic messages |
| `extractQueryFromGoogle` | `(contents: Array<...>, limit?: number) => string` | Build query from Google contents |

### 5.4 memory-billing.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `checkBillingBeforeRequest` | `(ctx: BillingContext, userId: string, estimatedTokens?: number) => Promise<BillingCheckResult>` | Pre-request billing check |
| `recordBillingAfterRequest` | `(ctx: BillingContext, userId: string, totalTokens: number, model: string, provider: string, sessionId?: string) => Promise<void>` | Post-request usage recording |
| `isBillingEnabled` | `(env: { VECTORS_D1?: D1Database; METADATA_KV?: KVNamespace }) => boolean` | Check if billing is enabled |

### 5.5 debug-headers.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `buildMemoryHeaders` | `(metrics: LatencyMetrics, memory: MemoryMetrics, options: MemoryOptions, truncation?: TruncationResult) => Headers` | Build all response headers |
| `buildDebugBody` | `(...) => Record<string, unknown>` | Build debug response body |

---

## 6. Migration Plan

### Phase 1: Create New Services (Day 1)

| Step | Task | Files | Dependencies |
|------|------|-------|--------------|
| 1.1 | Create `memory-options.ts` | `services/memory-options.ts` | None |
| 1.2 | Create `kronos-config.ts` | `services/kronos-config.ts` | None |
| 1.3 | Create `memory-retrieval.ts` | `services/memory-retrieval.ts` | 1.2 |
| 1.4 | Create `memory-billing.ts` | `services/memory-billing.ts` | None (wraps existing) |
| 1.5 | Create `debug-headers.ts` | `services/debug-headers.ts` | None |
| 1.6 | Create `memory-core.ts` | `services/memory-core.ts` | From ARCHITECTURE_REFACTOR_PLAN |

### Phase 2: Update chat.ts (Day 2)

| Step | Task | Dependencies |
|------|------|--------------|
| 2.1 | Import new services | Phase 1 complete |
| 2.2 | Replace inline options parsing | 1.1 |
| 2.3 | Replace inline KRONOS config | 1.2 |
| 2.4 | Replace inline search/race logic | 1.3 |
| 2.5 | Replace inline billing logic | 1.4 |
| 2.6 | Replace inline header building | 1.5 |
| 2.7 | Replace storeConversationDO | 1.6 |
| 2.8 | Delete dead code | 2.1-2.7 |

### Phase 3: Update anthropic.ts (Day 3)

| Step | Task | Dependencies |
|------|------|--------------|
| 3.1 | Import new services | Phase 1 complete |
| 3.2 | Add truncation | 3.1 |
| 3.3 | Replace D1-only search with searchMemory | 3.1 |
| 3.4 | Replace inline billing | 3.1 |
| 3.5 | Replace storeToMemory | 3.1 |
| 3.6 | Add debug headers | 3.1 |

### Phase 4: Update google.ts (Day 4)

| Step | Task | Dependencies |
|------|------|--------------|
| 4.1 | Import new services | Phase 1 complete |
| 4.2 | Add memory storage | 4.1 |
| 4.3 | Add truncation | 4.1 |
| 4.4 | Replace D1-only search | 4.1 |
| 4.5 | Add memory options parsing | 4.1 |
| 4.6 | Add debug headers | 4.1 |

### Phase 5: Testing & Cleanup (Day 5)

| Step | Task | Dependencies |
|------|------|--------------|
| 5.1 | Unit tests for all new services | Phase 1 |
| 5.2 | Integration tests: chat.ts | Phase 2 |
| 5.3 | Integration tests: anthropic.ts | Phase 3 |
| 5.4 | Integration tests: google.ts | Phase 4 |
| 5.5 | Deploy to staging | 5.1-5.4 |
| 5.6 | Production deploy | 5.5 |

### Dependency Graph

```
1.1 ──┬──────────────────────────────────► 2.2 ──┐
1.2 ──┼──────────────────────────────────► 2.3   │
      └──► 1.3 ──────────────────────────► 2.4   │
1.4 ─────────────────────────────────────► 2.5   ├──► 2.8 ──► 5.2
1.5 ─────────────────────────────────────► 2.6   │
1.6 ─────────────────────────────────────► 2.7 ──┘

Phase 1 ──► 3.1 ──┬──► 3.2 ──┐
                  ├──► 3.3   │
                  ├──► 3.4   ├──► 5.3
                  ├──► 3.5   │
                  └──► 3.6 ──┘

Phase 1 ──► 4.1 ──┬──► 4.2 ──┐
                  ├──► 4.3   │
                  ├──► 4.4   ├──► 5.4
                  ├──► 4.5   │
                  └──► 4.6 ──┘

5.2 + 5.3 + 5.4 ──► 5.5 ──► 5.6
```

---

## 7. Testing Checklist

### 7.1 Unit Tests

```
[ ] memory-options.ts
    [ ] parseMemoryOptionsFromHeaders — all header combinations
    [ ] parseMemoryOptionsFromBody — body overrides headers
    [ ] stripMessageMemoryFlags — removes flags, preserves content
    [ ] shouldRetrieveMemory — correct for each mode
    [ ] shouldStoreMemory — correct for each mode

[ ] kronos-config.ts
    [ ] getKronosConfig — reads from env, falls back to defaults
    [ ] getWindowCutoffs — correct timestamps
    [ ] classifyWindow — correct categorization

[ ] memory-retrieval.ts
    [ ] searchMemory — DO+D1 race returns faster result
    [ ] searchMemory — D1-only when no DO
    [ ] searchMemory — buffer merged correctly
    [ ] extractQueryFromOpenAI — correct format
    [ ] extractQueryFromAnthropic — handles string + blocks
    [ ] extractQueryFromGoogle — correct format

[ ] memory-billing.ts
    [ ] checkBillingBeforeRequest — blocked cache instant reject
    [ ] checkBillingBeforeRequest — balance check + auto-charge
    [ ] recordBillingAfterRequest — deducts tokens

[ ] debug-headers.ts
    [ ] buildMemoryHeaders — all metrics present
    [ ] buildMemoryHeaders — truncation details when truncated
```

### 7.2 Integration Tests

```
[ ] chat.ts (OpenAI-compatible)
    [ ] Memory retrieval works
    [ ] Memory storage works
    [ ] Truncation triggers when context exceeds limit
    [ ] DO+D1 race completes
    [ ] Billing blocks when balance 0
    [ ] Debug mode returns _memory/_latency

[ ] anthropic.ts
    [ ] Memory retrieval works (now with DO+D1 race!)
    [ ] Memory storage works
    [ ] Truncation triggers (NEW!)
    [ ] Thinking blocks pass through
    [ ] Tool use passes through

[ ] google.ts
    [ ] Memory retrieval works (now with DO+D1 race!)
    [ ] Memory storage works (NEW!)
    [ ] Truncation triggers (NEW!)
    [ ] Streaming works
    [ ] Native format unchanged
```

### 7.3 Feature Parity Verification

```
[ ] All three providers return identical memories for same key
[ ] All three providers apply same truncation logic
[ ] All three providers use same KRONOS windows
[ ] All three providers record same billing events
[ ] All three providers return same debug headers
```

---

## 8. Summary

### What Changes

| File | Before (lines) | After (lines) | Delta |
|------|----------------|---------------|-------|
| chat.ts | 1089 | ~400 | -689 |
| anthropic.ts | 551 | ~300 | -251 |
| google.ts | 365 | ~300 | -65 |
| memory-options.ts | 0 | ~120 | +120 |
| kronos-config.ts | 0 | ~60 | +60 |
| memory-retrieval.ts | 0 | ~200 | +200 |
| memory-billing.ts | 0 | ~80 | +80 |
| debug-headers.ts | 0 | ~100 | +100 |
| **Total** | 2005 | ~1560 | -445 |

### What Each Provider Gains

| Provider | Gains |
|----------|-------|
| **chat.ts** | Cleaner code, all logic in services |
| **anthropic.ts** | DO+D1 race, truncation, KRONOS config, full billing, debug headers |
| **google.ts** | Memory storage(!), DO+D1 race, truncation, KRONOS config, full billing, memory options, debug headers |

### Key Principles

1. **One implementation per capability** — No duplication
2. **Services = business logic** — All MemoryRouter-specific code
3. **Routes = format transformation** — Parse input → inject → forward → extract → format
4. **Fail open** — Billing/memory errors don't break requests
5. **Fire-and-forget** — Storage/billing in waitUntil

---

*End of Full Modularization Plan*
