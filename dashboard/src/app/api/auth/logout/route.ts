import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookies } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/login', request.url));
  clearSessionCookies(response);
  return response;
}

export async function GET(request: NextRequest) {
  return POST(request);
}
