/**
 * Rate Limiting Middleware
 * 
 * Protects API from abuse with dual-window rate limiting:
 * - Authenticated requests: 100 req/10s burst + 1000 req/min sustained (per API key)
 * - Unauthenticated requests: 60 req/min (per IP)
 */

import { Context, Next, MiddlewareHandler } from 'hono';

// Rate limit configurations
const RATE_LIMITS = {
  // Per API key (authenticated)
  authenticated: {
    burst: { limit: 100, windowSeconds: 10 },      // 100 req / 10 sec
    sustained: { limit: 1000, windowSeconds: 60 }, // 1000 req / min
  },
  // Per IP (unauthenticated)
  unauthenticated: {
    limit: 60,
    windowSeconds: 60, // 60 req / min
  },
} as const;

// Unauthenticated endpoints (matched by path prefix)
const UNAUTHENTICATED_PATHS = ['/', '/health', '/v1/models'];

export interface RateLimitEnv {
  RATE_LIMIT_KV: KVNamespace;
}

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  windowSeconds: number;
  retryAfter?: number;
}

/**
 * Check and increment rate limit counter
 * Uses KV with TTL for automatic expiration
 */
async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const windowKey = `ratelimit:${key}:${windowStart}`;
  const reset = windowStart + windowSeconds;

  // Get current count
  const current = await kv.get(windowKey);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      reset,
      windowSeconds,
      retryAfter: reset - now,
    };
  }

  // Increment counter (fire-and-forget for performance)
  // TTL is 2x window to handle edge cases
  kv.put(windowKey, String(count + 1), { expirationTtl: windowSeconds * 2 });

  return {
    allowed: true,
    limit,
    remaining: limit - count - 1,
    reset,
    windowSeconds,
  };
}

/**
 * Check dual-window rate limits for authenticated requests
 * Both burst AND sustained limits must pass
 */
async function checkAuthenticatedLimits(
  kv: KVNamespace,
  memoryKey: string
): Promise<RateLimitResult> {
  const { burst, sustained } = RATE_LIMITS.authenticated;

  // Check both windows in parallel
  const [burstResult, sustainedResult] = await Promise.all([
    checkRateLimit(kv, `key:${memoryKey}:burst`, burst.limit, burst.windowSeconds),
    checkRateLimit(kv, `key:${memoryKey}:sustained`, sustained.limit, sustained.windowSeconds),
  ]);

  // If either limit is exceeded, return the one with longest wait
  if (!burstResult.allowed || !sustainedResult.allowed) {
    const limiting = !burstResult.allowed ? burstResult : sustainedResult;
    return {
      allowed: false,
      limit: limiting.limit,
      remaining: 0,
      reset: limiting.reset,
      windowSeconds: limiting.windowSeconds,
      retryAfter: limiting.retryAfter,
    };
  }

  // Both passed - return sustained limit info (more relevant for headers)
  return {
    allowed: true,
    limit: sustained.limit,
    remaining: sustainedResult.remaining,
    reset: sustainedResult.reset,
    windowSeconds: sustained.windowSeconds,
  };
}

/**
 * Extract client IP from request
 * Cloudflare provides CF-Connecting-IP header
 */
function getClientIP(c: Context): string {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('X-Real-IP') ||
    'unknown'
  );
}

/**
 * Extract memory key from Authorization header
 */
function extractMemoryKeyFromAuth(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  const token = parts[1];
  if (!token.startsWith('mk_') && !token.startsWith('mk-')) return null;
  return token;
}

/**
 * Check if path is unauthenticated
 */
function isUnauthenticatedPath(path: string): boolean {
  // Exact match for root and health
  if (path === '/' || path === '/health') return true;
  // Models endpoint is under v1 but we'll let it through
  // (it's protected by auth middleware anyway, this is for when auth fails)
  return false;
}

/**
 * Create rate limit error response
 */
function rateLimitError(c: Context, result: RateLimitResult): Response {
  const windowLabel = result.windowSeconds < 60 
    ? `${result.windowSeconds}s` 
    : `${result.windowSeconds / 60}m`;

  return c.json(
    {
      error: {
        message: 'Rate limit exceeded',
        type: 'rate_limit_error',
        code: 'rate_limit_exceeded',
        details: {
          limit: result.limit,
          window: windowLabel,
          retry_after: result.retryAfter,
        },
      },
    },
    429,
    {
      'X-RateLimit-Limit': String(result.limit),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(result.reset),
      'Retry-After': String(result.retryAfter),
    }
  );
}

/**
 * Add rate limit headers to response
 */
function addRateLimitHeaders(
  headers: Headers,
  result: RateLimitResult
): void {
  headers.set('X-RateLimit-Limit', String(result.limit));
  headers.set('X-RateLimit-Remaining', String(result.remaining));
  headers.set('X-RateLimit-Reset', String(result.reset));
}

/**
 * Rate limiting middleware factory
 */
export function rateLimitMiddleware(): MiddlewareHandler<{
  Bindings: RateLimitEnv;
}> {
  return async (c, next) => {
    const kv = c.env.RATE_LIMIT_KV;
    
    // Skip if KV not configured (graceful degradation)
    if (!kv) {
      console.warn('RATE_LIMIT_KV not configured - rate limiting disabled');
      return next();
    }

    const path = c.req.path;
    const authHeader = c.req.header('Authorization');
    const memoryKey = extractMemoryKeyFromAuth(authHeader);

    let result: RateLimitResult;

    if (memoryKey) {
      // Authenticated request - use API key-based limits
      result = await checkAuthenticatedLimits(kv, memoryKey);
    } else if (isUnauthenticatedPath(path)) {
      // Unauthenticated endpoint - use IP-based limits
      const clientIP = getClientIP(c);
      const { limit, windowSeconds } = RATE_LIMITS.unauthenticated;
      result = await checkRateLimit(kv, `ip:${clientIP}`, limit, windowSeconds);
    } else {
      // Non-unauthenticated path without auth - will fail at auth middleware
      // But still apply IP-based limit to prevent enumeration
      const clientIP = getClientIP(c);
      const { limit, windowSeconds } = RATE_LIMITS.unauthenticated;
      result = await checkRateLimit(kv, `ip:${clientIP}`, limit, windowSeconds);
    }

    if (!result.allowed) {
      return rateLimitError(c, result);
    }

    // Continue to next middleware
    await next();

    // Add rate limit headers to successful responses
    if (c.res) {
      addRateLimitHeaders(c.res.headers, result);
    }
  };
}

/**
 * Export rate limit configurations for testing/docs
 */
export const LIMITS = RATE_LIMITS;
