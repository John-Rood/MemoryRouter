/**
 * Anthropic Messages Route
 * POST /v1/messages
 * 
 * Native Anthropic Messages API compatible endpoint with memory injection.
 * 
 * Reference: memoryrouter-product-spec.md Section 5.3
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { getUserContext } from '../middleware/auth';
import { parseMemoryOptions, resolveSessionId, storeConversation } from '../middleware/memory';
import { forwardAnthropicMessages, detectProvider } from '../services/providers';
import { retrieveMemory, ensureSession } from '../services/vectorvault';
import { formatMemoryContext } from '../formatters';
import type { AnthropicMessageRequest, Message, MemoryOptions } from '../types';

const messages = new Hono();

/**
 * POST /v1/messages
 * Anthropic Messages API compatible endpoint
 */
messages.post('/', async (c) => {
  const userContext = getUserContext(c);
  
  // Parse request body
  let body: AnthropicMessageRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({
      error: {
        type: 'invalid_request',
        message: 'Invalid JSON body.',
        code: 'INVALID_JSON',
      },
    }, 400);
  }
  
  // Validate required fields
  if (!body.model) {
    return c.json({
      error: {
        type: 'invalid_request',
        message: 'Missing required field: model',
        code: 'MISSING_MODEL',
      },
    }, 400);
  }
  
  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({
      error: {
        type: 'invalid_request',
        message: 'Missing required field: messages',
        code: 'MISSING_MESSAGES',
      },
    }, 400);
  }
  
  if (!body.max_tokens) {
    return c.json({
      error: {
        type: 'invalid_request',
        message: 'Missing required field: max_tokens',
        code: 'MISSING_MAX_TOKENS',
      },
    }, 400);
  }
  
  // Parse memory options
  const memoryOptions = parseMemoryOptions(c, body);
  const sessionId = resolveSessionId(memoryOptions, userContext.memoryKey.key);
  
  // This endpoint is always Anthropic
  const provider = detectProvider(body.model);
  console.log(`[MESSAGES] Model: ${body.model}, Provider: ${provider}, Session: ${sessionId}`);
  
  // Get Anthropic API key
  const apiKey = userContext.providerKeys['anthropic'] ?? userContext.providerKeys[provider];
  if (!apiKey) {
    return c.json({
      error: {
        type: 'provider_key_missing',
        message: 'No Anthropic API key found. Add one at app.memoryrouter.ai/keys',
        code: 'PROVIDER_KEY_MISSING',
        provider: 'anthropic',
      },
    }, 422);
  }
  
  // Memory injection
  let augmentedBody = body;
  let retrieval = null;
  
  if (memoryOptions.mode !== 'off' && memoryOptions.mode !== 'write') {
    await ensureSession(userContext.memoryKey.key, sessionId);
    
    // Extract query from last user message
    const lastUserMsg = [...body.messages].reverse().find(m => m.role === 'user');
    const query = typeof lastUserMsg?.content === 'string' 
      ? lastUserMsg.content 
      : '';
    
    if (query) {
      retrieval = await retrieveMemory(
        userContext.memoryKey.key,
        sessionId,
        query,
        { limit: memoryOptions.contextLimit, recencyBias: memoryOptions.recencyBias }
      );
      
      if (retrieval.chunks.length > 0) {
        // Format context for Claude
        const contextText = retrieval.chunks
          .map(chunk => `[${chunk.role}${chunk.window ? ` | ${chunk.window}` : ''}] ${chunk.content}`)
          .join('\n\n');
        
        const formattedContext = formatMemoryContext(body.model, contextText);
        
        // Inject into system field (Anthropic's native format)
        const existingSystem = typeof body.system === 'string' ? body.system : '';
        augmentedBody = {
          ...body,
          system: formattedContext + (existingSystem ? `\n\n${existingSystem}` : ''),
        };
        
        console.log(`[MESSAGES:INJECT] Injected ${retrieval.chunks.length} chunks into system field`);
      }
    }
  }
  
  // Forward to Anthropic
  let providerResponse: Response;
  try {
    providerResponse = await forwardAnthropicMessages(apiKey, augmentedBody);
  } catch (error) {
    console.error('[MESSAGES] Provider error:', error);
    return c.json({
      error: {
        type: 'provider_error',
        message: 'Failed to connect to Anthropic.',
        code: 'PROVIDER_CONNECT_FAILED',
      },
    }, 502);
  }
  
  if (!providerResponse.ok) {
    const errorBody = await providerResponse.text();
    console.error(`[MESSAGES] Anthropic returned ${providerResponse.status}:`, errorBody);
    
    try {
      return c.json(JSON.parse(errorBody), providerResponse.status as 400 | 401 | 403 | 404 | 429 | 500);
    } catch {
      return c.json({
        error: {
          type: 'provider_error',
          message: errorBody,
          code: 'PROVIDER_ERROR',
        },
      }, providerResponse.status as 400 | 401 | 403 | 404 | 429 | 500);
    }
  }
  
  // Add memory headers
  c.header('X-Memory-Tokens-Retrieved', String(retrieval?.tokenCount ?? 0));
  c.header('X-Memory-Session', sessionId);
  
  // Handle streaming
  if (body.stream) {
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    
    return stream(c, async (streamWriter) => {
      const reader = providerResponse.body?.getReader();
      if (!reader) return;
      
      const decoder = new TextDecoder();
      let fullResponse = '';
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          await streamWriter.write(chunk);
          
          // Extract text for storage
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.delta?.text) {
                  fullResponse += data.delta.text;
                }
                if (data.type === 'content_block_delta' && data.delta?.text) {
                  fullResponse += data.delta.text;
                }
              } catch {
                // ignore
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      
      // Convert Anthropic messages to our Message format for storage
      const messagesForStorage: Message[] = body.messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        memory: m.memory,
      }));
      
      await storeConversation(
        userContext.memoryKey.key,
        sessionId,
        messagesForStorage,
        fullResponse,
        body.model,
        provider,
        memoryOptions
      );
    });
  }
  
  // Non-streaming
  const responseBody = await providerResponse.json();
  
  // Extract response text
  let assistantResponse = '';
  if (Array.isArray(responseBody.content)) {
    assistantResponse = responseBody.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('');
  }
  
  // Store conversation (non-blocking)
  const messagesForStorage: Message[] = body.messages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    memory: m.memory,
  }));
  
  storeConversation(
    userContext.memoryKey.key,
    sessionId,
    messagesForStorage,
    assistantResponse,
    body.model,
    provider,
    memoryOptions
  ).catch(err => console.error('[MESSAGES] Background storage error:', err));
  
  // Enrich response
  return c.json({
    ...responseBody,
    _memory: {
      session_id: sessionId,
      tokens_retrieved: retrieval?.tokenCount ?? 0,
      chunks_retrieved: retrieval?.chunks.length ?? 0,
    },
  });
});

export default messages;
