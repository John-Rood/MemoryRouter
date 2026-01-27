/**
 * Global test setup for Vitest
 * This file runs before all tests
 */

import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { server } from './mocks/server';

// Enable MSW mock server before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
});

// Reset handlers between tests
beforeEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
});

// Clean up after each test
afterEach(() => {
  vi.restoreAllMocks();
});

// Close server after all tests
afterAll(() => {
  server.close();
});

// Global test environment variables
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'test_encryption_key_32_chars_xx';
process.env.OPENAI_API_KEY = 'sk-test-openai-key';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = 'test-supabase-key';
process.env.VECTORVAULT_API_KEY = 'test-vectorvault-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_stripe';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

// Extend expect with custom matchers
declare global {
  namespace Vi {
    interface Assertion<T = unknown> {
      toBeValidMemoryKey(): T;
      toBeValidProviderKey(): T;
      toHaveTokenCount(): T;
    }
  }
}

// Custom matchers
expect.extend({
  toBeValidMemoryKey(received: string) {
    const pass = typeof received === 'string' && 
                 received.startsWith('mk_') && 
                 received.length >= 24;
    
    return {
      pass,
      message: () => pass
        ? `expected ${received} not to be a valid memory key`
        : `expected ${received} to be a valid memory key (mk_ prefix, 24+ chars)`,
    };
  },
  
  toBeValidProviderKey(received: string) {
    const pass = typeof received === 'string' && 
                 (received.startsWith('sk-') || received.startsWith('sk-ant-'));
    
    return {
      pass,
      message: () => pass
        ? `expected ${received} not to be a valid provider key`
        : `expected ${received} to be a valid provider key (sk- or sk-ant- prefix)`,
    };
  },
  
  toHaveTokenCount(received: { tokens?: { input?: number; output?: number } }) {
    const pass = received?.tokens?.input !== undefined && 
                 received?.tokens?.output !== undefined;
    
    return {
      pass,
      message: () => pass
        ? `expected response not to have token counts`
        : `expected response to have tokens.input and tokens.output`,
    };
  },
});

// Global test utilities
global.testUtils = {
  sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  
  randomString: (length: number = 16): string => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length }, () => 
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  },
  
  generateMemoryKey: (): string => `mk_${global.testUtils.randomString(24)}`,
};

// Type augmentation for global test utilities
declare global {
  var testUtils: {
    sleep: (ms: number) => Promise<void>;
    randomString: (length?: number) => string;
    generateMemoryKey: () => string;
  };
}
