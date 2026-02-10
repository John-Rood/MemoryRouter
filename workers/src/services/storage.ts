/**
 * Storage Service for Cloudflare Workers
 * Handles KV (hot cache) and R2 (cold storage) operations
 */

import { WorkersVectorIndex, VectorMetadata, SearchResult } from '../vectors/workers-index';

export interface StorageBindings {
  VECTORS_KV: KVNamespace;
  METADATA_KV: KVNamespace;
  VECTORS_R2?: R2Bucket;
}

export interface IndexManifest {
  memoryKey: string;
  totalVectors: number;
  lastRotation: number;
  shards: ShardInfo[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface ShardInfo {
  id: string;
  vectorCount: number;
  timeRange: { start: number; end: number };
  location: 'kv' | 'r2';
  byteSize: number;
}

/**
 * Storage manager for vector indexes
 */
export class StorageManager {
  private kv: KVNamespace;
  private metaKv: KVNamespace;
  private r2: R2Bucket | undefined;
  
  // Config
  private readonly maxVectorsPerShard = 4000;
  private readonly maxBytesPerShard = 20 * 1024 * 1024; // 20MB

  constructor(bindings: StorageBindings) {
    this.kv = bindings.VECTORS_KV;
    this.metaKv = bindings.METADATA_KV;
    this.r2 = bindings.VECTORS_R2;
  }

  /**
   * Get or create manifest for a memory key
   */
  async getManifest(memoryKey: string): Promise<IndexManifest> {
    const key = `${memoryKey}:manifest`;
    const existing = await this.metaKv.get(key, 'json') as IndexManifest | null;
    
    if (existing) {
      return existing;
    }
    
    // Create new manifest
    const manifest: IndexManifest = {
      memoryKey,
      totalVectors: 0,
      lastRotation: Date.now(),
      shards: [],
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    await this.metaKv.put(key, JSON.stringify(manifest));
    return manifest;
  }

  /**
   * Update manifest
   */
  async saveManifest(manifest: IndexManifest): Promise<void> {
    manifest.updatedAt = Date.now();
    manifest.version++;
    await this.metaKv.put(`${manifest.memoryKey}:manifest`, JSON.stringify(manifest));
  }

  /**
   * Load the hot shard for a memory key
   */
  async loadHotShard(memoryKey: string): Promise<WorkersVectorIndex | null> {
    const key = `${memoryKey}:shard:hot`;
    const buffer = await this.kv.get(key, 'arrayBuffer');
    
    if (!buffer) {
      return null;
    }
    
    return WorkersVectorIndex.deserialize(buffer);
  }

  /**
   * Save the hot shard for a memory key
   */
  async saveHotShard(memoryKey: string, index: WorkersVectorIndex): Promise<void> {
    const key = `${memoryKey}:shard:hot`;
    const buffer = index.serialize();
    
    await this.kv.put(key, buffer, {
      metadata: { 
        count: index.size, 
        updated: Date.now(),
        bytes: buffer.byteLength,
      }
    });
  }

  /**
   * Load a shard from R2
   */
  async loadShardFromR2(memoryKey: string, shardId: string): Promise<WorkersVectorIndex | null> {
    if (!this.r2) return null;
    const key = `indexes/${memoryKey}/shards/${shardId}.bin`;
    const object = await this.r2.get(key);
    
    if (!object) {
      return null;
    }
    
    const buffer = await object.arrayBuffer();
    return WorkersVectorIndex.deserialize(buffer);
  }

  /**
   * Rotate hot shard to R2 (called when hot shard gets too large)
   */
  async rotateHotShard(memoryKey: string): Promise<void> {
    if (!this.r2) return;
    const hotIndex = await this.loadHotShard(memoryKey);
    if (!hotIndex || hotIndex.size === 0) {
      return;
    }
    
    const manifest = await this.getManifest(memoryKey);
    const shardId = Date.now().toString();
    
    // Archive to R2
    const buffer = hotIndex.serialize();
    await this.r2.put(`indexes/${memoryKey}/shards/${shardId}.bin`, buffer, {
      customMetadata: {
        memoryKey,
        shardId,
        vectorCount: hotIndex.size.toString(),
      }
    });
    
    // Update manifest
    manifest.shards.push({
      id: shardId,
      vectorCount: hotIndex.size,
      timeRange: { 
        start: manifest.lastRotation, 
        end: Date.now() 
      },
      location: 'r2',
      byteSize: buffer.byteLength,
    });
    manifest.lastRotation = Date.now();
    await this.saveManifest(manifest);
    
    // Create new empty hot shard
    const newHot = new WorkersVectorIndex(hotIndex.dimensions, this.maxVectorsPerShard);
    await this.saveHotShard(memoryKey, newHot);
  }

  /**
   * Store a vector with metadata
   */
  async storeVector(
    memoryKey: string,
    vectorId: number,
    vector: Float32Array,
    metadata: VectorMetadata
  ): Promise<void> {
    // Load or create hot shard
    let hotIndex = await this.loadHotShard(memoryKey);
    if (!hotIndex) {
      hotIndex = new WorkersVectorIndex(vector.length, this.maxVectorsPerShard);
    }
    
    // Add vector
    hotIndex.add(vectorId, vector, metadata.timestamp);
    
    // Check if rotation needed
    if (hotIndex.size >= this.maxVectorsPerShard || hotIndex.byteLength >= this.maxBytesPerShard) {
      await this.rotateHotShard(memoryKey);
      // Create new index with the new vector
      hotIndex = new WorkersVectorIndex(vector.length, this.maxVectorsPerShard);
      hotIndex.add(vectorId, vector, metadata.timestamp);
    }
    
    // Save hot shard
    await this.saveHotShard(memoryKey, hotIndex);
    
    // Store metadata separately for filtering
    await this.storeMetadata(metadata);
    
    // Update manifest
    const manifest = await this.getManifest(memoryKey);
    manifest.totalVectors++;
    await this.saveManifest(manifest);
  }

  /**
   * Store vector metadata
   */
  async storeMetadata(metadata: VectorMetadata): Promise<void> {
    const key = `${metadata.memoryKey}:meta:${metadata.id}`;
    await this.metaKv.put(key, JSON.stringify(metadata), {
      expirationTtl: 90 * 24 * 60 * 60 // 90-day retention
    });
    
    // Also index by hour for time-based queries
    const hourBucket = Math.floor(metadata.timestamp / (60 * 60 * 1000));
    const hourKey = `${metadata.memoryKey}:time:${hourBucket}`;
    const existing = await this.metaKv.get(hourKey, 'json') as number[] | null;
    const ids = existing || [];
    ids.push(metadata.id);
    await this.metaKv.put(hourKey, JSON.stringify(ids), {
      expirationTtl: 90 * 24 * 60 * 60
    });
  }

  /**
   * Get metadata for a vector
   */
  async getMetadata(memoryKey: string, vectorId: number): Promise<VectorMetadata | null> {
    const key = `${memoryKey}:meta:${vectorId}`;
    return await this.metaKv.get(key, 'json') as VectorMetadata | null;
  }

  /**
   * Get metadata for multiple vectors
   */
  async getMetadataBatch(memoryKey: string, vectorIds: number[]): Promise<Map<number, VectorMetadata>> {
    const results = new Map<number, VectorMetadata>();
    
    // KV doesn't support batch gets, so we parallelize
    const promises = vectorIds.map(async (id) => {
      const meta = await this.getMetadata(memoryKey, id);
      if (meta) {
        results.set(id, meta);
      }
    });
    
    await Promise.all(promises);
    return results;
  }

  /**
   * Search across all relevant shards
   */
  async search(
    memoryKey: string,
    query: Float32Array,
    options: {
      limit: number;
      minTimestamp?: number;
      maxTimestamp?: number;
    }
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    
    // Always search hot shard first
    const hotIndex = await this.loadHotShard(memoryKey);
    if (hotIndex && hotIndex.size > 0) {
      const hotResults = hotIndex.searchFast(query, options.limit, options.minTimestamp);
      results.push(...hotResults);
    }
    
    // If we need more results and there are archived shards
    const manifest = await this.getManifest(memoryKey);
    if (manifest.shards.length > 0 && results.length < options.limit) {
      // Filter shards by time range
      const relevantShards = manifest.shards.filter(shard => {
        if (options.minTimestamp && shard.timeRange.end < options.minTimestamp) {
          return false;
        }
        if (options.maxTimestamp && shard.timeRange.start > options.maxTimestamp) {
          return false;
        }
        return true;
      });
      
      // Search archived shards (parallel)
      const shardPromises = relevantShards.map(async (shard) => {
        const shardIndex = await this.loadShardFromR2(memoryKey, shard.id);
        if (shardIndex) {
          return shardIndex.searchFast(query, options.limit, options.minTimestamp);
        }
        return [];
      });
      
      const shardResults = await Promise.all(shardPromises);
      for (const sr of shardResults) {
        results.push(...sr);
      }
    }
    
    // Merge, dedupe, and return top k
    return this.mergeResults(results, options.limit);
  }

  /**
   * Merge and dedupe search results
   */
  private mergeResults(results: SearchResult[], limit: number): SearchResult[] {
    // Dedupe by ID (keep highest score)
    const byId = new Map<number, SearchResult>();
    for (const result of results) {
      const existing = byId.get(result.id);
      if (!existing || result.score > existing.score) {
        byId.set(result.id, result);
      }
    }
    
    // Sort by score descending
    const merged = Array.from(byId.values());
    merged.sort((a, b) => b.score - a.score);
    
    return merged.slice(0, limit);
  }

  /**
   * Get next vector ID for a memory key
   */
  async getNextVectorId(memoryKey: string): Promise<number> {
    const key = `${memoryKey}:vector_id_counter`;
    const current = await this.metaKv.get(key) || '0';
    const next = parseInt(current, 10) + 1;
    await this.metaKv.put(key, next.toString());
    return next;
  }

  /**
   * Delete all data for a memory key
   */
  async deleteMemoryKey(memoryKey: string): Promise<void> {
    // Delete hot shard
    await this.kv.delete(`${memoryKey}:shard:hot`);
    
    // Get and delete manifest
    const manifest = await this.getManifest(memoryKey);
    
    // Delete all R2 shards
    if (this.r2) {
      for (const shard of manifest.shards) {
        await this.r2.delete(`indexes/${memoryKey}/shards/${shard.id}.bin`);
      }
    }
    
    // Delete manifest
    await this.metaKv.delete(`${memoryKey}:manifest`);
    
    // Note: Metadata entries will expire after 90 days
  }

  /**
   * Get storage stats for a memory key
   */
  async getStats(memoryKey: string): Promise<{
    totalVectors: number;
    totalBytes: number;
    shardCount: number;
    hotShardSize: number;
  }> {
    const manifest = await this.getManifest(memoryKey);
    const hotIndex = await this.loadHotShard(memoryKey);
    
    let totalBytes = 0;
    for (const shard of manifest.shards) {
      totalBytes += shard.byteSize;
    }
    
    const hotSize = hotIndex?.byteLength ?? 0;
    totalBytes += hotSize;
    
    return {
      totalVectors: manifest.totalVectors,
      totalBytes,
      shardCount: manifest.shards.length + (hotIndex ? 1 : 0),
      hotShardSize: hotSize,
    };
  }
}

/**
 * Create storage manager from Worker bindings
 */
export function createStorageManager(bindings: StorageBindings): StorageManager {
  return new StorageManager(bindings);
}
