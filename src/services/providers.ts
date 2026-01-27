/**
 * AI Provider Service
 * Routes requests to OpenAI, Anthropic, or OpenRouter
 * 
 * Reference: memoryrouter-product-spec.md Section 4.6 (BYOK)
 * 
 * Provider detection from model string:
 *   - "anthropic/claude-3-opus" → anthropic
 *   - "openai/gpt-4" → openai
 *   - "gpt-4" → openai (inferred)
 *   - "claude-3-opus" → anthropic (inferred)
 *   - unknown → openrouter (most flexible)
 */

import type { Provider, ChatCompletionRequest, AnthropicMessageRequest, Message } from '../types';

// =============================================================================
// PROVIDER CONFIGS
// =============================================================================

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

// =============================================================================
// PROVIDER DETECTION
// =============================================================================

/**
 * Detect provider from model string
 */
export function detectProvider(model: string): Provider {
  const modelLower = model.toLowerCase();
  
  // Explicit provider prefix
  if (modelLower.startsWith('anthropic/')) return 'anthropic';
  if (modelLower.startsWith('openai/')) return 'openai';
  if (modelLower.startsWith('google/')) return 'google';
  if (modelLower.startsWith('openrouter/')) return 'openrouter';
  if (modelLower.startsWith('meta-llama/') || modelLower.startsWith('mistral/')) return 'openrouter';
  
  // Infer from model name
  if (modelLower.includes('claude')) return 'anthropic';
  if (modelLower.includes('gpt') || modelLower.includes('o1') || modelLower.includes('o3') || modelLower.includes('o4')) return 'openai';
  if (modelLower.includes('gemini')) return 'google';
  
  // Default to OpenRouter for unknown models
  return 'openrouter';
}

/**
 * Strip provider prefix from model name
 */
export function getModelName(model: string): string {
  const parts = model.split('/');
  if (parts.length > 1) {
    const prefix = parts[0].toLowerCase();
    if (['anthropic', 'openai', 'google', 'openrouter', 'meta-llama', 'mistral'].includes(prefix)) {
      return parts.slice(1).join('/');
    }
  }
  return model;
}

export function getProviderConfig(provider: Provider): ProviderConfig {
  return PROVIDER_CONFIGS[provider];
}

// =============================================================================
// REQUEST TRANSFORMATION
// =============================================================================

/**
 * Transform request for Anthropic Messages API
 * Anthropic uses system as a separate top-level field
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
  
  if (body.temperature !== undefined) anthropicBody.temperature = body.temperature;
  if (body.top_p !== undefined) anthropicBody.top_p = body.top_p;
  if (body.stop !== undefined) anthropicBody.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  
  return anthropicBody;
}

/**
 * Transform request for OpenAI-compatible APIs
 */
function transformForOpenAI(body: ChatCompletionRequest): Record<string, unknown> {
  // Strip MemoryRouter-specific fields, keep everything else
  const { session_id, ...rest } = body;
  
  return {
    ...rest,
    model: getModelName(body.model),
    messages: body.messages.map(m => ({
      role: m.role,
      content: m.content,
      // Strip memory flag — providers don't understand it
    })),
  };
}

// =============================================================================
// FORWARD TO PROVIDER
// =============================================================================

/**
 * Forward a chat completions request to the appropriate provider
 */
export async function forwardToProvider(
  provider: Provider,
  apiKey: string,
  body: ChatCompletionRequest
): Promise<Response> {
  const config = getProviderConfig(provider);
  
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
      transformedBody = transformForOpenAI(body);
      endpoint = `${config.baseUrl}/models/${getModelName(body.model)}:generateContent`;
      headers[config.authHeader] = apiKey;
      break;
    
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
  
  console.log(`[PROVIDER] Forwarding to ${provider}: ${endpoint}`);
  console.log(`[PROVIDER] Model: ${body.model} → ${getModelName(body.model)}`);
  console.log(`[PROVIDER] Stream: ${body.stream ?? false}`);
  
  return fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(transformedBody),
  });
}

/**
 * Forward an Anthropic Messages API request directly
 * (When someone hits POST /v1/messages — native Anthropic format)
 */
export async function forwardAnthropicMessages(
  apiKey: string,
  body: AnthropicMessageRequest
): Promise<Response> {
  const modelName = getModelName(body.model);
  
  // Strip MemoryRouter fields
  const { session_id, ...rest } = body;
  
  // Ensure messages don't have the memory field
  const cleanMessages = rest.messages.map(m => {
    const { memory, ...msgRest } = m;
    return msgRest;
  });
  
  const anthropicBody = {
    ...rest,
    model: modelName,
    messages: cleanMessages,
  };
  
  const endpoint = 'https://api.anthropic.com/v1/messages';
  
  console.log(`[PROVIDER] Forwarding Anthropic Messages: ${modelName}`);
  console.log(`[PROVIDER] Stream: ${body.stream ?? false}`);
  
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(anthropicBody),
  });
}

// Re-export types used by other modules
export type { ChatCompletionRequest, Message } from '../types';
