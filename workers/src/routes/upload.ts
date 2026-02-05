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

// ============================================================================
// Chunking Constants — Match vault.ts for consistent vector sizes
// ============================================================================
const TARGET_TOKENS = 300;
const OVERLAP_TOKENS = 30;
const CHARS_PER_TOKEN = 4;
const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN; // ~1200 chars

const estimateTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN);

/**
 * Normalize memories to consistent ~300 token chunks.
 * - Small memories: combine until ~300 tokens
 * - Large memories: split at sentence boundaries with overlap
 */
function normalizeMemories(lines: MemoryLine[]): MemoryLine[] {
  const normalized: MemoryLine[] = [];
  let buffer: MemoryLine[] = [];
  let bufferTokens = 0;

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    
    // Combine all buffered memories into one
    const combined: MemoryLine = {
      content: buffer.map(m => `[${(m.role || 'user').toUpperCase()}] ${m.content}`).join('\n\n'),
      role: buffer[buffer.length - 1].role || 'user',
      timestamp: buffer[buffer.length - 1].timestamp || Date.now(),
    };
    normalized.push(combined);
    buffer = [];
    bufferTokens = 0;
  };

  const splitLargeMemory = (memory: MemoryLine): MemoryLine[] => {
    const chunks: MemoryLine[] = [];
    let remaining = `[${(memory.role || 'user').toUpperCase()}] ${memory.content}`;
    let overlap = '';

    while (remaining.length > 0) {
      const combined = overlap ? `${overlap} ${remaining}` : remaining;
      
      if (estimateTokens(combined) <= TARGET_TOKENS * 1.2) {
        // Small enough, use as final chunk
        chunks.push({
          content: combined,
          role: memory.role,
          timestamp: memory.timestamp,
        });
        break;
      }

      // Find split point at sentence boundary
      let splitPoint = TARGET_CHARS;
      const searchStart = Math.floor(TARGET_CHARS * 0.8);
      const searchEnd = Math.min(Math.ceil(TARGET_CHARS * 1.1), combined.length);
      const searchRegion = combined.slice(searchStart, searchEnd);
      
      const sentenceMatch = searchRegion.match(/[.!?]\s/);
      if (sentenceMatch && sentenceMatch.index !== undefined) {
        splitPoint = searchStart + sentenceMatch.index + 1;
      } else {
        const spaceIndex = combined.lastIndexOf(' ', TARGET_CHARS);
        if (spaceIndex > TARGET_CHARS * 0.7) {
          splitPoint = spaceIndex;
        }
      }

      const chunk = combined.slice(0, splitPoint).trim();
      remaining = combined.slice(splitPoint).trim();

      if (chunk) {
        chunks.push({
          content: chunk,
          role: memory.role,
          timestamp: memory.timestamp,
        });
      }

      // Keep overlap for continuity
      const overlapChars = OVERLAP_TOKENS * CHARS_PER_TOKEN;
      overlap = chunk.slice(-overlapChars);
    }

    return chunks;
  };

  for (const memory of lines) {
    const memoryTokens = estimateTokens(memory.content);

    // Large memory: split it
    if (memoryTokens > TARGET_TOKENS * 1.5) {
      flushBuffer(); // Flush any pending small memories first
      const splitChunks = splitLargeMemory(memory);
      normalized.push(...splitChunks);
      continue;
    }

    // Would exceed target: flush buffer first
    if (bufferTokens + memoryTokens > TARGET_TOKENS * 1.2) {
      flushBuffer();
    }

    // Add to buffer
    buffer.push(memory);
    bufferTokens += memoryTokens;

    // Buffer is full enough: flush
    if (bufferTokens >= TARGET_TOKENS) {
      flushBuffer();
    }
  }

  // Flush remaining buffer
  flushBuffer();

  return normalized;
}

interface UploadResult {
  success: boolean;
  processed: number;
  failed: number;
  errors: string[];
  vault: 'core' | 'session';
  sessionId?: string;
  normalizedCount?: number; // Track normalized chunk count
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
      // Durable Objects path — normalized chunked batch store
      try {
        const vaultName = sessionId 
          ? `${userContext.memoryKey.key}:session:${sessionId}`
          : `${userContext.memoryKey.key}:core`;
        
        const doId = c.env.VAULT_DO.idFromName(vaultName);
        const stub = c.env.VAULT_DO.get(doId);

        // ====================================================================
        // Step 1: Normalize memories to consistent ~300 token chunks
        // - Small memories get combined
        // - Large memories get split at sentence boundaries
        // ====================================================================
        const normalizedMemories = normalizeMemories(lines);
        result.normalizedCount = normalizedMemories.length;
        
        console.log(`[Upload] Normalized ${lines.length} raw lines → ${normalizedMemories.length} chunks (~${TARGET_TOKENS} tokens each)`);

        // ====================================================================
        // Step 2: Process in batches of 100 normalized chunks
        // ====================================================================
        const BATCH_SIZE = 100;
        const totalBatches = Math.ceil(normalizedMemories.length / BATCH_SIZE);

        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
          const start = batchIndex * BATCH_SIZE;
          const end = Math.min(start + BATCH_SIZE, normalizedMemories.length);
          const batch = normalizedMemories.slice(start, end);

          // Send batch to DO for processing (embeddings via Cloudflare AI)
          const response = await stub.fetch(new Request('https://do/bulk-store', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              items: batch,
            }),
          }));

          if (!response.ok) {
            const errText = await response.text();
            console.error(`[Upload] DO bulk-store failed on batch ${batchIndex + 1}/${totalBatches}:`, errText);
            // Continue processing other batches, track failure
            result.failed += batch.length;
            result.errors.push(`Batch ${batchIndex + 1} failed: ${errText.slice(0, 100)}`);
            continue;
          }

          const doResult = await response.json() as { stored: number; failed: number; errors?: string[] };
          result.processed += doResult.stored;
          result.failed += doResult.failed;
          if (doResult.errors) {
            result.errors.push(...doResult.errors);
          }

          // Log progress for large uploads
          if (totalBatches > 5 && (batchIndex + 1) % 5 === 0) {
            console.log(`[Upload] Progress: ${batchIndex + 1}/${totalBatches} batches (${result.processed} stored)`);
          }
        }

        console.log(`[Upload] Complete: ${result.processed} stored, ${result.failed} failed (from ${lines.length} raw → ${normalizedMemories.length} normalized)`);

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

    const normalizedCount = result.normalizedCount || lines.length;

    return c.json({
      status: result.success ? 'complete' : 'partial',
      memoryKey: userContext.memoryKey.key,
      vault: result.vault,
      sessionId: result.sessionId,
      stats: {
        rawLines: lines.length,
        normalizedChunks: normalizedCount,
        processed: result.processed,
        failed: result.failed,
        targetTokens: TARGET_TOKENS,
      },
      errors: result.errors.length > 0 ? result.errors.slice(0, 10) : undefined,
      message: result.success 
        ? `Successfully stored ${result.processed} memories (${lines.length} raw → ${normalizedCount} normalized chunks)`
        : `Stored ${result.processed} memories, ${result.failed} failed`,
    });
  });

  return router;
}

export { createUploadRouter as uploadRouter };
