/**
 * Memory Middleware
 * 
 * Handles the full memory lifecycle:
 * 1. Parse memory options from headers
 * 2. Resolve session ID (header > body > default to memory key)
 * 3. Inject memory context via KRONOS retrieval
 * 4. Store new memories after response (respecting selective memory)
 * 
 * Reference: memoryrouter-product-spec.md Sections 4.3, 5.4, 6.2
 */

import type { Context } from 'hono';
import type { 
  MemoryOptions, 
  Message, 
  ChatCompletionRequest, 
  MemoryRetrievalResult,
  MemoryStoreInput,
} from '../types';
import { retrieveMemory, storeMemory, ensureSession } from '../services/vectorvault';
import { formatMemoryContext } from '../formatters';

// =============================================================================
// PARSE OPTIONS
// =============================================================================

/**
 * Parse memory options from request headers
 * 
 * Headers (spec Section 5.4):
 *   X-Session-ID — Session isolation
 *   X-Memory-Mode — auto/read/write/off
 *   X-Memory-Store — true/false (store this request)
 *   X-Memory-Store-Response — true/false (store the response)
 *   X-Memory-Context-Limit — Max chunks to retrieve (default: 12)
 *   X-Memory-Recency-Bias — low/medium/high
 */
export function parseMemoryOptions(c: Context, body?: { session_id?: string }): MemoryOptions {
  const mode = (c.req.header('X-Memory-Mode') ?? 'auto') as MemoryOptions['mode'];
  const storeRequest = c.req.header('X-Memory-Store') !== 'false';
  const storeResponse = c.req.header('X-Memory-Store-Response') !== 'false';
  const contextLimit = parseInt(c.req.header('X-Memory-Context-Limit') ?? '12', 10);
  const recencyBias = (c.req.header('X-Memory-Recency-Bias') ?? 'medium') as MemoryOptions['recencyBias'];
  
  // Session ID resolution (header > body > null)
  // null means use memory key as default session
  const sessionId = c.req.header('X-Session-ID') ?? body?.session_id ?? null;
  
  return { mode, storeRequest, storeResponse, contextLimit, recencyBias, sessionId };
}

/**
 * Resolve the effective session ID
 * If no session_id provided, use the memory key itself as the session
 */
export function resolveSessionId(options: MemoryOptions, memoryKey: string): string {
  return options.sessionId ?? memoryKey;
}

// =============================================================================
// QUERY EXTRACTION
// =============================================================================

/**
 * Extract a search query from the messages array
 * Uses the last user message + system context for better retrieval
 */
function extractQueryFromMessages(messages: Message[]): string {
  const userMessages = messages.filter(m => m.role === 'user');
  const lastUserMessage = userMessages[userMessages.length - 1];
  
  if (!lastUserMessage) {
    return '';
  }
  
  // Include system message for better context
  const systemMessage = messages.find(m => m.role === 'system');
  if (systemMessage) {
    return `${systemMessage.content}\n\n${lastUserMessage.content}`;
  }
  
  return lastUserMessage.content;
}

// =============================================================================
// MEMORY INJECTION
// =============================================================================

/**
 * Inject memory context into the request
 * 
 * Flow:
 * 1. Resolve session ID
 * 2. Ensure session exists (lazy init)
 * 3. Extract query from messages
 * 4. Retrieve via KRONOS
 * 5. Format for target model
 * 6. Inject as system message prefix
 */
export async function injectMemoryContext(
  memoryKey: string,
  body: ChatCompletionRequest,
  options: MemoryOptions
): Promise<{ augmentedBody: ChatCompletionRequest; retrieval: MemoryRetrievalResult | null; sessionId: string }> {
  const sessionId = resolveSessionId(options, memoryKey);
  
  // Skip if memory is off or write-only
  if (options.mode === 'off' || options.mode === 'write') {
    return { augmentedBody: body, retrieval: null, sessionId };
  }
  
  // Ensure session exists
  await ensureSession(memoryKey, sessionId);
  
  // Extract query from messages
  const query = extractQueryFromMessages(body.messages);
  if (!query) {
    return { augmentedBody: body, retrieval: null, sessionId };
  }
  
  // Retrieve via KRONOS
  const retrieval = await retrieveMemory(memoryKey, sessionId, query, {
    limit: options.contextLimit,
    recencyBias: options.recencyBias,
  });
  
  // If no memory found, return unchanged
  if (retrieval.chunks.length === 0) {
    console.log('[MEMORY:INJECT] No relevant memory found');
    return { augmentedBody: body, retrieval, sessionId };
  }
  
  // Format the memory context for the target model
  const contextText = retrieval.chunks
    .map(chunk => `[${chunk.role}${chunk.window ? ` | ${chunk.window}` : ''}] ${chunk.content}`)
    .join('\n\n');
  
  const formattedContext = formatMemoryContext(body.model, contextText);
  
  // Inject as system message
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
  
  console.log(`[MEMORY:INJECT] Injected ${retrieval.chunks.length} chunks (${retrieval.tokenCount} tokens) from session: ${sessionId}`);
  
  return {
    augmentedBody: { ...body, messages: augmentedMessages },
    retrieval,
    sessionId,
  };
}

// =============================================================================
// MEMORY STORAGE
// =============================================================================

/**
 * Store conversation in memory (after response)
 * 
 * Respects:
 * - X-Memory-Mode: off/read → skip all storage
 * - X-Memory-Store: false → skip all storage
 * - X-Memory-Store-Response: false → skip response storage
 * - message.memory: false → skip that specific message (selective memory)
 */
export async function storeConversation(
  memoryKey: string,
  sessionId: string,
  messages: Message[],
  assistantResponse: string,
  model: string,
  provider: string,
  options: MemoryOptions
): Promise<{ storedInputTokens: number; storedOutputTokens: number; ephemeralTokens: number }> {
  let storedInputTokens = 0;
  let storedOutputTokens = 0;
  let ephemeralTokens = 0;
  
  // Skip if memory is off or read-only
  if (options.mode === 'off' || options.mode === 'read') {
    console.log(`[MEMORY:STORE] Skipped — mode is ${options.mode}`);
    return { storedInputTokens, storedOutputTokens, ephemeralTokens };
  }
  
  // Store user messages (respecting selective memory)
  if (options.storeRequest) {
    for (const msg of messages) {
      // Skip messages with memory: false (selective memory)
      if (msg.memory === false) {
        const tokens = Math.ceil(msg.content.length / 4);
        ephemeralTokens += tokens;
        console.log(`[MEMORY:STORE] Skipped ephemeral message (memory: false, ~${tokens} tokens)`);
        continue;
      }
      
      // Only store user messages (system messages are typically static context)
      if (msg.role === 'user') {
        const stored = await storeMemory({
          memoryKey,
          sessionId,
          role: 'user',
          content: msg.content,
          model,
          provider,
        });
        storedInputTokens += stored.tokenCount;
      }
    }
  } else {
    // Count all as ephemeral
    for (const msg of messages) {
      if (msg.role === 'user') {
        ephemeralTokens += Math.ceil(msg.content.length / 4);
      }
    }
  }
  
  // Store assistant response
  if (options.storeResponse && assistantResponse) {
    const stored = await storeMemory({
      memoryKey,
      sessionId,
      role: 'assistant',
      content: assistantResponse,
      model,
      provider,
    });
    storedOutputTokens += stored.tokenCount;
  }
  
  console.log(`[MEMORY:STORE] Stored: ${storedInputTokens} input + ${storedOutputTokens} output tokens. Ephemeral: ${ephemeralTokens} tokens.`);
  
  return { storedInputTokens, storedOutputTokens, ephemeralTokens };
}
