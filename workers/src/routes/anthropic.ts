/**
 * Native Anthropic /v1/messages endpoint — TRUE PASS-THROUGH
 * 
 * Accepts Anthropic's native request format, injects memory into system,
 * forwards the FULL request body to Anthropic, returns the FULL response UNTOUCHED.
 * 
 * No transformations. No stripping. Thinking blocks, tool use, everything passes through.
 * Memory metadata is in response HEADERS only — never injected into the response body.
 * 
 * REFACTORED: Now uses shared services for memory operations.
 * - DO+D1 race (was D1-only)
 * - Truncation support (was missing)
 * - KRONOS config from env (was hardcoded)
 * - Full billing flow (uses shared services)
 */

import { Hono } from 'hono';
import { UserContext } from '../middleware/auth';
import { formatMemoryContext } from '../formatters';

// Import new modular services
import { parseMemoryOptionsFromHeaders, shouldRetrieveMemory, shouldStoreMemory, type MemoryOptions, DEFAULT_MEMORY_OPTIONS } from '../services/memory-options';
import { getKronosConfig } from '../services/kronos-config';
import { searchMemory, extractQueryFromAnthropic, type SearchResult } from '../services/memory-retrieval';
import { storeConversation } from '../services/memory-core';
import { checkBillingBeforeRequest, recordBillingAfterRequest, isBillingEnabled, createBillingContext } from '../services/memory-billing';
import { buildMemoryHeaders, addMemoryHeadersToResponse, type LatencyMetrics, type MemoryMetrics } from '../services/debug-headers';
import { truncateToFit, rebuildRetrievalResult, type TruncationResult } from '../services/truncation';
import { recordUsage, type UsageEvent } from '../services/usage';
import type { EmbeddingConfig } from '../services/providers';

// Billing toggle (matches chat.ts)
const BILLING_ENABLED = true;

interface AnthropicEnv {
  VECTORS_KV: KVNamespace;
  VECTORS_R2: R2Bucket;
  VECTORS_D1: D1Database;
  METADATA_KV: KVNamespace;
  VAULT_DO: DurableObjectNamespace;
  AI: Ai;
  USE_DURABLE_OBJECTS: string;
  DEFAULT_EMBEDDING_MODEL: string;
  DEFAULT_EMBEDDING_DIMS: string;
  STORAGE_QUEUE: Queue<unknown>;
  STRIPE_SECRET_KEY?: string;
  // KRONOS config from env
  HOT_WINDOW_HOURS?: string;
  WORKING_WINDOW_DAYS?: string;
  LONGTERM_WINDOW_DAYS?: string;
}

type Variables = {
  userContext: UserContext;
};

/**
 * Extract text from an Anthropic message's content (string or content blocks)
 */
function getMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: { type?: string; text?: string }) => c.type === 'text' && c.text)
      .map((c: { text: string }) => c.text)
      .join('\n');
  }
  return '';
}

/**
 * Extract text content from Anthropic response for memory storage ONLY.
 * This is used in the background — never touches the response to the user.
 */
function extractTextForStorage(responseData: { content?: Array<{ type: string; text?: string }> }): string {
  if (!responseData?.content) return '';
  const content = responseData.content;
  if (!Array.isArray(content)) return '';
  
  // Only extract text blocks for storage — thinking, tool_use, etc. are not stored
  return content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text!)
    .join('\n');
}

export function createAnthropicRouter() {
  const router = new Hono<{ Bindings: AnthropicEnv; Variables: Variables }>();

  /**
   * POST /v1/messages - Anthropic native pass-through
   * 
   * What we do:
   *   1. Inject memory context into the system field
   *   2. Forward the ENTIRE request body to Anthropic (all fields preserved)
   *   3. Return the ENTIRE response from Anthropic (untouched — thinking, tools, everything)
   *   4. In background: extract text for memory storage
   */
  router.post('/messages', async (c) => {
    const startTime = Date.now();
    const ctx = c.executionCtx;
    const env = c.env;
    const userContext = c.get('userContext');

    // Parse memory options from headers
    let memoryOptions = parseMemoryOptionsFromHeaders(c.req.raw.headers);

    // Parse the raw body — we'll modify only the system field for memory injection
    let rawBody: Record<string, unknown>;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: { type: 'invalid_request_error', message: 'Invalid JSON body' } }, 400);
    }

    // Override memory mode from body if present
    const bodyMemoryMode = rawBody.memory_mode as string | undefined;
    if (bodyMemoryMode && ['default', 'read', 'write', 'off', 'none'].includes(bodyMemoryMode.toLowerCase())) {
      memoryOptions = { ...memoryOptions, mode: bodyMemoryMode.toLowerCase() as MemoryOptions['mode'] };
    }
    delete rawBody.memory_mode;
    
    // Strip per-message memory flags (not part of Anthropic API)
    const messages = rawBody.messages as Array<{ role: string; content: unknown; memory?: boolean }>;
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        delete msg.memory;
      }
    }

    // Validate required Anthropic fields
    if (!rawBody.model || !rawBody.messages || !rawBody.max_tokens) {
      return c.json({
        error: {
          type: 'invalid_request_error',
          message: 'Missing required fields: model, messages, max_tokens',
        },
      }, 400);
    }

    // Get Anthropic API key
    const xProviderKey = c.req.header('X-Provider-Key');
    const xMemoryKey = c.req.header('X-Memory-Key');
    const authHeader = c.req.header('Authorization');
    
    let anthropicKey: string | undefined;
    if (xProviderKey) {
      anthropicKey = xProviderKey;
    } else if (xMemoryKey && authHeader) {
      const parts = authHeader.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        anthropicKey = parts[1];
      }
    }
    anthropicKey = anthropicKey || userContext.providerKeys.anthropic;
    
    if (!anthropicKey) {
      return c.json({
        error: {
          type: 'authentication_error',
          message: 'No Anthropic API key configured. Add key in dashboard or pass X-Provider-Key header.',
        },
      }, 401);
    }

    // Session ID for scoped memory
    const sessionId = c.req.header('X-Session-ID') || memoryOptions.sessionId;
    memoryOptions.sessionId = sessionId;

    // ==================== BILLING CHECK (using shared service) ====================
    if (BILLING_ENABLED && isBillingEnabled(env)) {
      const billingCtx = createBillingContext(env);
      if (billingCtx) {
        const billingResult = await checkBillingBeforeRequest(billingCtx, userContext.memoryKey.key, 1000);
        if (!billingResult.allowed) {
          return billingResult.response!;
        }
      }
    }

    // ==================== MEMORY RETRIEVAL (using shared service) ====================
    let searchResult: SearchResult | null = null;
    let truncationResult: TruncationResult | null = null;
    let memoryTokensUsed = 0;
    let chunksRetrieved = 0;

    if (shouldRetrieveMemory(memoryOptions) && env.VECTORS_D1) {
      try {
        // Get KRONOS config from env
        const kronosConfig = getKronosConfig(env);
        
        // Build query from messages
        const query = extractQueryFromAnthropic(
          messages.map(m => ({ role: m.role, content: m.content as string | Array<{ type: string; text?: string }> })),
          rawBody.system as string | undefined
        );
        
        // Search memory with DO+D1 race (NEW: was D1-only!)
        const embeddingConfig: EmbeddingConfig = { ai: env.AI };
        searchResult = await searchMemory({
          doNamespace: env.USE_DURABLE_OBJECTS === 'true' ? env.VAULT_DO : undefined,
          d1: env.VECTORS_D1,
          memoryKey: userContext.memoryKey.key,
          sessionId,
          query,
          limit: memoryOptions.contextLimit,
          embeddingConfig,
          kronosConfig,
          useRace: env.USE_DURABLE_OBJECTS === 'true',
        });

        if (searchResult.chunks.length > 0) {
          chunksRetrieved = searchResult.chunks.length;
          memoryTokensUsed = searchResult.tokenCount;
          
          // ===== TRUNCATION (NEW: was missing!) =====
          // Convert messages to ChatMessage format for truncation
          const chatMessages = messages.map(m => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: getMessageText(m.content),
          }));
          
          truncationResult = truncateToFit(
            chatMessages,
            { chunks: searchResult.chunks, tokenCount: searchResult.tokenCount, windowBreakdown: searchResult.windowBreakdown },
            rawBody.model as string,
            memoryTokensUsed
          );
          
          if (truncationResult.truncated) {
            console.log('[ANTHROPIC] Truncation applied:', {
              tokensRemoved: truncationResult.tokensRemoved,
              chunksRemaining: truncationResult.chunks.length,
            });
            // Rebuild search result with truncated chunks
            const retrieval = rebuildRetrievalResult(
              { chunks: searchResult.chunks, tokenCount: searchResult.tokenCount, windowBreakdown: searchResult.windowBreakdown },
              truncationResult.chunks
            );
            memoryTokensUsed = retrieval.tokenCount;
            chunksRetrieved = retrieval.chunks.length;
            
            // Update searchResult with truncated data
            searchResult = {
              ...searchResult,
              chunks: retrieval.chunks,
              tokenCount: retrieval.tokenCount,
              windowBreakdown: retrieval.windowBreakdown,
            };
          }
          
          // Format and inject memory context
          const contextParts: string[] = [];
          
          // Buffer goes first (most recent)
          if (searchResult.buffer?.content && searchResult.buffer.tokenCount > 0) {
            contextParts.push(`[MOST RECENT]\n${searchResult.buffer.content}`);
          }
          
          // Then retrieved chunks
          if (searchResult.chunks.filter(c => c.source !== 'buffer').length > 0) {
            const pastFormatted = searchResult.chunks
              .filter(c => c.source !== 'buffer')
              .map((chunk, i) => `[${i + 1}] ${chunk.content}`)
              .join('\n\n');
            contextParts.push(pastFormatted);
          }

          if (contextParts.length > 0) {
            const contextText = contextParts.join('\n\n---\n\n');
            const formattedMemory = formatMemoryContext(rawBody.model as string, contextText);

            // Inject into Anthropic system field (prepend to existing)
            const existingSystem = rawBody.system;
            if (typeof existingSystem === 'string') {
              rawBody.system = formattedMemory + '\n\n' + existingSystem;
            } else if (Array.isArray(existingSystem)) {
              // Anthropic supports system as array of content blocks
              rawBody.system = [{ type: 'text', text: formattedMemory }, ...existingSystem];
            } else {
              rawBody.system = formattedMemory;
            }
          }
        }
      } catch (error) {
        console.error('[ANTHROPIC] Memory retrieval error:', error);
        // Continue without memory
      }
    }

    const mrProcessingTime = Date.now() - startTime;
    const providerStartTime = Date.now();

    // ==================== BUILD AUTH HEADERS ====================
    const isOAuthToken = anthropicKey.startsWith('sk-ant-oat01-');
    const forwardHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (isOAuthToken) {
      forwardHeaders['Authorization'] = `Bearer ${anthropicKey}`;
      forwardHeaders['anthropic-beta'] = 'claude-code-20250219,oauth-2025-04-20';
      forwardHeaders['anthropic-dangerous-direct-browser-access'] = 'true';
      forwardHeaders['user-agent'] = 'claude-cli/1.0.0 (external, cli)';
      forwardHeaders['x-app'] = 'cli';
    } else {
      forwardHeaders['x-api-key'] = anthropicKey;
    }

    // Forward any anthropic-beta header from the client (for thinking, etc.)
    const clientBeta = c.req.header('anthropic-beta');
    if (clientBeta) {
      if (isOAuthToken && forwardHeaders['anthropic-beta']) {
        forwardHeaders['anthropic-beta'] = forwardHeaders['anthropic-beta'] + ',' + clientBeta;
      } else {
        forwardHeaders['anthropic-beta'] = clientBeta;
      }
    }

    // ==================== FORWARD TO ANTHROPIC ====================
    let providerResponse: Response;
    try {
      providerResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: forwardHeaders,
        body: JSON.stringify(rawBody),
      });
    } catch (error) {
      console.error('[ANTHROPIC] Provider error:', error);
      return c.json({
        error: {
          type: 'api_error',
          message: error instanceof Error ? error.message : 'Provider request failed',
        },
      }, 502);
    }

    const providerTime = Date.now() - providerStartTime;
    const totalTime = Date.now() - startTime;

    // ==================== BUILD RESPONSE HEADERS (using shared service) ====================
    const latencyMetrics: LatencyMetrics = {
      startTime,
      embeddingMs: searchResult?.metrics.embeddingMs,
      raceMs: searchResult?.metrics.raceMs,
      raceWinner: searchResult?.metrics.winner,
      mrProcessingMs: mrProcessingTime,
      providerResponseMs: providerTime,
      totalMs: totalTime,
    };
    
    const memoryMetrics: MemoryMetrics = {
      tokensRetrieved: memoryTokensUsed,
      chunksRetrieved,
      tokensInjected: memoryTokensUsed,
    };
    
    const memoryHeaders = buildMemoryHeaders(latencyMetrics, memoryMetrics, memoryOptions, truncationResult);
    memoryHeaders.set('X-Memory-Key', userContext.memoryKey.key);

    const isStreaming = rawBody.stream === true;

    if (isStreaming) {
      // ===== STREAMING: Pipe through response, capture text in background for storage =====
      if (!providerResponse.body) {
        return new Response(JSON.stringify({
          error: { type: 'api_error', message: 'No response body from provider' },
        }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }

      // Copy provider response headers + add memory headers
      const responseHeaders = new Headers(providerResponse.headers);
      for (const [key, value] of memoryHeaders.entries()) {
        responseHeaders.set(key, value);
      }

      // Tee the stream: one for the client (untouched), one for memory storage
      const [clientStream, storageStream] = providerResponse.body.tee();

      // Background: read storage stream, extract text, store to memory
      if (shouldStoreMemory(memoryOptions)) {
        ctx.waitUntil(
          (async () => {
            try {
              const reader = storageStream.getReader();
              const decoder = new TextDecoder();
              let fullText = '';
              let inputTokens = 0;
              let outputTokens = 0;

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                
                // Parse SSE events to extract text content
                const lines = chunk.split('\n');
                for (const line of lines) {
                  if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
                  try {
                    const data = JSON.parse(line.slice(6));
                    if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
                      fullText += data.delta.text || '';
                    }
                    if (data.type === 'message_start' && data.message?.usage) {
                      inputTokens = data.message.usage.input_tokens ?? 0;
                    }
                    if (data.type === 'message_delta' && data.usage) {
                      outputTokens = data.usage.output_tokens ?? 0;
                    }
                  } catch { /* ignore parse errors */ }
                }
              }
              reader.releaseLock();

              // Store to memory using shared service
              if (fullText && env.USE_DURABLE_OBJECTS === 'true' && env.VAULT_DO) {
                await storeConversation({
                  doNamespace: env.VAULT_DO,
                  memoryKey: userContext.memoryKey.key,
                  sessionId,
                  messages: messages.map(m => ({ 
                    role: m.role, 
                    content: getMessageText(m.content),
                    memory: m.memory,
                  })),
                  assistantResponse: fullText,
                  model: rawBody.model as string,
                  options: {
                    storeInput: memoryOptions.storeInput,
                    storeResponse: memoryOptions.storeResponse,
                  },
                  embeddingConfig: { ai: env.AI },
                  d1: env.VECTORS_D1,
                  ctx,
                });
              }

              // Record billing using shared service
              const totalTokens = inputTokens + outputTokens;
              if (BILLING_ENABLED && totalTokens > 0) {
                const billingCtx = createBillingContext(env);
                if (billingCtx) {
                  await recordBillingAfterRequest({
                    ctx: billingCtx,
                    userId: userContext.memoryKey.key,
                    totalTokens,
                    model: rawBody.model as string,
                    provider: 'anthropic',
                    sessionId,
                  });
                }
              }

              // Usage tracking
              if (env.VECTORS_D1) {
                const usageEvent: UsageEvent = {
                  timestamp: Date.now(),
                  memoryKey: userContext.memoryKey.key,
                  sessionId, 
                  model: rawBody.model as string,
                  provider: 'anthropic',
                  inputTokens, 
                  outputTokens,
                  memoryTokensRetrieved: memoryTokensUsed,
                  memoryTokensInjected: memoryTokensUsed,
                  latencyEmbeddingMs: searchResult?.metrics.embeddingMs ?? 0,
                  latencyMrMs: mrProcessingTime,
                  latencyProviderMs: providerTime,
                  requestType: 'messages',
                };
                await recordUsage(env.VECTORS_D1, usageEvent);
              }
            } catch (error) {
              console.error('[ANTHROPIC] Background storage error:', error);
            }
          })()
        );
      } else {
        // Not storing — just drain the storage stream
        storageStream.cancel();
      }

      // Return the client stream untouched
      return new Response(clientStream, {
        status: providerResponse.status,
        headers: responseHeaders,
      });
    }

    // ===== NON-STREAMING: Return full response body untouched =====
    const responseBody = await providerResponse.arrayBuffer();
    
    // Copy provider response headers + add memory headers
    const responseHeaders = new Headers(providerResponse.headers);
    for (const [key, value] of memoryHeaders.entries()) {
      responseHeaders.set(key, value);
    }

    // Background: extract text for storage and record billing
    if (shouldStoreMemory(memoryOptions) && providerResponse.ok) {
      ctx.waitUntil(
        (async () => {
          try {
            const responseData = JSON.parse(new TextDecoder().decode(responseBody));
            const assistantText = extractTextForStorage(responseData);

            if (assistantText && env.USE_DURABLE_OBJECTS === 'true' && env.VAULT_DO) {
              await storeConversation({
                doNamespace: env.VAULT_DO,
                memoryKey: userContext.memoryKey.key,
                sessionId,
                messages: messages.map(m => ({ 
                  role: m.role, 
                  content: getMessageText(m.content),
                  memory: m.memory,
                })),
                assistantResponse: assistantText,
                model: rawBody.model as string,
                options: {
                  storeInput: memoryOptions.storeInput,
                  storeResponse: memoryOptions.storeResponse,
                },
                embeddingConfig: { ai: env.AI },
                d1: env.VECTORS_D1,
                ctx,
              });
            }

            // Billing
            const usage = responseData.usage as { input_tokens?: number; output_tokens?: number } | undefined;
            const totalTokens = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
            if (BILLING_ENABLED && totalTokens > 0) {
              const billingCtx = createBillingContext(env);
              if (billingCtx) {
                await recordBillingAfterRequest({
                  ctx: billingCtx,
                  userId: userContext.memoryKey.key,
                  totalTokens,
                  model: rawBody.model as string,
                  provider: 'anthropic',
                  sessionId,
                });
              }
            }

            // Usage tracking
            if (env.VECTORS_D1) {
              const usageEvent: UsageEvent = {
                timestamp: Date.now(),
                memoryKey: userContext.memoryKey.key,
                sessionId, 
                model: rawBody.model as string,
                provider: 'anthropic',
                inputTokens: usage?.input_tokens ?? 0,
                outputTokens: usage?.output_tokens ?? 0,
                memoryTokensRetrieved: memoryTokensUsed,
                memoryTokensInjected: memoryTokensUsed,
                latencyEmbeddingMs: searchResult?.metrics.embeddingMs ?? 0,
                latencyMrMs: mrProcessingTime,
                latencyProviderMs: providerTime,
                requestType: 'messages',
              };
              await recordUsage(env.VECTORS_D1, usageEvent);
            }
          } catch (error) {
            console.error('[ANTHROPIC] Background storage error:', error);
          }
        })()
      );
    }

    // Return the raw bytes from Anthropic — completely untouched
    return new Response(responseBody, {
      status: providerResponse.status,
      headers: responseHeaders,
    });
  });

  return router;
}
