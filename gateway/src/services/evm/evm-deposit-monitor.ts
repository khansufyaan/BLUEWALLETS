/**
 * EVM Deposit Monitor — scans blocks for incoming transfers to our wallet addresses.
 *
 * Runs on a polling interval (default 15s). For each new block:
 *   1. Fetch full block with transactions
 *   2. Check if any tx.to matches a monitored wallet address
 *   3. Wait for N confirmations
 *   4. Push updated balance to the signer
 *   5. Fire webhook to bank callback URL
 */

import { ethers } from 'ethers';
import { getProvider, getChainConfig } from './evm-provider';
import { SignerClient, SignerWallet } from '../signer-client';
import { depositStore } from '../../stores/deposit-store';
import { config } from '../../config';
import { logger } from '../../utils/logger';

interface PendingDeposit {
  chain:       string;
  txHash:      string;
  blockNumber: number;
  to:          string;     // wallet address
  walletId:    string;
  value:       string;     // wei
  from:        string;     // sender address
}

export class EvmDepositMonitor {
  private signerClient: SignerClient;
  private lastBlock = new Map<string, number>(); // chain -> last processed block
  private monitoredAddresses = new Map<string, string>(); // lowercase address -> walletId
  private pendingDeposits: PendingDeposit[] = [];
  private intervalId: NodeJS.Timeout | null = null;

  constructor(signerClient: SignerClient) {
    this.signerClient = signerClient;
  }

  /**
   * Start monitoring all enabled EVM chains.
   */
  async start(chains: string[]): Promise<void> {
    // Load wallets from signer to build the monitored address set
    await this.refreshWalletList();

    // Initialize last block for each chain
    for (const chain of chains) {
      try {
        const provider = getProvider(chain);
        const blockNum = await provider.getBlockNumber();
        this.lastBlock.set(chain, blockNum);
        logger.info('Deposit monitor initialized', { chain, startBlock: blockNum });
      } catch (error) {
        logger.warn('Failed to initialize deposit monitor for chain', { chain, error });
      }
    }

    // Poll loop
    this.intervalId = setInterval(async () => {
      for (const chain of chains) {
        await this.scanChain(chain).catch(err => {
          logger.error('Deposit scan error', { chain, error: err.message });
        });
      }
      await this.checkPendingConfirmations().catch(err => {
        logger.error('Confirmation check error', { error: err.message });
      });
    }, config.depositPollInterval);

    logger.info('Deposit monitor started', {
      chains,
      pollInterval: config.depositPollInterval,
      addressCount: this.monitoredAddresses.size,
    });
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info('Deposit monitor stopped');
  }

  /**
   * Refresh the list of monitored addresses from the signer.
   */
  async refreshWalletList(): Promise<void> {
    try {
      const wallets = await this.signerClient.listWallets();
      this.monitoredAddresses.clear();
      for (const w of wallets) {
        if (w.address && w.status === 'active') {
          this.monitoredAddresses.set(w.address.toLowerCase(), w.id);
        }
      }
      logger.debug('Wallet list refreshed', { count: this.monitoredAddresses.size });
    } catch (error) {
      logger.warn('Failed to refresh wallet list from signer', { error });
    }
  }

  /**
   * Scan a chain for new blocks containing deposits to our addresses.
   */
  private async scanChain(chain: string): Promise<void> {
    const provider = getProvider(chain);
    const currentBlock = await provider.getBlockNumber();
    const lastProcessed = this.lastBlock.get(chain) ?? currentBlock;

    if (currentBlock <= lastProcessed) return;

    // Process blocks one at a time (don't skip any)
    for (let blockNum = lastProcessed + 1; blockNum <= currentBlock; blockNum++) {
      const block = await provider.getBlock(blockNum, true);
      if (!block || !block.prefetchedTransactions) continue;

      for (const tx of block.prefetchedTransactions) {
        if (!tx.to) continue; // contract creation

        const toAddr = tx.to.toLowerCase();
        const walletId = this.monitoredAddresses.get(toAddr);

        if (walletId && tx.value > 0n) {
          logger.info('Deposit detected', {
            chain,
            txHash: tx.hash,
            to: toAddr,
            walletId,
            value: tx.value.toString(),
            blockNumber: blockNum,
          });

          this.pendingDeposits.push({
            chain,
            txHash: tx.hash,
            blockNumber: blockNum,
            to: toAddr,
            walletId,
            value: tx.value.toString(),
            from: tx.from,
          });

          // Record in deposit store for ops dashboard
          const chainCfg = getChainConfig(chain);
          depositStore.add({
            txHash:        tx.hash,
            chain,
            walletId,
            address:       toAddr,
            from:          tx.from,
            value:         tx.value.toString(),
            blockNumber:   blockNum,
            confirmations: 0,
            required:      chainCfg.confirmations,
            status:        'pending',
            detectedAt:    new Date().toISOString(),
            webhookSent:   false,
          });
        }
      }
    }

    this.lastBlock.set(chain, currentBlock);
  }

  /**
   * Check pending deposits for sufficient confirmations.
   */
  private async checkPendingConfirmations(): Promise<void> {
    const confirmed: PendingDeposit[] = [];
    const stillPending: PendingDeposit[] = [];

    for (const deposit of this.pendingDeposits) {
      const provider = getProvider(deposit.chain);
      const chainCfg = getChainConfig(deposit.chain);
      const currentBlock = await provider.getBlockNumber();
      const confirmations = currentBlock - deposit.blockNumber + 1;

      if (confirmations >= chainCfg.confirmations) {
        confirmed.push(deposit);
      } else {
        stillPending.push(deposit);
      }
    }

    this.pendingDeposits = stillPending;

    // Process confirmed deposits
    for (const deposit of confirmed) {
      try {
        // Update balance in signer
        const provider = getProvider(deposit.chain);
        const balance = await provider.getBalance(deposit.to);
        await this.signerClient.updateBalance(deposit.walletId, balance.toString());

        // Update deposit store
        depositStore.update(deposit.txHash, {
          status:       'confirmed',
          confirmations: getChainConfig(deposit.chain).confirmations,
          confirmedAt:  new Date().toISOString(),
          webhookSent:  !!config.webhookUrl,
        });

        logger.info('Deposit confirmed and balance updated', {
          chain: deposit.chain,
          txHash: deposit.txHash,
          walletId: deposit.walletId,
          value: deposit.value,
          newBalance: balance.toString(),
        });

        // Fire webhook if configured
        if (config.webhookUrl) {
          await this.fireWebhook(deposit, balance.toString()).catch(err => {
            logger.warn('Webhook failed', { error: err.message, txHash: deposit.txHash });
          });
        }
      } catch (error) {
        // Track retry count to prevent infinite retry loops
        const retryCount = (deposit as any)._retryCount || 0;
        logger.error('Failed to process confirmed deposit', {
          error: error instanceof Error ? error.message : error,
          txHash: deposit.txHash,
          retryCount,
        });
        // Re-add to pending with bounded retries — max 5 attempts
        if (retryCount < 5) {
          (deposit as any)._retryCount = retryCount + 1;
          this.pendingDeposits.push(deposit);
        } else {
          logger.error('Deposit processing abandoned after 5 retries — moving to dead-letter', {
            txHash: deposit.txHash,
            walletId: deposit.walletId,
          });
          // In production: push to a dead-letter store for manual review
        }
      }
    }
  }

  private async fireWebhook(deposit: PendingDeposit, newBalance: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event:     'deposit.confirmed',
          chain:     deposit.chain,
          txHash:    deposit.txHash,
          walletId:  deposit.walletId,
          address:   deposit.to,
          from:      deposit.from,
          value:     deposit.value,
          balance:   newBalance,
          timestamp: new Date().toISOString(),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
