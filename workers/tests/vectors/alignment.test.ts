/**
 * WorkersVectorIndex Byte Alignment Tests
 * 
 * Tests for proper byte alignment in serialize/deserialize.
 * Float64Array (timestamps) requires 8-byte alignment.
 */

import { describe, it, expect } from 'vitest';
import { WorkersVectorIndex } from '../../src/vectors/workers-index';

describe('WorkersVectorIndex Byte Alignment', () => {
  describe('serialize/deserialize with various vector counts', () => {
    // The bug: Float64Array requires 8-byte alignment
    // Header is 12 bytes, IDs are count * 4 bytes
    // For count=2: 12 + 8 = 20 bytes, which is NOT 8-byte aligned!
    
    it('should serialize/deserialize with 1 vector', () => {
      const index = new WorkersVectorIndex(4, 100);
      index.add(1, new Float32Array([1, 0, 0, 0]), 1000);
      
      const buffer = index.serialize();
      const restored = WorkersVectorIndex.deserialize(buffer);
      
      expect(restored.size).toBe(1);
      expect(restored.dimensions).toBe(4);
      
      const results = restored.search(new Float32Array([1, 0, 0, 0]), 1);
      expect(results[0].id).toBe(1);
    });
    
    it('should serialize/deserialize with 2 vectors (alignment edge case)', () => {
      // This is the critical test case:
      // Header(12) + IDs(2*4=8) = 20 bytes
      // 20 % 8 = 4 → NOT 8-byte aligned for Float64Array!
      
      const index = new WorkersVectorIndex(4, 100);
      index.add(1, new Float32Array([1, 0, 0, 0]), 1000);
      index.add(2, new Float32Array([0, 1, 0, 0]), 2000);
      
      // Should NOT throw
      const buffer = index.serialize();
      expect(buffer).toBeInstanceOf(ArrayBuffer);
      
      // Should restore correctly
      const restored = WorkersVectorIndex.deserialize(buffer);
      expect(restored.size).toBe(2);
      expect(restored.dimensions).toBe(4);
      
      // Search should work and return correct results
      const results = restored.search(new Float32Array([1, 0, 0, 0]), 2);
      expect(results.length).toBe(2);
      expect(results[0].id).toBe(1); // Closest to [1,0,0,0]
      expect(results[1].id).toBe(2);
    });
    
    it('should serialize/deserialize with 3 vectors', () => {
      // Header(12) + IDs(3*4=12) = 24 bytes
      // 24 % 8 = 0 → aligned (but test anyway for completeness)
      
      const index = new WorkersVectorIndex(4, 100);
      index.add(1, new Float32Array([1, 0, 0, 0]), 1000);
      index.add(2, new Float32Array([0, 1, 0, 0]), 2000);
      index.add(3, new Float32Array([0, 0, 1, 0]), 3000);
      
      const buffer = index.serialize();
      const restored = WorkersVectorIndex.deserialize(buffer);
      
      expect(restored.size).toBe(3);
      
      const results = restored.search(new Float32Array([0, 0, 1, 0]), 3);
      expect(results[0].id).toBe(3);
    });
    
    it('should serialize/deserialize with 4 vectors (another alignment edge case)', () => {
      // Header(12) + IDs(4*4=16) = 28 bytes
      // 28 % 8 = 4 → NOT 8-byte aligned!
      
      const index = new WorkersVectorIndex(4, 100);
      index.add(1, new Float32Array([1, 0, 0, 0]), 1000);
      index.add(2, new Float32Array([0, 1, 0, 0]), 2000);
      index.add(3, new Float32Array([0, 0, 1, 0]), 3000);
      index.add(4, new Float32Array([0, 0, 0, 1]), 4000);
      
      const buffer = index.serialize();
      const restored = WorkersVectorIndex.deserialize(buffer);
      
      expect(restored.size).toBe(4);
    });
    
    it('should preserve timestamps after serialize/deserialize', () => {
      const index = new WorkersVectorIndex(4, 100);
      const now = Date.now();
      
      index.add(1, new Float32Array([1, 0, 0, 0]), now - 10000);
      index.add(2, new Float32Array([0, 1, 0, 0]), now - 5000);
      index.add(3, new Float32Array([0, 0, 1, 0]), now);
      
      const buffer = index.serialize();
      const restored = WorkersVectorIndex.deserialize(buffer);
      
      // Filter by timestamp should work correctly
      const recentResults = restored.search(new Float32Array([1, 0, 0, 0]), 10, now - 7000);
      expect(recentResults.length).toBe(2); // Only ids 2 and 3
      expect(recentResults.map(r => r.id)).not.toContain(1);
    });
    
    it('should handle empty index', () => {
      const index = new WorkersVectorIndex(4, 100);
      
      const buffer = index.serialize();
      const restored = WorkersVectorIndex.deserialize(buffer);
      
      expect(restored.size).toBe(0);
      expect(restored.dimensions).toBe(4);
    });
    
    it('should handle large dimension vectors', () => {
      // 3072 dimensions (text-embedding-3-large)
      const dims = 3072;
      const index = new WorkersVectorIndex(dims, 100);
      
      const vec1 = new Float32Array(dims);
      const vec2 = new Float32Array(dims);
      vec1[0] = 1;
      vec2[1] = 1;
      
      index.add(1, vec1, 1000);
      index.add(2, vec2, 2000);
      
      const buffer = index.serialize();
      const restored = WorkersVectorIndex.deserialize(buffer);
      
      expect(restored.size).toBe(2);
      expect(restored.dimensions).toBe(dims);
      
      const results = restored.search(vec1, 1);
      expect(results[0].id).toBe(1);
    });
  });
});
