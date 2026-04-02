/**
 * EVM Gas Estimator — fee estimation for EIP-1559 and legacy chains.
 */

import { ethers } from 'ethers';
import { getProvider, getChainConfig } from './evm-provider';
import { logger } from '../../utils/logger';

export interface GasEstimate {
  gasLimit:            bigint;
  // EIP-1559
  maxFeePerGas?:       bigint;
  maxPriorityFeePerGas?: bigint;
  // Legacy
  gasPrice?:           bigint;
}

const GAS_LIMIT_BUFFER = 120n; // 20% buffer (multiply by 120, divide by 100)

/**
 * Estimate gas for a transaction.
 */
export async function estimateGas(
  chain: string,
  from: string,
  to: string,
  value: bigint,
): Promise<GasEstimate> {
  const provider = getProvider(chain);
  const chainCfg = getChainConfig(chain);

  // Estimate gas limit
  let gasLimit: bigint;
  try {
    const estimated = await provider.estimateGas({ from, to, value });
    gasLimit = (estimated * GAS_LIMIT_BUFFER) / 100n;
  } catch {
    // Default to 21000 for simple ETH transfers
    gasLimit = 21000n;
  }

  if (chainCfg.eip1559) {
    // EIP-1559 fee estimation
    const feeData = await provider.getFeeData();
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? ethers.parseUnits('1.5', 'gwei');
    const maxFeePerGas = feeData.maxFeePerGas ?? ethers.parseUnits('30', 'gwei');

    logger.debug('EIP-1559 gas estimate', {
      chain,
      gasLimit: gasLimit.toString(),
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    });

    return { gasLimit, maxFeePerGas, maxPriorityFeePerGas };
  } else {
    // Legacy gas price
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? ethers.parseUnits('5', 'gwei');

    logger.debug('Legacy gas estimate', {
      chain,
      gasLimit: gasLimit.toString(),
      gasPrice: gasPrice.toString(),
    });

    return { gasLimit, gasPrice };
  }
}
