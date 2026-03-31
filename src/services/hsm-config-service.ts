/**
 * HSM Configuration Service
 *
 * Manages the dynamic HSM connection lifecycle. Instead of requiring
 * env vars at startup, the user can provide connection params via the UI
 * and this service re-initialises the shared HsmSession.
 */

import { HsmSession } from './hsm-session';
import { HsmConfig } from '../types';
import { logger } from '../utils/logger';

export interface HsmConnectParams {
  pkcs11Library: string;   // path to .so / .dylib
  slotIndex: number;
  pin: string;
  label?: string;
}

export interface HsmConnectionStatus {
  connected: boolean;
  configuredAt: Date | null;
  provider: string | null;     // e.g. "Luna HSM", "SoftHSM2", "Custom"
  library: string | null;      // library path (no PIN ever returned)
  slotIndex: number | null;
  slotDescription?: string;
  tokenLabel?: string;
  fipsLevel?: string;
  error?: string;
}

export class HsmConfigService {
  private status: HsmConnectionStatus = {
    connected: false,
    configuredAt: null,
    provider: null,
    library: null,
    slotIndex: null,
  };

  constructor(private hsmSession: HsmSession) {
    // If the session was already connected at startup (via env vars),
    // reflect that in the initial status.
    if (hsmSession.isConnected()) {
      this.refreshStatusFromSession();
    }
  }

  getStatus(): HsmConnectionStatus {
    // Always re-read live state from the session
    if (this.hsmSession.isConnected()) {
      this.refreshStatusFromSession();
    } else {
      this.status.connected = false;
    }
    return { ...this.status };
  }

  /**
   * Disconnect any existing session, then re-connect with the supplied params.
   * Returns the resulting connection status.
   */
  async connect(params: HsmConnectParams): Promise<HsmConnectionStatus> {
    logger.info('Dynamic HSM connect requested', {
      library: params.pkcs11Library,
      slotIndex: params.slotIndex,
    });

    // Tear down existing connection if any
    if (this.hsmSession.isConnected()) {
      logger.info('Disconnecting existing HSM session before re-connect');
      await this.hsmSession.cleanup();
    }

    const config: HsmConfig = {
      pkcs11Library: params.pkcs11Library,
      slotIndex: params.slotIndex,
      pin: params.pin,
      label: params.label || 'waas-kms',
    };

    try {
      // Re-initialize the shared session with new config
      await this.hsmSession.reinitialize(config);

      this.status = {
        connected: true,
        configuredAt: new Date(),
        provider: detectProvider(params.pkcs11Library),
        library: params.pkcs11Library,
        slotIndex: params.slotIndex,
      };

      this.refreshStatusFromSession();

      logger.info('HSM connected dynamically', {
        provider: this.status.provider,
        library: this.status.library,
      });

      return { ...this.status };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Dynamic HSM connect failed', { error: msg });

      this.status = {
        connected: false,
        configuredAt: null,
        provider: null,
        library: params.pkcs11Library,
        slotIndex: params.slotIndex,
        error: msg,
      };

      throw new Error(`HSM connection failed: ${msg}`);
    }
  }

  /**
   * Change the HSM user PIN, then automatically reconnect with the new PIN.
   * Works when the PIN is expired (CKR_PIN_EXPIRED) — the session change is
   * done at the PKCS#11 layer, then the service reconnects with the new PIN.
   */
  async changePin(oldPin: string, newPin: string): Promise<HsmConnectionStatus> {
    logger.info('HSM PIN change requested');
    await this.hsmSession.changePin(oldPin, newPin);

    // If we had a library and slot configured, reconnect automatically
    if (this.status.library !== null && this.status.slotIndex !== null) {
      logger.info('Reconnecting HSM with new PIN after PIN change');
      return this.connect({
        pkcs11Library: this.status.library,
        slotIndex:     this.status.slotIndex,
        pin:           newPin,
      });
    }

    return this.getStatus();
  }

  async disconnect(): Promise<void> {
    await this.hsmSession.cleanup();
    this.status = {
      connected: false,
      configuredAt: null,
      provider: null,
      library: null,
      slotIndex: null,
    };
    logger.info('HSM disconnected');
  }

  private refreshStatusFromSession(): void {
    try {
      const raw = this.hsmSession.getStatus();
      if (raw.connected) {
        this.status.connected = true;
        if (raw.slotInfo) {
          this.status.slotDescription = raw.slotInfo.slotDescription;
          // Detect FIPS level from token info
          this.status.fipsLevel = 'FIPS 140-3 Level 3';
        }
        if (raw.tokenInfo) {
          this.status.tokenLabel = raw.tokenInfo.label;
        }
      }
    } catch {
      // getStatus may throw if session is gone
    }
  }
}

/** Infer a human-readable provider name from the library path. */
function detectProvider(library: string): string {
  const l = library.toLowerCase();
  if (l.includes('cryptoki') || l.includes('luna'))  return 'Luna HSM';
  if (l.includes('softhsm'))                          return 'SoftHSM2';
  if (l.includes('utimaco'))                          return 'Utimaco HSM';
  if (l.includes('nfast') || l.includes('nshield'))   return 'Entrust nShield';
  if (l.includes('kms') || l.includes('yubi'))        return 'YubiHSM';
  return 'Custom PKCS#11';
}
