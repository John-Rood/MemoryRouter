/**
 * Google Gemini API Format Transformer
 * 
 * Converts between OpenAI chat completion format and Gemini generateContent format.
 * 
 * Key differences:
 * - OpenAI uses "messages" array with role/content
 * - Gemini uses "contents" array with role/parts
 * - OpenAI "assistant" → Gemini "model"
 * - OpenAI "system" → Gemini "systemInstruction"
 * - OpenAI max_tokens → Gemini generationConfig.maxOutputTokens
 */

import type { ChatCompletionRequest, Message } from '../services/providers';

// ================== Gemini Request Types ==================

export interface GeminiPart {
  text: string;
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiSystemInstruction {
  parts: GeminiPart[];
}

export interface GeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  candidateCount?: number;
}

export interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: GeminiSystemInstruction;
  generationConfig?: GeminiGenerationConfig;
}

// ================== Gemini Response Types ==================

export interface GeminiCandidate {
  content: {
    parts: GeminiPart[];
    role: 'model';
  };
  finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
  index: number;
  safetyRatings?: Array<{
    category: string;
    probability: string;
  }>;
}

export interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

export interface GeminiResponse {
  candidates: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
}

// ================== Gemini Streaming Types ==================

export interface GeminiStreamChunk {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
      role?: string;
    };
    finishReason?: string;
  }>;
  usageMetadata?: GeminiUsageMetadata;
}

// ================== OpenAI Response Types (for transform output) ==================

export interface OpenAIChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string;
  };
  finish_reason: 'stop' | 'length' | 'content_filter' | null;
}

export interface OpenAIStreamChoice {
  index: number;
  delta: {
    role?: 'assistant';
    content?: string;
  };
  finish_reason: 'stop' | 'length' | 'content_filter' | null;
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
}

export interface OpenAIStreamResponse {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: OpenAIStreamChoice[];
}

// ================== Transform Functions ==================

/**
 * Transform OpenAI ChatCompletionRequest to Gemini generateContent format
 */
export function transformToGoogle(request: ChatCompletionRequest): GeminiRequest {
  const contents: GeminiContent[] = [];
  const systemParts: GeminiPart[] = [];
  
  // Process messages
  for (const message of request.messages) {
    if (message.role === 'system') {
      // Collect system messages for systemInstruction
      systemParts.push({ text: message.content });
    } else {
      // Convert user/assistant to Gemini format
      contents.push({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      });
    }
  }
  
  // Build Gemini request
  const geminiRequest: GeminiRequest = {
    contents,
  };
  
  // Add system instruction if any system messages exist
  if (systemParts.length > 0) {
    geminiRequest.systemInstruction = {
      parts: systemParts,
    };
  }
  
  // Build generation config from OpenAI params
  const generationConfig: GeminiGenerationConfig = {};
  let hasConfig = false;
  
  if (request.temperature !== undefined) {
    generationConfig.temperature = request.temperature;
    hasConfig = true;
  }
  
  if (request.max_tokens !== undefined) {
    generationConfig.maxOutputTokens = request.max_tokens;
    hasConfig = true;
  }
  
  // Handle top_p if provided
  const topP = (request as Record<string, unknown>).top_p;
  if (typeof topP === 'number') {
    generationConfig.topP = topP;
    hasConfig = true;
  }
  
  // Handle stop sequences if provided
  const stop = (request as Record<string, unknown>).stop;
  if (Array.isArray(stop)) {
    generationConfig.stopSequences = stop as string[];
    hasConfig = true;
  } else if (typeof stop === 'string') {
    generationConfig.stopSequences = [stop];
    hasConfig = true;
  }
  
  if (hasConfig) {
    geminiRequest.generationConfig = generationConfig;
  }
  
  return geminiRequest;
}

/**
 * Transform Gemini response to OpenAI chat completion format
 */
export function transformFromGoogle(
  response: GeminiResponse, 
  model: string,
  requestId?: string
): OpenAIResponse {
  const id = requestId || `chatcmpl-${crypto.randomUUID().slice(0, 8)}`;
  const created = Math.floor(Date.now() / 1000);
  
  // Map Gemini finish reasons to OpenAI format
  const mapFinishReason = (reason?: string): 'stop' | 'length' | 'content_filter' | null => {
    switch (reason) {
      case 'STOP': return 'stop';
      case 'MAX_TOKENS': return 'length';
      case 'SAFETY': return 'content_filter';
      case 'RECITATION': return 'content_filter';
      default: return null;
    }
  };
  
  // Transform candidates to choices
  const choices: OpenAIChoice[] = response.candidates.map((candidate, index) => ({
    index: candidate.index ?? index,
    message: {
      role: 'assistant' as const,
      content: candidate.content.parts.map(p => p.text).join(''),
    },
    finish_reason: mapFinishReason(candidate.finishReason),
  }));
  
  // Transform usage metadata
  const usage: OpenAIUsage | undefined = response.usageMetadata ? {
    prompt_tokens: response.usageMetadata.promptTokenCount,
    completion_tokens: response.usageMetadata.candidatesTokenCount,
    total_tokens: response.usageMetadata.totalTokenCount,
  } : undefined;
  
  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices,
    usage,
  };
}

/**
 * Transform Gemini streaming chunk to OpenAI streaming format
 */
export function transformStreamChunkFromGoogle(
  chunk: GeminiStreamChunk,
  model: string,
  requestId: string,
  isFirst: boolean
): OpenAIStreamResponse | null {
  // Skip empty chunks
  if (!chunk.candidates || chunk.candidates.length === 0) {
    return null;
  }
  
  const candidate = chunk.candidates[0];
  const content = candidate.content?.parts?.map(p => p.text).join('') ?? '';
  
  // Map finish reason
  let finishReason: 'stop' | 'length' | 'content_filter' | null = null;
  if (candidate.finishReason) {
    switch (candidate.finishReason) {
      case 'STOP': finishReason = 'stop'; break;
      case 'MAX_TOKENS': finishReason = 'length'; break;
      case 'SAFETY': 
      case 'RECITATION': finishReason = 'content_filter'; break;
    }
  }
  
  return {
    id: requestId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: {
        ...(isFirst ? { role: 'assistant' as const } : {}),
        ...(content ? { content } : {}),
      },
      finish_reason: finishReason,
    }],
  };
}

/**
 * Create a transformer for Gemini streaming responses.
 * Converts Gemini SSE format to OpenAI SSE format.
 * 
 * Gemini streams: `data: {...}\n\n` with GeminiStreamChunk
 * OpenAI expects: `data: {...}\n\n` with OpenAIStreamResponse
 */
export function createGoogleStreamTransformer(
  model: string,
  requestId: string
): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';
  let isFirst = true;
  
  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      
      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === '[DONE]') {
            // Pass through [DONE] signal
            if (jsonStr === '[DONE]') {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            }
            continue;
          }
          
          try {
            const geminiChunk = JSON.parse(jsonStr) as GeminiStreamChunk;
            const openaiChunk = transformStreamChunkFromGoogle(
              geminiChunk,
              model,
              requestId,
              isFirst
            );
            
            if (openaiChunk) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
              isFirst = false;
            }
          } catch (e) {
            // Log parse error but continue processing
            console.error('[Google Transform] Failed to parse stream chunk:', e);
          }
        }
      }
    },
    
    flush(controller) {
      // Process any remaining buffer content
      if (buffer.trim()) {
        if (buffer.startsWith('data: ')) {
          const jsonStr = buffer.slice(6).trim();
          if (jsonStr && jsonStr !== '[DONE]') {
            try {
              const geminiChunk = JSON.parse(jsonStr) as GeminiStreamChunk;
              const openaiChunk = transformStreamChunkFromGoogle(
                geminiChunk,
                model,
                requestId,
                isFirst
              );
              
              if (openaiChunk) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
              }
            } catch {
              // Ignore final parse errors
            }
          }
        }
      }
      
      // Always end with [DONE]
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    },
  });
}

/**
 * Extract content from Gemini response for memory storage
 */
export function extractGoogleResponseContent(response: GeminiResponse): string {
  if (!response.candidates || response.candidates.length === 0) {
    return '';
  }
  
  return response.candidates[0].content.parts.map(p => p.text).join('');
}
