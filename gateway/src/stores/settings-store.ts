/**
 * Settings store — runtime-configurable API keys and RPC endpoints.
 *
 * Settings can be set via env vars (startup) or via the ops dashboard (runtime).
 * Runtime settings override env vars.
 */

import { EVM_CHAINS, config } from '../config';

export interface RpcSettings {
  chain:    string;
  name:     string;
  rpcUrl:   string;
  chainId:  number;
  provider: string;   // e.g. 'Alchemy', 'Infura', 'QuickNode', 'Self-hosted'
  enabled:  boolean;
}

export interface SettingsState {
  rpc:      Record<string, RpcSettings>;
  signer:   { url: string; authKey: string };
  webhook:  { url: string };
}

class SettingsStore {
  private rpcOverrides = new Map<string, { rpcUrl: string; provider: string }>();

  /** Get all RPC settings (env + runtime overrides) */
  getRpcSettings(): RpcSettings[] {
    return Object.entries(EVM_CHAINS).map(([key, chain]) => {
      const override = this.rpcOverrides.get(key);
      const rpcUrl = override?.rpcUrl || chain.rpcUrl;
      return {
        chain:    key,
        name:     chain.name,
        rpcUrl:   rpcUrl,
        chainId:  chain.chainId,
        provider: override?.provider || detectProvider(rpcUrl),
        enabled:  !!rpcUrl,
      };
    });
  }

  /** Get masked RPC settings (hide API keys in URLs) */
  getRpcSettingsMasked(): RpcSettings[] {
    return this.getRpcSettings().map(s => ({
      ...s,
      rpcUrl: maskRpcUrl(s.rpcUrl),
    }));
  }

  /** Update RPC URL for a chain (runtime override) */
  setRpcUrl(chain: string, rpcUrl: string, provider?: string): void {
    if (!EVM_CHAINS[chain]) throw new Error(`Unknown chain: ${chain}`);
    this.rpcOverrides.set(chain, {
      rpcUrl,
      provider: provider || detectProvider(rpcUrl),
    });
    // Also update the live config so the provider pool picks it up
    EVM_CHAINS[chain].rpcUrl = rpcUrl;
  }

  /** Get signer connection settings */
  getSignerSettings() {
    return {
      url:     config.signerUrl,
      authKey: config.internalKey ? config.internalKey.slice(0, 4) + '****' : '',
    };
  }

  /** Get all settings for the dashboard */
  getAll(): any {
    return {
      rpc:     this.getRpcSettingsMasked(),
      signer:  this.getSignerSettings(),
      webhook: { url: config.webhookUrl || '' },
    };
  }
}

function detectProvider(url: string): string {
  if (!url) return '';
  if (url.includes('alchemy.com')) return 'Alchemy';
  if (url.includes('infura.io')) return 'Infura';
  if (url.includes('quiknode.pro') || url.includes('quicknode')) return 'QuickNode';
  if (url.includes('ankr.com')) return 'Ankr';
  if (url.includes('chainstack.com')) return 'Chainstack';
  if (url.includes('localhost') || url.includes('127.0.0.1')) return 'Self-hosted';
  return 'Custom';
}

function maskRpcUrl(url: string): string {
  if (!url) return '';
  // Mask API keys in URLs (typically the last path segment or query param)
  return url.replace(/\/([a-zA-Z0-9_-]{20,})/, '/***masked***');
}

export const settingsStore = new SettingsStore();
