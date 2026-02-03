import { NextRequest, NextResponse } from 'next/server';
import { githubOAuthConfig } from '@/lib/auth/oauth-config';
import { generateState, setStateCookie } from '@/lib/auth/oauth-utils';

export async function GET(request: NextRequest) {
  // Check if OAuth is configured
  if (!githubOAuthConfig.clientId || githubOAuthConfig.clientId === 'undefined') {
    // Redirect to demo login for development
    return NextResponse.redirect(new URL('/api/auth/demo', request.url));
  }
  
  const state = generateState();
  
  const params = new URLSearchParams({
    client_id: githubOAuthConfig.clientId,
    redirect_uri: githubOAuthConfig.redirectUri,
    scope: githubOAuthConfig.scopes.join(' '),
    state: state,
  });
  
  const authUrl = `${githubOAuthConfig.authorizationUrl}?${params}`;
  
  const response = NextResponse.redirect(authUrl);
  setStateCookie(response, state, 'github');
  
  return response;
}
