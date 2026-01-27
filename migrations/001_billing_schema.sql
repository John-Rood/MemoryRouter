-- ============================================================================
-- MemoryRouter Billing Schema Migration
-- Version: 1.0
-- Created: 2026-01-25
-- 
-- This migration adds billing-related tables and columns for Stripe integration.
-- Reference: memoryrouter-stripe-spec.md Section 4
-- ============================================================================

-- ============================================================================
-- PART 1: Extend Users Table with Billing Fields
-- ============================================================================

-- Add billing columns to existing users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_payment_method BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_tokens_used BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_tokens_reported BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_status TEXT DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_tier_exhausted_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMP;

-- Add constraint for billing_status
-- Valid values: 'free', 'active', 'past_due', 'grace_period', 'suspended', 'enterprise'
ALTER TABLE users ADD CONSTRAINT check_billing_status 
  CHECK (billing_status IN ('free', 'active', 'past_due', 'grace_period', 'suspended', 'enterprise'));

-- Create indexes for billing lookups
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_billing_status ON users(billing_status);
CREATE INDEX IF NOT EXISTS idx_users_subscription ON users(stripe_subscription_id);

-- ============================================================================
-- PART 2: Usage Records Table
-- ============================================================================

-- Detailed per-request usage records
CREATE TABLE IF NOT EXISTS usage_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_key_id UUID REFERENCES memory_keys(id) ON DELETE SET NULL,
  request_id TEXT,
  
  -- Token counts
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  tokens_retrieved INTEGER DEFAULT 0,
  tokens_ephemeral INTEGER DEFAULT 0,
  
  -- Request metadata
  model TEXT,
  provider TEXT,
  
  -- Timing
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Calculated cost (stored for display, computed as tokens * 0.000001)
  cost_usd DECIMAL(10, 6) GENERATED ALWAYS AS (
    (tokens_input + tokens_output) * 0.000001
  ) STORED
);

-- Indexes for usage queries
CREATE INDEX IF NOT EXISTS idx_usage_user_id ON usage_records(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_memory_key ON usage_records(memory_key_id);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_records(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_user_created ON usage_records(user_id, created_at DESC);

-- ============================================================================
-- PART 3: Daily Usage Summary Table
-- ============================================================================

-- Aggregated daily usage for efficient reporting
CREATE TABLE IF NOT EXISTS daily_usage_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  
  -- Daily totals
  tokens_input BIGINT DEFAULT 0,
  tokens_output BIGINT DEFAULT 0,
  tokens_total BIGINT DEFAULT 0,
  tokens_retrieved BIGINT DEFAULT 0,
  
  -- Request counts
  request_count INTEGER DEFAULT 0,
  
  -- Aggregation metadata
  aggregated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Unique constraint for user + date
  UNIQUE(user_id, date)
);

-- Indexes for daily usage queries
CREATE INDEX IF NOT EXISTS idx_daily_usage_user ON daily_usage_summary(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_usage_date ON daily_usage_summary(date);
CREATE INDEX IF NOT EXISTS idx_daily_usage_user_date ON daily_usage_summary(user_id, date DESC);

-- ============================================================================
-- PART 4: Billing Periods Table
-- ============================================================================

-- Track billing periods for Stripe reporting
CREATE TABLE IF NOT EXISTS billing_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Period bounds
  period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  period_end TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Usage during period
  tokens_used BIGINT DEFAULT 0,
  tokens_billable BIGINT DEFAULT 0,
  
  -- Stripe reporting
  stripe_invoice_id TEXT,
  reported_to_stripe BOOLEAN DEFAULT false,
  reported_at TIMESTAMP WITH TIME ZONE,
  units_reported INTEGER,
  
  -- Period status: 'active', 'closed', 'invoiced', 'paid'
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed', 'invoiced', 'paid')),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for billing period queries
CREATE INDEX IF NOT EXISTS idx_billing_periods_user ON billing_periods(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_periods_status ON billing_periods(status);

-- Ensure only one active period per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_periods_active 
  ON billing_periods(user_id) WHERE status = 'active';

-- ============================================================================
-- PART 5: Stripe Events Table (Idempotency)
-- ============================================================================

-- Log all Stripe webhook events for idempotency
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,  -- Stripe event ID (evt_xxx)
  type TEXT NOT NULL,
  data JSONB NOT NULL,
  processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMP WITH TIME ZONE,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for event processing
CREATE INDEX IF NOT EXISTS idx_stripe_events_type ON stripe_events(type);
CREATE INDEX IF NOT EXISTS idx_stripe_events_processed ON stripe_events(processed);
CREATE INDEX IF NOT EXISTS idx_stripe_events_created ON stripe_events(created_at);

-- ============================================================================
-- PART 6: Payment Methods Cache
-- ============================================================================

-- Cache payment method info for quick lookups
CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_payment_method_id TEXT NOT NULL UNIQUE,
  
  -- Card details (safe to store)
  brand TEXT,
  last4 TEXT,
  exp_month INTEGER,
  exp_year INTEGER,
  
  -- Status
  is_default BOOLEAN DEFAULT false,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for user payment method lookups
CREATE INDEX IF NOT EXISTS idx_payment_methods_user ON payment_methods(user_id);

-- ============================================================================
-- PART 7: Invoices Cache
-- ============================================================================

-- Cache invoice info from Stripe
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_invoice_id TEXT NOT NULL UNIQUE,
  billing_period_id UUID REFERENCES billing_periods(id),
  
  -- Invoice details
  status TEXT NOT NULL CHECK (status IN ('draft', 'open', 'paid', 'uncollectible', 'void')),
  amount_due INTEGER,
  amount_paid INTEGER,
  currency TEXT DEFAULT 'usd',
  
  -- URLs
  hosted_invoice_url TEXT,
  invoice_pdf TEXT,
  
  -- Timing
  period_start TIMESTAMP WITH TIME ZONE,
  period_end TIMESTAMP WITH TIME ZONE,
  due_date TIMESTAMP WITH TIME ZONE,
  paid_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for invoice queries
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_stripe_id ON invoices(stripe_invoice_id);

-- ============================================================================
-- PART 8: Functions and Triggers
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for payment_methods
CREATE TRIGGER update_payment_methods_updated_at
    BEFORE UPDATE ON payment_methods
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for invoices
CREATE TRIGGER update_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PART 9: Daily Aggregation Function
-- ============================================================================

-- Function to aggregate daily usage from usage_records
-- Called by scheduled job at midnight UTC
CREATE OR REPLACE FUNCTION aggregate_daily_usage(target_date DATE)
RETURNS void AS $$
BEGIN
  -- Insert or update daily summaries
  INSERT INTO daily_usage_summary (user_id, date, tokens_input, tokens_output, tokens_total, tokens_retrieved, request_count)
  SELECT 
    user_id,
    target_date,
    COALESCE(SUM(tokens_input), 0),
    COALESCE(SUM(tokens_output), 0),
    COALESCE(SUM(tokens_input + tokens_output), 0),
    COALESCE(SUM(tokens_retrieved), 0),
    COUNT(*)
  FROM usage_records
  WHERE DATE(created_at) = target_date
  GROUP BY user_id
  ON CONFLICT (user_id, date) DO UPDATE SET
    tokens_input = EXCLUDED.tokens_input,
    tokens_output = EXCLUDED.tokens_output,
    tokens_total = EXCLUDED.tokens_total,
    tokens_retrieved = EXCLUDED.tokens_retrieved,
    request_count = EXCLUDED.request_count,
    aggregated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PART 10: Billing Period Management
-- ============================================================================

-- Function to close billing period and create new one
CREATE OR REPLACE FUNCTION rotate_billing_period(p_user_id UUID)
RETURNS void AS $$
DECLARE
  current_period_id UUID;
  period_tokens BIGINT;
  free_tier BIGINT := 10000000;
BEGIN
  -- Get current active period
  SELECT id, tokens_used INTO current_period_id, period_tokens
  FROM billing_periods
  WHERE user_id = p_user_id AND status = 'active'
  FOR UPDATE;
  
  IF current_period_id IS NOT NULL THEN
    -- Calculate billable tokens
    UPDATE billing_periods
    SET 
      status = 'closed',
      tokens_billable = GREATEST(0, tokens_used - free_tier)
    WHERE id = current_period_id;
  END IF;
  
  -- Create new period
  INSERT INTO billing_periods (user_id, period_start, period_end, status)
  VALUES (
    p_user_id,
    DATE_TRUNC('month', NOW()),
    DATE_TRUNC('month', NOW() + INTERVAL '1 month') - INTERVAL '1 second',
    'active'
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Log migration completion
DO $$
BEGIN
  RAISE NOTICE 'Billing schema migration completed successfully';
END $$;
