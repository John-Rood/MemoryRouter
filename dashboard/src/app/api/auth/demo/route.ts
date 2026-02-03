import { NextRequest, NextResponse } from 'next/server';
import { createSession, setSessionCookies } from '@/lib/auth/session';
import { createOrUpdateUser } from '@/lib/auth/user-service';

/**
 * Demo authentication route for development.
 * Creates a test user session without requiring OAuth credentials.
 */
export async function GET(request: NextRequest) {
  // Create a demo user via the user service (writes to D1)
  const user = await createOrUpdateUser({
    provider: 'google', // Use google as default provider for demo
    providerId: 'demo_' + Date.now(),
    email: 'demo@memoryrouter.ai',
    name: 'Demo User',
    avatarUrl: null,
  });
  
  // Create session
  const session = await createSession(user.id, user.email);
  
  // Set cookies and redirect to onboarding
  const response = NextResponse.redirect(new URL('/onboarding', request.url));
  setSessionCookies(response, session);
  
  return response;
}
