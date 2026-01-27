/**
 * Unit Tests: Model-Specific Formatters
 * 
 * Tests the formatting logic for injecting memory context
 * into requests for different AI models.
 */

import { describe, it, expect } from 'vitest';
import { formatMemoryContext, getFormatter, formatters } from '../../src/formatters';
import { memoryContexts, models } from '../fixtures';

describe('Model Formatters', () => {
  const testContext = 'User likes TypeScript. User is building an API.';

  describe('getFormatter', () => {
    it('returns claude formatter for Claude models', () => {
      expect(getFormatter('anthropic/claude-3-opus')).toBe(formatters.claude);
      expect(getFormatter('claude-3-haiku')).toBe(formatters.claude);
      expect(getFormatter('claude-2.1')).toBe(formatters.claude);
      expect(getFormatter('Claude-3-Sonnet')).toBe(formatters.claude); // Case insensitive
    });

    it('returns gpt formatter for OpenAI models', () => {
      expect(getFormatter('openai/gpt-4')).toBe(formatters.gpt);
      expect(getFormatter('gpt-4-turbo')).toBe(formatters.gpt);
      expect(getFormatter('gpt-3.5-turbo')).toBe(formatters.gpt);
      expect(getFormatter('GPT-4')).toBe(formatters.gpt); // Case insensitive
    });

    it('returns gpt formatter for O-series models', () => {
      expect(getFormatter('o1-preview')).toBe(formatters.gpt);
      expect(getFormatter('o1-mini')).toBe(formatters.gpt);
      expect(getFormatter('o3-mini')).toBe(formatters.gpt);
    });

    it('returns llama formatter for Llama models', () => {
      expect(getFormatter('meta-llama/llama-3-70b')).toBe(formatters.llama);
      expect(getFormatter('llama-3.1-405b')).toBe(formatters.llama);
      expect(getFormatter('Llama-2-70b')).toBe(formatters.llama);
    });

    it('returns gemini formatter for Google models', () => {
      expect(getFormatter('google/gemini-pro')).toBe(formatters.gemini);
      expect(getFormatter('gemini-1.5-pro')).toBe(formatters.gemini);
      expect(getFormatter('Gemini-Ultra')).toBe(formatters.gemini);
    });

    it('returns default formatter for unknown models', () => {
      expect(getFormatter('unknown/model-xyz')).toBe(formatters.default);
      expect(getFormatter('some-random-model')).toBe(formatters.default);
      expect(getFormatter('')).toBe(formatters.default);
    });

    it('handles all fixture models correctly', () => {
      for (const model of models.openai) {
        const formatter = getFormatter(model);
        expect(formatter).toBe(formatters.gpt);
      }
      
      for (const model of models.anthropic) {
        const formatter = getFormatter(model);
        expect(formatter).toBe(formatters.claude);
      }
      
      for (const model of models.google) {
        const formatter = getFormatter(model);
        expect(formatter).toBe(formatters.gemini);
      }
    });
  });

  describe('formatMemoryContext', () => {
    describe('Claude formatting', () => {
      it('formats context with XML tags', () => {
        const result = formatMemoryContext('claude-3-opus', testContext);
        expect(result).toContain('<memory_context>');
        expect(result).toContain(testContext);
        expect(result).toContain('</memory_context>');
      });

      it('includes instruction text', () => {
        const result = formatMemoryContext('claude-3-opus', testContext);
        expect(result.toLowerCase()).toContain('context');
        expect(result.toLowerCase()).toContain('previous conversations');
      });

      it('preserves multi-line context', () => {
        const multiLine = memoryContexts.technicalProject;
        const result = formatMemoryContext('claude-3-opus', multiLine);
        expect(result).toContain('Node.js');
        expect(result).toContain('PostgreSQL');
      });
    });

    describe('GPT formatting', () => {
      it('formats context with markdown', () => {
        const result = formatMemoryContext('gpt-4', testContext);
        expect(result).toContain('## Relevant Memory');
        expect(result).toContain('---');
        expect(result).toContain(testContext);
      });

      it('maintains markdown structure', () => {
        const result = formatMemoryContext('gpt-4-turbo', memoryContexts.technicalProject);
        const lines = result.split('\n');
        expect(lines.some(l => l.startsWith('##'))).toBe(true);
      });
    });

    describe('Llama formatting', () => {
      it('formats context with square brackets', () => {
        const result = formatMemoryContext('llama-3-70b', testContext);
        expect(result).toContain('[MEMORY_CONTEXT]');
        expect(result).toContain('[/MEMORY_CONTEXT]');
        expect(result).toContain(testContext);
      });
    });

    describe('Gemini formatting', () => {
      it('formats context with XML context tag', () => {
        const result = formatMemoryContext('gemini-pro', testContext);
        expect(result).toContain('<context type="memory">');
        expect(result).toContain('</context>');
        expect(result).toContain(testContext);
      });
    });

    describe('Default formatting', () => {
      it('uses simple text format', () => {
        const result = formatMemoryContext('unknown-model', testContext);
        expect(result).toContain('Relevant context');
        expect(result).toContain(testContext);
        expect(result).not.toContain('<memory_context>');
        expect(result).not.toContain('##');
      });
    });

    describe('Edge cases', () => {
      it('handles empty context', () => {
        const result = formatMemoryContext('gpt-4', '');
        // Empty context should still return the wrapper or empty string
        expect(typeof result).toBe('string');
      });

      it('handles very long context', () => {
        const longContext = memoryContexts.large;
        const result = formatMemoryContext('gpt-4', longContext);
        expect(result).toContain(longContext);
        expect(result.length).toBeGreaterThan(longContext.length);
      });

      it('handles special characters', () => {
        const specialContext = 'Code: <script>alert("xss")</script> and "quotes"';
        const result = formatMemoryContext('gpt-4', specialContext);
        expect(result).toContain(specialContext);
      });

      it('handles unicode and emoji', () => {
        const unicodeContext = 'User speaks 日本語. Favorite emoji: 🚀';
        const result = formatMemoryContext('gpt-4', unicodeContext);
        expect(result).toContain('日本語');
        expect(result).toContain('🚀');
      });

      it('handles newlines and whitespace', () => {
        const whitespaceContext = 'Line 1\n\nLine 2\n   \nLine 3';
        const result = formatMemoryContext('gpt-4', whitespaceContext);
        expect(result).toContain('Line 1');
        expect(result).toContain('Line 2');
        expect(result).toContain('Line 3');
      });

      it('handles code blocks in context', () => {
        const codeContext = `User's code:
\`\`\`typescript
function hello() {
  return "world";
}
\`\`\``;
        const result = formatMemoryContext('gpt-4', codeContext);
        expect(result).toContain('```typescript');
        expect(result).toContain('function hello()');
      });
    });
  });

  describe('Formatter consistency', () => {
    it('all formatters return strings', () => {
      for (const [name, formatter] of Object.entries(formatters)) {
        const result = formatter(testContext);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }
    });

    it('all formatters include the original context', () => {
      for (const [name, formatter] of Object.entries(formatters)) {
        const result = formatter(testContext);
        expect(result).toContain(testContext);
      }
    });

    it('formatters are deterministic', () => {
      for (const [name, formatter] of Object.entries(formatters)) {
        const result1 = formatter(testContext);
        const result2 = formatter(testContext);
        expect(result1).toBe(result2);
      }
    });
  });
});
