/**
 * Memory Options Service
 * 
 * Centralizes ALL memory option parsing. One function to extract options
 * from any provider's request (headers and/or body).
 * 
 * Used by all provider routes: chat.ts, anthropic.ts, google.ts
 */

// ==================== TYPES ====================

/**
 * Memory mode controls retrieval and storage behavior
 */
export type MemoryMode = 'default' | 'read' | 'write' | 'off' | 'none';

/**
 * Parsed memory options — same structure for ALL providers
 */
export interface MemoryOptions {
  /** Memory mode: default (read+write), read (no store), write (no retrieve), off/none (disabled) */
  mode: MemoryMode;
  /** Maximum tokens of memory to inject */
  contextLimit: number;
  /** Store user input messages */
  storeInput: boolean;
  /** Store assistant responses */
  storeResponse: boolean;
  /** Session ID for session-scoped memory */
  sessionId?: string;
}

/**
 * Default options when nothing is specified
 */
export const DEFAULT_MEMORY_OPTIONS: MemoryOptions = {
  mode: 'default',
  contextLimit: 30,
  storeInput: true,
  storeResponse: true,
  sessionId: undefined,
};

// ==================== HEADER PARSING ====================

/**
 * Parse memory options from HTTP headers.
 * Works for ANY provider — headers are provider-agnostic.
 * 
 * Headers:
 * - X-Memory-Mode: default | read | write | off | none
 * - X-Context-Limit: number (max tokens)
 * - X-Session-ID: string (session scope)
 * - X-Store-Input: true | false
 * - X-Store-Response: true | false
 */
export function parseMemoryOptionsFromHeaders(headers: Headers): MemoryOptions {
  const options: MemoryOptions = { ...DEFAULT_MEMORY_OPTIONS };

  // Memory mode
  const modeHeader = headers.get('X-Memory-Mode')?.toLowerCase();
  if (modeHeader && ['default', 'read', 'write', 'off', 'none'].includes(modeHeader)) {
    options.mode = modeHeader as MemoryMode;
  }

  // Context limit
  const limitHeader = headers.get('X-Context-Limit');
  if (limitHeader) {
    const parsed = parseInt(limitHeader, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 100000) {
      options.contextLimit = parsed;
    }
  }

  // Session ID
  const sessionHeader = headers.get('X-Session-ID');
  if (sessionHeader) {
    options.sessionId = sessionHeader;
  }

  // Store flags
  const storeInput = headers.get('X-Store-Input')?.toLowerCase();
  if (storeInput === 'false') options.storeInput = false;
  if (storeInput === 'true') options.storeInput = true;

  const storeResponse = headers.get('X-Store-Response')?.toLowerCase();
  if (storeResponse === 'false') options.storeResponse = false;
  if (storeResponse === 'true') options.storeResponse = true;

  // Mode implications
  if (options.mode === 'read') {
    options.storeInput = false;
    options.storeResponse = false;
  } else if (options.mode === 'off' || options.mode === 'none') {
    options.storeInput = false;
    options.storeResponse = false;
  }

  return options;
}

// ==================== BODY PARSING ====================

/**
 * Parse memory options from request body fields.
 * Provider-agnostic — looks for common field names.
 * 
 * Body fields (all optional, stripped before forwarding):
 * - memory_mode: string
 * - context_limit: number
 * - session_id: string
 * - store_input: boolean
 * - store_response: boolean
 * 
 * Returns options AND cleaned body (without MR fields).
 */
export function parseMemoryOptionsFromBody(
  body: Record<string, unknown>,
  headerOptions: MemoryOptions
): { options: MemoryOptions; cleanBody: Record<string, unknown> } {
  const options: MemoryOptions = { ...headerOptions };
  const cleanBody: Record<string, unknown> = {};

  // MR-specific fields to strip
  const mrFields = ['memory_mode', 'context_limit', 'session_id', 'store_input', 'store_response'];

  // Copy body, stripping MR-specific fields
  for (const [key, value] of Object.entries(body)) {
    if (mrFields.includes(key)) {
      continue; // Don't copy to cleanBody
    }
    cleanBody[key] = value;
  }

  // Parse body options (override headers)
  const bodyMode = body.memory_mode as string | undefined;
  if (bodyMode && ['default', 'read', 'write', 'off', 'none'].includes(bodyMode.toLowerCase())) {
    options.mode = bodyMode.toLowerCase() as MemoryMode;
  }

  const bodyLimit = body.context_limit as number | undefined;
  if (typeof bodyLimit === 'number' && bodyLimit > 0 && bodyLimit <= 100000) {
    options.contextLimit = bodyLimit;
  }

  const bodySessionId = body.session_id as string | undefined;
  if (bodySessionId) {
    options.sessionId = bodySessionId;
  }

  if (body.store_input === false) options.storeInput = false;
  if (body.store_input === true) options.storeInput = true;
  if (body.store_response === false) options.storeResponse = false;
  if (body.store_response === true) options.storeResponse = true;

  // Mode implications
  if (options.mode === 'read') {
    options.storeInput = false;
    options.storeResponse = false;
  } else if (options.mode === 'off' || options.mode === 'none') {
    options.storeInput = false;
    options.storeResponse = false;
  }

  return { options, cleanBody };
}

// ==================== MESSAGE FLAG HANDLING ====================

/**
 * Strip per-message memory flags from messages array.
 * Some SDKs pass memory: false on individual messages.
 * 
 * Works for OpenAI format ({ role, content, memory? })
 * and Anthropic format ({ role, content: [blocks], memory? })
 */
export function stripMessageMemoryFlags<T extends { memory?: boolean }>(
  messages: T[]
): T[] {
  return messages.map(msg => {
    const { memory, ...rest } = msg;
    return rest as T;
  });
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Check if memory retrieval should happen based on options
 */
export function shouldRetrieveMemory(options: MemoryOptions): boolean {
  return options.mode !== 'off' && options.mode !== 'none' && options.mode !== 'write';
}

/**
 * Check if memory storage should happen based on options
 */
export function shouldStoreMemory(options: MemoryOptions): boolean {
  return options.mode !== 'off' && options.mode !== 'none' && options.mode !== 'read';
}

/**
 * Check if memory is completely disabled
 */
export function isMemoryDisabled(options: MemoryOptions): boolean {
  return options.mode === 'off' || options.mode === 'none';
}
