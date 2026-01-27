/**
 * Authentication Middleware
 * Validates memory keys and resolves user context
 */

import { Context, Next } from 'hono';

/**
 * Memory key info (stored in KV)
 */
export interface MemoryKeyInfo {
  key: string;              // 'mk_xxx'
  userId: string;
  name?: string;
  isActive: boolean;
  createdAt: number;
  lastUsedAt?: number;
}

/**
 * Provider API keys for a user
 */
export interface ProviderKeys {
  openai?: string;
  anthropic?: string;
  openrouter?: string;
  google?: string;
}

/**
 * User context resolved from memory key
 */
export interface UserContext {
  memoryKey: MemoryKeyInfo;
  providerKeys: ProviderKeys;
  userId: string;
  /** Session ID from X-Session-ID header or request body */
  sessionId?: string;
}

export interface AuthEnv {
  METADATA_KV: KVNamespace;
}

/**
 * Extract memory key from Authorization header
 */
export function extractMemoryKey(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }
  
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }
  
  const token = parts[1];
  if (!token.startsWith('mk_')) {
    return null;
  }
  
  return token;
}

/**
 * Validate and load memory key info
 */
export async function validateMemoryKey(
  memoryKey: string,
  kv: KVNamespace
): Promise<MemoryKeyInfo | null> {
  const key = `auth:${memoryKey}`;
  const info = await kv.get(key, 'json') as MemoryKeyInfo | null;
  
  if (!info) {
    // For development: auto-create memory keys
    if (process.env.NODE_ENV === 'development' || memoryKey === 'mk_test_key') {
      const newKey: MemoryKeyInfo = {
        key: memoryKey,
        userId: `user_${memoryKey.replace('mk_', '')}`,
        name: 'Auto-created key',
        isActive: true,
        createdAt: Date.now(),
      };
      await kv.put(key, JSON.stringify(newKey));
      return newKey;
    }
    return null;
  }
  
  if (!info.isActive) {
    return null;
  }
  
  // Update last used
  info.lastUsedAt = Date.now();
  await kv.put(key, JSON.stringify(info));
  
  return info;
}

/**
 * Load provider API keys for a user
 */
export async function loadProviderKeys(
  userId: string,
  kv: KVNamespace
): Promise<ProviderKeys> {
  const key = `user:${userId}:provider_keys`;
  const keys = await kv.get(key, 'json') as ProviderKeys | null;
  
  // For development: use environment variables
  if (!keys) {
    return {
      openai: undefined,
      anthropic: undefined,
      openrouter: undefined,
      google: undefined,
    };
  }
  
  return keys;
}

/**
 * Store provider API keys for a user
 */
export async function saveProviderKeys(
  userId: string,
  keys: ProviderKeys,
  kv: KVNamespace
): Promise<void> {
  await kv.put(`user:${userId}:provider_keys`, JSON.stringify(keys));
}

/**
 * Create a new memory key
 */
export async function createMemoryKey(
  userId: string,
  name: string,
  kv: KVNamespace
): Promise<MemoryKeyInfo> {
  // Generate unique key
  const random = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
  const memoryKey = `mk_${random}`;
  
  const info: MemoryKeyInfo = {
    key: memoryKey,
    userId,
    name,
    isActive: true,
    createdAt: Date.now(),
  };
  
  await kv.put(`auth:${memoryKey}`, JSON.stringify(info));
  
  // Also index by user
  const userKeysKey = `user:${userId}:memory_keys`;
  const existingKeys = await kv.get(userKeysKey, 'json') as string[] | null;
  const keys = existingKeys || [];
  keys.push(memoryKey);
  await kv.put(userKeysKey, JSON.stringify(keys));
  
  return info;
}

/**
 * Revoke a memory key
 */
export async function revokeMemoryKey(
  memoryKey: string,
  kv: KVNamespace
): Promise<boolean> {
  const key = `auth:${memoryKey}`;
  const info = await kv.get(key, 'json') as MemoryKeyInfo | null;
  
  if (!info) {
    return false;
  }
  
  info.isActive = false;
  await kv.put(key, JSON.stringify(info));
  
  return true;
}

/**
 * Hono middleware for memory key authentication
 */
export function authMiddleware(env: AuthEnv) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');
    
    if (!authHeader) {
      return c.json({ 
        error: 'Missing Authorization header',
        hint: 'Use: Authorization: Bearer mk_your_memory_key',
      }, 401);
    }
    
    const memoryKey = extractMemoryKey(authHeader);
    if (!memoryKey) {
      return c.json({ 
        error: 'Invalid Authorization header format',
        hint: 'Use: Authorization: Bearer mk_xxx',
      }, 401);
    }
    
    const keyInfo = await validateMemoryKey(memoryKey, env.METADATA_KV);
    if (!keyInfo) {
      return c.json({ 
        error: 'Invalid or inactive memory key',
        hint: 'Memory keys start with mk_',
      }, 401);
    }
    
    // Load provider keys for this user
    const providerKeys = await loadProviderKeys(keyInfo.userId, env.METADATA_KV);
    
    // Extract session ID from X-Session-ID header
    const sessionId = c.req.header('X-Session-ID') || undefined;
    
    // Set context
    const userContext: UserContext = {
      memoryKey: keyInfo,
      providerKeys,
      userId: keyInfo.userId,
      sessionId,
    };
    
    c.set('userContext', userContext);
    
    await next();
  };
}

/**
 * Get user context from Hono context
 */
export function getUserContext(c: Context): UserContext {
  return c.get('userContext') as UserContext;
}
