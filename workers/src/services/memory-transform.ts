/**
 * Memory Transform Service
 * Unified provider-agnostic functions for memory extraction and injection.
 * 
 * PART 1: EXTRACTION — Parse memory flags, strip custom fields before forwarding
 * PART 2: INJECTION — Format and inject memory context into any provider's request format
 * PART 3: INTEGRATION — Works with truncation service for accurate token budgeting
 * 
 * Supported Providers:
 * - OpenAI / Azure / DeepSeek / Ollama / Mistral — messages[] with system role
 * - Anthropic — messages[] + separate system field
 * - Google Gemini — contents[] + systemInstruction
 * - xAI (Grok) — OpenAI-compatible format
 * - Cerebras — OpenAI-compatible format
 * - OpenRouter — Pass-through (format depends on underlying model)
 */

import { Provider, detectProvider } from './providers';
import { estimateTokens } from './truncation';

// ==================== Types ====================

/**
 * Memory chunk from retrieval
 */
export interface MemoryChunk {
  id: number;
  content: string;
  timestamp: number;
  score: number;
  window: 'hot' | 'working' | 'longterm';
  role?: string;
  source?: string;
}

/**
 * Result of extracting memory flags from a request
 */
export interface ExtractionResult {
  /** Body with memory_mode and per-message memory flags stripped — safe to forward */
  cleanedBody: Record<string, unknown>;
  /** The extracted memory mode from the request */
  memoryMode: 'all' | 'none' | 'selective' | null;
  /** Messages with their memory storage flags */
  messagesWithMemoryFlags: Array<{
    role: string;
    content: string;
    memory: boolean;  // Whether to store this message
  }>;
  /** Provider detected from the body */
  provider: Provider;
}

/**
 * Result of injecting memory context into a request
 */
export interface InjectionResult {
  /** Body with memory context injected — ready for provider */
  injectedBody: Record<string, unknown>;
  /** Token count of injected memory (for truncation accounting) */
  injectedTokens: number;
  /** Number of memory chunks used */
  memoryChunksUsed: number;
  /** The format used for injection */
  formatUsed: 'xml' | 'markdown' | 'brackets';
}

/**
 * Options for memory injection
 */
export interface InjectionOptions {
  /** Maximum tokens to use for memory context */
  maxTokens?: number;
  /** Override auto-detected format */
  format?: 'xml' | 'markdown' | 'brackets';
  /** Include core memory at the top */
  includeCoreMemory?: boolean;
}

// ==================== Format Detection ====================

/**
 * Detect the optimal injection format for a provider/model combination
 */
export function detectFormat(provider: Provider, model: string): 'xml' | 'markdown' | 'brackets' {
  const modelLower = model.toLowerCase();
  
  // Provider-based defaults
  switch (provider) {
    case 'anthropic':
      return 'xml';  // Claude prefers XML tags
    case 'google':
      return 'xml';  // Gemini handles XML well
    case 'openai':
    case 'xai':
    case 'cerebras':
      return 'markdown';  // GPT/Grok prefer markdown
    case 'openrouter':
      // OpenRouter routes to many models — infer from model name
      if (modelLower.includes('claude')) return 'xml';
      if (modelLower.includes('llama')) return 'brackets';
      if (modelLower.includes('gemini')) return 'xml';
      return 'markdown';  // Default for OpenRouter
    default:
      return 'markdown';
  }
}

/**
 * Detect the body format (which provider schema)
 */
type BodyFormat = 'openai' | 'anthropic' | 'google';

function detectBodyFormat(body: Record<string, unknown>): BodyFormat {
  // Google: has contents[] array
  if (Array.isArray(body.contents)) {
    return 'google';
  }
  
  // Anthropic: has messages[] + may have system as string
  if (Array.isArray(body.messages) && typeof body.system === 'string') {
    return 'anthropic';
  }
  
  // Anthropic: model starts with claude and no contents
  const model = body.model as string | undefined;
  if (model?.toLowerCase().includes('claude') && !body.contents) {
    return 'anthropic';
  }
  
  // Default: OpenAI format (messages[] with system in messages)
  return 'openai';
}

// ==================== PART 1: EXTRACTION ====================

/**
 * Extract memory flags from request body and clean for forwarding.
 * 
 * Handles:
 * - Top-level `memory_mode`: 'all' | 'none' | 'selective'
 * - Per-message `memory: false` flags
 * - All provider formats (OpenAI, Anthropic, Google)
 * 
 * @param body - Raw request body from client
 * @param providerOverride - Optional provider override (otherwise detected from model)
 * @returns ExtractionResult with cleaned body and extracted flags
 */
export function extractMemoryFlags(
  body: Record<string, unknown>,
  providerOverride?: Provider
): ExtractionResult {
  // Deep clone to avoid mutating original
  const cleanedBody = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  
  // Extract top-level memory_mode
  const memoryMode = extractMemoryMode(cleanedBody);
  
  // Detect provider and body format
  const model = (cleanedBody.model as string) || '';
  const provider = providerOverride || detectProvider(model);
  const bodyFormat = detectBodyFormat(cleanedBody);
  
  // Extract messages with memory flags based on format
  const messagesWithMemoryFlags = extractMessagesWithFlags(cleanedBody, bodyFormat);
  
  // Clean the body (remove memory-related fields)
  cleanBodyForProvider(cleanedBody, bodyFormat);
  
  return {
    cleanedBody,
    memoryMode,
    messagesWithMemoryFlags,
    provider,
  };
}

/**
 * Extract and remove memory_mode from body
 */
function extractMemoryMode(body: Record<string, unknown>): 'all' | 'none' | 'selective' | null {
  const mode = body.memory_mode as string | undefined;
  delete body.memory_mode;
  
  if (mode === 'all' || mode === 'none' || mode === 'selective') {
    return mode;
  }
  return null;
}

/**
 * Extract messages with their memory flags
 */
function extractMessagesWithFlags(
  body: Record<string, unknown>,
  format: BodyFormat
): Array<{ role: string; content: string; memory: boolean }> {
  const result: Array<{ role: string; content: string; memory: boolean }> = [];
  
  switch (format) {
    case 'openai':
    case 'anthropic': {
      // Both use messages[] array
      const messages = body.messages as Array<Record<string, unknown>> | undefined;
      if (messages && Array.isArray(messages)) {
        for (const msg of messages) {
          result.push({
            role: (msg.role as string) || 'user',
            content: extractMessageContent(msg),
            memory: msg.memory !== false,  // Default true unless explicitly false
          });
        }
      }
      
      // Anthropic may have separate system field
      if (format === 'anthropic' && body.system) {
        const systemContent = typeof body.system === 'string' 
          ? body.system 
          : (body.system as Array<{ text: string }>)?.[0]?.text || '';
        if (systemContent) {
          result.unshift({
            role: 'system',
            content: systemContent,
            memory: true,  // System messages always stored
          });
        }
      }
      break;
    }
    
    case 'google': {
      // Google uses contents[] array with parts[]
      const contents = body.contents as Array<Record<string, unknown>> | undefined;
      if (contents && Array.isArray(contents)) {
        for (const content of contents) {
          const role = (content.role as string) === 'model' ? 'assistant' : (content.role as string) || 'user';
          const parts = content.parts as Array<{ text?: string }> | undefined;
          const text = parts?.[0]?.text || '';
          result.push({
            role,
            content: text,
            memory: (content as Record<string, unknown>).memory !== false,
          });
        }
      }
      
      // Google systemInstruction
      const systemInstruction = body.systemInstruction as Record<string, unknown> | undefined;
      if (systemInstruction) {
        const parts = systemInstruction.parts as Array<{ text?: string }> | undefined;
        const text = parts?.[0]?.text || '';
        if (text) {
          result.unshift({
            role: 'system',
            content: text,
            memory: true,
          });
        }
      }
      break;
    }
  }
  
  return result;
}

/**
 * Extract content from a message (handles string or array formats)
 */
function extractMessageContent(msg: Record<string, unknown>): string {
  const content = msg.content;
  
  // String content
  if (typeof content === 'string') {
    return content;
  }
  
  // Array content (e.g., vision messages with text + image)
  if (Array.isArray(content)) {
    const textParts = content
      .filter((part: Record<string, unknown>) => part.type === 'text')
      .map((part: Record<string, unknown>) => part.text as string);
    return textParts.join('\n');
  }
  
  return '';
}

/**
 * Remove memory-specific fields from body before forwarding to provider
 */
function cleanBodyForProvider(body: Record<string, unknown>, format: BodyFormat): void {
  // Remove top-level memory fields
  delete body.memory_mode;
  delete body.memory;
  
  switch (format) {
    case 'openai':
    case 'anthropic': {
      // Clean messages array
      const messages = body.messages as Array<Record<string, unknown>> | undefined;
      if (messages && Array.isArray(messages)) {
        for (const msg of messages) {
          delete msg.memory;
        }
      }
      break;
    }
    
    case 'google': {
      // Clean contents array
      const contents = body.contents as Array<Record<string, unknown>> | undefined;
      if (contents && Array.isArray(contents)) {
        for (const content of contents) {
          delete (content as Record<string, unknown>).memory;
        }
      }
      break;
    }
  }
}

// ==================== PART 2: INJECTION ====================

/**
 * Inject memory context into a request body.
 * 
 * Handles all provider formats:
 * - OpenAI/Azure/DeepSeek/Ollama/Mistral: Prepend to system message
 * - Anthropic: Prepend to system field
 * - Google Gemini: Prepend to systemInstruction.parts[0].text
 * 
 * @param body - Request body (should be pre-cleaned via extractMemoryFlags)
 * @param provider - Target provider
 * @param model - Model name (for format detection)
 * @param memoryChunks - Retrieved memory chunks
 * @param coreMemory - Core memory string (persistent facts about the user)
 * @param options - Injection options
 * @returns InjectionResult with injected body and token accounting
 */
export function injectMemoryContext(
  body: Record<string, unknown>,
  provider: Provider,
  model: string,
  memoryChunks: MemoryChunk[],
  coreMemory: string | null,
  options: InjectionOptions = {}
): InjectionResult {
  // Deep clone to avoid mutating original
  const injectedBody = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  
  // No memory to inject
  if (memoryChunks.length === 0 && !coreMemory) {
    return {
      injectedBody,
      injectedTokens: 0,
      memoryChunksUsed: 0,
      formatUsed: detectFormat(provider, model),
    };
  }
  
  // Detect format to use
  const format = options.format || detectFormat(provider, model);
  
  // Apply token budget if specified
  let chunksToUse = memoryChunks;
  if (options.maxTokens) {
    chunksToUse = trimChunksToTokenBudget(memoryChunks, options.maxTokens, coreMemory);
  }
  
  // Format the memory context
  const formattedContext = formatMemoryForInjection(chunksToUse, coreMemory, format);
  
  // Calculate tokens
  const injectedTokens = estimateTokens(formattedContext);
  
  // Inject based on body format
  const bodyFormat = detectBodyFormat(injectedBody);
  injectIntoBody(injectedBody, bodyFormat, formattedContext, provider);
  
  return {
    injectedBody,
    injectedTokens,
    memoryChunksUsed: chunksToUse.length,
    formatUsed: format,
  };
}

/**
 * Trim chunks to fit within token budget
 */
function trimChunksToTokenBudget(
  chunks: MemoryChunk[],
  maxTokens: number,
  coreMemory: string | null
): MemoryChunk[] {
  // Reserve tokens for core memory + formatting overhead
  const coreMemoryTokens = coreMemory ? estimateTokens(coreMemory) : 0;
  const formatOverhead = 100;  // Tags, headers, spacing
  const availableForChunks = maxTokens - coreMemoryTokens - formatOverhead;
  
  if (availableForChunks <= 0) {
    return [];
  }
  
  // Keep highest-scored chunks that fit
  const sorted = [...chunks].sort((a, b) => b.score - a.score);
  const result: MemoryChunk[] = [];
  let usedTokens = 0;
  
  for (const chunk of sorted) {
    const chunkTokens = estimateTokens(chunk.content);
    if (usedTokens + chunkTokens <= availableForChunks) {
      result.push(chunk);
      usedTokens += chunkTokens;
    }
  }
  
  // Re-sort by timestamp (newest first) for better context flow
  return result.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Format memory chunks for injection
 */
function formatMemoryForInjection(
  chunks: MemoryChunk[],
  coreMemory: string | null,
  format: 'xml' | 'markdown' | 'brackets'
): string {
  const parts: string[] = [];
  
  // Format core memory
  if (coreMemory) {
    parts.push(formatCoreMemory(coreMemory, format));
  }
  
  // Format chunks
  if (chunks.length > 0) {
    parts.push(formatChunks(chunks, format));
  }
  
  // Add usage instruction
  const instruction = 'Use this context naturally to inform your response. Do not explicitly mention "memory" unless directly asked.';
  
  return parts.join('\n\n') + '\n\n' + instruction;
}

/**
 * Format core memory section
 */
function formatCoreMemory(coreMemory: string, format: 'xml' | 'markdown' | 'brackets'): string {
  switch (format) {
    case 'xml':
      return `<core_memory>\n${coreMemory}\n</core_memory>`;
    case 'markdown':
      return `## Core Memory\n---\n${coreMemory}\n---`;
    case 'brackets':
      return `[CORE_MEMORY]\n${coreMemory}\n[/CORE_MEMORY]`;
  }
}

/**
 * Format memory chunks section
 */
function formatChunks(chunks: MemoryChunk[], format: 'xml' | 'markdown' | 'brackets'): string {
  const formattedChunks = chunks.map((chunk, i) => {
    const age = getAgeLabel(chunk.timestamp);
    const prefix = chunk.window === 'hot' ? '🔥 ' : chunk.window === 'working' ? '⚡ ' : '';
    return `${prefix}[${age}] ${chunk.content}`;
  }).join('\n\n');
  
  switch (format) {
    case 'xml':
      return `<memory_context>\n${formattedChunks}\n</memory_context>`;
    case 'markdown':
      return `## Relevant Memory\n---\n${formattedChunks}\n---`;
    case 'brackets':
      return `[MEMORY_CONTEXT]\n${formattedChunks}\n[/MEMORY_CONTEXT]`;
  }
}

/**
 * Get human-readable age label for a timestamp
 */
function getAgeLabel(timestamp: number): string {
  const ageMs = Date.now() - timestamp;
  const ageMinutes = Math.floor(ageMs / 60000);
  const ageHours = Math.floor(ageMinutes / 60);
  const ageDays = Math.floor(ageHours / 24);
  
  if (ageMinutes < 1) return 'just now';
  if (ageMinutes < 60) return `${ageMinutes}m ago`;
  if (ageHours < 24) return `${ageHours}h ago`;
  if (ageDays < 7) return `${ageDays}d ago`;
  return `${Math.floor(ageDays / 7)}w ago`;
}

/**
 * Inject formatted context into body based on provider format
 */
function injectIntoBody(
  body: Record<string, unknown>,
  bodyFormat: BodyFormat,
  context: string,
  provider: Provider
): void {
  switch (bodyFormat) {
    case 'openai':
      injectOpenAI(body, context);
      break;
    case 'anthropic':
      injectAnthropic(body, context);
      break;
    case 'google':
      injectGoogle(body, context);
      break;
  }
}

/**
 * Inject into OpenAI-format body (messages[] with system role)
 */
function injectOpenAI(body: Record<string, unknown>, context: string): void {
  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  
  if (!messages || !Array.isArray(messages)) {
    body.messages = [{ role: 'system', content: context }];
    return;
  }
  
  // Find existing system message
  const systemIndex = messages.findIndex(m => m.role === 'system');
  
  if (systemIndex >= 0) {
    // Prepend to existing system message
    const existingContent = messages[systemIndex].content as string;
    messages[systemIndex].content = context + '\n\n' + existingContent;
  } else {
    // Add new system message at start
    messages.unshift({ role: 'system', content: context });
  }
}

/**
 * Inject into Anthropic-format body (separate system field)
 */
function injectAnthropic(body: Record<string, unknown>, context: string): void {
  const existingSystem = body.system as string | undefined;
  
  if (existingSystem) {
    body.system = context + '\n\n' + existingSystem;
  } else {
    body.system = context;
  }
}

/**
 * Inject into Google-format body (systemInstruction.parts[])
 */
function injectGoogle(body: Record<string, unknown>, context: string): void {
  const systemInstruction = body.systemInstruction as Record<string, unknown> | undefined;
  
  if (systemInstruction) {
    const parts = systemInstruction.parts as Array<{ text: string }> | undefined;
    if (parts && parts.length > 0) {
      parts[0].text = context + '\n\n' + parts[0].text;
    } else {
      systemInstruction.parts = [{ text: context }];
    }
  } else {
    body.systemInstruction = {
      parts: [{ text: context }],
    };
  }
}

// ==================== PART 3: INTEGRATION HELPERS ====================

/**
 * Calculate total tokens for memory context (for pre-truncation budgeting)
 * 
 * Use this BEFORE calling truncateToFit to know how much space memory will take.
 */
export function calculateMemoryTokens(
  chunks: MemoryChunk[],
  coreMemory: string | null,
  format: 'xml' | 'markdown' | 'brackets'
): number {
  if (chunks.length === 0 && !coreMemory) {
    return 0;
  }
  
  const formattedContext = formatMemoryForInjection(chunks, coreMemory, format);
  return estimateTokens(formattedContext);
}

/**
 * Pre-flight check: Will memory fit in the context window?
 * 
 * Returns how many tokens need to be freed if over budget.
 */
export function checkMemoryBudget(
  chunks: MemoryChunk[],
  coreMemory: string | null,
  format: 'xml' | 'markdown' | 'brackets',
  availableTokens: number
): { fits: boolean; overage: number; memoryTokens: number } {
  const memoryTokens = calculateMemoryTokens(chunks, coreMemory, format);
  const overage = Math.max(0, memoryTokens - availableTokens);
  
  return {
    fits: overage === 0,
    overage,
    memoryTokens,
  };
}

/**
 * Convenience: Extract + Inject in one call
 * 
 * This is the high-level function for most use cases.
 */
export function transformRequestWithMemory(
  body: Record<string, unknown>,
  memoryChunks: MemoryChunk[],
  coreMemory: string | null,
  options: InjectionOptions = {}
): {
  extraction: ExtractionResult;
  injection: InjectionResult;
  finalBody: Record<string, unknown>;
} {
  // Extract flags and clean body
  const extraction = extractMemoryFlags(body);
  
  // Skip injection if memory_mode is 'none'
  if (extraction.memoryMode === 'none') {
    return {
      extraction,
      injection: {
        injectedBody: extraction.cleanedBody,
        injectedTokens: 0,
        memoryChunksUsed: 0,
        formatUsed: detectFormat(extraction.provider, (body.model as string) || ''),
      },
      finalBody: extraction.cleanedBody,
    };
  }
  
  // Inject memory context
  const injection = injectMemoryContext(
    extraction.cleanedBody,
    extraction.provider,
    (body.model as string) || '',
    memoryChunks,
    coreMemory,
    options
  );
  
  return {
    extraction,
    injection,
    finalBody: injection.injectedBody,
  };
}

// ==================== EXPORTS ====================

// detectFormat is already exported at definition
// detectBodyFormat is internal (not exported)
// estimateTokens is imported and re-exported below

export { estimateTokens };

// Default export for clean imports
export default {
  extractMemoryFlags,
  injectMemoryContext,
  transformRequestWithMemory,
  calculateMemoryTokens,
  checkMemoryBudget,
  detectFormat,
};
