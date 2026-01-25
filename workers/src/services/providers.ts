/**
 * AI Provider Service
 * Routes requests to OpenAI, Anthropic, or OpenRouter
 */

export type Provider = 'openai' | 'anthropic' | 'openrouter' | 'google';

export interface ProviderConfig {
  name: Provider;
  baseUrl: string;
  authHeader: string;
}

const PROVIDER_CONFIGS: Record<Provider, ProviderConfig> = {
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
  if (modelLower.startsWith('meta-llama/') || modelLower.startsWith('mistral/')) return 'openrouter';
  
  // Infer from model name
  if (modelLower.includes('claude')) return 'anthropic';
  if (modelLower.includes('gpt') || modelLower.includes('o1') || modelLower.includes('o3')) return 'openai';
  if (modelLower.includes('gemini')) return 'google';
  
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
      transformedBody = transformForOpenAI(body);
      endpoint = `${config.baseUrl}/chat/completions`;
      headers[config.authHeader] = `Bearer ${apiKey}`;
      if (provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://memoryrouter.ai';
        headers['X-Title'] = 'MemoryRouter';
      }
      break;
    
    case 'google':
      transformedBody = transformForOpenAI(body);
      endpoint = `${config.baseUrl}/models/${getModelName(body.model)}:generateContent`;
      headers[config.authHeader] = apiKey;
      break;
    
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
  
  return await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(transformedBody),
  });
}

/**
 * Generate embeddings using OpenAI
 */
export async function generateEmbedding(
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
    throw new Error(`Embedding failed: ${error}`);
  }
  
  const data = await response.json() as { data: Array<{ embedding: number[] }> };
  return new Float32Array(data.data[0].embedding);
}

/**
 * Extract response content from provider response
 */
export function extractResponseContent(provider: Provider, responseBody: unknown): string {
  const body = responseBody as Record<string, unknown>;
  
  // OpenAI format
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
  
  return '';
}

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
