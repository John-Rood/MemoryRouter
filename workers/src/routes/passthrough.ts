/**
 * Pass-through Proxy Routes
 * Forward requests to providers without memory injection
 * 
 * Endpoints:
 * - POST /v1/embeddings        → Forward to provider's embeddings endpoint
 * - POST /v1/audio/*           → Forward to OpenAI Whisper/TTS
 * - POST /v1/images/*          → Forward to OpenAI DALL-E
 * - POST /v1/completions       → Forward to provider (legacy completions)
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { getUserContext, ProviderKeys } from '../middleware/auth';
import { detectProvider, Provider, getModelName, PROVIDER_CONFIGS } from '../services/providers';

// Environment bindings (subset of what we need)
interface PassthroughEnv {
  OPENAI_API_KEY?: string;
}

// Provider configs with embeddings/completions endpoints
const EMBEDDINGS_ENDPOINTS: Partial<Record<Provider, string>> = {
  openai: 'https://api.openai.com/v1/embeddings',
  // Anthropic doesn't have a public embeddings API
  // OpenRouter proxies to OpenAI embeddings
  openrouter: 'https://openrouter.ai/api/v1/embeddings',
  // Google uses different endpoint format
  google: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent',
  // xAI uses OpenAI-compatible format
  xai: 'https://api.x.ai/v1/embeddings',
};

const COMPLETIONS_ENDPOINTS: Partial<Record<Provider, string>> = {
  openai: 'https://api.openai.com/v1/completions',
  openrouter: 'https://openrouter.ai/api/v1/completions',
  // Anthropic doesn't support legacy completions
};

// OpenAI-only endpoints
const OPENAI_AUDIO_BASE = 'https://api.openai.com/v1/audio';
const OPENAI_IMAGES_BASE = 'https://api.openai.com/v1/images';

/**
 * Get API key for a provider
 */
function getProviderKey(
  providerKeys: ProviderKeys,
  provider: Provider,
  env: PassthroughEnv
): string | undefined {
  const key = providerKeys[provider];
  if (key) return key;

  if (provider === 'openai') {
    return env.OPENAI_API_KEY;
  }
  return undefined;
}

/**
 * Get OpenAI API key specifically (for audio/images)
 */
function getOpenAIKey(
  providerKeys: ProviderKeys,
  env: PassthroughEnv
): string | undefined {
  return providerKeys.openai || env.OPENAI_API_KEY;
}

/**
 * Build auth headers for a provider
 */
function buildAuthHeaders(provider: Provider, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {};

  switch (provider) {
    case 'anthropic':
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      break;
    case 'google':
      headers['x-goog-api-key'] = apiKey;
      break;
    case 'openai':
    case 'openrouter':
    case 'xai':
    case 'cerebras':
    default:
      headers['Authorization'] = `Bearer ${apiKey}`;
      break;
  }

  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://memoryrouter.ai';
    headers['X-Title'] = 'MemoryRouter';
  }

  return headers;
}

/**
 * Create pass-through router
 */
export function createPassthroughRouter() {
  const router = new Hono<{ Bindings: PassthroughEnv }>();

  // ==================== EMBEDDINGS ====================
  /**
   * POST /embeddings
   * Forward to provider's embeddings endpoint
   */
  router.post('/embeddings', async (c) => {
    const userContext = getUserContext(c);

    // Parse request body
    let body: { model?: string; input?: string | string[]; [key: string]: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    // Validate required fields
    if (!body.model) {
      return c.json({ error: 'Missing required field: model' }, 400);
    }
    if (!body.input) {
      return c.json({ error: 'Missing required field: input' }, 400);
    }

    // Detect provider from model
    const provider = detectProvider(body.model);

    // Check if provider supports embeddings
    const embeddingsEndpoint = EMBEDDINGS_ENDPOINTS[provider];
    if (!embeddingsEndpoint) {
      return c.json({
        error: `Provider ${provider} does not support embeddings`,
        hint: 'Use an OpenAI model like text-embedding-3-small',
      }, 400);
    }

    // Get API key
    const apiKey = getProviderKey(userContext.providerKeys, provider, c.env);
    if (!apiKey) {
      return c.json({
        error: `No API key configured for provider: ${provider}`,
        hint: `Add your ${provider} API key in your account settings`,
      }, 400);
    }

    // Build request
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(provider, apiKey),
    };

    // Handle Google's different format
    let endpoint = embeddingsEndpoint;
    let requestBody: Record<string, unknown> = { ...body, model: getModelName(body.model) };

    if (provider === 'google') {
      endpoint = embeddingsEndpoint.replace('{model}', getModelName(body.model));
      // Transform to Google format
      const inputText = Array.isArray(body.input) ? body.input[0] : body.input;
      requestBody = {
        content: { parts: [{ text: inputText }] },
      };
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      // Forward response
      const responseBody = await response.text();
      return new Response(responseBody, {
        status: response.status,
        headers: {
          'Content-Type': response.headers.get('Content-Type') || 'application/json',
        },
      });
    } catch (error) {
      console.error('Embeddings proxy error:', error);
      return c.json({
        error: 'Failed to proxy embeddings request',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 502);
    }
  });

  // ==================== AUDIO ====================
  /**
   * POST /audio/transcriptions
   * Forward to OpenAI Whisper
   */
  router.post('/audio/transcriptions', async (c) => {
    return proxyAudioRequest(c, 'transcriptions');
  });

  /**
   * POST /audio/translations
   * Forward to OpenAI Whisper
   */
  router.post('/audio/translations', async (c) => {
    return proxyAudioRequest(c, 'translations');
  });

  /**
   * POST /audio/speech
   * Forward to OpenAI TTS
   */
  router.post('/audio/speech', async (c) => {
    const userContext = getUserContext(c);

    // Get OpenAI API key
    const apiKey = getOpenAIKey(userContext.providerKeys, c.env);
    if (!apiKey) {
      return c.json({
        error: 'OpenAI API key required for audio endpoints',
        hint: 'Add your OpenAI API key in your account settings',
      }, 400);
    }

    // Parse JSON body for TTS
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (!body.model || !body.input || !body.voice) {
      return c.json({
        error: 'Missing required fields: model, input, voice',
      }, 400);
    }

    try {
      const response = await fetch(`${OPENAI_AUDIO_BASE}/speech`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      // Forward audio response (binary)
      const audioData = await response.arrayBuffer();
      return new Response(audioData, {
        status: response.status,
        headers: {
          'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg',
        },
      });
    } catch (error) {
      console.error('Audio speech proxy error:', error);
      return c.json({
        error: 'Failed to proxy audio speech request',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 502);
    }
  });

  // ==================== IMAGES ====================
  /**
   * POST /images/generations
   * Forward to OpenAI DALL-E
   */
  router.post('/images/generations', async (c) => {
    return proxyImageRequest(c, 'generations');
  });

  /**
   * POST /images/edits
   * Forward to OpenAI DALL-E (multipart form)
   */
  router.post('/images/edits', async (c) => {
    return proxyImageMultipartRequest(c, 'edits');
  });

  /**
   * POST /images/variations
   * Forward to OpenAI DALL-E (multipart form)
   */
  router.post('/images/variations', async (c) => {
    return proxyImageMultipartRequest(c, 'variations');
  });

  // ==================== LEGACY COMPLETIONS ====================
  /**
   * POST /completions
   * Forward to provider (legacy non-chat completions)
   */
  router.post('/completions', async (c) => {
    const userContext = getUserContext(c);

    // Parse request body
    let body: { model?: string; prompt?: string; stream?: boolean; [key: string]: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    // Validate required fields
    if (!body.model) {
      return c.json({ error: 'Missing required field: model' }, 400);
    }
    if (!body.prompt) {
      return c.json({ error: 'Missing required field: prompt' }, 400);
    }

    // Detect provider from model
    const provider = detectProvider(body.model);

    // Check if provider supports legacy completions
    const completionsEndpoint = COMPLETIONS_ENDPOINTS[provider];
    if (!completionsEndpoint) {
      return c.json({
        error: `Provider ${provider} does not support legacy completions`,
        hint: 'Use /v1/chat/completions instead, or use an OpenAI model',
      }, 400);
    }

    // Get API key
    const apiKey = getProviderKey(userContext.providerKeys, provider, c.env);
    if (!apiKey) {
      return c.json({
        error: `No API key configured for provider: ${provider}`,
        hint: `Add your ${provider} API key in your account settings`,
      }, 400);
    }

    // Build request
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(provider, apiKey),
    };

    const requestBody = { ...body, model: getModelName(body.model) };

    try {
      const response = await fetch(completionsEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      // Handle streaming
      if (body.stream && response.ok) {
        c.header('Content-Type', 'text/event-stream');
        c.header('Cache-Control', 'no-cache');
        c.header('Connection', 'keep-alive');

        return stream(c, async (streamWriter) => {
          const reader = response.body?.getReader();
          if (!reader) {
            await streamWriter.write('data: {"error": "No response body"}\n\n');
            return;
          }

          const decoder = new TextDecoder();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              await streamWriter.write(chunk);
            }
          } finally {
            reader.releaseLock();
          }
        });
      }

      // Forward non-streaming response
      const responseBody = await response.text();
      return new Response(responseBody, {
        status: response.status,
        headers: {
          'Content-Type': response.headers.get('Content-Type') || 'application/json',
        },
      });
    } catch (error) {
      console.error('Completions proxy error:', error);
      return c.json({
        error: 'Failed to proxy completions request',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 502);
    }
  });

  return router;
}

// ==================== Helper Functions ====================

/**
 * Proxy audio transcription/translation requests (multipart form)
 */
async function proxyAudioRequest(
  c: any,
  endpoint: 'transcriptions' | 'translations'
): Promise<Response> {
  const userContext = getUserContext(c);

  // Get OpenAI API key
  const apiKey = getOpenAIKey(userContext.providerKeys, c.env);
  if (!apiKey) {
    return c.json({
      error: 'OpenAI API key required for audio endpoints',
      hint: 'Add your OpenAI API key in your account settings',
    }, 400);
  }

  try {
    // Get the raw request body (multipart form data)
    const formData = await c.req.formData();

    // Forward to OpenAI
    const response = await fetch(`${OPENAI_AUDIO_BASE}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        // Don't set Content-Type - let fetch set it with boundary
      },
      body: formData,
    });

    // Forward response
    const responseBody = await response.text();
    return new Response(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (error) {
    console.error(`Audio ${endpoint} proxy error:`, error);
    return c.json({
      error: `Failed to proxy audio ${endpoint} request`,
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 502);
  }
}

/**
 * Proxy image generation requests (JSON body)
 */
async function proxyImageRequest(
  c: any,
  endpoint: 'generations'
): Promise<Response> {
  const userContext = getUserContext(c);

  // Get OpenAI API key
  const apiKey = getOpenAIKey(userContext.providerKeys, c.env);
  if (!apiKey) {
    return c.json({
      error: 'OpenAI API key required for image endpoints',
      hint: 'Add your OpenAI API key in your account settings',
    }, 400);
  }

  // Parse JSON body
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.prompt) {
    return c.json({ error: 'Missing required field: prompt' }, 400);
  }

  try {
    const response = await fetch(`${OPENAI_IMAGES_BASE}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    // Forward response
    const responseBody = await response.text();
    return new Response(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (error) {
    console.error(`Image ${endpoint} proxy error:`, error);
    return c.json({
      error: `Failed to proxy image ${endpoint} request`,
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 502);
  }
}

/**
 * Proxy image edit/variation requests (multipart form)
 */
async function proxyImageMultipartRequest(
  c: any,
  endpoint: 'edits' | 'variations'
): Promise<Response> {
  const userContext = getUserContext(c);

  // Get OpenAI API key
  const apiKey = getOpenAIKey(userContext.providerKeys, c.env);
  if (!apiKey) {
    return c.json({
      error: 'OpenAI API key required for image endpoints',
      hint: 'Add your OpenAI API key in your account settings',
    }, 400);
  }

  try {
    // Get the raw request body (multipart form data)
    const formData = await c.req.formData();

    // Forward to OpenAI
    const response = await fetch(`${OPENAI_IMAGES_BASE}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        // Don't set Content-Type - let fetch set it with boundary
      },
      body: formData,
    });

    // Forward response
    const responseBody = await response.text();
    return new Response(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (error) {
    console.error(`Image ${endpoint} proxy error:`, error);
    return c.json({
      error: `Failed to proxy image ${endpoint} request`,
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 502);
  }
}

export default createPassthroughRouter;
