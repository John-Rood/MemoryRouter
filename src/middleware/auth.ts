/**
 * Authentication Middleware
 * 
 * IMPORTANT ARCHITECTURE:
 * ========================
 * Memory Keys and Provider Keys are COMPLETELY INDEPENDENT.
 * 
 * Memory Key (mk_xxx):
 *   - Identifies a memory context (conversation history)
 *   - Links to: User → VectorVault namespace
 *   - Can be used with ANY provider/model
 *   - Rotating provider keys does NOT affect memory
 * 
 * Provider Keys (OpenAI, Anthropic, etc.):
 *   - Stored separately in user account
 *   - Can be rotated/changed anytime
 *   - Selected at request time based on model
 *   - NO link to memory keys
 * 
 * Request Flow:
 *   1. Auth with memory key (mk_xxx) → identifies memory context
 *   2. Parse model from request → determine provider
 *   3. Look up user's provider key for that provider
 *   4. Forward request using provider key
 *   5. Same memory works with any model!
 */

import type { Context, Next } from 'hono';

// =============================================================================
// DATA MODEL (matches ARCHITECTURE.md)
// =============================================================================

/**
 * Memory Key - identifies a memory context
 * Stored in: memory_keys table
 * 
 * NOTE: No reference to provider_keys! Memory is provider-agnostic.
 */
export interface MemoryKeyInfo {
  key: string;              // 'mk_xxx' - exposed to user
  userId: string;           // Links to users table
  name?: string;            // User-friendly name
  isActive: boolean;
  createdAt: Date;
  // Vector store namespace derived from key
  // No provider key reference - memory works with ANY provider
}

/**
 * Provider Key - API key for a specific provider
 * Stored in: provider_keys table
 * 
 * NOTE: Links to USER, not to memory key!
 */
export interface ProviderKeyInfo {
  id: string;
  userId: string;           // Links to users table (NOT memory_keys!)
  provider: string;         // 'openai' | 'anthropic' | 'openrouter' | 'google'
  encryptedKey: string;     // Encrypted with KMS
  nickname?: string;
  isActive: boolean;
  lastUsedAt?: Date;
}

/**
 * User Context - resolved at request time
 */
export interface UserContext {
  memoryKey: MemoryKeyInfo;
  providerKeys: Record<string, string>; // provider -> decrypted apiKey
  userId: string;
}

// =============================================================================
// STUB DATA (replace with database queries in production)
// =============================================================================

/**
 * STUB: Memory keys table
 * 
 * Production SQL:
 * SELECT * FROM memory_keys WHERE key = $1 AND is_active = true
 */
const STUB_MEMORY_KEYS: Record<string, MemoryKeyInfo> = {
  'mk_test_key': {
    key: 'mk_test_key',
    userId: 'user_001',
    name: 'Test Project',
    isActive: true,
    createdAt: new Date(),
  },
  'mk_demo': {
    key: 'mk_demo',
    userId: 'user_001',
    name: 'Demo',
    isActive: true,
    createdAt: new Date(),
  },
  // Different user with same providers but separate memory
  'mk_user2_project': {
    key: 'mk_user2_project',
    userId: 'user_002',
    name: 'User 2 Project',
    isActive: true,
    createdAt: new Date(),
  },
};

/**
 * STUB: Provider keys table (keyed by userId)
 * 
 * Production SQL:
 * SELECT provider, decrypt(encrypted_key) as api_key 
 * FROM provider_keys 
 * WHERE user_id = $1 AND is_active = true
 * 
 * NOTE: This is keyed by USER, not by memory key!
 * User can have multiple memory keys all sharing the same provider keys.
 */
const STUB_PROVIDER_KEYS: Record<string, Record<string, string>> = {
  'user_001': {
    openai: process.env.OPENAI_API_KEY ?? '',
    anthropic: process.env.ANTHROPIC_API_KEY ?? '',
    openrouter: process.env.OPENROUTER_API_KEY ?? '',
  },
  'user_002': {
    // Different user, different provider keys
    openai: process.env.OPENAI_API_KEY ?? '',
    anthropic: process.env.ANTHROPIC_API_KEY ?? '',
  },
};

// =============================================================================
// DATABASE FUNCTIONS (stub implementations)
// =============================================================================

/**
 * Validate a memory key and return info
 * 
 * Production: Query memory_keys table
 */
export async function validateMemoryKey(key: string): Promise<MemoryKeyInfo | null> {
  if (!key.startsWith('mk_')) {
    return null;
  }
  
  // STUB: In production, query database
  const keyInfo = STUB_MEMORY_KEYS[key];
  
  if (!keyInfo || !keyInfo.isActive) {
    return null;
  }
  
  return keyInfo;
}

/**
 * Get provider keys for a user (NOT for a memory key!)
 * 
 * Production: Query provider_keys table by user_id, decrypt keys
 */
export async function getProviderKeysForUser(userId: string): Promise<Record<string, string>> {
  // STUB: In production, query and decrypt from database
  return STUB_PROVIDER_KEYS[userId] ?? {};
}

// =============================================================================
// MIDDLEWARE
// =============================================================================

/**
 * Auth middleware for Hono
 * 
 * Flow:
 * 1. Extract memory key from Authorization header
 * 2. Validate memory key → get userId
 * 3. Fetch provider keys for that user (separate lookup!)
 * 4. Attach context to request
 */
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader) {
    return c.json({ error: 'Missing Authorization header' }, 401);
  }
  
  // Extract Bearer token (memory key)
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return c.json({ error: 'Invalid Authorization header format. Use: Bearer mk_xxx' }, 401);
  }
  
  const memoryKey = parts[1];
  
  // Step 1: Validate memory key
  const keyInfo = await validateMemoryKey(memoryKey);
  if (!keyInfo) {
    return c.json({ 
      error: 'Invalid or inactive memory key',
      hint: 'Memory keys start with mk_ (e.g., mk_your_project_key)'
    }, 401);
  }
  
  // Step 2: Get provider keys for this USER (not memory key!)
  // This is the key separation - provider keys are looked up by userId
  const providerKeys = await getProviderKeysForUser(keyInfo.userId);
  
  // Attach user context to request
  c.set('userContext', {
    memoryKey: keyInfo,
    providerKeys,
    userId: keyInfo.userId,
  } as UserContext);
  
  await next();
}

/**
 * Get user context from request (after auth middleware)
 */
export function getUserContext(c: Context): UserContext {
  return c.get('userContext') as UserContext;
}
