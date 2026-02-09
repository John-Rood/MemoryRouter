/**
 * Native Anthropic /v1/messages endpoint
 * 
 * Accepts Anthropic's native request format, injects memory, 
 * returns Anthropic's native response format unchanged.
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

// Anthropic-specific types
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image'; source: unknown }>;
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  metadata?: Record<string, unknown>;
}

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
}

type Variables = {
  userContext: UserContext;
};

/**
 * Extract text content from Anthropic message
 */
function getMessageText(message: AnthropicMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  return message.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map(c => c.text)
    .join('\n');
}

/**
 * Build query for embedding from Anthropic messages
 */
function buildQuery(messages: AnthropicMessage[], system?: string): string {
  const parts: string[] = [];
  
  // Include recent conversation context
  const recentMessages = messages.slice(-3);
  for (const msg of recentMessages) {
    const text = getMessageText(msg);
    parts.push(`[${msg.role.toUpperCase()}] ${text}`);
  }
  
  return parts.join('\n\n');
}

/**
 * Inject memory into Anthropic system prompt
 */
function injectMemoryIntoSystem(
  existingSystem: string | undefined,
  memoryContext: string,
  model: string
): string {
  const formattedMemory = formatMemoryContext(model, memoryContext);
  
  if (existingSystem) {
    return `${formattedMemory}\n\n${existingSystem}`;
  }
  return formattedMemory;
}

/**
 * Map simplified model name to Anthropic's API format
 */
const ANTHROPIC_MODEL_MAP: Record<string, string> = {
  'claude-3.5-sonnet': 'claude-sonnet-4-20250514',
  'claude-3.5-haiku': 'claude-haiku-4-5-20251001',
  'claude-3-5-sonnet': 'claude-sonnet-4-20250514',
  'claude-3-5-haiku': 'claude-haiku-4-5-20251001',
  'claude-3.7-sonnet': 'claude-sonnet-4-5-20250929',
  'claude-3.7-sonnet:thinking': 'claude-sonnet-4-5-20250929',
  'claude-3-opus': 'claude-opus-4-1-20250805',
  'claude-3-sonnet': 'claude-sonnet-4-20250514',
  'claude-3-haiku': 'claude-haiku-4-5-20251001',
  'claude-sonnet-4': 'claude-sonnet-4-20250514',
  'claude-opus-4': 'claude-opus-4-20250514',
  'claude-sonnet-4.5': 'claude-sonnet-4-5-20250929',
  'claude-opus-4.5': 'claude-opus-4-5-20251101',
  'claude-opus-4.1': 'claude-opus-4-1-20250805',
  'claude-haiku-4.5': 'claude-haiku-4-5-20251001',
};

function mapModelName(model: string): string {
  // Strip anthropic/ prefix if present
  const baseName = model.startsWith('anthropic/') ? model.slice(10) : model;
  return ANTHROPIC_MODEL_MAP[baseName] || baseName;
}

export function createAnthropicRouter() {
  const router = new Hono<{ Bindings: AnthropicEnv; Variables: Variables }>();

  /**
   * POST /v1/messages - Anthropic native chat endpoint
   */
  router.post('/messages', async (c) => {
    const startTime = Date.now();
    const userContext = c.get('userContext');
    
    // Parse request body
    let body: AnthropicRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { type: 'invalid_request_error', message: 'Invalid JSON body' } }, 400);
    }

    // Validate required fields
    if (!body.model || !body.messages || !body.max_tokens) {
      return c.json({ 
        error: { 
          type: 'invalid_request_error', 
          message: 'Missing required fields: model, messages, max_tokens' 
        } 
      }, 400);
    }

    // Get Anthropic API key
    // Priority: X-Provider-Key header > stored provider keys
    const xProviderKey = c.req.header('X-Provider-Key');
    const anthropicKey = xProviderKey || userContext.providerKeys.anthropic;
    if (!anthropicKey) {
      return c.json({ 
        error: { 
          type: 'authentication_error', 
          message: 'No Anthropic API key configured. Add key in dashboard or pass X-Provider-Key header.' 
        } 
      }, 401);
    }
    const usingPassthrough = !!xProviderKey;
    if (usingPassthrough) {
      console.log('[ANTHROPIC] Using pass-through provider key');
    }

    let memoryTokensUsed = 0;
    let chunksRetrieved = 0;
    let augmentedSystem = body.system;
    
    // Memory injection via D1 (reliable path)
    try {
      if (c.env.VECTORS_D1) {
        // Build query from messages
        const query = buildQuery(body.messages, body.system);
        
        // Generate embedding
        const embeddingConfig: EmbeddingConfig = {
          ai: c.env.AI,
        };
        const embedding = await generateEmbedding(
          query,
          '',
          c.env.DEFAULT_EMBEDDING_MODEL || 'bge-base-en-v1.5',
          embeddingConfig
        );
        
        // Search D1 for relevant chunks
        const retrieval = await searchD1(
          c.env.VECTORS_D1,
          embedding,
          userContext.memoryKey.key,
          undefined, // sessionId
          30, // limit
          DEFAULT_KRONOS_CONFIG
        );
        
        // Also get buffer (partial content)
        const buffer = await getBufferFromD1(c.env.VECTORS_D1, userContext.memoryKey.key, undefined);
        
        if (retrieval.tokenCount > 0 || (buffer && buffer.tokenCount > 0)) {
          // Format context
          const contextParts: string[] = [];
          
          if (buffer && buffer.content && buffer.tokenCount > 0) {
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
          
          // Inject into system prompt
          augmentedSystem = injectMemoryIntoSystem(body.system, contextText, body.model);
        }
      }
    } catch (error) {
      console.error('[ANTHROPIC] Memory retrieval error:', error);
      // Continue without memory on error
    }

    const mrProcessingTime = Date.now() - startTime;
    const providerStartTime = Date.now();

    // Build request for Anthropic
    const anthropicBody: AnthropicRequest = {
      ...body,
      model: mapModelName(body.model),
      system: augmentedSystem,
    };

    // Forward to Anthropic
    // OAuth tokens (sk-ant-oat01-*) need Bearer auth + Claude Code stealth headers
    // API keys (sk-ant-api*) use x-api-key
    const isOAuthToken = anthropicKey.startsWith('sk-ant-oat01-');
    const authHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (isOAuthToken) {
      authHeaders['Authorization'] = `Bearer ${anthropicKey}`;
      authHeaders['anthropic-beta'] = 'claude-code-20250219,oauth-2025-04-20';
      authHeaders['anthropic-dangerous-direct-browser-access'] = 'true';
      authHeaders['user-agent'] = 'claude-cli/1.0.0 (external, cli)';
      authHeaders['x-app'] = 'cli';
    } else {
      authHeaders['x-api-key'] = anthropicKey;
    }
    
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(anthropicBody),
      });

      const providerTime = Date.now() - providerStartTime;
      const totalTime = Date.now() - startTime;

      // Return native Anthropic response with memory metadata
      const responseData = await response.json() as Record<string, unknown>;
      
      // Add memory metadata (non-standard fields prefixed with _)
      responseData._memory = {
        key: userContext.memoryKey.key,
        tokens_retrieved: memoryTokensUsed,
        memories_retrieved: chunksRetrieved,
      };
      responseData._latency = {
        mr_processing_ms: mrProcessingTime,
        provider_ms: providerTime,
        total_ms: totalTime,
      };

      // Set latency headers
      const headers = new Headers({
        'Content-Type': 'application/json',
        'X-MR-Processing-Ms': String(mrProcessingTime),
        'X-Provider-Response-Ms': String(providerTime),
        'X-Total-Ms': String(totalTime),
        'X-Memory-Tokens-Retrieved': String(memoryTokensUsed),
      });

      return new Response(JSON.stringify(responseData), {
        status: response.status,
        headers,
      });
    } catch (error) {
      console.error('[ANTHROPIC] Provider error:', error);
      return c.json({
        error: {
          type: 'api_error',
          message: error instanceof Error ? error.message : 'Provider request failed',
        },
      }, 500);
    }
  });

  return router;
}
