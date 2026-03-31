import { KeyAlgorithm } from './index';
import { PolicyEvaluation } from './policy';
import { Chain } from './chain';

export type WalletStatus = 'active' | 'frozen' | 'archived';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'rejected';

export interface Wallet {
  id: string;
  vaultId: string;
  name: string;
  keyId: string;
  chain: Chain;
  algorithm: KeyAlgorithm;
  address: string;            // blockchain address (derived from public key)
  publicKey: string;          // hex — not sensitive, safe to store plaintext
  wrappedPrivateKey?: string; // "ivHex:ciphertextHex" — AES-256-CBC-PAD wrapped by blue:wrap:v1
                              // Only unwrapped inside HSM session during C_Sign, never in app memory
  balance: bigint;
  currency: string;
  status: WalletStatus;
  metadata: Record<string, string>;
  policyIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Transaction {
  id: string;
  fromWalletId: string;
  toWalletId: string;
  amount: bigint;
  currency: string;
  status: TransactionStatus;
  signature: string; // hex
  signedPayload: string; // hex
  policyEvaluations: PolicyEvaluation[];
  failureReason?: string;
  memo?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface CreateWalletRequest {
  vaultId: string;
  chain: Chain;
  name: string;
  currency?: string;       // auto-derived from chain if not provided
  initialBalance?: string;
  metadata?: Record<string, string>;
}

export interface TransferRequest {
  toWalletId: string;
  amount: string; // string to avoid JSON precision loss
  currency: string;
  memo?: string;
}
