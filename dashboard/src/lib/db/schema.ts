import { sqliteTable, text, integer, blob, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

// ============================================================================
// USERS
// ============================================================================

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  googleId: text('google_id').unique(),
  githubId: text('github_id').unique(),
  email: text('email').unique().notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  internalUserId: text('internal_user_id').unique().notNull(),
  onboardingCompleted: integer('onboarding_completed', { mode: 'boolean' }).default(false),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
});

// ============================================================================
// SESSIONS
// ============================================================================

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  refreshTokenHash: text('refresh_token_hash').unique().notNull(),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at'),
  lastUsedAt: text('last_used_at'),
});

// ============================================================================
// PROVIDER KEYS
// ============================================================================

export const providerKeys = sqliteTable('provider_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  encryptedKey: text('encrypted_key').notNull(),
  keyHint: text('key_hint'),
  nickname: text('nickname'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  lastUsedAt: text('last_used_at'),
  lastVerifiedAt: text('last_verified_at'),
  createdAt: text('created_at'),
});

// ============================================================================
// MEMORY KEYS
// ============================================================================

export const memoryKeys = sqliteTable('memory_keys', {
  id: text('id').primaryKey(),
  key: text('key').unique().notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name'),
  retentionDays: integer('retention_days').default(90),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  tokensStored: integer('tokens_stored').default(0),
  tokensRetrieved: integer('tokens_retrieved').default(0),
  requestCount: integer('request_count').default(0),
  lastUsedAt: text('last_used_at'),
  createdAt: text('created_at'),
});

// ============================================================================
// BILLING
// ============================================================================

export const billing = sqliteTable('billing', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  creditBalanceCents: integer('credit_balance_cents').default(0),
  freeTierTokensUsed: integer('free_tier_tokens_used').default(0),
  freeTierExhausted: integer('free_tier_exhausted', { mode: 'boolean' }).default(false),
  autoReupEnabled: integer('auto_reup_enabled', { mode: 'boolean' }).default(true),
  autoReupAmountCents: integer('auto_reup_amount_cents').default(2000),
  autoReupTriggerCents: integer('auto_reup_trigger_cents').default(500),
  monthlyCapCents: integer('monthly_cap_cents'),
  monthlySpendCents: integer('monthly_spend_cents').default(0),
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeDefaultPaymentMethodId: text('stripe_default_payment_method_id'),
  hasPaymentMethod: integer('has_payment_method', { mode: 'boolean' }).default(false),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
});

// ============================================================================
// TRANSACTIONS
// ============================================================================

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  amountCents: integer('amount_cents').notNull(),
  description: text('description').notNull(),
  balanceAfterCents: integer('balance_after_cents').notNull(),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  createdAt: text('created_at'),
});

// ============================================================================
// USAGE RECORDS
// ============================================================================

export const usageRecords = sqliteTable('usage_records', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  memoryKeyId: text('memory_key_id').references(() => memoryKeys.id, { onDelete: 'set null' }),
  memoryKey: text('memory_key').notNull(),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  tokensRetrieved: integer('tokens_retrieved').default(0),
  model: text('model'),
  provider: text('provider'),
  requestId: text('request_id'),
  createdAt: text('created_at'),
});

// ============================================================================
// DAILY USAGE
// ============================================================================

export const dailyUsage = sqliteTable('daily_usage', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  tokensStored: integer('tokens_stored').default(0),
  tokensRetrieved: integer('tokens_retrieved').default(0),
  requestCount: integer('request_count').default(0),
  costCents: integer('cost_cents').default(0),
});

// ============================================================================
// PAYMENT METHODS
// ============================================================================

export const paymentMethods = sqliteTable('payment_methods', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  stripePaymentMethodId: text('stripe_payment_method_id').unique().notNull(),
  brand: text('brand'),
  last4: text('last4'),
  expMonth: integer('exp_month'),
  expYear: integer('exp_year'),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  createdAt: text('created_at'),
});

// ============================================================================
// STRIPE EVENTS
// ============================================================================

export const stripeEvents = sqliteTable('stripe_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  processed: integer('processed', { mode: 'boolean' }).default(false),
  createdAt: text('created_at'),
});

// Type exports for convenience
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type ProviderKey = typeof providerKeys.$inferSelect;
export type MemoryKey = typeof memoryKeys.$inferSelect;
export type Billing = typeof billing.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type UsageRecord = typeof usageRecords.$inferSelect;
export type DailyUsage = typeof dailyUsage.$inferSelect;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
