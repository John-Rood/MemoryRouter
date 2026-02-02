-- MemoryRouter D1 Billing Schema
-- Version: 1.0
-- Pricing: $1 per 1M memory tokens, 50M free tier
-- Auto-reup: Charge $20 when balance drops below $5 (configurable)

-- ============================================================================
-- ACCOUNTS TABLE
-- ============================================================================
-- Primary user/account record with balance, settings, and provider key flags
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,                           -- mk_{uuid} format
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  
  -- Balance & billing (all amounts in cents for precision)
  balance_cents INTEGER NOT NULL DEFAULT 0,              -- Current prepaid balance
  free_tokens_remaining INTEGER NOT NULL DEFAULT 50000000, -- 50M free tier
  lifetime_tokens_used INTEGER NOT NULL DEFAULT 0,       -- Total tokens ever used
  
  -- Auto-reup settings
  auto_reup_enabled INTEGER NOT NULL DEFAULT 1,          -- 1 = enabled, 0 = disabled
  auto_reup_amount_cents INTEGER NOT NULL DEFAULT 2000,  -- $20.00 default
  auto_reup_threshold_cents INTEGER NOT NULL DEFAULT 500, -- $5.00 threshold
  monthly_cap_cents INTEGER,                             -- NULL = no cap
  
  -- Current billing period tracking
  period_start INTEGER NOT NULL DEFAULT (unixepoch()),
  period_tokens_used INTEGER NOT NULL DEFAULT 0,
  period_spend_cents INTEGER NOT NULL DEFAULT 0,
  
  -- Stripe integration
  stripe_customer_id TEXT,
  stripe_payment_method_id TEXT,
  stripe_subscription_id TEXT,                           -- For future subscription model
  
  -- Provider key flags (actual keys stored encrypted in KV)
  -- 1 = key exists, 0 = no key
  has_openai_key INTEGER NOT NULL DEFAULT 0,
  has_anthropic_key INTEGER NOT NULL DEFAULT 0,
  has_google_key INTEGER NOT NULL DEFAULT 0,
  has_xai_key INTEGER NOT NULL DEFAULT 0,
  has_cerebras_key INTEGER NOT NULL DEFAULT 0,
  has_deepseek_key INTEGER NOT NULL DEFAULT 0,
  has_openrouter_key INTEGER NOT NULL DEFAULT 0,
  
  -- Account status
  status TEXT NOT NULL DEFAULT 'active',                 -- active, suspended, deleted
  suspended_reason TEXT,                                 -- Why suspended (if applicable)
  suspended_at INTEGER
);

-- ============================================================================
-- USAGE RECORDS TABLE
-- ============================================================================
-- Per-request usage tracking for billing and analytics
CREATE TABLE IF NOT EXISTS usage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  
  -- Request identification
  request_id TEXT NOT NULL,                              -- Unique request ID
  session_id TEXT,                                       -- Session grouping (optional)
  
  -- Provider/model info
  model TEXT NOT NULL,                                   -- e.g., gpt-4o, claude-3-5-sonnet
  provider TEXT NOT NULL,                                -- openai, anthropic, google, etc.
  
  -- Token counts (4-stage tracking)
  input_tokens INTEGER NOT NULL DEFAULT 0,               -- User's original input
  memory_tokens INTEGER NOT NULL DEFAULT 0,              -- Injected memory (BILLABLE)
  output_tokens INTEGER NOT NULL DEFAULT 0,              -- Model response
  total_tokens INTEGER NOT NULL DEFAULT 0,               -- input + memory + output
  
  -- Cost calculation (memory tokens only, in cents)
  -- Formula: memory_tokens * 0.0001 (= $1 per 1M tokens)
  cost_cents INTEGER NOT NULL DEFAULT 0,
  
  -- Free tier usage
  free_tokens_used INTEGER NOT NULL DEFAULT 0,           -- How many came from free tier
  paid_tokens_used INTEGER NOT NULL DEFAULT 0,           -- How many were paid
  used_free_tier INTEGER NOT NULL DEFAULT 0,             -- 1 if any free tier used
  
  -- Processing flags
  truncation_applied INTEGER NOT NULL DEFAULT 0,         -- 1 if context was truncated
  memory_retrieval_ms INTEGER,                           -- Time to retrieve memories
  provider_latency_ms INTEGER,                           -- Time for provider response
  total_latency_ms INTEGER,                              -- End-to-end latency
  
  -- Error tracking
  error_code TEXT,                                       -- If request failed
  error_message TEXT
);

-- ============================================================================
-- TRANSACTIONS TABLE
-- ============================================================================
-- Balance changes: charges, refunds, auto-reups, topups
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  
  -- Transaction type
  type TEXT NOT NULL,                                    -- charge, refund, auto_reup, manual_topup, free_tier_grant
  
  -- Amount (positive = credit added, negative = charge)
  amount_cents INTEGER NOT NULL,
  balance_before_cents INTEGER NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  
  -- Stripe references (for paid transactions)
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  stripe_refund_id TEXT,
  
  -- Related usage (for charge transactions)
  usage_record_id INTEGER REFERENCES usage_records(id),
  
  -- Metadata
  description TEXT,
  metadata TEXT                                          -- JSON for additional data
);

-- ============================================================================
-- DAILY AGGREGATES TABLE
-- ============================================================================
-- Pre-aggregated daily stats for fast dashboard queries
CREATE TABLE IF NOT EXISTS daily_aggregates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date INTEGER NOT NULL,                                 -- Unix timestamp (start of day)
  
  -- Request counts
  total_requests INTEGER NOT NULL DEFAULT 0,
  successful_requests INTEGER NOT NULL DEFAULT 0,
  failed_requests INTEGER NOT NULL DEFAULT 0,
  
  -- Token totals
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_memory_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  
  -- Cost
  total_cost_cents INTEGER NOT NULL DEFAULT 0,
  free_tokens_used INTEGER NOT NULL DEFAULT 0,
  
  -- Provider breakdown (JSON)
  provider_breakdown TEXT,                               -- {"openai": 1000, "anthropic": 500}
  model_breakdown TEXT,                                  -- {"gpt-4o": 800, "claude-3-5-sonnet": 700}
  
  -- Latency stats
  avg_latency_ms INTEGER,
  p95_latency_ms INTEGER,
  
  UNIQUE(account_id, date)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Accounts
CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_stripe_customer ON accounts(stripe_customer_id);

-- Usage records
CREATE INDEX IF NOT EXISTS idx_usage_account_date ON usage_records(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_request_id ON usage_records(request_id);
CREATE INDEX IF NOT EXISTS idx_usage_session_id ON usage_records(session_id);
CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_records(model);
CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_records(provider);

-- Transactions
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_stripe_pi ON transactions(stripe_payment_intent_id);

-- Daily aggregates
CREATE INDEX IF NOT EXISTS idx_daily_account_date ON daily_aggregates(account_id, date);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at on accounts
CREATE TRIGGER IF NOT EXISTS accounts_updated_at
AFTER UPDATE ON accounts
BEGIN
  UPDATE accounts SET updated_at = unixepoch() WHERE id = NEW.id;
END;
