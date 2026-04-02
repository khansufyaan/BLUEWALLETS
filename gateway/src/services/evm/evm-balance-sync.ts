/**
 * EVM Balance Sync — queries on-chain balances and pushes to the signer.
 *
 * Used on-demand (e.g., when the gateway API is asked for a balance)
 * and also by the deposit monitor after detecting confirmed deposits.
 */

import { getProvider } from './evm-provider';
import { SignerClient } from '../signer-client';
import { logger } from '../../utils/logger';

export class EvmBalanceSync {
  constructor(private signerClient: SignerClient) {}

  /**
   * Query on-chain balance for a wallet and push to signer.
   */
  async syncBalance(chain: string, walletId: string, address: string): Promise<string> {
    const provider = getProvider(chain);
    const balance = await provider.getBalance(address);
    const balanceStr = balance.toString();

    await this.signerClient.updateBalance(walletId, balanceStr);

    logger.debug('Balance synced', { chain, walletId, address, balance: balanceStr });
    return balanceStr;
  }

  /**
   * Query on-chain balance without pushing to signer (read-only).
   */
  async getBalance(chain: string, address: string): Promise<string> {
    const provider = getProvider(chain);
    const balance = await provider.getBalance(address);
    return balance.toString();
  }
}
