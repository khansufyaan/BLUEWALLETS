/**
 * In-memory store for broadcast transactions.
 * Tracks every withdrawal the gateway sends to the blockchain.
 */

export interface BroadcastTx {
  id:          string;
  walletId:    string;
  chain:       string;
  from:        string;
  to:          string;
  amount:      string;       // wei
  txHash:      string;
  status:      'pending' | 'confirmed' | 'failed';
  nonce:       number;
  gasLimit:    string;
  gasUsed?:    string;
  gasPrice?:   string;
  blockNumber?: number;
  createdAt:   string;       // ISO
  confirmedAt?: string;
}

class TxStore {
  private txs = new Map<string, BroadcastTx>();

  add(tx: BroadcastTx): void {
    this.txs.set(tx.txHash, tx);
  }

  update(txHash: string, updates: Partial<BroadcastTx>): void {
    const existing = this.txs.get(txHash);
    if (existing) {
      Object.assign(existing, updates);
    }
  }

  get(txHash: string): BroadcastTx | undefined {
    return this.txs.get(txHash);
  }

  getAll(): BroadcastTx[] {
    return [...this.txs.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  getByStatus(status: BroadcastTx['status']): BroadcastTx[] {
    return this.getAll().filter(tx => tx.status === status);
  }

  getStats() {
    const all = this.getAll();
    return {
      total:     all.length,
      pending:   all.filter(t => t.status === 'pending').length,
      confirmed: all.filter(t => t.status === 'confirmed').length,
      failed:    all.filter(t => t.status === 'failed').length,
    };
  }
}

export const txStore = new TxStore();
