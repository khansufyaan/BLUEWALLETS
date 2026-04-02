/**
 * Driver Client — HTTP(S) client for the Blue Driver internal API.
 *
 * Uses mTLS when certificates are present, falls back to HTTP + shared key.
 * Communication is over the bank's internal network (Docker internal network in dev).
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

// Build mTLS agent if certs exist
function buildTlsAgent(): https.Agent | undefined {
  const certsDir = process.env.CERTS_DIR || '/app/certs';
  const certPath = path.join(certsDir, 'console-cert.pem');
  const keyPath  = path.join(certsDir, 'console-key.pem');
  const caPath   = path.join(certsDir, 'ca.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath) && fs.existsSync(caPath)) {
    logger.info('mTLS client certificates loaded for Driver connection');
    return new https.Agent({
      cert: fs.readFileSync(certPath),
      key:  fs.readFileSync(keyPath),
      ca:   fs.readFileSync(caPath),
      rejectUnauthorized: true,
    });
  }
  return undefined;
}

const tlsAgent = buildTlsAgent();

export interface SignerWallet {
  id:        string;
  name:      string;
  chain:     string;
  algorithm: string;
  address:   string;
  publicKey: string;
  currency:  string;
  balance:   string;
  status:    string;
  vaultId:   string;
  createdAt: string;
}

export interface SignResult {
  signatureHex: string;
  publicKeyHex: string;
  algorithm:    string;
  chain:        string;
  address:      string;
}

export class SignerClient {
  private baseUrl: string;
  private headers: Record<string, string>;
  private isHttps: boolean;

  constructor() {
    this.baseUrl = config.signerUrl;
    this.isHttps = this.baseUrl.startsWith('https');
    this.headers = {
      'Content-Type': 'application/json',
    };
    if (config.internalKey) {
      this.headers['X-Internal-Key'] = config.internalKey;
    }
  }

  /** HTTP/HTTPS request with mTLS support */
  private async req(urlPath: string, method: string, body?: any): Promise<{ ok: boolean; status: number; data: any }> {
    const url = `${this.baseUrl}${urlPath}`;

    if (this.isHttps && tlsAgent) {
      return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const options: https.RequestOptions = {
          hostname: parsed.hostname,
          port: parseInt(parsed.port || '443'),
          path: parsed.pathname + parsed.search,
          method,
          headers: this.headers,
          agent: tlsAgent,
        };
        const req = https.request(options, (res) => {
          let raw = '';
          res.on('data', c => raw += c);
          res.on('end', () => {
            try {
              resolve({ ok: (res.statusCode || 500) < 400, status: res.statusCode || 500, data: JSON.parse(raw) });
            } catch {
              resolve({ ok: false, status: res.statusCode || 500, data: {} });
            }
          });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
        if (body) req.write(JSON.stringify(body));
        req.end();
      });
    }

    // Plain HTTP fallback
    const opts: RequestInit = { method, headers: this.headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  /**
   * Request the signer to sign a hash using a wallet's HSM-wrapped key.
   * Returns raw ECDSA signature (r || s) as hex.
   */
  async sign(walletId: string, hashHex: string): Promise<SignResult> {
    return withRetry(async () => {
      const res = await this.req('/internal/sign', 'POST', { walletId, hashHex });
      if (!res.ok) throw new Error(`Signer sign failed (${res.status}): ${res.data.error || 'Unknown error'}`);
      return res.data as SignResult;
    }, { maxRetries: 2, label: 'signer.sign' });
  }

  async listWallets(): Promise<SignerWallet[]> {
    const res = await this.req('/internal/wallets', 'GET');
    if (!res.ok) throw new Error(`Signer listWallets failed (${res.status})`);
    return (res.data as { wallets: SignerWallet[] }).wallets;
  }

  async getWallet(walletId: string): Promise<SignerWallet> {
    const res = await this.req(`/internal/wallets/${walletId}`, 'GET');
    if (!res.ok) throw new Error(`Signer getWallet failed (${res.status}): ${res.data.error || 'Not found'}`);
    return res.data as SignerWallet;
  }

  async updateBalance(walletId: string, balance: string): Promise<void> {
    const res = await this.req(`/internal/wallets/${walletId}/balance`, 'POST', { balance });
    if (!res.ok) logger.warn('Failed to push balance to signer', { walletId, balance });
  }

  async updateWalletStatus(walletId: string, status: 'active' | 'frozen'): Promise<void> {
    const res = await this.req(`/internal/wallets/${walletId}/status`, 'POST', { status });
    if (!res.ok) throw new Error(`Failed to update wallet status: ${res.data.error || res.status}`);
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Health check uses plain HTTP/HTTPS — goes to :3200/health (not /internal)
      const res = await this.req('/health', 'GET');
      return res.status === 200 || res.status === 503;
    } catch {
      return false;
    }
  }
}
