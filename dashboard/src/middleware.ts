import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth/jwt';

const publicRoutes = ['/login', '/signup', '/api/auth', '/api/webhooks'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Allow public routes
  if (publicRoutes.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }
  
  // Allow static files and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }
  
  // Check for valid session
  const accessToken = request.cookies.get('mr_session')?.value;
  
  if (!accessToken) {
    // No session - redirect to login
    return NextResponse.redirect(new URL('/login', request.url));
  }
  
  // Verify token
  const payload = await verifyToken(accessToken);
  
  if (!payload || payload.type !== 'access') {
    // Invalid token - try refresh or redirect to login
    const refreshToken = request.cookies.get('mr_refresh')?.value;
    
    if (!refreshToken) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    
    const refreshPayload = await verifyToken(refreshToken);
    
    if (!refreshPayload || refreshPayload.type !== 'refresh') {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    
    // For MVP, we'll just let them through and let the page handle refresh
    // In production, we'd issue a new access token here
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
