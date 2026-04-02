/**
 * Compliance types — Chainalysis KYT, TRM Labs, Notabene
 */

export interface ChainalysisConfig {
  apiKey:        string;
  baseUrl:       string;   // default: https://api.chainalysis.com
  riskThreshold: number;   // 0-10, block if risk >= this (default: 7)
  enabled:       boolean;
}

export interface TrmConfig {
  apiKey:    string;
  apiSecret: string;
  baseUrl:   string;       // default: https://api.trmlabs.com
  enabled:   boolean;
}

export interface NotabeneConfig {
  token:   string;
  baseUrl: string;         // default: https://api.notabene.id
  vaspDID: string;         // your VASP's DID identifier
  enabled: boolean;
}

export interface ComplianceConfig {
  chainalysis: ChainalysisConfig;
  trm:         TrmConfig;
  notabene:    NotabeneConfig;
}

export interface ScreeningResult {
  provider:   'chainalysis' | 'trm' | 'notabene';
  address:    string;
  chain:      string;
  riskScore:  number | null;      // 0-10 for chainalysis, null for others
  riskLevel:  string;             // low/medium/high/severe/critical
  sanctioned: boolean;
  categories: string[];           // e.g. ['sanctions', 'darknet-market', 'ransomware']
  alerts:     string[];
  raw:        any;                // full API response for audit
  timestamp:  string;
}

export interface ComplianceDecision {
  id:         string;
  address:    string;
  chain:      string;
  walletId:   string;
  direction:  'outbound' | 'inbound';
  allowed:    boolean;
  results:    ScreeningResult[];
  blockedBy?: string;             // provider name that caused the block
  reason?:    string;
  timestamp:  string;
}

export const DEFAULT_COMPLIANCE_CONFIG: ComplianceConfig = {
  chainalysis: {
    apiKey: '',
    baseUrl: 'https://api.chainalysis.com',
    riskThreshold: 7,
    enabled: false,
  },
  trm: {
    apiKey: '',
    apiSecret: '',
    baseUrl: 'https://api.trmlabs.com',
    enabled: false,
  },
  notabene: {
    token: '',
    baseUrl: 'https://api.notabene.id',
    vaspDID: '',
    enabled: false,
  },
};
