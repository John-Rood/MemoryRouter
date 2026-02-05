import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth/jwt';

const publicRoutes = ['/login', '/signup', '/api/auth', '/api/webhooks'];

// CORS: Only allow requests from app.memoryrouter.ai (and localhost for dev)
const ALLOWED_ORIGINS = [
  'https://app.memoryrouter.ai',
  'http://localhost:3000',
  'http://localhost:3001',
];

function handleCORS(request: NextRequest, response: NextResponse): NextResponse {
  const origin = request.headers.get('origin');
  
  // Only set CORS headers for API routes
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    return response;
  }
  
  // Check if origin is allowed
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  // If origin not in allowlist, don't set CORS headers (browser will block)
  
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Handle CORS preflight requests
  if (request.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin');
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      return new NextResponse(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    // Deny preflight for unknown origins
    return new NextResponse(null, { status: 403 });
  }
  
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
  
  const response = NextResponse.next();
  return handleCORS(request, response);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
