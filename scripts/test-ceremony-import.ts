import pkcs11js from 'pkcs11js';
import { getHsmConfig } from '../src/config';
import { HsmSession } from '../src/services/hsm-session';

async function test() {
  const session = new HsmSession(getHsmConfig());
  await session.initialize();
  const pkcs11 = session.getPkcs11();
  const s = session.getSession();
  const keyBytes = Buffer.alloc(32, 0xAB);

  const tests = [
    { name: 'minimal (no extra attrs)', tmpl: [
      { type: pkcs11js.CKA_CLASS,    value: pkcs11js.CKO_SECRET_KEY },
      { type: pkcs11js.CKA_KEY_TYPE, value: pkcs11js.CKK_GENERIC_SECRET },
      { type: pkcs11js.CKA_TOKEN,    value: false },
      { type: pkcs11js.CKA_VALUE,    value: keyBytes },
    ]},
    { name: 'extractable=true', tmpl: [
      { type: pkcs11js.CKA_CLASS,       value: pkcs11js.CKO_SECRET_KEY },
      { type: pkcs11js.CKA_KEY_TYPE,    value: pkcs11js.CKK_GENERIC_SECRET },
      { type: pkcs11js.CKA_TOKEN,       value: false },
      { type: pkcs11js.CKA_EXTRACTABLE, value: true },
      { type: pkcs11js.CKA_VALUE,       value: keyBytes },
    ]},
    { name: 'token + sensitive + non-extractable', tmpl: [
      { type: pkcs11js.CKA_CLASS,       value: pkcs11js.CKO_SECRET_KEY },
      { type: pkcs11js.CKA_KEY_TYPE,    value: pkcs11js.CKK_GENERIC_SECRET },
      { type: pkcs11js.CKA_TOKEN,       value: true },
      { type: pkcs11js.CKA_SENSITIVE,   value: true },
      { type: pkcs11js.CKA_EXTRACTABLE, value: false },
      { type: pkcs11js.CKA_VALUE,       value: keyBytes },
    ]},
    { name: 'CKK_AES with sensitive+nonextract', tmpl: [
      { type: pkcs11js.CKA_CLASS,       value: pkcs11js.CKO_SECRET_KEY },
      { type: pkcs11js.CKA_KEY_TYPE,    value: pkcs11js.CKK_AES },
      { type: pkcs11js.CKA_TOKEN,       value: true },
      { type: pkcs11js.CKA_SENSITIVE,   value: true },
      { type: pkcs11js.CKA_EXTRACTABLE, value: false },
      { type: pkcs11js.CKA_VALUE,       value: keyBytes },
    ]},
  ];

  for (const t of tests) {
    try {
      const h = pkcs11.C_CreateObject(s, t.tmpl as pkcs11js.Template);
      console.log(`✓ "${t.name}" OK, handle: ${h}`);
    } catch(e: unknown) {
      console.log(`✗ "${t.name}" FAILED: ${(e as Error).message}`);
    }
  }
  await session.cleanup();
}
test().catch(e => console.error('Fatal:', e.message));
// THIS WILL FAIL - keeping for reference
