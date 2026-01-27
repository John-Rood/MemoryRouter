/**
 * VaultDurableObject — Core Durable Object for MemoryRouter
 * 
 * Each vault = one Durable Object with:
 *   - In-memory WorkersVectorIndex (sub-ms kNN search)
 *   - SQLite persistence (survives hibernation)
 *   - HTTP fetch API (/search, /store, /delete, /stats, /clear, /export)
 * 
 * LIFECYCLE:
 *   1. Worker calls DO stub with a request
 *   2. If hibernated, Cloudflare wakes it → constructor runs
 *   3. On first data request, loadVectorsIntoMemory() runs (lazy)
 *   4. Vectors stay in memory for subsequent requests (sub-ms search)
 *   5. When idle, Cloudflare hibernates → memory freed, SQLite persists
 *   6. Next request: wake → reload from SQLite (~10-50ms)
 */

import { DurableObject } from 'cloudflare:workers';
import { WorkersVectorIndex } from '../vectors/workers-index';
import type { VaultState } from '../types/do';

/**
 * Env interface for the Durable Object
 * The DO receives the same env as the Worker
 */
interface VaultEnv {
  MAX_IN_MEMORY_VECTORS?: string;
  DEFAULT_EMBEDDING_DIMS?: string;
  [key: string]: unknown;
}

export class VaultDurableObject extends DurableObject<VaultEnv> {
  /** In-memory vector index (the hot data) */
  private index: WorkersVectorIndex | null = null;
  /** Whether vectors have been loaded from SQLite */
  private loaded: boolean = false;
  /** Vault configuration and stats */
  private vaultState: VaultState | null = null;

  /**
   * Initialize SQLite tables on first use
   */
  private ensureSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id INTEGER PRIMARY KEY,
        embedding BLOB NOT NULL,
        timestamp REAL NOT NULL,
        dims INTEGER NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY,
        content TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        content_hash TEXT NOT NULL,
        model TEXT,
        request_id TEXT,
        timestamp REAL NOT NULL,
        token_count INTEGER DEFAULT 0
      );
      
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_vectors_timestamp 
        ON vectors(timestamp);
      CREATE INDEX IF NOT EXISTS idx_items_timestamp 
        ON items(timestamp);
      CREATE INDEX IF NOT EXISTS idx_items_hash 
        ON items(content_hash);
    `);
  }

  /**
   * Load vectors from SQLite into in-memory Float32Array index.
   * Called lazily on first request after wake.
   */
  private loadVectorsIntoMemory(): void {
    if (this.loaded) return;

    this.ensureSchema();

    // Get vault config from meta table
    const stateRow = this.ctx.storage.sql.exec(
      `SELECT value FROM meta WHERE key = 'vault_state'`
    ).one();

    const defaultDims = parseInt(this.env.DEFAULT_EMBEDDING_DIMS || '3072', 10);
    const defaultMax = parseInt(this.env.MAX_IN_MEMORY_VECTORS || '5000', 10);

    if (stateRow) {
      this.vaultState = JSON.parse(stateRow.value as string);
    } else {
      this.vaultState = {
        vectorCount: 0,
        dims: defaultDims,
        maxInMemory: defaultMax,
        lastAccess: Date.now(),
        createdAt: Date.now(),
      };
      this.saveVaultState();
    }

    // Count total vectors in SQLite
    const countRow = this.ctx.storage.sql.exec(
      `SELECT COUNT(*) as cnt FROM vectors`
    ).one();
    const totalVectors = (countRow?.cnt as number) ?? 0;

    if (totalVectors === 0) {
      this.index = new WorkersVectorIndex(
        this.vaultState!.dims,
        this.vaultState!.maxInMemory
      );
      this.loaded = true;
      return;
    }

    // Load most recent vectors into memory (KRONOS: recency matters)
    const loadCount = Math.min(totalVectors, this.vaultState!.maxInMemory);

    const rows = this.ctx.storage.sql.exec(
      `SELECT id, embedding, timestamp FROM vectors 
       ORDER BY timestamp DESC 
       LIMIT ?`,
      loadCount
    ).toArray();

    this.index = new WorkersVectorIndex(
      this.vaultState!.dims,
      this.vaultState!.maxInMemory
    );

    for (const row of rows) {
      const embedding = new Float32Array(row.embedding as ArrayBuffer);
      this.index.add(
        row.id as number,
        embedding,
        row.timestamp as number
      );
    }

    this.loaded = true;
    this.vaultState!.vectorCount = totalVectors;
    this.vaultState!.lastAccess = Date.now();
    this.saveVaultState();
  }

  /**
   * Persist vault state to SQLite meta table
   */
  private saveVaultState(): void {
    if (!this.vaultState) return;
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO meta (key, value) VALUES ('vault_state', ?)`,
      JSON.stringify(this.vaultState)
    );
  }

  // ==================== Public API (HTTP fetch router) ====================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      switch (path) {
        case '/search':
          return await this.handleSearch(request);
        case '/store':
          return await this.handleStore(request);
        case '/delete':
          return await this.handleDelete(request);
        case '/stats':
          return this.handleStats();
        case '/clear':
          return this.handleClear();
        case '/export':
          return this.handleExport();
        default:
          return new Response('Not Found', { status: 404 });
      }
    } catch (error) {
      console.error(`[VaultDO] Error on ${path}:`, error);
      return Response.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  }

  // ==================== Search ====================

  /**
   * Search vectors with KRONOS time filtering.
   * 
   * REQUEST:  { query: number[], k: number, minTimestamp?, maxTimestamp? }
   * RESPONSE: { results: [...], searchTimeMs, hotVectors, totalVectors }
   */
  private async handleSearch(request: Request): Promise<Response> {
    this.loadVectorsIntoMemory();

    const body = await request.json() as {
      query: number[];
      k: number;
      minTimestamp?: number;
      maxTimestamp?: number;
    };

    const startTime = performance.now();
    const queryVec = new Float32Array(body.query);

    // Search in-memory index (sub-ms for loaded vectors)
    let results = this.index!.searchFast(
      queryVec,
      body.k,
      body.minTimestamp
    );

    // If we need more results from cold storage (vectors in SQLite but not in memory)
    if (
      results.length < body.k &&
      this.vaultState!.vectorCount > this.index!.size
    ) {
      const coldResults = this.searchColdStorage(
        queryVec,
        body.k - results.length,
        body.minTimestamp,
        body.maxTimestamp
      );
      results = [...results, ...coldResults];
    }

    // Enrich with content from items table
    const enriched = this.enrichResults(results);
    const searchTimeMs = performance.now() - startTime;

    return Response.json({
      results: enriched,
      searchTimeMs,
      hotVectors: this.index!.size,
      totalVectors: this.vaultState!.vectorCount,
    });
  }

  // ==================== Store ====================

  /**
   * Store a vector + item content.
   * Instant add-then-search: after this returns, the vector is immediately searchable.
   * 
   * REQUEST:  { embedding: number[], content: string, role: string, model?, requestId? }
   * RESPONSE: { id: number, stored: boolean, tokenCount?, totalVectors? }
   */
  private async handleStore(request: Request): Promise<Response> {
    this.loadVectorsIntoMemory();

    const body = await request.json() as {
      embedding: number[];
      content: string;
      role: string;
      model?: string;
      requestId?: string;
    };

    const timestamp = Date.now();
    const embedding = new Float32Array(body.embedding);

    // Update dims if this is the first vector
    if (this.vaultState!.vectorCount === 0 && embedding.length !== this.vaultState!.dims) {
      this.vaultState!.dims = embedding.length;
      // Recreate index with correct dims
      this.index = new WorkersVectorIndex(
        this.vaultState!.dims,
        this.vaultState!.maxInMemory
      );
    }

    // Generate content hash for dedup
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(body.content)
    );
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const contentHash = hashArray
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .substring(0, 16);

    // Check for duplicate content
    const existing = this.ctx.storage.sql.exec(
      `SELECT id FROM items WHERE content_hash = ?`,
      contentHash
    ).one();

    if (existing) {
      return Response.json({
        id: existing.id as number,
        stored: false,
        reason: 'duplicate',
      });
    }

    // Get next ID
    const maxIdRow = this.ctx.storage.sql.exec(
      `SELECT MAX(id) as max_id FROM vectors`
    ).one();
    const nextId = ((maxIdRow?.max_id as number) ?? 0) + 1;

    // Estimate token count (~4 chars per token)
    const tokenCount = Math.ceil(body.content.length / 4);

    // Store in SQLite (persistent)
    this.ctx.storage.sql.exec(
      `INSERT INTO vectors (id, embedding, timestamp, dims) 
       VALUES (?, ?, ?, ?)`,
      nextId,
      embedding.buffer as ArrayBuffer,
      timestamp,
      embedding.length
    );

    this.ctx.storage.sql.exec(
      `INSERT INTO items (id, content, role, content_hash, model, 
                          request_id, timestamp, token_count) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      nextId,
      body.content,
      body.role,
      contentHash,
      body.model ?? null,
      body.requestId ?? null,
      timestamp,
      tokenCount
    );

    // Add to in-memory index (instant searchability!)
    if (this.index!.size < this.vaultState!.maxInMemory) {
      this.index!.add(nextId, embedding, timestamp);
    } else {
      // Memory full — evict oldest from in-memory, then add
      this.evictOldestFromMemory();
      this.index!.add(nextId, embedding, timestamp);
    }

    // Update vault state
    this.vaultState!.vectorCount++;
    this.vaultState!.lastAccess = timestamp;
    this.saveVaultState();

    return Response.json({
      id: nextId,
      stored: true,
      tokenCount,
      totalVectors: this.vaultState!.vectorCount,
    });
  }

  // ==================== Delete ====================

  /**
   * Delete specific vectors by ID or by timestamp.
   */
  private async handleDelete(request: Request): Promise<Response> {
    this.loadVectorsIntoMemory();

    const body = await request.json() as {
      ids?: number[];
      olderThan?: number;
    };

    let deleted = 0;

    if (body.ids && body.ids.length > 0) {
      const placeholders = body.ids.map(() => '?').join(',');
      this.ctx.storage.sql.exec(
        `DELETE FROM vectors WHERE id IN (${placeholders})`,
        ...body.ids
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM items WHERE id IN (${placeholders})`,
        ...body.ids
      );
      deleted = body.ids.length;
    }

    if (body.olderThan) {
      this.ctx.storage.sql.exec(
        `DELETE FROM vectors WHERE timestamp < ?`,
        body.olderThan
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM items WHERE timestamp < ?`,
        body.olderThan
      );
    }

    // Re-count and reload in-memory index
    const countRow = this.ctx.storage.sql.exec(
      `SELECT COUNT(*) as cnt FROM vectors`
    ).one();
    this.vaultState!.vectorCount = (countRow?.cnt as number) ?? 0;
    this.saveVaultState();

    // Reload in-memory index
    this.loaded = false;
    this.loadVectorsIntoMemory();

    return Response.json({
      deleted,
      totalVectors: this.vaultState!.vectorCount,
    });
  }

  // ==================== Stats ====================

  private handleStats(): Response {
    this.loadVectorsIntoMemory();

    const countRow = this.ctx.storage.sql.exec(
      `SELECT COUNT(*) as cnt,
              MIN(timestamp) as oldest,
              MAX(timestamp) as newest,
              SUM(token_count) as total_tokens
       FROM items`
    ).one();

    return Response.json({
      totalVectors: this.vaultState!.vectorCount,
      hotVectors: this.index?.size ?? 0,
      dims: this.vaultState!.dims,
      maxInMemory: this.vaultState!.maxInMemory,
      oldestItem: countRow?.oldest ?? null,
      newestItem: countRow?.newest ?? null,
      totalTokens: countRow?.total_tokens ?? 0,
      createdAt: this.vaultState!.createdAt,
      lastAccess: this.vaultState!.lastAccess,
    });
  }

  // ==================== Clear ====================

  private handleClear(): Response {
    this.loadVectorsIntoMemory();

    this.ctx.storage.sql.exec(`DELETE FROM vectors`);
    this.ctx.storage.sql.exec(`DELETE FROM items`);

    this.vaultState = {
      vectorCount: 0,
      dims: this.vaultState?.dims ?? 3072,
      maxInMemory: this.vaultState?.maxInMemory ?? 5000,
      lastAccess: Date.now(),
      createdAt: this.vaultState?.createdAt ?? Date.now(),
    };
    this.saveVaultState();

    this.index = new WorkersVectorIndex(
      this.vaultState.dims,
      this.vaultState.maxInMemory
    );
    this.loaded = true;

    return Response.json({ cleared: true });
  }

  // ==================== Export ====================

  private handleExport(): Response {
    this.loadVectorsIntoMemory();

    const vectors = this.ctx.storage.sql.exec(
      `SELECT v.id, v.embedding, v.timestamp, v.dims,
              i.content, i.role, i.content_hash, i.model,
              i.request_id, i.token_count
       FROM vectors v
       JOIN items i ON v.id = i.id
       ORDER BY v.timestamp ASC`
    ).toArray();

    return Response.json({
      vectorCount: vectors.length,
      dims: this.vaultState?.dims ?? 3072,
      data: vectors.map(v => ({
        id: v.id,
        timestamp: v.timestamp,
        content: v.content,
        role: v.role,
        model: v.model,
        contentHash: v.content_hash,
        tokenCount: v.token_count,
        embedding: btoa(
          String.fromCharCode(...new Uint8Array(v.embedding as ArrayBuffer))
        ),
      })),
    });
  }

  // ==================== Internal Helpers ====================

  /**
   * Search cold storage (vectors in SQLite but not in memory).
   * Brute-force cosine similarity over SQLite BLOBs.
   */
  private searchColdStorage(
    query: Float32Array,
    k: number,
    minTimestamp?: number,
    maxTimestamp?: number
  ): Array<{ id: number; score: number }> {
    let sql = `SELECT id, embedding FROM vectors WHERE 1=1`;
    const params: unknown[] = [];

    if (minTimestamp !== undefined) {
      sql += ` AND timestamp >= ?`;
      params.push(minTimestamp);
    }
    if (maxTimestamp !== undefined) {
      sql += ` AND timestamp <= ?`;
      params.push(maxTimestamp);
    }

    sql += ` ORDER BY timestamp ASC`;

    const rows = this.ctx.storage.sql.exec(sql, ...params).toArray();

    // Normalize query for dot product
    let magnitude = 0;
    for (let i = 0; i < query.length; i++) {
      magnitude += query[i] * query[i];
    }
    magnitude = Math.sqrt(magnitude);
    const normalizedQuery = new Float32Array(query.length);
    if (magnitude > 0) {
      for (let i = 0; i < query.length; i++) {
        normalizedQuery[i] = query[i] / magnitude;
      }
    }

    // Brute force top-k
    const results: Array<{ id: number; score: number }> = [];

    for (const row of rows) {
      const embedding = new Float32Array(row.embedding as ArrayBuffer);

      // Dot product (stored vectors are pre-normalized by WorkersVectorIndex.add)
      let dotProduct = 0;
      for (let i = 0; i < embedding.length; i++) {
        dotProduct += embedding[i] * normalizedQuery[i];
      }

      if (results.length < k) {
        results.push({ id: row.id as number, score: dotProduct });
        if (results.length === k) {
          results.sort((a, b) => a.score - b.score);
        }
      } else if (dotProduct > results[0].score) {
        results[0] = { id: row.id as number, score: dotProduct };
        results.sort((a, b) => a.score - b.score);
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Enrich search results with content from items table
   */
  private enrichResults(
    results: Array<{ id: number; score: number }>
  ): Array<{
    id: number;
    score: number;
    content: string;
    role: string;
    timestamp: number;
    model?: string;
  }> {
    if (results.length === 0) return [];

    const ids = results.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');

    const rows = this.ctx.storage.sql.exec(
      `SELECT id, content, role, timestamp, model 
       FROM items WHERE id IN (${placeholders})`,
      ...ids
    ).toArray();

    const rowMap = new Map(rows.map(r => [r.id as number, r]));

    return results
      .map(r => {
        const row = rowMap.get(r.id);
        if (!row) return null;
        return {
          id: r.id,
          score: r.score,
          content: row.content as string,
          role: row.role as string,
          timestamp: row.timestamp as number,
          model: (row.model as string) || undefined,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }

  /**
   * Evict oldest vectors from in-memory index.
   * SQLite retains all data — this only affects the hot cache.
   */
  private evictOldestFromMemory(): void {
    const keepCount = Math.floor(this.vaultState!.maxInMemory * 0.9);

    const rows = this.ctx.storage.sql.exec(
      `SELECT id, embedding, timestamp FROM vectors 
       ORDER BY timestamp DESC 
       LIMIT ?`,
      keepCount
    ).toArray();

    this.index = new WorkersVectorIndex(
      this.vaultState!.dims,
      this.vaultState!.maxInMemory
    );

    for (const row of rows) {
      const embedding = new Float32Array(row.embedding as ArrayBuffer);
      this.index.add(
        row.id as number,
        embedding,
        row.timestamp as number
      );
    }
  }
}
