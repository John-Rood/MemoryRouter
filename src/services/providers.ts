/**
 * AI Provider Service
 * Routes requests to OpenAI, Anthropic, or OpenRouter
 */

export type Provider = 'openai' | 'anthropic' | 'openrouter' | 'google';

export interface ProviderConfig {
  name: Provider;
  baseUrl: string;
  authHeader: string;
  transformRequest?: (body: unknown) => unknown;
  transformResponse?: (body: unknown) => unknown;
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

/**
 * Detect provider from model string
 * Examples:
 *   - "anthropic/claude-3-opus" → anthropic
 *   - "openai/gpt-4" → openai
 *   - "gpt-4" → openai (fallback)
 *   - "claude-3-opus" → anthropic (fallback)
 */
export function detectProvider(model: string): Provider {
  const modelLower = model.toLowerCase();
  
  // Check for explicit provider prefix
  if (modelLower.startsWith('anthropic/')) return 'anthropic';
  if (modelLower.startsWith('openai/')) return 'openai';
  if (modelLower.startsWith('google/')) return 'google';
  if (modelLower.startsWith('meta-llama/') || modelLower.startsWith('mistral/')) return 'openrouter';
  
  // Infer from model name
  if (modelLower.includes('claude')) return 'anthropic';
  if (modelLower.includes('gpt') || modelLower.includes('o1') || modelLower.includes('o3')) return 'openai';
  if (modelLower.includes('gemini')) return 'google';
  
  // Default to OpenRouter for unknown models (most flexible)
  return 'openrouter';
}

/**
 * Get the actual model name to send to the provider
 * Strips the provider prefix if present
 */
export function getModelName(model: string): string {
  // Remove provider prefix (e.g., "anthropic/claude-3-opus" → "claude-3-opus")
  const parts = model.split('/');
  if (parts.length > 1) {
    const possibleProvider = parts[0].toLowerCase();
    if (['anthropic', 'openai', 'google', 'meta-llama', 'mistral'].includes(possibleProvider)) {
      return parts.slice(1).join('/');
    }
  }
  return model;
}

export function getProviderConfig(provider: Provider): ProviderConfig {
  return PROVIDER_CONFIGS[provider];
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  memory?: boolean; // MemoryRouter extension: if false, don't store
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
 * Transform request for Anthropic API
 * Anthropic uses a different format (system as separate field)
 */
function transformForAnthropic(body: ChatCompletionRequest): unknown {
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
 * Transform request for OpenAI-compatible APIs (OpenAI, OpenRouter)
 */
function transformForOpenAI(body: ChatCompletionRequest): unknown {
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
 * Forward request to the provider and stream back
 */
export async function forwardToProvider(
  provider: Provider,
  apiKey: string,
  body: ChatCompletionRequest
): Promise<Response> {
  const config = getProviderConfig(provider);
  
  // Transform request based on provider
  let transformedBody: unknown;
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
      // Google has a very different API, simplified for now
      transformedBody = transformForOpenAI(body);
      endpoint = `${config.baseUrl}/models/${getModelName(body.model)}:generateContent`;
      headers[config.authHeader] = apiKey;
      break;
  }
  
  console.log(`[PROVIDER] Forwarding to ${provider}: ${endpoint}`);
  console.log(`[PROVIDER] Model: ${body.model} → ${getModelName(body.model)}`);
  console.log(`[PROVIDER] Stream: ${body.stream ?? false}`);
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(transformedBody),
  });
  
  return response;
}
