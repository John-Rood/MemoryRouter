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
import { StorageManager } from './services/storage';

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
  allowHeaders: ['Content-Type', 'Authorization', 'X-Session-ID', 'X-Memory-Mode'],
  exposeHeaders: [
    'X-MR-Processing-Ms',
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

// Mount chat routes
const chatRouter = createChatRouter();
v1.route('/chat', chatRouter);

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

v1.delete('/memory', async (c) => {
  const userContext = c.get('userContext');
  
  // Durable Objects path
  if (c.env.USE_DURABLE_OBJECTS === 'true' && c.env.VAULT_DO) {
    try {
      const doId = c.env.VAULT_DO.idFromName(`${userContext.memoryKey.key}:core`);
      const stub = c.env.VAULT_DO.get(doId);
      await stub.fetch(new Request('https://do/clear', { method: 'POST' }));
      
      return c.json({
        key: userContext.memoryKey.key,
        deleted: true,
        message: 'Memory cleared successfully',
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
