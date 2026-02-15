/**
 * MemoryRouter Billing Service
 * 
 * Handles all billing operations:
 * - Account management
 * - Usage recording (memory tokens only)
 * - Balance operations
 * - Auto-reup logic
 * 
 * Pricing: $0.20 per 1M memory tokens = $0.0000002/token = 0.00002 cents/token
 * Free tier: 50M memory tokens
 */

// ============================================================================
// TYPES
// ============================================================================

export interface Account {
  id: string;
  email: string;
  created_at: number;
  updated_at: number;
  
  // Balance
  balance_cents: number;
  free_tokens_remaining: number;
  lifetime_tokens_used: number;
  
  // Auto-reup settings
  auto_reup_enabled: boolean;
  auto_reup_amount_cents: number;
  auto_reup_threshold_cents: number;
  monthly_cap_cents: number | null;
  
  // Period tracking
  period_start: number;
  period_tokens_used: number;
  period_spend_cents: number;
  
  // Stripe
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  
  // Provider keys
  has_openai_key: boolean;
  has_anthropic_key: boolean;
  has_google_key: boolean;
  has_xai_key: boolean;
  has_cerebras_key: boolean;
  has_deepseek_key: boolean;
  has_openrouter_key: boolean;
  
  // Status
  status: 'active' | 'suspended' | 'deleted';
  suspended_reason: string | null;
}

export interface UsageRecord {
  id: number;
  account_id: string;
  created_at: number;
  request_id: string;
  session_id: string | null;
  model: string;
  provider: string;
  input_tokens: number;
  memory_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_cents: number;
  free_tokens_used: number;
  paid_tokens_used: number;
  used_free_tier: boolean;
  truncation_applied: boolean;
}

export interface Transaction {
  id: number;
  account_id: string;
  created_at: number;
  type: 'charge' | 'refund' | 'auto_reup' | 'manual_topup' | 'free_tier_grant';
  amount_cents: number;
  balance_before_cents: number;
  balance_after_cents: number;
  stripe_payment_intent_id: string | null;
  usage_record_id: number | null;
  description: string | null;
}

export interface BalanceCheck {
  balance_cents: number;
  free_tokens_remaining: number;
  can_process_request: boolean;
  needs_auto_reup: boolean;
  monthly_cap_reached: boolean;
  status: 'ok' | 'low_balance' | 'suspended' | 'cap_reached';
}

export interface UsageSummary {
  period_days: number;
  total_requests: number;
  total_memory_tokens: number;
  total_cost_cents: number;
  free_tokens_used: number;
  daily_breakdown: DailyUsage[];
  provider_breakdown: Record<string, number>;
  model_breakdown: Record<string, number>;
}

export interface DailyUsage {
  date: string;
  requests: number;
  memory_tokens: number;
  cost_cents: number;
}

export interface RecordUsageParams {
  accountId: string;
  requestId: string;
  sessionId?: string;
  model: string;
  provider: string;
  inputTokens: number;
  memoryTokens: number;
  outputTokens: number;
  truncationApplied: boolean;
  memoryRetrievalMs?: number;
  providerLatencyMs?: number;
  totalLatencyMs?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Price per memory token in cents: $0.20/1M = 0.00002 cents/token */
const CENTS_PER_TOKEN = 0.00002;

/** Default free tier: 50M tokens */
const DEFAULT_FREE_TOKENS = 50_000_000;

/** Minimum balance to process requests (cents) */
const MIN_BALANCE_CENTS = 0;

// ============================================================================
// BILLING SERVICE CLASS
// ============================================================================

export class BillingService {
  constructor(private db: D1Database) {}

  // ==========================================================================
  // ACCOUNT MANAGEMENT
  // ==========================================================================

  /**
   * Get an account by ID
   */
  async getAccount(accountId: string): Promise<Account | null> {
    const row = await this.db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .bind(accountId)
      .first();

    if (!row) return null;
    return this.rowToAccount(row);
  }

  /**
   * Get an account by email
   */
  async getAccountByEmail(email: string): Promise<Account | null> {
    const row = await this.db
      .prepare('SELECT * FROM accounts WHERE email = ?')
      .bind(email)
      .first();

    if (!row) return null;
    return this.rowToAccount(row);
  }

  /**
   * Create a new account
   */
  async createAccount(email: string, id?: string): Promise<Account> {
    const accountId = id || `mk_${crypto.randomUUID().replace(/-/g, '')}`;
    const now = Math.floor(Date.now() / 1000);

    await this.db
      .prepare(`
        INSERT INTO accounts (
          id, email, created_at, updated_at,
          balance_cents, free_tokens_remaining, lifetime_tokens_used,
          auto_reup_enabled, auto_reup_amount_cents, auto_reup_threshold_cents,
          period_start, period_tokens_used, period_spend_cents,
          status
        ) VALUES (?, ?, ?, ?, 0, ?, 0, 1, 2000, 500, ?, 0, 0, 'active')
      `)
      .bind(accountId, email, now, now, DEFAULT_FREE_TOKENS, now)
      .run();

    // Record free tier grant transaction
    await this.db
      .prepare(`
        INSERT INTO transactions (
          account_id, created_at, type, amount_cents, 
          balance_before_cents, balance_after_cents, description
        ) VALUES (?, ?, 'free_tier_grant', 0, 0, 0, ?)
      `)
      .bind(accountId, now, `Free tier granted: ${DEFAULT_FREE_TOKENS.toLocaleString()} tokens`)
      .run();

    return (await this.getAccount(accountId))!;
  }

  /**
   * Update account settings
   */
  async updateAccount(
    accountId: string,
    updates: Partial<Pick<Account, 
      'auto_reup_enabled' | 'auto_reup_amount_cents' | 'auto_reup_threshold_cents' | 
      'monthly_cap_cents' | 'stripe_customer_id' | 'stripe_payment_method_id'
    >>
  ): Promise<Account | null> {
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.auto_reup_enabled !== undefined) {
      setClauses.push('auto_reup_enabled = ?');
      values.push(updates.auto_reup_enabled ? 1 : 0);
    }
    if (updates.auto_reup_amount_cents !== undefined) {
      setClauses.push('auto_reup_amount_cents = ?');
      values.push(updates.auto_reup_amount_cents);
    }
    if (updates.auto_reup_threshold_cents !== undefined) {
      setClauses.push('auto_reup_threshold_cents = ?');
      values.push(updates.auto_reup_threshold_cents);
    }
    if (updates.monthly_cap_cents !== undefined) {
      setClauses.push('monthly_cap_cents = ?');
      values.push(updates.monthly_cap_cents);
    }
    if (updates.stripe_customer_id !== undefined) {
      setClauses.push('stripe_customer_id = ?');
      values.push(updates.stripe_customer_id);
    }
    if (updates.stripe_payment_method_id !== undefined) {
      setClauses.push('stripe_payment_method_id = ?');
      values.push(updates.stripe_payment_method_id);
    }

    if (setClauses.length === 0) {
      return this.getAccount(accountId);
    }

    values.push(accountId);
    await this.db
      .prepare(`UPDATE accounts SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return this.getAccount(accountId);
  }

  /**
   * Update provider key flags
   */
  async updateProviderKeyFlags(
    accountId: string,
    flags: Partial<Pick<Account, 
      'has_openai_key' | 'has_anthropic_key' | 'has_google_key' | 
      'has_xai_key' | 'has_cerebras_key' | 'has_deepseek_key' | 'has_openrouter_key'
    >>
  ): Promise<void> {
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(flags)) {
      if (value !== undefined) {
        setClauses.push(`${key} = ?`);
        values.push(value ? 1 : 0);
      }
    }

    if (setClauses.length === 0) return;

    values.push(accountId);
    await this.db
      .prepare(`UPDATE accounts SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  // ==========================================================================
  // BALANCE OPERATIONS
  // ==========================================================================

  /**
   * Check if account can process a request
   */
  async checkBalance(accountId: string): Promise<BalanceCheck> {
    const account = await this.getAccount(accountId);

    if (!account) {
      return {
        balance_cents: 0,
        free_tokens_remaining: 0,
        can_process_request: false,
        needs_auto_reup: false,
        monthly_cap_reached: false,
        status: 'suspended',
      };
    }

    // Check if suspended
    if (account.status !== 'active') {
      return {
        balance_cents: account.balance_cents,
        free_tokens_remaining: account.free_tokens_remaining,
        can_process_request: false,
        needs_auto_reup: false,
        monthly_cap_reached: false,
        status: 'suspended',
      };
    }

    // Check monthly cap
    const monthlyCap = account.monthly_cap_cents;
    if (monthlyCap !== null && account.period_spend_cents >= monthlyCap) {
      return {
        balance_cents: account.balance_cents,
        free_tokens_remaining: account.free_tokens_remaining,
        can_process_request: false,
        needs_auto_reup: false,
        monthly_cap_reached: true,
        status: 'cap_reached',
      };
    }

    // Can process if has free tokens OR has balance
    const canProcess = account.free_tokens_remaining > 0 || account.balance_cents > MIN_BALANCE_CENTS;

    // Check if needs auto-reup
    const needsAutoReup = 
      account.auto_reup_enabled &&
      account.free_tokens_remaining === 0 &&
      account.balance_cents < account.auto_reup_threshold_cents;

    return {
      balance_cents: account.balance_cents,
      free_tokens_remaining: account.free_tokens_remaining,
      can_process_request: canProcess,
      needs_auto_reup: needsAutoReup,
      monthly_cap_reached: false,
      status: canProcess ? 'ok' : 'low_balance',
    };
  }

  /**
   * Add funds to account (manual top-up or auto-reup)
   */
  async addFunds(
    accountId: string,
    amountCents: number,
    type: 'auto_reup' | 'manual_topup',
    stripePaymentIntentId?: string
  ): Promise<Transaction> {
    const account = await this.getAccount(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);

    const now = Math.floor(Date.now() / 1000);
    const balanceBefore = account.balance_cents;
    const balanceAfter = balanceBefore + amountCents;

    // Update account balance
    await this.db
      .prepare('UPDATE accounts SET balance_cents = ? WHERE id = ?')
      .bind(balanceAfter, accountId)
      .run();

    // Record transaction
    const result = await this.db
      .prepare(`
        INSERT INTO transactions (
          account_id, created_at, type, amount_cents,
          balance_before_cents, balance_after_cents,
          stripe_payment_intent_id, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `)
      .bind(
        accountId, now, type, amountCents,
        balanceBefore, balanceAfter,
        stripePaymentIntentId || null,
        type === 'auto_reup' 
          ? `Auto-reup: $${(amountCents / 100).toFixed(2)}` 
          : `Top-up: $${(amountCents / 100).toFixed(2)}`
      )
      .first<{ id: number }>();

    return {
      id: result!.id,
      account_id: accountId,
      created_at: now,
      type,
      amount_cents: amountCents,
      balance_before_cents: balanceBefore,
      balance_after_cents: balanceAfter,
      stripe_payment_intent_id: stripePaymentIntentId || null,
      usage_record_id: null,
      description: type === 'auto_reup' 
        ? `Auto-reup: $${(amountCents / 100).toFixed(2)}` 
        : `Top-up: $${(amountCents / 100).toFixed(2)}`,
    };
  }

  /**
   * Trigger auto-reup if conditions are met
   * Returns null if auto-reup not needed or not configured
   */
  async triggerAutoReup(
    accountId: string,
    chargeStripeCallback?: (customerId: string, amountCents: number) => Promise<string>
  ): Promise<Transaction | null> {
    const account = await this.getAccount(accountId);
    if (!account) return null;

    // Check if auto-reup is enabled and needed
    if (!account.auto_reup_enabled) return null;
    if (account.free_tokens_remaining > 0) return null;
    if (account.balance_cents >= account.auto_reup_threshold_cents) return null;

    // Need Stripe setup
    if (!account.stripe_customer_id || !account.stripe_payment_method_id) {
      console.warn(`Auto-reup needed but no payment method for account ${accountId}`);
      return null;
    }

    // Check monthly cap
    if (account.monthly_cap_cents !== null) {
      const newSpend = account.period_spend_cents + account.auto_reup_amount_cents;
      if (newSpend > account.monthly_cap_cents) {
        console.warn(`Auto-reup would exceed monthly cap for account ${accountId}`);
        return null;
      }
    }

    let stripePaymentIntentId: string | undefined;

    // Charge Stripe if callback provided
    if (chargeStripeCallback) {
      try {
        stripePaymentIntentId = await chargeStripeCallback(
          account.stripe_customer_id,
          account.auto_reup_amount_cents
        );
      } catch (error) {
        console.error(`Stripe charge failed for auto-reup: ${error}`);
        // Suspend account on payment failure
        await this.db
          .prepare(`
            UPDATE accounts SET status = 'suspended', suspended_reason = ?, suspended_at = ?
            WHERE id = ?
          `)
          .bind('Auto-reup payment failed', Math.floor(Date.now() / 1000), accountId)
          .run();
        return null;
      }
    }

    // Add funds
    return this.addFunds(
      accountId,
      account.auto_reup_amount_cents,
      'auto_reup',
      stripePaymentIntentId
    );
  }

  // ==========================================================================
  // USAGE RECORDING
  // ==========================================================================

  /**
   * Record usage for a request
   * Only memory_tokens are billed
   */
  async recordUsage(params: RecordUsageParams): Promise<UsageRecord> {
    const account = await this.getAccount(params.accountId);
    if (!account) throw new Error(`Account not found: ${params.accountId}`);

    const now = Math.floor(Date.now() / 1000);
    const totalTokens = params.inputTokens + params.memoryTokens + params.outputTokens;

    // Calculate billing for memory tokens only
    let freeTokensUsed = 0;
    let paidTokensUsed = 0;
    let costCents = 0;

    if (params.memoryTokens > 0) {
      if (account.free_tokens_remaining > 0) {
        // Use free tier first
        freeTokensUsed = Math.min(params.memoryTokens, account.free_tokens_remaining);
        paidTokensUsed = params.memoryTokens - freeTokensUsed;
      } else {
        // All paid
        paidTokensUsed = params.memoryTokens;
      }

      // Cost is only for paid tokens
      // $0.20 per 1M tokens = $0.0000002 per token = 0.00002 cents per token
      costCents = parseFloat((paidTokensUsed * CENTS_PER_TOKEN).toFixed(4));
    }

    // Insert usage record
    const result = await this.db
      .prepare(`
        INSERT INTO usage_records (
          account_id, created_at, request_id, session_id,
          model, provider,
          input_tokens, memory_tokens, output_tokens, total_tokens,
          cost_cents, free_tokens_used, paid_tokens_used, used_free_tier,
          truncation_applied, memory_retrieval_ms, provider_latency_ms, total_latency_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `)
      .bind(
        params.accountId, now, params.requestId, params.sessionId || null,
        params.model, params.provider,
        params.inputTokens, params.memoryTokens, params.outputTokens, totalTokens,
        costCents, freeTokensUsed, paidTokensUsed, freeTokensUsed > 0 ? 1 : 0,
        params.truncationApplied ? 1 : 0,
        params.memoryRetrievalMs || null,
        params.providerLatencyMs || null,
        params.totalLatencyMs || null
      )
      .first<{ id: number }>();

    const usageRecordId = result!.id;

    // Update account: deduct free tokens and/or balance
    if (freeTokensUsed > 0 || costCents > 0) {
      const newFreeTokens = account.free_tokens_remaining - freeTokensUsed;
      const newBalance = account.balance_cents - costCents;
      const newLifetimeTokens = account.lifetime_tokens_used + params.memoryTokens;
      const newPeriodTokens = account.period_tokens_used + params.memoryTokens;
      const newPeriodSpend = account.period_spend_cents + costCents;

      await this.db
        .prepare(`
          UPDATE accounts SET
            free_tokens_remaining = ?,
            balance_cents = ?,
            lifetime_tokens_used = ?,
            period_tokens_used = ?,
            period_spend_cents = ?
          WHERE id = ?
        `)
        .bind(
          newFreeTokens, newBalance, newLifetimeTokens,
          newPeriodTokens, newPeriodSpend, params.accountId
        )
        .run();

      // Record charge transaction if there was a cost
      if (costCents > 0) {
        await this.db
          .prepare(`
            INSERT INTO transactions (
              account_id, created_at, type, amount_cents,
              balance_before_cents, balance_after_cents,
              usage_record_id, description
            ) VALUES (?, ?, 'charge', ?, ?, ?, ?, ?)
          `)
          .bind(
            params.accountId, now, -costCents,
            account.balance_cents, newBalance,
            usageRecordId,
            `Usage: ${params.memoryTokens.toLocaleString()} memory tokens`
          )
          .run();
      }
    }

    return {
      id: usageRecordId,
      account_id: params.accountId,
      created_at: now,
      request_id: params.requestId,
      session_id: params.sessionId || null,
      model: params.model,
      provider: params.provider,
      input_tokens: params.inputTokens,
      memory_tokens: params.memoryTokens,
      output_tokens: params.outputTokens,
      total_tokens: totalTokens,
      cost_cents: costCents,
      free_tokens_used: freeTokensUsed,
      paid_tokens_used: paidTokensUsed,
      used_free_tier: freeTokensUsed > 0,
      truncation_applied: params.truncationApplied,
    };
  }

  /**
   * Charge for usage (separate step if needed for async processing)
   */
  async chargeForUsage(accountId: string, usageRecordId: number): Promise<Transaction | null> {
    const usageRecord = await this.db
      .prepare('SELECT * FROM usage_records WHERE id = ? AND account_id = ?')
      .bind(usageRecordId, accountId)
      .first();

    if (!usageRecord || usageRecord.cost_cents === 0) return null;

    // Check if already charged (transaction exists)
    const existingTx = await this.db
      .prepare('SELECT id FROM transactions WHERE usage_record_id = ? AND type = ?')
      .bind(usageRecordId, 'charge')
      .first();

    if (existingTx) return null; // Already charged

    const account = await this.getAccount(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);

    const now = Math.floor(Date.now() / 1000);
    const costCents = usageRecord.cost_cents as number;
    const newBalance = account.balance_cents - costCents;

    // Deduct from balance
    await this.db
      .prepare('UPDATE accounts SET balance_cents = ? WHERE id = ?')
      .bind(newBalance, accountId)
      .run();

    // Record transaction
    const result = await this.db
      .prepare(`
        INSERT INTO transactions (
          account_id, created_at, type, amount_cents,
          balance_before_cents, balance_after_cents,
          usage_record_id, description
        ) VALUES (?, ?, 'charge', ?, ?, ?, ?, ?)
        RETURNING id
      `)
      .bind(
        accountId, now, -costCents,
        account.balance_cents, newBalance,
        usageRecordId,
        `Charge for usage record #${usageRecordId}`
      )
      .first<{ id: number }>();

    return {
      id: result!.id,
      account_id: accountId,
      created_at: now,
      type: 'charge',
      amount_cents: -costCents,
      balance_before_cents: account.balance_cents,
      balance_after_cents: newBalance,
      stripe_payment_intent_id: null,
      usage_record_id: usageRecordId,
      description: `Charge for usage record #${usageRecordId}`,
    };
  }

  // ==========================================================================
  // QUERIES
  // ==========================================================================

  /**
   * Get usage summary for a period
   */
  async getUsageSummary(accountId: string, periodDays: number): Promise<UsageSummary> {
    const now = Math.floor(Date.now() / 1000);
    const startTime = now - (periodDays * 24 * 60 * 60);

    // Get aggregate stats
    const stats = await this.db
      .prepare(`
        SELECT 
          COUNT(*) as total_requests,
          SUM(memory_tokens) as total_memory_tokens,
          SUM(cost_cents) as total_cost_cents,
          SUM(free_tokens_used) as free_tokens_used
        FROM usage_records 
        WHERE account_id = ? AND created_at >= ?
      `)
      .bind(accountId, startTime)
      .first();

    // Get daily breakdown
    const dailyRows = await this.db
      .prepare(`
        SELECT 
          DATE(created_at, 'unixepoch') as date,
          COUNT(*) as requests,
          SUM(memory_tokens) as memory_tokens,
          SUM(cost_cents) as cost_cents
        FROM usage_records 
        WHERE account_id = ? AND created_at >= ?
        GROUP BY DATE(created_at, 'unixepoch')
        ORDER BY date DESC
      `)
      .bind(accountId, startTime)
      .all();

    // Get provider breakdown
    const providerRows = await this.db
      .prepare(`
        SELECT provider, SUM(memory_tokens) as tokens
        FROM usage_records 
        WHERE account_id = ? AND created_at >= ?
        GROUP BY provider
      `)
      .bind(accountId, startTime)
      .all();

    // Get model breakdown
    const modelRows = await this.db
      .prepare(`
        SELECT model, SUM(memory_tokens) as tokens
        FROM usage_records 
        WHERE account_id = ? AND created_at >= ?
        GROUP BY model
      `)
      .bind(accountId, startTime)
      .all();

    const providerBreakdown: Record<string, number> = {};
    for (const row of providerRows.results) {
      providerBreakdown[row.provider as string] = row.tokens as number;
    }

    const modelBreakdown: Record<string, number> = {};
    for (const row of modelRows.results) {
      modelBreakdown[row.model as string] = row.tokens as number;
    }

    return {
      period_days: periodDays,
      total_requests: (stats?.total_requests as number) || 0,
      total_memory_tokens: (stats?.total_memory_tokens as number) || 0,
      total_cost_cents: (stats?.total_cost_cents as number) || 0,
      free_tokens_used: (stats?.free_tokens_used as number) || 0,
      daily_breakdown: dailyRows.results.map(row => ({
        date: row.date as string,
        requests: row.requests as number,
        memory_tokens: row.memory_tokens as number,
        cost_cents: row.cost_cents as number,
      })),
      provider_breakdown: providerBreakdown,
      model_breakdown: modelBreakdown,
    };
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(accountId: string, limit: number = 50): Promise<Transaction[]> {
    const rows = await this.db
      .prepare(`
        SELECT * FROM transactions 
        WHERE account_id = ? 
        ORDER BY created_at DESC 
        LIMIT ?
      `)
      .bind(accountId, limit)
      .all();

    return rows.results.map(row => ({
      id: row.id as number,
      account_id: row.account_id as string,
      created_at: row.created_at as number,
      type: row.type as Transaction['type'],
      amount_cents: row.amount_cents as number,
      balance_before_cents: row.balance_before_cents as number,
      balance_after_cents: row.balance_after_cents as number,
      stripe_payment_intent_id: row.stripe_payment_intent_id as string | null,
      usage_record_id: row.usage_record_id as number | null,
      description: row.description as string | null,
    }));
  }

  /**
   * Get recent usage records
   */
  async getRecentUsage(accountId: string, limit: number = 100): Promise<UsageRecord[]> {
    const rows = await this.db
      .prepare(`
        SELECT * FROM usage_records 
        WHERE account_id = ? 
        ORDER BY created_at DESC 
        LIMIT ?
      `)
      .bind(accountId, limit)
      .all();

    return rows.results.map(row => this.rowToUsageRecord(row));
  }

  // ==========================================================================
  // BILLING PERIOD MANAGEMENT
  // ==========================================================================

  /**
   * Reset billing period (call monthly)
   */
  async resetBillingPeriod(accountId: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.db
      .prepare(`
        UPDATE accounts SET
          period_start = ?,
          period_tokens_used = 0,
          period_spend_cents = 0
        WHERE id = ?
      `)
      .bind(now, accountId)
      .run();
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private rowToAccount(row: Record<string, unknown>): Account {
    return {
      id: row.id as string,
      email: row.email as string,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
      balance_cents: row.balance_cents as number,
      free_tokens_remaining: row.free_tokens_remaining as number,
      lifetime_tokens_used: row.lifetime_tokens_used as number,
      auto_reup_enabled: Boolean(row.auto_reup_enabled),
      auto_reup_amount_cents: row.auto_reup_amount_cents as number,
      auto_reup_threshold_cents: row.auto_reup_threshold_cents as number,
      monthly_cap_cents: row.monthly_cap_cents as number | null,
      period_start: row.period_start as number,
      period_tokens_used: row.period_tokens_used as number,
      period_spend_cents: row.period_spend_cents as number,
      stripe_customer_id: row.stripe_customer_id as string | null,
      stripe_payment_method_id: row.stripe_payment_method_id as string | null,
      has_openai_key: Boolean(row.has_openai_key),
      has_anthropic_key: Boolean(row.has_anthropic_key),
      has_google_key: Boolean(row.has_google_key),
      has_xai_key: Boolean(row.has_xai_key),
      has_cerebras_key: Boolean(row.has_cerebras_key),
      has_deepseek_key: Boolean(row.has_deepseek_key),
      has_openrouter_key: Boolean(row.has_openrouter_key),
      status: row.status as Account['status'],
      suspended_reason: row.suspended_reason as string | null,
    };
  }

  private rowToUsageRecord(row: Record<string, unknown>): UsageRecord {
    return {
      id: row.id as number,
      account_id: row.account_id as string,
      created_at: row.created_at as number,
      request_id: row.request_id as string,
      session_id: row.session_id as string | null,
      model: row.model as string,
      provider: row.provider as string,
      input_tokens: row.input_tokens as number,
      memory_tokens: row.memory_tokens as number,
      output_tokens: row.output_tokens as number,
      total_tokens: row.total_tokens as number,
      cost_cents: row.cost_cents as number,
      free_tokens_used: row.free_tokens_used as number,
      paid_tokens_used: row.paid_tokens_used as number,
      used_free_tier: Boolean(row.used_free_tier),
      truncation_applied: Boolean(row.truncation_applied),
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a billing service instance
 */
export function createBillingService(db: D1Database): BillingService {
  return new BillingService(db);
}

// ============================================================================
// PRICING UTILITIES
// ============================================================================

/**
 * Calculate cost for a number of memory tokens
 * @returns Cost in cents
 */
export function calculateCost(memoryTokens: number): number {
  return parseFloat((memoryTokens * CENTS_PER_TOKEN).toFixed(4));
}

/**
 * Calculate tokens from a dollar amount
 * @param dollars Amount in dollars
 * @returns Number of tokens
 */
export function dollarsToTokens(dollars: number): number {
  // $1 = 1M tokens
  return Math.floor(dollars * 1_000_000);
}

/**
 * Calculate dollars from token count
 * @param tokens Number of tokens
 * @returns Amount in dollars
 */
export function tokensToDollars(tokens: number): number {
  // $1 = 1M tokens
  return tokens / 1_000_000;
}
