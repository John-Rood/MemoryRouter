/**
 * AI Provider Service
 * Routes requests to OpenAI, Anthropic, or OpenRouter
 */

import {
  transformToGoogle,
  transformFromGoogle,
  createGoogleStreamTransformer,
  extractGoogleResponseContent,
  type GeminiResponse,
} from '../formatters/google';

export type Provider = 'openai' | 'anthropic' | 'openrouter' | 'google' | 'xai' | 'cerebras' | 'deepseek' | 'azure' | 'ollama' | 'mistral';

export interface ProviderConfig {
  name: Provider;
  baseUrl: string;
  authHeader: string;
}

export const PROVIDER_CONFIGS: Record<Provider, ProviderConfig> = {
  openai: {
    name: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    authHeader: 'Authorization',
  },
  anthropic: {
    name: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    authHeader: 'x-api-key',
  },
  openrouter: {
    name: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    authHeader: 'Authorization',
  },
  google: {
    name: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    authHeader: 'x-goog-api-key',
  },
  xai: {
    name: 'xai',
    baseUrl: 'https://api.x.ai/v1',
    authHeader: 'Authorization',
  },
  cerebras: {
    name: 'cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    authHeader: 'Authorization',
  },
  deepseek: {
    name: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    authHeader: 'Authorization',
  },
  azure: {
    name: 'azure',
    baseUrl: '', // Dynamic — set per request from endpoint param
    authHeader: 'api-key',
  },
  ollama: {
    name: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    authHeader: '', // No auth required for local
  },
  mistral: {
    name: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    authHeader: 'Authorization',
  },
};

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  memory?: boolean;  // MemoryRouter extension: if false, don't store
}

export interface ChatCompletionRequest {
  model: string;
  messages: Message[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  [key: string]: unknown;
}

/**
 * Detect provider from model string
 */
export function detectProvider(model: string): Provider {
  const modelLower = model.toLowerCase();
  
  // Explicit provider prefix
  if (modelLower.startsWith('anthropic/')) return 'anthropic';
  if (modelLower.startsWith('openai/')) return 'openai';
  if (modelLower.startsWith('google/')) return 'google';
  if (modelLower.startsWith('xai/') || modelLower.startsWith('x-ai/')) return 'xai';
  if (modelLower.startsWith('cerebras/')) return 'cerebras';
  if (modelLower.startsWith('deepseek/')) return 'deepseek';
  if (modelLower.startsWith('azure/')) return 'azure';
  if (modelLower.startsWith('ollama/')) return 'ollama';
  if (modelLower.startsWith('mistral/')) return 'mistral';
  if (modelLower.startsWith('meta-llama/')) return 'openrouter';
  
  // Infer from model name
  if (modelLower.includes('claude')) return 'anthropic';
  if (modelLower.includes('gpt') || modelLower.includes('o1') || modelLower.includes('o3')) return 'openai';
  if (modelLower.includes('gemini')) return 'google';
  if (modelLower.includes('grok')) return 'xai';
  if (modelLower.includes('llama') && modelLower.includes('cerebras')) return 'cerebras';
  if (modelLower.includes('deepseek')) return 'deepseek';
  if (modelLower.includes('mistral') || modelLower.includes('mixtral') || modelLower.includes('codestral')) return 'mistral';
  
  // Default to OpenRouter for unknown models
  return 'openrouter';
}

/**
 * Get the actual model name (strip provider prefix)
 */
export function getModelName(model: string): string {
  const parts = model.split('/');
  if (parts.length > 1) {
    const possibleProvider = parts[0].toLowerCase();
    if (['anthropic', 'openai', 'google', 'meta-llama', 'mistral', 'xai', 'x-ai', 'cerebras', 'deepseek'].includes(possibleProvider)) {
      return parts.slice(1).join('/');
    }
  }
  return model;
}

/**
 * Anthropic model name mapping
 * OpenRouter/simplified names → Anthropic API names
 */
/**
 * xAI (Grok) model name mapping
 * Our simplified names → xAI API names
 */
const XAI_MODEL_MAP: Record<string, string> = {
  // grok-2 → DEPRECATED Sept 2025, redirect to grok-3
  'grok-2': 'grok-3-beta',
  'grok-2-vision': 'grok-3-beta',
  // Current models
  'grok-3': 'grok-3-beta',
  'grok-3-beta': 'grok-3-beta',
  'grok-3-mini': 'grok-3-mini-beta',
  'grok-3-mini-beta': 'grok-3-mini-beta',
  'grok-4': 'grok-4',
  'grok-4-fast': 'grok-4-fast',
};

/**
 * Map a model name to xAI's API format
 */
function mapToXaiModel(model: string): string {
  const baseName = getModelName(model);
  return XAI_MODEL_MAP[baseName] || baseName;
}

const ANTHROPIC_MODEL_MAP: Record<string, string> = {
  // Claude 3.5 family → RETIRED Oct 2025, redirect to Claude 4
  'claude-3.5-sonnet': 'claude-sonnet-4-20250514',
  'claude-3.5-haiku': 'claude-haiku-4-5-20251001',
  'claude-3-5-sonnet': 'claude-sonnet-4-20250514',
  'claude-3-5-haiku': 'claude-haiku-4-5-20251001',
  // Claude 3.7 → redirect to Claude 4.5
  'claude-3.7-sonnet': 'claude-sonnet-4-5-20250929',
  'claude-3.7-sonnet:thinking': 'claude-sonnet-4-5-20250929',
  // Claude 3 family → RETIRED, redirect to Claude 4
  'claude-3-opus': 'claude-opus-4-1-20250805',
  'claude-3-sonnet': 'claude-sonnet-4-20250514',
  'claude-3-haiku': 'claude-haiku-4-5-20251001',
  // Claude 4 family (current)
  'claude-sonnet-4': 'claude-sonnet-4-20250514',
  'claude-opus-4': 'claude-opus-4-20250514',
  'claude-sonnet-4.5': 'claude-sonnet-4-5-20250929',
  'claude-opus-4.5': 'claude-opus-4-5-20251101',
  'claude-opus-4.1': 'claude-opus-4-1-20250805',
  'claude-haiku-4.5': 'claude-haiku-4-5-20251001',
};

/**
 * Map a model name to Anthropic's API format
 */
function mapToAnthropicModel(model: string): string {
  const baseName = getModelName(model);
  return ANTHROPIC_MODEL_MAP[baseName] || baseName;
}

/**
 * Transform Anthropic API response to OpenAI format
 */
function transformAnthropicToOpenAI(anthropicResponse: Record<string, unknown>): Record<string, unknown> {
  const content = anthropicResponse.content as Array<{ type: string; text?: string }> | undefined;
  const textContent = content?.find(c => c.type === 'text')?.text || '';
  const usage = anthropicResponse.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  
  return {
    id: `chatcmpl-${(anthropicResponse.id as string || '').slice(4)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: anthropicResponse.model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: textContent,
      },
      finish_reason: anthropicResponse.stop_reason === 'end_turn' ? 'stop' : (anthropicResponse.stop_reason || 'stop'),
    }],
    usage: {
      prompt_tokens: usage?.input_tokens || 0,
      completion_tokens: usage?.output_tokens || 0,
      total_tokens: (usage?.input_tokens || 0) + (usage?.output_tokens || 0),
    },
  };
}

/**
 * Transform request for Anthropic API
 */
function transformForAnthropic(body: ChatCompletionRequest): Record<string, unknown> {
  const messages = body.messages;
  const systemMessages = messages.filter(m => m.role === 'system');
  const otherMessages = messages.filter(m => m.role !== 'system');
  
  const anthropicBody: Record<string, unknown> = {
    model: mapToAnthropicModel(body.model),
    messages: otherMessages.map(m => ({
      role: m.role,
      content: m.content,
    })),
    max_tokens: body.max_tokens ?? 4096,
    stream: body.stream ?? false,
  };
  
  if (systemMessages.length > 0) {
    anthropicBody.system = systemMessages.map(m => m.content).join('\n\n');
  }
  
  if (body.temperature !== undefined) {
    anthropicBody.temperature = body.temperature;
  }
  
  return anthropicBody;
}

/**
 * Transform request for OpenAI-compatible APIs
 */
function transformForOpenAI(body: ChatCompletionRequest): Record<string, unknown> {
  return {
    ...body,
    model: getModelName(body.model),
    messages: body.messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  };
}

/**
 * Forward request to provider
 */
export async function forwardToProvider(
  provider: Provider,
  apiKey: string,
  body: ChatCompletionRequest
): Promise<Response> {
  const config = PROVIDER_CONFIGS[provider];
  
  let transformedBody: Record<string, unknown>;
  let endpoint: string;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  switch (provider) {
    case 'anthropic':
      transformedBody = transformForAnthropic(body);
      endpoint = `${config.baseUrl}/messages`;
      headers[config.authHeader] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      break;
    
    case 'xai':
      // xAI needs model name mapping
      transformedBody = {
        ...transformForOpenAI(body),
        model: mapToXaiModel(body.model),
      };
      endpoint = `${config.baseUrl}/chat/completions`;
      headers[config.authHeader] = `Bearer ${apiKey}`;
      break;
    
    case 'openai':
    case 'openrouter':
    case 'cerebras':
    case 'deepseek':
    case 'mistral':
      transformedBody = transformForOpenAI(body);
      endpoint = `${config.baseUrl}/chat/completions`;
      headers[config.authHeader] = `Bearer ${apiKey}`;
      if (provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://memoryrouter.ai';
        headers['X-Title'] = 'MemoryRouter';
      }
      break;
    
    case 'azure': {
      // Azure OpenAI uses custom endpoint format + api-key header + api-version param
      // Expects endpoint in body.azure_endpoint or apiKey format: "endpoint|key"
      transformedBody = transformForOpenAI(body);
      const modelName = getModelName(body.model);
      
      // Support endpoint passed via apiKey as "endpoint|key" or via body.azure_endpoint
      let azureEndpoint: string;
      let azureKey: string;
      
      if (apiKey.includes('|')) {
        const [ep, key] = apiKey.split('|');
        azureEndpoint = ep;
        azureKey = key;
      } else {
        // Fallback: expect azure_endpoint in body
        azureEndpoint = (body as Record<string, unknown>).azure_endpoint as string || '';
        azureKey = apiKey;
        delete (transformedBody as Record<string, unknown>).azure_endpoint;
      }
      
      if (!azureEndpoint) {
        throw new Error('Azure OpenAI requires endpoint. Pass as "endpoint|key" in apiKey or set azure_endpoint in body.');
      }
      
      // Azure format: https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version=2024-02-15-preview
      const apiVersion = (body as Record<string, unknown>).api_version as string || '2024-02-15-preview';
      delete (transformedBody as Record<string, unknown>).api_version;
      endpoint = `${azureEndpoint}/openai/deployments/${modelName}/chat/completions?api-version=${apiVersion}`;
      headers[config.authHeader] = azureKey;
      break;
    }
    
    case 'ollama': {
      // Ollama: local, no auth, OpenAI-compatible
      // Support custom base URL via body.ollama_base_url
      transformedBody = transformForOpenAI(body);
      const ollamaBase = (body as Record<string, unknown>).ollama_base_url as string || config.baseUrl;
      delete (transformedBody as Record<string, unknown>).ollama_base_url;
      endpoint = `${ollamaBase}/chat/completions`;
      // Ollama doesn't need auth, but allow optional key if set
      if (apiKey && apiKey !== 'ollama') {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      break;
    }
    
    case 'google': {
      // Google Gemini uses completely different format
      transformedBody = transformToGoogle(body) as unknown as Record<string, unknown>;
      const modelName = getModelName(body.model);
      // Use streamGenerateContent for streaming, generateContent for non-streaming
      const action = body.stream ? 'streamGenerateContent' : 'generateContent';
      endpoint = `${config.baseUrl}/models/${modelName}:${action}`;
      // Gemini supports API key as header (x-goog-api-key) or query param
      headers[config.authHeader] = apiKey;
      // For streaming, add alt=sse query param
      if (body.stream) {
        endpoint += '?alt=sse';
      }
      break;
    }
    
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(transformedBody),
  });
  
  // NOTE: We no longer transform Anthropic responses here.
  // Use the native /v1/messages endpoint for Anthropic SDK compatibility.
  // The /v1/chat/completions endpoint with anthropic/* models is for
  // OpenAI SDK users who want to call Anthropic - they get OpenAI format.
  
  // For /v1/chat/completions with Anthropic models, still transform to OpenAI format
  // (This is for OpenAI SDK users calling Anthropic through the OpenAI endpoint)
  if (provider === 'anthropic' && response.ok && !body.stream) {
    const anthropicResponse = await response.json() as Record<string, unknown>;
    const openaiResponse = transformAnthropicToOpenAI(anthropicResponse);
    
    return new Response(JSON.stringify(openaiResponse), {
      status: response.status,
      statusText: response.statusText,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
  
  // NOTE: Google transformation only applies to /v1/chat/completions endpoint.
  // Native Google endpoint (/v1/models/{m}:generateContent) returns native format.
  // This transformation is for OpenAI SDK users calling Google through OpenAI endpoint.
  if (provider === 'google' && response.ok) {
    const modelName = getModelName(body.model);
    const requestId = `chatcmpl-${crypto.randomUUID().slice(0, 8)}`;
    
    if (body.stream && response.body) {
      // Transform streaming response
      const transformedStream = response.body.pipeThrough(
        createGoogleStreamTransformer(modelName, requestId)
      );
      
      return new Response(transformedStream, {
        status: response.status,
        statusText: response.statusText,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } else {
      // Transform non-streaming response
      const geminiResponse = await response.json() as GeminiResponse;
      const openaiResponse = transformFromGoogle(geminiResponse, modelName, requestId);
      
      return new Response(JSON.stringify(openaiResponse), {
        status: response.status,
        statusText: response.statusText,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }
  }
  
  return response;
}

/**
 * Embedding configuration
 * 
 * Primary: Modal GPU (BGE-large-en-v1.5, ~20ms)
 * Fallback: Cloudflare Workers AI (BGE-M3, ~80ms)
 * 
 * Both output 1024 dimensions.
 */
export interface EmbeddingConfig {
  modalUrl?: string;  // Modal embedding service URL
  ai?: Ai;            // Cloudflare Workers AI binding (fallback)
}

/**
 * Generate embeddings
 * 
 * Priority:
 * 1. Modal GPU (if MODAL_EMBEDDING_URL configured) — ~20ms, cheapest
 * 2. Cloudflare Workers AI — ~80ms, edge-local
 */
export async function generateEmbedding(
  text: string,
  _apiKey?: string,  // Unused, kept for API compatibility
  _model?: string,   // Unused, kept for API compatibility
  config?: EmbeddingConfig
): Promise<Float32Array> {
  // Try Modal first (fastest)
  if (config?.modalUrl) {
    try {
      return await generateEmbeddingModal(text, config.modalUrl);
    } catch (error) {
      console.error('[Embedding] Modal failed, falling back to Cloudflare:', error);
      // Fall through to Cloudflare
    }
  }
  
  // Fallback to Cloudflare Workers AI
  if (config?.ai) {
    return await generateEmbeddingCloudflare(text, config.ai);
  }
  
  throw new Error('No embedding provider configured (need MODAL_EMBEDDING_URL or AI binding)');
}

/**
 * Generate embeddings using Modal GPU service
 * BGE-large-en-v1.5, 1024 dims, ~20ms
 */
async function generateEmbeddingModal(
  text: string,
  modalUrl: string
): Promise<Float32Array> {
  const response = await fetch(`${modalUrl}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: [text], normalize: true }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Modal embedding failed: ${error}`);
  }
  
  const data = await response.json() as { embeddings: number[][] };
  return new Float32Array(data.embeddings[0]);
}

/**
 * Generate embeddings using Cloudflare Workers AI
 * BGE-M3, 1024 dims, ~80ms
 */
async function generateEmbeddingCloudflare(
  text: string,
  ai: Ai
): Promise<Float32Array> {
  const response = await ai.run('@cf/baai/bge-m3', {
    text: [text],
  }) as { data: number[][] };
  
  return new Float32Array(response.data[0]);
}

/**
 * Extract response content from provider response
 * Note: Google responses are transformed to OpenAI format in forwardToProvider,
 * so we don't need a separate Google case here.
 */
export function extractResponseContent(provider: Provider, responseBody: unknown): string {
  const body = responseBody as Record<string, unknown>;
  
  // OpenAI format (also used for transformed Google responses)
  if (body.choices) {
    const choices = body.choices as Array<{ message?: { content?: string }; delta?: { content?: string } }>;
    if (choices[0]?.message?.content) {
      return choices[0].message.content;
    }
  }
  
  // Anthropic format
  if (body.content) {
    const content = body.content as Array<{ text?: string }>;
    if (content[0]?.text) {
      return content[0].text;
    }
  }
  
  // Raw Google format (in case response wasn't transformed)
  if (body.candidates) {
    const candidates = body.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    const text = candidates[0]?.content?.parts?.[0]?.text;
    if (text) {
      return text;
    }
  }
  
  return '';
}

// Re-export Google extractor for direct use if needed
export { extractGoogleResponseContent } from '../formatters/google';

/**
 * Parse streaming response to extract full content
 */
export async function captureStreamedResponse(
  response: Response,
  provider: Provider
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return '';
  }
  
  const decoder = new TextDecoder();
  let fullContent = '';
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ') && !line.includes('[DONE]')) {
          try {
            const data = JSON.parse(line.slice(6));
            
            // OpenAI format
            const deltaContent = data.choices?.[0]?.delta?.content;
            if (deltaContent) fullContent += deltaContent;
            
            // Anthropic format
            const anthropicContent = data.delta?.text;
            if (anthropicContent) fullContent += anthropicContent;
          } catch {
            // Ignore parse errors in stream
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  
  return fullContent;
}
