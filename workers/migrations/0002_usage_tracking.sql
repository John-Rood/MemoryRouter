-- MemoryRouter Usage Tracking Schema
-- Tracks per-request usage for customer metrics, dashboards, and billing

-- ============================================================================
-- RAW USAGE EVENTS (kept for 90 days, then rolled up)
-- ============================================================================
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,              -- Unix ms
  memory_key TEXT NOT NULL,                -- Customer identifier
  session_id TEXT,                         -- Optional session context
  model TEXT NOT NULL,                     -- gpt-4o, claude-3, etc.
  provider TEXT NOT NULL,                  -- openai, anthropic, etc.
  input_tokens INTEGER DEFAULT 0,          -- Tokens sent to provider
  output_tokens INTEGER DEFAULT 0,         -- Tokens received from provider
  memory_tokens_retrieved INTEGER DEFAULT 0, -- Tokens pulled from vault
  memory_tokens_injected INTEGER DEFAULT 0,  -- Tokens injected into context
  latency_embedding_ms INTEGER,            -- Embedding time
  latency_mr_ms INTEGER,                   -- MemoryRouter processing overhead
  latency_provider_ms INTEGER,             -- Provider response time
  request_type TEXT DEFAULT 'chat'         -- chat, completion, embedding
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_usage_events_memory_key 
  ON usage_events(memory_key);

CREATE INDEX IF NOT EXISTS idx_usage_events_timestamp 
  ON usage_events(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_key_timestamp 
  ON usage_events(memory_key, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_provider 
  ON usage_events(provider);

-- For rollup queries (aggregate by day)
CREATE INDEX IF NOT EXISTS idx_usage_events_rollup 
  ON usage_events(memory_key, timestamp);

-- ============================================================================
-- DAILY ROLLUPS (kept forever, fast queries for dashboards)
-- ============================================================================
CREATE TABLE IF NOT EXISTS usage_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,                      -- YYYY-MM-DD
  memory_key TEXT NOT NULL,
  request_count INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  memory_tokens_retrieved INTEGER DEFAULT 0,
  memory_tokens_injected INTEGER DEFAULT 0,
  avg_latency_mr_ms INTEGER,               -- Average MR overhead
  p95_latency_mr_ms INTEGER,               -- 95th percentile (optional)
  UNIQUE(date, memory_key)
);

-- Indexes for daily queries
CREATE INDEX IF NOT EXISTS idx_usage_daily_memory_key 
  ON usage_daily(memory_key);

CREATE INDEX IF NOT EXISTS idx_usage_daily_date 
  ON usage_daily(date DESC);

CREATE INDEX IF NOT EXISTS idx_usage_daily_key_date 
  ON usage_daily(memory_key, date DESC);

-- For top customers query
CREATE INDEX IF NOT EXISTS idx_usage_daily_requests 
  ON usage_daily(date, request_count DESC);
