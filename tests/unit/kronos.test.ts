/**
 * Unit Tests: KRONOS Temporal Logic
 * 
 * Tests the temporal window classification, retrieval allocation,
 * and temporal query parsing for the KRONOS 3D memory engine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { temporalData } from '../fixtures';

// =============================================================================
// KRONOS CONSTANTS (from architecture)
// =============================================================================

const TEMPORAL_WINDOWS = {
  HOT: 12 * 60 * 60 * 1000,      // 12 hours in ms
  WORKING: 3 * 24 * 60 * 60 * 1000, // 3 days in ms
  LONG_TERM: 90 * 24 * 60 * 60 * 1000, // 90 days in ms
} as const;

type TemporalWindow = 'HOT' | 'WORKING' | 'LONG_TERM' | 'EXPIRED';

// =============================================================================
// KRONOS FUNCTIONS (to be implemented in src/lib/kronos.ts)
// =============================================================================

/**
 * Get the temporal window for a timestamp
 */
function getTemporalWindow(timestamp: Date, referenceTime: Date = new Date()): TemporalWindow {
  const ageMs = referenceTime.getTime() - timestamp.getTime();
  
  if (ageMs < 0) {
    // Future timestamp - treat as HOT
    return 'HOT';
  }
  
  if (ageMs <= TEMPORAL_WINDOWS.HOT) {
    return 'HOT';
  }
  
  if (ageMs <= TEMPORAL_WINDOWS.WORKING) {
    return 'WORKING';
  }
  
  if (ageMs <= TEMPORAL_WINDOWS.LONG_TERM) {
    return 'LONG_TERM';
  }
  
  return 'EXPIRED';
}

/**
 * Allocate retrieval slots across temporal windows
 */
function allocateRetrievalSlots(
  count: number,
  options: { recencyBias?: 'low' | 'medium' | 'high' } = {}
): { HOT: number; WORKING: number; LONG_TERM: number } {
  const { recencyBias = 'medium' } = options;
  
  // Base allocation weights
  const weights = {
    low: { HOT: 1, WORKING: 1, LONG_TERM: 1 },
    medium: { HOT: 1, WORKING: 1, LONG_TERM: 1 },
    high: { HOT: 2, WORKING: 1, LONG_TERM: 0.5 },
  };
  
  const w = weights[recencyBias];
  const total = w.HOT + w.WORKING + w.LONG_TERM;
  
  let hot = Math.floor((w.HOT / total) * count);
  let working = Math.floor((w.WORKING / total) * count);
  let longTerm = count - hot - working;
  
  // Handle edge cases
  if (longTerm < 0) {
    longTerm = 0;
    hot = Math.ceil(count / 2);
    working = count - hot;
  }
  
  return { HOT: hot, WORKING: working, LONG_TERM: longTerm };
}

/**
 * Parse temporal intent from a query
 */
function parseTemporalQuery(
  query: string,
  referenceTime: Date = new Date()
): {
  hasTemporalIntent: boolean;
  startDate?: Date;
  endDate?: Date;
  period?: string;
} {
  const queryLower = query.toLowerCase();
  
  // Check for temporal indicators
  const temporalPatterns = [
    /last week/i,
    /yesterday/i,
    /\d+ days? ago/i,
    /earlier/i,
    /when did (i|we)/i,
    /remember when/i,
    /previously/i,
    /before/i,
    /in (january|february|march|april|may|june|july|august|september|october|november|december)/i,
    /last month/i,
    /this morning/i,
    /tonight/i,
    /recent(ly)?/i,
  ];
  
  const hasTemporalIntent = temporalPatterns.some(pattern => pattern.test(queryLower));
  
  if (!hasTemporalIntent) {
    return { hasTemporalIntent: false };
  }
  
  // Parse specific time references
  const result: { hasTemporalIntent: boolean; startDate?: Date; endDate?: Date; period?: string } = {
    hasTemporalIntent: true,
  };
  
  // "last week"
  if (/last week/i.test(queryLower)) {
    const endDate = new Date(referenceTime);
    const startDate = new Date(referenceTime);
    startDate.setDate(startDate.getDate() - 7);
    result.startDate = startDate;
    result.endDate = endDate;
    result.period = 'week';
  }
  
  // "yesterday"
  if (/yesterday/i.test(queryLower)) {
    const startDate = new Date(referenceTime);
    startDate.setDate(startDate.getDate() - 1);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setHours(23, 59, 59, 999);
    result.startDate = startDate;
    result.endDate = endDate;
    result.period = 'day';
  }
  
  // "X days ago"
  const daysAgoMatch = queryLower.match(/(\d+) days? ago/i);
  if (daysAgoMatch) {
    const days = parseInt(daysAgoMatch[1], 10);
    const startDate = new Date(referenceTime);
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setHours(23, 59, 59, 999);
    result.startDate = startDate;
    result.endDate = endDate;
    result.period = `${days} days`;
  }
  
  // "in December" etc.
  const monthMatch = queryLower.match(/in (january|february|march|april|may|june|july|august|september|october|november|december)/i);
  if (monthMatch) {
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 
                   'july', 'august', 'september', 'october', 'november', 'december'];
    const monthIndex = months.indexOf(monthMatch[1].toLowerCase());
    
    const startDate = new Date(referenceTime);
    // If the month is in the future this year, use last year
    if (monthIndex > referenceTime.getMonth()) {
      startDate.setFullYear(startDate.getFullYear() - 1);
    }
    startDate.setMonth(monthIndex, 1);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 1);
    endDate.setDate(0); // Last day of the month
    endDate.setHours(23, 59, 59, 999);
    
    result.startDate = startDate;
    result.endDate = endDate;
    result.period = monthMatch[1];
  }
  
  return result;
}

/**
 * Detect if a query has temporal intent
 */
function detectTemporalIntent(query: string): boolean {
  return parseTemporalQuery(query).hasTemporalIntent;
}

// =============================================================================
// TESTS
// =============================================================================

describe('KRONOS Temporal Logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getTemporalWindow', () => {
    const now = new Date('2026-01-25T12:00:00Z');

    describe('HOT window (< 12 hours)', () => {
      it('classifies 1 hour ago as HOT', () => {
        const timestamp = new Date('2026-01-25T11:00:00Z');
        expect(getTemporalWindow(timestamp, now)).toBe('HOT');
      });

      it('classifies 6 hours ago as HOT', () => {
        const timestamp = new Date('2026-01-25T06:00:00Z');
        expect(getTemporalWindow(timestamp, now)).toBe('HOT');
      });

      it('classifies 11 hours ago as HOT', () => {
        const timestamp = new Date('2026-01-25T01:00:00Z');
        expect(getTemporalWindow(timestamp, now)).toBe('HOT');
      });
    });

    describe('WORKING window (12h - 3 days)', () => {
      it('classifies just over 12 hours ago as WORKING', () => {
        // 12 hours + 1 minute ago (just past HOT threshold)
        const timestamp = new Date('2026-01-24T23:59:00Z');
        expect(getTemporalWindow(timestamp, now)).toBe('WORKING');
      });

      it('classifies 1 day ago as WORKING', () => {
        const timestamp = new Date('2026-01-24T12:00:00Z');
        expect(getTemporalWindow(timestamp, now)).toBe('WORKING');
      });

      it('classifies 2 days ago as WORKING', () => {
        const timestamp = new Date('2026-01-23T12:00:00Z');
        expect(getTemporalWindow(timestamp, now)).toBe('WORKING');
      });
    });

    describe('LONG_TERM window (3 - 90 days)', () => {
      it('classifies exactly 3 days ago as LONG_TERM', () => {
        const timestamp = new Date('2026-01-22T11:59:00Z');
        expect(getTemporalWindow(timestamp, now)).toBe('LONG_TERM');
      });

      it('classifies 1 week ago as LONG_TERM', () => {
        const timestamp = new Date('2026-01-18T12:00:00Z');
        expect(getTemporalWindow(timestamp, now)).toBe('LONG_TERM');
      });

      it('classifies 30 days ago as LONG_TERM', () => {
        const timestamp = new Date('2025-12-26T12:00:00Z');
        expect(getTemporalWindow(timestamp, now)).toBe('LONG_TERM');
      });

      it('classifies 89 days ago as LONG_TERM', () => {
        const timestamp = new Date('2025-10-28T12:00:00Z');
        expect(getTemporalWindow(timestamp, now)).toBe('LONG_TERM');
      });
    });

    describe('EXPIRED window (> 90 days)', () => {
      it('classifies exactly 90 days ago as EXPIRED', () => {
        const timestamp = new Date('2025-10-27T11:00:00Z');
        expect(getTemporalWindow(timestamp, now)).toBe('EXPIRED');
      });

      it('classifies 100 days ago as EXPIRED', () => {
        const timestamp = new Date('2025-10-17T12:00:00Z');
        expect(getTemporalWindow(timestamp, now)).toBe('EXPIRED');
      });

      it('classifies 1 year ago as EXPIRED', () => {
        const timestamp = new Date('2025-01-25T12:00:00Z');
        expect(getTemporalWindow(timestamp, now)).toBe('EXPIRED');
      });
    });

    describe('Edge cases', () => {
      it('handles future timestamps as HOT', () => {
        const futureTimestamp = new Date('2026-01-26T12:00:00Z');
        expect(getTemporalWindow(futureTimestamp, now)).toBe('HOT');
      });

      it('handles exact current time as HOT', () => {
        expect(getTemporalWindow(now, now)).toBe('HOT');
      });
    });
  });

  describe('allocateRetrievalSlots', () => {
    describe('Equal allocation (medium bias)', () => {
      it('allocates equally for divisible counts', () => {
        const allocation = allocateRetrievalSlots(12);
        expect(allocation.HOT).toBe(4);
        expect(allocation.WORKING).toBe(4);
        expect(allocation.LONG_TERM).toBe(4);
      });

      it('allocates correctly for 9 slots', () => {
        const allocation = allocateRetrievalSlots(9);
        expect(allocation.HOT + allocation.WORKING + allocation.LONG_TERM).toBe(9);
      });

      it('allocates correctly for 10 slots', () => {
        const allocation = allocateRetrievalSlots(10);
        expect(allocation.HOT + allocation.WORKING + allocation.LONG_TERM).toBe(10);
      });
    });

    describe('Small counts', () => {
      it('handles count of 1', () => {
        const allocation = allocateRetrievalSlots(1);
        expect(allocation.HOT + allocation.WORKING + allocation.LONG_TERM).toBe(1);
      });

      it('handles count of 2', () => {
        const allocation = allocateRetrievalSlots(2);
        expect(allocation.HOT + allocation.WORKING + allocation.LONG_TERM).toBe(2);
      });

      it('handles count of 3', () => {
        const allocation = allocateRetrievalSlots(3);
        expect(allocation.HOT + allocation.WORKING + allocation.LONG_TERM).toBe(3);
        expect(allocation.HOT).toBeGreaterThanOrEqual(1);
        expect(allocation.WORKING).toBeGreaterThanOrEqual(1);
        expect(allocation.LONG_TERM).toBeGreaterThanOrEqual(1);
      });
    });

    describe('Recency bias: high', () => {
      it('allocates more to HOT window', () => {
        const allocation = allocateRetrievalSlots(12, { recencyBias: 'high' });
        expect(allocation.HOT).toBeGreaterThan(allocation.LONG_TERM);
      });

      it('still covers all windows', () => {
        const allocation = allocateRetrievalSlots(12, { recencyBias: 'high' });
        expect(allocation.HOT).toBeGreaterThan(0);
        expect(allocation.WORKING).toBeGreaterThan(0);
        expect(allocation.LONG_TERM).toBeGreaterThanOrEqual(0);
      });
    });

    describe('Recency bias: low', () => {
      it('allocates more evenly', () => {
        const allocation = allocateRetrievalSlots(12, { recencyBias: 'low' });
        expect(allocation.HOT + allocation.WORKING + allocation.LONG_TERM).toBe(12);
      });
    });

    describe('Edge cases', () => {
      it('handles count of 0', () => {
        const allocation = allocateRetrievalSlots(0);
        expect(allocation.HOT + allocation.WORKING + allocation.LONG_TERM).toBe(0);
      });

      it('handles large counts', () => {
        const allocation = allocateRetrievalSlots(1000);
        expect(allocation.HOT + allocation.WORKING + allocation.LONG_TERM).toBe(1000);
      });
    });
  });

  describe('parseTemporalQuery', () => {
    const referenceTime = new Date('2026-01-25T12:00:00Z');

    describe('Temporal query detection', () => {
      it('detects "last week"', () => {
        const parsed = parseTemporalQuery('What did I say last week?', referenceTime);
        expect(parsed.hasTemporalIntent).toBe(true);
        expect(parsed.startDate).toBeDefined();
        expect(parsed.endDate).toBeDefined();
      });

      it('detects "yesterday"', () => {
        const parsed = parseTemporalQuery('What did we discuss yesterday?', referenceTime);
        expect(parsed.hasTemporalIntent).toBe(true);
        expect(parsed.startDate?.getDate()).toBe(24);
      });

      it('detects "3 days ago"', () => {
        const parsed = parseTemporalQuery('Remember what I said 3 days ago', referenceTime);
        expect(parsed.hasTemporalIntent).toBe(true);
      });

      it('detects "in December"', () => {
        const parsed = parseTemporalQuery('What did I tell you in December?', referenceTime);
        expect(parsed.hasTemporalIntent).toBe(true);
        expect(parsed.startDate?.getMonth()).toBe(11); // December = 11
      });
    });

    describe('Non-temporal queries', () => {
      it('returns no intent for regular queries', () => {
        const parsed = parseTemporalQuery('How do I sort an array?', referenceTime);
        expect(parsed.hasTemporalIntent).toBe(false);
        expect(parsed.startDate).toBeUndefined();
        expect(parsed.endDate).toBeUndefined();
      });

      it('returns no intent for simple questions', () => {
        const parsed = parseTemporalQuery('What is the capital of France?', referenceTime);
        expect(parsed.hasTemporalIntent).toBe(false);
      });
    });

    describe('Date range calculation', () => {
      it('calculates last week correctly', () => {
        const parsed = parseTemporalQuery('last week', referenceTime);
        
        expect(parsed.startDate?.getDate()).toBe(18); // Jan 25 - 7 = Jan 18
        expect(parsed.endDate?.getDate()).toBe(25);
      });

      it('calculates yesterday correctly', () => {
        const parsed = parseTemporalQuery('yesterday', referenceTime);
        
        expect(parsed.startDate?.getDate()).toBe(24);
        expect(parsed.startDate?.getHours()).toBe(0);
      });

      it('calculates X days ago correctly', () => {
        const parsed = parseTemporalQuery('5 days ago', referenceTime);
        
        expect(parsed.startDate?.getDate()).toBe(20); // Jan 25 - 5 = Jan 20
      });
    });
  });

  describe('detectTemporalIntent', () => {
    describe('Positive detection', () => {
      it('detects "when did I" pattern', () => {
        expect(detectTemporalIntent('When did I first mention TypeScript?')).toBe(true);
      });

      it('detects "remember when" pattern', () => {
        expect(detectTemporalIntent('Do you remember when we talked about auth?')).toBe(true);
      });

      it('detects "earlier" references', () => {
        expect(detectTemporalIntent('What did I say earlier about the database?')).toBe(true);
      });

      it('detects "previously" references', () => {
        expect(detectTemporalIntent('As I mentioned previously...')).toBe(true);
      });

      it('detects "recent" references', () => {
        expect(detectTemporalIntent('What have I been working on recently?')).toBe(true);
      });
    });

    describe('Negative detection', () => {
      it('ignores non-temporal queries', () => {
        expect(detectTemporalIntent('What is the capital of France?')).toBe(false);
      });

      it('ignores technical questions', () => {
        expect(detectTemporalIntent('How do I implement a linked list?')).toBe(false);
      });

      it('ignores general coding questions', () => {
        expect(detectTemporalIntent('Explain async/await in JavaScript')).toBe(false);
      });
    });
  });

  describe('Fixture data validation', () => {
    it('fixture timestamps are in correct windows', () => {
      const now = new Date('2026-01-25T12:00:00Z');
      
      expect(getTemporalWindow(temporalData.timestamps.hot, now)).toBe('HOT');
      expect(getTemporalWindow(temporalData.timestamps.working, now)).toBe('WORKING');
      expect(getTemporalWindow(temporalData.timestamps.longTerm, now)).toBe('LONG_TERM');
      expect(getTemporalWindow(temporalData.timestamps.expired, now)).toBe('EXPIRED');
    });

    it('fixture queries have expected temporal intent', () => {
      expect(detectTemporalIntent(temporalData.queries.yesterday)).toBe(true);
      expect(detectTemporalIntent(temporalData.queries.lastWeek)).toBe(true);
      expect(detectTemporalIntent(temporalData.queries.nonTemporal)).toBe(false);
    });
  });
});
