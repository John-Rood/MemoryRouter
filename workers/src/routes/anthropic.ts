/**
 * Native Anthropic /v1/messages endpoint — TRUE PASS-THROUGH
 * 
 * Accepts Anthropic's native request format, injects memory into system,
 * forwards the FULL request body to Anthropic, returns the FULL response UNTOUCHED.
 * 
 * No transformations. No stripping. Thinking blocks, tool use, everything passes through.
 * Memory metadata is in response HEADERS only — never injected into the response body.
 * 
 * This enables true drop-in replacement for Anthropic SDK users:
 *   client = Anthropic(base_url="https://api.memoryrouter.ai", api_key="mk_xxx")
 */

import { Hono } from 'hono';
import { UserContext } from '../middleware/auth';
import { searchD1, getBufferFromD1 } from '../services/d1-search';
import { generateEmbedding, EmbeddingConfig } from '../services/providers';
import { formatMemoryContext } from '../formatters';
import { DEFAULT_KRONOS_CONFIG } from '../types/do';
import { createBalanceGuard } from '../services/balance-guard';
import {
  ensureBalance,
  buildPaymentRequiredResponse,
  checkAndReupIfNeeded,
} from '../services/balance-checkpoint';
import { recordUsage, type UsageEvent } from '../services/usage';
import { resolveVaultForStore } from '../services/do-router';
import { storeToVault } from '../services/kronos-do';
import { mirrorToD1, mirrorBufferToD1 } from '../services/d1-search';

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
      .filter((c: any) => c.type === 'text' && c.text)
      .map((c: any) => c.text)
      .join('\n');
  }
  return '';
}

/**
 * Build query for embedding from Anthropic messages
 */
function buildQuery(messages: any[], system?: string): string {
  const parts: string[] = [];
  const recentMessages = messages.slice(-3);
  for (const msg of recentMessages) {
    const text = getMessageText(msg.content);
    parts.push(`[${(msg.role || 'user').toUpperCase()}] ${text}`);
  }
  return parts.join('\n\n');
}

/**
 * Extract text content from Anthropic response for memory storage ONLY.
 * This is used in the background — never touches the response to the user.
 */
function extractTextForStorage(responseData: any): string {
  if (!responseData?.content) return '';
  const content = responseData.content;
  if (!Array.isArray(content)) return '';
  
  // Only extract text blocks for storage — thinking, tool_use, etc. are not stored
  return content
    .filter((block: any) => block.type === 'text' && block.text)
    .map((block: any) => block.text)
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

    // Parse the raw body — we'll modify only the system field for memory injection
    let rawBody: Record<string, unknown>;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: { type: 'invalid_request_error', message: 'Invalid JSON body' } }, 400);
    }

    // Extract and remove MR-specific fields (memory_mode, per-message memory flags)
    const memoryMode = rawBody.memory_mode as string | undefined;
    delete rawBody.memory_mode;
    
    // Strip per-message memory flags (not part of Anthropic API)
    const messages = rawBody.messages as any[];
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
    const sessionId = c.req.header('X-Session-ID') || undefined;

    // ==================== BILLING CHECK ====================
    if (BILLING_ENABLED && env.VECTORS_D1 && env.METADATA_KV) {
      const billingUserId = userContext.memoryKey.key;
      const balanceGuard = createBalanceGuard(env.METADATA_KV, env.VECTORS_D1);
      
      const blockedRecord = await balanceGuard.checkBlockedCache(billingUserId);
      if (blockedRecord) {
        return c.json({
          error: { type: 'billing_error', message: 'Account blocked: ' + blockedRecord.reason },
        }, 402);
      }
      
      const ensureResult = await ensureBalance(env.VECTORS_D1, billingUserId, 1000, env.STRIPE_SECRET_KEY);
      if (!ensureResult.allowed) {
        return buildPaymentRequiredResponse(ensureResult);
      }
    }

    // ==================== MEMORY INJECTION ====================
    let memoryTokensUsed = 0;
    let chunksRetrieved = 0;
    const isMemoryOff = memoryMode === 'off' || memoryMode === 'none';
    const isWriteOnly = memoryMode === 'write';

    if (!isMemoryOff && !isWriteOnly && env.VECTORS_D1) {
      try {
        const query = buildQuery(messages, rawBody.system as string | undefined);
        const embeddingConfig: EmbeddingConfig = { ai: env.AI };
        const embedding = await generateEmbedding(query, '', env.DEFAULT_EMBEDDING_MODEL || 'bge-base-en-v1.5', embeddingConfig);

        const retrieval = await searchD1(
          env.VECTORS_D1, embedding, userContext.memoryKey.key,
          sessionId, 30, DEFAULT_KRONOS_CONFIG
        );
        const buffer = await getBufferFromD1(env.VECTORS_D1, userContext.memoryKey.key, sessionId);

        if (retrieval.tokenCount > 0 || (buffer && buffer.tokenCount > 0)) {
          const contextParts: string[] = [];

          if (buffer?.content && buffer.tokenCount > 0) {
            contextParts.push(`[MOST RECENT]\n${buffer.content}`);
            memoryTokensUsed += buffer.tokenCount;
          }
          if (retrieval.chunks.length > 0) {
            const pastFormatted = retrieval.chunks
              .map((chunk, i) => `[${i + 1}] ${chunk.content}`)
              .join('\n\n');
            contextParts.push(pastFormatted);
            memoryTokensUsed += retrieval.tokenCount;
            chunksRetrieved = retrieval.chunks.length;
          }

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
      // Merge with OAuth beta if needed
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

    // ==================== RETURN RESPONSE UNTOUCHED ====================
    // Memory metadata goes in headers only — NEVER modify the response body.
    const memoryHeaders = new Headers();
    memoryHeaders.set('X-MR-Processing-Ms', String(mrProcessingTime));
    memoryHeaders.set('X-Provider-Response-Ms', String(providerTime));
    memoryHeaders.set('X-Total-Ms', String(totalTime));
    memoryHeaders.set('X-Memory-Tokens-Retrieved', String(memoryTokensUsed));
    memoryHeaders.set('X-Memory-Chunks-Retrieved', String(chunksRetrieved));
    memoryHeaders.set('X-Memory-Key', userContext.memoryKey.key);
    if (sessionId) memoryHeaders.set('X-Session-ID', sessionId);

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
      const isMemoryWrite = !isMemoryOff && memoryMode !== 'read';
      if (isMemoryWrite) {
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
                    // content_block_delta with text type
                    if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
                      fullText += data.delta.text || '';
                    }
                    // message_start has input tokens
                    if (data.type === 'message_start' && data.message?.usage) {
                      inputTokens = data.message.usage.input_tokens ?? 0;
                    }
                    // message_delta has output tokens
                    if (data.type === 'message_delta' && data.usage) {
                      outputTokens = data.usage.output_tokens ?? 0;
                    }
                  } catch { /* ignore parse errors */ }
                }
              }
              reader.releaseLock();

              // Store to memory
              if (fullText) {
                await storeToMemory(env, ctx, userContext.memoryKey.key, sessionId, messages, fullText, rawBody.model as string);
              }

              // Record usage + billing
              const totalTokens = inputTokens + outputTokens;
              if (BILLING_ENABLED && totalTokens > 0 && env.VECTORS_D1 && env.METADATA_KV) {
                const balanceGuard = createBalanceGuard(env.METADATA_KV, env.VECTORS_D1);
                await balanceGuard.recordUsageAndDeduct(
                  userContext.memoryKey.key, totalTokens, rawBody.model as string, 'anthropic', sessionId
                );
                await checkAndReupIfNeeded(env.VECTORS_D1, userContext.memoryKey.key, env.STRIPE_SECRET_KEY);
              }

              // Usage tracking
              if (env.VECTORS_D1) {
                const usageEvent: UsageEvent = {
                  timestamp: Date.now(),
                  memoryKey: userContext.memoryKey.key,
                  sessionId, model: rawBody.model as string,
                  provider: 'anthropic',
                  inputTokens, outputTokens,
                  memoryTokensRetrieved: memoryTokensUsed,
                  memoryTokensInjected: memoryTokensUsed,
                  latencyEmbeddingMs: 0,
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
    const isMemoryWrite = !isMemoryOff && memoryMode !== 'read';
    if (isMemoryWrite && providerResponse.ok) {
      ctx.waitUntil(
        (async () => {
          try {
            const responseData = JSON.parse(new TextDecoder().decode(responseBody));
            const assistantText = extractTextForStorage(responseData);

            if (assistantText) {
              await storeToMemory(env, ctx, userContext.memoryKey.key, sessionId, messages, assistantText, rawBody.model as string);
            }

            // Billing
            const usage = responseData.usage as { input_tokens?: number; output_tokens?: number } | undefined;
            const totalTokens = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
            if (BILLING_ENABLED && totalTokens > 0 && env.VECTORS_D1 && env.METADATA_KV) {
              const balanceGuard = createBalanceGuard(env.METADATA_KV, env.VECTORS_D1);
              await balanceGuard.recordUsageAndDeduct(
                userContext.memoryKey.key, totalTokens, rawBody.model as string, 'anthropic', sessionId
              );
              await checkAndReupIfNeeded(env.VECTORS_D1, userContext.memoryKey.key, env.STRIPE_SECRET_KEY);
            }

            // Usage tracking
            if (env.VECTORS_D1) {
              const usageEvent: UsageEvent = {
                timestamp: Date.now(),
                memoryKey: userContext.memoryKey.key,
                sessionId, model: rawBody.model as string,
                provider: 'anthropic',
                inputTokens: usage?.input_tokens ?? 0,
                outputTokens: usage?.output_tokens ?? 0,
                memoryTokensRetrieved: memoryTokensUsed,
                memoryTokensInjected: memoryTokensUsed,
                latencyEmbeddingMs: 0,
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

/**
 * Store conversation to memory (Durable Objects path)
 */
async function storeToMemory(
  env: AnthropicEnv,
  ctx: ExecutionContext,
  memoryKey: string,
  sessionId: string | undefined,
  messages: any[],
  assistantText: string,
  model: string
): Promise<void> {
  if (env.USE_DURABLE_OBJECTS !== 'true' || !env.VAULT_DO) return;

  const embeddingConfig: EmbeddingConfig = { ai: env.AI };
  const stub = resolveVaultForStore(env.VAULT_DO, memoryKey, sessionId);
  const requestId = crypto.randomUUID();

  // Store last user message
  const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
  if (lastUserMsg) {
    const userText = getMessageText(lastUserMsg.content);
    if (userText) {
      const chunkRes = await stub.fetch(new Request('https://do/store-chunked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: userText, role: 'user' }),
      }));
      const chunkResult = await chunkRes.json() as { chunksToEmbed: string[]; bufferTokens: number };
      for (const chunk of chunkResult.chunksToEmbed) {
        const embedding = await generateEmbedding(chunk, undefined, undefined, embeddingConfig);
        const storeResult = await storeToVault(stub, embedding, chunk, 'user', model, requestId);
        if (env.VECTORS_D1 && storeResult.stored) {
          ctx.waitUntil(mirrorToD1(env.VECTORS_D1, memoryKey, sessionId ? 'session' : 'core', sessionId, chunk, 'user', embedding, Date.now(), Math.ceil(chunk.length / 4), model).catch(() => {}));
        }
      }
    }
  }

  // Store assistant response
  if (assistantText) {
    const chunkRes = await stub.fetch(new Request('https://do/store-chunked', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: assistantText, role: 'assistant' }),
    }));
    const chunkResult = await chunkRes.json() as { chunksToEmbed: string[]; bufferTokens: number };
    for (const chunk of chunkResult.chunksToEmbed) {
      const embedding = await generateEmbedding(chunk, undefined, undefined, embeddingConfig);
      const storeResult = await storeToVault(stub, embedding, chunk, 'assistant', model, requestId);
      if (env.VECTORS_D1 && storeResult.stored) {
        ctx.waitUntil(mirrorToD1(env.VECTORS_D1, memoryKey, sessionId ? 'session' : 'core', sessionId, chunk, 'assistant', embedding, Date.now(), Math.ceil(chunk.length / 4), model).catch(() => {}));
      }
    }

    // Mirror buffer to D1
    if (env.VECTORS_D1) {
      try {
        const bufferRes = await stub.fetch(new Request('https://do/buffer', { method: 'GET' }));
        if (bufferRes.ok) {
          const bufferData = await bufferRes.json() as { content: string; tokenCount: number; lastUpdated: number };
          if (bufferData.content) {
            ctx.waitUntil(mirrorBufferToD1(env.VECTORS_D1, memoryKey, sessionId ? 'session' : 'core', sessionId, bufferData.content, bufferData.tokenCount, bufferData.lastUpdated || Date.now()).catch(() => {}));
          }
        }
      } catch { /* ignore */ }
    }
  }
}

// getMessageText is defined at the top of this file
