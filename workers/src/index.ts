/**
 * MemoryRouter on Cloudflare Workers
 * Model-agnostic AI memory layer with KRONOS temporal retrieval
 * 
 * Now with Durable Objects for sub-ms in-memory vector search.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware, createMemoryKey, UserContext } from './middleware/auth';
import { createChatRouter, ChatEnv } from './routes/chat';
import { createPassthroughRouter } from './routes/passthrough';
import { createAnthropicRouter } from './routes/anthropic';
import { createGoogleRouter } from './routes/google';
import { StorageManager } from './services/storage';
import { handleReembed, handleListKeys, handleClear, handleSetProviderKey, handleGetProviderKeys, handleDebugStorage, handleDoExport } from './routes/admin';
import { getKeyUsage, getTopKeys, rollupDaily, getRecentEvents } from './services/usage';
import { users as usersRouter } from './routes/users';

// Model catalog (updated via scripts/update-models.sh)
import modelCatalog from './config/models.json';

// Re-export VaultDurableObject for Cloudflare DO binding
export { VaultDurableObject } from './durable-objects/vault';

// Import queue handler
import { handleStorageQueue, StorageJob, QueueEnv } from './queues/storage-consumer';

// Environment bindings
interface Env extends ChatEnv {
  ENVIRONMENT: string;
  DEFAULT_EMBEDDING_MODEL: string;
  DEFAULT_EMBEDDING_DIMS: string;
  HOT_WINDOW_HOURS: string;
  WORKING_WINDOW_DAYS: string;
  LONGTERM_WINDOW_DAYS: string;
  // Durable Objects
  VAULT_DO: DurableObjectNamespace;
  USE_DURABLE_OBJECTS: string;
  MAX_IN_MEMORY_VECTORS: string;
  // Queues
  STORAGE_QUEUE: Queue<StorageJob>;
  // Admin
  ADMIN_KEY?: string;
  // Dashboard API
  DASHBOARD_API_KEY?: string;
}

// Variables available in context
type Variables = {
  userContext: UserContext;
};

// Create main app
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Global middleware - expose latency headers
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'X-Session-ID', 'X-Memory-Mode', 'X-Memory-Store', 'X-Memory-Store-Response'],
  exposeHeaders: [
    'X-Embedding-Ms',
    'X-MR-Processing-Ms',
    'X-MR-Overhead-Ms',
    'X-Provider-Response-Ms', 
    'X-Total-Ms',
    'X-Memory-Tokens-Retrieved',
    'X-Memory-Chunks-Retrieved',
    'X-Session-ID'
  ],
}));

// Health check (no auth)
app.get('/', (c) => {
  return c.json({
    name: 'MemoryRouter API',
    version: '2.0.0',
    runtime: 'Cloudflare Workers',
    status: 'ok',
    storage: c.env.USE_DURABLE_OBJECTS === 'true' ? 'durable-objects' : 'kv-r2',
    docs: 'https://docs.memoryrouter.ai',
    endpoints: {
      chat: 'POST /v1/chat/completions',
      memory: 'GET /v1/memory/:key/stats',
    },
  });
});

app.get('/health', (c) => {
  return c.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT,
    storage: c.env.USE_DURABLE_OBJECTS === 'true' ? 'durable-objects' : 'kv-r2',
  });
});

// API v1 routes
const v1 = new Hono<{ Bindings: Env; Variables: Variables }>();

// Auth middleware for all v1 routes
v1.use('*', async (c, next) => {
  const middleware = authMiddleware({ METADATA_KV: c.env.METADATA_KV });
  return middleware(c, next);
});

// Mount chat routes (OpenAI SDK: /v1/chat/completions)
const chatRouter = createChatRouter();
v1.route('/chat', chatRouter);

// Native Anthropic endpoint: POST /v1/messages
// Returns Anthropic's native response format for Anthropic SDK compatibility
const anthropicRouter = createAnthropicRouter();
v1.route('/', anthropicRouter);  // Mounts at /v1/messages

// Native Google endpoint: POST /v1/models/{model}:generateContent
// Returns Google's native response format for Google SDK compatibility
const googleRouter = createGoogleRouter();
v1.route('/', googleRouter);  // Mounts at /v1/models/:modelAction

// Mount pass-through routes (embeddings, audio, images, legacy completions)
const passthroughRouter = createPassthroughRouter();
v1.route('/', passthroughRouter);  // Mounts at /v1/embeddings, /v1/audio/*, /v1/images/*, /v1/completions

// Memory management routes
v1.get('/memory/stats', async (c) => {
  const userContext = c.get('userContext');
  
  // Durable Objects path
  if (c.env.USE_DURABLE_OBJECTS === 'true' && c.env.VAULT_DO) {
    try {
      const doId = c.env.VAULT_DO.idFromName(`${userContext.memoryKey.key}:core`);
      const stub = c.env.VAULT_DO.get(doId);
      const response = await stub.fetch(new Request('https://do/stats'));
      const stats = await response.json() as Record<string, unknown>;
      
      return c.json({
        key: userContext.memoryKey.key,
        storage: 'durable-objects',
        ...stats,
        kronos_config: {
          hot_window_hours: parseInt(c.env.HOT_WINDOW_HOURS || '4'),
          working_window_days: parseInt(c.env.WORKING_WINDOW_DAYS || '3'),
          longterm_window_days: parseInt(c.env.LONGTERM_WINDOW_DAYS || '90'),
        },
      });
    } catch (error) {
      console.error('Failed to get DO memory stats:', error);
      return c.json({ 
        error: 'Failed to retrieve memory stats',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }
  
  // Legacy KV+R2 path
  const storage = new StorageManager({
    VECTORS_KV: c.env.VECTORS_KV,
    METADATA_KV: c.env.METADATA_KV,
    VECTORS_R2: c.env.VECTORS_R2,
  });
  
  try {
    const stats = await storage.getStats(userContext.memoryKey.key);
    const manifest = await storage.getManifest(userContext.memoryKey.key);
    
    return c.json({
      key: userContext.memoryKey.key,
      storage: 'kv-r2',
      total_vectors: stats.totalVectors,
      total_bytes: stats.totalBytes,
      shard_count: stats.shardCount,
      hot_shard_size: stats.hotShardSize,
      created_at: new Date(manifest.createdAt).toISOString(),
      updated_at: new Date(manifest.updatedAt).toISOString(),
      kronos_config: {
        hot_window_hours: parseInt(c.env.HOT_WINDOW_HOURS || '4'),
        working_window_days: parseInt(c.env.WORKING_WINDOW_DAYS || '3'),
        longterm_window_days: parseInt(c.env.LONGTERM_WINDOW_DAYS || '90'),
      },
    });
  } catch (error) {
    console.error('Failed to get memory stats:', error);
    return c.json({ 
      error: 'Failed to retrieve memory stats',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Warmup endpoint - pre-loads vectors into memory for faster first request
v1.post('/memory/warmup', async (c) => {
  const userContext = c.get('userContext');
  const sessionId = c.req.header('X-Session-ID');
  
  if (c.env.USE_DURABLE_OBJECTS !== 'true' || !c.env.VAULT_DO) {
    return c.json({ error: 'Warmup only available with Durable Objects' }, 400);
  }
  
  try {
    const warmupPromises: Promise<{ vault: string; vectors: number; timeMs: number }>[] = [];
    
    // Warmup core vault
    const coreId = c.env.VAULT_DO.idFromName(`${userContext.memoryKey.key}:core`);
    const coreStub = c.env.VAULT_DO.get(coreId);
    warmupPromises.push(
      (async () => {
        const start = Date.now();
        const res = await coreStub.fetch(new Request('https://do/stats'));
        const stats = await res.json() as { vectorCount?: number };
        return { vault: 'core', vectors: stats.vectorCount ?? 0, timeMs: Date.now() - start };
      })()
    );
    
    // Warmup session vault if provided
    if (sessionId) {
      const sessionId2 = c.env.VAULT_DO.idFromName(`${userContext.memoryKey.key}:session:${sessionId}`);
      const sessionStub = c.env.VAULT_DO.get(sessionId2);
      warmupPromises.push(
        (async () => {
          const start = Date.now();
          const res = await sessionStub.fetch(new Request('https://do/stats'));
          const stats = await res.json() as { vectorCount?: number };
          return { vault: 'session', vectors: stats.vectorCount ?? 0, timeMs: Date.now() - start };
        })()
      );
    }
    
    const results = await Promise.all(warmupPromises);
    const totalVectors = results.reduce((sum, r) => sum + r.vectors, 0);
    const maxTime = Math.max(...results.map(r => r.timeMs));
    
    return c.json({
      status: 'warm',
      key: userContext.memoryKey.key,
      vaults: results,
      totalVectors,
      warmupTimeMs: maxTime,
    });
  } catch (error) {
    console.error('Warmup failed:', error);
    return c.json({ 
      error: 'Warmup failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Get available models based on configured provider keys
// Model catalog is updated via scripts/update-models.sh (zero runtime cost)
v1.get('/models', async (c) => {
  const userContext = c.get('userContext');
  const providers = userContext.providerKeys;
  
  // Use pre-fetched model catalog (from OpenRouter API, updated via cron)
  const catalog = modelCatalog.providers as Record<string, string[]>;
  
  // Build available models based on which providers have keys
  const available: { provider: string; models: string[] }[] = [];
  
  // Map provider keys to catalog keys
  const providerMap: Record<string, { key: keyof typeof providers; catalogKey: string; displayName: string }[]> = {
    openai: [{ key: 'openai', catalogKey: 'openai', displayName: 'OpenAI' }],
    anthropic: [{ key: 'anthropic', catalogKey: 'anthropic', displayName: 'Anthropic' }],
    google: [{ key: 'google', catalogKey: 'google', displayName: 'Google' }],
    meta: [{ key: 'openrouter', catalogKey: 'meta', displayName: 'Meta/Llama' }],
    mistral: [{ key: 'openrouter', catalogKey: 'mistral', displayName: 'Mistral' }],
    deepseek: [{ key: 'openrouter', catalogKey: 'deepseek', displayName: 'DeepSeek' }],
    xai: [{ key: 'xai', catalogKey: 'xai', displayName: 'xAI' }],
  };
  
  // Add providers where user has API keys
  if (providers.openai && catalog.openai) {
    available.push({ provider: 'OpenAI', models: catalog.openai });
  }
  if (providers.anthropic && catalog.anthropic) {
    available.push({ provider: 'Anthropic', models: catalog.anthropic });
  }
  if (providers.google && catalog.google) {
    available.push({ provider: 'Google', models: catalog.google });
  }
  if (providers.xai && catalog.xai) {
    available.push({ provider: 'xAI', models: catalog.xai });
  }
  
  // OpenRouter gives access to many providers
  if (providers.openrouter) {
    if (catalog.meta) available.push({ provider: 'Meta/Llama', models: catalog.meta });
    if (catalog.mistral) available.push({ provider: 'Mistral', models: catalog.mistral });
    if (catalog.deepseek) available.push({ provider: 'DeepSeek', models: catalog.deepseek });
  }
  
  // Flatten for convenience
  const allModels = available.flatMap(p => p.models);
  
  return c.json({
    providers: available,
    models: allModels,
    default: allModels[0] || 'openai/gpt-4o-mini',
    catalog_updated: modelCatalog.fetched_at,
  });
});

v1.delete('/memory', async (c) => {
  const userContext = c.get('userContext');
  const sessionId = c.req.header('X-Session-ID');
  // Use ?reset=true to fully reset (allows new embedding dimensions)
  const fullReset = c.req.query('reset') === 'true';
  const endpoint = fullReset ? '/reset' : '/clear';
  
  // Durable Objects path
  if (c.env.USE_DURABLE_OBJECTS === 'true' && c.env.VAULT_DO) {
    try {
      const clearPromises: Promise<Response>[] = [];
      
      // Clear/reset core vault
      const coreId = c.env.VAULT_DO.idFromName(`${userContext.memoryKey.key}:core`);
      const coreStub = c.env.VAULT_DO.get(coreId);
      clearPromises.push(coreStub.fetch(new Request(`https://do${endpoint}`, { method: 'POST' })));
      
      // Clear/reset session vault if session ID provided
      if (sessionId) {
        const sessionDoId = c.env.VAULT_DO.idFromName(`${userContext.memoryKey.key}:session:${sessionId}`);
        const sessionStub = c.env.VAULT_DO.get(sessionDoId);
        clearPromises.push(sessionStub.fetch(new Request(`https://do${endpoint}`, { method: 'POST' })));
      }
      
      await Promise.all(clearPromises);
      
      return c.json({
        key: userContext.memoryKey.key,
        sessionCleared: !!sessionId,
        deleted: true,
        reset: fullReset,
        message: fullReset ? 'Memory reset (new dimensions allowed)' : 'Memory cleared successfully',
      });
    } catch (error) {
      console.error('Failed to clear DO memory:', error);
      return c.json({ 
        error: 'Failed to delete memory',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }
  
  // Legacy KV+R2 path
  const storage = new StorageManager({
    VECTORS_KV: c.env.VECTORS_KV,
    METADATA_KV: c.env.METADATA_KV,
    VECTORS_R2: c.env.VECTORS_R2,
  });
  
  try {
    await storage.deleteMemoryKey(userContext.memoryKey.key);
    return c.json({
      key: userContext.memoryKey.key,
      deleted: true,
      message: 'Memory cleared successfully',
    });
  } catch (error) {
    console.error('Failed to delete memory:', error);
    return c.json({ 
      error: 'Failed to delete memory',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ========== Account Usage Endpoint ==========
// GET /v1/account/usage?start=YYYY-MM-DD&end=YYYY-MM-DD
v1.get('/account/usage', async (c) => {
  const userContext = c.get('userContext');
  
  if (!c.env.VECTORS_D1) {
    return c.json({ error: 'Usage tracking not available' }, 503);
  }

  // Parse date range (default: last 30 days)
  const endDate = c.req.query('end') || new Date().toISOString().split('T')[0];
  const startDefault = new Date();
  startDefault.setUTCDate(startDefault.getUTCDate() - 30);
  const startDate = c.req.query('start') || startDefault.toISOString().split('T')[0];

  try {
    const usage = await getKeyUsage(
      c.env.VECTORS_D1,
      userContext.memoryKey.key,
      startDate,
      endDate
    );

    return c.json({
      key: userContext.memoryKey.key,
      period: { start: startDate, end: endDate },
      ...usage,
    });
  } catch (error) {
    console.error('Failed to get usage:', error);
    return c.json({ 
      error: 'Failed to retrieve usage data',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Key management
v1.post('/keys', async (c) => {
  const body = await c.req.json() as { name?: string };
  const userContext = c.get('userContext');
  
  try {
    const newKey = await createMemoryKey(
      userContext.userId,
      body.name || 'New Key',
      c.env.METADATA_KV
    );
    
    return c.json({
      key: newKey.key,
      name: newKey.name,
      created_at: new Date(newKey.createdAt).toISOString(),
    }, 201);
  } catch (error) {
    console.error('Failed to create key:', error);
    return c.json({ 
      error: 'Failed to create memory key',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Mount v1 routes
app.route('/v1', v1);

// Admin routes (separate auth, not under v1)
app.post('/admin/reembed', async (c) => {
  return handleReembed(c.req.raw, c.env as any);
});

app.get('/admin/keys', async (c) => {
  return handleListKeys(c.req.raw, c.env as any);
});

app.post('/admin/clear', async (c) => {
  return handleClear(c.req.raw, c.env as any);
});

app.post('/admin/provider-keys', async (c) => {
  return handleSetProviderKey(c.req.raw, c.env as any);
});

app.get('/admin/provider-keys', async (c) => {
  return handleGetProviderKeys(c.req.raw, c.env as any);
});

app.get('/admin/debug-storage', async (c) => {
  return handleDebugStorage(c.req.raw, c.env as any);
});

app.get('/admin/do-export', async (c) => {
  return handleDoExport(c.req.raw, c.env as any);
});

// ========== User Management API (Dashboard) ==========
// Mount user management routes for dashboard to call
app.route('/api/users', usersRouter);

// ========== Admin Usage Endpoints ==========
// GET /admin/usage/top?limit=10&start=YYYY-MM-DD&end=YYYY-MM-DD
app.get('/admin/usage/top', async (c) => {
  // Simple admin auth via header (same pattern as other admin routes)
  const adminKey = c.req.header('X-Admin-Key');
  if (!adminKey || adminKey !== c.env.ADMIN_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!c.env.VECTORS_D1) {
    return c.json({ error: 'Usage tracking not available' }, 503);
  }

  const limit = parseInt(c.req.query('limit') || '10');
  const endDate = c.req.query('end') || new Date().toISOString().split('T')[0];
  const startDefault = new Date();
  startDefault.setUTCDate(startDefault.getUTCDate() - 30);
  const startDate = c.req.query('start') || startDefault.toISOString().split('T')[0];

  try {
    const topKeys = await getTopKeys(c.env.VECTORS_D1, limit, startDate, endDate);
    return c.json({
      period: { start: startDate, end: endDate },
      limit,
      keys: topKeys,
    });
  } catch (error) {
    console.error('Failed to get top keys:', error);
    return c.json({ 
      error: 'Failed to retrieve top keys',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// GET /admin/usage/key/:key — Usage for specific key
app.get('/admin/usage/key/:key', async (c) => {
  const adminKey = c.req.header('X-Admin-Key');
  if (!adminKey || adminKey !== c.env.ADMIN_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!c.env.VECTORS_D1) {
    return c.json({ error: 'Usage tracking not available' }, 503);
  }

  const memoryKey = c.req.param('key');
  const endDate = c.req.query('end') || new Date().toISOString().split('T')[0];
  const startDefault = new Date();
  startDefault.setUTCDate(startDefault.getUTCDate() - 30);
  const startDate = c.req.query('start') || startDefault.toISOString().split('T')[0];

  try {
    const usage = await getKeyUsage(c.env.VECTORS_D1, memoryKey, startDate, endDate);
    return c.json({
      key: memoryKey,
      period: { start: startDate, end: endDate },
      ...usage,
    });
  } catch (error) {
    console.error('Failed to get key usage:', error);
    return c.json({ 
      error: 'Failed to retrieve key usage',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// GET /admin/usage/key/:key/events — Recent raw events (debugging)
app.get('/admin/usage/key/:key/events', async (c) => {
  const adminKey = c.req.header('X-Admin-Key');
  if (!adminKey || adminKey !== c.env.ADMIN_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!c.env.VECTORS_D1) {
    return c.json({ error: 'Usage tracking not available' }, 503);
  }

  const memoryKey = c.req.param('key');
  const limit = parseInt(c.req.query('limit') || '50');

  try {
    const events = await getRecentEvents(c.env.VECTORS_D1, memoryKey, limit);
    return c.json({
      key: memoryKey,
      limit,
      events,
    });
  } catch (error) {
    console.error('Failed to get events:', error);
    return c.json({ 
      error: 'Failed to retrieve events',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// POST /admin/usage/rollup — Manually trigger daily rollup
app.post('/admin/usage/rollup', async (c) => {
  const adminKey = c.req.header('X-Admin-Key');
  if (!adminKey || adminKey !== c.env.ADMIN_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!c.env.VECTORS_D1) {
    return c.json({ error: 'Usage tracking not available' }, 503);
  }

  try {
    const result = await rollupDaily(c.env.VECTORS_D1);
    return c.json({
      status: 'complete',
      ...result,
    });
  } catch (error) {
    console.error('Rollup failed:', error);
    return c.json({ 
      error: 'Rollup failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// 404 handler
app.notFound((c) => {
  return c.json({
    error: 'Not Found',
    path: c.req.path,
    hint: 'Available endpoints: POST /v1/chat/completions, GET /v1/memory/stats',
  }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('[ERROR]', err);
  return c.json({
    error: 'Internal Server Error',
    message: err.message,
  }, 500);
});

// Export for Cloudflare Workers
export default {
  fetch: app.fetch,
  
  // Queue consumer for decoupled storage
  async queue(batch: MessageBatch<StorageJob>, env: QueueEnv): Promise<void> {
    await handleStorageQueue(batch, env);
  },
};
