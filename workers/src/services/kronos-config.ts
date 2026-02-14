/**
 * KRONOS Configuration Service
 * 
 * Single source of truth for KRONOS time windows.
 * No more hardcoded values scattered across routes.
 * 
 * Used by all provider routes: chat.ts, anthropic.ts, google.ts
 */

// ==================== TYPES ====================

/**
 * KRONOS time window configuration.
 * Controls how memory is balanced across recency tiers.
 */
export interface KronosConfig {
  /** Hot window: last N hours (most recent, highest priority) */
  hotWindowHours: number;
  /** Working window: last N days (recent context) */
  workingWindowDays: number;
  /** Long-term window: last N days (historical knowledge) */
  longtermWindowDays: number;
}

// ==================== DEFAULTS ====================

/**
 * Default KRONOS configuration
 */
export const DEFAULT_KRONOS_CONFIG: KronosConfig = {
  hotWindowHours: 4,
  workingWindowDays: 3,
  longtermWindowDays: 90,
};

// ==================== ENVIRONMENT PARSING ====================

/**
 * Build KRONOS config from environment variables.
 * Falls back to defaults for any missing value.
 * 
 * Environment variables:
 * - HOT_WINDOW_HOURS: number (default: 4)
 * - WORKING_WINDOW_DAYS: number (default: 3)
 * - LONGTERM_WINDOW_DAYS: number (default: 90)
 */
export function getKronosConfig(env: {
  HOT_WINDOW_HOURS?: string;
  WORKING_WINDOW_DAYS?: string;
  LONGTERM_WINDOW_DAYS?: string;
}): KronosConfig {
  return {
    hotWindowHours: parseIntOrDefault(env.HOT_WINDOW_HOURS, DEFAULT_KRONOS_CONFIG.hotWindowHours),
    workingWindowDays: parseIntOrDefault(env.WORKING_WINDOW_DAYS, DEFAULT_KRONOS_CONFIG.workingWindowDays),
    longtermWindowDays: parseIntOrDefault(env.LONGTERM_WINDOW_DAYS, DEFAULT_KRONOS_CONFIG.longtermWindowDays),
  };
}

// ==================== WINDOW UTILITIES ====================

/**
 * Get timestamp cutoffs for each window
 */
export function getWindowCutoffs(config: KronosConfig): {
  hotCutoff: number;
  workingCutoff: number;
  longtermCutoff: number;
} {
  const now = Date.now();
  return {
    hotCutoff: now - config.hotWindowHours * 60 * 60 * 1000,
    workingCutoff: now - config.workingWindowDays * 24 * 60 * 60 * 1000,
    longtermCutoff: now - config.longtermWindowDays * 24 * 60 * 60 * 1000,
  };
}

/**
 * Classify a timestamp into a KRONOS window
 */
export function classifyWindow(
  timestamp: number,
  config: KronosConfig
): 'hot' | 'working' | 'longterm' | 'archive' {
  const cutoffs = getWindowCutoffs(config);
  
  if (timestamp > cutoffs.hotCutoff) return 'hot';
  if (timestamp > cutoffs.workingCutoff) return 'working';
  if (timestamp > cutoffs.longtermCutoff) return 'longterm';
  return 'archive';
}

/**
 * Get the window age in human-readable format
 */
export function getWindowDescription(window: 'hot' | 'working' | 'longterm' | 'archive', config: KronosConfig): string {
  switch (window) {
    case 'hot':
      return `last ${config.hotWindowHours} hours`;
    case 'working':
      return `last ${config.workingWindowDays} days`;
    case 'longterm':
      return `last ${config.longtermWindowDays} days`;
    case 'archive':
      return `older than ${config.longtermWindowDays} days`;
  }
}

// ==================== INTERNAL HELPERS ====================

function parseIntOrDefault(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}
