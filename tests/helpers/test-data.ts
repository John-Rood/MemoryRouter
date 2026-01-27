/**
 * Test Data Helpers
 * 
 * Functions for creating test users, keys, and fixtures
 */

import { faker } from '@faker-js/faker';

// =============================================================================
// USER HELPERS
// =============================================================================

export interface TestUser {
  id: string;
  email: string;
  name: string;
  tier: 'free' | 'paid' | 'enterprise';
  stripeCustomerId?: string;
  createdAt: Date;
}

export function createTestUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: `user_${faker.string.alphanumeric(16)}`,
    email: faker.internet.email(),
    name: faker.person.fullName(),
    tier: 'free',
    createdAt: new Date(),
    ...overrides,
  };
}

export function createPaidUser(): TestUser {
  return createTestUser({
    tier: 'paid',
    stripeCustomerId: `cus_${faker.string.alphanumeric(14)}`,
  });
}

// =============================================================================
// KEY HELPERS
// =============================================================================

export interface TestMemoryKey {
  key: string;
  userId: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
}

export function createTestMemoryKey(userId: string, overrides: Partial<TestMemoryKey> = {}): TestMemoryKey {
  return {
    key: `mk_${faker.string.alphanumeric(24)}`,
    userId,
    name: faker.lorem.words(2),
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

export interface TestProviderKey {
  id: string;
  userId: string;
  provider: 'openai' | 'anthropic' | 'openrouter' | 'google';
  encryptedKey: string;
  decryptedKey: string;
  isActive: boolean;
}

export function createTestProviderKey(
  userId: string,
  provider: 'openai' | 'anthropic' | 'openrouter' | 'google' = 'openai'
): TestProviderKey {
  const keyPrefixes: Record<string, string> = {
    openai: 'sk-',
    anthropic: 'sk-ant-api03-',
    openrouter: 'sk-or-v1-',
    google: 'AIza',
  };
  
  const decryptedKey = `${keyPrefixes[provider]}${faker.string.alphanumeric(40)}`;
  
  return {
    id: `pk_${faker.string.alphanumeric(16)}`,
    userId,
    provider,
    encryptedKey: `encrypted_${faker.string.alphanumeric(64)}`,
    decryptedKey,
    isActive: true,
  };
}

// =============================================================================
// MESSAGE HELPERS
// =============================================================================

export interface TestMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  memory?: boolean;
}

export function createTestMessages(count: number = 3): TestMessage[] {
  const messages: TestMessage[] = [];
  
  for (let i = 0; i < count; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: faker.lorem.sentence(),
    });
  }
  
  return messages;
}

export function createConversation(
  options: {
    includeSystem?: boolean;
    turns?: number;
    selectiveMemory?: boolean;
  } = {}
): TestMessage[] {
  const { includeSystem = true, turns = 3, selectiveMemory = false } = options;
  const messages: TestMessage[] = [];
  
  if (includeSystem) {
    messages.push({
      role: 'system',
      content: 'You are a helpful assistant.',
    });
  }
  
  for (let i = 0; i < turns; i++) {
    messages.push({
      role: 'user',
      content: faker.lorem.sentence(),
      ...(selectiveMemory && i % 2 === 0 ? { memory: false } : {}),
    });
    
    if (i < turns - 1) {
      messages.push({
        role: 'assistant',
        content: faker.lorem.sentence(),
      });
    }
  }
  
  return messages;
}

// =============================================================================
// MEMORY CHUNK HELPERS
// =============================================================================

export interface TestMemoryChunk {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  model?: string;
  provider?: string;
  tokenCount: number;
}

export function createTestMemoryChunk(overrides: Partial<TestMemoryChunk> = {}): TestMemoryChunk {
  const content = faker.lorem.paragraph();
  return {
    id: `chunk_${faker.string.alphanumeric(16)}`,
    role: faker.helpers.arrayElement(['user', 'assistant']),
    content,
    timestamp: faker.date.recent(),
    model: 'openai/gpt-4',
    provider: 'openai',
    tokenCount: Math.ceil(content.length / 4),
    ...overrides,
  };
}

export function createTestMemoryChunks(
  count: number,
  options: {
    memoryKey?: string;
    timeSpan?: 'recent' | 'week' | 'month';
  } = {}
): TestMemoryChunk[] {
  const { timeSpan = 'recent' } = options;
  const chunks: TestMemoryChunk[] = [];
  
  const now = new Date();
  const timeRanges = {
    recent: { min: 0, max: 12 * 60 * 60 * 1000 }, // 0-12 hours
    week: { min: 0, max: 7 * 24 * 60 * 60 * 1000 }, // 0-7 days
    month: { min: 0, max: 30 * 24 * 60 * 60 * 1000 }, // 0-30 days
  };
  
  const range = timeRanges[timeSpan];
  
  for (let i = 0; i < count; i++) {
    const timestamp = new Date(
      now.getTime() - Math.random() * (range.max - range.min) - range.min
    );
    
    chunks.push(createTestMemoryChunk({ timestamp }));
  }
  
  return chunks.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

// =============================================================================
// USAGE HELPERS
// =============================================================================

export interface TestUsageRecord {
  id: string;
  memoryKeyId: string;
  model: string;
  provider: string;
  memoryTokensIn: number;
  memoryTokensOut: number;
  memoryTokensRetrieved: number;
  memoryTokensEphemeral: number;
  createdAt: Date;
}

export function createTestUsageRecord(
  memoryKeyId: string,
  overrides: Partial<TestUsageRecord> = {}
): TestUsageRecord {
  return {
    id: `usage_${faker.string.alphanumeric(16)}`,
    memoryKeyId,
    model: 'openai/gpt-4',
    provider: 'openai',
    memoryTokensIn: faker.number.int({ min: 100, max: 5000 }),
    memoryTokensOut: faker.number.int({ min: 50, max: 2000 }),
    memoryTokensRetrieved: faker.number.int({ min: 0, max: 3000 }),
    memoryTokensEphemeral: faker.number.int({ min: 0, max: 10000 }),
    createdAt: new Date(),
    ...overrides,
  };
}

// =============================================================================
// QUOTA HELPERS
// =============================================================================

export const FREE_TIER_TOKENS = 50_000_000; // 50M tokens

export interface TestQuota {
  usedTokens: number;
  quotaTokens: number;
  tier: 'free' | 'paid';
}

export function createTestQuota(overrides: Partial<TestQuota> = {}): TestQuota {
  return {
    usedTokens: 0,
    quotaTokens: FREE_TIER_TOKENS,
    tier: 'free',
    ...overrides,
  };
}

export function createQuotaAtLimit(): TestQuota {
  return {
    usedTokens: FREE_TIER_TOKENS,
    quotaTokens: FREE_TIER_TOKENS,
    tier: 'free',
  };
}

export function createQuotaExceeded(): TestQuota {
  return {
    usedTokens: FREE_TIER_TOKENS + 1000,
    quotaTokens: FREE_TIER_TOKENS,
    tier: 'free',
  };
}
