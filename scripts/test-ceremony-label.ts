import pkcs11js from 'pkcs11js';
import { getHsmConfig } from '../src/config';
import { HsmSession } from '../src/services/hsm-session';

async function test() {
  const label = 'ceremony:master:a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const keyBytes = Buffer.alloc(32, 0xAB);

  const session = new HsmSession(getHsmConfig());
  await session.initialize();
  const pkcs11 = session.getPkcs11();
  const s = session.getSession();

  // Test with label + id
  try {
    pkcs11.C_CreateObject(s, [
      { type: pkcs11js.CKA_CLASS,       value: pkcs11js.CKO_SECRET_KEY },
      { type: pkcs11js.CKA_KEY_TYPE,    value: pkcs11js.CKK_GENERIC_SECRET },
      { type: pkcs11js.CKA_TOKEN,       value: true },
      { type: pkcs11js.CKA_SENSITIVE,   value: true },
      { type: pkcs11js.CKA_EXTRACTABLE, value: false },
      { type: pkcs11js.CKA_LABEL,       value: label },
      { type: pkcs11js.CKA_ID,          value: Buffer.from(label) },
      { type: pkcs11js.CKA_VALUE,       value: keyBytes },
    ] as pkcs11js.Template);
    console.log('✓ with label+id OK');
  } catch(e: unknown) { console.log('✗ with label+id FAILED:', (e as Error).message); }

  // Test with short label
  try {
    pkcs11.C_CreateObject(s, [
      { type: pkcs11js.CKA_CLASS,       value: pkcs11js.CKO_SECRET_KEY },
      { type: pkcs11js.CKA_KEY_TYPE,    value: pkcs11js.CKK_GENERIC_SECRET },
      { type: pkcs11js.CKA_TOKEN,       value: true },
      { type: pkcs11js.CKA_SENSITIVE,   value: true },
      { type: pkcs11js.CKA_EXTRACTABLE, value: false },
      { type: pkcs11js.CKA_LABEL,       value: 'master-key' },
      { type: pkcs11js.CKA_VALUE,       value: keyBytes },
    ] as pkcs11js.Template);
    console.log('✓ short label OK');
  } catch(e: unknown) { console.log('✗ short label FAILED:', (e as Error).message); }

  await session.cleanup();
}
test().catch(e => console.error('Fatal:', e.message));
