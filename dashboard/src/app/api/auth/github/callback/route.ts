import { NextRequest, NextResponse } from 'next/server';
import { githubOAuthConfig } from '@/lib/auth/oauth-config';
import { verifyStateCookie, clearStateCookie } from '@/lib/auth/oauth-utils';
import { createSession, setSessionCookies } from '@/lib/auth/session';
import { upsertUser } from '@/lib/api/workers-client';

interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  
  if (error) {
    console.error('GitHub OAuth error:', error);
    return NextResponse.redirect(new URL('/login?error=oauth_denied', request.url));
  }
  
  if (!state || !verifyStateCookie(request, state, 'github')) {
    return NextResponse.redirect(new URL('/login?error=invalid_state', request.url));
  }
  
  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', request.url));
  }
  
  try {
    // 1. Exchange code for token
    const tokenResponse = await fetch(githubOAuthConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: githubOAuthConfig.clientId,
        client_secret: githubOAuthConfig.clientSecret,
        code,
        redirect_uri: githubOAuthConfig.redirectUri,
      }),
    });
    
    const tokens: GitHubTokenResponse = await tokenResponse.json();
    
    if (!tokens.access_token) {
      console.error('No access token in response');
      return NextResponse.redirect(new URL('/login?error=token_exchange', request.url));
    }
    
    // 2. Fetch user info
    const userResponse = await fetch(githubOAuthConfig.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: 'application/json',
      },
    });
    
    const githubUser: GitHubUser = await userResponse.json();
    
    // 3. Fetch email (GitHub may not include it in user info)
    let email = githubUser.email;
    if (!email) {
      const emailsResponse = await fetch(githubOAuthConfig.userEmailsUrl, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: 'application/json',
        },
      });
      
      const emails: GitHubEmail[] = await emailsResponse.json();
      const primaryEmail = emails.find(e => e.primary && e.verified);
      email = primaryEmail?.email || emails[0]?.email;
    }
    
    if (!email) {
      return NextResponse.redirect(new URL('/login?error=no_email', request.url));
    }
    
    // 4. Create or update user in D1 via Workers API
    const { user, isNew } = await upsertUser({
      provider: 'github',
      providerId: String(githubUser.id),
      email,
      name: githubUser.name || githubUser.login,
      avatarUrl: githubUser.avatar_url,
    });
    
    console.log(`User ${isNew ? 'created' : 'updated'}: ${user.id}`);
    
    // 5. Create session with user data
    const session = await createSession(user.id, email, {
      name: user.name || undefined,
      avatarUrl: user.avatar_url || undefined,
      internalUserId: user.internal_user_id,
      onboardingCompleted: user.onboarding_completed === 1,
    });
    
    // 6. Determine redirect destination
    const redirectPath = user.onboarding_completed ? '/dashboard' : '/onboarding';
    
    // 7. Set cookies and redirect
    const response = NextResponse.redirect(new URL(redirectPath, request.url));
    setSessionCookies(response, session);
    clearStateCookie(response, 'github');
    
    return response;
    
  } catch (error) {
    console.error('GitHub OAuth callback error:', error);
    return NextResponse.redirect(new URL('/login?error=server_error', request.url));
  }
}
