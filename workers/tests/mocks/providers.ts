/**
 * Mock provider APIs for testing
 */

// Store mock responses
const mockResponses: Map<string, { ok: boolean; status: number; body: unknown }> = new Map();

// Store captured requests for assertions
export const capturedRequests: Array<{
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}> = [];

/**
 * Clear all mock state
 */
export function clearMocks(): void {
  mockResponses.clear();
  capturedRequests.length = 0;
}

/**
 * Set a mock response for a URL pattern
 */
export function mockResponse(urlPattern: string, response: { ok?: boolean; status?: number; body: unknown }): void {
  mockResponses.set(urlPattern, {
    ok: response.ok ?? true,
    status: response.status ?? 200,
    body: response.body,
  });
}

/**
 * Mock fetch that intercepts API calls
 */
export async function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method || 'GET';
  const headers: Record<string, string> = {};
  
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [key, value] of init.headers) {
        headers[key] = value;
      }
    } else {
      Object.assign(headers, init.headers);
    }
  }
  
  let body: unknown = null;
  if (init?.body) {
    try {
      body = JSON.parse(init.body as string);
    } catch {
      body = init.body;
    }
  }
  
  // Capture request
  capturedRequests.push({ url, method, headers, body });
  
  // Find matching mock
  for (const [pattern, response] of mockResponses) {
    if (url.includes(pattern)) {
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
  
  // Default mock responses
  if (url.includes('/v1/embeddings')) {
    return mockEmbeddingResponse();
  }
  
  if (url.includes('api.openai.com/v1/chat/completions')) {
    return mockOpenAIChatResponse(body as { stream?: boolean });
  }
  
  if (url.includes('api.anthropic.com/v1/messages')) {
    return mockAnthropicChatResponse(body as { stream?: boolean });
  }
  
  // Default error
  return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
}

/**
 * Generate a consistent mock embedding
 */
function generateMockEmbedding(dims: number = 3072): number[] {
  // Generate deterministic embedding for testing
  const embedding: number[] = [];
  for (let i = 0; i < dims; i++) {
    embedding.push(Math.sin(i) * 0.1);
  }
  return embedding;
}

/**
 * Mock OpenAI embedding response
 */
function mockEmbeddingResponse(): Response {
  return new Response(JSON.stringify({
    object: 'list',
    data: [{
      object: 'embedding',
      index: 0,
      embedding: generateMockEmbedding(3072),
    }],
    model: 'text-embedding-3-large',
    usage: {
      prompt_tokens: 10,
      total_tokens: 10,
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Mock OpenAI chat response
 */
function mockOpenAIChatResponse(body?: { stream?: boolean }): Response {
  if (body?.stream) {
    // Streaming response
    const chunks = [
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" from"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" mock!"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    
    return new Response(chunks.join(''), {
      status: 200,
      headers: { 
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  }
  
  return new Response(JSON.stringify({
    id: 'chatcmpl-123',
    object: 'chat.completion',
    created: Date.now(),
    model: 'gpt-4',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: 'Hello from mock!',
      },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Mock Anthropic chat response
 */
function mockAnthropicChatResponse(body?: { stream?: boolean }): Response {
  if (body?.stream) {
    const chunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","content":[],"model":"claude-3-opus-20240229"}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" from Claude!"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    
    return new Response(chunks.join(''), {
      status: 200,
      headers: { 
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  }
  
  return new Response(JSON.stringify({
    id: 'msg_123',
    type: 'message',
    role: 'assistant',
    content: [{
      type: 'text',
      text: 'Hello from Claude!',
    }],
    model: 'claude-3-opus-20240229',
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 10,
      output_tokens: 5,
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Install mock fetch globally
 */
export function installMockFetch(): void {
  (global as unknown as { fetch: typeof fetch }).fetch = mockFetch;
}

/**
 * Get last captured request
 */
export function getLastRequest(): typeof capturedRequests[0] | undefined {
  return capturedRequests[capturedRequests.length - 1];
}

/**
 * Get requests matching a URL pattern
 */
export function getRequestsTo(urlPattern: string): typeof capturedRequests {
  return capturedRequests.filter(r => r.url.includes(urlPattern));
}
