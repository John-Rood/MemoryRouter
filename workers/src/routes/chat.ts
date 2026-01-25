/**
 * Chat Completions Route
 * POST /v1/chat/completions
 * OpenAI-compatible endpoint with memory injection
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { getUserContext, ProviderKeys } from '../middleware/auth';
import { 
  parseMemoryOptions, 
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
  captureStreamedResponse,
  type ChatCompletionRequest,
  type Provider,
} from '../services/providers';
import { StorageManager, StorageBindings } from '../services/storage';
import { estimateTokens } from '../formatters';

export interface ChatEnv extends StorageBindings {
  METADATA_KV: KVNamespace;
  OPENAI_API_KEY?: string;  // For embeddings
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
    const ctx = c.executionCtx;
    const env = c.env;
    
    // Get user context (set by auth middleware)
    const userContext = getUserContext(c);
    const memoryOptions = parseMemoryOptions(c);
    
    // Parse request body
    let body: ChatCompletionRequest;
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
    
    // Initialize storage and memory manager
    const storage = new StorageManager({
      VECTORS_KV: env.VECTORS_KV,
      METADATA_KV: env.METADATA_KV,
      VECTORS_R2: env.VECTORS_R2,
    });
    const kronos = new KronosMemoryManager(storage);
    
    // Memory retrieval
    let retrieval: MemoryRetrievalResult | null = null;
    let augmentedMessages: ChatMessage[] = body.messages as ChatMessage[];
    
    if (memoryOptions.mode !== 'off' && memoryOptions.mode !== 'write' && embeddingKey) {
      // Extract query from messages
      const query = extractQuery(augmentedMessages);
      
      if (query) {
        try {
          // Generate query embedding
          const queryEmbedding = await generateEmbedding(query, embeddingKey);
          
          // Search memory with KRONOS
          retrieval = await kronos.search(
            userContext.memoryKey.key,
            queryEmbedding,
            memoryOptions.contextLimit
          );
          
          // Inject context if we found relevant memory
          if (retrieval.chunks.length > 0) {
            const contextText = formatRetrievalAsContext(retrieval);
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
      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');
      c.header('X-Memory-Tokens-Retrieved', String(retrieval?.tokenCount ?? 0));
      c.header('X-Memory-Chunks-Retrieved', String(retrieval?.chunks.length ?? 0));
      
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
        
        // Store conversation in background
        if (memoryOptions.mode !== 'off' && memoryOptions.mode !== 'read' && embeddingKey) {
          ctx.waitUntil(
            storeConversation(
              userContext.memoryKey.key,
              body.messages,
              fullResponse,
              body.model,
              memoryOptions,
              kronos,
              embeddingKey
            )
          );
        }
      });
    }
    
    // Handle non-streaming response
    const responseBody = await providerResponse.json();
    const assistantResponse = extractResponseContent(provider, responseBody);
    
    // Store conversation in background
    if (memoryOptions.mode !== 'off' && memoryOptions.mode !== 'read' && embeddingKey) {
      ctx.waitUntil(
        storeConversation(
          userContext.memoryKey.key,
          body.messages,
          assistantResponse,
          body.model,
          memoryOptions,
          kronos,
          embeddingKey
        )
      );
    }
    
    // Add memory metadata to response
    const enrichedResponse = {
      ...(responseBody as object),
      _memory: {
        key: userContext.memoryKey.key,
        tokens_retrieved: retrieval?.tokenCount ?? 0,
        chunks_retrieved: retrieval?.chunks.length ?? 0,
        window_breakdown: retrieval?.windowBreakdown ?? { hot: 0, working: 0, longterm: 0 },
        latency_ms: Date.now() - startTime,
      },
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
  
  // Fallback to environment variable
  switch (provider) {
    case 'openai':
      return env.OPENAI_API_KEY;
    default:
      return undefined;
  }
}

/**
 * Store conversation messages in memory
 */
async function storeConversation(
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
    // Store user messages
    if (options.storeInput) {
      for (const msg of messages) {
        if (msg.role === 'system') continue;
        if (msg.memory === false) continue;
        
        if (msg.role === 'user') {
          const embedding = await generateEmbedding(msg.content, embeddingKey);
          await kronos.store(
            memoryKey,
            embedding,
            msg.content,
            'user',
            model,
            requestId
          );
        }
      }
    }
    
    // Store assistant response
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
    console.error('Failed to store conversation:', error);
    // Don't throw - this runs in background
  }
}

export default createChatRouter;
