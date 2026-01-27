/**
 * Memory Key Management Routes
 * 
 * GET    /v1/memory-keys      — List memory keys for the user
 * POST   /v1/memory-keys      — Create a new memory key
 * DELETE /v1/memory-keys/:key — Delete (deactivate) a memory key
 * 
 * Reference: memoryrouter-product-spec.md Section 5.7
 */

import { Hono } from 'hono';
import { getUserContext, createMemoryKey, listMemoryKeys, deleteMemoryKey } from '../middleware/auth';
import { clearMemory, getMemoryStats } from '../services/vectorvault';

const keys = new Hono();

/**
 * GET /v1/memory-keys
 * List all memory keys for the authenticated user
 */
keys.get('/', async (c) => {
  const userContext = getUserContext(c);
  const userId = userContext.userId;
  
  const allKeys = await listMemoryKeys(userId);
  
  // Enrich with stats
  const enrichedKeys = await Promise.all(
    allKeys.map(async (keyInfo) => {
      const stats = await getMemoryStats(keyInfo.key);
      return {
        key: keyInfo.key,
        name: keyInfo.name,
        is_active: keyInfo.isActive,
        created_at: keyInfo.createdAt.toISOString(),
        last_used_at: keyInfo.lastUsedAt?.toISOString() ?? null,
        session_count: stats.sessionCount,
        total_chunks: stats.totalChunks,
        total_tokens: stats.totalTokens,
      };
    })
  );
  
  return c.json({
    memory_keys: enrichedKeys,
    total: enrichedKeys.length,
  });
});

/**
 * POST /v1/memory-keys
 * Create a new memory key
 */
keys.post('/', async (c) => {
  const userContext = getUserContext(c);
  const userId = userContext.userId;
  
  let name: string | undefined;
  try {
    const body = await c.req.json();
    name = body.name;
  } catch {
    // No body or invalid JSON — that's fine, name is optional
  }
  
  const newKey = await createMemoryKey(userId, name);
  
  return c.json({
    key: newKey.key,
    name: newKey.name,
    created_at: newKey.createdAt.toISOString(),
  }, 201);
});

/**
 * DELETE /v1/memory-keys/:key
 * Delete (deactivate) a memory key and all its memory
 */
keys.delete('/:key', async (c) => {
  const userContext = getUserContext(c);
  const userId = userContext.userId;
  const key = c.req.param('key');
  
  // Validate the key belongs to this user
  const deleted = await deleteMemoryKey(key, userId);
  
  if (!deleted) {
    return c.json({
      error: {
        type: 'not_found',
        message: `Memory key '${key}' not found or does not belong to you.`,
        code: 'MEMORY_KEY_NOT_FOUND',
      },
    }, 404);
  }
  
  // Clear all memory for this key
  const clearedVaults = await clearMemory(key);
  
  return c.json({
    deleted: true,
    key,
    vaults_cleared: clearedVaults,
  });
});

export default keys;
