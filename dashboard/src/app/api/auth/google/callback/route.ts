import { NextRequest, NextResponse } from 'next/server';
import { googleOAuthConfig } from '@/lib/auth/oauth-config';
import { verifyStateCookie, clearStateCookie } from '@/lib/auth/oauth-utils';
import { createSession, setSessionCookies } from '@/lib/auth/session';
import { createOrUpdateUser, updateUserStripeCustomer } from '@/lib/auth/user-service';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  
  // Handle OAuth error
  if (error) {
    console.error('Google OAuth error:', error);
    return NextResponse.redirect(new URL('/login?error=oauth_denied', request.url));
  }
  
  // Validate state (CSRF protection)
  if (!state || !verifyStateCookie(request, state, 'google')) {
    return NextResponse.redirect(new URL('/login?error=invalid_state', request.url));
  }
  
  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', request.url));
  }
  
  try {
    // 1. Exchange code for tokens
    const tokenResponse = await fetch(googleOAuthConfig.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: googleOAuthConfig.clientId,
        client_secret: googleOAuthConfig.clientSecret,
        redirect_uri: googleOAuthConfig.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    
    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error('Token exchange failed:', error);
      return NextResponse.redirect(new URL('/login?error=token_exchange', request.url));
    }
    
    const tokens: GoogleTokenResponse = await tokenResponse.json();
    
    // 2. Fetch user info
    const userInfoResponse = await fetch(googleOAuthConfig.userInfoUrl, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    
    if (!userInfoResponse.ok) {
      console.error('User info fetch failed');
      return NextResponse.redirect(new URL('/login?error=user_info', request.url));
    }
    
    const googleUser: GoogleUserInfo = await userInfoResponse.json();
    
    // 3. Create or update user in D1
    const user = await createOrUpdateUser({
      provider: 'google',
      providerId: googleUser.id,
      email: googleUser.email,
      name: googleUser.name,
      avatarUrl: googleUser.picture,
    });
    
    // 4. Create Stripe customer if new user (no existing stripeCustomerId)
    if (!user.stripeCustomerId && process.env.STRIPE_SECRET_KEY) {
      try {
        const stripeCustomer = await stripe.customers.create({
          email: user.email,
          name: user.name || undefined,
          metadata: { user_id: user.id },
        });
        
        updateUserStripeCustomer(user.id, stripeCustomer.id);
        console.log(`[Google OAuth] Created Stripe customer: ${stripeCustomer.id}`);
      } catch (stripeError) {
        console.error('[Google OAuth] Stripe customer creation failed:', stripeError);
        // Don't fail auth if Stripe fails
      }
    }
    
    // 5. Create session
    const session = await createSession(user.id, user.email);
    
    // 6. Determine redirect URL based on onboarding status
    const redirectUrl = user.onboardingCompleted ? '/' : '/onboarding';
    
    // 7. Set cookies and redirect
    const response = NextResponse.redirect(new URL(redirectUrl, request.url));
    setSessionCookies(response, session);
    clearStateCookie(response, 'google');
    
    console.log(`[Google OAuth] User authenticated: ${user.email} (${user.id})`);
    
    return response;
    
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    return NextResponse.redirect(new URL('/login?error=server_error', request.url));
  }
}
