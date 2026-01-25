/**
 * MemoryRouter API Server
 * Main entry point
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authMiddleware } from './middleware/auth';
import chatRoutes from './routes/chat';

const app = new Hono();

// Global middleware
app.use('*', cors());
app.use('*', logger());

// Health check (no auth required)
app.get('/', (c) => {
  return c.json({
    name: 'MemoryRouter API',
    version: '1.0.0',
    status: 'ok',
    docs: 'https://docs.memoryrouter.ai',
  });
});

app.get('/health', (c) => {
  return c.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// API v1 routes (auth required)
const v1 = new Hono();
v1.use('*', authMiddleware);

// Mount chat routes
v1.route('/chat', chatRoutes);

// Memory management routes (placeholder)
v1.get('/memory/:key/stats', async (c) => {
  const key = c.req.param('key');
  return c.json({
    key,
    total_chunks: 0,
    total_tokens: 0,
    last_used: null,
    message: 'Memory stats (stub)',
  });
});

v1.delete('/memory/:key', async (c) => {
  const key = c.req.param('key');
  return c.json({
    key,
    deleted: true,
    message: 'Memory cleared (stub)',
  });
});

// Mount v1 routes
app.route('/v1', v1);

// 404 handler
app.notFound((c) => {
  return c.json({
    error: 'Not Found',
    path: c.req.path,
    hint: 'Available endpoints: POST /v1/chat/completions',
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

// Start server
const port = parseInt(process.env.PORT ?? '3000', 10);

console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║   ███╗   ███╗███████╗███╗   ███╗ ██████╗ ██████╗ ██╗   ██╗      ║
║   ████╗ ████║██╔════╝████╗ ████║██╔═══██╗██╔══██╗╚██╗ ██╔╝      ║
║   ██╔████╔██║█████╗  ██╔████╔██║██║   ██║██████╔╝ ╚████╔╝       ║
║   ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║██║   ██║██╔══██╗  ╚██╔╝        ║
║   ██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║╚██████╔╝██║  ██║   ██║         ║
║   ╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝         ║
║                                                                  ║
║   ROUTER - Model-Agnostic AI Memory Layer                       ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝

🚀 Server starting on http://localhost:${port}
📖 API: POST /v1/chat/completions
🔑 Auth: Bearer mk_xxx (memory key)

Test with:
  curl -X POST http://localhost:${port}/v1/chat/completions \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer mk_test_key" \\
    -d '{"model":"openai/gpt-4","messages":[{"role":"user","content":"Hello!"}]}'

`);

serve({
  fetch: app.fetch,
  port,
});

export default app;
