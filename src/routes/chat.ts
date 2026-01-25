/**
 * Chat Completions Route
 * POST /v1/chat/completions
 * OpenAI-compatible endpoint with memory injection
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { getUserContext } from '../middleware/auth';
import { parseMemoryOptions, injectMemoryContext, storeConversation } from '../middleware/memory';
import { detectProvider, forwardToProvider, type ChatCompletionRequest } from '../services/providers';

const chat = new Hono();

/**
 * POST /v1/chat/completions
 * Main proxy endpoint
 */
chat.post('/completions', async (c) => {
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
  console.log(`[CHAT] Model: ${body.model}, Provider: ${provider}`);
  
  // Get provider API key
  const apiKey = userContext.providerKeys[provider];
  if (!apiKey) {
    return c.json({ 
      error: `No API key configured for provider: ${provider}`,
      hint: `Add your ${provider} API key in your account settings`,
    }, 400);
  }
  
  // Inject memory context
  const { augmentedBody, retrieval } = await injectMemoryContext(
    userContext.memoryKey.key,
    body,
    memoryOptions
  );
  
  // Forward to provider
  let providerResponse: Response;
  try {
    providerResponse = await forwardToProvider(provider, apiKey, augmentedBody);
  } catch (error) {
    console.error('[CHAT] Provider error:', error);
    return c.json({ 
      error: 'Failed to connect to provider',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 502);
  }
  
  // Check for provider errors
  if (!providerResponse.ok) {
    const errorBody = await providerResponse.text();
    console.error(`[CHAT] Provider returned ${providerResponse.status}:`, errorBody);
    
    try {
      const errorJson = JSON.parse(errorBody);
      return c.json({ 
        error: 'Provider error',
        provider_error: errorJson,
      }, providerResponse.status as 400 | 401 | 403 | 404 | 500);
    } catch {
      return c.json({ 
        error: 'Provider error',
        details: errorBody,
      }, providerResponse.status as 400 | 401 | 403 | 404 | 500);
    }
  }
  
  // Handle streaming response
  if (body.stream) {
    // Set streaming headers
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    c.header('X-Memory-Tokens-Retrieved', String(retrieval?.tokenCount ?? 0));
    
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
          
          // Try to extract content for memory storage
          // This is a simplified extraction - production would parse SSE properly
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ') && !line.includes('[DONE]')) {
              try {
                const data = JSON.parse(line.slice(6));
                // OpenAI format
                const content = data.choices?.[0]?.delta?.content;
                // Anthropic format
                const anthropicContent = data.delta?.text;
                if (content) fullResponse += content;
                if (anthropicContent) fullResponse += anthropicContent;
              } catch {
                // Ignore parse errors in stream
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      
      // Store conversation after streaming completes
      await storeConversation(
        userContext.memoryKey.key,
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
  
  // Extract assistant response for storage
  let assistantResponse = '';
  
  // OpenAI format
  if (responseBody.choices?.[0]?.message?.content) {
    assistantResponse = responseBody.choices[0].message.content;
  }
  // Anthropic format
  else if (responseBody.content?.[0]?.text) {
    assistantResponse = responseBody.content[0].text;
  }
  
  // Store conversation
  await storeConversation(
    userContext.memoryKey.key,
    body.messages,
    assistantResponse,
    body.model,
    provider,
    memoryOptions
  );
  
  // Add memory metadata to response
  const enrichedResponse = {
    ...responseBody,
    _memory: {
      key: userContext.memoryKey.key,
      tokens_retrieved: retrieval?.tokenCount ?? 0,
      chunks_retrieved: retrieval?.chunks.length ?? 0,
    },
  };
  
  return c.json(enrichedResponse);
});

export default chat;
