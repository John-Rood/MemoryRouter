/**
 * Token Counting Library
 * 
 * Handles token counting for billing purposes.
 * Uses GPT tokenizer as approximation for all models.
 * 
 * Reference: memoryrouter-stripe-spec.md Section 3.2
 */

import { 
  PRICING, 
  TokenMeteringInput, 
  TokenCountResult,
  CreateUsageRecordInput 
} from './types';

// =============================================================================
// TOKENIZER
// =============================================================================

/**
 * Simple token counter using character-based estimation
 * 
 * For production, use a proper tokenizer like:
 * - js-tiktoken for GPT models
 * - @anthropic-ai/tokenizer for Claude
 * 
 * This approximation is ~1 token per 4 characters, which is
 * close to the actual ratio for English text.
 */
export function countTokens(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }
  
  // Simple approximation: ~4 characters per token for English
  // This matches OpenAI's rule of thumb
  // For production, use tiktoken or similar
  const tokenCount = Math.ceil(text.length / 4);
  
  return tokenCount;
}

/**
 * Count tokens in a message with content
 * Handles both string content and structured content (for vision, etc.)
 */
export function countMessageTokens(message: { role: string; content: string | unknown }): number {
  if (!message.content) {
    return 0;
  }
  
  if (typeof message.content === 'string') {
    return countTokens(message.content);
  }
  
  // Handle structured content (e.g., vision with image_url)
  if (Array.isArray(message.content)) {
    let total = 0;
    for (const part of message.content) {
      if (typeof part === 'object' && part !== null) {
        const p = part as Record<string, unknown>;
        if (p.type === 'text' && typeof p.text === 'string') {
          total += countTokens(p.text);
        } else if (p.type === 'image_url') {
          // Estimate for images: ~85 tokens base + more for high detail
          total += 85;
        }
      }
    }
    return total;
  }
  
  return 0;
}

// =============================================================================
// METERING
// =============================================================================

/**
 * Calculate billable tokens from a request/response
 * 
 * Rules:
 * - Stored input (memory !== false) → billable
 * - Stored output (if storeResponse) → billable
 * - Retrieved context (RAG) → FREE
 * - Ephemeral (memory: false) → not counted
 */
export function countMemoryTokens(input: TokenMeteringInput): TokenCountResult {
  let storedInputTokens = 0;
  let ephemeralTokens = 0;
  let storedOutputTokens = 0;
  let retrievedTokens = 0;
  
  // Count input message tokens
  for (const msg of input.messages) {
    const tokenCount = countTokens(msg.content);
    
    // Check if message should be stored
    const shouldStore = msg.memory !== false && input.storeRequest;
    
    if (shouldStore) {
      storedInputTokens += tokenCount;
    } else {
      ephemeralTokens += tokenCount;
    }
  }
  
  // Count output tokens
  if (input.responseContent && input.storeResponse) {
    storedOutputTokens = countTokens(input.responseContent);
  }
  
  // Count retrieved context (for stats, not billing)
  if (input.retrievedContext) {
    retrievedTokens = countTokens(input.retrievedContext);
  }
  
  // Calculate billable tokens
  const billableTokens = storedInputTokens + storedOutputTokens;
  
  // Calculate cost
  const costUsd = calculateCost(billableTokens);
  
  return {
    storedInputTokens,
    storedOutputTokens,
    retrievedTokens,
    ephemeralTokens,
    billableTokens,
    costUsd,
  };
}

// =============================================================================
// COST CALCULATION
// =============================================================================

/**
 * Calculate cost in USD for a given number of tokens
 * Price: $0.50 per 1M tokens
 */
export function calculateCost(tokens: number): number {
  const cost = (tokens / 1_000_000) * PRICING.PRICE_PER_MILLION_TOKENS;
  // Round to 6 decimal places
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/**
 * Calculate billable tokens above free tier
 */
export function calculateBillableTokens(
  totalUsed: bigint,
  previouslyReported: bigint = BigInt(0)
): bigint {
  const freeTier = BigInt(PRICING.FREE_TIER_TOKENS);
  
  // If still in free tier
  if (totalUsed <= freeTier) {
    return BigInt(0);
  }
  
  // Total billable is everything above free tier
  const totalBillable = totalUsed - freeTier;
  
  // New billable is what hasn't been reported yet
  const newBillable = totalBillable - previouslyReported;
  
  return newBillable > 0 ? newBillable : BigInt(0);
}

/**
 * Convert tokens to units for Stripe reporting
 * We report in units of 1 million tokens
 */
export function tokensToStripeUnits(tokens: bigint): number {
  // Round up to ensure we don't under-bill
  return Math.ceil(Number(tokens) / 1_000_000);
}

// =============================================================================
// QUOTA CHECKING
// =============================================================================

/**
 * Check remaining quota for a user
 */
export function checkRemainingQuota(
  totalTokensUsed: bigint,
  hasPaymentMethod: boolean
): {
  remaining: number | typeof Infinity;
  percentUsed: number;
  isFreeTier: boolean;
  exhausted: boolean;
} {
  const freeTier = BigInt(PRICING.FREE_TIER_TOKENS);
  const remaining = freeTier - totalTokensUsed;
  const percentUsed = (Number(totalTokensUsed) / Number(freeTier)) * 100;
  
  // If has payment method, quota is unlimited
  if (hasPaymentMethod) {
    return {
      remaining: Infinity,
      percentUsed: Math.min(100, percentUsed),
      isFreeTier: false,
      exhausted: false,
    };
  }
  
  // Free tier user
  return {
    remaining: Number(remaining > 0 ? remaining : 0),
    percentUsed: Math.min(100, percentUsed),
    isFreeTier: true,
    exhausted: remaining <= 0,
  };
}

// =============================================================================
// USAGE RECORD CREATION
// =============================================================================

/**
 * Create a usage record input from token count result
 */
export function createUsageRecordInput(
  userId: string,
  result: TokenCountResult,
  options: {
    memoryKeyId?: string;
    requestId?: string;
    model?: string;
    provider?: string;
  } = {}
): CreateUsageRecordInput {
  return {
    userId,
    memoryKeyId: options.memoryKeyId,
    requestId: options.requestId,
    tokensInput: result.storedInputTokens,
    tokensOutput: result.storedOutputTokens,
    tokensRetrieved: result.retrievedTokens,
    tokensEphemeral: result.ephemeralTokens,
    model: options.model,
    provider: options.provider,
  };
}

// =============================================================================
// FREE TIER WARNINGS
// =============================================================================

/**
 * Get free tier warning threshold levels
 */
export function getFreeTierWarnings(totalTokensUsed: bigint): {
  approaching: boolean;
  almostExhausted: boolean;
  exhausted: boolean;
  percentUsed: number;
} {
  const freeTier = BigInt(PRICING.FREE_TIER_TOKENS);
  const percentUsed = (Number(totalTokensUsed) / Number(freeTier)) * 100;
  
  return {
    approaching: percentUsed >= 70 && percentUsed < 90,      // 70-90%
    almostExhausted: percentUsed >= 90 && percentUsed < 100, // 90-100%
    exhausted: percentUsed >= 100,
    percentUsed: Math.min(100, percentUsed),
  };
}
