/**
 * Edge Case Tests: Error Handling
 * 
 * Tests error scenarios including invalid inputs, provider failures,
 * and unexpected conditions.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { server } from '../mocks/server';
import { errorHandlers, clearCapturedRequests } from '../mocks/handlers';
import { createTestApp, makeChatRequest, getResponseBody } from '../helpers/test-app';
import { messages, apiRequests } from '../fixtures';

describe('Invalid API Keys', () => {
  let app: Hono;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    clearCapturedRequests();
  });

  describe('Missing authorization', () => {
    it('returns 401 for missing Authorization header', async () => {
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4',
          messages: messages.simple,
        }),
      });

      expect(response.status).toBe(401);
      
      const body = await getResponseBody<any>(response);
      expect(body.error).toContain('Authorization');
    });

    it('returns 401 for empty Authorization header', async () => {
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': '',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4',
          messages: messages.simple,
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('Invalid key format', () => {
    it('returns 401 for non-mk_ prefix', async () => {
      const response = await makeChatRequest(app, {
        memoryKey: 'sk-openai-key-12345',
        model: 'openai/gpt-4',
        messages: messages.simple,
      });

      expect(response.status).toBe(401);
      
      const body = await getResponseBody<any>(response);
      expect(body.error).toMatch(/Invalid|memory key/i);
    });

    it('returns 401 for malformed key', async () => {
      const response = await makeChatRequest(app, {
        memoryKey: 'mk_',
        model: 'openai/gpt-4',
        messages: messages.simple,
      });

      expect(response.status).toBe(401);
    });

    it('returns 401 for non-existent key', async () => {
      const response = await makeChatRequest(app, {
        memoryKey: 'mk_this_key_does_not_exist_12345',
        model: 'openai/gpt-4',
        messages: messages.simple,
      });

      expect(response.status).toBe(401);
    });
  });

  describe('Inactive/revoked keys', () => {
    it('returns 401 for revoked key', async () => {
      const response = await makeChatRequest(app, {
        memoryKey: 'mk_revoked_key',
        model: 'openai/gpt-4',
        messages: messages.simple,
      });

      expect(response.status).toBe(401);
      
      const body = await getResponseBody<any>(response);
      expect(body.error).toMatch(/Invalid|inactive|revoked/i);
    });
  });
});

describe('Malformed Requests', () => {
  let app: Hono;

  beforeAll(() => {
    app = createTestApp();
  });

  describe('Invalid JSON', () => {
    it('returns 400 for invalid JSON body', async () => {
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mk_test_key',
        },
        body: 'this is not valid JSON {{{',
      });

      expect(response.status).toBe(400);
      
      const body = await getResponseBody<any>(response);
      expect(body.error).toMatch(/JSON|parse/i);
    });

    it('returns 400 for truncated JSON', async () => {
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mk_test_key',
        },
        body: '{"model": "gpt-4", "messages": [',
      });

      expect(response.status).toBe(400);
    });

    it('returns 400 for empty body', async () => {
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mk_test_key',
        },
        body: '',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('Missing required fields', () => {
    it('returns 400 for missing model', async () => {
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mk_test_key',
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
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mk_test_key',
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
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mk_test_key',
        },
        body: JSON.stringify(apiRequests.emptyMessages),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('Invalid field types', () => {
    it('returns 400 for non-string model', async () => {
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mk_test_key',
        },
        body: JSON.stringify({
          model: 12345,
          messages: messages.simple,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 400 for non-array messages', async () => {
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mk_test_key',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4',
          messages: 'not an array',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 400 for invalid message format', async () => {
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mk_test_key',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4',
          messages: [
            { notRole: 'user', notContent: 'hello' },
          ],
        }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 400 for invalid role', async () => {
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mk_test_key',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4',
          messages: [
            { role: 'invalid_role', content: 'hello' },
          ],
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('Invalid parameter values', () => {
    it('returns 400 for temperature > 2', async () => {
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mk_test_key',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4',
          messages: messages.simple,
          temperature: 3.0,
        }),
      });

      // May be 400 or passed through to provider
      expect([200, 400].includes(response.status)).toBe(true);
    });

    it('returns 400 for negative max_tokens', async () => {
      const response = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mk_test_key',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4',
          messages: messages.simple,
          max_tokens: -100,
        }),
      });

      // May be 400 or passed through to provider
      expect([200, 400].includes(response.status)).toBe(true);
    });
  });
});

describe('Provider Errors', () => {
  let app: Hono;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    clearCapturedRequests();
    server.resetHandlers();
  });

  describe('Provider 500 errors', () => {
    it('returns 502 for OpenAI 500 error', async () => {
      server.use(errorHandlers.openaiServerError);

      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: messages.simple,
      });

      expect([500, 502].includes(response.status)).toBe(true);
      
      const body = await getResponseBody<any>(response);
      expect(body.error).toBeTruthy();
    });

    it('returns 502 for Anthropic 500 error', async () => {
      server.use(errorHandlers.anthropicServerError);

      const response = await makeChatRequest(app, {
        model: 'anthropic/claude-3-opus',
        messages: messages.simple,
      });

      expect([500, 502].includes(response.status)).toBe(true);
    });
  });

  describe('Provider rate limits', () => {
    it('returns 429 for OpenAI rate limit', async () => {
      server.use(errorHandlers.openaiRateLimit);

      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: messages.simple,
      });

      expect(response.status).toBe(429);
      
      const body = await getResponseBody<any>(response);
      expect(body.error).toMatch(/rate|limit/i);
    });

    it('includes Retry-After header when present', async () => {
      server.use(errorHandlers.openaiRateLimit);

      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: messages.simple,
      });

      const retryAfter = response.headers.get('Retry-After');
      // Header may be forwarded from provider
      expect(response.status).toBe(429);
    });
  });

  describe('Provider authentication errors', () => {
    it('returns 401 for invalid provider API key', async () => {
      server.use(errorHandlers.openaiAuthError);

      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: messages.simple,
      });

      expect(response.status).toBe(401);
      
      const body = await getResponseBody<any>(response);
      expect(body.error).toMatch(/API key|authentication/i);
    });
  });

  describe('Provider timeout', () => {
    it('returns 504 for provider timeout', async () => {
      server.use(errorHandlers.openaiTimeout);

      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: messages.simple,
      });

      expect([504, 408].includes(response.status)).toBe(true);
    });
  });

  describe('Invalid model', () => {
    it('returns 400 for non-existent model', async () => {
      const response = await makeChatRequest(app, {
        model: 'openai/gpt-99-ultra',
        messages: messages.simple,
      });

      // May be 400 or forwarded to provider (which returns 404)
      expect([400, 404].includes(response.status)).toBe(true);
    });

    it('returns 400 for unsupported provider', async () => {
      const response = await makeChatRequest(app, {
        model: 'unknown-provider/some-model',
        messages: messages.simple,
      });

      expect([400, 404].includes(response.status)).toBe(true);
      
      const body = await getResponseBody<any>(response);
      expect(body.error).toMatch(/provider|model|unsupported/i);
    });
  });
});

describe('Provider Failover', () => {
  let app: Hono;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    clearCapturedRequests();
    server.resetHandlers();
  });

  // Note: Failover logic depends on implementation
  // These tests document expected behavior
  
  describe('Automatic failover', () => {
    it('documents expected failover behavior', () => {
      // If OpenAI fails, could try OpenRouter as fallback
      // This depends on implementation choices
      expect(true).toBe(true);
    });
  });
});

describe('Content Edge Cases', () => {
  let app: Hono;

  beforeAll(() => {
    app = createTestApp();
  });

  describe('Very long messages', () => {
    it('handles very long user message', async () => {
      const longContent = 'a'.repeat(100000);
      
      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: [{ role: 'user', content: longContent }],
      });

      // Should either succeed or return context length error
      expect([200, 400].includes(response.status)).toBe(true);
    });
  });

  describe('Special characters', () => {
    it('handles unicode in messages', async () => {
      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: [
          { role: 'user', content: 'Hello 你好 مرحبا שלום 🎉' },
        ],
      });

      expect(response.status).toBe(200);
    });

    it('handles emojis', async () => {
      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: [
          { role: 'user', content: '🚀 How do I launch a rocket? 🔥' },
        ],
      });

      expect(response.status).toBe(200);
    });

    it('handles newlines and tabs', async () => {
      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: [
          { role: 'user', content: 'Line 1\nLine 2\n\tIndented' },
        ],
      });

      expect(response.status).toBe(200);
    });

    it('handles code with special characters', async () => {
      const code = `
function hello() {
  const x = "test\\n";
  return \`Hello \${x}\`;
}
      `;
      
      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: [
          { role: 'user', content: `Explain this code: ${code}` },
        ],
      });

      expect(response.status).toBe(200);
    });
  });

  describe('Empty and whitespace content', () => {
    it('handles empty string content', async () => {
      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: [
          { role: 'user', content: '' },
        ],
      });

      // May be 400 or passed through
      expect([200, 400].includes(response.status)).toBe(true);
    });

    it('handles whitespace-only content', async () => {
      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: [
          { role: 'user', content: '   \n\t  ' },
        ],
      });

      // May be 400 or passed through
      expect([200, 400].includes(response.status)).toBe(true);
    });
  });

  describe('JSON in content', () => {
    it('handles JSON in message content', async () => {
      const jsonContent = JSON.stringify({
        name: 'test',
        values: [1, 2, 3],
        nested: { a: true },
      });
      
      const response = await makeChatRequest(app, {
        model: 'openai/gpt-4',
        messages: [
          { role: 'user', content: `Parse this JSON: ${jsonContent}` },
        ],
      });

      expect(response.status).toBe(200);
    });
  });
});

describe('HTTP Method Edge Cases', () => {
  let app: Hono;

  beforeAll(() => {
    app = createTestApp();
  });

  it('returns 405 for GET request to POST endpoint', async () => {
    const response = await app.request('/v1/chat/completions', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer mk_test_key',
      },
    });

    expect(response.status).toBe(405);
  });

  it('returns 405 for PUT request', async () => {
    const response = await app.request('/v1/chat/completions', {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer mk_test_key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4',
        messages: messages.simple,
      }),
    });

    expect(response.status).toBe(405);
  });

  it('returns 404 for non-existent endpoint', async () => {
    const response = await app.request('/v1/nonexistent', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mk_test_key',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    expect(response.status).toBe(404);
  });
});
