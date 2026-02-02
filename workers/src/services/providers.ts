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
  if (modelLower.startsWith('xai/')) return 'xai';
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
    if (['anthropic', 'openai', 'google', 'meta-llama', 'mistral'].includes(possibleProvider)) {
      return parts.slice(1).join('/');
    }
  }
  return model;
}

/**
 * Transform request for Anthropic API
 */
function transformForAnthropic(body: ChatCompletionRequest): Record<string, unknown> {
  const messages = body.messages;
  const systemMessages = messages.filter(m => m.role === 'system');
  const otherMessages = messages.filter(m => m.role !== 'system');
  
  const anthropicBody: Record<string, unknown> = {
    model: getModelName(body.model),
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
    
    case 'openai':
    case 'openrouter':
    case 'xai':
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
  
  // Google responses need to be transformed to OpenAI format
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
 * Embedding provider configuration
 */
export interface EmbeddingConfig {
  provider: 'openai' | 'modal' | 'cloudflare';
  modalUrl?: string;  // e.g., https://memoryrouter-embeddings--web.modal.run
  ai?: Ai;            // Cloudflare Workers AI binding
}

/**
 * Generate embeddings using configured provider
 * 
 * Supports:
 * - Cloudflare Workers AI BGE-M3 (1024 dims, ~18ms edge latency)
 * - OpenAI (text-embedding-3-small, 1536 dims)
 * - Modal self-hosted (BGE-large-en-v1.5, 1024 dims)
 */
export async function generateEmbedding(
  text: string,
  apiKey: string,
  model: string = 'text-embedding-3-small',
  config?: EmbeddingConfig
): Promise<Float32Array> {
  // Use Cloudflare Workers AI (fastest, cheapest)
  if (config?.provider === 'cloudflare' && config.ai) {
    return generateEmbeddingCloudflare(text, config.ai);
  }
  
  // Use Modal if configured
  if (config?.provider === 'modal' && config.modalUrl) {
    return generateEmbeddingModal(text, config.modalUrl);
  }
  
  // Default: OpenAI
  return generateEmbeddingOpenAI(text, apiKey, model);
}

/**
 * Generate embeddings using Cloudflare Workers AI BGE-M3
 * ~18ms edge latency, $0.012/1M tokens, 1024 dims
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
 * Generate embeddings using Modal self-hosted BGE
 * ~100x cheaper than OpenAI, ~10-50ms slower
 */
async function generateEmbeddingModal(
  text: string,
  modalUrl: string
): Promise<Float32Array> {
  const response = await fetch(`${modalUrl}/embed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      texts: [text],
      normalize: true,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Modal embedding failed: ${error}`);
  }
  
  const data = await response.json() as { embeddings: number[][] };
  return new Float32Array(data.embeddings[0]);
}

/**
 * Generate embeddings using OpenAI
 */
async function generateEmbeddingOpenAI(
  text: string,
  apiKey: string,
  model: string = 'text-embedding-3-large'
): Promise<Float32Array> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: text,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI embedding failed: ${error}`);
  }
  
  const data = await response.json() as { data: Array<{ embedding: number[] }> };
  return new Float32Array(data.data[0].embedding);
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
