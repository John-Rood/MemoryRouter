-- MemoryRouter D1 Schema
-- Intermediate state for fast cold-start reads

-- Memory chunks (vectors + content)
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_key TEXT NOT NULL,
  vault_type TEXT NOT NULL DEFAULT 'core',
  session_id TEXT,
  content TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  embedding BLOB NOT NULL,
  timestamp REAL NOT NULL,
  token_count INTEGER DEFAULT 0,
  model TEXT,
  content_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_chunks_memory_key ON chunks(memory_key);
CREATE INDEX IF NOT EXISTS idx_chunks_memory_key_vault ON chunks(memory_key, vault_type);
CREATE INDEX IF NOT EXISTS idx_chunks_timestamp ON chunks(memory_key, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_chunks_content_hash ON chunks(content_hash);

-- Pending buffers (not yet chunked content)
CREATE TABLE IF NOT EXISTS pending_buffers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_key TEXT NOT NULL,
  vault_type TEXT NOT NULL DEFAULT 'core',
  session_id TEXT DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  token_count INTEGER NOT NULL DEFAULT 0,
  last_updated REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_memory_key ON pending_buffers(memory_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_unique ON pending_buffers(memory_key, vault_type, session_id);
