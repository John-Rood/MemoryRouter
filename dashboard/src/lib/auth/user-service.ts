import { getDb, schema } from '@/lib/db';
import { eq, or } from 'drizzle-orm';

// ============================================================================
// TYPES
// ============================================================================

export interface OAuthUserData {
  provider: 'google' | 'github';
  providerId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  internalUserId: string;
  onboardingCompleted: boolean;
  stripeCustomerId?: string;
}

export interface UserBilling {
  userId: string;
  creditBalanceCents: number;
  freeTierTokensUsed: number;
  freeTierExhausted: boolean;
  autoReupEnabled: boolean;
  autoReupAmountCents: number;
  autoReupTriggerCents: number;
  monthlyCapCents: number | null;
  monthlySpendCents: number;
  stripeCustomerId: string | null;
  hasPaymentMethod: boolean;
}

// ============================================================================
// USER OPERATIONS
// ============================================================================

/**
 * Find or create a user based on OAuth provider data.
 * If user exists with same email but different provider, link the accounts.
 */
export async function createOrUpdateUser(data: OAuthUserData): Promise<User> {
  const db = getDb();
  
  // 1. Try to find existing user by provider ID or email
  const existingUsers = db
    .select()
    .from(schema.users)
    .where(
      or(
        data.provider === 'google'
          ? eq(schema.users.googleId, data.providerId)
          : eq(schema.users.githubId, data.providerId),
        eq(schema.users.email, data.email)
      )
    )
    .all();
  
  const existingUser = existingUsers[0];
  
  if (existingUser) {
    // 2. Update existing user (link provider if not already linked)
    const updates: Record<string, string | null | boolean> = {
      name: data.name || existingUser.name,
      avatarUrl: data.avatarUrl || existingUser.avatarUrl,
      updatedAt: new Date().toISOString(),
    };
    
    // Link new provider if not already linked
    if (data.provider === 'google' && !existingUser.googleId) {
      updates.googleId = data.providerId;
    }
    if (data.provider === 'github' && !existingUser.githubId) {
      updates.githubId = data.providerId;
    }
    
    db
      .update(schema.users)
      .set(updates)
      .where(eq(schema.users.id, existingUser.id))
      .run();
    
    // Get billing info
    const billingResults = db
      .select()
      .from(schema.billing)
      .where(eq(schema.billing.userId, existingUser.id))
      .all();
    
    const billing = billingResults[0];
    
    return {
      id: existingUser.id,
      email: existingUser.email,
      name: data.name || existingUser.name,
      avatarUrl: data.avatarUrl || existingUser.avatarUrl,
      internalUserId: existingUser.internalUserId,
      onboardingCompleted: existingUser.onboardingCompleted || false,
      stripeCustomerId: billing?.stripeCustomerId || undefined,
    };
  }
  
  // 3. Create new user
  const userId = crypto.randomUUID();
  const internalUserId = `usr_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const now = new Date().toISOString();
  
  db.insert(schema.users).values({
    id: userId,
    googleId: data.provider === 'google' ? data.providerId : null,
    githubId: data.provider === 'github' ? data.providerId : null,
    email: data.email,
    name: data.name,
    avatarUrl: data.avatarUrl,
    internalUserId,
    onboardingCompleted: false,
    createdAt: now,
    updatedAt: now,
  }).run();
  
  // 4. Create billing record
  db.insert(schema.billing).values({
    userId,
    creditBalanceCents: 0,
    freeTierTokensUsed: 0,
    freeTierExhausted: false,
    autoReupEnabled: true,
    autoReupAmountCents: 2000,
    autoReupTriggerCents: 500,
    monthlyCapCents: null,
    monthlySpendCents: 0,
    stripeCustomerId: null,
    hasPaymentMethod: false,
    createdAt: now,
    updatedAt: now,
  }).run();
  
  // 5. Create free tier transaction
  db.insert(schema.transactions).values({
    id: crypto.randomUUID(),
    userId,
    type: 'free_tier',
    amountCents: 0,
    description: '50M free tier activated',
    balanceAfterCents: 0,
    createdAt: now,
  }).run();
  
  console.log(`[UserService] Created new user: ${userId} (${data.email})`);
  
  return {
    id: userId,
    email: data.email,
    name: data.name,
    avatarUrl: data.avatarUrl,
    internalUserId,
    onboardingCompleted: false,
    stripeCustomerId: undefined,
  };
}

/**
 * Get user by ID
 */
export function getUserById(userId: string): User | null {
  const db = getDb();
  
  const users = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .all();
  
  const user = users[0];
  if (!user) return null;
  
  const billingResults = db
    .select()
    .from(schema.billing)
    .where(eq(schema.billing.userId, userId))
    .all();
  
  const billing = billingResults[0];
  
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    internalUserId: user.internalUserId,
    onboardingCompleted: user.onboardingCompleted || false,
    stripeCustomerId: billing?.stripeCustomerId || undefined,
  };
}

/**
 * Get user's billing info
 */
export function getUserBillingById(userId: string): UserBilling | null {
  const db = getDb();
  
  const billingResults = db
    .select()
    .from(schema.billing)
    .where(eq(schema.billing.userId, userId))
    .all();
  
  const billing = billingResults[0];
  if (!billing) return null;
  
  return {
    userId: billing.userId,
    creditBalanceCents: billing.creditBalanceCents || 0,
    freeTierTokensUsed: billing.freeTierTokensUsed || 0,
    freeTierExhausted: billing.freeTierExhausted || false,
    autoReupEnabled: billing.autoReupEnabled ?? true,
    autoReupAmountCents: billing.autoReupAmountCents || 2000,
    autoReupTriggerCents: billing.autoReupTriggerCents || 500,
    monthlyCapCents: billing.monthlyCapCents,
    monthlySpendCents: billing.monthlySpendCents || 0,
    stripeCustomerId: billing.stripeCustomerId,
    hasPaymentMethod: billing.hasPaymentMethod || false,
  };
}

/**
 * Update user's billing with Stripe customer ID
 */
export function updateUserStripeCustomer(userId: string, stripeCustomerId: string): void {
  const db = getDb();
  
  db
    .update(schema.billing)
    .set({
      stripeCustomerId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.billing.userId, userId))
    .run();
  
  console.log(`[UserService] Updated Stripe customer ID for user: ${userId}`);
}

/**
 * Mark user's onboarding as complete
 */
export function completeUserOnboarding(userId: string): void {
  const db = getDb();
  
  db
    .update(schema.users)
    .set({
      onboardingCompleted: true,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.users.id, userId))
    .run();
  
  console.log(`[UserService] Completed onboarding for user: ${userId}`);
}
