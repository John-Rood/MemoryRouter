/**
 * Native Google Gemini endpoint
 * 
 * Accepts Google's native request format, injects memory,
 * returns Google's native response format unchanged.
 * 
 * Endpoint: POST /v1/models/{model}:generateContent
 * 
 * REFACTORED: Now uses shared services for memory operations.
 * - DO+D1 race (was D1-only)
 * - Memory STORAGE (was missing entirely!)
 * - Truncation support (was missing)
 * - KRONOS config from env (was hardcoded)
 * - Full billing flow (uses shared services)
 * - Memory options parsing (was missing)
 * - Debug headers (consistent with other providers)
 */

import { Hono } from 'hono';
import { UserContext } from '../middleware/auth';
import { formatMemoryContext } from '../formatters';

// Import new modular services
import { parseMemoryOptionsFromHeaders, shouldRetrieveMemory, shouldStoreMemory, type MemoryOptions } from '../services/memory-options';
import { getKronosConfig } from '../services/kronos-config';
import { searchMemory, extractQueryFromGoogle, type SearchResult } from '../services/memory-retrieval';
import { storeConversation } from '../services/memory-core';
import { checkBillingBeforeRequest, recordBillingAfterRequest, isBillingEnabled, createBillingContext } from '../services/memory-billing';
import { buildMemoryHeaders, type LatencyMetrics, type MemoryMetrics } from '../services/debug-headers';
import { truncateToFit, rebuildRetrievalResult, type TruncationResult } from '../services/truncation';
import type { EmbeddingConfig } from '../services/providers';

// Billing toggle (matches other providers)
const BILLING_ENABLED = true;

// Google/Gemini types
interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: {
    parts: GeminiPart[];
  };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
  safetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
}

interface GoogleEnv {
  VECTORS_KV: KVNamespace;
  VECTORS_R2: R2Bucket;
  VECTORS_D1: D1Database;
  METADATA_KV: KVNamespace;
  VAULT_DO: DurableObjectNamespace;
  AI: Ai;
  USE_DURABLE_OBJECTS: string;
  DEFAULT_EMBEDDING_MODEL: string;
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
 * Extract text from Gemini parts
 */
function getPartsText(parts: GeminiPart[]): string {
  return parts
    .filter(p => p.text)
    .map(p => p.text!)
    .join('\n');
}

/**
 * Inject memory into Gemini system instruction
 */
function injectMemoryIntoSystemInstruction(
  existing: { parts: GeminiPart[] } | undefined,
  memoryContext: string,
  model: string
): { parts: GeminiPart[] } {
  const formattedMemory = formatMemoryContext(model, memoryContext);
  
  if (existing) {
    return {
      parts: [
        { text: formattedMemory },
        ...existing.parts,
      ],
    };
  }
  
  return {
    parts: [{ text: formattedMemory }],
  };
}

/**
 * Extract assistant response text from Gemini response
 */
function extractAssistantResponse(responseData: {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
}): string {
  const candidates = responseData.candidates;
  if (!candidates || candidates.length === 0) return '';
  
  const content = candidates[0].content;
  if (!content?.parts) return '';
  
  return getPartsText(content.parts);
}

export function createGoogleRouter() {
  const router = new Hono<{ Bindings: GoogleEnv; Variables: Variables }>();

  /**
   * POST /v1/models/:model::action - Google native endpoint
   * Supports :generateContent and :streamGenerateContent
   */
  router.post('/models/:modelAction', async (c) => {
    const startTime = Date.now();
    const ctx = c.executionCtx;
    const env = c.env;
    const userContext = c.get('userContext');
    
    // Parse model and action from path (e.g., "gemini-1.5-pro:generateContent")
    const modelAction = c.req.param('modelAction');
    const [model, action] = modelAction.split(':');
    
    if (!model || !action) {
      return c.json({
        error: {
          code: 400,
          message: 'Invalid endpoint format. Expected /v1/models/{model}:{action}',
          status: 'INVALID_ARGUMENT',
        },
      }, 400);
    }

    // Only support generateContent and streamGenerateContent
    if (!['generateContent', 'streamGenerateContent'].includes(action)) {
      return c.json({
        error: {
          code: 400,
          message: `Unsupported action: ${action}`,
          status: 'INVALID_ARGUMENT',
        },
      }, 400);
    }

    // Parse memory options from headers (NEW!)
    const memoryOptions = parseMemoryOptionsFromHeaders(c.req.raw.headers);
    const sessionId = memoryOptions.sessionId;

    // Parse request body
    let body: GeminiRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        error: {
          code: 400,
          message: 'Invalid JSON body',
          status: 'INVALID_ARGUMENT',
        },
      }, 400);
    }

    // Validate required fields
    if (!body.contents || body.contents.length === 0) {
      return c.json({
        error: {
          code: 400,
          message: 'Missing required field: contents',
          status: 'INVALID_ARGUMENT',
        },
      }, 400);
    }

    // Get Google API key from user's provider keys
    const googleKey = userContext.providerKeys.google;
    if (!googleKey) {
      return c.json({
        error: {
          code: 401,
          message: 'No Google API key configured for this memory key',
          status: 'UNAUTHENTICATED',
        },
      }, 401);
    }

    // ==================== BILLING CHECK (NEW: using shared service) ====================
    if (BILLING_ENABLED && isBillingEnabled(env)) {
      const billingCtx = createBillingContext(env);
      if (billingCtx) {
        const billingResult = await checkBillingBeforeRequest(billingCtx, userContext.memoryKey.key, 1000);
        if (!billingResult.allowed) {
          return new Response(JSON.stringify({
            error: {
              code: 402,
              message: 'Payment required',
              status: 'PAYMENT_REQUIRED',
            },
          }), { status: 402, headers: { 'Content-Type': 'application/json' } });
        }
      }
    }

    // ==================== MEMORY RETRIEVAL (using shared service) ====================
    let searchResult: SearchResult | null = null;
    let truncationResult: TruncationResult | null = null;
    let memoryTokensUsed = 0;
    let chunksRetrieved = 0;
    let augmentedSystemInstruction = body.systemInstruction;
    
    if (shouldRetrieveMemory(memoryOptions) && env.VECTORS_D1) {
      try {
        // Get KRONOS config from env (NEW: was hardcoded!)
        const kronosConfig = getKronosConfig(env);
        
        // Build query from contents
        const query = extractQueryFromGoogle(body.contents);
        
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
          // Convert contents to ChatMessage format for truncation
          const chatMessages = body.contents.map(content => ({
            role: content.role === 'model' ? 'assistant' as const : 'user' as const,
            content: getPartsText(content.parts),
          }));
          
          truncationResult = truncateToFit(
            chatMessages,
            { chunks: searchResult.chunks, tokenCount: searchResult.tokenCount, windowBreakdown: searchResult.windowBreakdown },
            `google/${model}`,
            memoryTokensUsed
          );
          
          if (truncationResult.truncated) {
            console.log('[GOOGLE] Truncation applied:', {
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
          
          // Format context
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
            
            // Inject into system instruction
            augmentedSystemInstruction = injectMemoryIntoSystemInstruction(
              body.systemInstruction,
              contextText,
              `google/${model}`
            );
          }
        }
      } catch (error) {
        console.error('[GOOGLE] Memory retrieval error:', error);
      }
    }

    const mrProcessingTime = Date.now() - startTime;
    const providerStartTime = Date.now();

    // Build request for Google
    const googleBody: GeminiRequest = {
      ...body,
      systemInstruction: augmentedSystemInstruction,
    };

    // Determine endpoint
    const isStreaming = action === 'streamGenerateContent';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${googleKey}`;
    
    if (isStreaming) {
      // Add alt=sse for streaming
      const streamEndpoint = `${endpoint}&alt=sse`;
      
      try {
        const response = await fetch(streamEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(googleBody),
        });

        const providerTime = Date.now() - providerStartTime;
        const totalTime = Date.now() - startTime;

        // Build memory headers (NEW: consistent with other providers!)
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

        const headers = new Headers(response.headers);
        const memoryHeaders = buildMemoryHeaders(latencyMetrics, memoryMetrics, memoryOptions, truncationResult);
        for (const [key, value] of memoryHeaders.entries()) {
          headers.set(key, value);
        }

        // Background: capture response for storage (NEW: was completely missing!)
        if (shouldStoreMemory(memoryOptions) && env.USE_DURABLE_OBJECTS === 'true' && env.VAULT_DO && response.body) {
          const [clientStream, storageStream] = response.body.tee();
          
          ctx.waitUntil(
            (async () => {
              try {
                const reader = storageStream.getReader();
                const decoder = new TextDecoder();
                let fullText = '';

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  const chunk = decoder.decode(value, { stream: true });
                  
                  // Parse SSE events to extract text content
                  const lines = chunk.split('\n');
                  for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                      const data = JSON.parse(line.slice(6));
                      const text = extractAssistantResponse(data);
                      if (text) fullText += text;
                    } catch { /* ignore parse errors */ }
                  }
                }
                reader.releaseLock();

                // Store to memory using shared service
                if (fullText) {
                  await storeConversation({
                    doNamespace: env.VAULT_DO,
                    memoryKey: userContext.memoryKey.key,
                    sessionId,
                    messages: body.contents.map(c => ({
                      role: c.role === 'model' ? 'assistant' : 'user',
                      content: getPartsText(c.parts),
                    })),
                    assistantResponse: fullText,
                    model: `google/${model}`,
                    options: {
                      storeInput: memoryOptions.storeInput,
                      storeResponse: memoryOptions.storeResponse,
                    },
                    embeddingConfig: { ai: env.AI },
                    d1: env.VECTORS_D1,
                    ctx,
                  });
                }
              } catch (error) {
                console.error('[GOOGLE] Streaming storage error:', error);
              }
            })()
          );

          return new Response(clientStream, {
            status: response.status,
            headers,
          });
        }

        return new Response(response.body, {
          status: response.status,
          headers,
        });
      } catch (error) {
        console.error('[GOOGLE] Provider error:', error);
        return c.json({
          error: {
            code: 500,
            message: error instanceof Error ? error.message : 'Provider request failed',
            status: 'INTERNAL',
          },
        }, 500);
      }
    }

    // Non-streaming
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(googleBody),
      });

      const providerTime = Date.now() - providerStartTime;
      const totalTime = Date.now() - startTime;

      // Return native Google response UNTOUCHED — metadata in headers only
      const responseBody = await response.arrayBuffer();
      
      // Build memory headers
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

      const headers = new Headers(response.headers);
      const memoryHeaders = buildMemoryHeaders(latencyMetrics, memoryMetrics, memoryOptions, truncationResult);
      for (const [key, value] of memoryHeaders.entries()) {
        headers.set(key, value);
      }

      // Background: extract response for storage + billing (NEW: storage was completely missing!)
      ctx.waitUntil(
        (async () => {
          try {
            const responseData = JSON.parse(new TextDecoder().decode(responseBody));
            
            // Extract assistant response for storage
            const assistantText = extractAssistantResponse(responseData);
            
            // Store to memory (NEW: was completely missing!)
            if (assistantText && shouldStoreMemory(memoryOptions) && env.USE_DURABLE_OBJECTS === 'true' && env.VAULT_DO) {
              await storeConversation({
                doNamespace: env.VAULT_DO,
                memoryKey: userContext.memoryKey.key,
                sessionId,
                messages: body.contents.map(c => ({
                  role: c.role === 'model' ? 'assistant' : 'user',
                  content: getPartsText(c.parts),
                })),
                assistantResponse: assistantText,
                model: `google/${model}`,
                options: {
                  storeInput: memoryOptions.storeInput,
                  storeResponse: memoryOptions.storeResponse,
                },
                embeddingConfig: { ai: env.AI },
                d1: env.VECTORS_D1,
                ctx,
              });
            }
            
            // Billing (using shared service)
            const usageMetadata = responseData.usageMetadata as { 
              promptTokenCount?: number; 
              candidatesTokenCount?: number;
            } | undefined;
            const totalTokens = (usageMetadata?.promptTokenCount ?? 0) + (usageMetadata?.candidatesTokenCount ?? 0);
            
            if (BILLING_ENABLED && totalTokens > 0) {
              const billingCtx = createBillingContext(env);
              if (billingCtx) {
                await recordBillingAfterRequest({
                  ctx: billingCtx,
                  userId: userContext.memoryKey.key,
                  totalTokens,
                  model: `google/${model}`,
                  provider: 'google',
                  sessionId,
                });
              }
            }
          } catch (err) {
            console.error('[GOOGLE] Background processing error:', err);
          }
        })()
      );

      return new Response(responseBody, {
        status: response.status,
        headers,
      });
    } catch (error) {
      console.error('[GOOGLE] Provider error:', error);
      return c.json({
        error: {
          code: 500,
          message: error instanceof Error ? error.message : 'Provider request failed',
          status: 'INTERNAL',
        },
      }, 500);
    }
  });

  return router;
}
