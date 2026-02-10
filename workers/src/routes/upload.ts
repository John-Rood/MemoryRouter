/**
 * Upload Route — Bulk memory import from JSONL
 * 
 * POST /v1/memory/upload
 * - Accepts JSONL (one memory per line)
 * - CHARGE FIRST: Checks balance and auto-charges if needed before storing
 * - Stores to main vault or session vault (via X-Session-ID header)
 * 
 * JSONL format (each line):
 *   {"content": "text to remember", "role": "user|assistant", "timestamp": 1234567890}
 *   or just: {"content": "text to remember"}  // defaults: role=user, timestamp=now
 */

import { Hono } from 'hono';
import { UserContext } from '../middleware/auth';
import {
  ensureBalance,
  estimateUploadTokens,
  buildPaymentRequiredResponse,
} from '../services/balance-checkpoint';
import { createBalanceGuard } from '../services/balance-guard';

interface UploadEnv {
  VECTORS_D1: D1Database;
  METADATA_KV: KVNamespace;
  VAULT_DO: DurableObjectNamespace;
  USE_DURABLE_OBJECTS: string;
  AI?: Ai; // Cloudflare Workers AI binding
  STRIPE_SECRET_KEY?: string; // For auto-charging
}

interface MemoryLine {
  content: string;
  role?: 'user' | 'assistant' | 'system';
  timestamp?: number;
}

interface UploadResult {
  success: boolean;
  processed: number;
  failed: number;
  errors: string[];
  vault: 'core' | 'session';
  sessionId?: string;
}

// Create router
export function createUploadRouter() {
  const router = new Hono<{ 
    Bindings: UploadEnv; 
    Variables: { userContext: UserContext } 
  }>();

  // POST /v1/memory/upload
  router.post('/upload', async (c) => {
    const userContext = c.get('userContext');
    const sessionId = c.req.header('X-Session-ID');
    const vaultType = sessionId ? 'session' : 'core';

    // ========================================================================
    // Step 1: Parse JSONL body FIRST (to count tokens)
    // ========================================================================
    let lines: MemoryLine[] = [];
    
    try {
      const body = await c.req.text();
      
      if (!body.trim()) {
        return c.json({
          error: 'Empty request body',
          message: 'Please provide JSONL content with memories to upload',
          format: '{"content": "memory text", "role": "user|assistant", "timestamp": 1234567890}',
        }, 400);
      }

      const rawLines = body.trim().split('\n');
      
      for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i].trim();
        if (!line) continue; // Skip empty lines
        
        try {
          const parsed = JSON.parse(line) as MemoryLine;
          
          if (!parsed.content || typeof parsed.content !== 'string') {
            throw new Error('Missing or invalid "content" field');
          }
          
          lines.push({
            content: parsed.content,
            role: parsed.role || 'user',
            timestamp: parsed.timestamp || Date.now(),
          });
        } catch (parseError) {
          return c.json({
            error: 'Invalid JSONL',
            message: `Line ${i + 1} is not valid JSON: ${parseError instanceof Error ? parseError.message : 'Parse error'}`,
            line: line.slice(0, 100) + (line.length > 100 ? '...' : ''),
          }, 400);
        }
      }

      if (lines.length === 0) {
        return c.json({
          error: 'No valid memories',
          message: 'No valid memory lines found in the uploaded content',
        }, 400);
      }

      // Limit batch size to prevent abuse
      const MAX_LINES = 10000;
      if (lines.length > MAX_LINES) {
        return c.json({
          error: 'Batch too large',
          message: `Maximum ${MAX_LINES} memories per upload. You provided ${lines.length}.`,
          hint: 'Split your file into smaller batches.',
        }, 413);
      }
    } catch (error) {
      console.error('[Upload] Parse failed:', error);
      return c.json({
        error: 'Failed to parse request',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 400);
    }

    // ========================================================================
    // Step 2: CHARGE FIRST — Check balance and auto-charge if needed
    // ========================================================================
    const memoryKey = userContext.memoryKey.key;
    const tokensNeeded = estimateUploadTokens(lines);
    
    console.log(`[Upload] Checking balance for ${memoryKey}: ${tokensNeeded} tokens, ${lines.length} items`);

    const balanceResult = await ensureBalance(
      c.env.VECTORS_D1,
      memoryKey,
      tokensNeeded,
      c.env.STRIPE_SECRET_KEY
    );

    if (!balanceResult.allowed) {
      console.log(`[Upload] Balance check failed for ${memoryKey}:`, balanceResult.error);
      return buildPaymentRequiredResponse(balanceResult);
    }

    // Log if we charged
    if (balanceResult.charged) {
      console.log(`[Upload] Auto-charged ${memoryKey}: $${((balanceResult.amountCharged || 0) / 100).toFixed(2)}`);
    }

    // ========================================================================
    // Step 3: Store memories in vault
    // ========================================================================
    const result: UploadResult = {
      success: true,
      processed: 0,
      failed: 0,
      errors: [],
      vault: vaultType,
      sessionId: sessionId || undefined,
    };

    if (c.env.USE_DURABLE_OBJECTS === 'true' && c.env.VAULT_DO) {
      // Durable Objects path — batch store
      try {
        const vaultName = sessionId 
          ? `${userContext.memoryKey.key}:session:${sessionId}`
          : `${userContext.memoryKey.key}:core`;
        
        const doId = c.env.VAULT_DO.idFromName(vaultName);
        const stub = c.env.VAULT_DO.get(doId);

        // Send batch to DO for processing (embeddings via Cloudflare AI)
        const response = await stub.fetch(new Request('https://do/bulk-store', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            items: lines,
          }),
        }));

        if (!response.ok) {
          const errText = await response.text();
          console.error('[Upload] DO bulk-store failed:', errText);
          return c.json({
            error: 'Storage failed',
            details: errText,
          }, 500);
        }

        const doResult = await response.json() as { stored: number; failed: number; errors?: string[] };
        result.processed = doResult.stored;
        result.failed = doResult.failed;
        result.errors = doResult.errors || [];

        // Record usage (deduct tokens) after successful storage
        if (result.processed > 0) {
          const balanceGuard = createBalanceGuard(c.env.METADATA_KV, c.env.VECTORS_D1);
          const tokensUsed = estimateUploadTokens(lines.slice(0, result.processed));
          
          c.executionCtx.waitUntil(
            balanceGuard.recordUsageAndDeduct(
              memoryKey,
              tokensUsed,
              'upload',
              'memoryrouter',
              sessionId
            ).catch(err => console.error('[Upload] Failed to record usage:', err))
          );
        }

      } catch (error) {
        console.error('[Upload] DO error:', error);
        return c.json({
          error: 'Storage failed',
          details: error instanceof Error ? error.message : 'Unknown error',
        }, 500);
      }
    } else {
      // Fallback: D1 direct storage (no embedding in this path)
      // This path would need embedding service integration
      return c.json({
        error: 'Upload not available',
        message: 'Bulk upload requires Durable Objects storage mode',
      }, 501);
    }

    result.success = result.failed === 0;

    return c.json({
      status: result.success ? 'complete' : 'partial',
      memoryKey: userContext.memoryKey.key,
      vault: result.vault,
      sessionId: result.sessionId,
      stats: {
        total: lines.length,
        processed: result.processed,
        failed: result.failed,
      },
      errors: result.errors.length > 0 ? result.errors.slice(0, 10) : undefined, // Limit error output
      message: result.success 
        ? `Successfully stored ${result.processed} memories`
        : `Stored ${result.processed} memories, ${result.failed} failed`,
    });
  });

  return router;
}

export { createUploadRouter as uploadRouter };
