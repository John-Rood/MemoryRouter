import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { join } from 'path';

// Type for our Drizzle database instance
export type DB = BetterSQLite3Database<typeof schema>;

// Singleton database instance for local development
let _db: DB | null = null;

/**
 * Get database connection.
 * 
 * For local development: uses SQLite file in .wrangler/state/
 * For Cloudflare Pages: pass the D1 binding from getRequestContext()
 * 
 * @param d1Binding - Optional D1 binding for Cloudflare Pages (not used in local dev)
 */
export function getDb(d1Binding?: unknown): DB {
  // For local development, use better-sqlite3 with local file
  if (!d1Binding) {
    if (!_db) {
      // Use local SQLite database
      const dbPath = process.env.LOCAL_DB_PATH || join(process.cwd(), '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject', 'local.sqlite');
      
      try {
        const sqlite = new Database(dbPath);
        sqlite.pragma('journal_mode = WAL');
        sqlite.pragma('foreign_keys = ON');
        _db = drizzle(sqlite, { schema });
        console.log('[DB] Connected to local SQLite:', dbPath);
      } catch (error) {
        // Fallback to in-memory for development if file doesn't exist
        console.warn('[DB] Local SQLite not found, using in-memory database');
        const sqlite = new Database(':memory:');
        sqlite.pragma('foreign_keys = ON');
        _db = drizzle(sqlite, { schema });
        
        // Initialize schema for in-memory db
        initializeInMemoryDb(sqlite);
      }
    }
    return _db;
  }
  
  // For Cloudflare Pages with D1 binding
  // This would use drizzle-orm/d1 adapter in production
  // For now, this path is handled separately in Cloudflare environment
  throw new Error('D1 binding should be handled via Cloudflare Pages runtime');
}

/**
 * Initialize in-memory database with schema for development
 */
function initializeInMemoryDb(sqlite: Database.Database) {
  // Create users table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_id TEXT UNIQUE,
      github_id TEXT UNIQUE,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      avatar_url TEXT,
      internal_user_id TEXT UNIQUE NOT NULL,
      onboarding_completed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      refresh_token_hash TEXT UNIQUE NOT NULL,
      user_agent TEXT,
      ip_address TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      last_used_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE TABLE IF NOT EXISTS billing (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      credit_balance_cents INTEGER DEFAULT 0,
      free_tier_tokens_used INTEGER DEFAULT 0,
      free_tier_exhausted INTEGER DEFAULT 0,
      auto_reup_enabled INTEGER DEFAULT 1,
      auto_reup_amount_cents INTEGER DEFAULT 2000,
      auto_reup_trigger_cents INTEGER DEFAULT 500,
      monthly_cap_cents INTEGER,
      monthly_spend_cents INTEGER DEFAULT 0,
      stripe_customer_id TEXT UNIQUE,
      stripe_default_payment_method_id TEXT,
      has_payment_method INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      description TEXT NOT NULL,
      balance_after_cents INTEGER NOT NULL,
      stripe_payment_intent_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE TABLE IF NOT EXISTS provider_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      key_hint TEXT,
      nickname TEXT,
      is_active INTEGER DEFAULT 1,
      is_default INTEGER DEFAULT 0,
      last_used_at TEXT,
      last_verified_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, provider)
    );
    
    CREATE TABLE IF NOT EXISTS memory_keys (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT,
      retention_days INTEGER DEFAULT 90,
      is_active INTEGER DEFAULT 1,
      tokens_stored INTEGER DEFAULT 0,
      tokens_retrieved INTEGER DEFAULT 0,
      request_count INTEGER DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  
  console.log('[DB] In-memory database initialized with schema');
}

// Export schema for convenience
export { schema };
