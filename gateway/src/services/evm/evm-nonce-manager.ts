/**
 * EVM Nonce Manager — tracks pending nonces per address per chain.
 *
 * Nonce management is the #1 source of stuck transactions in EVM systems.
 * This manager:
 *   - Queries on-chain nonce on first use
 *   - Increments locally for each pending tx
 *   - Resets if a tx confirms or the nonce goes stale
 */

import { getProvider } from './evm-provider';
import { logger } from '../../utils/logger';

interface NonceState {
  current: number;
  lastSynced: number; // timestamp
}

// chain -> address -> NonceState
const nonceMap = new Map<string, Map<string, NonceState>>();

function getMap(chain: string): Map<string, NonceState> {
  let m = nonceMap.get(chain);
  if (!m) {
    m = new Map();
    nonceMap.set(chain, m);
  }
  return m;
}

/**
 * Get the next nonce for an address. Queries on-chain if:
 *   - First time seeing this address
 *   - Last sync was more than 60s ago
 */
export async function getNextNonce(chain: string, address: string): Promise<number> {
  const map = getMap(chain);
  const state = map.get(address);
  const now = Date.now();

  // Sync from chain if stale or first use
  if (!state || now - state.lastSynced > 60_000) {
    const provider = getProvider(chain);
    const onChainNonce = await provider.getTransactionCount(address, 'pending');

    const localNonce = state?.current ?? 0;
    const nonce = Math.max(onChainNonce, localNonce);

    map.set(address, { current: nonce, lastSynced: now });
    logger.debug('Nonce synced', { chain, address, onChainNonce, localNonce, using: nonce });
    return nonce;
  }

  return state.current;
}

/**
 * Increment nonce after a successful broadcast.
 */
export function incrementNonce(chain: string, address: string): void {
  const map = getMap(chain);
  const state = map.get(address);
  if (state) {
    state.current++;
    logger.debug('Nonce incremented', { chain, address, nonce: state.current });
  }
}

/**
 * Reset nonce for an address (e.g., after detecting stuck tx).
 */
export function resetNonce(chain: string, address: string): void {
  const map = getMap(chain);
  map.delete(address);
  logger.info('Nonce reset', { chain, address });
}
