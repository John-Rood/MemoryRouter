-- ============================================================================
-- MemoryRouter D1 Schema (SQLite)
-- Version: 1.0 — DIY OAuth
-- Created: 2026-02-02
-- ============================================================================

-- Enable foreign keys (must be set per connection)
-- In Workers: db.exec("PRAGMA foreign_keys = ON")

-- ============================================================================
-- USERS TABLE (replaces Clerk)
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_id TEXT UNIQUE,
  github_id TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  internal_user_id TEXT UNIQUE NOT NULL,
  onboarding_completed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_github ON users(github_id);
CREATE INDEX IF NOT EXISTS idx_users_internal_id ON users(internal_user_id);

-- ============================================================================
-- SESSIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT UNIQUE NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  last_used_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_refresh ON sessions(refresh_token_hash);

-- ============================================================================
-- PROVIDER KEYS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS provider_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  key_hint TEXT,
  nickname TEXT,
  is_active INTEGER DEFAULT 1,
  is_default INTEGER DEFAULT 0,
  last_used_at TEXT,
  last_verified_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_provider_keys_user ON provider_keys(user_id);

-- ============================================================================
-- MEMORY KEYS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS memory_keys (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_memory_keys_key ON memory_keys(key);
CREATE INDEX IF NOT EXISTS idx_memory_keys_user ON memory_keys(user_id);

-- ============================================================================
-- BILLING TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS billing (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  credit_balance_cents INTEGER DEFAULT 0,
  free_tier_tokens_used INTEGER DEFAULT 0,
  free_tier_exhausted INTEGER DEFAULT 0,
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

-- ============================================================================
-- TRANSACTIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('credit', 'debit', 'refund', 'free_tier')),
  amount_cents INTEGER NOT NULL,
  description TEXT NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  stripe_payment_intent_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at DESC);

-- ============================================================================
-- USAGE RECORDS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_key_id TEXT REFERENCES memory_keys(id) ON DELETE SET NULL,
  memory_key TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  tokens_retrieved INTEGER DEFAULT 0,
  model TEXT,
  provider TEXT,
  request_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_records(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_memory_key ON usage_records(memory_key);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_records(created_at);

-- ============================================================================
-- DAILY USAGE AGGREGATION TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS daily_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  tokens_stored INTEGER DEFAULT 0,
  tokens_retrieved INTEGER DEFAULT 0,
  request_count INTEGER DEFAULT 0,
  cost_cents INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_usage_user_date ON daily_usage(user_id, date DESC);

-- ============================================================================
-- PAYMENT METHODS TABLE
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
-- STRIPE EVENTS TABLE (idempotency)
-- ============================================================================

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
