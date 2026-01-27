/**
 * Integration Tests: KRONOS Temporal Queries
 * 
 * Tests the temporal memory retrieval and query handling
 * for time-based memory access.
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import { temporalData } from '../fixtures';

// =============================================================================
// TEMPORAL MEMORY SERVICE
// =============================================================================

interface TemporalChunk {
  id: string;
  memoryKey: string;
  content: string;
  timestamp: Date;
  metadata: {
    role: 'user' | 'assistant';
    model: string;
    provider: string;
  };
}

type TemporalWindow = 'HOT' | 'WORKING' | 'LONG_TERM' | 'EXPIRED';

const TEMPORAL_WINDOWS = {
  HOT: 12 * 60 * 60 * 1000,      // 12 hours
  WORKING: 3 * 24 * 60 * 60 * 1000, // 3 days
  LONG_TERM: 90 * 24 * 60 * 60 * 1000, // 90 days
};

class MockTemporalMemoryService {
  private chunks: TemporalChunk[] = [];
  private idCounter = 1;
  private referenceTime: Date = new Date();

  setReferenceTime(time: Date): void {
    this.referenceTime = time;
  }

  getWindow(timestamp: Date): TemporalWindow {
    const ageMs = this.referenceTime.getTime() - timestamp.getTime();
    
    if (ageMs <= TEMPORAL_WINDOWS.HOT) return 'HOT';
    if (ageMs <= TEMPORAL_WINDOWS.WORKING) return 'WORKING';
    if (ageMs <= TEMPORAL_WINDOWS.LONG_TERM) return 'LONG_TERM';
    return 'EXPIRED';
  }

  async store(
    memoryKey: string,
    content: string,
    timestamp: Date,
    metadata: TemporalChunk['metadata']
  ): Promise<string> {
    const id = `chunk_${this.idCounter++}`;
    this.chunks.push({ id, memoryKey, content, timestamp, metadata });
    return id;
  }

  async retrieveByWindow(
    memoryKey: string,
    window: TemporalWindow,
    options: { limit?: number } = {}
  ): Promise<TemporalChunk[]> {
    const { limit = 12 } = options;
    
    return this.chunks
      .filter(c => c.memoryKey === memoryKey && this.getWindow(c.timestamp) === window)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  async retrieveByTimeRange(
    memoryKey: string,
    startDate: Date,
    endDate: Date,
    options: { limit?: number } = {}
  ): Promise<TemporalChunk[]> {
    const { limit = 24 } = options;
    
    return this.chunks
      .filter(c => 
        c.memoryKey === memoryKey &&
        c.timestamp >= startDate &&
        c.timestamp <= endDate
      )
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  async retrieveRecent(
    memoryKey: string,
    options: { limit?: number } = {}
  ): Promise<TemporalChunk[]> {
    const { limit = 12 } = options;
    
    return this.chunks
      .filter(c => 
        c.memoryKey === memoryKey &&
        this.getWindow(c.timestamp) !== 'EXPIRED'
      )
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  async retrieveByAllocation(
    memoryKey: string,
    allocation: { HOT: number; WORKING: number; LONG_TERM: number }
  ): Promise<TemporalChunk[]> {
    const results: TemporalChunk[] = [];
    
    for (const [window, count] of Object.entries(allocation)) {
      if (count > 0) {
        const chunks = await this.retrieveByWindow(
          memoryKey,
          window as TemporalWindow,
          { limit: count }
        );
        results.push(...chunks);
      }
    }
    
    return results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  _clear(): void {
    this.chunks = [];
    this.idCounter = 1;
  }

  _getChunks(): TemporalChunk[] {
    return [...this.chunks];
  }
}

// =============================================================================
// TESTS
// =============================================================================

describe('KRONOS Temporal Queries', () => {
  let service: MockTemporalMemoryService;
  const memoryKey = 'mk_temporal_test';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-25T12:00:00Z'));
    
    service = new MockTemporalMemoryService();
    service.setReferenceTime(new Date('2026-01-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Temporal window classification', () => {
    it('classifies recent memory as HOT', async () => {
      const timestamp = new Date('2026-01-25T08:00:00Z'); // 4 hours ago
      
      await service.store(memoryKey, 'Recent message', timestamp, {
        role: 'user',
        model: 'gpt-4',
        provider: 'openai',
      });

      const hotChunks = await service.retrieveByWindow(memoryKey, 'HOT');
      expect(hotChunks).toHaveLength(1);
      expect(hotChunks[0].content).toBe('Recent message');
    });

    it('classifies day-old memory as WORKING', async () => {
      const timestamp = new Date('2026-01-24T12:00:00Z'); // 24 hours ago
      
      await service.store(memoryKey, 'Yesterday message', timestamp, {
        role: 'user',
        model: 'gpt-4',
        provider: 'openai',
      });

      const workingChunks = await service.retrieveByWindow(memoryKey, 'WORKING');
      expect(workingChunks).toHaveLength(1);
    });

    it('classifies week-old memory as LONG_TERM', async () => {
      const timestamp = new Date('2026-01-18T12:00:00Z'); // 7 days ago
      
      await service.store(memoryKey, 'Last week message', timestamp, {
        role: 'user',
        model: 'gpt-4',
        provider: 'openai',
      });

      const longTermChunks = await service.retrieveByWindow(memoryKey, 'LONG_TERM');
      expect(longTermChunks).toHaveLength(1);
    });

    it('classifies 100-day-old memory as EXPIRED', async () => {
      const timestamp = new Date('2025-10-17T12:00:00Z'); // 100 days ago
      
      await service.store(memoryKey, 'Very old message', timestamp, {
        role: 'user',
        model: 'gpt-4',
        provider: 'openai',
      });

      const expiredChunks = await service.retrieveByWindow(memoryKey, 'EXPIRED');
      expect(expiredChunks).toHaveLength(1);
    });
  });

  describe('Temporal allocation retrieval', () => {
    beforeEach(async () => {
      // Seed data across all windows
      const now = new Date('2026-01-25T12:00:00Z');
      
      // HOT (< 12h)
      for (let i = 0; i < 5; i++) {
        await service.store(
          memoryKey,
          `Hot message ${i + 1}`,
          new Date(now.getTime() - i * 60 * 60 * 1000), // i hours ago
          { role: 'user', model: 'gpt-4', provider: 'openai' }
        );
      }
      
      // WORKING (12h - 3d)
      for (let i = 0; i < 5; i++) {
        await service.store(
          memoryKey,
          `Working message ${i + 1}`,
          new Date(now.getTime() - (24 + i * 12) * 60 * 60 * 1000),
          { role: 'user', model: 'gpt-4', provider: 'openai' }
        );
      }
      
      // LONG_TERM (3d - 90d)
      for (let i = 0; i < 5; i++) {
        await service.store(
          memoryKey,
          `Long-term message ${i + 1}`,
          new Date(now.getTime() - (7 + i * 7) * 24 * 60 * 60 * 1000),
          { role: 'user', model: 'gpt-4', provider: 'openai' }
        );
      }
    });

    it('retrieves allocated chunks from each window', async () => {
      const chunks = await service.retrieveByAllocation(memoryKey, {
        HOT: 2,
        WORKING: 2,
        LONG_TERM: 2,
      });

      expect(chunks).toHaveLength(6);
      
      // Should have mix from all windows
      const contents = chunks.map(c => c.content);
      expect(contents.some(c => c.includes('Hot'))).toBe(true);
      expect(contents.some(c => c.includes('Working'))).toBe(true);
      expect(contents.some(c => c.includes('Long-term'))).toBe(true);
    });

    it('respects allocation counts', async () => {
      const chunks = await service.retrieveByAllocation(memoryKey, {
        HOT: 3,
        WORKING: 1,
        LONG_TERM: 1,
      });

      const hotCount = chunks.filter(c => c.content.includes('Hot')).length;
      const workingCount = chunks.filter(c => c.content.includes('Working')).length;
      const longTermCount = chunks.filter(c => c.content.includes('Long-term')).length;

      expect(hotCount).toBe(3);
      expect(workingCount).toBe(1);
      expect(longTermCount).toBe(1);
    });

    it('handles zero allocation for a window', async () => {
      const chunks = await service.retrieveByAllocation(memoryKey, {
        HOT: 4,
        WORKING: 0,
        LONG_TERM: 2,
      });

      const workingCount = chunks.filter(c => c.content.includes('Working')).length;
      expect(workingCount).toBe(0);
    });
  });

  describe('Time range queries', () => {
    beforeEach(async () => {
      // Seed specific dates
      await service.store(memoryKey, 'January 20th message', new Date('2026-01-20T14:00:00Z'), {
        role: 'user', model: 'gpt-4', provider: 'openai',
      });
      
      await service.store(memoryKey, 'January 21st message', new Date('2026-01-21T10:00:00Z'), {
        role: 'user', model: 'gpt-4', provider: 'openai',
      });
      
      await service.store(memoryKey, 'January 22nd message', new Date('2026-01-22T16:00:00Z'), {
        role: 'user', model: 'gpt-4', provider: 'openai',
      });
      
      await service.store(memoryKey, 'January 24th message', new Date('2026-01-24T09:00:00Z'), {
        role: 'user', model: 'gpt-4', provider: 'openai',
      });
    });

    it('retrieves messages within date range', async () => {
      const chunks = await service.retrieveByTimeRange(
        memoryKey,
        new Date('2026-01-21T00:00:00Z'),
        new Date('2026-01-22T23:59:59Z')
      );

      expect(chunks).toHaveLength(2);
      expect(chunks.map(c => c.content)).toContain('January 21st message');
      expect(chunks.map(c => c.content)).toContain('January 22nd message');
    });

    it('returns empty for range with no messages', async () => {
      const chunks = await service.retrieveByTimeRange(
        memoryKey,
        new Date('2026-01-10T00:00:00Z'),
        new Date('2026-01-15T23:59:59Z')
      );

      expect(chunks).toHaveLength(0);
    });

    it('handles single-day range', async () => {
      const chunks = await service.retrieveByTimeRange(
        memoryKey,
        new Date('2026-01-21T00:00:00Z'),
        new Date('2026-01-21T23:59:59Z')
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe('January 21st message');
    });

    it('respects limit in time range query', async () => {
      const chunks = await service.retrieveByTimeRange(
        memoryKey,
        new Date('2026-01-20T00:00:00Z'),
        new Date('2026-01-25T00:00:00Z'),
        { limit: 2 }
      );

      expect(chunks).toHaveLength(2);
    });
  });

  describe('Temporal query patterns', () => {
    beforeEach(async () => {
      // Seed varied content
      const now = new Date('2026-01-25T12:00:00Z');
      
      await service.store(memoryKey, 'My favorite color is blue', 
        new Date(now.getTime() - 2 * 60 * 60 * 1000),
        { role: 'user', model: 'gpt-4', provider: 'openai' }
      );
      
      await service.store(memoryKey, 'Working on MemoryRouter project',
        new Date(now.getTime() - 24 * 60 * 60 * 1000),
        { role: 'user', model: 'gpt-4', provider: 'openai' }
      );
      
      await service.store(memoryKey, 'Started learning Rust last week',
        new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        { role: 'user', model: 'gpt-4', provider: 'openai' }
      );
    });

    it('answers "what did I say earlier today"', async () => {
      const hotChunks = await service.retrieveByWindow(memoryKey, 'HOT');
      
      expect(hotChunks.length).toBeGreaterThan(0);
      expect(hotChunks.some(c => c.content.includes('blue'))).toBe(true);
    });

    it('answers "what did I mention yesterday"', async () => {
      const yesterday = new Date('2026-01-24T00:00:00Z');
      const endOfYesterday = new Date('2026-01-24T23:59:59Z');
      
      const chunks = await service.retrieveByTimeRange(memoryKey, yesterday, endOfYesterday);
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.content.includes('MemoryRouter'))).toBe(true);
    });

    it('answers "what did I say last week"', async () => {
      const weekAgo = new Date('2026-01-18T00:00:00Z');
      const now = new Date('2026-01-25T12:00:00Z');
      
      const chunks = await service.retrieveByTimeRange(memoryKey, weekAgo, now, { limit: 10 });
      
      expect(chunks.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Expired memory handling', () => {
    it('excludes expired memory from recent retrieval', async () => {
      const now = new Date('2026-01-25T12:00:00Z');
      
      // Add expired message (100 days ago)
      await service.store(
        memoryKey,
        'Very old expired message',
        new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000),
        { role: 'user', model: 'gpt-4', provider: 'openai' }
      );
      
      // Add recent message
      await service.store(
        memoryKey,
        'Recent message',
        new Date(now.getTime() - 60 * 60 * 1000),
        { role: 'user', model: 'gpt-4', provider: 'openai' }
      );

      const recentChunks = await service.retrieveRecent(memoryKey);
      
      expect(recentChunks.every(c => !c.content.includes('expired'))).toBe(true);
      expect(recentChunks.some(c => c.content.includes('Recent'))).toBe(true);
    });

    it('can still retrieve expired memory explicitly', async () => {
      const now = new Date('2026-01-25T12:00:00Z');
      
      await service.store(
        memoryKey,
        'Archived message',
        new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000),
        { role: 'user', model: 'gpt-4', provider: 'openai' }
      );

      const expiredChunks = await service.retrieveByWindow(memoryKey, 'EXPIRED');
      
      expect(expiredChunks).toHaveLength(1);
      expect(expiredChunks[0].content).toBe('Archived message');
    });
  });

  describe('Memory key isolation', () => {
    it('temporal queries are isolated by memory key', async () => {
      const key1 = 'mk_user_alice';
      const key2 = 'mk_user_bob';
      const now = new Date('2026-01-25T12:00:00Z');
      
      await service.store(key1, 'Alice secret', now, {
        role: 'user', model: 'gpt-4', provider: 'openai',
      });
      
      await service.store(key2, 'Bob secret', now, {
        role: 'user', model: 'gpt-4', provider: 'openai',
      });

      const aliceChunks = await service.retrieveRecent(key1);
      const bobChunks = await service.retrieveRecent(key2);

      expect(aliceChunks.every(c => !c.content.includes('Bob'))).toBe(true);
      expect(bobChunks.every(c => !c.content.includes('Alice'))).toBe(true);
    });
  });
});
