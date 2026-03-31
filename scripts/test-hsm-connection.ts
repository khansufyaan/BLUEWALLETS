/**
 * Test script: Verify connectivity to the HSM (SoftHSM or Luna Cloud HSM).
 *
 * Usage:
 *   npm run test:hsm
 *
 * Prerequisites:
 *   - .env configured with HSM credentials
 *   - For local dev: run scripts/setup-softhsm.sh first
 *   - For Luna Cloud HSM: Luna Client installed + DPoD partition provisioned
 */
import { getHsmConfig } from '../src/config';
import { HsmSession } from '../src/services/hsm-session';

async function testConnection() {
  console.log('========================================');
  console.log('  WaaS KMS — HSM Connection Test');
  console.log('========================================\n');

  const config = getHsmConfig();
  console.log('Configuration:');
  console.log(`  PKCS#11 Library: ${config.pkcs11Library}`);
  console.log(`  Slot Index: ${config.slotIndex}`);
  console.log(`  Label: ${config.label}`);
  console.log(`  PIN: ${'*'.repeat(config.pin.length)}`);
  console.log('');

  const session = new HsmSession(config);

  try {
    console.log('[1/3] Initializing PKCS#11 library...');
    await session.initialize();
    console.log('  ✓ PKCS#11 initialized and logged in\n');

    console.log('[2/3] Querying HSM status...');
    const status = session.getStatus();
    console.log(`  Connected: ${status.connected}`);

    if (status.slotInfo) {
      console.log(`  Slot: ${status.slotInfo.slotDescription}`);
      console.log(`  Manufacturer: ${status.slotInfo.manufacturerId}`);
      console.log(`  Firmware: ${status.slotInfo.firmwareVersion}`);
    }

    if (status.tokenInfo) {
      console.log(`  Token Label: ${status.tokenInfo.label}`);
      console.log(`  Token Model: ${status.tokenInfo.model}`);
      console.log(`  Serial: ${status.tokenInfo.serialNumber}`);
    }
    console.log('');

    console.log('[3/3] Cleaning up...');
    await session.cleanup();
    console.log('  ✓ Session closed\n');

    console.log('========================================');
    console.log('  ✓ HSM CONNECTION SUCCESSFUL');
    console.log('========================================');
  } catch (error) {
    console.error('\n  ✗ HSM CONNECTION FAILED');
    console.error(`  Error: ${error instanceof Error ? error.message : error}`);
    console.error('');
    console.error('Troubleshooting:');
    console.error('  - Verify .env has correct HSM_PKCS11_LIB or SOFTHSM_LIB path');
    console.error('  - Verify HSM_PIN matches the partition/token password');
    console.error('  - For SoftHSM: run scripts/setup-softhsm.sh first');
    console.error('  - For Luna: ensure Luna Client is installed and certs are configured');
    await session.cleanup();
    process.exit(1);
  }
}

testConnection();
