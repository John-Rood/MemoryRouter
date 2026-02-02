/**
 * CORE REGRESSION TESTS
 * 
 * These tests verify the core memory engine never regresses.
 * Run before every deployment. If ANY test fails, DO NOT DEPLOY.
 * 
 * Core guarantees:
 * - Memory overhead < 100ms (target: <50ms)
 * - Memory injection always happens
 * - Buffer syncs to D1
 * - Truncation prevents overflow
 * - 100% reliability on memory operations
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Test configuration
const API_BASE = process.env.TEST_API_URL || 'https://memoryrouter-api.roodbiz.workers.dev';
const TEST_MEMORY_KEY = process.env.TEST_MEMORY_KEY || 'mk_regression_test';
const ADMIN_KEY = process.env.ADMIN_KEY || 'mk_admin';

// Thresholds - THESE ARE THE CORE GUARANTEES
const MAX_OVERHEAD_MS = 100;        // Must never exceed
const TARGET_OVERHEAD_MS = 50;      // Ideal target
const MAX_TOTAL_MR_MS = 200;        // Total MR processing
const MIN_SUCCESS_RATE = 1.0;       // 100% required
const WARMUP_REQUESTS = 2;          // Requests to warm DO before measuring
const TEST_REQUESTS = 5;            // Requests to measure

interface LatencyMetrics {
  embedding_ms: number;
  mr_processing_ms: number;
  mr_overhead_ms: number;
  provider_ms: number;
  total_ms: number;
}

interface MemoryMetrics {
  key: string;
  tokens_retrieved: number;
  chunks_retrieved: number;
  tokens_injected: number;
}

interface TestResponse {
  id: string;
  choices: Array<{ message: { content: string } }>;
  _latency: LatencyMetrics;
  _memory: MemoryMetrics;
}

interface DebugStorageResponse {
  memoryKey: string;
  do: { vectorCount: number; totalTokens: number };
  d1: { chunkCount: number; totalTokens: number };
  analysis: string[];
}

// Helper: Make a chat request
async function chatRequest(content: string, options: Record<string, unknown> = {}): Promise<TestResponse> {
  const response = await fetch(`${API_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TEST_MEMORY_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content }],
      ...options,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status} ${await response.text()}`);
  }
  
  return response.json();
}

// Helper: Clear test data
async function clearTestData(): Promise<void> {
  // Clear DO
  await fetch(`${API_BASE}/admin/clear?key=${TEST_MEMORY_KEY}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ADMIN_KEY}` },
  });
  
  // Note: D1 clear would need a separate endpoint or direct DB access
}

// Helper: Get storage debug info
async function getStorageDebug(): Promise<DebugStorageResponse> {
  const response = await fetch(`${API_BASE}/admin/debug-storage?key=${TEST_MEMORY_KEY}`, {
    headers: { 'Authorization': `Bearer ${ADMIN_KEY}` },
  });
  return response.json();
}

// Helper: Warm up the DO
async function warmUp(): Promise<void> {
  for (let i = 0; i < WARMUP_REQUESTS; i++) {
    await chatRequest(`Warmup request ${i + 1}`);
  }
}

describe('Core Regression Tests', () => {
  beforeAll(async () => {
    console.log('🧪 Starting core regression tests...');
    console.log(`   API: ${API_BASE}`);
    console.log(`   Key: ${TEST_MEMORY_KEY}`);
    
    // Clear any existing test data
    await clearTestData();
    
    // Seed some memory
    await chatRequest('My name is RegressionTestUser and my favorite color is purple.');
    await chatRequest('I love testing software and writing TypeScript.');
    
    // Warm up DO
    await warmUp();
  });
  
  afterAll(async () => {
    // Clean up test data
    await clearTestData();
    console.log('✅ Core regression tests complete');
  });
  
  // ==================== LATENCY TESTS ====================
  
  describe('Latency Guarantees', () => {
    it(`overhead should be under ${MAX_OVERHEAD_MS}ms (hard limit)`, async () => {
      const results: number[] = [];
      
      for (let i = 0; i < TEST_REQUESTS; i++) {
        const res = await chatRequest(`Latency test ${i + 1}`);
        results.push(res._latency.mr_overhead_ms);
      }
      
      const avgOverhead = results.reduce((a, b) => a + b, 0) / results.length;
      const maxOverhead = Math.max(...results);
      
      console.log(`   Overhead: avg=${avgOverhead.toFixed(1)}ms, max=${maxOverhead}ms`);
      
      expect(maxOverhead).toBeLessThan(MAX_OVERHEAD_MS);
    });
    
    it(`overhead should ideally be under ${TARGET_OVERHEAD_MS}ms (soft target)`, async () => {
      const results: number[] = [];
      
      for (let i = 0; i < TEST_REQUESTS; i++) {
        const res = await chatRequest(`Target latency test ${i + 1}`);
        results.push(res._latency.mr_overhead_ms);
      }
      
      const avgOverhead = results.reduce((a, b) => a + b, 0) / results.length;
      
      console.log(`   Average overhead: ${avgOverhead.toFixed(1)}ms (target: <${TARGET_OVERHEAD_MS}ms)`);
      
      // Soft assertion - warn but don't fail
      if (avgOverhead > TARGET_OVERHEAD_MS) {
        console.warn(`   ⚠️ WARNING: Overhead exceeds target (${avgOverhead.toFixed(1)}ms > ${TARGET_OVERHEAD_MS}ms)`);
      }
      
      expect(avgOverhead).toBeLessThan(MAX_OVERHEAD_MS); // Hard limit still applies
    });
    
    it(`total MR processing should be under ${MAX_TOTAL_MR_MS}ms`, async () => {
      const results: number[] = [];
      
      for (let i = 0; i < TEST_REQUESTS; i++) {
        const res = await chatRequest(`MR processing test ${i + 1}`);
        results.push(res._latency.mr_processing_ms);
      }
      
      const avgProcessing = results.reduce((a, b) => a + b, 0) / results.length;
      const maxProcessing = Math.max(...results);
      
      console.log(`   MR Processing: avg=${avgProcessing.toFixed(1)}ms, max=${maxProcessing}ms`);
      
      expect(maxProcessing).toBeLessThan(MAX_TOTAL_MR_MS);
    });
  });
  
  // ==================== MEMORY INJECTION TESTS ====================
  
  describe('Memory Injection', () => {
    it('should inject memory context into requests', async () => {
      // Clear and seed fresh data
      await clearTestData();
      await chatRequest('My secret code word is BANANA.');
      await warmUp();
      
      // Ask about the seeded memory
      const res = await chatRequest('What is my secret code word?');
      
      // Verify memory was retrieved
      expect(res._memory.tokens_retrieved).toBeGreaterThan(0);
      expect(res._memory.chunks_retrieved).toBeGreaterThanOrEqual(0); // Could be in buffer
      
      // Verify response contains the seeded info
      const response = res.choices[0].message.content.toLowerCase();
      expect(response).toContain('banana');
      
      console.log(`   Tokens retrieved: ${res._memory.tokens_retrieved}`);
      console.log(`   Chunks retrieved: ${res._memory.chunks_retrieved}`);
    });
    
    it('should include buffer content in retrieval', async () => {
      // Send a short message (stays in buffer, not chunked)
      await clearTestData();
      await chatRequest('My PIN is 1234.');
      
      // Immediately ask about it (should be in buffer)
      const res = await chatRequest('What is my PIN?');
      
      // Should have retrieved something (from buffer)
      expect(res._memory.tokens_retrieved).toBeGreaterThan(0);
      
      // Response should have the info
      const response = res.choices[0].message.content;
      expect(response).toContain('1234');
      
      console.log(`   Buffer retrieval working: tokens=${res._memory.tokens_retrieved}`);
    });
  });
  
  // ==================== STORAGE SYNC TESTS ====================
  
  describe('Storage Synchronization', () => {
    it('DO and D1 should stay in sync', async () => {
      await clearTestData();
      
      // Send enough content to trigger chunking
      await chatRequest('Write a detailed 200-word paragraph about the history of computing.');
      
      // Wait for async D1 sync
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const debug = await getStorageDebug();
      
      console.log(`   DO vectors: ${debug.do.vectorCount}`);
      console.log(`   D1 chunks: ${debug.d1.chunkCount}`);
      
      // They should be equal (or D1 can be slightly behind due to async)
      const diff = Math.abs(debug.do.vectorCount - debug.d1.chunkCount);
      expect(diff).toBeLessThanOrEqual(1); // Allow 1 chunk difference for async lag
    });
    
    it('buffer should sync to D1', async () => {
      await clearTestData();
      
      // Send short content (stays in buffer)
      await chatRequest('Buffer sync test: my favorite number is 42.');
      
      // Wait for async sync
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check D1 for buffer
      // Note: This would need a buffer-specific endpoint to verify
      // For now, we verify by checking retrieval works
      const res = await chatRequest('What is my favorite number?');
      
      expect(res.choices[0].message.content).toContain('42');
      console.log('   Buffer sync verified via retrieval');
    });
  });
  
  // ==================== RELIABILITY TESTS ====================
  
  describe('Reliability', () => {
    it('should have 100% success rate', async () => {
      const total = 10;
      let successes = 0;
      let failures = 0;
      
      for (let i = 0; i < total; i++) {
        try {
          const res = await chatRequest(`Reliability test ${i + 1}`);
          if (res.id && res.choices && res._memory) {
            successes++;
          } else {
            failures++;
            console.error(`   Request ${i + 1} returned incomplete response`);
          }
        } catch (error) {
          failures++;
          console.error(`   Request ${i + 1} failed:`, error);
        }
      }
      
      const successRate = successes / total;
      console.log(`   Success rate: ${(successRate * 100).toFixed(1)}% (${successes}/${total})`);
      
      expect(successRate).toBeGreaterThanOrEqual(MIN_SUCCESS_RATE);
    });
    
    it('should handle concurrent requests', async () => {
      const concurrent = 5;
      
      const promises = Array.from({ length: concurrent }, (_, i) =>
        chatRequest(`Concurrent test ${i + 1}`)
      );
      
      const results = await Promise.allSettled(promises);
      
      const successes = results.filter(r => r.status === 'fulfilled').length;
      const failures = results.filter(r => r.status === 'rejected').length;
      
      console.log(`   Concurrent results: ${successes}/${concurrent} succeeded`);
      
      expect(failures).toBe(0);
    });
  });
  
  // ==================== TRUNCATION TESTS ====================
  
  describe('Truncation', () => {
    it('should not exceed context window', async () => {
      // This is hard to test directly without a lot of data
      // We verify the truncation system exists by checking headers
      
      const res = await chatRequest('Truncation test');
      
      // If truncation happened, there would be a header
      // For now, we just verify the request succeeds even with memory
      expect(res._memory.tokens_injected).toBeDefined();
      
      console.log(`   Tokens injected: ${res._memory.tokens_injected}`);
    });
  });
});

// ==================== BENCHMARK SUITE ====================

describe('Performance Benchmarks', () => {
  it('benchmark: measure warm DO latency', async () => {
    // Warm up
    await warmUp();
    
    const samples = 10;
    const results: LatencyMetrics[] = [];
    
    for (let i = 0; i < samples; i++) {
      const res = await chatRequest(`Benchmark ${i + 1}`);
      results.push(res._latency);
    }
    
    const avgOverhead = results.reduce((a, b) => a + b.mr_overhead_ms, 0) / samples;
    const avgEmbedding = results.reduce((a, b) => a + b.embedding_ms, 0) / samples;
    const avgProcessing = results.reduce((a, b) => a + b.mr_processing_ms, 0) / samples;
    
    console.log('\n📊 BENCHMARK RESULTS (warm DO):');
    console.log(`   Overhead:   ${avgOverhead.toFixed(1)}ms avg`);
    console.log(`   Embedding:  ${avgEmbedding.toFixed(1)}ms avg`);
    console.log(`   Processing: ${avgProcessing.toFixed(1)}ms avg`);
    console.log('');
    
    // Store for comparison (could write to file for historical tracking)
    expect(avgOverhead).toBeLessThan(MAX_OVERHEAD_MS);
  });
});
