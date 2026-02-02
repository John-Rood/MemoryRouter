/**
 * Storage Queue Consumer
 * 
 * Handles embedding + storage completely decoupled from inference.
 * Messages are sent from chat route, processed here asynchronously.
 * 
 * This ensures inference latency is never impacted by storage operations.
 * 
 * Embeddings: Cloudflare Workers AI BGE-M3 only ($0.012/1M tokens)
 */

import { resolveVaultForStore } from '../services/do-router';
import { storeToVault } from '../services/kronos-do';
import { generateEmbedding, type EmbeddingConfig } from '../services/providers';
import type { StorageJob } from '../routes/chat';

// Re-export for index.ts
export type { StorageJob } from '../routes/chat';

/**
 * Environment for queue consumer
 */
export interface QueueEnv {
  VAULT_DO: DurableObjectNamespace;
  AI: Ai;  // Cloudflare Workers AI binding (required)
}

/**
 * Get embedding config from environment
 * Cloudflare Workers AI only — no fallbacks
 */
function getEmbeddingConfig(env: QueueEnv): EmbeddingConfig {
  return { ai: env.AI };
}

/**
 * Process a batch of storage jobs
 */
export async function handleStorageQueue(
  batch: MessageBatch<StorageJob>,
  env: QueueEnv
): Promise<void> {
  // Process each message in the batch
  const results = await Promise.allSettled(
    batch.messages.map(async (message) => {
      const job = message.body;
      
      if (job.type !== 'store-conversation') {
        console.error('[StorageQueue] Unknown job type:', job.type);
        message.ack();
        return;
      }
      
      try {
        await processStorageJob(job, env);
        message.ack();
      } catch (error) {
        console.error('[StorageQueue] Failed to process job:', error);
        // Retry by not acking (message will be redelivered)
        message.retry();
      }
    })
  );
  
  // Log summary
  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  console.log(`[StorageQueue] Processed batch: ${succeeded} succeeded, ${failed} failed`);
}

/**
 * Process a single storage job
 */
async function processStorageJob(job: StorageJob, env: QueueEnv): Promise<void> {
  const requestId = crypto.randomUUID();
  const stub = resolveVaultForStore(env.VAULT_DO, job.memoryKey, job.sessionId);
  
  for (const item of job.content) {
    // Send to DO's chunking endpoint
    const chunkResponse = await stub.fetch(new Request('https://do/store-chunked', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: item.content,
        role: item.role,
      }),
    }));
    
    const chunkResult = await chunkResponse.json() as {
      chunksToEmbed: string[];
      bufferTokens: number;
    };
    
    // Embed and store each complete chunk using Cloudflare AI
    const embeddingConfig = getEmbeddingConfig(env);
    for (const chunkContent of chunkResult.chunksToEmbed) {
      const embedding = await generateEmbedding(chunkContent, undefined, undefined, embeddingConfig);
      await storeToVault(stub, embedding, chunkContent, 'chunk', job.model, requestId);
    }
  }
}
