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
 * Non-blocking rate limit middleware
 * - Checks blocklist (single fast KV read)
 * - Increments counters in background (fire-and-forget)
 * - Zero latency on normal requests
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

    // 1. Check blocklist (single fast read - only blocking check)
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

    // 2. Fire-and-forget: increment counters in background (NO AWAIT)
    const now = Math.floor(Date.now() / 1000);
    const burstWindow = Math.floor(now / 10) * 10;
    const sustainedWindow = Math.floor(now / 60) * 60;

    // Use waitUntil so it runs after response is sent
    c.executionCtx.waitUntil((async () => {
      try {
        // Increment burst counter
        const burstKey = `count:${identifier}:burst:${burstWindow}`;
        const burstCount = parseInt(await kv.get(burstKey) || '0') + 1;
        await kv.put(burstKey, String(burstCount), { expirationTtl: 20 });

        // Increment sustained counter
        const sustainedKey = `count:${identifier}:sustained:${sustainedWindow}`;
        const sustainedCount = parseInt(await kv.get(sustainedKey) || '0') + 1;
        await kv.put(sustainedKey, String(sustainedCount), { expirationTtl: 120 });

        // Check if limits exceeded and block if necessary
        const limits = memoryKey ? RATE_LIMITS.authenticated : { burst: RATE_LIMITS.unauthenticated, sustained: RATE_LIMITS.unauthenticated };
        const burstLimit = 'burst' in limits ? limits.burst.limit : limits.limit;
        const sustainedLimit = 'sustained' in limits ? limits.sustained.limit : limits.limit;

        if (burstCount > burstLimit || sustainedCount > sustainedLimit) {
          // Add to blocklist for 60 seconds
          await kv.put(`blocked:${identifier}`, JSON.stringify({
            reason: burstCount > burstLimit ? 'burst' : 'sustained',
            count: burstCount > burstLimit ? burstCount : sustainedCount,
            blockedAt: Date.now(),
            expiresAt: Date.now() + 60000,
            retryAfter: 60,
          }), { expirationTtl: 60 });
        }
      } catch (e) {
        // Silent fail - rate limiting is best-effort
        console.error('[rate-limit] Background error:', e);
      }
    })());

    // 3. Continue immediately (no waiting for counter updates)
    return next();
  };
}
