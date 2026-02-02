/**
 * Admin Routes — MemoryRouter
 * 
 * Provides:
 * - POST /admin/reembed — Re-embed all vectors with current embedding provider
 * - GET /admin/keys — List all memory keys
 */

import { generateEmbedding, EmbeddingConfig } from '../services/providers';

interface Env {
  METADATA_KV: KVNamespace;
  VAULT_DO: DurableObjectNamespace;
  ADMIN_SECRET?: string;
  AI: Ai;  // Cloudflare Workers AI binding (embeddings)
}

interface ExportedItem {
  id: number;
  timestamp: number;
  content: string;
  role: string;
  model: string;
  contentHash: string;
  tokenCount: number;
}

interface ExportRawResponse {
  itemCount: number;
  data: ExportedItem[];
}

/**
 * Verify admin authorization
 */
function verifyAdmin(request: Request, env: Env): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;
  
  const token = authHeader.replace('Bearer ', '');
  // Accept either ADMIN_SECRET or a valid memory key starting with mk_admin
  return token === env.ADMIN_SECRET || token.startsWith('mk_admin');
}

/**
 * Get embedding config from environment
 * Cloudflare Workers AI only — no fallbacks
 */
function getEmbeddingConfig(env: Env): EmbeddingConfig | undefined {
  if (!env.AI) {
    console.error('[admin] Cloudflare AI binding not available');
    return undefined;
  }
  return { ai: env.AI };
}

/**
 * List all memory keys
 */
async function listMemoryKeys(env: Env): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  
  do {
    const result = await env.METADATA_KV.list({
      prefix: 'auth:',
      cursor,
    });
    
    for (const key of result.keys) {
      // Extract memory key from "auth:mk_xxx" format
      const memoryKey = key.name.replace('auth:', '');
      keys.push(memoryKey);
    }
    
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  
  return keys;
}

/**
 * Get vault stub for a memory key
 * Vault ID format: {memoryKey}:{vaultType} (e.g., "mk_xxx:core")
 */
function getVaultStub(memoryKey: string, vaultType: string, env: Env): DurableObjectStub {
  const vaultId = env.VAULT_DO.idFromName(`${memoryKey}:${vaultType}`);
  return env.VAULT_DO.get(vaultId);
}

/**
 * POST /admin/reembed
 * 
 * Re-embed all vectors across all memory keys with the current embedding provider (Modal BGE).
 * This is a long-running operation.
 */
export async function handleReembed(request: Request, env: Env): Promise<Response> {
  if (!verifyAdmin(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const embeddingConfig = getEmbeddingConfig(env);
  if (!embeddingConfig) {
    return Response.json({ error: 'Cloudflare AI binding not available' }, { status: 500 });
  }
  
  const results: Array<{
    memoryKey: string;
    originalCount: number;
    reembeddedCount: number;
    newDims: number;
    error?: string;
  }> = [];

  // Get all memory keys
  const memoryKeys = await listMemoryKeys(env);
  
  for (const memoryKey of memoryKeys) {
    try {
      const stub = getVaultStub(memoryKey, 'core', env);
      
      // Export current data (raw, bypasses dimension check)
      const exportRes = await stub.fetch(new Request('http://do/export-raw'));
      if (!exportRes.ok) {
        results.push({
          memoryKey,
          originalCount: 0,
          reembeddedCount: 0,
          newDims: 0,
          error: `Export failed: ${exportRes.status}`,
        });
        continue;
      }
      
      const exportData = await exportRes.json() as ExportRawResponse;
      
      if (exportData.itemCount === 0) {
        continue; // Skip empty vaults
      }
      
      // Reset the vault (allows new dimensions)
      await stub.fetch(new Request('http://do/reset', { method: 'POST' }));
      
      // Re-embed and store each item
      let reembeddedCount = 0;
      let newDims = 0;
      
      for (const item of exportData.data) {
        try {
          // Generate new embedding with Cloudflare BGE-M3
          const embedding = await generateEmbedding(
            item.content,
            undefined,
            undefined,
            embeddingConfig
          );
          
          newDims = embedding.length;
          
          // Store with new embedding
          const storeRes = await stub.fetch(new Request('http://do/store', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              embedding: Array.from(embedding),
              content: item.content,
              role: item.role,
              model: item.model,
              requestId: item.contentHash,
            }),
          }));
          
          if (storeRes.ok) {
            reembeddedCount++;
          }
        } catch (err) {
          console.error(`Failed to re-embed item ${item.id}:`, err);
        }
      }
      
      results.push({
        memoryKey,
        originalCount: exportData.itemCount,
        reembeddedCount,
        newDims,
      });
      
    } catch (err) {
      results.push({
        memoryKey,
        originalCount: 0,
        reembeddedCount: 0,
        newDims: 0,
        error: String(err),
      });
    }
  }

  const totalOriginal = results.reduce((sum, r) => sum + r.originalCount, 0);
  const totalReembedded = results.reduce((sum, r) => sum + r.reembeddedCount, 0);

  return Response.json({
    status: 'complete',
    provider: 'cloudflare',
    totalKeys: memoryKeys.length,
    totalOriginal,
    totalReembedded,
    results,
  });
}

/**
 * GET /admin/keys
 * 
 * List all memory keys and their vector counts.
 */
/**
 * POST /admin/clear
 * 
 * Clear all vectors for a specific memory key.
 */
export async function handleClear(request: Request, env: Env): Promise<Response> {
  if (!verifyAdmin(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const memoryKey = url.searchParams.get('key');
  
  if (!memoryKey) {
    return Response.json({ error: 'Missing ?key= parameter' }, { status: 400 });
  }

  try {
    const stub = getVaultStub(memoryKey, 'core', env);
    const resetRes = await stub.fetch(new Request('http://do/reset', { method: 'POST' }));
    const result = await resetRes.json();
    
    return Response.json({
      status: 'cleared',
      memoryKey,
      ...result,
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /admin/provider-keys
 * 
 * Set provider API keys for a memory key.
 * Body: { memoryKey: "mk_xxx", provider: "anthropic", apiKey: "sk-..." }
 */
export async function handleSetProviderKey(request: Request, env: Env): Promise<Response> {
  if (!verifyAdmin(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as { 
      memoryKey: string; 
      provider: string; 
      apiKey: string;
    };
    
    if (!body.memoryKey || !body.provider || !body.apiKey) {
      return Response.json({ 
        error: 'Missing required fields',
        required: ['memoryKey', 'provider', 'apiKey'],
      }, { status: 400 });
    }

    // Validate provider
    const validProviders = ['openai', 'anthropic', 'openrouter', 'google', 'xai', 'cerebras', 'deepseek', 'azure', 'ollama', 'mistral'];
    if (!validProviders.includes(body.provider)) {
      return Response.json({ 
        error: 'Invalid provider',
        validProviders,
      }, { status: 400 });
    }

    // Get memory key info to find userId
    const keyInfo = await env.METADATA_KV.get(`auth:${body.memoryKey}`, 'json') as { userId: string } | null;
    if (!keyInfo) {
      return Response.json({ error: 'Memory key not found' }, { status: 404 });
    }

    // Load existing provider keys
    const existingKeys = await env.METADATA_KV.get(`user:${keyInfo.userId}:provider_keys`, 'json') as Record<string, string> || {};
    
    // Update with new key
    existingKeys[body.provider] = body.apiKey;
    
    // Save
    await env.METADATA_KV.put(`user:${keyInfo.userId}:provider_keys`, JSON.stringify(existingKeys));

    return Response.json({
      status: 'updated',
      memoryKey: body.memoryKey,
      provider: body.provider,
      configuredProviders: Object.keys(existingKeys),
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * GET /admin/provider-keys?key=mk_xxx
 * 
 * List configured providers for a memory key (not the actual keys, just which are configured).
 */
export async function handleGetProviderKeys(request: Request, env: Env): Promise<Response> {
  if (!verifyAdmin(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const memoryKey = url.searchParams.get('key');
  
  if (!memoryKey) {
    return Response.json({ error: 'Missing ?key= parameter' }, { status: 400 });
  }

  // Get memory key info to find userId
  const keyInfo = await env.METADATA_KV.get(`auth:${memoryKey}`, 'json') as { userId: string } | null;
  if (!keyInfo) {
    return Response.json({ error: 'Memory key not found' }, { status: 404 });
  }

  // Load existing provider keys
  const existingKeys = await env.METADATA_KV.get(`user:${keyInfo.userId}:provider_keys`, 'json') as Record<string, string> || {};
  
  // Return which providers are configured (not the actual keys)
  return Response.json({
    memoryKey,
    configuredProviders: Object.keys(existingKeys),
    providers: Object.entries(existingKeys).map(([provider, key]) => ({
      provider,
      configured: true,
      keyPreview: `${key.substring(0, 8)}...${key.substring(key.length - 4)}`,
    })),
  });
}

export async function handleListKeys(request: Request, env: Env): Promise<Response> {
  if (!verifyAdmin(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const memoryKeys = await listMemoryKeys(env);
  
  const keyStats: Array<{
    memoryKey: string;
    vectorCount: number;
    dims: number;
  }> = [];

  for (const memoryKey of memoryKeys) {
    try {
      const stub = getVaultStub(memoryKey, 'core', env);
      const statsRes = await stub.fetch(new Request('http://do/stats'));
      
      if (statsRes.ok) {
        const stats = await statsRes.json() as { vectorCount: number; dims: number };
        if (stats.vectorCount > 0) {
          keyStats.push({
            memoryKey,
            vectorCount: stats.vectorCount,
            dims: stats.dims,
          });
        }
      }
    } catch {
      // Skip failed vaults
    }
  }

  return Response.json({
    totalKeys: memoryKeys.length,
    activeKeys: keyStats.length,
    keys: keyStats,
  });
}

/**
 * GET /admin/debug-storage
 * 
 * Compare DO and D1 storage for a specific memory key.
 * Shows exactly what's in each store to debug sync issues.
 */
/**
 * GET /admin/do-export
 * 
 * Export all items from a DO vault for debugging.
 */
export async function handleDoExport(request: Request, env: Env): Promise<Response> {
  if (!verifyAdmin(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const memoryKey = url.searchParams.get('key');
  
  if (!memoryKey) {
    return Response.json({ error: 'Missing ?key= parameter' }, { status: 400 });
  }

  try {
    const stub = getVaultStub(memoryKey, 'core', env);
    const exportRes = await stub.fetch(new Request('http://do/export'));
    
    if (!exportRes.ok) {
      return Response.json({ error: `DO export failed: ${exportRes.status}` }, { status: 500 });
    }
    
    return new Response(exportRes.body, {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function handleDebugStorage(request: Request, env: Env & { VECTORS_D1?: D1Database }): Promise<Response> {
  if (!verifyAdmin(request, env)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const memoryKey = url.searchParams.get('key');
  
  if (!memoryKey) {
    return Response.json({ error: 'Missing ?key= parameter' }, { status: 400 });
  }

  const results: {
    memoryKey: string;
    do: {
      vectorCount: number;
      totalTokens: number;
      oldest: number | null;
      newest: number | null;
      error?: string;
    } | null;
    d1: {
      chunkCount: number;
      totalTokens: number;
      oldest: number | null;
      newest: number | null;
      error?: string;
    } | null;
    analysis: string[];
  } = {
    memoryKey,
    do: null,
    d1: null,
    analysis: [],
  };

  // Query DO
  try {
    const stub = getVaultStub(memoryKey, 'core', env);
    const statsRes = await stub.fetch(new Request('http://do/stats'));
    
    if (statsRes.ok) {
      const stats = await statsRes.json() as {
        totalVectors: number;
        totalTokens: number;
        oldestItem: number | null;
        newestItem: number | null;
      };
      results.do = {
        vectorCount: stats.totalVectors,
        totalTokens: stats.totalTokens,
        oldest: stats.oldestItem,
        newest: stats.newestItem,
      };
    } else {
      results.do = { vectorCount: 0, totalTokens: 0, oldest: null, newest: null, error: `HTTP ${statsRes.status}` };
    }
  } catch (e) {
    results.do = { vectorCount: 0, totalTokens: 0, oldest: null, newest: null, error: String(e) };
  }

  // Query D1
  if (env.VECTORS_D1) {
    try {
      const d1Stats = await env.VECTORS_D1.prepare(`
        SELECT 
          COUNT(*) as chunk_count,
          SUM(token_count) as total_tokens,
          MIN(timestamp) as oldest,
          MAX(timestamp) as newest
        FROM chunks 
        WHERE memory_key = ?
      `).bind(memoryKey).first();

      results.d1 = {
        chunkCount: (d1Stats?.chunk_count as number) ?? 0,
        totalTokens: (d1Stats?.total_tokens as number) ?? 0,
        oldest: (d1Stats?.oldest as number) ?? null,
        newest: (d1Stats?.newest as number) ?? null,
      };
    } catch (e) {
      results.d1 = { chunkCount: 0, totalTokens: 0, oldest: null, newest: null, error: String(e) };
    }
  } else {
    results.d1 = { chunkCount: 0, totalTokens: 0, oldest: null, newest: null, error: 'VECTORS_D1 not configured' };
  }

  // Analysis
  if (results.do && results.d1) {
    if (results.do.vectorCount === results.d1.chunkCount) {
      results.analysis.push('✅ DO and D1 have same count — in sync');
    } else if (results.do.vectorCount > results.d1.chunkCount) {
      results.analysis.push(`⚠️ DO has ${results.do.vectorCount - results.d1.chunkCount} more items than D1 — D1 mirror failing?`);
    } else {
      results.analysis.push(`⚠️ D1 has ${results.d1.chunkCount - results.do.vectorCount} more items than DO — DO storage failing?`);
    }
    
    if (results.do.totalTokens !== results.d1.totalTokens) {
      results.analysis.push(`Token count mismatch: DO=${results.do.totalTokens}, D1=${results.d1.totalTokens}`);
    }
  }

  return Response.json(results);
}
