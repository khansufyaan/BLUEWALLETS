import { KeyAlgorithm } from './index';

export type Chain =
  | 'bitcoin'
  | 'ethereum'
  | 'solana'
  | 'bsc'
  | 'polygon'
  | 'arbitrum'
  | 'tron'
  | 'avalanche'
  | 'litecoin';

export type NetworkType = 'mainnet' | 'testnet';

export interface ChainConfig {
  chain: Chain;
  name: string;
  algorithm: KeyAlgorithm;
  addressPrefix?: string;
  ticker: string;
  evmCompatible: boolean;
}

export const CHAIN_CONFIGS: Record<Chain, ChainConfig> = {
  bitcoin: {
    chain: 'bitcoin',
    name: 'Bitcoin',
    algorithm: 'EC_SECP256K1',
    ticker: 'BTC',
    evmCompatible: false,
  },
  ethereum: {
    chain: 'ethereum',
    name: 'Ethereum',
    algorithm: 'EC_SECP256K1',
    ticker: 'ETH',
    evmCompatible: true,
  },
  solana: {
    chain: 'solana',
    name: 'Solana',
    algorithm: 'ED25519',
    ticker: 'SOL',
    evmCompatible: false,
  },
  bsc: {
    chain: 'bsc',
    name: 'BNB Smart Chain',
    algorithm: 'EC_SECP256K1',
    ticker: 'BNB',
    evmCompatible: true,
  },
  polygon: {
    chain: 'polygon',
    name: 'Polygon',
    algorithm: 'EC_SECP256K1',
    ticker: 'MATIC',
    evmCompatible: true,
  },
  arbitrum: {
    chain: 'arbitrum',
    name: 'Arbitrum',
    algorithm: 'EC_SECP256K1',
    ticker: 'ETH',
    evmCompatible: true,
  },
  tron: {
    chain: 'tron',
    name: 'Tron',
    algorithm: 'EC_SECP256K1',
    ticker: 'TRX',
    evmCompatible: false,
  },
  avalanche: {
    chain: 'avalanche',
    name: 'Avalanche',
    algorithm: 'EC_SECP256K1',
    ticker: 'AVAX',
    evmCompatible: true,
  },
  litecoin: {
    chain: 'litecoin',
    name: 'Litecoin',
    algorithm: 'EC_SECP256K1',
    ticker: 'LTC',
    evmCompatible: false,
  },
};

export const SUPPORTED_CHAINS = Object.keys(CHAIN_CONFIGS) as Chain[];
