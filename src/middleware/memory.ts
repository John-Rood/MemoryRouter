/**
 * Memory Middleware
 * Handles RAG retrieval and memory storage
 */

import type { Context } from 'hono';
import { retrieveMemory, storeMemory, type MemoryRetrievalResult } from '../services/vectorvault';
import { formatMemoryContext } from '../formatters';
import type { Message, ChatCompletionRequest } from '../services/providers';

export interface MemoryOptions {
  mode: 'auto' | 'read' | 'write' | 'off';
  storeRequest: boolean;
  storeResponse: boolean;
  contextLimit: number;
  recencyBias: 'low' | 'medium' | 'high';
}

/**
 * Parse memory options from request headers
 */
export function parseMemoryOptions(c: Context): MemoryOptions {
  const mode = (c.req.header('X-Memory-Mode') ?? 'auto') as MemoryOptions['mode'];
  const storeRequest = c.req.header('X-Memory-Store') !== 'false';
  const storeResponse = c.req.header('X-Memory-Store-Response') !== 'false';
  const contextLimit = parseInt(c.req.header('X-Memory-Context-Limit') ?? '12', 10);
  const recencyBias = (c.req.header('X-Memory-Recency-Bias') ?? 'medium') as MemoryOptions['recencyBias'];
  
  return { mode, storeRequest, storeResponse, contextLimit, recencyBias };
}

/**
 * Get the query to use for memory retrieval
 * Uses the last user message + any system context
 */
function extractQueryFromMessages(messages: Message[]): string {
  const userMessages = messages.filter(m => m.role === 'user');
  const lastUserMessage = userMessages[userMessages.length - 1];
  
  if (!lastUserMessage) {
    return '';
  }
  
  // Could also include system message for better context
  const systemMessage = messages.find(m => m.role === 'system');
  if (systemMessage) {
    return `${systemMessage.content}\n\n${lastUserMessage.content}`;
  }
  
  return lastUserMessage.content;
}

/**
 * Inject memory context into the request
 * Adds a system message with retrieved memory
 */
export async function injectMemoryContext(
  memoryKey: string,
  body: ChatCompletionRequest,
  options: MemoryOptions
): Promise<{ augmentedBody: ChatCompletionRequest; retrieval: MemoryRetrievalResult | null }> {
  // Skip if memory is off or write-only
  if (options.mode === 'off' || options.mode === 'write') {
    return { augmentedBody: body, retrieval: null };
  }
  
  // Extract query from messages
  const query = extractQueryFromMessages(body.messages);
  if (!query) {
    return { augmentedBody: body, retrieval: null };
  }
  
  // Retrieve relevant memory
  const retrieval = await retrieveMemory(memoryKey, query, {
    limit: options.contextLimit,
    recencyBias: options.recencyBias,
  });
  
  // If no memory found, return unchanged
  if (retrieval.chunks.length === 0) {
    console.log('[MEMORY:INJECT] No relevant memory found');
    return { augmentedBody: body, retrieval };
  }
  
  // Format the memory context for the target model
  const contextText = retrieval.chunks
    .map(chunk => `[${chunk.role}] ${chunk.content}`)
    .join('\n\n');
  
  const formattedContext = formatMemoryContext(body.model, contextText);
  
  // Inject as a system message at the beginning
  const existingSystem = body.messages.find(m => m.role === 'system');
  let augmentedMessages: Message[];
  
  if (existingSystem) {
    // Prepend memory context to existing system message
    augmentedMessages = body.messages.map(m => {
      if (m.role === 'system') {
        return { ...m, content: `${formattedContext}\n\n${m.content}` };
      }
      return m;
    });
  } else {
    // Add new system message with memory context
    augmentedMessages = [
      { role: 'system', content: formattedContext },
      ...body.messages,
    ];
  }
  
  console.log(`[MEMORY:INJECT] Injected ${retrieval.chunks.length} chunks (${retrieval.tokenCount} tokens)`);
  
  return {
    augmentedBody: { ...body, messages: augmentedMessages },
    retrieval,
  };
}

/**
 * Store messages in memory (after response)
 * Respects selective memory flags
 */
export async function storeConversation(
  memoryKey: string,
  messages: Message[],
  assistantResponse: string,
  model: string,
  provider: string,
  options: MemoryOptions
): Promise<void> {
  // Skip if memory is off or read-only
  if (options.mode === 'off' || options.mode === 'read') {
    console.log('[MEMORY:STORE] Skipped (mode is off or read-only)');
    return;
  }
  
  // Store user messages (respecting selective memory)
  if (options.storeRequest) {
    for (const msg of messages) {
      // Skip if message has memory: false
      if (msg.memory === false) {
        console.log(`[MEMORY:STORE] Skipped message (memory: false)`);
        continue;
      }
      
      // Only store user messages (system messages are typically static)
      if (msg.role === 'user') {
        await storeMemory({
          memoryKey,
          role: 'user',
          content: msg.content,
          model,
          provider,
        });
      }
    }
  }
  
  // Store assistant response
  if (options.storeResponse && assistantResponse) {
    await storeMemory({
      memoryKey,
      role: 'assistant',
      content: assistantResponse,
      model,
      provider,
    });
  }
}
