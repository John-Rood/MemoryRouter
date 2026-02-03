import { NextRequest, NextResponse } from 'next/server';

/**
 * Generate a cryptographically secure state parameter for CSRF protection.
 */
export function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Set the OAuth state in an httpOnly cookie.
 */
export function setStateCookie(
  response: NextResponse,
  state: string,
  provider: 'google' | 'github'
): void {
  response.cookies.set(`oauth_state_${provider}`, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes
    path: '/',
  });
}

/**
 * Verify the OAuth state from the callback matches the cookie.
 */
export function verifyStateCookie(
  request: NextRequest,
  state: string,
  provider: 'google' | 'github'
): boolean {
  const cookieState = request.cookies.get(`oauth_state_${provider}`)?.value;
  return cookieState === state;
}

/**
 * Clear the OAuth state cookie after use.
 */
export function clearStateCookie(
  response: NextResponse,
  provider: 'google' | 'github'
): void {
  response.cookies.delete(`oauth_state_${provider}`);
}
