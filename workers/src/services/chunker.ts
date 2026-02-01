/**
 * Chunking Service for MemoryRouter
 * 
 * Consolidates small items and splits large items to maintain
 * consistent chunk sizes (~300 tokens) with 30 token overlap.
 */

const TARGET_TOKENS = 300;
const OVERLAP_TOKENS = 30;
const CHARS_PER_TOKEN = 4;  // Rough estimate

/**
 * Estimate token count from text
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate character count for N tokens
 */
function tokensToChars(tokens: number): number {
  return tokens * CHARS_PER_TOKEN;
}

/**
 * Split text at approximately the target token count
 * Tries to split at sentence/word boundaries
 */
function splitAtTokens(text: string, targetTokens: number): { chunk: string; remainder: string } {
  const targetChars = tokensToChars(targetTokens);
  
  if (text.length <= targetChars) {
    return { chunk: text, remainder: '' };
  }
  
  // Find a good split point near the target
  let splitPoint = targetChars;
  
  // Look for sentence boundary (. ! ?) within 20% of target
  const searchStart = Math.floor(targetChars * 0.8);
  const searchEnd = Math.ceil(targetChars * 1.2);
  const searchRegion = text.slice(searchStart, Math.min(searchEnd, text.length));
  
  const sentenceMatch = searchRegion.match(/[.!?]\s/);
  if (sentenceMatch && sentenceMatch.index !== undefined) {
    splitPoint = searchStart + sentenceMatch.index + 1;
  } else {
    // Fall back to word boundary
    const spaceIndex = text.lastIndexOf(' ', targetChars);
    if (spaceIndex > targetChars * 0.7) {
      splitPoint = spaceIndex;
    }
  }
  
  return {
    chunk: text.slice(0, splitPoint).trim(),
    remainder: text.slice(splitPoint).trim()
  };
}

/**
 * Format a message for inclusion in a chunk
 */
export function formatMessageForChunk(
  role: 'user' | 'assistant',
  content: string,
  timestamp?: number
): string {
  const timeStr = timestamp ? formatRelativeTime(timestamp) : '';
  const prefix = timeStr ? `[${role.toUpperCase()} ${timeStr}]` : `[${role.toUpperCase()}]`;
  return `${prefix} ${content}`;
}

/**
 * Format relative time (e.g., "3 hours ago")
 */
function formatRelativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  const minutes = Math.floor(delta / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'now';
}

/**
 * Process buffer with new content and return chunks to store
 * 
 * @param existingBuffer - Current pending buffer content
 * @param newContent - New content to add (already formatted with role/timestamp)
 * @returns Object with chunks to store and updated buffer
 */
export function processBuffer(
  existingBuffer: string,
  newContent: string
): {
  chunksToStore: string[];
  newBuffer: string;
  newBufferTokens: number;
} {
  // Combine existing buffer with new content
  let combined = existingBuffer 
    ? `${existingBuffer}\n\n${newContent}`
    : newContent;
  
  let combinedTokens = estimateTokens(combined);
  const chunksToStore: string[] = [];
  
  // Keep extracting chunks while we have enough tokens
  while (combinedTokens >= TARGET_TOKENS) {
    const { chunk, remainder } = splitAtTokens(combined, TARGET_TOKENS);
    
    if (chunk) {
      chunksToStore.push(chunk);
    }
    
    if (!remainder) {
      combined = '';
      break;
    }
    
    // Keep overlap from the end of the chunk for continuity
    const overlapChars = tokensToChars(OVERLAP_TOKENS);
    const overlap = chunk.slice(-overlapChars);
    
    // New combined = overlap + remainder
    combined = overlap ? `${overlap} ${remainder}` : remainder;
    combinedTokens = estimateTokens(combined);
  }
  
  return {
    chunksToStore,
    newBuffer: combined,
    newBufferTokens: estimateTokens(combined)
  };
}

/**
 * Process a single large message that exceeds target size
 * Splits into multiple chunks with overlap
 */
export function chunkLargeContent(content: string): string[] {
  const chunks: string[] = [];
  let remaining = content;
  
  while (estimateTokens(remaining) > TARGET_TOKENS) {
    const { chunk, remainder } = splitAtTokens(remaining, TARGET_TOKENS);
    chunks.push(chunk);
    
    if (!remainder) break;
    
    // Add overlap
    const overlapChars = tokensToChars(OVERLAP_TOKENS);
    const overlap = chunk.slice(-overlapChars);
    remaining = overlap ? `${overlap} ${remainder}` : remainder;
  }
  
  // Don't forget the final piece
  if (remaining) {
    chunks.push(remaining);
  }
  
  return chunks;
}

/**
 * Configuration for chunking
 */
export const CHUNKING_CONFIG = {
  TARGET_TOKENS,
  OVERLAP_TOKENS,
  CHARS_PER_TOKEN,
} as const;
