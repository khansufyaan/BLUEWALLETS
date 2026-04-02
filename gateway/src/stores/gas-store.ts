/**
 * In-memory store for gas station configuration and funding history.
 */

export interface GasStationConfig {
  treasuryWalletId: string;     // signer wallet ID for the gas treasury
  treasuryAddress:  string;     // derived address of the treasury
  thresholdWei:     string;     // fund when balance drops below this
  topUpWei:         string;     // amount to send per funding tx
  maxDailyWei:      string;     // daily spending cap
  pollIntervalMs:   number;
  enabled:          boolean;
}

export interface GasFunding {
  id:        string;
  chain:     string;
  walletId:  string;
  address:   string;
  amount:    string;            // wei
  txHash:    string;
  status:    'pending' | 'confirmed' | 'failed';
  timestamp: string;
}

class GasStore {
  private config: GasStationConfig = {
    treasuryWalletId: '',
    treasuryAddress:  '',
    thresholdWei:     '10000000000000000',    // 0.01 ETH default
    topUpWei:         '50000000000000000',    // 0.05 ETH default
    maxDailyWei:      '1000000000000000000',  // 1 ETH daily cap
    pollIntervalMs:   60_000,
    enabled:          false,
  };

  private fundings: GasFunding[] = [];
  private dailySpend = new Map<string, bigint>(); // "YYYY-MM-DD" → wei spent

  getConfig(): GasStationConfig {
    return { ...this.config };
  }

  setConfig(updates: Partial<GasStationConfig>): GasStationConfig {
    Object.assign(this.config, updates);
    this.config.enabled = !!(this.config.treasuryWalletId && this.config.treasuryAddress);
    return this.config;
  }

  addFunding(funding: GasFunding): void {
    this.fundings.unshift(funding);
    if (this.fundings.length > 5_000) this.fundings.pop();

    // Track daily spend
    const today = new Date().toISOString().slice(0, 10);
    const current = this.dailySpend.get(today) || 0n;
    this.dailySpend.set(today, current + BigInt(funding.amount));
  }

  updateFunding(txHash: string, updates: Partial<GasFunding>): void {
    const f = this.fundings.find(f => f.txHash === txHash);
    if (f) Object.assign(f, updates);
  }

  getFundings(limit = 50): GasFunding[] {
    return this.fundings.slice(0, limit);
  }

  getDailySpend(): string {
    const today = new Date().toISOString().slice(0, 10);
    return (this.dailySpend.get(today) || 0n).toString();
  }

  isUnderDailyCap(amount: bigint): boolean {
    const today = new Date().toISOString().slice(0, 10);
    const current = this.dailySpend.get(today) || 0n;
    return (current + amount) <= BigInt(this.config.maxDailyWei);
  }

  getStats() {
    return {
      config:     this.config,
      dailySpend: this.getDailySpend(),
      totalFundings: this.fundings.length,
      pendingFundings: this.fundings.filter(f => f.status === 'pending').length,
    };
  }
}

export const gasStore = new GasStore();
