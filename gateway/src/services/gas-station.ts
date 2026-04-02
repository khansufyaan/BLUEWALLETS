/**
 * Gas Station Service — auto-funds customer wallets from an HSM-protected treasury.
 *
 * Polls all active wallets and sends native token from the treasury when
 * a wallet's balance drops below the configured threshold.
 *
 * Uses the same tx-building pipeline as withdrawals:
 *   buildUnsignedTx → signerClient.sign → assembleSignedTx → broadcast
 */

import { v4 as uuidv4 } from 'uuid';
import { SignerClient } from './signer-client';
import { buildUnsignedTx, assembleSignedTx } from './evm/evm-tx-builder';
import { broadcast } from './evm/evm-broadcaster';
import { getProvider, resolveChain } from './evm/evm-provider';
import { gasStore } from '../stores/gas-store';
import { getEnabledChains } from '../config';
import { logger } from '../utils/logger';

export class GasStation {
  private intervalId: NodeJS.Timeout | null = null;

  constructor(private signerClient: SignerClient) {}

  start(): void {
    const config = gasStore.getConfig();
    if (!config.enabled) {
      logger.info('Gas station not configured — skipping');
      return;
    }

    logger.info('Gas station started', {
      treasury: config.treasuryAddress,
      threshold: config.thresholdWei,
      topUp: config.topUpWei,
      pollInterval: config.pollIntervalMs,
    });

    this.intervalId = setInterval(() => {
      this.runFundingCycle().catch(err => {
        logger.error('Gas station cycle error', { error: err.message });
      });
    }, config.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Restart with new config */
  restart(): void {
    this.stop();
    this.start();
  }

  private async runFundingCycle(): Promise<void> {
    const config = gasStore.getConfig();
    if (!config.enabled || !config.treasuryWalletId) return;

    const enabledChains = getEnabledChains();
    const wallets = await this.signerClient.listWallets();

    for (const wallet of wallets) {
      if (wallet.status !== 'active') continue;
      if (wallet.id === config.treasuryWalletId) continue; // don't fund yourself

      const chainKey = wallet.chain.toLowerCase();
      if (!enabledChains[chainKey]) continue;

      try {
        const chain = resolveChain(wallet.chain);
        const provider = getProvider(chain);
        const balance = await provider.getBalance(wallet.address);
        const threshold = BigInt(config.thresholdWei);

        if (balance >= threshold) continue;

        // Check daily cap
        const topUpAmount = BigInt(config.topUpWei);
        if (!gasStore.isUnderDailyCap(topUpAmount)) {
          logger.warn('Gas station daily cap reached', {
            dailySpend: gasStore.getDailySpend(),
            cap: config.maxDailyWei,
          });
          return; // Stop all funding for today
        }

        logger.info('Gas funding needed', {
          walletId: wallet.id,
          address: wallet.address,
          chain,
          balance: balance.toString(),
          threshold: threshold.toString(),
        });

        // Build unsigned tx from treasury to customer wallet
        const { unsignedTx, hashToSign } = await buildUnsignedTx(
          chain,
          config.treasuryAddress,
          wallet.address,
          topUpAmount,
        );

        // Sign with treasury wallet's HSM key
        const hashHex = hashToSign.startsWith('0x') ? hashToSign.slice(2) : hashToSign;
        const signResult = await this.signerClient.sign(config.treasuryWalletId, hashHex);

        // Assemble and broadcast
        const { rawTransaction, txHash } = assembleSignedTx(
          unsignedTx,
          signResult.signatureHex,
          signResult.publicKeyHex,
          chain,
        );

        const broadcastResult = await broadcast(chain, rawTransaction);

        // Record funding
        gasStore.addFunding({
          id:        uuidv4(),
          chain,
          walletId:  wallet.id,
          address:   wallet.address,
          amount:    topUpAmount.toString(),
          txHash:    broadcastResult.txHash,
          status:    'pending',
          timestamp: new Date().toISOString(),
        });

        logger.info('Gas funding broadcast', {
          walletId: wallet.id,
          txHash: broadcastResult.txHash,
          amount: topUpAmount.toString(),
        });
      } catch (error) {
        logger.error('Gas funding failed for wallet', {
          walletId: wallet.id,
          error: error instanceof Error ? error.message : error,
        });
      }
    }
  }
}
