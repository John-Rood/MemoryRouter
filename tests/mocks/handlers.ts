/**
 * MSW Request Handlers
 * 
 * Mock handlers for all external APIs:
 * - OpenAI Chat Completions
 * - Anthropic Messages
 * - OpenRouter
 * - Google Gemini
 * - Stripe (webhooks and API)
 * - VectorVault
 */

import { http, HttpResponse, delay } from 'msw';

// Track captured requests for assertions
export const capturedRequests: {
  openai: Request[];
  anthropic: Request[];
  openrouter: Request[];
  google: Request[];
  stripe: Request[];
  vectorvault: Request[];
} = {
  openai: [],
  anthropic: [],
  openrouter: [],
  google: [],
  stripe: [],
  vectorvault: [],
};

// Clear captured requests
export function clearCapturedRequests() {
  capturedRequests.openai = [];
  capturedRequests.anthropic = [];
  capturedRequests.openrouter = [];
  capturedRequests.google = [];
  capturedRequests.stripe = [];
  capturedRequests.vectorvault = [];
}

// =============================================================================
// OPENAI HANDLERS
// =============================================================================

const openaiHandlers = [
  // Chat Completions (non-streaming)
  http.post('https://api.openai.com/v1/chat/completions', async ({ request }) => {
    capturedRequests.openai.push(request.clone());
    
    const body = await request.json() as any;
    const lastMessage = body.messages[body.messages.length - 1]?.content ?? '';
    
    // Handle streaming
    if (body.stream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const chunks = [
            { choices: [{ delta: { role: 'assistant' }, index: 0 }] },
            { choices: [{ delta: { content: 'Response to: ' }, index: 0 }] },
            { choices: [{ delta: { content: lastMessage.slice(0, 50) }, index: 0 }] },
            { choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] },
          ];
          
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            await delay(10);
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      
      return new HttpResponse(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }
    
    // Non-streaming response
    return HttpResponse.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: `Response to: ${lastMessage}`,
        },
        logprobs: null,
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: Math.ceil(lastMessage.length / 4),
        completion_tokens: 20,
        total_tokens: Math.ceil(lastMessage.length / 4) + 20,
      },
    });
  }),

  // Models list
  http.get('https://api.openai.com/v1/models', () => {
    return HttpResponse.json({
      data: [
        { id: 'gpt-4', object: 'model', owned_by: 'openai' },
        { id: 'gpt-4-turbo', object: 'model', owned_by: 'openai' },
        { id: 'gpt-3.5-turbo', object: 'model', owned_by: 'openai' },
      ],
    });
  }),

  // Embeddings
  http.post('https://api.openai.com/v1/embeddings', async ({ request }) => {
    const body = await request.json() as { input: string | string[]; model: string };
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    
    return HttpResponse.json({
      object: 'list',
      data: inputs.map((_, index) => ({
        object: 'embedding',
        embedding: Array.from({ length: 3072 }, () => Math.random() * 2 - 1),
        index,
      })),
      model: body.model,
      usage: {
        prompt_tokens: inputs.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0),
        total_tokens: inputs.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0),
      },
    });
  }),
];

// =============================================================================
// ANTHROPIC HANDLERS
// =============================================================================

const anthropicHandlers = [
  http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
    capturedRequests.anthropic.push(request.clone());
    
    const body = await request.json() as any;
    const lastMessage = body.messages[body.messages.length - 1]?.content ?? '';
    
    // Handle streaming
    if (body.stream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const events = [
            { event: 'message_start', data: { type: 'message_start', message: { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', content: [], model: body.model, stop_reason: null, usage: { input_tokens: 25, output_tokens: 1 } } } },
            { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
            { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Response from Claude' } } },
            { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
            { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 15 } } },
            { event: 'message_stop', data: { type: 'message_stop' } },
          ];
          
          for (const { event, data } of events) {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            await delay(10);
          }
          controller.close();
        },
      });
      
      return new HttpResponse(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });
    }
    
    // Non-streaming response
    return HttpResponse.json({
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [{
        type: 'text',
        text: `Response from Claude to: ${lastMessage}`,
      }],
      model: body.model,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: Math.ceil(lastMessage.length / 4),
        output_tokens: 20,
      },
    });
  }),
];

// =============================================================================
// OPENROUTER HANDLERS
// =============================================================================

const openrouterHandlers = [
  http.post('https://openrouter.ai/api/v1/chat/completions', async ({ request }) => {
    capturedRequests.openrouter.push(request.clone());
    
    const body = await request.json() as any;
    const lastMessage = body.messages[body.messages.length - 1]?.content ?? '';
    
    // Similar to OpenAI response format
    if (body.stream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'OpenRouter response' } }] })}\n\n`));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      
      return new HttpResponse(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    
    return HttpResponse.json({
      id: `gen-${Date.now()}`,
      choices: [{
        message: {
          role: 'assistant',
          content: `OpenRouter response to: ${lastMessage}`,
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 20,
        total_tokens: 70,
      },
    });
  }),
];

// =============================================================================
// GOOGLE HANDLERS
// =============================================================================

const googleHandlers = [
  http.post('https://generativelanguage.googleapis.com/v1beta/models/:model\\:generateContent', async ({ request, params }) => {
    capturedRequests.google.push(request.clone());
    
    const body = await request.json() as any;
    
    return HttpResponse.json({
      candidates: [{
        content: {
          parts: [{ text: 'Response from Gemini' }],
          role: 'model',
        },
        finishReason: 'STOP',
        safetyRatings: [],
      }],
      usageMetadata: {
        promptTokenCount: 50,
        candidatesTokenCount: 20,
        totalTokenCount: 70,
      },
    });
  }),
];

// =============================================================================
// STRIPE HANDLERS
// =============================================================================

const stripeHandlers = [
  // Create usage record
  http.post('https://api.stripe.com/v1/subscription_items/:itemId/usage_records', async ({ request }) => {
    capturedRequests.stripe.push(request.clone());
    
    const formData = await request.text();
    const params = new URLSearchParams(formData);
    
    return HttpResponse.json({
      id: `mbur_${Date.now()}`,
      object: 'usage_record',
      quantity: parseInt(params.get('quantity') ?? '0'),
      subscription_item: params.get('subscription_item'),
      timestamp: Math.floor(Date.now() / 1000),
    });
  }),
  
  // Get customer
  http.get('https://api.stripe.com/v1/customers/:customerId', ({ params }) => {
    return HttpResponse.json({
      id: params.customerId,
      object: 'customer',
      email: 'test@example.com',
      metadata: {},
    });
  }),
  
  // List invoices
  http.get('https://api.stripe.com/v1/invoices', () => {
    return HttpResponse.json({
      object: 'list',
      data: [],
      has_more: false,
    });
  }),
  
  // Webhook endpoint (for testing webhook construction)
  http.post('https://api.stripe.com/v1/webhook_endpoints', async ({ request }) => {
    return HttpResponse.json({
      id: `we_${Date.now()}`,
      object: 'webhook_endpoint',
      url: 'https://api.memoryrouter.ai/webhooks/stripe',
      enabled_events: ['invoice.paid', 'customer.subscription.deleted'],
    });
  }),
];

// =============================================================================
// VECTORVAULT HANDLERS (stubbed)
// =============================================================================

const vectorvaultHandlers = [
  http.post('https://api.vectorvault.ai/v1/embed', async ({ request }) => {
    capturedRequests.vectorvault.push(request.clone());
    
    return HttpResponse.json({
      embedding: Array.from({ length: 3072 }, () => Math.random() * 2 - 1),
    });
  }),
  
  http.post('https://api.vectorvault.ai/v1/search', async ({ request }) => {
    capturedRequests.vectorvault.push(request.clone());
    
    return HttpResponse.json({
      results: [],
      total: 0,
    });
  }),
  
  http.post('https://api.vectorvault.ai/v1/store', async ({ request }) => {
    capturedRequests.vectorvault.push(request.clone());
    
    return HttpResponse.json({
      success: true,
      id: `vec_${Date.now()}`,
    });
  }),
];

// =============================================================================
// ERROR SIMULATION HANDLERS
// =============================================================================

export const errorHandlers = {
  // OpenAI rate limit
  openaiRateLimit: http.post('https://api.openai.com/v1/chat/completions', () => {
    return HttpResponse.json(
      { error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }),
  
  // OpenAI server error
  openaiServerError: http.post('https://api.openai.com/v1/chat/completions', () => {
    return HttpResponse.json(
      { error: { message: 'Internal server error', type: 'server_error' } },
      { status: 500 }
    );
  }),
  
  // Anthropic overloaded
  anthropicOverloaded: http.post('https://api.anthropic.com/v1/messages', () => {
    return HttpResponse.json(
      { error: { type: 'overloaded_error', message: 'Overloaded' } },
      { status: 529 }
    );
  }),
  
  // Invalid API key
  invalidApiKey: http.post('https://api.openai.com/v1/chat/completions', () => {
    return HttpResponse.json(
      { error: { message: 'Invalid API key', type: 'invalid_api_key' } },
      { status: 401 }
    );
  }),
  
  // Stripe webhook with invalid signature
  stripeInvalidSignature: http.post('/webhooks/stripe', () => {
    return HttpResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    );
  }),
};

// =============================================================================
// COMBINED HANDLERS
// =============================================================================

export const handlers = [
  ...openaiHandlers,
  ...anthropicHandlers,
  ...openrouterHandlers,
  ...googleHandlers,
  ...stripeHandlers,
  ...vectorvaultHandlers,
];
