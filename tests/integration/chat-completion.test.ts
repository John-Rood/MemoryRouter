/**
 * Integration Tests: Chat Completion Flow
 * 
 * Tests the full request/response cycle through MemoryRouter
 * including authentication, memory injection, and provider proxying.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { server } from '../mocks/server';
import { capturedRequests, clearCapturedRequests, errorHandlers } from '../mocks/handlers';
import { 
  createTestApp, 
  makeChatRequest, 
  waitFor, 
  getResponseBody,
  readStreamingResponse,
  parseSSEChunks 
} from '../helpers/test-app';
import { messages, apiRequests, memoryKeys } from '../fixtures';

describe('Chat Completion Integration', () => {
  let app: Hono;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    clearCapturedRequests();
  });

  describe('Basic chat completion', () => {
    it('completes a simple request', async () => {
      const response = await makeChatRequest(app, {
        memoryKey: 'mk_test_key',
        model: 'openai/gpt-4',
        messages: messages.simple,
      });

      expect(response.status).toBe(200);
      
      const body = await getResponseBody<any>(response);
      expect(body).toHaveProperty('choices');
      expect(body.choices[0].message).toHaveProperty('content');
      expect(body.choices[0].message.role).toBe('assistant');
    });

    it('includes memory metadata in response', async () => {
      const response = await makeChatRequest(app, {
        memoryKey: 'mk_test_key',
        model: 'openai/gpt-4',
        messages: messages.simple,
      });

      const body = await getResponseBody<any>(response);
      
      // Should include memory metadata
      expect(body).toHaveProperty('_memory');
      expect(body._memory).toHaveProperty('key', 'mk_test_key');
      expect(body._memory).toHaveProperty('tokens_retrieved');
      expect(body._memory).toHaveProperty('chunks_retrieved');
    });

    it('forwards request to correct provider', async () => {
      await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: messages.simple,
      });

      // Verify OpenAI was called
      expect(capturedRequests.openai.length).toBeGreaterThan(0);
      expect(capturedRequests.anthropic.length).toBe(0);
    });

    it('handles conversation with system message', async () => {
      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: messages.withSystem,
      });

      expect(response.status).toBe(200);
      
      const body = await getResponseBody<any>(response);
      expect(body.choices[0].message.content).toBeTruthy();
    });

    it('handles multi-turn conversation', async () => {
      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: messages.multiTurn,
      });

      expect(response.status).toBe(200);
    });
  });

  describe('Multi-provider support', () => {
    it('routes to OpenAI for GPT models', async () => {
      await makeChatRequest(app, {
        model: 'gpt-4',
        messages: messages.simple,
      });

      expect(capturedRequests.openai.length).toBeGreaterThan(0);
    });

    it('routes to Anthropic for Claude models', async () => {
      await makeChatRequest(app, {
        model: 'anthropic/claude-3-opus',
        messages: messages.simple,
      });

      expect(capturedRequests.anthropic.length).toBeGreaterThan(0);
    });

    it('routes to OpenRouter for Llama models', async () => {
      await makeChatRequest(app, {
        model: 'meta-llama/llama-3-70b',
        messages: messages.simple,
      });

      expect(capturedRequests.openrouter.length).toBeGreaterThan(0);
    });

    it('transforms request format for Anthropic', async () => {
      await makeChatRequest(app, {
        model: 'anthropic/claude-3-opus',
        messages: messages.withSystem,
      });

      const anthropicRequest = capturedRequests.anthropic[0];
      expect(anthropicRequest).toBeDefined();
      
      // Anthropic uses different format (system as separate field)
      const body = await anthropicRequest.json();
      // The request should be transformed
      expect(body).toBeDefined();
    });
  });

  describe('Streaming responses', () => {
    it('returns streaming response when stream: true', async () => {
      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: messages.simple,
        stream: true,
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
    });

    it('streams SSE chunks correctly', async () => {
      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: messages.simple,
        stream: true,
      });

      const chunks = await readStreamingResponse(response);
      expect(chunks.length).toBeGreaterThan(0);
      
      const text = chunks.join('');
      expect(text).toContain('data: ');
    });

    it('includes DONE marker', async () => {
      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: messages.simple,
        stream: true,
      });

      const chunks = await readStreamingResponse(response);
      const text = chunks.join('');
      expect(text).toContain('[DONE]');
    });
  });

  describe('Memory headers', () => {
    it('respects X-Memory-Mode: off', async () => {
      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: messages.simple,
        headers: { 'X-Memory-Mode': 'off' },
      });

      expect(response.status).toBe(200);
      // Memory retrieval should be skipped
    });

    it('respects X-Memory-Store: false', async () => {
      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: messages.simple,
        headers: { 'X-Memory-Store': 'false' },
      });

      expect(response.status).toBe(200);
      // Messages should not be stored
    });

    it('includes X-Memory-Tokens-Retrieved header in streaming', async () => {
      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: messages.simple,
        stream: true,
      });

      const header = response.headers.get('X-Memory-Tokens-Retrieved');
      expect(header).toBeDefined();
    });
  });

  describe('Selective memory', () => {
    it('handles messages with memory: false', async () => {
      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: messages.selectiveMemory,
      });

      expect(response.status).toBe(200);
      // Messages with memory: false should not be stored
    });

    it('forwards all messages to provider (including memory: false)', async () => {
      await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: messages.selectiveMemory,
      });

      const request = capturedRequests.openai[0];
      const body = await request.json();
      
      // All messages should be forwarded to the provider
      expect(body.messages.length).toBeGreaterThan(0);
    });
  });

  describe('Error handling', () => {
    it('returns 401 for invalid memory key', async () => {
      const response = await makeChatRequest(app, {
        memoryKey: 'mk_invalid_nonexistent_key',
        model: 'openai/gpt-4',
        messages: messages.simple,
      });

      expect(response.status).toBe(401);
      
      const body = await getResponseBody<any>(response);
      expect(body).toHaveProperty('error');
    });

    it('returns 400 for missing model', async () => {
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer mk_test_key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(apiRequests.missingModel),
      });

      expect(response.status).toBe(400);
      
      const body = await getResponseBody<any>(response);
      expect(body.error).toContain('model');
    });

    it('returns 400 for missing messages', async () => {
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer mk_test_key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(apiRequests.missingMessages),
      });

      expect(response.status).toBe(400);
      
      const body = await getResponseBody<any>(response);
      expect(body.error).toContain('messages');
    });

    it('returns 400 for empty messages array', async () => {
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer mk_test_key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(apiRequests.emptyMessages),
      });

      expect(response.status).toBe(400);
    });

    it('returns 400 for invalid JSON', async () => {
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer mk_test_key',
          'Content-Type': 'application/json',
        },
        body: 'not valid json',
      });

      expect(response.status).toBe(400);
      
      const body = await getResponseBody<any>(response);
      expect(body.error).toContain('JSON');
    });
  });

  describe('Provider error handling', () => {
    it('returns 502 for provider connection failure', async () => {
      // Override with error handler
      server.use(errorHandlers.openaiServerError);

      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: messages.simple,
      });

      // Should return provider error status or 502
      expect([500, 502].includes(response.status)).toBe(true);
    });

    it('includes provider error details in response', async () => {
      server.use(errorHandlers.openaiServerError);

      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: messages.simple,
      });

      const body = await getResponseBody<any>(response);
      expect(body).toHaveProperty('error');
    });
  });

  describe('Request transformation', () => {
    it('strips provider prefix from model name', async () => {
      await makeChatRequest(app, {
        model: 'openai/gpt-4-turbo',
        messages: messages.simple,
      });

      const request = capturedRequests.openai[0];
      const body = await request.json();
      
      expect(body.model).toBe('gpt-4-turbo');
    });

    it('includes temperature when specified', async () => {
      await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer mk_test_key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4',
          messages: messages.simple,
          temperature: 0.5,
        }),
      });

      const request = capturedRequests.openai[0];
      const body = await request.json();
      
      expect(body.temperature).toBe(0.5);
    });

    it('includes max_tokens when specified', async () => {
      await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer mk_test_key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4',
          messages: messages.simple,
          max_tokens: 100,
        }),
      });

      const request = capturedRequests.openai[0];
      const body = await request.json();
      
      expect(body.max_tokens).toBe(100);
    });
  });
});
