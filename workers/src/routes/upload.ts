/**
 * Upload Route — Bulk memory import from JSONL
 * 
 * POST /v1/memory/upload
 * - Accepts JSONL (one memory per line)
 * - Requires card on file (has_payment_method = 1)
 * - Stores to main vault or session vault (via X-Session-ID header)
 * 
 * JSONL format (each line):
 *   {"content": "text to remember", "role": "user|assistant", "timestamp": 1234567890}
 *   or just: {"content": "text to remember"}  // defaults: role=user, timestamp=now
 */

import { Hono } from 'hono';
import { UserContext } from '../middleware/auth';

interface UploadEnv {
  VECTORS_D1: D1Database;
  METADATA_KV: KVNamespace;
  VAULT_DO: DurableObjectNamespace;
  USE_DURABLE_OBJECTS: string;
  AI?: Ai; // Cloudflare Workers AI binding
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
    // Step 1: Check card on file
    // ========================================================================
    const userId = userContext.userId;
    
    try {
      const billing = await c.env.VECTORS_D1.prepare(
        `SELECT has_payment_method FROM billing WHERE user_id = ?`
      ).bind(userId).first() as { has_payment_method: number } | null;

      if (!billing) {
        return c.json({
          error: 'Billing not found',
          message: 'No billing record exists for this user. Please set up billing in the dashboard.',
          code: 'NO_BILLING_RECORD',
        }, 403);
      }

      if (!billing.has_payment_method) {
        return c.json({
          error: 'Payment method required',
          message: 'Please add a card to your account before uploading memories. This ensures we can process your data.',
          code: 'NO_PAYMENT_METHOD',
          action: 'Add a card at https://app.memoryrouter.ai/settings/billing',
        }, 402); // 402 Payment Required
      }
    } catch (error) {
      console.error('[Upload] Billing check failed:', error);
      return c.json({
        error: 'Billing check failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }

    // ========================================================================
    // Step 2: Parse JSONL body
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

      // Soft limit with warning (we'll chunk internally)
      const SOFT_LIMIT = 100000; // 100k lines absolute max
      if (lines.length > SOFT_LIMIT) {
        return c.json({
          error: 'File too large',
          message: `Maximum ${SOFT_LIMIT} memories per upload. You provided ${lines.length}.`,
          hint: 'Split your file into multiple uploads.',
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
      // Durable Objects path — chunked batch store
      try {
        const vaultName = sessionId 
          ? `${userContext.memoryKey.key}:session:${sessionId}`
          : `${userContext.memoryKey.key}:core`;
        
        const doId = c.env.VAULT_DO.idFromName(vaultName);
        const stub = c.env.VAULT_DO.get(doId);

        // ====================================================================
        // Chunk processing: Process in batches of 500 lines to bound memory
        // ====================================================================
        const CHUNK_SIZE = 500;
        const totalChunks = Math.ceil(lines.length / CHUNK_SIZE);
        
        console.log(`[Upload] Processing ${lines.length} memories in ${totalChunks} chunks of ${CHUNK_SIZE}`);

        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
          const start = chunkIndex * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, lines.length);
          const chunk = lines.slice(start, end);

          // Send chunk to DO for processing (embeddings via Cloudflare AI)
          const response = await stub.fetch(new Request('https://do/bulk-store', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              items: chunk,
            }),
          }));

          if (!response.ok) {
            const errText = await response.text();
            console.error(`[Upload] DO bulk-store failed on chunk ${chunkIndex + 1}/${totalChunks}:`, errText);
            // Continue processing other chunks, track failure
            result.failed += chunk.length;
            result.errors.push(`Chunk ${chunkIndex + 1} failed: ${errText.slice(0, 100)}`);
            continue;
          }

          const doResult = await response.json() as { stored: number; failed: number; errors?: string[] };
          result.processed += doResult.stored;
          result.failed += doResult.failed;
          if (doResult.errors) {
            result.errors.push(...doResult.errors);
          }

          // Log progress for large uploads
          if (totalChunks > 5 && (chunkIndex + 1) % 5 === 0) {
            console.log(`[Upload] Progress: ${chunkIndex + 1}/${totalChunks} chunks (${result.processed} stored)`);
          }
        }

        console.log(`[Upload] Complete: ${result.processed} stored, ${result.failed} failed`);

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
