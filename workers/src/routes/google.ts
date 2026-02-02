/**
 * Native Google Gemini endpoint
 * 
 * Accepts Google's native request format, injects memory,
 * returns Google's native response format unchanged.
 * 
 * Endpoint: POST /v1/models/{model}:generateContent
 * 
 * This enables true drop-in replacement for Google SDK users.
 */

import { Hono } from 'hono';
import { UserContext } from '../middleware/auth';
import { searchD1, getBufferFromD1 } from '../services/d1-search';
import { generateEmbedding, EmbeddingConfig } from '../services/providers';
import { formatMemoryContext } from '../formatters';
import { DEFAULT_KRONOS_CONFIG } from '../types/do';

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
 * Build query for embedding from Gemini contents
 */
function buildQuery(contents: GeminiContent[]): string {
  const parts: string[] = [];
  
  const recentContents = contents.slice(-3);
  for (const content of recentContents) {
    const text = getPartsText(content.parts);
    const role = content.role === 'model' ? 'ASSISTANT' : 'USER';
    parts.push(`[${role}] ${text}`);
  }
  
  return parts.join('\n\n');
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

export function createGoogleRouter() {
  const router = new Hono<{ Bindings: GoogleEnv; Variables: Variables }>();

  /**
   * POST /v1/models/:model::action - Google native endpoint
   * Supports :generateContent and :streamGenerateContent
   */
  router.post('/models/:modelAction', async (c) => {
    const startTime = Date.now();
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

    let memoryTokensUsed = 0;
    let chunksRetrieved = 0;
    let augmentedSystemInstruction = body.systemInstruction;
    
    // Memory injection via D1 (reliable path)
    try {
      if (c.env.VECTORS_D1) {
        // Build query from contents
        const query = buildQuery(body.contents);
        
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
        
        // Also get buffer
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

        // Return native streaming response with latency headers
        const headers = new Headers(response.headers);
        headers.set('X-MR-Processing-Ms', String(mrProcessingTime));
        headers.set('X-Memory-Tokens-Retrieved', String(memoryTokensUsed));

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

      // Return native Google response with memory metadata
      const responseData = await response.json() as Record<string, unknown>;
      
      // Add memory metadata
      responseData._memory = {
        key: userContext.memoryKey.key,
        tokens_retrieved: memoryTokensUsed,
        chunks_retrieved: chunksRetrieved,
      };
      responseData._latency = {
        mr_processing_ms: mrProcessingTime,
        provider_ms: providerTime,
        total_ms: totalTime,
      };

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
