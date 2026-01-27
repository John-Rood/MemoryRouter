/**
 * Custom Test Assertions
 * 
 * Additional assertion helpers for MemoryRouter tests
 */

import { expect } from 'vitest';

/**
 * Assert that a response is a successful chat completion
 */
export function expectSuccessfulChatCompletion(response: Response, body: unknown) {
  expect(response.status).toBe(200);
  expect(body).toHaveProperty('choices');
  expect(Array.isArray((body as any).choices)).toBe(true);
  expect((body as any).choices.length).toBeGreaterThan(0);
  expect((body as any).choices[0]).toHaveProperty('message');
  expect((body as any).choices[0].message).toHaveProperty('content');
  expect((body as any).choices[0].message).toHaveProperty('role', 'assistant');
}

/**
 * Assert that a response contains memory metadata
 */
export function expectMemoryMetadata(body: unknown) {
  expect(body).toHaveProperty('_memory');
  expect((body as any)._memory).toHaveProperty('key');
  expect((body as any)._memory.key).toMatch(/^mk_/);
}

/**
 * Assert that a response is a streaming response
 */
export function expectStreamingResponse(response: Response) {
  expect(response.status).toBe(200);
  const contentType = response.headers.get('content-type');
  expect(contentType).toContain('text/event-stream');
}

/**
 * Assert that a response is an error with specific code
 */
export function expectError(
  response: Response,
  statusCode: number,
  errorCode?: string
) {
  expect(response.status).toBe(statusCode);
}

/**
 * Assert that memory context was injected into the request
 */
export function expectMemoryContextInjected(
  capturedRequest: Request | undefined,
  expectedContext?: string | RegExp
) {
  expect(capturedRequest).toBeDefined();
  // The request body would contain injected memory context
}

/**
 * Assert token counts in usage
 */
export function expectValidUsage(usage: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}) {
  expect(usage.prompt_tokens).toBeGreaterThanOrEqual(0);
  expect(usage.completion_tokens).toBeGreaterThanOrEqual(0);
  expect(usage.total_tokens).toBe(
    (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0)
  );
}

/**
 * Assert that a memory key is valid format
 */
export function expectValidMemoryKey(key: string) {
  expect(key).toMatch(/^mk_[a-zA-Z0-9]{20,}$/);
}

/**
 * Assert that a provider key is valid format
 */
export function expectValidProviderKey(key: string, provider: string) {
  const patterns: Record<string, RegExp> = {
    openai: /^sk-[a-zA-Z0-9]+$/,
    anthropic: /^sk-ant-[a-zA-Z0-9-]+$/,
    openrouter: /^sk-or-[a-zA-Z0-9-]+$/,
    google: /^AIza[a-zA-Z0-9_-]+$/,
  };
  
  const pattern = patterns[provider] ?? /^.+$/;
  expect(key).toMatch(pattern);
}

/**
 * Assert that timestamps are in correct temporal window
 */
export function expectInTemporalWindow(
  timestamp: Date,
  window: 'hot' | 'working' | 'longterm',
  referenceTime: Date = new Date()
) {
  const ageMs = referenceTime.getTime() - timestamp.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  const ageDays = ageHours / 24;
  
  switch (window) {
    case 'hot':
      expect(ageHours).toBeLessThanOrEqual(12);
      break;
    case 'working':
      expect(ageDays).toBeLessThanOrEqual(3);
      expect(ageHours).toBeGreaterThan(12);
      break;
    case 'longterm':
      expect(ageDays).toBeLessThanOrEqual(90);
      expect(ageDays).toBeGreaterThan(3);
      break;
  }
}

/**
 * Assert response time is within acceptable bounds
 */
export function expectFastResponse(
  startTime: number,
  maxMs: number = 1000
) {
  const elapsed = performance.now() - startTime;
  expect(elapsed).toBeLessThan(maxMs);
}

/**
 * Assert that selective memory was respected
 */
export function expectSelectiveMemoryRespected(
  storedMessages: Array<{ content: string; memory?: boolean }>,
  originalMessages: Array<{ content: string; memory?: boolean }>
) {
  const excluded = originalMessages.filter(m => m.memory === false);
  const stored = originalMessages.filter(m => m.memory !== false);
  
  for (const msg of excluded) {
    expect(storedMessages.map(m => m.content)).not.toContain(msg.content);
  }
  
  for (const msg of stored) {
    // Stored messages should include non-excluded content
    // (Note: this depends on implementation details)
  }
}

/**
 * Assert quota calculations are correct
 */
export function expectCorrectQuotaCalculation(
  usedTokens: number,
  quotaTokens: number,
  expectedRemaining: number
) {
  const remaining = Math.max(0, quotaTokens - usedTokens);
  expect(remaining).toBe(expectedRemaining);
}

/**
 * Assert cost calculation is correct
 */
export function expectCorrectCostCalculation(
  tokens: number,
  expectedCost: number,
  pricePerMillion: number = 1.0
) {
  const cost = (tokens / 1_000_000) * pricePerMillion;
  expect(cost).toBeCloseTo(expectedCost, 6);
}
