import { Wallet } from '../types/wallet';
import { IWalletStore } from '../types/store';

export class InMemoryWalletStore implements IWalletStore {
  private wallets = new Map<string, Wallet>();

  async create(wallet: Wallet): Promise<Wallet> {
    this.wallets.set(wallet.id, wallet);
    return wallet;
  }

  async findById(id: string): Promise<Wallet | null> {
    return this.wallets.get(id) || null;
  }

  async findAll(): Promise<Wallet[]> {
    return Array.from(this.wallets.values());
  }

  async update(id: string, partial: Partial<Wallet>): Promise<Wallet> {
    const existing = this.wallets.get(id);
    if (!existing) throw new Error(`Wallet not found: ${id}`);
    const updated = { ...existing, ...partial, updatedAt: new Date() };
    this.wallets.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.wallets.delete(id);
  }
}
