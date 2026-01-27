/**
 * Test Application Helpers
 * 
 * Utilities for creating test instances of the MemoryRouter app
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from '../../src/middleware/auth';
import chatRoutes from '../../src/routes/chat';

/**
 * Create a test instance of the app
 */
export function createTestApp() {
  const app = new Hono();
  
  // Minimal middleware for testing
  app.use('*', cors());
  
  // Health check
  app.get('/', (c) => c.json({ status: 'ok', version: 'test' }));
  app.get('/health', (c) => c.json({ status: 'healthy' }));
  
  // API routes
  const v1 = new Hono();
  v1.use('*', authMiddleware);
  v1.route('/chat', chatRoutes);
  
  app.route('/v1', v1);
  
  return app;
}

/**
 * Make a chat completion request to the test app
 */
export async function makeChatRequest(
  app: Hono,
  options: {
    memoryKey?: string;
    model?: string;
    messages?: Array<{ role: string; content: string; memory?: boolean }>;
    stream?: boolean;
    headers?: Record<string, string>;
  }
) {
  const {
    memoryKey = 'mk_test_key',
    model = 'openai/gpt-4',
    messages = [{ role: 'user', content: 'Hello' }],
    stream = false,
    headers = {},
  } = options;
  
  return app.request('/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${memoryKey}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      model,
      messages,
      stream,
    }),
  });
}

/**
 * Make a raw HTTP request (for testing edge cases)
 */
export async function makeRawRequest(
  app: Hono,
  path: string,
  options: RequestInit = {}
) {
  return app.request(path, options);
}

/**
 * Wait for async operations to complete
 */
export function waitFor(ms: number = 100): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract response body safely
 */
export async function getResponseBody<T = unknown>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

/**
 * Read streaming response
 */
export async function readStreamingResponse(response: Response): Promise<string[]> {
  const chunks: string[] = [];
  const reader = response.body?.getReader();
  
  if (!reader) return chunks;
  
  const decoder = new TextDecoder();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const text = decoder.decode(value, { stream: true });
    chunks.push(text);
  }
  
  return chunks;
}

/**
 * Parse SSE (Server-Sent Events) data
 */
export function parseSSEChunks(chunks: string[]): unknown[] {
  const events: unknown[] = [];
  
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ') && !line.includes('[DONE]')) {
        try {
          events.push(JSON.parse(line.slice(6)));
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
  
  return events;
}
