/**
 * TypeScript types for Durable Object communication
 * Defines the protocol between Worker and VaultDurableObject
 */

// ==================== Vault Types ====================

/** The three vault types in the memory stack */
export type VaultType = 'core' | 'session' | 'ephemeral';

/** Reference to a vault DO with routing metadata */
export interface VaultReference {
  stub: DurableObjectStub;
  type: VaultType;
  /** Fraction of total results allocated to this vault (0.0 - 1.0) */
  allocation: number;
}

// ==================== Search Types ====================

/** Request sent to VaultDO /search endpoint */
export interface DOSearchRequest {
  /** Query embedding as number array (Float32Array serialized) */
  query: number[];
  /** Number of results to return */
  k: number;
  /** Only include vectors after this timestamp */
  minTimestamp?: number;
  /** Only include vectors before this timestamp */
  maxTimestamp?: number;
}

/** Single search result returned from VaultDO */
export interface DOSearchResult {
  id: number;
  score: number;
  content: string;
  role: string;
  timestamp: number;
  model?: string;
}

/** Response from VaultDO /search endpoint */
export interface DOSearchResponse {
  results: DOSearchResult[];
  searchTimeMs: number;
  hotVectors: number;
  totalVectors: number;
}

// ==================== Store Types ====================

/** Request sent to VaultDO /store endpoint */
export interface DOStoreRequest {
  /** Embedding as number array (Float32Array serialized) */
  embedding: number[];
  /** Text content of the memory */
  content: string;
  /** Role: user or assistant */
  role: string;
  /** Model that generated/processed this content */
  model?: string;
  /** Request ID for grouping related memories */
  requestId?: string;
}

/** Response from VaultDO /store endpoint */
export interface DOStoreResponse {
  id: number;
  stored: boolean;
  /** If not stored, reason (e.g. 'duplicate') */
  reason?: string;
  tokenCount?: number;
  totalVectors?: number;
}

// ==================== Delete Types ====================

/** Request sent to VaultDO /delete endpoint */
export interface DODeleteRequest {
  /** Specific vector IDs to delete */
  ids?: number[];
  /** Delete all vectors older than this timestamp */
  olderThan?: number;
}

/** Response from VaultDO /delete endpoint */
export interface DODeleteResponse {
  deleted: number;
  totalVectors: number;
}

// ==================== Stats Types ====================

/** Response from VaultDO /stats endpoint */
export interface DOStatsResponse {
  totalVectors: number;
  hotVectors: number;
  dims: number;
  maxInMemory: number;
  oldestItem: number | null;
  newestItem: number | null;
  totalTokens: number;
  createdAt: number;
  lastAccess: number;
}

// ==================== Export Types ====================

/** Single exported vector with content */
export interface DOExportItem {
  id: number;
  timestamp: number;
  content: string;
  role: string;
  model: string | null;
  contentHash: string;
  tokenCount: number;
  /** Base64-encoded embedding */
  embedding: string;
}

/** Response from VaultDO /export endpoint */
export interface DOExportResponse {
  vectorCount: number;
  dims: number;
  data: DOExportItem[];
}

// ==================== KRONOS Types ====================

/** KRONOS time window configuration */
export interface KronosConfig {
  hotWindowHours: number;
  workingWindowDays: number;
  longtermWindowDays: number;
}

/** Default KRONOS configuration */
export const DEFAULT_KRONOS_CONFIG: KronosConfig = {
  hotWindowHours: 4,
  workingWindowDays: 3,
  longtermWindowDays: 90,
};

/** A single time window in a KRONOS search plan */
export interface WindowSpec {
  name: 'hot' | 'working' | 'longterm';
  minTimestamp: number;
  maxTimestamp: number;
  /** Number of results to fetch from this window */
  allocation: number;
}

/** A vault entry in a KRONOS search plan */
export interface KronosPlanVault {
  stub: DurableObjectStub;
  type: string;
  windows: WindowSpec[];
}

/** Complete KRONOS search plan */
export interface KronosSearchPlan {
  vaults: KronosPlanVault[];
  totalLimit: number;
}

/** A memory chunk with source tracking */
export interface MemoryChunk {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  score: number;
  window: 'hot' | 'working' | 'longterm';
  /** Which vault this came from (core, session, ephemeral) */
  source?: string;
}

/** Result of a KRONOS retrieval across vaults */
export interface MemoryRetrievalResult {
  chunks: MemoryChunk[];
  tokenCount: number;
  windowBreakdown: {
    hot: number;
    working: number;
    longterm: number;
  };
}

// ==================== Vault State ====================

/** Internal vault state persisted in SQLite meta table */
export interface VaultState {
  vectorCount: number;
  dims: number;
  maxInMemory: number;
  lastAccess: number;
  createdAt: number;
}
