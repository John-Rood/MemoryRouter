import { NextRequest, NextResponse } from 'next/server';
import { googleOAuthConfig } from '@/lib/auth/oauth-config';
import { generateState, setStateCookie } from '@/lib/auth/oauth-utils';

export async function GET(request: NextRequest) {
  // Check if OAuth is configured
  if (!googleOAuthConfig.clientId || googleOAuthConfig.clientId === 'undefined') {
    // Redirect to demo login for development
    return NextResponse.redirect(new URL('/api/auth/demo', request.url));
  }
  
  // Generate CSRF state token
  const state = generateState();
  
  // Build authorization URL
  const params = new URLSearchParams({
    client_id: googleOAuthConfig.clientId,
    redirect_uri: googleOAuthConfig.redirectUri,
    response_type: 'code',
    scope: googleOAuthConfig.scopes.join(' '),
    state: state,
    access_type: 'offline',
    prompt: 'consent',
  });
  
  const authUrl = `${googleOAuthConfig.authorizationUrl}?${params}`;
  
  // Set state in cookie and redirect
  const response = NextResponse.redirect(authUrl);
  setStateCookie(response, state, 'google');
  
  return response;
}
