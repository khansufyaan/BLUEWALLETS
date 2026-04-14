import pkcs11js from 'pkcs11js';
import { HsmConfig, HsmStatus } from '../types';
import { logger } from '../utils/logger';

/**
 * Manages the PKCS#11 session lifecycle with the Luna Cloud HSM.
 * Handles initialization, login, session management, and cleanup.
 */
export class HsmSession {
  private pkcs11: pkcs11js.PKCS11;
  private session: pkcs11js.Handle | null = null;
  private slotId: pkcs11js.Handle | null = null;
  private initialized = false;
  private loggedIn = false;

  constructor(private config: HsmConfig) {
    this.pkcs11 = new pkcs11js.PKCS11();
  }

  /**
   * Swap the active config and re-initialize the PKCS#11 session.
   * Used when the user configures the HSM dynamically via the UI.
   * The caller is responsible for calling cleanup() first.
   */
  async reinitialize(newConfig: HsmConfig): Promise<void> {
    this.config = newConfig;
    // Reset state flags so initialize() runs cleanly
    this.session = null;
    this.slotId = null;
    this.initialized = false;
    this.loggedIn = false;
    // Create a fresh PKCS11 object (the old one may be finalized)
    this.pkcs11 = new pkcs11js.PKCS11();
    await this.initialize();
  }

  /**
   * Initialize the PKCS#11 library and open a session.
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Loading PKCS#11 library', { library: this.config.pkcs11Library });
      this.pkcs11.load(this.config.pkcs11Library);

      this.pkcs11.C_Initialize();
      this.initialized = true;
      logger.info('PKCS#11 library initialized');

      // Get the target slot
      const slots = this.pkcs11.C_GetSlotList(true); // true = only slots with tokens
      if (slots.length === 0) {
        throw new Error('No HSM slots with tokens found');
      }

      if (this.config.slotIndex >= slots.length) {
        throw new Error(
          `Slot index ${this.config.slotIndex} out of range (${slots.length} slots available)`
        );
      }

      this.slotId = slots[this.config.slotIndex];
      logger.info('Selected HSM slot', { slotIndex: this.config.slotIndex });

      // Open a read/write session
      this.session = this.pkcs11.C_OpenSession(
        this.slotId,
        pkcs11js.CKF_SERIAL_SESSION | pkcs11js.CKF_RW_SESSION
      );
      logger.info('PKCS#11 session opened');

      // Login to the token
      this.pkcs11.C_Login(this.session, pkcs11js.CKU_USER, this.config.pin);
      this.loggedIn = true;
      logger.info('Logged into HSM partition');
    } catch (error) {
      logger.error('Failed to initialize HSM session', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Returns the active PKCS#11 session handle.
   * If the session has gone stale (HSM dropped it due to idle timeout,
   * network interruption, etc.), automatically reconnects.
   */
  getSession(): pkcs11js.Handle {
    if (!this.session || !this.config.pin) {
      throw new Error('HSM session not initialized. Call initialize() first.');
    }

    // Probe the session — if the HSM dropped it, this will throw
    try {
      this.pkcs11.C_GetSessionInfo(this.session);
    } catch (err) {
      logger.warn('HSM session stale — auto-reconnecting', {
        error: err instanceof Error ? err.message : 'unknown',
      });
      this.autoReconnect();
    }

    return this.session!;
  }

  /**
   * Attempt to re-establish the PKCS#11 session using stored config.
   * Called automatically when a stale session is detected.
   */
  private autoReconnect(): void {
    try {
      // Close old session/finalize gracefully
      try { if (this.session) this.pkcs11.C_CloseSession(this.session); } catch { /* ignore */ }
      try { if (this.initialized) this.pkcs11.C_Finalize(); } catch { /* ignore */ }

      // Reset state
      this.session = null;
      this.slotId = null;
      this.initialized = false;
      this.loggedIn = false;
      this.pkcs11 = new pkcs11js.PKCS11();

      // Re-initialize
      this.pkcs11.load(this.config.pkcs11Library);
      this.pkcs11.C_Initialize();
      this.initialized = true;

      const slots = this.pkcs11.C_GetSlotList(true);
      if (slots.length === 0) throw new Error('No HSM slots with tokens found');
      this.slotId = slots[this.config.slotIndex];

      this.session = this.pkcs11.C_OpenSession(
        this.slotId,
        pkcs11js.CKF_SERIAL_SESSION | pkcs11js.CKF_RW_SESSION
      );

      this.pkcs11.C_Login(this.session, pkcs11js.CKU_USER, this.config.pin);
      this.loggedIn = true;

      logger.info('HSM session auto-reconnected successfully');
    } catch (err) {
      logger.error('HSM auto-reconnect failed', {
        error: err instanceof Error ? err.message : 'unknown',
      });
      this.session = null;
      this.loggedIn = false;
      throw new Error('HSM session lost and auto-reconnect failed. Reconnect via the UI.');
    }
  }

  /**
   * Returns the raw PKCS#11 interface.
   */
  getPkcs11(): pkcs11js.PKCS11 {
    return this.pkcs11;
  }

  /**
   * Get HSM status and slot/token info.
   */
  getStatus(): HsmStatus {
    if (!this.initialized || !this.slotId) {
      return { connected: false, slotInfo: null, tokenInfo: null };
    }

    try {
      const slotInfo = this.pkcs11.C_GetSlotInfo(this.slotId);
      const tokenInfo = this.pkcs11.C_GetTokenInfo(this.slotId);

      return {
        connected: this.loggedIn,
        slotInfo: {
          slotDescription: slotInfo.slotDescription.trim(),
          manufacturerId: slotInfo.manufacturerID.trim(),
          firmwareVersion: `${slotInfo.firmwareVersion.major}.${slotInfo.firmwareVersion.minor}`,
          tokenPresent: !!(slotInfo.flags & 0x00000001), // CKF_TOKEN_PRESENT = 0x01
        },
        tokenInfo: {
          label: tokenInfo.label.trim(),
          model: tokenInfo.model.trim(),
          serialNumber: tokenInfo.serialNumber.trim(),
          freePublicMemory: Number(tokenInfo.freePublicMemory),
          freePrivateMemory: Number(tokenInfo.freePrivateMemory),
        },
      };
    } catch (error) {
      logger.error('Failed to get HSM status', { error });
      return { connected: false, slotInfo: null, tokenInfo: null };
    }
  }

  /**
   * Clean up: logout, close session, finalize.
   */
  async cleanup(): Promise<void> {
    try {
      if (this.loggedIn && this.session) {
        this.pkcs11.C_Logout(this.session);
        this.loggedIn = false;
        logger.info('Logged out of HSM');
      }
    } catch {
      // Ignore logout errors during cleanup
    }

    try {
      if (this.session) {
        this.pkcs11.C_CloseSession(this.session);
        this.session = null;
        logger.info('PKCS#11 session closed');
      }
    } catch {
      // Ignore close errors
    }

    try {
      if (this.initialized) {
        this.pkcs11.C_Finalize();
        this.initialized = false;
        logger.info('PKCS#11 finalized');
      }
    } catch {
      // Ignore finalize errors
    }
  }

  isConnected(): boolean {
    if (!this.loggedIn || !this.session) return false;
    // Probe the session to check if it's still alive
    try {
      this.pkcs11.C_GetSessionInfo(this.session);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Change the HSM user PIN via PKCS#11 C_SetPIN.
   * Works even when the PIN is expired (CKR_PIN_EXPIRED from C_Login).
   * If no active session exists, opens a temporary RW session just for the change.
   */
  async changePin(oldPin: string, newPin: string): Promise<void> {
    let session = this.session;
    let ownedSession = false;
    let ownedInit = false;

    try {
      if (!session) {
        // Session is gone (e.g. after failed login). Re-init PKCS#11 minimally.
        if (!this.initialized) {
          this.pkcs11.load(this.config.pkcs11Library);
          this.pkcs11.C_Initialize();
          this.initialized = true;
          ownedInit = true;
        }
        const slots = this.pkcs11.C_GetSlotList(true);
        if (slots.length === 0) throw new Error('No HSM slots with tokens found');
        const slotId = slots[this.config.slotIndex] ?? slots[0];
        this.slotId = slotId;
        session = this.pkcs11.C_OpenSession(
          slotId,
          pkcs11js.CKF_SERIAL_SESSION | pkcs11js.CKF_RW_SESSION
        );
        ownedSession = true;
      }

      // C_SetPIN works without being logged in when PIN is expired on Luna HSM
      this.pkcs11.C_SetPIN(session, oldPin, newPin);
      logger.info('HSM PIN changed successfully');

      // Update stored config so the next reconnect uses the new PIN
      this.config = { ...this.config, pin: newPin };

    } finally {
      if (ownedSession && session) {
        try { this.pkcs11.C_CloseSession(session); } catch { /* ignore */ }
      }
      if (ownedInit) {
        try { this.pkcs11.C_Finalize(); this.initialized = false; } catch { /* ignore */ }
      }
    }
  }
}
