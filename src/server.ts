/**
 * MemoryRouter API Server
 * 
 * Main entry point — mounts all routes.
 * 
 * Endpoints (from spec Section 5):
 *   POST   /v1/chat/completions    — OpenAI-compatible inference (drop-in proxy)
 *   POST   /v1/messages            — Anthropic Messages API compatible
 *   GET    /v1/sessions            — List sessions for memory key
 *   GET    /v1/sessions/:id        — Get session info
 *   DELETE /v1/sessions/:id        — Delete session
 *   GET    /v1/memory-keys         — List memory keys
 *   POST   /v1/memory-keys         — Create memory key
 *   DELETE /v1/memory-keys/:key    — Delete key
 *   GET    /v1/billing             — Billing overview
 *   POST   /webhooks/stripe        — Stripe webhooks
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authMiddleware } from './middleware/auth';
import chatRoutes from './routes/chat';
import messagesRoutes from './routes/messages';
import sessionsRoutes from './routes/sessions';
import keysRoutes from './routes/keys';
import { billingRoutes, webhookRoutes, quotaCheckMiddleware } from './billing';

const app = new Hono();

// =============================================================================
// GLOBAL MIDDLEWARE
// =============================================================================

app.use('*', cors());
app.use('*', logger());

// =============================================================================
// PUBLIC ROUTES (no auth)
// =============================================================================

app.get('/', (c) => {
  return c.json({
    name: 'MemoryRouter API',
    version: '1.0.0',
    status: 'ok',
    tagline: 'Same memory, any model.',
    docs: 'https://docs.memoryrouter.ai',
    endpoints: {
      chat: 'POST /v1/chat/completions',
      messages: 'POST /v1/messages',
      sessions: 'GET /v1/sessions',
      memory_keys: 'GET /v1/memory-keys',
      billing: 'GET /v1/billing',
    },
  });
});

app.get('/health', (c) => {
  return c.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Stripe webhooks (verified by signature, not Bearer token)
app.route('/webhooks', webhookRoutes);

// =============================================================================
// AUTHENTICATED v1 ROUTES
// =============================================================================

const v1 = new Hono();
v1.use('*', authMiddleware);

// Apply quota check to inference endpoints
v1.use('/chat/*', quotaCheckMiddleware);
v1.use('/messages', quotaCheckMiddleware);

// Inference endpoints (drop-in proxy)
v1.route('/chat', chatRoutes);
v1.route('/messages', messagesRoutes);

// Session management
v1.route('/sessions', sessionsRoutes);

// Memory key management
v1.route('/memory-keys', keysRoutes);

// Billing
v1.route('/billing', billingRoutes);

// Memory stats (convenience endpoint)
v1.get('/memory/:key/stats', async (c) => {
  const { getMemoryStats } = await import('./services/vectorvault');
  const key = c.req.param('key');
  const stats = await getMemoryStats(key);
  return c.json({
    key,
    total_chunks: stats.totalChunks,
    total_tokens: stats.totalTokens,
    session_count: stats.sessionCount,
    last_used: stats.lastUsed?.toISOString() ?? null,
  });
});

// Clear memory for a key
v1.delete('/memory/:key', async (c) => {
  const { clearMemory } = await import('./services/vectorvault');
  const key = c.req.param('key');
  const cleared = await clearMemory(key);
  return c.json({
    key,
    deleted: true,
    vaults_cleared: cleared,
  });
});

// Mount v1 routes
app.route('/v1', v1);

// =============================================================================
// ERROR HANDLING
// =============================================================================

app.notFound((c) => {
  return c.json({
    error: {
      type: 'not_found',
      message: `Route not found: ${c.req.method} ${c.req.path}`,
      code: 'NOT_FOUND',
      hint: 'Available: POST /v1/chat/completions, POST /v1/messages, GET /v1/sessions',
    },
  }, 404);
});

app.onError((err, c) => {
  console.error('[ERROR]', err);
  return c.json({
    error: {
      type: 'internal_error',
      message: 'An unexpected error occurred.',
      code: 'INTERNAL_ERROR',
    },
  }, 500);
});

// =============================================================================
// SERVER STARTUP
// =============================================================================

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
║   ROUTER — Same memory, any model. ⚡                            ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝

🚀 Server: http://localhost:${port}
📖 Inference:
   POST /v1/chat/completions    (OpenAI-compatible)
   POST /v1/messages            (Anthropic-compatible)
📂 Sessions:
   GET  /v1/sessions            (list sessions)
   GET  /v1/sessions/:id        (session info)
   DEL  /v1/sessions/:id        (delete session)
🔑 Keys:
   GET  /v1/memory-keys         (list keys)
   POST /v1/memory-keys         (create key)
   DEL  /v1/memory-keys/:key    (delete key)
💳 Billing:
   GET  /v1/billing             (overview)

Test:
  curl -X POST http://localhost:${port}/v1/chat/completions \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer mk_test_key" \\
    -H "X-Session-ID: user_alice" \\
    -d '{"model":"openai/gpt-4","messages":[{"role":"user","content":"Hello!"}]}'
`);

serve({
  fetch: app.fetch,
  port,
});

export default app;
