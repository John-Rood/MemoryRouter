-- MemoryRouter Users & Billing Schema
-- Phase 1: Real user persistence for Dashboard

-- ============================================================================
-- USERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                     -- 'google_123' or 'github_456'
  google_id TEXT UNIQUE,
  github_id TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  internal_user_id TEXT UNIQUE NOT NULL,   -- 'usr_xxx' for API keys
  onboarding_completed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_internal_id ON users(internal_user_id);

-- ============================================================================
-- BILLING
-- ============================================================================
CREATE TABLE IF NOT EXISTS billing (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  credit_balance_cents INTEGER DEFAULT 0,
  free_tier_tokens_used INTEGER DEFAULT 0,
  free_tier_exhausted INTEGER DEFAULT 0,   -- boolean
  auto_reup_enabled INTEGER DEFAULT 1,
  auto_reup_amount_cents INTEGER DEFAULT 2000,
  auto_reup_trigger_cents INTEGER DEFAULT 500,
  monthly_cap_cents INTEGER,
  monthly_spend_cents INTEGER DEFAULT 0,
  stripe_customer_id TEXT UNIQUE,
  stripe_default_payment_method_id TEXT,
  has_payment_method INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_billing_stripe ON billing(stripe_customer_id);

-- ============================================================================
-- TRANSACTIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                      -- 'credit', 'usage', 'refund'
  amount_cents INTEGER NOT NULL,
  description TEXT NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  stripe_payment_intent_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);

-- ============================================================================
-- MEMORY KEYS (Dashboard-created)
-- ============================================================================
CREATE TABLE IF NOT EXISTS memory_keys (
  id TEXT PRIMARY KEY,                     -- 'mk_xxx'
  key TEXT UNIQUE NOT NULL,                -- Same as id for now
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  retention_days INTEGER DEFAULT 90,
  is_active INTEGER DEFAULT 1,
  tokens_stored INTEGER DEFAULT 0,
  tokens_retrieved INTEGER DEFAULT 0,
  request_count INTEGER DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memory_keys_user ON memory_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_keys_key ON memory_keys(key);

-- ============================================================================
-- PROVIDER KEYS (Encrypted)
-- ============================================================================
CREATE TABLE IF NOT EXISTS provider_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,                  -- 'openai', 'anthropic', etc.
  encrypted_key TEXT NOT NULL,
  key_hint TEXT,                           -- Last 4 chars
  nickname TEXT,
  is_active INTEGER DEFAULT 1,
  is_default INTEGER DEFAULT 0,
  last_used_at TEXT,
  last_verified_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_provider_keys_user ON provider_keys(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_keys_user_provider ON provider_keys(user_id, provider);

-- ============================================================================
-- PAYMENT METHODS
-- ============================================================================
CREATE TABLE IF NOT EXISTS payment_methods (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_payment_method_id TEXT UNIQUE NOT NULL,
  brand TEXT,
  last4 TEXT,
  exp_month INTEGER,
  exp_year INTEGER,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_user ON payment_methods(user_id);

-- ============================================================================
-- STRIPE EVENTS (Idempotency)
-- ============================================================================
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,                     -- Stripe event ID
  type TEXT NOT NULL,
  processed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
