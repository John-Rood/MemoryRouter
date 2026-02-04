import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const getJwtSecret = () => new TextEncoder().encode(process.env.JWT_SECRET!);
const ACCESS_TOKEN_EXPIRY = '30d';
const REFRESH_TOKEN_EXPIRY = '30d';

export interface TokenPayload extends JWTPayload {
  userId: string;
  email: string;
  type: 'access' | 'refresh';
  // Extended user data (cached in JWT to reduce API calls)
  name?: string;
  avatarUrl?: string;
  internalUserId?: string;
  onboardingCompleted?: boolean;
}

export interface UserMetadata {
  name?: string;
  avatarUrl?: string;
  internalUserId?: string;
  onboardingCompleted?: boolean;
}

/**
 * Create a signed JWT access token.
 */
export async function createAccessToken(
  userId: string, 
  email: string,
  metadata?: UserMetadata
): Promise<string> {
  return new SignJWT({ 
    userId, 
    email, 
    type: 'access',
    ...metadata,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(getJwtSecret());
}

/**
 * Create a signed JWT refresh token.
 */
export async function createRefreshToken(userId: string, email?: string): Promise<string> {
  return new SignJWT({ userId, email, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(getJwtSecret());
}

/**
 * Verify and decode a JWT token.
 */
export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

/**
 * Hash a refresh token for storage.
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
