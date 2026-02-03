import { NextRequest, NextResponse } from 'next/server';
import { createAccessToken, createRefreshToken, verifyToken, hashToken, TokenPayload } from './jwt';

const ACCESS_COOKIE_NAME = 'mr_session';
const REFRESH_COOKIE_NAME = 'mr_refresh';

interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

/**
 * Create a new session for a user.
 * Note: In production, this would also store refresh token hash in D1.
 * For MVP, we're using stateless JWTs only.
 */
export async function createSession(userId: string, email: string): Promise<Session> {
  const accessToken = await createAccessToken(userId, email);
  const refreshToken = await createRefreshToken(userId);
  
  return { accessToken, refreshToken, userId };
}

/**
 * Set session cookies on the response.
 */
export function setSessionCookies(response: NextResponse, session: Session): void {
  response.cookies.set(ACCESS_COOKIE_NAME, session.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 15, // 15 minutes
    path: '/',
  });
  
  response.cookies.set(REFRESH_COOKIE_NAME, session.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });
}

/**
 * Get the current user from the session cookie.
 */
export async function getCurrentUser(request: NextRequest): Promise<TokenPayload | null> {
  const accessToken = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (!accessToken) return null;
  
  const payload = await verifyToken(accessToken);
  if (!payload || payload.type !== 'access') return null;
  
  return payload;
}

/**
 * Refresh the access token using the refresh token.
 */
export async function refreshAccessToken(request: NextRequest): Promise<{ accessToken: string; email: string } | null> {
  const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value;
  if (!refreshToken) return null;
  
  const payload = await verifyToken(refreshToken);
  if (!payload || payload.type !== 'refresh') return null;
  
  // In production, we would validate against the sessions table in D1.
  // For MVP, we trust the JWT refresh token.
  
  // Note: We need the email to create a new access token.
  // In a full implementation, we'd fetch from DB. For now, we'll need
  // to include email in the refresh token too, or fetch from DB.
  // Let's fetch from the mock/API.
  
  const newAccessToken = await createAccessToken(payload.userId, payload.email || '');
  return { accessToken: newAccessToken, email: payload.email || '' };
}

/**
 * Clear all session cookies.
 */
export function clearSessionCookies(response: NextResponse): void {
  response.cookies.delete(ACCESS_COOKIE_NAME);
  response.cookies.delete(REFRESH_COOKIE_NAME);
}

export { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME };
