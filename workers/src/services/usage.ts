/**
 * MemoryRouter Usage Tracking Service
 * 
 * Records and queries usage data for customer metrics, dashboards, and billing.
 * All writes are fire-and-forget via waitUntil to avoid adding latency.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface UsageEvent {
  timestamp: number;           // Unix ms
  memoryKey: string;
  sessionId?: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  memoryTokensRetrieved: number;
  memoryTokensInjected: number;
  latencyEmbeddingMs?: number;
  latencyMrMs?: number;
  latencyProviderMs?: number;
  requestType?: 'chat' | 'completion' | 'embedding' | 'messages' | 'upload';
}

export interface UsageSummary {
  memoryKey: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  memoryTokensRetrieved: number;
  memoryTokensInjected: number;
  avgLatencyMrMs: number;
}

export interface DailyUsage {
  date: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  memoryTokensRetrieved: number;
  memoryTokensInjected: number;
  avgLatencyMrMs: number;
}

export interface TopKeyResult {
  memoryKey: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  memoryTokensRetrieved: number;
  memoryTokensInjected: number;
}

// ============================================================================
// USAGE SERVICE
// ============================================================================

/**
 * Record a usage event (fire-and-forget)
 * Call via ctx.waitUntil(recordUsage(...)) to avoid blocking
 */
export async function recordUsage(
  db: D1Database,
  event: UsageEvent
): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO usage_events (
        timestamp,
        memory_key,
        session_id,
        model,
        provider,
        input_tokens,
        output_tokens,
        memory_tokens_retrieved,
        memory_tokens_injected,
        latency_embedding_ms,
        latency_mr_ms,
        latency_provider_ms,
        request_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      event.timestamp,
      event.memoryKey,
      event.sessionId ?? null,
      event.model,
      event.provider,
      event.inputTokens,
      event.outputTokens,
      event.memoryTokensRetrieved,
      event.memoryTokensInjected,
      event.latencyEmbeddingMs ?? null,
      event.latencyMrMs ?? null,
      event.latencyProviderMs ?? null,
      event.requestType ?? 'chat'
    ).run();
  } catch (error) {
    // Log but don't throw - usage tracking should never break requests
    console.error('[USAGE] Failed to record event:', error);
  }
}

/**
 * Get usage for a specific memory key within a date range
 */
export async function getKeyUsage(
  db: D1Database,
  memoryKey: string,
  startDate: string,  // YYYY-MM-DD
  endDate: string     // YYYY-MM-DD
): Promise<{ daily: DailyUsage[]; summary: UsageSummary }> {
  // Convert dates to timestamps
  const startTs = new Date(startDate + 'T00:00:00Z').getTime();
  const endTs = new Date(endDate + 'T23:59:59.999Z').getTime();

  // Try daily rollups first (faster)
  const dailyResult = await db.prepare(`
    SELECT 
      date,
      request_count,
      input_tokens,
      output_tokens,
      memory_tokens_retrieved,
      memory_tokens_injected,
      avg_latency_mr_ms
    FROM usage_daily
    WHERE memory_key = ? 
      AND date >= ? 
      AND date <= ?
    ORDER BY date DESC
  `).bind(memoryKey, startDate, endDate).all();

  if (dailyResult.results && dailyResult.results.length > 0) {
    // Use rollup data
    const daily = dailyResult.results.map(row => ({
      date: row.date as string,
      requestCount: row.request_count as number,
      inputTokens: row.input_tokens as number,
      outputTokens: row.output_tokens as number,
      memoryTokensRetrieved: row.memory_tokens_retrieved as number,
      memoryTokensInjected: row.memory_tokens_injected as number,
      avgLatencyMrMs: row.avg_latency_mr_ms as number,
    }));

    // Calculate summary from rollups
    const summary: UsageSummary = {
      memoryKey,
      requestCount: daily.reduce((sum, d) => sum + d.requestCount, 0),
      inputTokens: daily.reduce((sum, d) => sum + d.inputTokens, 0),
      outputTokens: daily.reduce((sum, d) => sum + d.outputTokens, 0),
      memoryTokensRetrieved: daily.reduce((sum, d) => sum + d.memoryTokensRetrieved, 0),
      memoryTokensInjected: daily.reduce((sum, d) => sum + d.memoryTokensInjected, 0),
      avgLatencyMrMs: daily.length > 0 
        ? Math.round(daily.reduce((sum, d) => sum + d.avgLatencyMrMs * d.requestCount, 0) / 
            daily.reduce((sum, d) => sum + d.requestCount, 0))
        : 0,
    };

    return { daily, summary };
  }

  // Fall back to raw events (for recent data not yet rolled up)
  const eventsResult = await db.prepare(`
    SELECT 
      date(timestamp / 1000, 'unixepoch') as date,
      COUNT(*) as request_count,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens,
      SUM(memory_tokens_retrieved) as memory_tokens_retrieved,
      SUM(memory_tokens_injected) as memory_tokens_injected,
      AVG(latency_mr_ms) as avg_latency_mr_ms
    FROM usage_events
    WHERE memory_key = ?
      AND timestamp >= ?
      AND timestamp <= ?
    GROUP BY date(timestamp / 1000, 'unixepoch')
    ORDER BY date DESC
  `).bind(memoryKey, startTs, endTs).all();

  const daily = (eventsResult.results || []).map(row => ({
    date: row.date as string,
    requestCount: row.request_count as number,
    inputTokens: (row.input_tokens as number) || 0,
    outputTokens: (row.output_tokens as number) || 0,
    memoryTokensRetrieved: (row.memory_tokens_retrieved as number) || 0,
    memoryTokensInjected: (row.memory_tokens_injected as number) || 0,
    avgLatencyMrMs: Math.round((row.avg_latency_mr_ms as number) || 0),
  }));

  const summary: UsageSummary = {
    memoryKey,
    requestCount: daily.reduce((sum, d) => sum + d.requestCount, 0),
    inputTokens: daily.reduce((sum, d) => sum + d.inputTokens, 0),
    outputTokens: daily.reduce((sum, d) => sum + d.outputTokens, 0),
    memoryTokensRetrieved: daily.reduce((sum, d) => sum + d.memoryTokensRetrieved, 0),
    memoryTokensInjected: daily.reduce((sum, d) => sum + d.memoryTokensInjected, 0),
    avgLatencyMrMs: daily.length > 0 
      ? Math.round(daily.reduce((sum, d) => sum + d.avgLatencyMrMs * d.requestCount, 0) / 
          daily.reduce((sum, d) => sum + d.requestCount, 0))
      : 0,
  };

  return { daily, summary };
}

/**
 * Get top customers by usage within a date range
 */
export async function getTopKeys(
  db: D1Database,
  limit: number,
  startDate: string,
  endDate: string
): Promise<TopKeyResult[]> {
  // Try daily rollups first
  const rollupResult = await db.prepare(`
    SELECT 
      memory_key,
      SUM(request_count) as request_count,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens,
      SUM(memory_tokens_retrieved) as memory_tokens_retrieved,
      SUM(memory_tokens_injected) as memory_tokens_injected
    FROM usage_daily
    WHERE date >= ? AND date <= ?
    GROUP BY memory_key
    ORDER BY request_count DESC
    LIMIT ?
  `).bind(startDate, endDate, limit).all();

  if (rollupResult.results && rollupResult.results.length > 0) {
    return rollupResult.results.map(row => ({
      memoryKey: row.memory_key as string,
      requestCount: row.request_count as number,
      inputTokens: (row.input_tokens as number) || 0,
      outputTokens: (row.output_tokens as number) || 0,
      memoryTokensRetrieved: (row.memory_tokens_retrieved as number) || 0,
      memoryTokensInjected: (row.memory_tokens_injected as number) || 0,
    }));
  }

  // Fall back to raw events
  const startTs = new Date(startDate + 'T00:00:00Z').getTime();
  const endTs = new Date(endDate + 'T23:59:59.999Z').getTime();

  const eventsResult = await db.prepare(`
    SELECT 
      memory_key,
      COUNT(*) as request_count,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens,
      SUM(memory_tokens_retrieved) as memory_tokens_retrieved,
      SUM(memory_tokens_injected) as memory_tokens_injected
    FROM usage_events
    WHERE timestamp >= ? AND timestamp <= ?
    GROUP BY memory_key
    ORDER BY request_count DESC
    LIMIT ?
  `).bind(startTs, endTs, limit).all();

  return (eventsResult.results || []).map(row => ({
    memoryKey: row.memory_key as string,
    requestCount: row.request_count as number,
    inputTokens: (row.input_tokens as number) || 0,
    outputTokens: (row.output_tokens as number) || 0,
    memoryTokensRetrieved: (row.memory_tokens_retrieved as number) || 0,
    memoryTokensInjected: (row.memory_tokens_injected as number) || 0,
  }));
}

/**
 * Roll up raw events into daily aggregates (for cron job)
 * Processes events older than 24 hours that haven't been rolled up yet
 */
export async function rollupDaily(db: D1Database): Promise<{ 
  daysProcessed: number; 
  eventsRolledUp: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let daysProcessed = 0;
  let eventsRolledUp = 0;

  try {
    // Get yesterday's date (don't process today - still accumulating)
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // Find dates that need rollup (events exist but no daily rollup)
    // Look back up to 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90);
    const startTs = ninetyDaysAgo.getTime();
    const endTs = new Date(yesterdayStr + 'T23:59:59.999Z').getTime();

    // Get distinct dates with events
    const datesResult = await db.prepare(`
      SELECT DISTINCT date(timestamp / 1000, 'unixepoch') as date
      FROM usage_events
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY date
    `).bind(startTs, endTs).all();

    const eventDates = new Set((datesResult.results || []).map(r => r.date as string));

    // Get dates already rolled up
    const rolledUpResult = await db.prepare(`
      SELECT DISTINCT date FROM usage_daily
      WHERE date >= ? AND date <= ?
    `).bind(ninetyDaysAgo.toISOString().split('T')[0], yesterdayStr).all();

    const rolledUpDates = new Set((rolledUpResult.results || []).map(r => r.date as string));

    // Process each date that needs rollup
    for (const date of eventDates) {
      if (rolledUpDates.has(date)) {
        continue; // Already rolled up
      }

      try {
        const dateStart = new Date(date + 'T00:00:00Z').getTime();
        const dateEnd = new Date(date + 'T23:59:59.999Z').getTime();

        // Aggregate events for this date
        const aggregateResult = await db.prepare(`
          SELECT 
            memory_key,
            COUNT(*) as request_count,
            SUM(input_tokens) as input_tokens,
            SUM(output_tokens) as output_tokens,
            SUM(memory_tokens_retrieved) as memory_tokens_retrieved,
            SUM(memory_tokens_injected) as memory_tokens_injected,
            AVG(latency_mr_ms) as avg_latency_mr_ms
          FROM usage_events
          WHERE timestamp >= ? AND timestamp <= ?
          GROUP BY memory_key
        `).bind(dateStart, dateEnd).all();

        // Insert rollups (upsert)
        for (const row of (aggregateResult.results || [])) {
          await db.prepare(`
            INSERT INTO usage_daily (
              date, memory_key, request_count, input_tokens, output_tokens,
              memory_tokens_retrieved, memory_tokens_injected, avg_latency_mr_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date, memory_key) DO UPDATE SET
              request_count = excluded.request_count,
              input_tokens = excluded.input_tokens,
              output_tokens = excluded.output_tokens,
              memory_tokens_retrieved = excluded.memory_tokens_retrieved,
              memory_tokens_injected = excluded.memory_tokens_injected,
              avg_latency_mr_ms = excluded.avg_latency_mr_ms
          `).bind(
            date,
            row.memory_key,
            row.request_count,
            row.input_tokens || 0,
            row.output_tokens || 0,
            row.memory_tokens_retrieved || 0,
            row.memory_tokens_injected || 0,
            Math.round((row.avg_latency_mr_ms as number) || 0)
          ).run();

          eventsRolledUp += row.request_count as number;
        }

        daysProcessed++;
      } catch (err) {
        errors.push(`Failed to rollup ${date}: ${err}`);
      }
    }

    // Clean up old raw events (older than 90 days)
    const cleanupTs = ninetyDaysAgo.getTime();
    await db.prepare(`
      DELETE FROM usage_events WHERE timestamp < ?
    `).bind(cleanupTs).run();

  } catch (error) {
    errors.push(`Rollup failed: ${error}`);
  }

  return { daysProcessed, eventsRolledUp, errors };
}

/**
 * Get recent events for a key (for debugging/admin)
 */
export async function getRecentEvents(
  db: D1Database,
  memoryKey: string,
  limit: number = 50
): Promise<UsageEvent[]> {
  const result = await db.prepare(`
    SELECT 
      timestamp,
      memory_key,
      session_id,
      model,
      provider,
      input_tokens,
      output_tokens,
      memory_tokens_retrieved,
      memory_tokens_injected,
      latency_embedding_ms,
      latency_mr_ms,
      latency_provider_ms,
      request_type
    FROM usage_events
    WHERE memory_key = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).bind(memoryKey, limit).all();

  return (result.results || []).map(row => ({
    timestamp: row.timestamp as number,
    memoryKey: row.memory_key as string,
    sessionId: row.session_id as string | undefined,
    model: row.model as string,
    provider: row.provider as string,
    inputTokens: (row.input_tokens as number) || 0,
    outputTokens: (row.output_tokens as number) || 0,
    memoryTokensRetrieved: (row.memory_tokens_retrieved as number) || 0,
    memoryTokensInjected: (row.memory_tokens_injected as number) || 0,
    latencyEmbeddingMs: row.latency_embedding_ms as number | undefined,
    latencyMrMs: row.latency_mr_ms as number | undefined,
    latencyProviderMs: row.latency_provider_ms as number | undefined,
    requestType: row.request_type as 'chat' | 'completion' | 'embedding' | undefined,
  }));
}
