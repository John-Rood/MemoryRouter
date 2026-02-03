import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyToken, TokenPayload } from './jwt';

const ACCESS_COOKIE_NAME = 'mr_session';

// Mock user data for MVP (replace with D1 queries in production)
interface MockUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  internalUserId: string;
  onboardingCompleted: boolean;
}

// In-memory user store for MVP demo
const userStore = new Map<string, MockUser>();

export function setMockUser(user: MockUser) {
  userStore.set(user.id, user);
}

export function getMockUser(id: string): MockUser | undefined {
  return userStore.get(id);
}

/**
 * Get current user for server components.
 * Redirects to login if not authenticated.
 */
export async function requireUser(): Promise<MockUser> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE_NAME)?.value;
  
  if (!accessToken) {
    redirect('/login');
  }
  
  const payload = await verifyToken(accessToken);
  if (!payload || payload.type !== 'access') {
    redirect('/login');
  }
  
  // Try to get from mock store, or create default user
  let user = userStore.get(payload.userId);
  
  if (!user) {
    // Create default user from token data
    user = {
      id: payload.userId,
      email: payload.email,
      name: payload.email.split('@')[0],
      avatarUrl: null,
      internalUserId: `usr_${payload.userId.replace(/-/g, '').slice(0, 24)}`,
      onboardingCompleted: true, // Assume completed for demo
    };
    userStore.set(payload.userId, user);
  }
  
  return user;
}

/**
 * Get current user without redirect (for optional auth).
 */
export async function getOptionalUser(): Promise<MockUser | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE_NAME)?.value;
  
  if (!accessToken) return null;
  
  const payload = await verifyToken(accessToken);
  if (!payload || payload.type !== 'access') return null;
  
  let user = userStore.get(payload.userId);
  
  if (!user) {
    user = {
      id: payload.userId,
      email: payload.email,
      name: payload.email.split('@')[0],
      avatarUrl: null,
      internalUserId: `usr_${payload.userId.replace(/-/g, '').slice(0, 24)}`,
      onboardingCompleted: true,
    };
    userStore.set(payload.userId, user);
  }
  
  return user;
}

/**
 * Get user's billing info (mock for MVP).
 */
export async function getUserBilling(userId: string) {
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
  };
}

/**
 * Mark user's onboarding as complete (mock for MVP).
 */
export function completeOnboarding(userId: string) {
  const user = userStore.get(userId);
  if (user) {
    user.onboardingCompleted = true;
    userStore.set(userId, user);
  }
}
