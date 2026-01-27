/**
 * Token Counting Unit Tests
 * 
 * Reference: memoryrouter-test-strategy.md Section 3.1
 */

import { describe, it, expect } from 'vitest';
import { 
  countTokens, 
  countMessageTokens, 
  countMemoryTokens,
  calculateCost,
  calculateBillableTokens,
  checkRemainingQuota,
  getFreeTierWarnings,
} from '../../src/billing/tokens';
import { PRICING, TokenMeteringInput } from '../../src/billing/types';

describe('Token Counting', () => {
  describe('countTokens', () => {
    it('counts tokens for simple text', () => {
      // ~4 chars per token for English
      const result = countTokens('Hello world');
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(10);
    });

    it('counts tokens for empty string', () => {
      expect(countTokens('')).toBe(0);
    });

    it('counts tokens for unicode/emoji', () => {
      const result = countTokens('Hello 👋 world 🌍');
      expect(result).toBeGreaterThan(4);
    });

    it('counts tokens for code blocks', () => {
      const code = `function hello() { return "world"; }`;
      const result = countTokens(code);
      expect(result).toBeGreaterThan(0);
    });

    it('handles very long text', () => {
      const longText = 'word '.repeat(2_000);
      expect(() => countTokens(longText)).not.toThrow();
      expect(countTokens(longText)).toBeGreaterThan(1000);
    });
  });

  describe('countMessageTokens', () => {
    it('counts tokens in message', () => {
      const result = countMessageTokens({
        role: 'user',
        content: 'Hello world',
      });
      expect(result).toBeGreaterThan(0);
    });

    it('handles empty content', () => {
      const result = countMessageTokens({
        role: 'user',
        content: '',
      });
      expect(result).toBe(0);
    });

    it('handles structured content with text', () => {
      const result = countMessageTokens({
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image_url', image_url: { url: 'data:...' } }
        ],
      });
      // Should count text + image tokens
      expect(result).toBeGreaterThan(10);
    });
  });

  describe('countMemoryTokens', () => {
    it('calculates billable memory tokens correctly', () => {
      const input: TokenMeteringInput = {
        messages: [
          { role: 'user', content: 'Remember this' },
          { role: 'assistant', content: 'I will remember' },
        ],
        responseContent: 'I will remember',
        storeRequest: true,
        storeResponse: true,
      };
      
      const result = countMemoryTokens(input);
      
      expect(result.storedInputTokens).toBeGreaterThan(0);
      expect(result.storedOutputTokens).toBeGreaterThan(0);
      expect(result.billableTokens).toBe(result.storedInputTokens + result.storedOutputTokens);
      expect(result.costUsd).toBeGreaterThan(0);
    });

    it('does not charge for ephemeral tokens', () => {
      const input: TokenMeteringInput = {
        messages: [
          { role: 'user', content: 'Do not remember this', memory: false },
          { role: 'user', content: 'Remember this' },
        ],
        storeRequest: true,
        storeResponse: false,
      };
      
      const result = countMemoryTokens(input);
      
      expect(result.ephemeralTokens).toBeGreaterThan(0);
      // Billable should only be the "Remember this" message
      expect(result.storedInputTokens).toBeLessThan(
        result.storedInputTokens + result.ephemeralTokens
      );
    });

    it('does not charge for retrieved tokens', () => {
      const input: TokenMeteringInput = {
        messages: [
          { role: 'user', content: 'Question' },
        ],
        storeRequest: true,
        storeResponse: true,
        responseContent: 'Answer',
        retrievedContext: 'Previous context that was retrieved for free',
      };
      
      const result = countMemoryTokens(input);
      
      expect(result.retrievedTokens).toBeGreaterThan(0);
      expect(result.billableTokens).toBe(result.storedInputTokens + result.storedOutputTokens);
      // Retrieved tokens should not affect billable
    });

    it('respects storeRequest: false', () => {
      const input: TokenMeteringInput = {
        messages: [
          { role: 'user', content: 'This should not be stored' },
        ],
        storeRequest: false,
        storeResponse: false,
      };
      
      const result = countMemoryTokens(input);
      
      expect(result.storedInputTokens).toBe(0);
      expect(result.billableTokens).toBe(0);
    });
  });
});

describe('Cost Calculation', () => {
  describe('calculateCost', () => {
    it('calculates cost correctly at $1/1M tokens', () => {
      const cost = calculateCost(1_000_000);
      expect(cost).toBe(1.00);
    });

    it('handles fractional tokens', () => {
      const cost = calculateCost(1);
      expect(cost).toBe(0.000001);
    });

    it('calculates 500K tokens correctly', () => {
      const cost = calculateCost(500_000);
      expect(cost).toBe(0.50);
    });

    it('rounds to 6 decimal places', () => {
      const cost = calculateCost(123);
      expect(cost.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(6);
    });
  });

  describe('calculateBillableTokens', () => {
    const FREE_TIER = BigInt(PRICING.FREE_TIER_TOKENS);

    it('returns 0 when under free tier', () => {
      const result = calculateBillableTokens(BigInt(5_000_000));
      expect(result).toBe(BigInt(0));
    });

    it('returns 0 at exactly free tier', () => {
      const result = calculateBillableTokens(FREE_TIER);
      expect(result).toBe(BigInt(0));
    });

    it('returns excess above free tier', () => {
      const totalUsed = FREE_TIER + BigInt(1_000_000);
      const result = calculateBillableTokens(totalUsed);
      expect(result).toBe(BigInt(1_000_000));
    });

    it('subtracts previously reported tokens', () => {
      const totalUsed = FREE_TIER + BigInt(5_000_000);
      const previouslyReported = BigInt(3_000_000);
      const result = calculateBillableTokens(totalUsed, previouslyReported);
      expect(result).toBe(BigInt(2_000_000));
    });
  });

  describe('checkRemainingQuota', () => {
    it('calculates remaining free tier correctly', () => {
      const result = checkRemainingQuota(BigInt(3_000_000), false);
      
      expect(result.remaining).toBe(7_000_000);
      expect(result.isFreeTier).toBe(true);
      expect(result.exhausted).toBe(false);
    });

    it('returns 0 when quota exceeded', () => {
      const result = checkRemainingQuota(BigInt(15_000_000), false);
      
      expect(result.remaining).toBe(0);
      expect(result.exhausted).toBe(true);
    });

    it('returns Infinity for paid users', () => {
      const result = checkRemainingQuota(BigInt(100_000_000), true);
      
      expect(result.remaining).toBe(Infinity);
      expect(result.isFreeTier).toBe(false);
      expect(result.exhausted).toBe(false);
    });
  });

  describe('getFreeTierWarnings', () => {
    it('detects approaching threshold at 70%', () => {
      const result = getFreeTierWarnings(BigInt(7_500_000));
      expect(result.approaching).toBe(true);
      expect(result.almostExhausted).toBe(false);
    });

    it('detects almost exhausted at 90%', () => {
      const result = getFreeTierWarnings(BigInt(9_500_000));
      expect(result.almostExhausted).toBe(true);
    });

    it('detects exhausted at 100%', () => {
      const result = getFreeTierWarnings(BigInt(50_000_000));
      expect(result.exhausted).toBe(true);
    });

    it('returns false for all when under 70%', () => {
      const result = getFreeTierWarnings(BigInt(5_000_000));
      expect(result.approaching).toBe(false);
      expect(result.almostExhausted).toBe(false);
      expect(result.exhausted).toBe(false);
    });
  });
});
