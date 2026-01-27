/**
 * MSW Mock Server for MemoryRouter Tests
 * 
 * Intercepts HTTP requests to provider APIs and returns controlled responses.
 * This enables testing without hitting real APIs.
 */

import { setupServer } from 'msw/node';
import { handlers } from './handlers';

// Create MSW server with all handlers
export const server = setupServer(...handlers);

// Export for custom handler overrides in tests
export { handlers };
