/**
 * Gateway configuration — all from environment variables.
 */

export interface ChainConfig {
  chainId:   number;
  rpcUrl:    string;
  ticker:    string;
  name:      string;
  eip1559:   boolean;
  blockTime: number;      // seconds
  confirmations: number;  // blocks to wait before considering tx final
}

// EVM chain registry — extend by adding env vars
export const EVM_CHAINS: Record<string, ChainConfig> = {
  ethereum: {
    chainId:       parseInt(process.env.ETH_CHAIN_ID || '11155111'),  // Sepolia by default
    rpcUrl:        process.env.ETH_RPC_URL || '',  // MUST be configured — no default
    ticker:        'ETH',
    name:          'Ethereum',
    eip1559:       true,
    blockTime:     12,
    confirmations: parseInt(process.env.ETH_CONFIRMATIONS || '12'),
  },
  bsc: {
    chainId:       parseInt(process.env.BSC_CHAIN_ID || '97'),  // BSC testnet
    rpcUrl:        process.env.BSC_RPC_URL || '',
    ticker:        'BNB',
    name:          'BNB Chain',
    eip1559:       false,
    blockTime:     3,
    confirmations: parseInt(process.env.BSC_CONFIRMATIONS || '15'),
  },
  polygon: {
    chainId:       parseInt(process.env.POLYGON_CHAIN_ID || '80001'),
    rpcUrl:        process.env.POLYGON_RPC_URL || '',
    ticker:        'POL',
    name:          'Polygon',
    eip1559:       true,
    blockTime:     2,
    confirmations: parseInt(process.env.POLYGON_CONFIRMATIONS || '30'),
  },
  arbitrum: {
    chainId:       parseInt(process.env.ARB_CHAIN_ID || '421614'),
    rpcUrl:        process.env.ARB_RPC_URL || '',
    ticker:        'ETH',
    name:          'Arbitrum',
    eip1559:       true,
    blockTime:     1,
    confirmations: parseInt(process.env.ARB_CONFIRMATIONS || '20'),
  },
  avalanche: {
    chainId:       parseInt(process.env.AVAX_CHAIN_ID || '43113'),
    rpcUrl:        process.env.AVAX_RPC_URL || '',
    ticker:        'AVAX',
    name:          'Avalanche',
    eip1559:       true,
    blockTime:     2,
    confirmations: parseInt(process.env.AVAX_CONFIRMATIONS || '12'),
  },
};

export const config = {
  port:         parseInt(process.env.PORT || '3100'),
  signerUrl:    process.env.SIGNER_URL || 'http://localhost:3200',
  internalKey:  process.env.INTERNAL_AUTH_KEY || '',
  logLevel:     process.env.LOG_LEVEL || 'info',

  // Deposit monitoring
  depositPollInterval: parseInt(process.env.DEPOSIT_POLL_MS || '15000'),  // 15s

  // Webhook for bank notifications
  webhookUrl:   process.env.WEBHOOK_URL || '',
};

/** Get enabled EVM chains (those with a configured RPC URL) */
export function getEnabledChains(): Record<string, ChainConfig> {
  const enabled: Record<string, ChainConfig> = {};
  for (const [key, chain] of Object.entries(EVM_CHAINS)) {
    if (chain.rpcUrl) {
      enabled[key] = chain;
    }
  }
  return enabled;
}
