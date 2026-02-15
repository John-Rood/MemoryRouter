/**
 * Chat Completions Route
 * POST /v1/chat/completions
 * OpenAI-compatible endpoint with memory injection
 * 
 * Supports two storage backends:
 *   - Durable Objects (USE_DURABLE_OBJECTS=true): sub-ms in-memory vector search
 *   - KV+R2 (legacy): deserialized on every request
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { getUserContext, ProviderKeys } from '../middleware/auth';
import { 
  parseMemoryOptions,
  parseMemoryOptionsFromBody,
  extractSessionId,
  KronosMemoryManager, 
  extractQuery, 
  injectContext, 
  formatRetrievalAsContext,
  MemoryRetrievalResult,
  ChatMessage,
} from '../middleware/memory';
import { 
  detectProvider, 
  forwardToProvider, 
  generateEmbedding,
  extractResponseContent,
  type ChatCompletionRequest,
  type Provider,
  type EmbeddingConfig,
} from '../services/providers';
import {
  truncateToFit,
  buildTruncationHeader,
  rebuildRetrievalResult,
  countMessagesTokens,
  countChunksTokens,
  type TruncationResult,
} from '../services/truncation';
import { recordUsage, type UsageEvent } from '../services/usage';
import {
  extractMemoryFlags,
  injectMemoryContext,
  calculateMemoryTokens,
  detectFormat,
  type ExtractionResult,
  type InjectionResult,
  type MemoryChunk as TransformMemoryChunk,
} from '../services/memory-transform';
import {
  BalanceGuard,
  createBalanceGuard,
  buildBlockedUserResponse,
  buildInsufficientBalanceResponse,
  type BalanceGuardResult,
  type BlockedUserRecord,
} from '../services/balance-guard';
import {
  ensureBalance,
  buildPaymentRequiredResponse,
  checkAndReupIfNeeded,
  type EnsureBalanceResult,
} from '../services/balance-checkpoint';

// ==================== BILLING TOGGLE ====================
const BILLING_ENABLED = true;  // Billing is now enabled

/**
 * Build embedding config from environment
 * Cloudflare Workers AI only — no fallbacks
 */
function getEmbeddingConfig(env: ChatEnv): EmbeddingConfig | undefined {
  if (!env.AI) {
    console.error('[chat] Cloudflare AI binding not available');
    return undefined;
  }
  return { ai: env.AI };
}
import { StorageManager, StorageBindings } from '../services/storage';

// DO imports
import { resolveVaultsForQuery, resolveVaultForStore } from '../services/do-router';
import { buildSearchPlan, executeSearchPlan, storeToVault } from '../services/kronos-do';
import type { MemoryRetrievalResult as DOMemoryRetrievalResult } from '../types/do';

// D1 imports (intermediate state for cold start fallback)
import { searchD1, mirrorToD1, mirrorBufferToD1, getBufferFromD1 } from '../services/d1-search';

// Centralized memory storage (with D1 sync tracking)
import { storeConversation } from '../services/memory-core';

// Storage job type for queue (embeddings use Cloudflare AI, no external key needed)
export interface StorageJob {
  type: 'store-conversation';
  memoryKey: string;
  sessionId?: string;
  model: string;
  content: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

export interface ChatEnv extends StorageBindings {
  METADATA_KV: KVNamespace;
  OPENAI_API_KEY?: string;
  // Durable Objects
  VAULT_DO?: DurableObjectNamespace;
  USE_DURABLE_OBJECTS?: string;
  // D1 intermediate state (cold start fallback)
  VECTORS_D1?: D1Database;
  // KRONOS config
  HOT_WINDOW_HOURS?: string;
  WORKING_WINDOW_DAYS?: string;
  LONGTERM_WINDOW_DAYS?: string;
  // Storage queue (decoupled from inference)
  STORAGE_QUEUE?: Queue<StorageJob>;
  // Cloudflare Workers AI binding (embeddings)
  AI: Ai;
  // Stripe for auto-charging
  STRIPE_SECRET_KEY?: string;
}

/**
 * Check if Durable Objects are enabled
 */
function useDurableObjects(env: ChatEnv): boolean {
  return env.USE_DURABLE_OBJECTS === 'true' && !!env.VAULT_DO;
}

/**
 * Create chat router
 */
export function createChatRouter() {
  const chat = new Hono<{ Bindings: ChatEnv }>();

  /**
   * POST /completions
   * Main proxy endpoint
   */
  chat.post('/completions', async (c) => {
    const startTime = Date.now();
    let mrProcessingTime = 0;  // Time for MR to process (auth + vectors + context injection)
    let embeddingMs = 0;       // Time for embedding API call
    let providerStartTime = 0; // When we send to AI provider
    let raceMs = 0;            // Time for DO/D1 race
    let raceWinner = '';       // Which won the race
    let postProcessMs = 0;     // Time for truncation + injection
    const ctx = c.executionCtx;
    const env = c.env;
    
    // Get user context (set by auth middleware)
    const userContext = getUserContext(c);
    let memoryOptions = parseMemoryOptions(c);
    
    // ==================== BILLING: START PARALLEL CHECKS ====================
    // Both blocked cache check AND balance check run in parallel with memory retrieval
    // Results are checked BEFORE the LLM call — zero blocking on request path
    let balanceGuard: BalanceGuard | null = null;
    let blockedCachePromise: Promise<BlockedUserRecord | null> | null = null;
    let balanceCheckPromise: Promise<BalanceGuardResult> | null = null;
    let billingUserId: string | null = null;
    
    if (BILLING_ENABLED && env.VECTORS_D1 && env.METADATA_KV) {
      balanceGuard = createBalanceGuard(env.METADATA_KV, env.VECTORS_D1);
      billingUserId = userContext.memoryKey.key; // Use memory key as account ID
      
      // Start BOTH checks in parallel — no awaits here
      blockedCachePromise = balanceGuard.checkBlockedCache(billingUserId);
      balanceCheckPromise = balanceGuard.checkBalanceAsync(billingUserId);
    }
    
    // Parse request body
    let body: ChatCompletionRequest & { session_id?: string };
    let cleanBody: Record<string, unknown>;
    let memoryExtraction: ExtractionResult | null = null;
    try {
      const rawBody = await c.req.json();
      // Parse memory options from body and strip them before forwarding
      const parsed = parseMemoryOptionsFromBody(rawBody as Record<string, unknown>, memoryOptions);
      memoryOptions = parsed.options;
      cleanBody = parsed.cleanBody;
      body = cleanBody as ChatCompletionRequest & { session_id?: string };
      
      // ===== NEW: Extract memory flags using memory-transform =====
      const extractStart = Date.now();
      memoryExtraction = extractMemoryFlags(rawBody as Record<string, unknown>);
      const extractTime = Date.now() - extractStart;
      
      console.log('[MEMORY] Extraction result:', {
        memoryMode: memoryExtraction.memoryMode,
        messagesCount: memoryExtraction.messagesWithMemoryFlags.length,
        provider: memoryExtraction.provider,
      });
      console.log(`[PERF] extractMemoryFlags: ${extractTime}ms`);
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    
    // Validate required fields
    if (!body.model) {
      return c.json({ error: 'Missing required field: model' }, 400);
    }
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: 'Missing required field: messages (must be a non-empty array)' }, 400);
    }
    
    // Resolve session ID (body.session_id or X-Session-ID header)
    const sessionId = extractSessionId(
      body as Record<string, unknown>,
      userContext.sessionId
    );
    
    // Detect provider from model
    const provider = detectProvider(body.model);
    
    // Get provider API key
    // Priority: X-Provider-Key > Authorization (when X-Memory-Key used) > stored keys > env
    // This enables clean pass-through auth for Clawdbot integration
    const xProviderKey = c.req.header('X-Provider-Key');
    const xMemoryKey = c.req.header('X-Memory-Key');
    const authHeader = c.req.header('Authorization');
    
    // If X-Memory-Key is used, Authorization header contains the provider key
    let passedProviderKey: string | undefined;
    if (xProviderKey) {
      passedProviderKey = xProviderKey;
    } else if (xMemoryKey && authHeader) {
      // Extract provider key from Authorization header (Bearer token)
      const parts = authHeader.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        passedProviderKey = parts[1];
      }
    }
    
    const apiKey = passedProviderKey || getProviderKey(userContext.providerKeys, provider, env);
    const usingPassthrough = !!passedProviderKey;
    if (usingPassthrough) {
      console.log(`[AUTH] Using pass-through provider key for ${provider}`);
    }
    if (!apiKey) {
      return c.json({ 
        error: `No API key configured for provider: ${provider}`,
        hint: `Add your ${provider} API key in your account settings, or pass X-Provider-Key header`,
      }, 400);
    }
    
    // Embeddings use Cloudflare Workers AI (no external API key needed)

    // Choose storage backend
    const usesDO = useDurableObjects(env);
    
    // Memory retrieval
    let retrieval: MemoryRetrievalResult | DOMemoryRetrievalResult | null = null;
    let augmentedMessages: ChatMessage[] = body.messages as ChatMessage[];
    let truncationResult: TruncationResult | null = null;
    let memoryInjection: InjectionResult | null = null;
    let memoryTokensUsed = 0;
    
    if (memoryOptions.mode !== 'off' && memoryOptions.mode !== 'write') {
      const query = extractQuery(augmentedMessages);
      
      if (query) {
        try {
          // Generate query embedding via Cloudflare AI
          const embeddingConfig = getEmbeddingConfig(env);
          const embedStart = Date.now();
          const queryEmbedding = await generateEmbedding(query, undefined, undefined, embeddingConfig);
          embeddingMs = Date.now() - embedStart;
          console.log(`[EMBEDDING] Query: ${embeddingMs}ms (cloudflare)`);
          
          if (usesDO) {
            // ===== DURABLE OBJECTS PATH (with D1 cold start fallback) =====
            const kronosConfig = {
              hotWindowHours: parseInt(env.HOT_WINDOW_HOURS || '4'),
              workingWindowDays: parseInt(env.WORKING_WINDOW_DAYS || '3'),
              longtermWindowDays: parseInt(env.LONGTERM_WINDOW_DAYS || '90'),
            };
            
            // Resolve which vaults to query
            const vaults = resolveVaultsForQuery(
              env.VAULT_DO!,
              userContext.memoryKey.key,
              sessionId
            );
            
            // ===== RACE: DO vs D1 — fastest wins =====
            const plan = buildSearchPlan(vaults, memoryOptions.contextLimit, kronosConfig);
            const raceStart = Date.now();
            
            // Start ALL promises at once
            const doPromise = executeSearchPlan(plan, queryEmbedding)
              .then(r => ({ source: 'do' as const, result: r, time: Date.now() - raceStart }))
              .catch(() => null);
            
            const d1Promise = env.VECTORS_D1
              ? searchD1(env.VECTORS_D1, queryEmbedding, userContext.memoryKey.key, sessionId, memoryOptions.contextLimit, kronosConfig)
                  .then(r => ({ source: 'd1' as const, result: r, time: Date.now() - raceStart }))
                  .catch(() => null)
              : Promise.resolve(null);
            
            const bufferPromise = env.VECTORS_D1
              ? getBufferFromD1(env.VECTORS_D1, userContext.memoryKey.key, sessionId).catch(() => null)
              : Promise.resolve(null);
            
            // Race: first successful result wins
            // Convert null results to rejections so Promise.any works correctly
            const doRace = doPromise.then(r => r?.result ? r : Promise.reject('no result'));
            const d1Race = d1Promise.then(r => r?.result ? r : Promise.reject('no result'));
            
            type RaceWinner = { source: 'do' | 'd1'; result: MemoryRetrievalResult | DOMemoryRetrievalResult; time?: number };
            let winner: RaceWinner | null = null;
            try {
              winner = await Promise.any([doRace, d1Race]) as RaceWinner;
            } catch {
              // Both failed - empty result
              winner = null;
            }
            
            raceMs = Date.now() - raceStart;
            raceWinner = winner?.source || 'none';
            console.log(`[PERF] Race complete: winner=${raceWinner}, time=${winner?.time}ms, totalRace=${raceMs}ms`);
            
            if (winner?.result) {
              retrieval = winner.result;
            } else {
              retrieval = { chunks: [], tokenCount: 0, windowBreakdown: { hot: 0, working: 0, longterm: 0 } };
            }
            
            // Buffer: DO includes it in response, D1 needs separate fetch
            // Only await D1 buffer if D1 won the race
            if (winner?.source === 'd1') {
              const buffer = await bufferPromise;
              if (buffer?.content && buffer.tokenCount > 0) {
                retrieval.chunks.push({
                  id: -1, role: 'system' as const, content: buffer.content,
                  timestamp: buffer.lastUpdated, score: 1.0, window: 'hot' as const, source: 'buffer',
                });
                retrieval.tokenCount += buffer.tokenCount;
              }
            }
            // If DO won, extract buffer from response
            if (winner?.source === 'do') {
              const doBuffer = (retrieval as { buffer?: { content: string; tokenCount: number; lastUpdated?: number } }).buffer;
              if (doBuffer?.content && doBuffer.tokenCount > 0) {
                retrieval.chunks.push({
                  id: -1, role: 'system' as const, content: doBuffer.content,
                  timestamp: doBuffer.lastUpdated || Date.now(), score: 1.0, window: 'hot' as const, source: 'buffer',
                });
                retrieval.tokenCount += doBuffer.tokenCount;
              }
            }
          } else {
            // ===== LEGACY KV+R2 PATH =====
            const storage = new StorageManager({
              VECTORS_KV: env.VECTORS_KV,
              METADATA_KV: env.METADATA_KV,
              VECTORS_R2: env.VECTORS_R2,
            });
            const kronos = new KronosMemoryManager(storage);
            retrieval = await kronos.search(
              userContext.memoryKey.key,
              queryEmbedding,
              memoryOptions.contextLimit
            );
          }
          
          // Inject context if we found relevant memory
          if (retrieval && retrieval.chunks.length > 0) {
            // ===== CALCULATE MEMORY TOKENS FOR TRUNCATION BUDGET =====
            const postProcessStart = Date.now();
            const format = detectFormat(provider, body.model);
            const preInjectionTokens = calculateMemoryTokens(
              retrieval.chunks as TransformMemoryChunk[],
              null, // coreMemory - not yet implemented
              format
            );
            console.log(`[MEMORY] Pre-injection calculation: ${preInjectionTokens} tokens (format: ${format})`);
            
            // ===== TRUNCATION: Ensure we fit within context window =====
            // Now includes memory token budget awareness
            const truncateStart = Date.now();
            truncationResult = truncateToFit(
              augmentedMessages,
              retrieval as MemoryRetrievalResult,
              body.model,
              preInjectionTokens  // Pass memory tokens for budget calculation
            );
            console.log(`[PERF] truncateToFit: ${Date.now() - truncateStart}ms`);
            
            if (truncationResult.truncated) {
              console.log('[TRUNCATION] Applied:', {
                truncated: truncationResult.truncated,
                tokensRemoved: truncationResult.tokensRemoved,
                originalChunks: retrieval.chunks.length,
                remainingChunks: truncationResult.chunks.length,
                conversationMsgsRemoved: truncationResult.truncationDetails.conversationMessagesRemoved,
                archiveChunksRemoved: truncationResult.truncationDetails.archiveChunksRemoved,
              });
              
              // Update with truncated data
              augmentedMessages = truncationResult.messages;
              retrieval = rebuildRetrievalResult(retrieval as MemoryRetrievalResult, truncationResult.chunks);
            }
            
            // ===== SIMPLE INJECTION (reverted from memory-transform) =====
            const injectStart = Date.now();
            
            // Debug: Check for buffer chunk
            const bufferChunk = retrieval.chunks.find(c => c.source === 'buffer');
            console.log('[MEMORY] Buffer check:', {
              hasBuffer: !!bufferChunk,
              bufferContent: bufferChunk?.content?.substring(0, 100),
              chunkSources: retrieval.chunks.map(c => c.source || 'none'),
            });
            
            const contextText = formatRetrievalAsContext(retrieval as MemoryRetrievalResult);
            augmentedMessages = injectContext(augmentedMessages, contextText, body.model);
            const injectTime = Date.now() - injectStart;
            
            memoryTokensUsed = retrieval.tokenCount;
            
            console.log('[MEMORY] Injection result (simple):', {
              injectedTokens: memoryTokensUsed,
              chunksUsed: retrieval.chunks.length,
              contextLength: contextText.length,
              hasMostRecent: contextText.includes('[MOST RECENT]'),
            });
            console.log(`[PERF] injectContext: ${injectTime}ms`);
            postProcessMs = Date.now() - postProcessStart;
            console.log(`[PERF] Total post-processing: ${postProcessMs}ms`);
          }
        } catch (error) {
          console.error('Memory retrieval error:', error);
          // Continue without memory on error
        }
      }
    }
    
    // Create augmented request body
    const augmentedBody: ChatCompletionRequest = {
      ...body,
      messages: augmentedMessages,
    };
    
    // Enable streaming usage for OpenAI/OpenRouter
    if (body.stream && (provider === 'openai' || provider === 'openrouter')) {
      (augmentedBody as Record<string, unknown>).stream_options = { include_usage: true };
    }
    
    // Mark end of MR processing, start of provider call
    mrProcessingTime = Date.now() - startTime;
    
    // ==================== BILLING: CHARGE FIRST, SERVE SECOND ====================
    // Check balance and auto-charge if needed BEFORE the LLM call
    let balanceCheckResult: BalanceGuardResult | null = null;
    let ensureBalanceResult: EnsureBalanceResult | null = null;
    
    if (BILLING_ENABLED && billingUserId && env.VECTORS_D1) {
      // First check blocked cache (fast path for known blocked users)
      if (blockedCachePromise) {
        const blockedRecord = await blockedCachePromise;
        if (blockedRecord) {
          console.log(`[BILLING] Blocked user (cached): ${billingUserId} - ${blockedRecord.reason}`);
          return buildBlockedUserResponse(blockedRecord);
        }
      }
      
      // Use ensureBalance for charge-first semantics
      // memoryTokensUsed is the estimated memory tokens to inject
      const tokensForBilling = memoryTokensUsed > 0 ? memoryTokensUsed : 1000; // Min 1K tokens estimate
      
      ensureBalanceResult = await ensureBalance(
        env.VECTORS_D1,
        billingUserId,
        tokensForBilling,
        env.STRIPE_SECRET_KEY
      );
      
      if (!ensureBalanceResult.allowed) {
        console.log(`[BILLING] Balance check failed: ${billingUserId} - ${ensureBalanceResult.error}`);
        
        // Add to blocked cache for fast rejection of subsequent requests
        if (balanceGuard && ensureBalanceResult.error === 'no_payment_method') {
          await balanceGuard.addToBlockedCache(
            billingUserId,
            'insufficient_balance',
            ensureBalanceResult.projectedBalance ?? 0,
            ensureBalanceResult.freeTokensRemaining ?? 0
          );
        }
        
        return buildPaymentRequiredResponse(ensureBalanceResult);
      }
      
      // Log if we charged
      if (ensureBalanceResult.charged) {
        console.log(`[BILLING] Auto-charged ${billingUserId}: $${((ensureBalanceResult.amountCharged || 0) / 100).toFixed(2)} (PI: ${ensureBalanceResult.paymentIntentId})`);
      }
      
      console.log(`[BILLING] Balance OK: ${billingUserId} - projected=${ensureBalanceResult.projectedBalance}c, charged=${ensureBalanceResult.charged || false}`);
    }
    
    providerStartTime = Date.now();
    
    // Reject non-OpenAI-compatible providers — they must use native endpoints
    if (provider === 'anthropic') {
      return c.json({
        error: 'Wrong endpoint for Anthropic models',
        message: 'Use POST /v1/messages for Anthropic models (native format, no transformations).',
        hint: 'Just change your base_url to https://api.memoryrouter.ai and use the Anthropic SDK natively.',
      }, 400);
    }
    if (provider === 'google') {
      return c.json({
        error: 'Wrong endpoint for Google models',
        message: 'Use POST /v1/models/{model}:generateContent for Google models (native format, no transformations).',
        hint: 'Just change your base_url to https://api.memoryrouter.ai and use the Google SDK natively.',
      }, 400);
    }
    
    // Forward to provider (OpenAI-compatible only)
    let providerResponse: Response;
    try {
      providerResponse = await forwardToProvider(provider, apiKey, augmentedBody);
    } catch (error) {
      console.error('Provider error:', error);
      return c.json({ 
        error: 'Failed to connect to provider',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 502);
    }
    
    // Check for provider errors
    if (!providerResponse.ok) {
      const errorBody = await providerResponse.text();
      try {
        const errorJson = JSON.parse(errorBody);
        return c.json({ 
          error: 'Provider error',
          provider_error: errorJson,
        }, providerResponse.status as 400);
      } catch {
        return c.json({ 
          error: 'Provider error',
          details: errorBody,
        }, providerResponse.status as 400);
      }
    }
    
    // Handle streaming response
    if (body.stream) {
      // Capture provider response time (time to establish connection/first headers)
      const providerResponseTime = Date.now() - providerStartTime;
      
      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');
      c.header('X-Memory-Tokens-Retrieved', String(retrieval?.tokenCount ?? 0));
      c.header('X-Memory-Chunks-Retrieved', String(retrieval?.chunks.length ?? 0));
      c.header('X-Memory-Tokens-Injected', String(memoryTokensUsed));
      c.header('X-Memory-Injection-Format', (memoryInjection as InjectionResult | null)?.formatUsed ?? 'none');
      // Latency breakdown headers
      c.header('X-Embedding-Ms', String(embeddingMs));
      c.header('X-MR-Processing-Ms', String(mrProcessingTime));
      c.header('X-MR-Overhead-Ms', String(mrProcessingTime - embeddingMs));
      c.header('X-Provider-Response-Ms', String(providerResponseTime));
      c.header('X-Total-Ms', String(Date.now() - startTime));
      if (sessionId) {
        c.header('X-Session-ID', sessionId);
      }
      // Memory extraction headers
      if (memoryExtraction) {
        c.header('X-Memory-Mode', memoryExtraction.memoryMode ?? 'default');
        c.header('X-Provider-Detected', memoryExtraction.provider);
      }
      // Truncation headers
      if (truncationResult?.truncated) {
        c.header('X-MemoryRouter-Truncated', 'true');
        c.header('X-MemoryRouter-Truncated-Details', buildTruncationHeader(truncationResult.truncationDetails));
        c.header('X-MemoryRouter-Tokens-Removed', String(truncationResult.tokensRemoved));
      }
      
      return stream(c, async (streamWriter) => {
        const reader = providerResponse.body?.getReader();
        if (!reader) {
          await streamWriter.write('data: {"error": "No response body"}\n\n');
          return;
        }
        
        const decoder = new TextDecoder();
        let fullResponse = '';
        let streamInputTokens = 0;
        let streamOutputTokens = 0;
        
        try {
          let sseBuffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            await streamWriter.write(chunk);
            
            // Buffer-based SSE parsing to handle lines split across chunks
            sseBuffer += chunk;
            const parts = sseBuffer.split('\n');
            sseBuffer = parts.pop() || '';
            
            for (const line of parts) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data: ') && !trimmed.includes('[DONE]')) {
                try {
                  const data = JSON.parse(trimmed.slice(6));
                  const content = data.choices?.[0]?.delta?.content;
                  const anthropicContent = data.delta?.text;
                  if (content) fullResponse += content;
                  if (anthropicContent) fullResponse += anthropicContent;
                  
                  // Anthropic: message_start has input tokens
                  if (data.type === 'message_start' && data.message?.usage) {
                    streamInputTokens = data.message.usage.input_tokens ?? 0;
                  }
                  
                  // Anthropic: message_delta (at end) has output tokens
                  if (data.type === 'message_delta' && data.usage) {
                    streamOutputTokens = data.usage.output_tokens ?? 0;
                  }
                  
                  // OpenAI: final chunk has usage (when stream_options.include_usage is true)
                  if (data.usage?.prompt_tokens !== undefined) {
                    streamInputTokens = data.usage.prompt_tokens ?? 0;
                    streamOutputTokens = data.usage.completion_tokens ?? 0;
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
        
        // Queue storage job (completely decoupled from inference)
        if (memoryOptions.mode !== 'off' && memoryOptions.mode !== 'read') {
          const storageContent: Array<{ role: 'user' | 'assistant'; content: string }> = [];
          
          // Get last user message
          if (memoryOptions.storeInput) {
            const lastUserMsg = [...body.messages]
              .reverse()
              .find(m => m.role === 'user' && m.memory !== false);
            if (lastUserMsg) {
              storageContent.push({ role: 'user', content: lastUserMsg.content });
            }
          }
          
          // Add assistant response
          if (memoryOptions.storeResponse && fullResponse) {
            storageContent.push({ role: 'assistant', content: fullResponse });
          }
          
          if (storageContent.length > 0 && usesDO) {
            // Use inline storage for Cloudflare AI (can't serialize AI binding to queue)
            // Also more efficient since we're already in a Worker
            ctx.waitUntil(
              storeConversationDO(
                env.VAULT_DO!,
                userContext.memoryKey.key,
                sessionId,
                body.messages,
                fullResponse,
                body.model,
                memoryOptions,
                getEmbeddingConfig(env),
                env.VECTORS_D1,
                ctx
              )
            );
          }
          
          // ===== BILLING: RECORD USAGE & DEDUCT BALANCE (streaming path) =====
          const totalStreamTokens = streamInputTokens + streamOutputTokens;
          // Fallback to estimate if provider didn't report usage
          const billableStreamTokens = totalStreamTokens > 0 
            ? totalStreamTokens 
            : countMessagesTokens(augmentedMessages) + Math.ceil(fullResponse.length / 4);
          
          if (BILLING_ENABLED && balanceGuard && billableStreamTokens > 0) {
            const userId = userContext.memoryKey.key;
            ctx.waitUntil(
              (async () => {
                // Deduct usage
                await balanceGuard.recordUsageAndDeduct(
                  userId,
                  billableStreamTokens,
                  body.model,
                  provider,
                  sessionId
                );
                
                // Check if balance fell below threshold — auto-reup if needed
                if (env.VECTORS_D1) {
                  await checkAndReupIfNeeded(
                    env.VECTORS_D1,
                    userId,
                    env.STRIPE_SECRET_KEY
                  );
                }
              })()
            );
            console.log(`[BILLING] Queued usage recording (streaming): ${userId} - ${billableStreamTokens} total tokens (provider: ${totalStreamTokens})`);
          }

          // ===== USAGE TRACKING (fire-and-forget) =====
          if (env.VECTORS_D1) {
            const providerEndTime = Date.now();
            // Use actual Anthropic tokens if captured, otherwise estimate
            const actualInputTokens = streamInputTokens > 0 
              ? streamInputTokens 
              : countMessagesTokens(body.messages as ChatMessage[]);
            const actualOutputTokens = streamOutputTokens > 0 
              ? streamOutputTokens 
              : Math.ceil(fullResponse.length / 4); // Estimate ~4 chars/token
            const usageEvent: UsageEvent = {
              timestamp: Date.now(),
              memoryKey: userContext.memoryKey.key,
              sessionId: sessionId,
              model: body.model,
              provider: provider,
              inputTokens: actualInputTokens,
              outputTokens: actualOutputTokens,
              memoryTokensRetrieved: retrieval?.tokenCount ?? 0,
              memoryTokensInjected: memoryTokensUsed,
              latencyEmbeddingMs: embeddingMs,
              latencyMrMs: mrProcessingTime,
              latencyProviderMs: providerEndTime - providerStartTime,
              requestType: 'chat',
            };
            ctx.waitUntil(recordUsage(env.VECTORS_D1, usageEvent));
          }
        }
      });
    }
    
    // Handle non-streaming response
    const responseBody = await providerResponse.json();
    const assistantResponse = extractResponseContent(provider, responseBody);
    
    // Queue storage job (completely decoupled from inference)
    if (memoryOptions.mode !== 'off' && memoryOptions.mode !== 'read') {
      const storageContent: Array<{ role: 'user' | 'assistant'; content: string }> = [];
      
      // Get last user message
      if (memoryOptions.storeInput) {
        const lastUserMsg = [...body.messages]
          .reverse()
          .find(m => m.role === 'user' && m.memory !== false);
        if (lastUserMsg) {
          storageContent.push({ role: 'user', content: lastUserMsg.content });
        }
      }
      
      // Add assistant response
      if (memoryOptions.storeResponse && assistantResponse) {
        storageContent.push({ role: 'assistant', content: assistantResponse });
      }
      
      if (storageContent.length > 0 && usesDO) {
        // Use inline storage for Cloudflare AI (can't serialize AI binding to queue)
        ctx.waitUntil(
          storeConversationDO(
            env.VAULT_DO!,
            userContext.memoryKey.key,
            sessionId,
            body.messages,
            assistantResponse,
            body.model,
            memoryOptions,
            getEmbeddingConfig(env),
            env.VECTORS_D1,
            ctx
          )
        );
      }
    }
    
    // Calculate provider time for non-streaming
    const providerTime = Date.now() - providerStartTime;
    const totalTime = Date.now() - startTime;
    
    // Check for debug mode
    const debugMode = c.req.header('X-Debug') === 'true' || c.req.query('debug') === 'true';
    
    // ===== BILLING: RECORD USAGE & DEDUCT BALANCE (non-streaming path) =====
    const responseUsage = (responseBody as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
    const totalTokens = (responseUsage?.prompt_tokens ?? 0) + (responseUsage?.completion_tokens ?? 0);
    // Fallback if provider doesn't report usage
    const billableTokens = totalTokens > 0 
      ? totalTokens 
      : countMessagesTokens(augmentedMessages) + Math.ceil((assistantResponse?.length ?? 0) / 4);
    
    if (BILLING_ENABLED && balanceGuard && billableTokens > 0) {
      const userId = userContext.memoryKey.key;
      ctx.waitUntil(
        (async () => {
          // Deduct usage
          await balanceGuard.recordUsageAndDeduct(
            userId,
            billableTokens,
            body.model,
            provider,
            sessionId
          );
          
          // Check if balance fell below threshold — auto-reup if needed
          if (env.VECTORS_D1) {
            await checkAndReupIfNeeded(
              env.VECTORS_D1,
              userId,
              env.STRIPE_SECRET_KEY
            );
          }
        })()
      );
      console.log(`[BILLING] Queued usage recording: ${userId} - ${billableTokens} total tokens (provider: ${totalTokens})`);
    }

    // ===== USAGE TRACKING (fire-and-forget) =====
    if (env.VECTORS_D1) {
      // Extract token counts from response if available
      const responseUsage = (responseBody as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
      const usageEvent: UsageEvent = {
        timestamp: Date.now(),
        memoryKey: userContext.memoryKey.key,
        sessionId: sessionId,
        model: body.model,
        provider: provider,
        inputTokens: responseUsage?.prompt_tokens ?? countMessagesTokens(body.messages as ChatMessage[]),
        outputTokens: responseUsage?.completion_tokens ?? Math.ceil((assistantResponse?.length ?? 0) / 4),
        memoryTokensRetrieved: retrieval?.tokenCount ?? 0,
        memoryTokensInjected: memoryTokensUsed,
        latencyEmbeddingMs: embeddingMs,
        latencyMrMs: mrProcessingTime,
        latencyProviderMs: providerTime,
        requestType: 'chat',
      };
      ctx.waitUntil(recordUsage(env.VECTORS_D1, usageEvent));
    }
    
    // Add memory metadata to response (only in debug mode for playground)
    // Debug mode: X-Debug: true header or ?debug=true query param
    const enrichedResponse = {
      ...(responseBody as object),
      // Memory metadata (debug only)
      _memory: debugMode ? {
        key: userContext.memoryKey.key,
        session_id: sessionId ?? null,
        storage: usesDO ? 'durable-objects' : 'kv-r2',
        tokens_retrieved: retrieval?.tokenCount ?? 0,
        memories_retrieved: retrieval?.chunks.length ?? 0,
        tokens_injected: memoryTokensUsed,
        injection_format: (memoryInjection as InjectionResult | null)?.formatUsed ?? null,
        window_breakdown: retrieval?.windowBreakdown ?? { hot: 0, working: 0, longterm: 0 },
        memories: retrieval?.chunks ?? [],
        latency_ms: totalTime,
      } : undefined,
      // Latency breakdown (debug only)
      _latency: debugMode ? {
        embedding_ms: embeddingMs,
        race_ms: raceMs,
        race_winner: raceWinner,
        post_process_ms: postProcessMs,
        mr_processing_ms: mrProcessingTime,
        mr_overhead_ms: mrProcessingTime - embeddingMs,
        provider_ms: providerTime,
        total_ms: totalTime,
      } : undefined,
      // Memory extraction info (debug only)
      _extraction: debugMode && memoryExtraction ? {
        memory_mode: memoryExtraction.memoryMode,
        provider_detected: memoryExtraction.provider,
        messages_with_flags: memoryExtraction.messagesWithMemoryFlags.length,
      } : undefined,
      // Truncation info (debug only)
      _truncation: debugMode && truncationResult?.truncated ? {
        truncated: true,
        tokens_removed: truncationResult.tokensRemoved,
        details: truncationResult.truncationDetails,
      } : undefined,
      // Full debug info
      _debug: debugMode ? {
        original_messages: body.messages,
        augmented_messages: augmentedMessages,
        model: body.model,
        provider: provider,
        memory_injection: memoryInjection,
      } : undefined,
    };
    
    return c.json(enrichedResponse);
  });

  return chat;
}

/**
 * Get API key for a provider
 */
function getProviderKey(
  providerKeys: ProviderKeys, 
  provider: Provider,
  env: ChatEnv
): string | undefined {
  const key = providerKeys[provider];
  if (key) return key;
  
  switch (provider) {
    case 'openai':
      return env.OPENAI_API_KEY;
    default:
      return undefined;
  }
}

// ==================== Storage Functions ====================

/**
 * Store conversation via Durable Objects with intelligent chunking.
 * 
 * FLOW:
 * 1. Send each message to DO's /store-chunked endpoint
 * 2. DO manages buffer, returns any complete 300-token chunks
 * 3. Worker embeds each chunk and stores via /store
 * 
 * Chunks are ~300 tokens with 30 token overlap for context continuity.
 */
/**
 * Store conversation via centralized memory-core service.
 * 
 * This wrapper calls storeConversation() from memory-core.ts, which:
 * - Handles DO storage with intelligent chunking
 * - Mirrors to D1 with sync tracking
 * - Returns d1Synced status
 * 
 * The caller (chat route) uses ctx.waitUntil() so this runs async,
 * but internally we await D1 operations and log sync status.
 */
async function storeConversationDO(
  doNamespace: DurableObjectNamespace,
  memoryKey: string,
  sessionId: string | undefined,
  messages: Array<{ role: string; content: string; memory?: boolean }>,
  assistantResponse: string,
  model: string,
  options: { storeInput: boolean; storeResponse: boolean },
  embeddingConfig?: EmbeddingConfig,
  d1?: D1Database,
  ctx?: ExecutionContext
): Promise<void> {
  // Use centralized storeConversation from memory-core.ts
  // This ensures consistent D1 mirroring with sync tracking
  if (!embeddingConfig || !ctx) {
    console.error('[CHAT-STORE] Missing embeddingConfig or ctx, skipping store');
    return;
  }
  
  const result = await storeConversation({
    doNamespace,
    memoryKey,
    sessionId,
    messages,
    assistantResponse,
    model,
    options,
    embeddingConfig,
    d1,
    ctx,
  });
  
  // Log D1 sync status for monitoring
  if (result.stored) {
    if (result.d1Synced) {
      console.log(`[CHAT-STORE] Stored ${result.chunksStored} chunks, D1 synced: ${result.d1ChunksSynced}`);
    } else {
      console.warn(`[CHAT-STORE] Stored ${result.chunksStored} chunks, D1 SYNC FAILED:`, result.d1Errors);
    }
  }
}

/**
 * Store conversation via legacy KV+R2
 * @deprecated Use storeConversationDO instead
 */
async function storeConversationKV(
  memoryKey: string,
  messages: Array<{ role: string; content: string; memory?: boolean }>,
  assistantResponse: string,
  model: string,
  options: { storeInput: boolean; storeResponse: boolean },
  kronos: KronosMemoryManager,
  embeddingConfig?: EmbeddingConfig
): Promise<void> {
  const requestId = crypto.randomUUID();
  
  try {
    // ONLY store last user message (not full history — users send all messages each request)
    if (options.storeInput) {
      const lastUserMsg = [...messages]
        .reverse()
        .find(m => m.role === 'user' && m.memory !== false);
      
      if (lastUserMsg) {
        const embedding = await generateEmbedding(lastUserMsg.content, undefined, undefined, embeddingConfig);
        await kronos.store(
          memoryKey,
          embedding,
          lastUserMsg.content,
          'user',
          model,
          requestId
        );
      }
    }
    
    if (options.storeResponse && assistantResponse) {
      const embedding = await generateEmbedding(assistantResponse, undefined, undefined, embeddingConfig);
      await kronos.store(
        memoryKey,
        embedding,
        assistantResponse,
        'assistant',
        model,
        requestId
      );
    }
  } catch (error) {
    console.error('Failed to store conversation (KV):', error);
  }
}

export default createChatRouter;
