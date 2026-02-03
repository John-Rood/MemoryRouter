import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyToken } from './jwt';
import { getUserById, getUserBillingById, completeUserOnboarding, type User, type UserBilling } from './user-service';

const ACCESS_COOKIE_NAME = 'mr_session';

/**
 * Get current user for server components.
 * Redirects to login if not authenticated.
 */
export async function requireUser(): Promise<User> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE_NAME)?.value;
  
  if (!accessToken) {
    redirect('/login');
  }
  
  const payload = await verifyToken(accessToken);
  if (!payload || payload.type !== 'access') {
    redirect('/login');
  }
  
  // Query user from D1
  const user = getUserById(payload.userId);
  
  if (!user) {
    // User not found in database - clear cookie and redirect to login
    console.warn(`[Auth] User not found in DB: ${payload.userId}`);
    redirect('/login');
  }
  
  return user;
}

/**
 * Get current user without redirect (for optional auth).
 */
export async function getOptionalUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE_NAME)?.value;
  
  if (!accessToken) return null;
  
  const payload = await verifyToken(accessToken);
  if (!payload || payload.type !== 'access') return null;
  
  // Query user from D1
  const user = getUserById(payload.userId);
  
  return user;
}

/**
 * Get user's billing info.
 */
export async function getUserBilling(userId: string): Promise<UserBilling | null> {
  return getUserBillingById(userId);
}

/**
 * Mark user's onboarding as complete.
 */
export function completeOnboarding(userId: string): void {
  completeUserOnboarding(userId);
}

// Re-export types for convenience
export type { User, UserBilling };
