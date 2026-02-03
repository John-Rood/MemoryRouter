/**
 * Workers API Client
 * Dashboard calls Workers backend for user management
 */

const WORKERS_API_URL = process.env.WORKERS_API_URL || 'https://api.memoryrouter.ai';
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || '';

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
}

async function apiCall<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body } = options;

  const response = await fetch(`${WORKERS_API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Dashboard-Key': DASHBOARD_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((error as { error: string }).error || `API error: ${response.status}`);
  }

  return response.json();
}

// ============================================================================
// User APIs
// ============================================================================

export interface User {
  id: string;
  google_id?: string;
  github_id?: string;
  email: string;
  name?: string;
  avatar_url?: string;
  internal_user_id: string;
  onboarding_completed: number;
  created_at: string;
  updated_at: string;
}

export interface UpsertUserResponse {
  user: User;
  isNew: boolean;
}

export async function upsertUser(data: {
  provider: 'google' | 'github';
  providerId: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}): Promise<UpsertUserResponse> {
  return apiCall('/api/users/upsert', {
    method: 'POST',
    body: data,
  });
}

export async function getUser(userId: string): Promise<{ user: User }> {
  return apiCall(`/api/users/${userId}`);
}

export async function completeOnboarding(userId: string): Promise<void> {
  return apiCall(`/api/users/${userId}/onboarding/complete`, { method: 'POST' });
}

// ============================================================================
// Billing APIs
// ============================================================================

export interface Billing {
  user_id: string;
  credit_balance_cents: number;
  free_tier_tokens_used: number;
  free_tier_exhausted: number;
  auto_reup_enabled: number;
  auto_reup_amount_cents: number;
  auto_reup_trigger_cents: number;
  monthly_cap_cents: number | null;
  monthly_spend_cents: number;
  stripe_customer_id: string | null;
  has_payment_method: number;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  type: string;
  amount_cents: number;
  description: string;
  balance_after_cents: number;
  stripe_payment_intent_id?: string;
  created_at: string;
}

export async function getBilling(userId: string): Promise<{ billing: Billing; transactions: Transaction[] }> {
  return apiCall(`/api/users/${userId}/billing`);
}

export async function updateBilling(userId: string, data: {
  autoReupEnabled?: boolean;
  autoReupAmountCents?: number;
  autoReupTriggerCents?: number;
  monthlyCapCents?: number | null;
  stripeCustomerId?: string;
  hasPaymentMethod?: boolean;
}): Promise<{ billing: Billing }> {
  return apiCall(`/api/users/${userId}/billing`, {
    method: 'POST',
    body: data,
  });
}

export async function addCredit(userId: string, data: {
  amountCents: number;
  description: string;
  stripePaymentIntentId?: string;
}): Promise<{ success: boolean; newBalanceCents: number; transactionId: string }> {
  return apiCall(`/api/users/${userId}/credit`, {
    method: 'POST',
    body: data,
  });
}

// ============================================================================
// Usage APIs
// ============================================================================

export interface UsageStats {
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  dailyUsage: Array<{
    date: string;
    requests: number;
    tokens_in: number;
    tokens_out: number;
  }>;
}

export async function getUsage(userId: string): Promise<UsageStats> {
  return apiCall(`/api/users/${userId}/usage`);
}

// ============================================================================
// Memory Key APIs
// ============================================================================

export interface MemoryKey {
  id: string;
  key: string;
  user_id: string;
  name: string;
  retention_days: number;
  is_active: number;
  tokens_stored: number;
  tokens_retrieved: number;
  request_count: number;
  last_used_at?: string;
  created_at: string;
}

export async function getMemoryKeys(userId: string): Promise<{ keys: MemoryKey[] }> {
  return apiCall(`/api/users/${userId}/memory-keys`);
}

export async function createMemoryKey(userId: string, name?: string): Promise<{ key: MemoryKey }> {
  return apiCall(`/api/users/${userId}/memory-keys`, {
    method: 'POST',
    body: { name },
  });
}

export async function deleteMemoryKey(userId: string, keyId: string): Promise<{ success: boolean }> {
  return apiCall(`/api/users/${userId}/memory-keys/${keyId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// Provider Key APIs
// ============================================================================

export interface ProviderKeyInfo {
  id: string;
  provider: string;
  key_hint: string;
  nickname?: string;
  is_active: number;
  last_verified_at?: string;
  created_at: string;
}

export async function getProviderKeys(userId: string): Promise<{ keys: ProviderKeyInfo[] }> {
  return apiCall(`/api/users/${userId}/provider-keys`);
}

export async function saveProviderKey(userId: string, data: {
  provider: string;
  apiKey: string;
  nickname?: string;
}): Promise<{ success: boolean; provider: string; keyHint: string }> {
  return apiCall(`/api/users/${userId}/provider-keys`, {
    method: 'POST',
    body: data,
  });
}

export async function deleteProviderKey(userId: string, provider: string): Promise<{ success: boolean }> {
  return apiCall(`/api/users/${userId}/provider-keys/${provider}`, {
    method: 'DELETE',
  });
}
