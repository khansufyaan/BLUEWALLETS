/**
 * In-memory store for compliance configuration and screening history.
 */

import {
  ComplianceConfig, ComplianceDecision, DEFAULT_COMPLIANCE_CONFIG,
} from '../types/compliance';

class ComplianceStore {
  private config: ComplianceConfig = { ...DEFAULT_COMPLIANCE_CONFIG };
  private decisions: ComplianceDecision[] = [];

  // ── Config ──────────────────────────────────────────────────
  getConfig(): ComplianceConfig {
    return this.config;
  }

  /** Returns config with API keys masked for dashboard display */
  getConfigMasked(): any {
    const mask = (s: string) => s ? s.slice(0, 4) + '****' + s.slice(-4) : '';
    return {
      chainalysis: {
        ...this.config.chainalysis,
        apiKey: mask(this.config.chainalysis.apiKey),
      },
      trm: {
        ...this.config.trm,
        apiKey: mask(this.config.trm.apiKey),
        apiSecret: mask(this.config.trm.apiSecret),
      },
      notabene: {
        ...this.config.notabene,
        token: mask(this.config.notabene.token),
      },
    };
  }

  setConfig(updates: Partial<ComplianceConfig>): ComplianceConfig {
    if (updates.chainalysis) {
      Object.assign(this.config.chainalysis, updates.chainalysis);
      this.config.chainalysis.enabled = !!this.config.chainalysis.apiKey;
    }
    if (updates.trm) {
      Object.assign(this.config.trm, updates.trm);
      this.config.trm.enabled = !!(this.config.trm.apiKey && this.config.trm.apiSecret);
    }
    if (updates.notabene) {
      Object.assign(this.config.notabene, updates.notabene);
      this.config.notabene.enabled = !!(this.config.notabene.token && this.config.notabene.vaspDID);
    }
    return this.config;
  }

  isAnyProviderEnabled(): boolean {
    return this.config.chainalysis.enabled || this.config.trm.enabled || this.config.notabene.enabled;
  }

  // ── Decisions ───────────────────────────────────────────────
  addDecision(decision: ComplianceDecision): void {
    this.decisions.unshift(decision); // newest first
    if (this.decisions.length > 10_000) this.decisions.pop();
  }

  getDecisions(limit = 100): ComplianceDecision[] {
    return this.decisions.slice(0, limit);
  }

  getBlockedDecisions(limit = 100): ComplianceDecision[] {
    return this.decisions.filter(d => !d.allowed).slice(0, limit);
  }

  getStats() {
    return {
      total:      this.decisions.length,
      allowed:    this.decisions.filter(d => d.allowed).length,
      blocked:    this.decisions.filter(d => !d.allowed).length,
      sanctioned: this.decisions.filter(d => d.results.some(r => r.sanctioned)).length,
      providers: {
        chainalysis: this.config.chainalysis.enabled,
        trm:         this.config.trm.enabled,
        notabene:    this.config.notabene.enabled,
      },
    };
  }
}

export const complianceStore = new ComplianceStore();
