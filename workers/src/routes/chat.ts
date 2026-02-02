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

/**
 * Build embedding config from environment
 */
function getEmbeddingConfig(env: ChatEnv): EmbeddingConfig | undefined {
  if (env.EMBEDDING_PROVIDER === 'modal' && env.MODAL_EMBEDDING_URL) {
    return {
      provider: 'modal',
      modalUrl: env.MODAL_EMBEDDING_URL,
    };
  }
  return undefined;  // Default to OpenAI
}
import { StorageManager, StorageBindings } from '../services/storage';

// DO imports
import { resolveVaultsForQuery, resolveVaultForStore } from '../services/do-router';
import { buildSearchPlan, executeSearchPlan, storeToVault } from '../services/kronos-do';
import type { MemoryRetrievalResult as DOMemoryRetrievalResult } from '../types/do';

// Storage job type for queue
export interface StorageJob {
  type: 'store-conversation';
  memoryKey: string;
  sessionId?: string;
  model: string;
  embeddingKey: string;
  content: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  // Embedding config for self-hosted models
  embeddingProvider?: 'openai' | 'modal';
  modalEmbeddingUrl?: string;
}

export interface ChatEnv extends StorageBindings {
  METADATA_KV: KVNamespace;
  OPENAI_API_KEY?: string;
  // Durable Objects
  VAULT_DO?: DurableObjectNamespace;
  USE_DURABLE_OBJECTS?: string;
  // KRONOS config
  HOT_WINDOW_HOURS?: string;
  WORKING_WINDOW_DAYS?: string;
  LONGTERM_WINDOW_DAYS?: string;
  // Storage queue (decoupled from inference)
  STORAGE_QUEUE?: Queue<StorageJob>;
  // Embedding provider config
  EMBEDDING_PROVIDER?: string;  // 'openai' | 'modal'
  MODAL_EMBEDDING_URL?: string;
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
    let providerStartTime = 0; // When we send to AI provider
    const ctx = c.executionCtx;
    const env = c.env;
    
    // Get user context (set by auth middleware)
    const userContext = getUserContext(c);
    const memoryOptions = parseMemoryOptions(c);
    
    // Parse request body
    let body: ChatCompletionRequest & { session_id?: string };
    try {
      body = await c.req.json();
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
    const apiKey = getProviderKey(userContext.providerKeys, provider, env);
    if (!apiKey) {
      return c.json({ 
        error: `No API key configured for provider: ${provider}`,
        hint: `Add your ${provider} API key in your account settings`,
      }, 400);
    }
    
    // Get embedding API key (use OpenAI for embeddings)
    const embeddingKey = userContext.providerKeys.openai || env.OPENAI_API_KEY;
    if (!embeddingKey && memoryOptions.mode !== 'off') {
      return c.json({
        error: 'OpenAI API key required for memory features',
        hint: 'Set your OpenAI API key or use X-Memory-Mode: off',
      }, 400);
    }

    // Choose storage backend
    const usesDO = useDurableObjects(env);
    
    // Memory retrieval
    let retrieval: MemoryRetrievalResult | DOMemoryRetrievalResult | null = null;
    let augmentedMessages: ChatMessage[] = body.messages as ChatMessage[];
    
    if (memoryOptions.mode !== 'off' && memoryOptions.mode !== 'write' && embeddingKey) {
      const query = extractQuery(augmentedMessages);
      
      if (query) {
        try {
          // Generate query embedding
          const embeddingConfig = getEmbeddingConfig(env);
          const queryEmbedding = await generateEmbedding(query, embeddingKey, undefined, embeddingConfig);
          
          if (usesDO) {
            // ===== DURABLE OBJECTS PATH =====
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
            
            // Build KRONOS search plan
            const plan = buildSearchPlan(
              vaults,
              memoryOptions.contextLimit,
              kronosConfig
            );
            
            // Execute parallel search across vaults and windows
            retrieval = await executeSearchPlan(plan, queryEmbedding);
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
            const contextText = formatRetrievalAsContext(retrieval as MemoryRetrievalResult);
            augmentedMessages = injectContext(augmentedMessages, contextText, body.model);
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
    
    // Mark end of MR processing, start of provider call
    mrProcessingTime = Date.now() - startTime;
    providerStartTime = Date.now();
    
    // Forward to provider
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
      // Latency breakdown headers
      c.header('X-MR-Processing-Ms', String(mrProcessingTime));
      c.header('X-Provider-Response-Ms', String(providerResponseTime));
      c.header('X-Total-Ms', String(Date.now() - startTime));
      if (sessionId) {
        c.header('X-Session-ID', sessionId);
      }
      
      return stream(c, async (streamWriter) => {
        const reader = providerResponse.body?.getReader();
        if (!reader) {
          await streamWriter.write('data: {"error": "No response body"}\n\n');
          return;
        }
        
        const decoder = new TextDecoder();
        let fullResponse = '';
        
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            await streamWriter.write(chunk);
            
            // Extract content for memory storage
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ') && !line.includes('[DONE]')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  const content = data.choices?.[0]?.delta?.content;
                  const anthropicContent = data.delta?.text;
                  if (content) fullResponse += content;
                  if (anthropicContent) fullResponse += anthropicContent;
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
        if (memoryOptions.mode !== 'off' && memoryOptions.mode !== 'read' && embeddingKey) {
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
          
          if (storageContent.length > 0 && env.STORAGE_QUEUE) {
            // Fire and forget to queue — zero latency impact
            ctx.waitUntil(
              env.STORAGE_QUEUE.send({
                type: 'store-conversation',
                memoryKey: userContext.memoryKey.key,
                sessionId,
                model: body.model,
                embeddingKey,
                content: storageContent,
                embeddingProvider: env.EMBEDDING_PROVIDER as 'openai' | 'modal' | undefined,
                modalEmbeddingUrl: env.MODAL_EMBEDDING_URL,
              })
            );
          } else if (storageContent.length > 0 && usesDO) {
            // Fallback: inline storage if queue not available
            ctx.waitUntil(
              storeConversationDO(
                env.VAULT_DO!,
                userContext.memoryKey.key,
                sessionId,
                body.messages,
                fullResponse,
                body.model,
                memoryOptions,
                embeddingKey
              )
            );
          }
        }
      });
    }
    
    // Handle non-streaming response
    const responseBody = await providerResponse.json();
    const assistantResponse = extractResponseContent(provider, responseBody);
    
    // Queue storage job (completely decoupled from inference)
    if (memoryOptions.mode !== 'off' && memoryOptions.mode !== 'read' && embeddingKey) {
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
      
      if (storageContent.length > 0 && env.STORAGE_QUEUE) {
        // Fire and forget to queue — zero latency impact
        ctx.waitUntil(
          env.STORAGE_QUEUE.send({
            type: 'store-conversation',
            memoryKey: userContext.memoryKey.key,
            sessionId,
            model: body.model,
            embeddingKey,
            content: storageContent,
            embeddingProvider: env.EMBEDDING_PROVIDER as 'openai' | 'modal' | undefined,
            modalEmbeddingUrl: env.MODAL_EMBEDDING_URL,
          })
        );
      } else if (storageContent.length > 0 && usesDO) {
        // Fallback: inline storage if queue not available
        ctx.waitUntil(
          storeConversationDO(
            env.VAULT_DO!,
            userContext.memoryKey.key,
            sessionId,
            body.messages,
            assistantResponse,
            body.model,
            memoryOptions,
            embeddingKey
          )
        );
      }
    }
    
    // Calculate provider time for non-streaming
    const providerTime = Date.now() - providerStartTime;
    const totalTime = Date.now() - startTime;
    
    // Check for debug mode
    const debugMode = c.req.header('X-Debug') === 'true' || c.req.query('debug') === 'true';
    
    // Add memory metadata to response
    const enrichedResponse = {
      ...(responseBody as object),
      _memory: {
        key: userContext.memoryKey.key,
        session_id: sessionId ?? null,
        storage: usesDO ? 'durable-objects' : 'kv-r2',
        tokens_retrieved: retrieval?.tokenCount ?? 0,
        chunks_retrieved: retrieval?.chunks.length ?? 0,
        window_breakdown: retrieval?.windowBreakdown ?? { hot: 0, working: 0, longterm: 0 },
        chunks: debugMode ? (retrieval?.chunks ?? []) : undefined,
        latency_ms: totalTime,
      },
      _latency: {
        mr_processing_ms: mrProcessingTime,
        provider_ms: providerTime,
        total_ms: totalTime,
      },
      // Debug mode: include full augmented prompt
      _debug: debugMode ? {
        original_messages: body.messages,
        augmented_messages: augmentedMessages,
        model: body.model,
        provider: provider,
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
async function storeConversationDO(
  doNamespace: DurableObjectNamespace,
  memoryKey: string,
  sessionId: string | undefined,
  messages: Array<{ role: string; content: string; memory?: boolean }>,
  assistantResponse: string,
  model: string,
  options: { storeInput: boolean; storeResponse: boolean },
  embeddingKey: string
): Promise<void> {
  const requestId = crypto.randomUUID();
  const stub = resolveVaultForStore(doNamespace, memoryKey, sessionId);
  
  try {
    // Collect content to process — ONLY last user message + new assistant response
    // (users send full history each request; we don't want to re-process old messages)
    const contentToProcess: Array<{ role: string; content: string }> = [];
    
    if (options.storeInput) {
      // Find the last user message only
      const lastUserMsg = [...messages]
        .reverse()
        .find(m => m.role === 'user' && m.memory !== false);
      
      if (lastUserMsg) {
        contentToProcess.push({ role: 'user', content: lastUserMsg.content });
      }
    }
    
    if (options.storeResponse && assistantResponse) {
      contentToProcess.push({ role: 'assistant', content: assistantResponse });
    }
    
    // Process each piece of content through the chunking buffer
    for (const item of contentToProcess) {
      // Send to DO's chunking endpoint
      const chunkResponse = await stub.fetch(new Request('https://do/store-chunked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: item.content,
          role: item.role,
        }),
      }));
      
      const chunkResult = await chunkResponse.json() as {
        chunksToEmbed: string[];
        bufferTokens: number;
      };
      
      // Embed and store each complete chunk
      for (const chunkContent of chunkResult.chunksToEmbed) {
        const embedding = await generateEmbedding(chunkContent, embeddingKey);
        await storeToVault(stub, embedding, chunkContent, 'chunk', model, requestId);
      }
    }
  } catch (error) {
    console.error('Failed to store conversation (DO):', error);
  }
}

/**
 * Store conversation via legacy KV+R2
 */
async function storeConversationKV(
  memoryKey: string,
  messages: Array<{ role: string; content: string; memory?: boolean }>,
  assistantResponse: string,
  model: string,
  options: { storeInput: boolean; storeResponse: boolean },
  kronos: KronosMemoryManager,
  embeddingKey: string
): Promise<void> {
  const requestId = crypto.randomUUID();
  
  try {
    // ONLY store last user message (not full history — users send all messages each request)
    if (options.storeInput) {
      const lastUserMsg = [...messages]
        .reverse()
        .find(m => m.role === 'user' && m.memory !== false);
      
      if (lastUserMsg) {
        const embedding = await generateEmbedding(lastUserMsg.content, embeddingKey);
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
      const embedding = await generateEmbedding(assistantResponse, embeddingKey);
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
