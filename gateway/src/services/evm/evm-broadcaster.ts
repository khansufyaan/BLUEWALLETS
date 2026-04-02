/**
 * EVM Broadcaster — sends signed transactions and polls for confirmation.
 */

import { ethers } from 'ethers';
import { getProvider, getChainConfig } from './evm-provider';
import { txStore } from '../../stores/tx-store';
import { logger } from '../../utils/logger';
import { withRetry } from '../../utils/retry';

export interface BroadcastResult {
  txHash:      string;
  status:      'pending' | 'confirmed' | 'failed';
  blockNumber?: number;
  gasUsed?:    string;
}

/**
 * Broadcast a signed raw transaction to the network.
 */
export async function broadcast(chain: string, rawTransaction: string): Promise<BroadcastResult> {
  const provider = getProvider(chain);

  const txResponse = await withRetry(
    () => provider.broadcastTransaction(rawTransaction),
    { maxRetries: 2, label: 'broadcast' },
  );

  logger.info('Transaction broadcast', {
    chain,
    txHash: txResponse.hash,
    nonce: txResponse.nonce,
  });

  return {
    txHash: txResponse.hash,
    status: 'pending',
  };
}

/**
 * Wait for a transaction to be confirmed.
 *
 * Polls until the tx is mined and has the required number of confirmations.
 * Returns null if the tx times out (default 5 minutes).
 */
export async function waitForConfirmation(
  chain: string,
  txHash: string,
  timeoutMs: number = 300_000,
): Promise<BroadcastResult> {
  const provider = getProvider(chain);
  const chainCfg = getChainConfig(chain);
  const requiredConfirmations = chainCfg.confirmations;

  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);

      if (receipt) {
        const currentBlock = await provider.getBlockNumber();
        const confirmations = currentBlock - receipt.blockNumber + 1;

        if (confirmations >= requiredConfirmations) {
          const confirmed: BroadcastResult = {
            txHash,
            status: receipt.status === 1 ? 'confirmed' : 'failed',
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
          };

          logger.info('Transaction confirmed', {
            chain,
            txHash,
            blockNumber: receipt.blockNumber,
            confirmations,
            gasUsed: receipt.gasUsed.toString(),
            status: confirmed.status,
          });

          return confirmed;
        }

        logger.debug('Waiting for confirmations', {
          chain, txHash, have: confirmations, need: requiredConfirmations,
        });
      }
    } catch (error) {
      logger.debug('Confirmation poll error', { chain, txHash, error });
    }

    // Wait one block time before polling again
    await new Promise(r => setTimeout(r, chainCfg.blockTime * 1000));
  }

  logger.warn('Transaction confirmation timed out', { chain, txHash, timeoutMs });
  return { txHash, status: 'pending' };
}
