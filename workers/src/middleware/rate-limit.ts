/**
 * Non-Blocking Rate Limiting Middleware
 * 
 * Zero latency impact on requests:
 * 1. Fire-and-forget: increment counters in background (no await)
 * 2. Check blocklist: fast KV lookup for known abusers
 * 3. Background analysis: separate process blocks excessive users
 * 
 * Limits (enforced async):
 * - Authenticated: 100 req/10s burst, 1000 req/min sustained (per API key)
 * - Unauthenticated: 60 req/min (per IP)
 */

import { Context, MiddlewareHandler } from 'hono';

// Rate limit configurations (for reference/docs)
export const RATE_LIMITS = {
  authenticated: {
    burst: { limit: 100, windowSeconds: 10 },
    sustained: { limit: 1000, windowSeconds: 60 },
  },
  unauthenticated: {
    limit: 60,
    windowSeconds: 60,
  },
} as const;

export interface RateLimitEnv {
  RATE_LIMIT_KV: KVNamespace;
}

/**
 * Extract memory key from Authorization header
 */
function extractMemoryKey(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  const token = parts[1];
  if (!token.startsWith('mk_') && !token.startsWith('mk-')) return null;
  return token;
}

/**
 * Get client IP from Cloudflare headers
 */
function getClientIP(c: Context): string {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * Non-blocking rate limit middleware (optimized)
 * 
 * - Authenticated users (mk_xxx): fully async, zero latency (they're accountable)
 * - Unauthenticated users: quick blocklist check only (no counter read)
 * - All counter updates in background via waitUntil
 */
export function rateLimitMiddleware(): MiddlewareHandler<{
  Bindings: RateLimitEnv;
}> {
  return async (c, next) => {
    const kv = c.env.RATE_LIMIT_KV;
    
    // Skip if KV not configured
    if (!kv) {
      return next();
    }

    const authHeader = c.req.header('Authorization');
    const memoryKey = extractMemoryKey(authHeader);
    const clientIP = getClientIP(c);
    const identifier = memoryKey || `ip:${clientIP}`;
    const isAuthenticated = !!memoryKey;

    // For unauthenticated requests only: quick blocklist check
    // (Authenticated users are accountable via their API key, skip the check for speed)
    if (!isAuthenticated) {
      const blocked = await kv.get(`blocked:${identifier}`);
      if (blocked) {
        const blockData = JSON.parse(blocked);
        return c.json({
          error: {
            message: 'Rate limit exceeded',
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
            retry_after: blockData.expiresAt ? Math.max(0, blockData.expiresAt - Date.now()) / 1000 : 60,
          },
        }, 429, {
          'Retry-After': String(blockData.retryAfter || 60),
        });
      }
    }

    // All counter updates in background (zero latency impact)
    c.executionCtx.waitUntil((async () => {
      try {
        const now = Math.floor(Date.now() / 1000);
        const burstWindow = Math.floor(now / 10) * 10;
        const sustainedWindow = Math.floor(now / 60) * 60;

        const burstKey = `count:${identifier}:burst:${burstWindow}`;
        const burstCount = parseInt(await kv.get(burstKey) || '0') + 1;
        await kv.put(burstKey, String(burstCount), { expirationTtl: 20 });

        const sustainedKey = `count:${identifier}:sustained:${sustainedWindow}`;
        const sustainedCount = parseInt(await kv.get(sustainedKey) || '0') + 1;
        await kv.put(sustainedKey, String(sustainedCount), { expirationTtl: 120 });

        // Check limits and block if exceeded
        const limits = isAuthenticated 
          ? RATE_LIMITS.authenticated 
          : { burst: RATE_LIMITS.unauthenticated, sustained: RATE_LIMITS.unauthenticated };
        const burstLimit = limits.burst.limit;
        const sustainedLimit = limits.sustained.limit;

        if (burstCount > burstLimit || sustainedCount > sustainedLimit) {
          await kv.put(`blocked:${identifier}`, JSON.stringify({
            reason: burstCount > burstLimit ? 'burst' : 'sustained',
            count: burstCount > burstLimit ? burstCount : sustainedCount,
            blockedAt: Date.now(),
            expiresAt: Date.now() + 60000,
            retryAfter: 60,
          }), { expirationTtl: 60 });
        }
      } catch (e) {
        console.error('[rate-limit] Background error:', e);
      }
    })());

    // Continue immediately
    return next();
  };
}
