/**
 * In-memory store for detected deposits.
 * Tracks every incoming transfer detected by the deposit monitor.
 */

export interface DetectedDeposit {
  txHash:        string;
  chain:         string;
  walletId:      string;
  address:       string;
  from:          string;
  value:         string;     // wei
  blockNumber:   number;
  confirmations: number;
  required:      number;     // required confirmations
  status:        'pending' | 'confirmed';
  detectedAt:    string;     // ISO
  confirmedAt?:  string;
  webhookSent:   boolean;
}

class DepositStore {
  private deposits = new Map<string, DetectedDeposit>();

  add(deposit: DetectedDeposit): void {
    this.deposits.set(deposit.txHash, deposit);
  }

  update(txHash: string, updates: Partial<DetectedDeposit>): void {
    const existing = this.deposits.get(txHash);
    if (existing) {
      Object.assign(existing, updates);
    }
  }

  get(txHash: string): DetectedDeposit | undefined {
    return this.deposits.get(txHash);
  }

  getAll(): DetectedDeposit[] {
    return [...this.deposits.values()].sort(
      (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
    );
  }

  getStats() {
    const all = this.getAll();
    return {
      total:     all.length,
      pending:   all.filter(d => d.status === 'pending').length,
      confirmed: all.filter(d => d.status === 'confirmed').length,
    };
  }
}

export const depositStore = new DepositStore();
