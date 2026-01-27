/**
 * Billing Middleware
 * 
 * Quota check middleware for API requests.
 * Blocks requests when quota is exceeded.
 * 
 * Reference: memoryrouter-stripe-spec.md Section 5.6
 */

import type { Context, Next } from 'hono';
import { getUserContext } from '../middleware/auth';
import { checkQuota } from './service';
import { PRICING } from './types';

// =============================================================================
// QUOTA CHECK MIDDLEWARE
// =============================================================================

/**
 * Middleware to check user quota before processing requests
 * 
 * Returns:
 * - 402 if free tier exhausted and no payment method
 * - 402 if account suspended
 * - Continues with warning header if in grace period
 * - Continues normally otherwise
 */
export async function quotaCheckMiddleware(c: Context, next: Next) {
  const userContext = getUserContext(c);
  
  if (!userContext) {
    // Auth middleware should have caught this
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const quotaResult = await checkQuota(userContext.userId);
  
  // Add quota headers to response
  c.res.headers.set('X-MemoryRouter-Quota-Used', quotaResult.tokensUsed.toString());
  c.res.headers.set('X-MemoryRouter-Quota-Remaining', 
    quotaResult.tokensRemaining === Infinity 
      ? 'unlimited' 
      : quotaResult.tokensRemaining.toString()
  );
  
  if (!quotaResult.allowed) {
    // Determine error type
    if (quotaResult.reason === 'ACCOUNT_SUSPENDED') {
      return c.json({
        error: {
          type: 'account_suspended',
          message: 'Account suspended due to payment failure. Please update your payment method.',
          code: 'ACCOUNT_SUSPENDED',
          action: {
            type: 'update_payment_method',
            url: 'https://memoryrouter.ai/billing',
          },
        },
      }, 402);
    }
    
    if (quotaResult.reason === 'FREE_TIER_EXHAUSTED') {
      return c.json({
        error: {
          type: 'payment_required',
          message: 'Free tier exhausted. Please add a payment method to continue.',
          code: 'FREE_TIER_EXHAUSTED',
          usage: {
            tokens_used: Number(quotaResult.tokensUsed),
            free_limit: PRICING.FREE_TIER_TOKENS,
          },
          action: {
            type: 'add_payment_method',
            url: 'https://memoryrouter.ai/billing',
          },
        },
      }, 402);
    }
    
    // Generic quota exceeded
    return c.json({
      error: {
        type: 'quota_exceeded',
        message: 'Quota exceeded. Please upgrade your plan or wait for the next billing cycle.',
        code: 'QUOTA_EXCEEDED',
      },
    }, 429);
  }
  
  // Add warning headers for grace period
  if (quotaResult.warning) {
    c.res.headers.set('X-Billing-Warning', quotaResult.warning);
    if (quotaResult.gracePeriodEndsAt) {
      c.res.headers.set('X-Grace-Period-Ends', quotaResult.gracePeriodEndsAt.toISOString());
    }
  }
  
  // Store quota result for use after request (optional optimization)
  c.set('quotaResult', quotaResult);
  
  await next();
}

/**
 * Lightweight middleware that only adds quota info headers
 * Does not block requests - use for endpoints that should always succeed
 */
export async function quotaInfoMiddleware(c: Context, next: Next) {
  const userContext = getUserContext(c);
  
  if (!userContext) {
    await next();
    return;
  }
  
  try {
    const quotaResult = await checkQuota(userContext.userId);
    
    c.res.headers.set('X-MemoryRouter-Quota-Used', quotaResult.tokensUsed.toString());
    c.res.headers.set('X-MemoryRouter-Quota-Remaining', 
      quotaResult.tokensRemaining === Infinity 
        ? 'unlimited' 
        : quotaResult.tokensRemaining.toString()
    );
    
    if (quotaResult.warning) {
      c.res.headers.set('X-Billing-Warning', quotaResult.warning);
    }
  } catch (error) {
    // Don't fail the request if quota check fails
    console.error('[BILLING] Quota info check failed:', error);
  }
  
  await next();
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if current request should be metered
 * Based on headers and message flags
 */
export function shouldMeterRequest(c: Context): {
  storeRequest: boolean;
  storeResponse: boolean;
} {
  const storeHeader = c.req.header('X-Memory-Store');
  const storeResponseHeader = c.req.header('X-Memory-Store-Response');
  const memoryMode = c.req.header('X-Memory-Mode');
  
  // X-Memory-Store: false disables all storage
  if (storeHeader?.toLowerCase() === 'false') {
    return {
      storeRequest: false,
      storeResponse: false,
    };
  }
  
  // X-Memory-Mode: off disables all memory
  if (memoryMode?.toLowerCase() === 'off') {
    return {
      storeRequest: false,
      storeResponse: false,
    };
  }
  
  // X-Memory-Store-Response: false disables response storage only
  const storeResponse = storeResponseHeader?.toLowerCase() !== 'false';
  
  return {
    storeRequest: true,
    storeResponse,
  };
}

/**
 * Get free tier warning message based on usage
 */
export function getFreeTierWarning(tokensUsed: bigint): string | null {
  const percentUsed = (Number(tokensUsed) / PRICING.FREE_TIER_TOKENS) * 100;
  
  if (percentUsed >= 90 && percentUsed < 100) {
    const remaining = PRICING.FREE_TIER_TOKENS - Number(tokensUsed);
    const remainingM = (remaining / 1_000_000).toFixed(1);
    return `You have ${remainingM}M tokens remaining in your free tier. Add a payment method to continue after free tier.`;
  }
  
  if (percentUsed >= 80 && percentUsed < 90) {
    return `You've used ${percentUsed.toFixed(0)}% of your free tier (${PRICING.FREE_TIER_TOKENS / 1_000_000}M tokens).`;
  }
  
  return null;
}

/**
 * Format quota error response
 */
export function formatQuotaError(reason: string): {
  status: number;
  body: Record<string, unknown>;
} {
  switch (reason) {
    case 'FREE_TIER_EXHAUSTED':
      return {
        status: 402,
        body: {
          error: {
            type: 'payment_required',
            message: 'Free tier exhausted. Please add a payment method to continue.',
            code: 'FREE_TIER_EXHAUSTED',
            action: {
              type: 'add_payment_method',
              url: 'https://memoryrouter.ai/billing',
            },
          },
        },
      };
    
    case 'ACCOUNT_SUSPENDED':
      return {
        status: 402,
        body: {
          error: {
            type: 'account_suspended',
            message: 'Account suspended due to payment failure.',
            code: 'ACCOUNT_SUSPENDED',
            action: {
              type: 'update_payment_method',
              url: 'https://memoryrouter.ai/billing',
            },
          },
        },
      };
    
    default:
      return {
        status: 429,
        body: {
          error: {
            type: 'quota_exceeded',
            message: 'Quota exceeded.',
            code: 'QUOTA_EXCEEDED',
          },
        },
      };
  }
}
