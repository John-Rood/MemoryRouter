import { NextRequest, NextResponse } from 'next/server';
import { createSession, setSessionCookies } from '@/lib/auth/session';
import { setMockUser } from '@/lib/auth/server';

/**
 * Demo authentication route for development.
 * Creates a test user session without requiring OAuth credentials.
 */
export async function GET(request: NextRequest) {
  // Create a demo user
  const userId = 'demo_user_' + Date.now();
  const email = 'demo@memoryrouter.ai';
  const internalUserId = `usr_${userId.replace(/[^a-z0-9]/gi, '').slice(0, 24)}`;
  
  setMockUser({
    id: userId,
    email,
    name: 'Demo User',
    avatarUrl: null,
    internalUserId,
    onboardingCompleted: false,
  });
  
  // Create session
  const session = await createSession(userId, email);
  
  // Set cookies and redirect to onboarding
  const response = NextResponse.redirect(new URL('/onboarding', request.url));
  setSessionCookies(response, session);
  
  return response;
}
