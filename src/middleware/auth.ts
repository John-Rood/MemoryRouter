/**
 * Authentication Middleware
 * 
 * ARCHITECTURE (from spec Section 6.2):
 * Memory Keys and Provider Keys are COMPLETELY INDEPENDENT.
 * 
 * Memory Key (mk_xxx):
 *   - Identifies a memory context
 *   - Can be used with ANY provider/model
 *   - Rotating provider keys does NOT affect memory
 * 
 * Provider Keys (OpenAI, Anthropic, etc.):
 *   - Stored separately in user account
 *   - Selected at request time based on model
 *   - NO link to memory keys
 * 
 * Request Flow:
 *   1. Auth with memory key (mk_xxx) → identifies memory context
 *   2. Parse model → determine provider
 *   3. Look up user's provider key for that provider
 *   4. Forward request using provider key
 */

import type { Context, Next } from 'hono';
import type { MemoryKeyInfo, UserContext } from '../types';

// =============================================================================
// STUB DATA (replace with database queries in production)
// =============================================================================

/**
 * In-memory store for memory keys
 * Production: Supabase PostgreSQL `memory_keys` table
 */
const memoryKeys: Map<string, MemoryKeyInfo> = new Map([
  ['mk_test_key', {
    key: 'mk_test_key',
    userId: 'user_001',
    name: 'Test Project',
    isActive: true,
    createdAt: new Date(),
  }],
  ['mk_demo', {
    key: 'mk_demo',
    userId: 'user_001',
    name: 'Demo',
    isActive: true,
    createdAt: new Date(),
  }],
  ['mk_user2_project', {
    key: 'mk_user2_project',
    userId: 'user_002',
    name: 'User 2 Project',
    isActive: true,
    createdAt: new Date(),
  }],
]);

/**
 * Provider keys by user ID
 * Production: Supabase PostgreSQL `provider_keys` table (encrypted)
 */
const providerKeysByUser: Map<string, Record<string, string>> = new Map();

// Initialize stub provider keys
providerKeysByUser.set('user_001', {
  openai: process.env.OPENAI_API_KEY ?? '',
  anthropic: process.env.ANTHROPIC_API_KEY ?? '',
  openrouter: process.env.OPENROUTER_API_KEY ?? '',
});
providerKeysByUser.set('user_002', {
  openai: process.env.OPENAI_API_KEY ?? '',
  anthropic: process.env.ANTHROPIC_API_KEY ?? '',
});

// =============================================================================
// MEMORY KEY MANAGEMENT
// =============================================================================

/**
 * Validate a memory key and return info
 */
export async function validateMemoryKey(key: string): Promise<MemoryKeyInfo | null> {
  if (!key.startsWith('mk_')) {
    return null;
  }
  
  const keyInfo = memoryKeys.get(key);
  if (!keyInfo || !keyInfo.isActive) {
    return null;
  }
  
  return keyInfo;
}

/**
 * Get provider keys for a user
 */
export async function getProviderKeysForUser(userId: string): Promise<Record<string, string>> {
  return providerKeysByUser.get(userId) ?? {};
}

/**
 * Create a new memory key
 */
export async function createMemoryKey(userId: string, name?: string): Promise<MemoryKeyInfo> {
  // Generate a unique key
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 24);
  const key = `mk_${suffix}`;
  
  const keyInfo: MemoryKeyInfo = {
    key,
    userId,
    name: name ?? 'Untitled',
    isActive: true,
    createdAt: new Date(),
  };
  
  memoryKeys.set(key, keyInfo);
  console.log(`[AUTH] Created memory key: ${key} for user: ${userId}`);
  
  return keyInfo;
}

/**
 * List all memory keys for a user
 */
export async function listMemoryKeys(userId: string): Promise<MemoryKeyInfo[]> {
  const keys: MemoryKeyInfo[] = [];
  
  for (const keyInfo of memoryKeys.values()) {
    if (keyInfo.userId === userId && keyInfo.isActive) {
      keys.push(keyInfo);
    }
  }
  
  return keys.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Delete (deactivate) a memory key
 */
export async function deleteMemoryKey(key: string, userId: string): Promise<boolean> {
  const keyInfo = memoryKeys.get(key);
  if (!keyInfo || keyInfo.userId !== userId) {
    return false;
  }
  
  keyInfo.isActive = false;
  console.log(`[AUTH] Deactivated memory key: ${key}`);
  return true;
}

/**
 * Extract memory key from Authorization header
 */
export function extractMemoryKey(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }
  
  return parts[1];
}

// =============================================================================
// MIDDLEWARE
// =============================================================================

/**
 * Auth middleware
 * Validates memory key and attaches user context
 */
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader) {
    return c.json({
      error: {
        type: 'authentication_error',
        message: 'Missing Authorization header.',
        code: 'MISSING_AUTH',
      },
    }, 401);
  }
  
  const key = extractMemoryKey(authHeader);
  if (!key) {
    return c.json({
      error: {
        type: 'authentication_error',
        message: 'Invalid Authorization header format. Use: Bearer mk_xxx',
        code: 'INVALID_AUTH_FORMAT',
      },
    }, 401);
  }
  
  // Validate memory key
  const keyInfo = await validateMemoryKey(key);
  if (!keyInfo) {
    return c.json({
      error: {
        type: 'authentication_error',
        message: 'Invalid or expired memory key.',
        code: 'INVALID_MEMORY_KEY',
      },
    }, 401);
  }
  
  // Get provider keys for this USER (not memory key)
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
