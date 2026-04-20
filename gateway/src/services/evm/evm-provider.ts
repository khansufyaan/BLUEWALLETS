/**
 * EVM Provider Manager — manages ethers.js JsonRpcProvider instances per chain.
 */

import { ethers } from 'ethers';
import { EVM_CHAINS, ChainConfig, getEnabledChains } from '../../config';
import { logger } from '../../utils/logger';

const providers = new Map<string, ethers.JsonRpcProvider>();
const unreachableChains = new Set<string>();

export function getProvider(chain: string): ethers.JsonRpcProvider {
  const existing = providers.get(chain);
  if (existing) return existing;

  const cfg = EVM_CHAINS[chain];
  if (!cfg || !cfg.rpcUrl) {
    throw new Error(`No RPC URL configured for chain: ${chain}`);
  }

  // Use staticNetwork to prevent ethers from entering an infinite "detect network"
  // retry loop when the RPC endpoint is unreachable. Without this, a misconfigured
  // or blocked RPC produces endless "JsonRpcProvider failed to detect network" logs.
  const network = ethers.Network.from({
    chainId: cfg.chainId,
    name: cfg.name,
  });

  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl, network, {
    staticNetwork: network,
    // Cap background polling — prevents the provider from hammering a dead RPC
    pollingInterval: 30_000,
  });

  providers.set(chain, provider);
  logger.info('EVM provider created', { chain, chainId: cfg.chainId });
  return provider;
}

/**
 * Check RPC reachability with a short timeout. Mark chains as unreachable
 * so downstream services (deposit monitor, balance sync) can skip them
 * instead of retrying forever.
 */
export async function probeRpc(chain: string, timeoutMs = 5000): Promise<{ ok: boolean; blockNumber?: number; error?: string }> {
  try {
    const provider = getProvider(chain);
    const blockNumber = await Promise.race([
      provider.getBlockNumber(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`RPC probe timeout after ${timeoutMs}ms`)), timeoutMs)),
    ]);
    unreachableChains.delete(chain);
    return { ok: true, blockNumber };
  } catch (err) {
    unreachableChains.add(chain);
    const msg = err instanceof Error ? err.message : 'unknown';
    return { ok: false, error: msg };
  }
}

export function isChainReachable(chain: string): boolean {
  return !unreachableChains.has(chain);
}

/** Get chains that are both enabled (RPC URL configured) AND reachable. */
export function getReachableChains(): string[] {
  return Object.keys(getEnabledChains()).filter(c => !unreachableChains.has(c));
}

export function getChainConfig(chain: string): ChainConfig {
  const cfg = EVM_CHAINS[chain];
  if (!cfg) throw new Error(`Unknown chain: ${chain}`);
  return cfg;
}

/** Map from Blue Wallets chain name to our EVM config key */
export function resolveChain(blueChainName: string): string {
  const map: Record<string, string> = {
    ethereum: 'ethereum',
    bsc:      'bsc',
    polygon:  'polygon',
    arbitrum: 'arbitrum',
    avalanche: 'avalanche',
  };
  const resolved = map[blueChainName.toLowerCase()];
  if (!resolved) throw new Error(`Unsupported EVM chain: ${blueChainName}`);
  return resolved;
}
