-- ============================================================================
-- MemoryRouter Archival Billing Schema Migration
-- Version: 2.0
-- Created: 2026-02-08
-- 
-- Adds archival storage billing for data older than 90 days.
-- Price: $0.10/GB/month
-- ============================================================================

-- ============================================================================
-- PART 1: Extend Billing Table with Archival Fields
-- ============================================================================

-- Add archival billing columns to billing table
-- (D1 SQLite syntax - no IF NOT EXISTS for ALTER)
ALTER TABLE billing ADD COLUMN archival_enabled INTEGER DEFAULT 0;
ALTER TABLE billing ADD COLUMN archival_bytes_total INTEGER DEFAULT 0;
ALTER TABLE billing ADD COLUMN archival_cost_cents INTEGER DEFAULT 0;
ALTER TABLE billing ADD COLUMN archival_last_calculated TEXT;

-- ============================================================================
-- PART 2: Archival Storage Tracking Table
-- ============================================================================

-- Per-memory-key archival storage tracking
CREATE TABLE IF NOT EXISTS archival_storage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  
  -- Storage metrics (calculated by daily cron)
  vectors_total INTEGER DEFAULT 0,
  vectors_archived INTEGER DEFAULT 0,  -- older than 90 days
  bytes_archived INTEGER DEFAULT 0,    -- embedding BLOBs + content
  
  -- Timestamps
  calculated_at TEXT NOT NULL,
  oldest_vector_at TEXT,
  newest_vector_at TEXT,
  
  UNIQUE(user_id, memory_key)
);

CREATE INDEX IF NOT EXISTS idx_archival_storage_user ON archival_storage(user_id);
CREATE INDEX IF NOT EXISTS idx_archival_storage_key ON archival_storage(memory_key);

-- ============================================================================
-- PART 3: Archival Billing Records (Monthly)
-- ============================================================================

-- Monthly archival billing records (for Stripe reporting)
CREATE TABLE IF NOT EXISTS archival_billing_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  
  -- Billing period
  billing_month TEXT NOT NULL,  -- YYYY-MM format
  
  -- Storage metrics at time of billing
  bytes_archived INTEGER DEFAULT 0,
  gb_archived REAL DEFAULT 0,
  
  -- Cost
  cost_cents INTEGER DEFAULT 0,
  
  -- Stripe
  stripe_usage_record_id TEXT,
  reported_to_stripe INTEGER DEFAULT 0,
  reported_at TEXT,
  
  created_at TEXT NOT NULL,
  
  UNIQUE(user_id, billing_month)
);

CREATE INDEX IF NOT EXISTS idx_archival_billing_user ON archival_billing_records(user_id);
CREATE INDEX IF NOT EXISTS idx_archival_billing_month ON archival_billing_records(billing_month);

-- ============================================================================
-- PART 4: Purge Log (for audit trail)
-- ============================================================================

-- Track automatic purges for users without archival enabled
CREATE TABLE IF NOT EXISTS archival_purge_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  
  -- What was purged
  vectors_purged INTEGER NOT NULL,
  bytes_purged INTEGER NOT NULL,
  oldest_purged_at TEXT NOT NULL,
  
  -- Why
  reason TEXT DEFAULT 'auto_purge_90d',
  
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_purge_log_user ON archival_purge_log(user_id);
CREATE INDEX IF NOT EXISTS idx_purge_log_created ON archival_purge_log(created_at);

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
