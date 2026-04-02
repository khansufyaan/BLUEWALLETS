/**
 * EVM Provider Manager — manages ethers.js JsonRpcProvider instances per chain.
 */

import { ethers } from 'ethers';
import { EVM_CHAINS, ChainConfig, getEnabledChains } from '../../config';
import { logger } from '../../utils/logger';

const providers = new Map<string, ethers.JsonRpcProvider>();

export function getProvider(chain: string): ethers.JsonRpcProvider {
  const existing = providers.get(chain);
  if (existing) return existing;

  const cfg = EVM_CHAINS[chain];
  if (!cfg || !cfg.rpcUrl) {
    throw new Error(`No RPC URL configured for chain: ${chain}`);
  }

  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl, {
    chainId: cfg.chainId,
    name: cfg.name,
  });

  providers.set(chain, provider);
  logger.info('EVM provider created', { chain, chainId: cfg.chainId });
  return provider;
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
