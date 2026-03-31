import dotenv from 'dotenv';
import { HsmConfig } from '../types';

dotenv.config();

/**
 * Returns the HSM config from environment variables if present,
 * or null if no HSM has been pre-configured.
 * When null is returned the server starts without an HSM connection.
 * Users connect dynamically via POST /api/v1/hsm/connect in the UI.
 */
export function getHsmConfig(): HsmConfig | null {
  const useSoftHsm = process.env.HSM_USE_SOFTHSM === 'true';
  const lib = useSoftHsm ? process.env.SOFTHSM_LIB : process.env.HSM_PKCS11_LIB;
  const pin = process.env.HSM_PIN;

  if (!lib || !pin) return null;

  return {
    pkcs11Library: lib,
    slotIndex: parseInt(process.env.HSM_SLOT_INDEX || '0', 10),
    pin,
    label: process.env.HSM_LABEL || 'waas-kms',
  };
}

export const serverConfig = {
  port: parseInt(process.env.PORT || '3100', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
};
