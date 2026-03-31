import { Transaction } from '../types/wallet';
import { ITransactionStore } from '../types/store';

export class InMemoryTransactionStore implements ITransactionStore {
  private transactions = new Map<string, Transaction>();

  async create(tx: Transaction): Promise<Transaction> {
    this.transactions.set(tx.id, tx);
    return tx;
  }

  async findById(id: string): Promise<Transaction | null> {
    return this.transactions.get(id) || null;
  }

  async findByWalletId(walletId: string, limit = 50, offset = 0): Promise<Transaction[]> {
    const matches = Array.from(this.transactions.values())
      .filter((tx) => tx.fromWalletId === walletId || tx.toWalletId === walletId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches.slice(offset, offset + limit);
  }

  async findAll(limit = 50, offset = 0): Promise<Transaction[]> {
    const all = Array.from(this.transactions.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return all.slice(offset, offset + limit);
  }

  async update(id: string, partial: Partial<Transaction>): Promise<Transaction> {
    const existing = this.transactions.get(id);
    if (!existing) throw new Error(`Transaction not found: ${id}`);
    const updated = { ...existing, ...partial };
    this.transactions.set(id, updated);
    return updated;
  }
}
