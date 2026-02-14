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
import { mirrorToD1 } from '../services/d1-search';

/**
 * Env interface for the Durable Object
 * The DO receives the same env as the Worker
 */
interface VaultEnv {
  DEFAULT_EMBEDDING_DIMS?: string;
  AI?: Ai; // Cloudflare Workers AI binding
  VECTORS_D1?: D1Database; // D1 for cold-start fallback search
  [key: string]: unknown;
}

export class VaultDurableObject extends DurableObject<VaultEnv> {
  /** In-memory vector index (the hot data) */
  private index: WorkersVectorIndex | null = null;
  /** Whether vectors have been loaded from SQLite */
  private loaded: boolean = false;
  /** Vault configuration and stats */
  private vaultState: VaultState | null = null;
  /** Whether the DO is fully warmed (vectors loaded into memory) */
  private isWarm: boolean = false;
  /** Last time DO was accessed (for warmth tracking) */
  private lastActive: number = 0;

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
      
      CREATE TABLE IF NOT EXISTS pending_buffer (
        id INTEGER PRIMARY KEY DEFAULT 1,
        content TEXT NOT NULL DEFAULT '',
        token_count INTEGER NOT NULL DEFAULT 0,
        last_updated REAL NOT NULL DEFAULT 0
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
    // NOTE: .one() throws if zero rows — use .toArray() instead
    const stateRows = this.ctx.storage.sql.exec(
      `SELECT value FROM meta WHERE key = 'vault_state'`
    ).toArray();

    const defaultDims = parseInt(this.env.DEFAULT_EMBEDDING_DIMS || '1024', 10);

    if (stateRows.length > 0) {
      this.vaultState = JSON.parse(stateRows[0].value as string);
    } else {
      this.vaultState = {
        vectorCount: 0,
        dims: defaultDims,
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
      // If dims is 0, skip creating index — will be created on first store
      if (this.vaultState!.dims > 0) {
        this.index = new WorkersVectorIndex(this.vaultState!.dims);
      } else {
        this.index = null;
      }
      this.loaded = true;
      return;
    }

    // Load ALL vectors into memory — no cap
    const rows = this.ctx.storage.sql.exec(
      `SELECT id, embedding, timestamp FROM vectors 
       ORDER BY timestamp DESC`
    ).toArray();

    this.index = new WorkersVectorIndex(this.vaultState!.dims, rows.length || undefined);

    for (const row of rows) {
      const embedding = new Float32Array(row.embedding as ArrayBuffer);
      this.index.add(
        row.id as number,
        embedding,
        row.timestamp as number
      );
    }

    this.loaded = true;
    this.isWarm = true;
    this.lastActive = Date.now();
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
        case '/search-all':
          return await this.handleSearchAll(request);
        case '/store':
          return await this.handleStore(request);
        case '/store-chunked':
          return await this.handleStoreChunked(request);
        case '/buffer':
          return await this.handleBuffer(request);
        case '/delete':
          return await this.handleDelete(request);
        case '/stats':
          return this.handleStats();
        case '/clear':
          return this.handleClear();
        case '/reset':
          return this.handleReset(request);
        case '/export':
          return this.handleExport();
        case '/export-raw':
          return this.handleExportRaw();
        case '/warmth':
          return this.handleWarmth();
        case '/bulk-store':
          return this.handleBulkStore(request);
        case '/archival-stats':
          return this.handleArchivalStats(request);
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

    // Handle empty vault (no index yet - happens after reset before first store)
    if (!this.index) {
      return Response.json({
        results: [],
        searchTimeMs: performance.now() - startTime,
        hotVectors: 0,
        totalVectors: 0,
      });
    }

    // Search in-memory index (sub-ms for loaded vectors)
    let results = this.index.searchFast(
      queryVec,
      body.k,
      body.minTimestamp
    );

    // If we need more results from cold storage (vectors in SQLite but not in memory)
    if (
      results.length < body.k &&
      this.vaultState!.vectorCount > this.index.size
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

    // Also fetch buffer content (saves a round-trip)
    const bufferRows = this.ctx.storage.sql.exec(
      `SELECT content, token_count, last_updated FROM pending_buffer WHERE id = 1`
    ).toArray();
    
    const buffer = bufferRows.length > 0 ? {
      content: bufferRows[0].content as string,
      tokenCount: bufferRows[0].token_count as number,
      lastUpdated: bufferRows[0].last_updated as number,
    } : null;

    return Response.json({
      results: enriched,
      searchTimeMs,
      hotVectors: this.index.size,
      totalVectors: this.vaultState!.vectorCount,
      buffer, // Include buffer in search response
    });
  }

  /**
   * Search all KRONOS windows in a single request.
   * 
   * REQUEST:  { query: number[], windows: [{ name, k, minTimestamp, maxTimestamp }] }
   * RESPONSE: { windows: { hot: [...], working: [...], longterm: [...] }, buffer, searchTimeMs }
   */
  private async handleSearchAll(request: Request): Promise<Response> {
    this.loadVectorsIntoMemory();

    const body = await request.json() as {
      query: number[];
      windows: Array<{
        name: 'hot' | 'working' | 'longterm';
        k: number;
        minTimestamp: number;
        maxTimestamp: number;
      }>;
    };

    const startTime = performance.now();
    const queryVec = new Float32Array(body.query);

    // Handle empty vault
    if (!this.index) {
      const emptyWindows: Record<string, Array<unknown>> = {};
      for (const w of body.windows) {
        emptyWindows[w.name] = [];
      }
      return Response.json({
        windows: emptyWindows,
        buffer: null,
        searchTimeMs: performance.now() - startTime,
      });
    }

    // Search each window
    const windowResults: Record<string, Array<{
      id: number;
      score: number;
      content: string;
      role: string;
      timestamp: number;
    }>> = {};

    for (const window of body.windows) {
      let results = this.index.searchFast(
        queryVec,
        window.k,
        window.minTimestamp
      );

      // Filter by maxTimestamp and enrich
      const enriched = this.enrichResults(results)
        .filter(r => r.timestamp <= window.maxTimestamp);

      windowResults[window.name] = enriched.slice(0, window.k);
    }

    // Get buffer
    const bufferRows = this.ctx.storage.sql.exec(
      `SELECT content, token_count, last_updated FROM pending_buffer WHERE id = 1`
    ).toArray();
    
    const buffer = bufferRows.length > 0 ? {
      content: bufferRows[0].content as string,
      tokenCount: bufferRows[0].token_count as number,
      lastUpdated: bufferRows[0].last_updated as number,
    } : null;

    return Response.json({
      windows: windowResults,
      buffer,
      searchTimeMs: performance.now() - startTime,
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

    // Update dims if this is the first vector (or after reset)
    if (this.vaultState!.vectorCount === 0 && 
        (this.vaultState!.dims === 0 || embedding.length !== this.vaultState!.dims)) {
      this.vaultState!.dims = embedding.length;
      // Create/recreate index with correct dims
      this.index = new WorkersVectorIndex(this.vaultState!.dims);
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
    const existingRows = this.ctx.storage.sql.exec(
      `SELECT id FROM items WHERE content_hash = ?`,
      contentHash
    ).toArray();

    if (existingRows.length > 0) {
      return Response.json({
        id: existingRows[0].id as number,
        stored: false,
        reason: 'duplicate',
      });
    }

    // Get next ID
    const maxIdRows = this.ctx.storage.sql.exec(
      `SELECT MAX(id) as max_id FROM vectors`
    ).toArray();
    const nextId = ((maxIdRows[0]?.max_id as number) ?? 0) + 1;

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

    // Add to in-memory index (instant searchability — no cap)
    this.index!.add(nextId, embedding, timestamp);

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

  // ==================== Bulk Storage (for uploads) ====================

  /**
   * Bulk store multiple items with embeddings.
   * Used by /v1/memory/upload endpoint.
   * 
   * REQUEST:  { items: Array<{content, role?, timestamp?}> }
   * HEADERS:  X-Memory-Key (required), X-Session-ID (optional)
   * RESPONSE: { stored: number, failed: number, errors?: string[] }
   */
  private async handleBulkStore(request: Request): Promise<Response> {
    this.loadVectorsIntoMemory();

    // Get memory key and session ID from headers (for D1 mirroring)
    const memoryKey = request.headers.get('X-Memory-Key');
    const sessionId = request.headers.get('X-Session-ID') || undefined;
    const vaultType: 'core' | 'session' = sessionId ? 'session' : 'core';

    // Parse JSONL body (one JSON object per line) — avoids ~5000 item JSON array limit
    const rawBody = await request.text();
    const items: Array<{ content: string; role?: string; timestamp?: number }> = [];
    
    for (const line of rawBody.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        items.push(JSON.parse(trimmed));
      } catch {
        // Skip malformed lines
      }
    }

    if (items.length === 0) {
      return Response.json({ error: 'No items provided' }, { status: 400 });
    }

    const results = {
      stored: 0,
      failed: 0,
      errors: [] as string[],
      d1Synced: true,
      d1ChunksSynced: 0,
      d1Errors: [] as string[],
    };

    // D1 binding for mirroring (may be undefined)
    const d1 = this.env.VECTORS_D1;
    
    // Track D1 mirror promises for sync status
    const d1MirrorPromises: Promise<{ success: boolean; error?: string }>[] = [];

    // Batch size for Cloudflare AI embedding calls
    // BGE-M3 has a 60K token context limit per call. Our chunks target ~300
    // estimated tokens (at 4 chars/token), but BGE-M3's SentencePiece tokenizer
    // counts ~2-3 chars/token, so chunks are ~500-600 real tokens.
    // At 25 chunks: 25 × 600 = 15K tokens — safe margin under 60K limit.
    const EMBED_BATCH_SIZE = 25;

    // Process in batches
    for (let batchStart = 0; batchStart < items.length; batchStart += EMBED_BATCH_SIZE) {
      const batch = items.slice(batchStart, batchStart + EMBED_BATCH_SIZE);
      const texts = batch.map(item => {
        const role = item.role || 'user';
        const raw = `[${role.toUpperCase()}] ${item.content}`;
        // Strip orphaned surrogates and replacement chars that crash BGE-M3
        return raw.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|\uFFFD/g, '');
      });

      try {
        // Get embeddings from Cloudflare Workers AI (BGE-M3, 1024 dims)
        const embeddings = await this.getEmbeddings(texts);

        if (embeddings.length !== batch.length) {
          results.failed += batch.length;
          results.errors.push(`Embedding count mismatch: expected ${batch.length}, got ${embeddings.length}`);
          continue;
        }

        // Store each item
        for (let i = 0; i < batch.length; i++) {
          const item = batch[i];
          const embedding = embeddings[i];
          const timestamp = item.timestamp || Date.now();
          const role = item.role || 'user';

          try {
            // Update dims if first vector
            if (this.vaultState!.vectorCount === 0 && 
                (this.vaultState!.dims === 0 || embedding.length !== this.vaultState!.dims)) {
              this.vaultState!.dims = embedding.length;
              this.index = new WorkersVectorIndex(this.vaultState!.dims);
            }

            // Generate content hash
            const encoder = new TextEncoder();
            const hashBuffer = await crypto.subtle.digest(
              'SHA-256',
              encoder.encode(item.content)
            );
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const contentHash = hashArray
              .map(b => b.toString(16).padStart(2, '0'))
              .join('')
              .substring(0, 16);

            // Skip duplicates
            const existingRows = this.ctx.storage.sql.exec(
              `SELECT id FROM items WHERE content_hash = ?`,
              contentHash
            ).toArray();

            if (existingRows.length > 0) {
              // Already exists, count as stored (not failed)
              results.stored++;
              continue;
            }

            // Get next ID
            const maxIdRows = this.ctx.storage.sql.exec(
              `SELECT MAX(id) as max_id FROM vectors`
            ).toArray();
            const nextId = ((maxIdRows[0]?.max_id as number) ?? 0) + 1;

            const tokenCount = Math.ceil(item.content.length / 4);
            const embeddingArray = new Float32Array(embedding);

            // Store in SQLite
            this.ctx.storage.sql.exec(
              `INSERT INTO vectors (id, embedding, timestamp, dims) VALUES (?, ?, ?, ?)`,
              nextId,
              embeddingArray.buffer as ArrayBuffer,
              timestamp,
              embeddingArray.length
            );

            this.ctx.storage.sql.exec(
              `INSERT INTO items (id, content, role, content_hash, timestamp, token_count) 
               VALUES (?, ?, ?, ?, ?, ?)`,
              nextId,
              item.content,
              role,
              contentHash,
              timestamp,
              tokenCount
            );

            // Add to in-memory index (no cap)
            this.index!.add(nextId, embeddingArray, timestamp);

            this.vaultState!.vectorCount++;
            results.stored++;

            // Mirror to D1 for cold-start fallback — track success/failure
            if (d1 && memoryKey) {
              const mirrorPromise = mirrorToD1(
                d1,
                memoryKey,
                vaultType,
                sessionId,
                item.content,
                role,
                embeddingArray,
                timestamp,
                tokenCount,
                undefined, // model
                contentHash
              )
                .then(() => ({ success: true }))
                .catch(err => {
                  console.error('[D1-MIRROR] Bulk store failed:', err);
                  return { success: false, error: String(err) };
                });
              
              d1MirrorPromises.push(mirrorPromise);
            }

          } catch (itemError) {
            results.failed++;
            results.errors.push(`Item ${batchStart + i}: ${(itemError as Error).message}`);
          }
        }

        // Save vault state after each batch
        this.vaultState!.lastAccess = Date.now();
        this.saveVaultState();

      } catch (batchError) {
        // Batch embedding failed — fall back to one-by-one embedding
        // to isolate and skip the bad item(s) instead of losing the whole batch
        console.log(`[Bulk-Store] Batch ${batchStart} failed (${(batchError as Error).message}), retrying items individually`);
        
        for (let i = 0; i < batch.length; i++) {
          const item = batch[i];
          const role = item.role || 'user';
          const text = `[${role.toUpperCase()}] ${item.content}`;
          
          try {
            const singleEmbedding = await this.getEmbeddings([text]);
            if (!singleEmbedding[0]) {
              results.failed++;
              results.errors.push(`Item ${batchStart + i}: empty embedding`);
              continue;
            }
            
            const embedding = singleEmbedding[0];
            const timestamp = item.timestamp || Date.now();

            // Generate content hash
            const encoder = new TextEncoder();
            const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(item.content));
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);

            // Skip duplicates
            const existingRows = this.ctx.storage.sql.exec(
              `SELECT id FROM items WHERE content_hash = ?`, contentHash
            ).toArray();
            if (existingRows.length > 0) {
              results.stored++;
              continue;
            }

            // Get next ID
            const maxIdRows = this.ctx.storage.sql.exec(`SELECT MAX(id) as max_id FROM vectors`).toArray();
            const nextId = ((maxIdRows[0]?.max_id as number) ?? 0) + 1;
            const tokenCount = Math.ceil(item.content.length / 4);
            const embeddingArray = new Float32Array(embedding);

            if (this.vaultState!.vectorCount === 0 && 
                (this.vaultState!.dims === 0 || embeddingArray.length !== this.vaultState!.dims)) {
              this.vaultState!.dims = embeddingArray.length;
              this.index = new WorkersVectorIndex(this.vaultState!.dims);
            }

            this.ctx.storage.sql.exec(
              `INSERT INTO vectors (id, embedding, timestamp, dims) VALUES (?, ?, ?, ?)`,
              nextId, embeddingArray.buffer as ArrayBuffer, timestamp, embeddingArray.length
            );
            this.ctx.storage.sql.exec(
              `INSERT INTO items (id, content, role, content_hash, timestamp, token_count) VALUES (?, ?, ?, ?, ?, ?)`,
              nextId, item.content, role, contentHash, timestamp, tokenCount
            );
            this.index!.add(nextId, embeddingArray, timestamp);
            this.vaultState!.vectorCount++;
            results.stored++;

            // D1 mirror
            if (d1 && memoryKey) {
              const mirrorPromise = mirrorToD1(
                d1, memoryKey, vaultType, sessionId, item.content, role,
                embeddingArray, timestamp, tokenCount, undefined, contentHash
              ).then(() => ({ success: true }))
               .catch(err => {
                 console.error('[D1-MIRROR] Fallback store failed:', err);
                 return { success: false, error: String(err) };
               });
              d1MirrorPromises.push(mirrorPromise);
            }
          } catch (itemError) {
            results.failed++;
            const errMsg = (itemError as Error).message;
            const contentPreview = item.content.slice(0, 50).replace(/\n/g, ' ');
            results.errors.push(`Item ${batchStart + i}: ${errMsg} [${contentPreview}...]`);
            console.error(`[Bulk-Store] Item ${batchStart + i} failed individually: ${errMsg}`);
          }
        }
        
        // Save after fallback processing
        this.vaultState!.lastAccess = Date.now();
        this.saveVaultState();
      }
    }

    // Wait for all D1 mirror operations and track results
    if (d1MirrorPromises.length > 0) {
      const d1Results = await Promise.all(d1MirrorPromises);
      for (const result of d1Results) {
        if (result.success) {
          results.d1ChunksSynced++;
        } else if (result.error) {
          results.d1Errors.push(result.error);
        }
      }
      results.d1Synced = results.d1Errors.length === 0 && results.d1ChunksSynced === d1MirrorPromises.length;
    }

    // Clean up empty arrays before returning
    if (results.errors.length === 0) delete (results as Record<string, unknown>).errors;
    if (results.d1Errors.length === 0) delete (results as Record<string, unknown>).d1Errors;

    return Response.json(results);
  }

  /**
   * Get embeddings from Cloudflare Workers AI (BGE-M3)
   * 1024 dimensions, ~18ms edge latency
   */
  private async getEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.env.AI) {
      throw new Error('Cloudflare AI binding not available');
    }

    // BGE-M3 supports batch embedding
    const response = await this.env.AI.run('@cf/baai/bge-m3', {
      text: texts,
    }) as { data: number[][] };

    return response.data;
  }

  // ==================== Chunked Storage ====================

  /**
   * Process content through chunking buffer.
   * Returns any complete chunks that need to be embedded and stored.
   * 
   * FLOW:
   * 1. Worker calls /process-chunk with new content
   * 2. DO adds to buffer, extracts complete 300-token chunks
   * 3. DO returns chunks that need embedding
   * 4. Worker embeds each chunk and calls /store
   * 
   * REQUEST:  { content: string, role: string }
   * RESPONSE: { chunksToEmbed: string[], bufferTokens: number }
   */
  private async handleStoreChunked(request: Request): Promise<Response> {
    this.loadVectorsIntoMemory();

    const body = await request.json() as {
      content: string;
      role: string;
    };

    const TARGET_TOKENS = 300;
    const OVERLAP_TOKENS = 30;
    const CHARS_PER_TOKEN = 4;

    const estimateTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN);
    const tokensToChars = (tokens: number) => tokens * CHARS_PER_TOKEN;

    // Format content with role and timestamp
    const now = Date.now();
    const formattedContent = `[${body.role.toUpperCase()}] ${body.content}`;

    // Get current pending buffer
    const bufferRows = this.ctx.storage.sql.exec(
      `SELECT content, token_count FROM pending_buffer WHERE id = 1`
    ).toArray();

    let currentBuffer = '';
    if (bufferRows.length > 0) {
      currentBuffer = bufferRows[0].content as string;
    }

    // Combine buffer with new content
    let combined = currentBuffer 
      ? `${currentBuffer}\n\n${formattedContent}`
      : formattedContent;

    let combinedTokens = estimateTokens(combined);
    const chunksToEmbed: string[] = [];

    // Extract full chunks (300+ tokens)
    while (combinedTokens >= TARGET_TOKENS) {
      const targetChars = tokensToChars(TARGET_TOKENS);
      
      // Find split point (prefer sentence boundary)
      let splitPoint = targetChars;
      const searchStart = Math.floor(targetChars * 0.8);
      const searchEnd = Math.min(Math.ceil(targetChars * 1.1), combined.length);
      const searchRegion = combined.slice(searchStart, searchEnd);
      
      const sentenceMatch = searchRegion.match(/[.!?]\s/);
      if (sentenceMatch && sentenceMatch.index !== undefined) {
        splitPoint = searchStart + sentenceMatch.index + 1;
      } else {
        const spaceIndex = combined.lastIndexOf(' ', targetChars);
        if (spaceIndex > targetChars * 0.7) {
          splitPoint = spaceIndex;
        }
      }

      const chunk = combined.slice(0, splitPoint).trim();
      const remainder = combined.slice(splitPoint).trim();
      
      if (chunk) {
        chunksToEmbed.push(chunk);
      }

      if (!remainder) {
        combined = '';
        break;
      }

      // Keep overlap from end of chunk
      const overlapChars = tokensToChars(OVERLAP_TOKENS);
      const overlap = chunk.slice(-overlapChars);
      combined = overlap ? `${overlap} ${remainder}` : remainder;
      combinedTokens = estimateTokens(combined);
    }

    // Update pending buffer
    const newBufferTokens = estimateTokens(combined);
    if (bufferRows.length > 0) {
      this.ctx.storage.sql.exec(
        `UPDATE pending_buffer SET content = ?, token_count = ?, last_updated = ? WHERE id = 1`,
        combined, newBufferTokens, now
      );
    } else {
      this.ctx.storage.sql.exec(
        `INSERT INTO pending_buffer (id, content, token_count, last_updated) VALUES (1, ?, ?, ?)`,
        combined, newBufferTokens, now
      );
    }

    return Response.json({
      chunksToEmbed,
      bufferTokens: newBufferTokens,
      bufferContent: combined,
    });
  }

  /**
   * Get or update the pending buffer.
   * 
   * GET:  Returns current buffer state
   * POST: { action: 'flush' } - Forces buffer to be stored even if < 300 tokens
   */
  private async handleBuffer(request: Request): Promise<Response> {
    this.loadVectorsIntoMemory();

    if (request.method === 'GET') {
      const rows = this.ctx.storage.sql.exec(
        `SELECT content, token_count, last_updated FROM pending_buffer WHERE id = 1`
      ).toArray();

      if (rows.length === 0) {
        return Response.json({ content: '', tokenCount: 0, lastUpdated: null });
      }

      return Response.json({
        content: rows[0].content,
        tokenCount: rows[0].token_count,
        lastUpdated: rows[0].last_updated,
      });
    }

    // POST - handle actions like flush
    const body = await request.json() as { action: string };
    
    if (body.action === 'clear') {
      this.ctx.storage.sql.exec(`DELETE FROM pending_buffer WHERE id = 1`);
      return Response.json({ cleared: true });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  }

  // ==================== Delete ====================

  /**
   * Delete specific vectors by ID or by timestamp.
   * Returns deleted count and bytes (for archival purge tracking).
   */
  private async handleDelete(request: Request): Promise<Response> {
    this.loadVectorsIntoMemory();

    const body = await request.json() as {
      ids?: number[];
      olderThan?: number;
    };

    let deleted = 0;
    let bytesDeleted = 0;

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
      // Count bytes before deleting (for archival purge tracking)
      const bytesRow = this.ctx.storage.sql.exec(
        `SELECT SUM(LENGTH(embedding)) as vec_bytes FROM vectors WHERE timestamp < ?`,
        body.olderThan
      ).one();
      const contentBytesRow = this.ctx.storage.sql.exec(
        `SELECT SUM(LENGTH(content)) as content_bytes FROM items WHERE timestamp < ?`,
        body.olderThan
      ).one();
      
      bytesDeleted = ((bytesRow?.vec_bytes as number) || 0) + 
                     ((contentBytesRow?.content_bytes as number) || 0);

      // Count vectors being deleted
      const countRow = this.ctx.storage.sql.exec(
        `SELECT COUNT(*) as cnt FROM vectors WHERE timestamp < ?`,
        body.olderThan
      ).one();
      deleted = (countRow?.cnt as number) || 0;

      // Now delete
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
      bytesDeleted,
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
      oldestItem: countRow?.oldest ?? null,
      newestItem: countRow?.newest ?? null,
      totalTokens: countRow?.total_tokens ?? 0,
      createdAt: this.vaultState!.createdAt,
      lastAccess: this.vaultState!.lastAccess,
    });
  }

  // ==================== Archival Stats ====================

  /**
   * Get archival storage stats for billing.
   * Returns vectors older than archivalCutoff timestamp.
   * 
   * REQUEST:  { archivalCutoff: number }
   * RESPONSE: { vectorsTotal, vectorsArchived, bytesArchived, oldestAt, newestAt }
   */
  private async handleArchivalStats(request: Request): Promise<Response> {
    this.ensureSchema();

    const body = await request.json() as { archivalCutoff: number };
    const cutoff = body.archivalCutoff;

    // Get total vectors and archived (older than cutoff)
    const statsRow = this.ctx.storage.sql.exec(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN timestamp < ? THEN 1 ELSE 0 END) as archived,
        MIN(timestamp) as oldest,
        MAX(timestamp) as newest
      FROM vectors
    `, cutoff).one();

    // Calculate bytes for archived vectors (embedding BLOBs)
    const bytesRow = this.ctx.storage.sql.exec(`
      SELECT SUM(LENGTH(embedding)) as bytes
      FROM vectors
      WHERE timestamp < ?
    `, cutoff).one();

    // Also count content bytes from items table
    const contentBytesRow = this.ctx.storage.sql.exec(`
      SELECT SUM(LENGTH(content)) as bytes
      FROM items
      WHERE timestamp < ?
    `, cutoff).one();

    const embeddingBytes = (bytesRow?.bytes as number) || 0;
    const contentBytes = (contentBytesRow?.bytes as number) || 0;

    return Response.json({
      vectorsTotal: (statsRow?.total as number) || 0,
      vectorsArchived: (statsRow?.archived as number) || 0,
      bytesArchived: embeddingBytes + contentBytes,
      oldestAt: statsRow?.oldest ? new Date(statsRow.oldest as number).toISOString() : null,
      newestAt: statsRow?.newest ? new Date(statsRow.newest as number).toISOString() : null,
    });
  }

  // ==================== Clear ====================

  private handleClear(): Response {
    this.loadVectorsIntoMemory();

    this.ctx.storage.sql.exec(`DELETE FROM vectors`);
    this.ctx.storage.sql.exec(`DELETE FROM items`);
    this.ctx.storage.sql.exec(`DELETE FROM pending_buffer`);

    this.vaultState = {
      vectorCount: 0,
      dims: this.vaultState?.dims ?? 1024,
      lastAccess: Date.now(),
      createdAt: this.vaultState?.createdAt ?? Date.now(),
    };
    this.saveVaultState();

    this.index = new WorkersVectorIndex(this.vaultState.dims);
    this.loaded = true;

    return Response.json({ cleared: true });
  }

  /**
   * Full reset — clears everything and allows new dimensions.
   * Use this when migrating to a different embedding model.
   */
  private handleReset(request: Request): Response {
    this.ensureSchema();

    // Clear all data
    this.ctx.storage.sql.exec(`DELETE FROM vectors`);
    this.ctx.storage.sql.exec(`DELETE FROM items`);
    this.ctx.storage.sql.exec(`DELETE FROM pending_buffer`);

    // Reset state — allow new dimensions on first store
    this.vaultState = {
      vectorCount: 0,
      dims: 0, // Will be set on first store
      lastAccess: Date.now(),
      createdAt: Date.now(),
    };
    this.saveVaultState();

    // Create a placeholder index (will be recreated on first store)
    this.index = null;
    this.loaded = false;

    return Response.json({ reset: true, dims: 'will-be-set-on-first-store' });
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
      dims: this.vaultState?.dims ?? 1024,
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

  /**
   * Export raw data WITHOUT loading into memory.
   * Safe to call even when vectors have dimension mismatches.
   * Used for migration/re-embedding.
   */
  private handleExportRaw(): Response {
    this.ensureSchema();

    // Just get items (content) — don't need embeddings for re-embedding
    const items = this.ctx.storage.sql.exec(
      `SELECT i.id, i.content, i.role, i.content_hash, i.model, 
              i.request_id, i.token_count, i.timestamp
       FROM items i
       ORDER BY i.timestamp ASC`
    ).toArray();

    return Response.json({
      itemCount: items.length,
      data: items.map(item => ({
        id: item.id,
        timestamp: item.timestamp,
        content: item.content,
        role: item.role,
        model: item.model,
        contentHash: item.content_hash,
        tokenCount: item.token_count,
      })),
    });
  }

  // ==================== Warmth ====================

  /**
   * Check if DO is warm (vectors loaded into memory).
   * Used for smart routing — D1 fallback when cold.
   * 
   * RESPONSE: { isWarm, vectorCount, lastActive, loadedAt }
   */
  private handleWarmth(): Response {
    // Update last active on every warmth check
    this.lastActive = Date.now();
    
    return Response.json({
      isWarm: this.isWarm,
      vectorCount: this.vaultState?.vectorCount ?? 0,
      hotVectors: this.index?.size ?? 0,
      lastActive: this.lastActive,
      loaded: this.loaded,
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

}
