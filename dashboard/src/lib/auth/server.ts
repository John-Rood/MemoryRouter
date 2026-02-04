import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { verifyToken, TokenPayload } from './jwt';
import { getUser, getBilling, completeOnboarding as apiCompleteOnboarding } from '@/lib/api/workers-client';

const ACCESS_COOKIE_NAME = 'mr_session';

// User structure returned by auth functions
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  internalUserId: string;
  onboardingCompleted: boolean;
}

/**
 * Convert JWT payload to AuthUser (from cached data in token)
 */
function payloadToUser(payload: TokenPayload): AuthUser {
  return {
    id: payload.userId,
    email: payload.email,
    name: payload.name || payload.email.split('@')[0],
    avatarUrl: payload.avatarUrl || null,
    internalUserId: payload.internalUserId || `usr_${payload.userId.replace(/-/g, '').slice(0, 24)}`,
    onboardingCompleted: payload.onboardingCompleted ?? true,
  };
}

/**
 * Get current user for server components.
 * Redirects to login if not authenticated.
 * Uses cached JWT data to avoid API calls for most requests.
 */
export async function requireUser(): Promise<AuthUser> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE_NAME)?.value;
  
  if (!accessToken) {
    redirect('/login');
  }
  
  const payload = await verifyToken(accessToken);
  if (!payload || payload.type !== 'access') {
    redirect('/login');
  }
  
  // Return user from JWT cached data
  return payloadToUser(payload);
}

/**
 * Get current user without redirect (for optional auth).
 */
export async function getOptionalUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE_NAME)?.value;
  
  if (!accessToken) return null;
  
  const payload = await verifyToken(accessToken);
  if (!payload || payload.type !== 'access') return null;
  
  return payloadToUser(payload);
}

/**
 * Get fresh user data from API (when JWT cache might be stale).
 */
export async function getFreshUser(userId: string): Promise<AuthUser | null> {
  try {
    const { user } = await getUser(userId);
    return {
      id: user.id,
      email: user.email,
      name: user.name || user.email.split('@')[0],
      avatarUrl: user.avatar_url || null,
      internalUserId: user.internal_user_id,
      onboardingCompleted: user.onboarding_completed === 1,
    };
  } catch (error) {
    console.error('Failed to get fresh user:', error);
    return null;
  }
}

/**
 * Get user's billing info from API.
 * Wrapped with React cache() to deduplicate requests within the same render cycle.
 */
export const getUserBilling = cache(async (userId: string) => {
  const startTime = Date.now();
  console.log(`[getUserBilling] Fetching for ${userId}`);
  
  try {
    const { billing, transactions } = await getBilling(userId);
    console.log(`[getUserBilling] Completed in ${Date.now() - startTime}ms`);
    
    return {
      userId,
      creditBalanceCents: billing.credit_balance_cents,
      freeTierTokensUsed: billing.free_tier_tokens_used,
      freeTierExhausted: billing.free_tier_exhausted === 1,
      autoReupEnabled: billing.auto_reup_enabled === 1,
      autoReupAmountCents: billing.auto_reup_amount_cents,
      autoReupTriggerCents: billing.auto_reup_trigger_cents,
      monthlyCapCents: billing.monthly_cap_cents,
      monthlySpendCents: billing.monthly_spend_cents,
      stripeCustomerId: billing.stripe_customer_id,
      hasPaymentMethod: billing.has_payment_method === 1,
      transactions,
    };
  } catch (error) {
    console.error(`[getUserBilling] Failed after ${Date.now() - startTime}ms:`, error);
    // Return default billing for error case
    return {
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
      transactions: [],
    };
  }
});

/**
 * Mark user's onboarding as complete.
 */
export async function completeOnboarding(userId: string) {
  try {
    await apiCompleteOnboarding(userId);
  } catch (error) {
    console.error('Failed to complete onboarding:', error);
    throw error;
  }
}

// Legacy mock store functions (kept for backwards compatibility during migration)
// These will be removed once all code is migrated to use Workers API

interface MockUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  internalUserId: string;
  onboardingCompleted: boolean;
}

// No longer used - kept for import compatibility
export function setMockUser(_user: MockUser) {
  // No-op - users are now persisted in D1 via Workers API
  console.warn('setMockUser is deprecated - users are now persisted in D1');
}

export function getMockUser(_id: string): MockUser | undefined {
  // No-op - users are now fetched from D1 via Workers API
  console.warn('getMockUser is deprecated - use getFreshUser instead');
  return undefined;
}
