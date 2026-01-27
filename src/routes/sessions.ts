/**
 * Session Management Routes
 * 
 * GET    /v1/sessions                    — List all sessions for this memory key
 * GET    /v1/sessions/:session_id        — Get session info
 * DELETE /v1/sessions/:session_id        — Delete session and all its memory
 * GET    /v1/sessions/:session_id/search — Search session memory
 * 
 * Reference: memoryrouter-product-spec.md Section 5.6
 */

import { Hono } from 'hono';
import { getUserContext } from '../middleware/auth';
import { listSessions, getSession, deleteSession, searchSession } from '../services/vectorvault';

const sessions = new Hono();

/**
 * GET /v1/sessions
 * List all sessions for the authenticated memory key
 */
sessions.get('/', async (c) => {
  const userContext = getUserContext(c);
  const memoryKey = userContext.memoryKey.key;
  
  const allSessions = await listSessions(memoryKey);
  
  return c.json({
    sessions: allSessions.map(s => ({
      session_id: s.sessionId,
      memory_key: s.memoryKey,
      created_at: s.createdAt.toISOString(),
      last_used_at: s.lastUsedAt.toISOString(),
      chunk_count: s.chunkCount,
      token_count: s.tokenCount,
    })),
    total: allSessions.length,
    memory_key: memoryKey,
  });
});

/**
 * GET /v1/sessions/:session_id
 * Get info for a specific session
 */
sessions.get('/:session_id', async (c) => {
  const userContext = getUserContext(c);
  const memoryKey = userContext.memoryKey.key;
  const sessionId = c.req.param('session_id');
  
  const session = await getSession(memoryKey, sessionId);
  
  if (!session) {
    return c.json({
      error: {
        type: 'not_found',
        message: `Session '${sessionId}' not found for this memory key.`,
        code: 'SESSION_NOT_FOUND',
      },
    }, 404);
  }
  
  return c.json({
    session_id: session.sessionId,
    memory_key: session.memoryKey,
    created_at: session.createdAt.toISOString(),
    last_used_at: session.lastUsedAt.toISOString(),
    chunk_count: session.chunkCount,
    token_count: session.tokenCount,
  });
});

/**
 * DELETE /v1/sessions/:session_id
 * Delete a session and all its memory
 */
sessions.delete('/:session_id', async (c) => {
  const userContext = getUserContext(c);
  const memoryKey = userContext.memoryKey.key;
  const sessionId = c.req.param('session_id');
  
  const deleted = await deleteSession(memoryKey, sessionId);
  
  if (!deleted) {
    return c.json({
      error: {
        type: 'not_found',
        message: `Session '${sessionId}' not found for this memory key.`,
        code: 'SESSION_NOT_FOUND',
      },
    }, 404);
  }
  
  return c.json({
    deleted: true,
    session_id: sessionId,
    memory_key: memoryKey,
  });
});

/**
 * GET /v1/sessions/:session_id/search
 * Search a session's memory (for debugging/inspection)
 */
sessions.get('/:session_id/search', async (c) => {
  const userContext = getUserContext(c);
  const memoryKey = userContext.memoryKey.key;
  const sessionId = c.req.param('session_id');
  const query = c.req.query('q') ?? '';
  const limit = parseInt(c.req.query('limit') ?? '10', 10);
  
  const chunks = await searchSession(memoryKey, sessionId, query, limit);
  
  return c.json({
    session_id: sessionId,
    memory_key: memoryKey,
    query: query || '(recent)',
    results: chunks.map(chunk => ({
      id: chunk.id,
      role: chunk.role,
      content: chunk.content,
      timestamp: chunk.timestamp.toISOString(),
      token_count: chunk.tokenCount,
      similarity: chunk.similarity,
      window: chunk.window,
      model: chunk.model,
    })),
    total: chunks.length,
  });
});

export default sessions;
