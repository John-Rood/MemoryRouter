/**
 * Durable Object Routing Service
 * 
 * Handles DO naming conventions and vault resolution logic.
 * 
 * NAMING CONVENTION:
 *   Core vault:      "mk_{key}:core"
 *   Session vault:   "mk_{key}:s:{session_id}"
 *   Ephemeral vault: "mk_{key}:e:{conversation_id}"
 */

import type { VaultType, VaultReference } from '../types/do';

/**
 * Get deterministic DurableObjectId from naming convention.
 * 
 * @param namespace - The VAULT_DO DurableObjectNamespace binding
 * @param memoryKey - The mk_xxx memory key
 * @param type - Vault type (core, session, ephemeral)
 * @param sessionOrConvId - Session ID or conversation ID (required for session/ephemeral)
 */
export function getVaultDOId(
  namespace: DurableObjectNamespace,
  memoryKey: string,
  type: VaultType,
  sessionOrConvId?: string
): DurableObjectId {
  let name: string;

  switch (type) {
    case 'core':
      name = `${memoryKey}:core`;
      break;
    case 'session':
      if (!sessionOrConvId) throw new Error('session_id required for session vault');
      name = `${memoryKey}:s:${sessionOrConvId}`;
      break;
    case 'ephemeral':
      if (!sessionOrConvId) throw new Error('conversation_id required for ephemeral vault');
      name = `${memoryKey}:e:${sessionOrConvId}`;
      break;
  }

  return namespace.idFromName(name);
}

/**
 * Determine which DOs to query for a given request.
 * 
 * STRATEGY:
 *   - Always query core vault (base knowledge + long-term memory)
 *   - If session_id provided, also query session vault (50/50 split)
 *   - Ephemeral vault only if explicitly requested
 * 
 * @returns List of vault references with allocation fractions
 */
export function resolveVaultsForQuery(
  namespace: DurableObjectNamespace,
  memoryKey: string,
  sessionId?: string,
  _conversationId?: string
): VaultReference[] {
  // Single vault per request — session OR core, not both
  if (sessionId) {
    const sessionDoId = getVaultDOId(namespace, memoryKey, 'session', sessionId);
    return [{
      stub: namespace.get(sessionDoId),
      type: 'session',
      allocation: 1.0,
    }];
  }

  const coreId = getVaultDOId(namespace, memoryKey, 'core');
  return [{
    stub: namespace.get(coreId),
    type: 'core',
    allocation: 1.0,
  }];
}

/**
 * Determine which DO to store memories in.
 * 
 * STRATEGY:
 *   - If session_id → store to session vault
 *   - If no session_id → store to core vault
 *   - Ephemeral messages (memory: false) → not stored at all
 */
export function resolveVaultForStore(
  namespace: DurableObjectNamespace,
  memoryKey: string,
  sessionId?: string
): DurableObjectStub {
  if (sessionId) {
    const id = getVaultDOId(namespace, memoryKey, 'session', sessionId);
    return namespace.get(id);
  }

  const id = getVaultDOId(namespace, memoryKey, 'core');
  return namespace.get(id);
}

// No artificial vector limits — index grows dynamically within DO memory budget
