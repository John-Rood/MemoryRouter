// Database module - uses in-memory mock for now
// TODO: Wire up D1 through Workers API

import * as schema from './schema';

// Export schema for convenience
export { schema };

// Placeholder type - will be replaced when D1 is wired up
export type DB = unknown;

// Placeholder function - returns null, auth will fall back to mock store
export function getDb(_d1Binding?: unknown): null {
  console.log('[DB] Using mock auth store - D1 not yet connected');
  return null;
}
