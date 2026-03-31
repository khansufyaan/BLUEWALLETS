import { Wallet, Transaction } from './wallet';
import { Policy } from './policy';
import { Vault } from './vault';
import { Role } from './rbac';

export interface IWalletStore {
  create(wallet: Wallet): Promise<Wallet>;
  findById(id: string): Promise<Wallet | null>;
  findAll(): Promise<Wallet[]>;
  update(id: string, partial: Partial<Wallet>): Promise<Wallet>;
  delete(id: string): Promise<void>;
}

export interface ITransactionStore {
  create(tx: Transaction): Promise<Transaction>;
  findById(id: string): Promise<Transaction | null>;
  findByWalletId(walletId: string, limit?: number, offset?: number): Promise<Transaction[]>;
  findAll(limit?: number, offset?: number): Promise<Transaction[]>;
  update(id: string, partial: Partial<Transaction>): Promise<Transaction>;
}

export interface IPolicyStore {
  create(policy: Policy): Promise<Policy>;
  findById(id: string): Promise<Policy | null>;
  findAll(): Promise<Policy[]>;
  findByIds(ids: string[]): Promise<Policy[]>;
  update(id: string, partial: Partial<Policy>): Promise<Policy>;
  delete(id: string): Promise<void>;
}

export interface IVaultStore {
  create(vault: Vault): Promise<Vault>;
  findById(id: string): Promise<Vault | null>;
  findAll(): Promise<Vault[]>;
  update(id: string, partial: Partial<Vault>): Promise<Vault>;
  delete(id: string): Promise<void>;
}

export interface IRoleStore {
  create(role: Role): Promise<Role>;
  findById(id: string): Promise<Role | null>;
  findAll(): Promise<Role[]>;
  update(id: string, partial: Partial<Role>): Promise<Role>;
  delete(id: string): Promise<void>;
}
