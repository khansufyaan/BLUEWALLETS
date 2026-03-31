/**
 * End-to-end test: Generate key, sign data, verify signature, then cleanup.
 * This is the critical path for WaaS — every wallet operation uses this flow.
 *
 * Usage:
 *   npm run test:keys
 */
import crypto from 'crypto';
import { getHsmConfig } from '../src/config';
import { HsmSession } from '../src/services/hsm-session';
import { KmsService } from '../src/services/kms-service';
import { KeyAlgorithm } from '../src/types';

const ALGORITHMS_TO_TEST: KeyAlgorithm[] = ['EC_P256', 'EC_SECP256K1', 'RSA_2048'];

async function testKeyOperations() {
  console.log('========================================');
  console.log('  WaaS KMS — Key Operations Test');
  console.log('========================================\n');

  const config = getHsmConfig();
  const session = new HsmSession(config);
  await session.initialize();
  const kms = new KmsService(session);

  let passed = 0;
  let failed = 0;

  for (const algorithm of ALGORITHMS_TO_TEST) {
    console.log(`\n--- Testing ${algorithm} ---`);

    try {
      // 1. Generate key pair
      console.log('  [1/5] Generating key pair...');
      const keyPair = await kms.generateKeyPair(algorithm, `test-${algorithm}`);
      console.log(`    ✓ Key ID: ${keyPair.keyId}`);
      console.log(`    ✓ Public key: ${keyPair.publicKey.toString('hex').substring(0, 40)}...`);

      // 2. Sign test data
      const testData = crypto.randomBytes(32); // Simulate a transaction hash
      console.log(`  [2/5] Signing ${testData.length} bytes...`);
      const signResult = await kms.sign(keyPair.keyId, testData);
      console.log(`    ✓ Signature: ${signResult.signature.toString('hex').substring(0, 40)}...`);
      console.log(`    ✓ Mechanism: ${signResult.mechanism}`);

      // 3. Verify the signature
      console.log('  [3/5] Verifying signature...');
      const verifyResult = await kms.verify(keyPair.keyId, testData, signResult.signature);
      if (verifyResult.valid) {
        console.log('    ✓ Signature is VALID');
      } else {
        throw new Error('Signature verification returned false');
      }

      // 4. Verify with wrong data (should fail)
      console.log('  [4/5] Verifying with tampered data (should fail)...');
      const tamperedData = Buffer.from(testData);
      tamperedData[0] ^= 0xff; // Flip bits
      const tamperedResult = await kms.verify(keyPair.keyId, tamperedData, signResult.signature);
      if (!tamperedResult.valid) {
        console.log('    ✓ Tampered data correctly rejected');
      } else {
        throw new Error('Tampered data was incorrectly accepted');
      }

      // 5. Cleanup — delete the test key
      console.log('  [5/5] Deleting test key...');
      await kms.deleteKeyPair(keyPair.keyId);
      console.log('    ✓ Key deleted');

      console.log(`  ✓ ${algorithm} — ALL PASSED`);
      passed++;
    } catch (error) {
      console.error(`  ✗ ${algorithm} — FAILED`);
      console.error(`    Error: ${error instanceof Error ? error.message : error}`);
      failed++;
    }
  }

  // List remaining keys
  console.log('\n--- Listing all keys in HSM ---');
  const allKeys = await kms.listKeys();
  console.log(`  Total keys: ${allKeys.length}`);

  await session.cleanup();

  console.log('\n========================================');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');

  if (failed > 0) process.exit(1);
}

testKeyOperations().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
