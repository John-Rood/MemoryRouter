/**
 * WorkersVectorIndex - Pure TypeScript Vector Search for Cloudflare Workers
 * 
 * Features:
 * - Zero native dependencies
 * - Float32Array for memory efficiency
 * - Brute-force kNN with cosine similarity
 * - Binary serialization for KV/R2 storage
 * - Dynamic growth — no artificial vector cap
 * - Optimized for 1024 dimensions (BGE-M3)
 */

export interface VectorMetadata {
  id: number;
  memoryKey: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  contentHash: string;
  timestamp: number;
  model?: string;
  requestId?: string;
}

export interface SearchResult {
  id: number;
  score: number;
  metadata?: VectorMetadata;
}

const DEFAULT_INITIAL_CAPACITY = 1024;
const GROWTH_FACTOR = 2;

/**
 * Pure TypeScript vector index optimized for Cloudflare Workers
 * Uses flat Float32Array storage for memory efficiency
 * Grows dynamically — no artificial limits
 */
export class WorkersVectorIndex {
  private vectors: Float32Array;
  private ids: Uint32Array;
  private timestamps: Float64Array;
  private count: number = 0;
  private capacity: number;
  private readonly dims: number;

  constructor(dims: number = 1024, initialCapacity: number = DEFAULT_INITIAL_CAPACITY) {
    this.dims = dims;
    this.capacity = initialCapacity;
    // Pre-allocate initial capacity — will grow as needed
    this.vectors = new Float32Array(initialCapacity * dims);
    this.ids = new Uint32Array(initialCapacity);
    this.timestamps = new Float64Array(initialCapacity);
  }

  /**
   * Get current vector count
   */
  get size(): number {
    return this.count;
  }

  /**
   * Get dimensions
   */
  get dimensions(): number {
    return this.dims;
  }

  /**
   * Get approximate byte size
   */
  get byteLength(): number {
    // Header (12 bytes) + ids (count * 4) + timestamps (count * 8) + vectors (count * dims * 4)
    return 12 + this.count * 4 + this.count * 8 + this.count * this.dims * 4;
  }

  /**
   * Grow internal arrays when capacity is reached
   */
  private grow(): void {
    const newCapacity = this.capacity * GROWTH_FACTOR;

    const newVectors = new Float32Array(newCapacity * this.dims);
    newVectors.set(this.vectors.subarray(0, this.count * this.dims));
    this.vectors = newVectors;

    const newIds = new Uint32Array(newCapacity);
    newIds.set(this.ids.subarray(0, this.count));
    this.ids = newIds;

    const newTimestamps = new Float64Array(newCapacity);
    newTimestamps.set(this.timestamps.subarray(0, this.count));
    this.timestamps = newTimestamps;

    this.capacity = newCapacity;
  }

  /**
   * L2 normalize a vector (for cosine similarity via dot product)
   */
  private normalize(vector: Float32Array): Float32Array {
    let magnitude = 0;
    for (let i = 0; i < vector.length; i++) {
      magnitude += vector[i] * vector[i];
    }
    magnitude = Math.sqrt(magnitude);
    
    if (magnitude === 0) return vector;
    
    const normalized = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      normalized[i] = vector[i] / magnitude;
    }
    return normalized;
  }

  /**
   * Compute dot product (cosine similarity for normalized vectors)
   */
  private dotProduct(offset: number, query: Float32Array): number {
    let sum = 0;
    const base = offset * this.dims;
    for (let i = 0; i < this.dims; i++) {
      sum += this.vectors[base + i] * query[i];
    }
    return sum;
  }

  /**
   * Add a vector to the index — grows dynamically if needed
   * @param id Unique identifier for the vector
   * @param vector The embedding vector (will be normalized)
   * @param timestamp Unix timestamp for KRONOS filtering
   */
  add(id: number, vector: Float32Array | number[], timestamp: number = Date.now()): void {
    if (this.count >= this.capacity) {
      this.grow();
    }

    // Convert to Float32Array if needed
    const vec = vector instanceof Float32Array 
      ? vector 
      : new Float32Array(vector);
    
    if (vec.length !== this.dims) {
      throw new Error(`Vector dimension mismatch: expected ${this.dims}, got ${vec.length}`);
    }

    // Normalize for cosine similarity
    const normalized = this.normalize(vec);
    
    // Store at current position
    const offset = this.count * this.dims;
    this.vectors.set(normalized, offset);
    this.ids[this.count] = id;
    this.timestamps[this.count] = timestamp;
    this.count++;
  }

  /**
   * Search for k nearest neighbors
   * @param query Query vector (will be normalized)
   * @param k Number of results
   * @param minTimestamp Optional: filter vectors older than this
   */
  search(
    query: Float32Array | number[], 
    k: number, 
    minTimestamp?: number
  ): SearchResult[] {
    // Convert and normalize query
    const queryVec = query instanceof Float32Array 
      ? query 
      : new Float32Array(query);
    const normalizedQuery = this.normalize(queryVec);

    // Compute similarities
    const results: SearchResult[] = [];
    
    for (let i = 0; i < this.count; i++) {
      // Apply timestamp filter for KRONOS windows
      if (minTimestamp !== undefined && this.timestamps[i] < minTimestamp) {
        continue;
      }
      
      const score = this.dotProduct(i, normalizedQuery);
      results.push({ 
        id: this.ids[i], 
        score 
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    
    // Return top k
    return results.slice(0, k);
  }

  /**
   * Search with partial sort for better performance when k << n
   * Uses quickselect-inspired approach
   */
  searchFast(
    query: Float32Array | number[], 
    k: number, 
    minTimestamp?: number
  ): SearchResult[] {
    const queryVec = query instanceof Float32Array 
      ? query 
      : new Float32Array(query);
    const normalizedQuery = this.normalize(queryVec);

    // For small datasets, use simple approach
    if (this.count <= k * 2) {
      return this.search(query, k, minTimestamp);
    }

    // Use a max-heap approach for top-k
    const results: SearchResult[] = [];
    
    for (let i = 0; i < this.count; i++) {
      if (minTimestamp !== undefined && this.timestamps[i] < minTimestamp) {
        continue;
      }
      
      const score = this.dotProduct(i, normalizedQuery);
      
      if (results.length < k) {
        results.push({ id: this.ids[i], score });
        // Maintain min-heap property
        if (results.length === k) {
          results.sort((a, b) => a.score - b.score);
        }
      } else if (score > results[0].score) {
        results[0] = { id: this.ids[i], score };
        // Re-heapify (simple sort for small k)
        results.sort((a, b) => a.score - b.score);
      }
    }

    // Return in descending order
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Get vector IDs in a time range (for KRONOS windows)
   */
  getIdsInTimeRange(minTimestamp: number, maxTimestamp: number): number[] {
    const ids: number[] = [];
    for (let i = 0; i < this.count; i++) {
      if (this.timestamps[i] >= minTimestamp && this.timestamps[i] <= maxTimestamp) {
        ids.push(this.ids[i]);
      }
    }
    return ids;
  }

  /**
   * Serialize index to binary format for KV/R2 storage
   * Format:
   *   [4 bytes] dims (uint32)
   *   [4 bytes] count (uint32)
   *   [4 bytes] reserved
   *   [count * 4 bytes] ids (uint32 array)
   *   [0-4 bytes] padding (for 8-byte alignment)
   *   [count * 8 bytes] timestamps (float64 array)
   *   [count * dims * 4 bytes] vectors (float32 array)
   */
  serialize(): ArrayBuffer {
    const headerSize = 12;
    const idsSize = this.count * 4;
    // Pad to 8-byte alignment for Float64Array timestamps
    const idsSectionEnd = headerSize + idsSize;
    const timestampsStart = Math.ceil(idsSectionEnd / 8) * 8;
    const timestampsSize = this.count * 8;
    const vectorsStart = timestampsStart + timestampsSize;
    const vectorsSize = this.count * this.dims * 4;
    const totalSize = vectorsStart + vectorsSize;
    
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    
    // Header
    view.setUint32(0, this.dims, true);
    view.setUint32(4, this.count, true);
    view.setUint32(8, 0, true); // reserved
    
    // IDs
    const idsArray = new Uint32Array(buffer, headerSize, this.count);
    idsArray.set(this.ids.subarray(0, this.count));
    
    // Timestamps (at 8-byte aligned offset)
    const timestampsArray = new Float64Array(buffer, timestampsStart, this.count);
    timestampsArray.set(this.timestamps.subarray(0, this.count));
    
    // Vectors
    const vectorsArray = new Float32Array(buffer, vectorsStart, this.count * this.dims);
    vectorsArray.set(this.vectors.subarray(0, this.count * this.dims));
    
    return buffer;
  }

  /**
   * Deserialize index from binary format
   */
  static deserialize(buffer: ArrayBuffer): WorkersVectorIndex {
    const view = new DataView(buffer);
    
    const dims = view.getUint32(0, true);
    const count = view.getUint32(4, true);
    // const reserved = view.getUint32(8, true);
    
    const headerSize = 12;
    const idsSize = count * 4;
    // Calculate 8-byte aligned offset for timestamps (same as serialize)
    const idsSectionEnd = headerSize + idsSize;
    const timestampsStart = Math.ceil(idsSectionEnd / 8) * 8;
    const timestampsSize = count * 8;
    const vectorsStart = timestampsStart + timestampsSize;
    
    const index = new WorkersVectorIndex(dims, Math.max(count, 1));
    index.count = count;
    
    // Read IDs
    if (count > 0) {
      index.ids.set(new Uint32Array(buffer, headerSize, count));
    }
    
    // Read timestamps (at 8-byte aligned offset)
    if (count > 0) {
      index.timestamps.set(new Float64Array(buffer, timestampsStart, count));
    }
    
    // Read vectors
    if (count > 0) {
      index.vectors.set(new Float32Array(buffer, vectorsStart, count * dims));
    }
    
    return index;
  }

  /**
   * Merge another index into this one
   * Grows dynamically if needed
   */
  merge(other: WorkersVectorIndex): void {
    if (other.dims !== this.dims) {
      throw new Error(`Dimension mismatch: ${this.dims} vs ${other.dims}`);
    }
    
    // Grow to fit
    while (this.count + other.count > this.capacity) {
      this.grow();
    }
    
    // Copy vectors
    for (let i = 0; i < other.count; i++) {
      const srcOffset = i * other.dims;
      const dstOffset = (this.count + i) * this.dims;
      for (let j = 0; j < this.dims; j++) {
        this.vectors[dstOffset + j] = other.vectors[srcOffset + j];
      }
      this.ids[this.count + i] = other.ids[i];
      this.timestamps[this.count + i] = other.timestamps[i];
    }
    
    this.count += other.count;
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.count = 0;
  }

  /**
   * Create a filtered view of the index (returns new index with matching vectors)
   */
  filter(minTimestamp: number, maxTimestamp?: number): WorkersVectorIndex {
    const max = maxTimestamp ?? Date.now();
    const matchingCount = this.getIdsInTimeRange(minTimestamp, max).length;
    const filtered = new WorkersVectorIndex(this.dims, Math.max(matchingCount, 1));
    
    for (let i = 0; i < this.count; i++) {
      if (this.timestamps[i] >= minTimestamp && this.timestamps[i] <= max) {
        // Copy vector data
        const srcOffset = i * this.dims;
        const vec = new Float32Array(this.dims);
        for (let j = 0; j < this.dims; j++) {
          vec[j] = this.vectors[srcOffset + j];
        }
        // Note: vectors are already normalized, so we store directly
        const dstOffset = filtered.count * this.dims;
        filtered.vectors.set(vec, dstOffset);
        filtered.ids[filtered.count] = this.ids[i];
        filtered.timestamps[filtered.count] = this.timestamps[i];
        filtered.count++;
      }
    }
    
    return filtered;
  }
}

/**
 * Create an empty index with default settings
 */
export function createIndex(dims: number = 1024, initialCapacity: number = DEFAULT_INITIAL_CAPACITY): WorkersVectorIndex {
  return new WorkersVectorIndex(dims, initialCapacity);
}
