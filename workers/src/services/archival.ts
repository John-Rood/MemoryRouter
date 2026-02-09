/**
 * MemoryRouter Archival Storage Service
 * 
 * Handles data retention and billing for memories older than 90 days.
 * 
 * Pricing: $0.10/GB/month for archival storage
 * 
 * Two cron jobs:
 * 1. Daily: Calculate archival storage per user, purge old data for non-archival users
 * 2. Monthly (1st): Bill archival storage to Stripe
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ArchivalStorageRecord {
  userId: string;
  memoryKey: string;
  vectorsTotal: number;
  vectorsArchived: number;
  bytesArchived: number;
  calculatedAt: string;
  oldestVectorAt: string | null;
  newestVectorAt: string | null;
}

export interface ArchivalBillingRecord {
  userId: string;
  billingMonth: string;
  bytesArchived: number;
  gbArchived: number;
  costCents: number;
  reportedToStripe: boolean;
  stripeUsageRecordId: string | null;
}

export interface DailyArchivalResult {
  usersProcessed: number;
  keysProcessed: number;
  totalArchivalBytes: number;
  usersPurged: number;
  vectorsPurged: number;
  errors: string[];
}

export interface MonthlyBillingResult {
  usersProcessed: number;
  usersBilled: number;
  totalGbBilled: number;
  totalCentsBilled: number;
  stripeErrors: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** 90 days in milliseconds */
const ARCHIVAL_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000;

/** Price per GB per month in cents: $0.10 = 10 cents */
const CENTS_PER_GB_MONTH = 10;

/** Bytes per GB */
const BYTES_PER_GB = 1024 * 1024 * 1024;

// ============================================================================
// ARCHIVAL SERVICE CLASS
// ============================================================================

export class ArchivalService {
  constructor(
    private db: D1Database,
    private vaultDO: DurableObjectNamespace
  ) {}

  // ==========================================================================
  // DAILY: CALCULATE ARCHIVAL STORAGE + PURGE
  // ==========================================================================

  /**
   * Daily cron job: Calculate archival storage and purge old data
   * 
   * Archival is automatic based on payment method:
   * 1. Query vault DO for storage stats (vectors older than 90 days)
   * 2. If user has payment method: Record storage for monthly billing (keep forever)
   * 3. If user has no payment method: Purge vectors older than 90 days
   */
  async runDailyArchivalCheck(): Promise<DailyArchivalResult> {
    const result: DailyArchivalResult = {
      usersProcessed: 0,
      keysProcessed: 0,
      totalArchivalBytes: 0,
      usersPurged: 0,
      vectorsPurged: 0,
      errors: [],
    };

    const now = Date.now();
    const archivalCutoff = now - ARCHIVAL_THRESHOLD_MS;
    const nowIso = new Date(now).toISOString();

    try {
      // Get all users with billing records
      // Archival is automatic: has_payment_method = keep forever, no payment = purge at 90d
      const usersResult = await this.db.prepare(`
        SELECT DISTINCT user_id, has_payment_method 
        FROM billing 
        WHERE user_id IS NOT NULL
      `).all();

      const users = usersResult.results || [];
      result.usersProcessed = users.length;

      for (const user of users) {
        const userId = user.user_id as string;
        const hasPaymentMethod = Boolean(user.has_payment_method);

        try {
          // Get all memory keys for this user
          const keysResult = await this.db.prepare(`
            SELECT key FROM memory_keys WHERE user_id = ?
          `).bind(userId).all();

          const keys = keysResult.results || [];

          for (const keyRow of keys) {
            const memoryKey = keyRow.key as string;
            result.keysProcessed++;

            try {
              // Get vault stats from Durable Object
              const vaultStats = await this.getVaultArchivalStats(memoryKey, archivalCutoff);

              if (hasPaymentMethod) {
                // Has payment method = keep data forever, record for billing
                await this.db.prepare(`
                  INSERT INTO archival_storage (
                    user_id, memory_key, vectors_total, vectors_archived, 
                    bytes_archived, calculated_at, oldest_vector_at, newest_vector_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(user_id, memory_key) DO UPDATE SET
                    vectors_total = excluded.vectors_total,
                    vectors_archived = excluded.vectors_archived,
                    bytes_archived = excluded.bytes_archived,
                    calculated_at = excluded.calculated_at,
                    oldest_vector_at = excluded.oldest_vector_at,
                    newest_vector_at = excluded.newest_vector_at
                `).bind(
                  userId,
                  memoryKey,
                  vaultStats.vectorsTotal,
                  vaultStats.vectorsArchived,
                  vaultStats.bytesArchived,
                  nowIso,
                  vaultStats.oldestAt,
                  vaultStats.newestAt
                ).run();

                result.totalArchivalBytes += vaultStats.bytesArchived;

              } else if (vaultStats.vectorsArchived > 0) {
                // No payment method = purge old vectors (>90 days)
                const purgeResult = await this.purgeOldVectors(memoryKey, archivalCutoff);
                
                // Log the purge
                await this.db.prepare(`
                  INSERT INTO archival_purge_log (
                    user_id, memory_key, vectors_purged, bytes_purged, 
                    oldest_purged_at, reason, created_at
                  ) VALUES (?, ?, ?, ?, ?, 'auto_purge_90d', ?)
                `).bind(
                  userId,
                  memoryKey,
                  purgeResult.vectorsPurged,
                  purgeResult.bytesPurged,
                  vaultStats.oldestAt || nowIso,
                  nowIso
                ).run();

                result.vectorsPurged += purgeResult.vectorsPurged;
                if (purgeResult.vectorsPurged > 0) {
                  result.usersPurged++;
                }
              }

            } catch (keyError) {
              result.errors.push(`Key ${memoryKey}: ${(keyError as Error).message}`);
            }
          }

        } catch (userError) {
          result.errors.push(`User ${userId}: ${(userError as Error).message}`);
        }
      }

      // Update billing table with totals
      await this.updateBillingTotals(nowIso);

    } catch (error) {
      result.errors.push(`Fatal: ${(error as Error).message}`);
    }

    return result;
  }

  /**
   * Get archival stats from a vault Durable Object
   */
  private async getVaultArchivalStats(
    memoryKey: string,
    archivalCutoff: number
  ): Promise<{
    vectorsTotal: number;
    vectorsArchived: number;
    bytesArchived: number;
    oldestAt: string | null;
    newestAt: string | null;
  }> {
    // Core vault name
    const vaultName = `${memoryKey}:core`;
    const doId = this.vaultDO.idFromName(vaultName);
    const stub = this.vaultDO.get(doId);

    // Call stats endpoint on vault DO
    const response = await stub.fetch(new Request('https://do/archival-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archivalCutoff }),
    }));

    if (!response.ok) {
      // Vault might not exist yet
      return {
        vectorsTotal: 0,
        vectorsArchived: 0,
        bytesArchived: 0,
        oldestAt: null,
        newestAt: null,
      };
    }

    return await response.json();
  }

  /**
   * Purge vectors older than cutoff from a vault
   */
  private async purgeOldVectors(
    memoryKey: string,
    archivalCutoff: number
  ): Promise<{ vectorsPurged: number; bytesPurged: number }> {
    const vaultName = `${memoryKey}:core`;
    const doId = this.vaultDO.idFromName(vaultName);
    const stub = this.vaultDO.get(doId);

    const response = await stub.fetch(new Request('https://do/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ olderThan: archivalCutoff }),
    }));

    if (!response.ok) {
      return { vectorsPurged: 0, bytesPurged: 0 };
    }

    const result = await response.json() as { deleted?: number; bytesDeleted?: number };
    return {
      vectorsPurged: result.deleted || 0,
      bytesPurged: result.bytesDeleted || 0,
    };
  }

  /**
   * Update billing table with total archival bytes per user
   */
  private async updateBillingTotals(nowIso: string): Promise<void> {
    // Aggregate archival storage per user
    const totalsResult = await this.db.prepare(`
      SELECT user_id, SUM(bytes_archived) as total_bytes
      FROM archival_storage
      GROUP BY user_id
    `).all();

    for (const row of (totalsResult.results || [])) {
      const userId = row.user_id as string;
      const totalBytes = row.total_bytes as number;
      const costCents = Math.ceil((totalBytes / BYTES_PER_GB) * CENTS_PER_GB_MONTH);

      await this.db.prepare(`
        UPDATE billing 
        SET archival_bytes_total = ?, archival_cost_cents = ?, archival_last_calculated = ?
        WHERE user_id = ?
      `).bind(totalBytes, costCents, nowIso, userId).run();
    }
  }

  // ==========================================================================
  // MONTHLY: BILL ARCHIVAL STORAGE TO STRIPE
  // ==========================================================================

  /**
   * Monthly cron job (1st of month): Bill archival storage to Stripe
   * 
   * Automatic billing for users with payment method and bytes_archived > 0:
   * 1. Calculate GB and cost ($0.10/GB/month)
   * 2. Report to Stripe Billing Meter
   * 3. Log billing record
   */
  async runMonthlyArchivalBilling(
    stripeReportCallback?: (
      stripeCustomerId: string,
      quantity: number,
      timestamp: number
    ) => Promise<string>
  ): Promise<MonthlyBillingResult> {
    const result: MonthlyBillingResult = {
      usersProcessed: 0,
      usersBilled: 0,
      totalGbBilled: 0,
      totalCentsBilled: 0,
      stripeErrors: [],
    };

    const now = new Date();
    // Billing month is previous month
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const billingMonth = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
    const nowIso = now.toISOString();

    try {
      // Get all users with payment method and archival storage (automatic billing)
      const usersResult = await this.db.prepare(`
        SELECT 
          user_id,
          archival_bytes_total,
          archival_cost_cents,
          stripe_customer_id
        FROM billing
        WHERE has_payment_method = 1 
          AND archival_bytes_total > 0
          AND stripe_customer_id IS NOT NULL
      `).all();

      const users = usersResult.results || [];
      result.usersProcessed = users.length;

      for (const user of users) {
        const userId = user.user_id as string;
        const bytesArchived = user.archival_bytes_total as number;
        const stripeCustomerId = user.stripe_customer_id as string;
        // Note: With Billing Meters, we only need customer ID (not subscription ID)

        const gbArchived = bytesArchived / BYTES_PER_GB;
        const costCents = Math.ceil(gbArchived * CENTS_PER_GB_MONTH);

        // Check if already billed this month
        const existingBilling = await this.db.prepare(`
          SELECT id FROM archival_billing_records 
          WHERE user_id = ? AND billing_month = ?
        `).bind(userId, billingMonth).first();

        if (existingBilling) {
          continue; // Already billed
        }

        // Report to Stripe if callback provided
        let stripeUsageRecordId: string | null = null;
        if (stripeReportCallback && costCents > 0) {
          try {
            // Report GB as quantity (rounded up to nearest 0.01 GB = 10MB)
            const quantity = Math.ceil(gbArchived * 100); // Centibytes (0.01 GB units)
            stripeUsageRecordId = await stripeReportCallback(
              stripeCustomerId,
              quantity,
              Math.floor(prevMonth.getTime() / 1000)
            );
          } catch (stripeError) {
            result.stripeErrors.push(`${userId}: ${(stripeError as Error).message}`);
            continue;
          }
        }

        // Record billing
        await this.db.prepare(`
          INSERT INTO archival_billing_records (
            user_id, billing_month, bytes_archived, gb_archived,
            cost_cents, stripe_usage_record_id, reported_to_stripe, 
            reported_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          userId,
          billingMonth,
          bytesArchived,
          gbArchived,
          costCents,
          stripeUsageRecordId,
          stripeUsageRecordId ? 1 : 0,
          stripeUsageRecordId ? nowIso : null,
          nowIso
        ).run();

        result.usersBilled++;
        result.totalGbBilled += gbArchived;
        result.totalCentsBilled += costCents;
      }

    } catch (error) {
      result.stripeErrors.push(`Fatal: ${(error as Error).message}`);
    }

    return result;
  }

  // ==========================================================================
  // USER INFO (Archival is now automatic based on payment method)
  // ==========================================================================

  /**
   * Get archival storage info for a user
   * Archival is automatic: has_payment_method = keep forever
   */
  async getArchivalInfo(userId: string): Promise<{
    enabled: boolean;
    hasPaymentMethod: boolean;
    bytesTotal: number;
    gbTotal: number;
    estimatedMonthlyCostCents: number;
    keys: ArchivalStorageRecord[];
  } | null> {
    const billingResult = await this.db.prepare(`
      SELECT has_payment_method, archival_bytes_total, archival_cost_cents
      FROM billing WHERE user_id = ?
    `).bind(userId).first();

    if (!billingResult) return null;

    const keysResult = await this.db.prepare(`
      SELECT * FROM archival_storage WHERE user_id = ? ORDER BY bytes_archived DESC
    `).bind(userId).all();

    const bytesTotal = billingResult.archival_bytes_total as number || 0;
    const hasPaymentMethod = Boolean(billingResult.has_payment_method);

    return {
      enabled: hasPaymentMethod,  // Archival enabled = has payment method
      hasPaymentMethod,
      bytesTotal,
      gbTotal: bytesTotal / BYTES_PER_GB,
      estimatedMonthlyCostCents: billingResult.archival_cost_cents as number || 0,
      keys: (keysResult.results || []).map(row => ({
        userId: row.user_id as string,
        memoryKey: row.memory_key as string,
        vectorsTotal: row.vectors_total as number,
        vectorsArchived: row.vectors_archived as number,
        bytesArchived: row.bytes_archived as number,
        calculatedAt: row.calculated_at as string,
        oldestVectorAt: row.oldest_vector_at as string | null,
        newestVectorAt: row.newest_vector_at as string | null,
      })),
    };
  }

  /**
   * Get billing history for a user
   */
  async getBillingHistory(userId: string, limit: number = 12): Promise<ArchivalBillingRecord[]> {
    const result = await this.db.prepare(`
      SELECT * FROM archival_billing_records 
      WHERE user_id = ? 
      ORDER BY billing_month DESC 
      LIMIT ?
    `).bind(userId, limit).all();

    return (result.results || []).map(row => ({
      userId: row.user_id as string,
      billingMonth: row.billing_month as string,
      bytesArchived: row.bytes_archived as number,
      gbArchived: row.gb_archived as number,
      costCents: row.cost_cents as number,
      reportedToStripe: Boolean(row.reported_to_stripe),
      stripeUsageRecordId: row.stripe_usage_record_id as string | null,
    }));
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createArchivalService(
  db: D1Database,
  vaultDO: DurableObjectNamespace
): ArchivalService {
  return new ArchivalService(db, vaultDO);
}
