/**
 * Chat Completions Route
 * POST /v1/chat/completions
 * 
 * OpenAI-compatible drop-in endpoint with memory injection.
 * This is the main inference endpoint.
 * 
 * Reference: memoryrouter-product-spec.md Section 5.3
 * 
 * Flow (spec Section 6.2):
 *   1. Auth (validate mk_xxx) → done by middleware
 *   2. Session resolution (get/create session vault)
 *   3. Memory retrieval (KRONOS RAG across 4 windows)
 *   4. Context injection (format for target model)
 *   5. Forward to provider (with user's API key)
 *   6. Store new memories (async, non-blocking)
 *   7. Meter usage (count tokens stored)
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { getUserContext } from '../middleware/auth';
import { parseMemoryOptions, injectMemoryContext, storeConversation } from '../middleware/memory';
import { detectProvider, forwardToProvider } from '../services/providers';
import type { ChatCompletionRequest } from '../types';

const chat = new Hono();

/**
 * POST /v1/chat/completions
 * Main proxy endpoint — OpenAI-compatible
 */
chat.post('/completions', async (c) => {
  const userContext = getUserContext(c);
  
  // Parse request body
  let body: ChatCompletionRequest;
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
        message: 'Missing required field: messages (must be a non-empty array)',
        code: 'MISSING_MESSAGES',
      },
    }, 400);
  }
  
  // Parse memory options (including session_id from body)
  const memoryOptions = parseMemoryOptions(c, body);
  
  // Detect provider from model
  const provider = detectProvider(body.model);
  console.log(`[CHAT] Model: ${body.model}, Provider: ${provider}, Session: ${memoryOptions.sessionId ?? '(default)'}`);
  
  // Get provider API key (BYOK)
  const apiKey = userContext.providerKeys[provider];
  if (!apiKey) {
    return c.json({
      error: {
        type: 'provider_key_missing',
        message: `No ${provider} API key found. Add one at app.memoryrouter.ai/keys`,
        code: 'PROVIDER_KEY_MISSING',
        provider,
      },
    }, 422);
  }
  
  // Step 2+3+4: Session resolution + Memory retrieval + Context injection
  const { augmentedBody, retrieval, sessionId } = await injectMemoryContext(
    userContext.memoryKey.key,
    body,
    memoryOptions
  );
  
  // Step 5: Forward to provider
  let providerResponse: Response;
  try {
    providerResponse = await forwardToProvider(provider, apiKey, augmentedBody);
  } catch (error) {
    console.error('[CHAT] Provider error:', error);
    return c.json({
      error: {
        type: 'provider_error',
        message: 'Failed to connect to provider.',
        code: 'PROVIDER_CONNECT_FAILED',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    }, 502);
  }
  
  // Check for provider errors
  if (!providerResponse.ok) {
    const errorBody = await providerResponse.text();
    console.error(`[CHAT] Provider returned ${providerResponse.status}:`, errorBody);
    
    try {
      const errorJson = JSON.parse(errorBody);
      return c.json({
        error: {
          type: 'provider_error',
          message: 'Provider returned an error.',
          code: 'PROVIDER_ERROR',
          provider_error: errorJson,
        },
      }, providerResponse.status as 400 | 401 | 403 | 404 | 429 | 500);
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
  
  // Add memory headers to response
  c.header('X-Memory-Tokens-Retrieved', String(retrieval?.tokenCount ?? 0));
  c.header('X-Memory-Session', sessionId);
  
  // Handle streaming response
  if (body.stream) {
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    
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
                const content = data.choices?.[0]?.delta?.content;      // OpenAI format
                const anthropicContent = data.delta?.text;               // Anthropic format
                if (content) fullResponse += content;
                if (anthropicContent) fullResponse += anthropicContent;
              } catch {
                // Ignore parse errors in stream chunks
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      
      // Step 6: Store conversation after streaming completes
      await storeConversation(
        userContext.memoryKey.key,
        sessionId,
        body.messages,
        fullResponse,
        body.model,
        provider,
        memoryOptions
      );
    });
  }
  
  // Handle non-streaming response
  const responseBody = await providerResponse.json();
  
  // Extract assistant response
  let assistantResponse = '';
  
  // OpenAI format
  if (responseBody.choices?.[0]?.message?.content) {
    assistantResponse = responseBody.choices[0].message.content;
  }
  // Anthropic format
  else if (responseBody.content?.[0]?.text) {
    assistantResponse = responseBody.content[0].text;
  }
  
  // Step 6: Store conversation (non-blocking via Promise — no await in production)
  storeConversation(
    userContext.memoryKey.key,
    sessionId,
    body.messages,
    assistantResponse,
    body.model,
    provider,
    memoryOptions
  ).catch(err => console.error('[CHAT] Background storage error:', err));
  
  // Add memory metadata to response
  const enrichedResponse = {
    ...responseBody,
    _memory: {
      session_id: sessionId,
      tokens_retrieved: retrieval?.tokenCount ?? 0,
      chunks_retrieved: retrieval?.chunks.length ?? 0,
      window_breakdown: retrieval?.windowBreakdown ?? null,
    },
  };
  
  // Set stored tokens header (approximate — actual counting is async)
  c.header('X-Memory-Tokens-Stored', String(
    Math.ceil((assistantResponse.length + body.messages.filter(m => m.role === 'user' && m.memory !== false).reduce((s, m) => s + m.content.length, 0)) / 4)
  ));
  
  return c.json(enrichedResponse);
});

export default chat;
