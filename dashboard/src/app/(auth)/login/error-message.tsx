"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const errorMessages: Record<string, string> = {
  oauth_denied: 'Sign in was cancelled.',
  invalid_state: 'Invalid session. Please try again.',
  no_code: 'No authorization received.',
  token_exchange: 'Failed to complete sign in. Please try again.',
  user_info: 'Failed to get your info. Please try again.',
  no_email: 'Email is required to sign up.',
  server_error: 'Something went wrong. Please try again.',
};

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  
  if (!error) return null;
  
  return (
    <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-400">
      {errorMessages[error] || 'An error occurred. Please try again.'}
    </div>
  );
}

export function ErrorMessage() {
  return (
    <Suspense fallback={null}>
      <ErrorContent />
    </Suspense>
  );
}
