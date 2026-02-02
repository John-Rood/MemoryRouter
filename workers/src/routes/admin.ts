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
  EMBEDDING_PROVIDER?: string;
  MODAL_EMBEDDING_URL?: string;
  OPENAI_API_KEY?: string;
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
 */
function getEmbeddingConfig(env: Env): EmbeddingConfig | undefined {
  if (env.EMBEDDING_PROVIDER === 'modal' && env.MODAL_EMBEDDING_URL) {
    return {
      provider: 'modal',
      modalUrl: env.MODAL_EMBEDDING_URL,
    };
  }
  return undefined;
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
  const openaiKey = env.OPENAI_API_KEY || '';
  
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
          // Generate new embedding with Modal BGE
          const embedding = await generateEmbedding(
            item.content,
            openaiKey,
            'text-embedding-3-large', // fallback model (not used when modal configured)
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
    provider: embeddingConfig?.provider || 'openai',
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
