# Wrapped Child Key Redesign — BIP32/39/44 HD Wallet Architecture

> **Status:** BLOCKED — Requires Luna DPoD partition policy change to enable `C_WrapKey` on EC private keys.

## Problem

Currently, every wallet generates an independent EC keypair on the HSM. There is no hierarchical derivation. This means:

- No deterministic recovery from a single seed
- No BIP-44 account structure (coin type / account / change / index)
- The `bip39` npm dependency is imported but unused
- Scaling to millions of wallets requires millions of independent HSM key objects

## Goal

Implement BIP32/39/44 hierarchical deterministic wallet derivation where:

1. A single BIP39 mnemonic generates a master seed during key ceremony
2. Child keys are derived deterministically per BIP-44 path
3. Private key material never leaves the HSM boundary
4. Every derived key is AES-wrapped and stored — session handles destroyed after use

---

## Current Architecture

```
Key Ceremony
  └─ C_GenerateKey(AES-256) → blue:wrap:v1 (permanent, non-extractable)

Wallet Creation (per wallet)
  └─ C_GenerateKeyPair(EC_SECP256K1) → persistent token object
  └─ Store reference: "hsm:blue:wallet:<keyId>"
  └─ No derivation, no hierarchy

Signing
  └─ findKeyByLabel("blue:wallet:<keyId>") → handle
  └─ C_SignInit + C_Sign → signature
  └─ Key stays on HSM (CKA_EXTRACTABLE=false)
```

**Problems with current approach on Luna DPoD:**
- EC keys have `CKA_KEY_NOT_WRAPPABLE` enforced by partition policy
- Cannot wrap EC private keys with `C_WrapKey` even using `blue:wrap:v1`
- Keys stored as permanent token objects (functional but not derivable)

## Proposed Architecture

```
Key Ceremony (one-time)
  ├─ Generate BIP39 mnemonic (256-bit entropy)
  ├─ Derive BIP32 master seed (512-bit via PBKDF2)
  ├─ Import master seed as CKO_SECRET_KEY (generic secret, 64 bytes)
  │   └─ CKA_TOKEN=true, CKA_SENSITIVE=true, CKA_EXTRACTABLE=false
  │   └─ Label: "blue:hd:master:v1"
  └─ Wrap master seed with blue:wrap:v1 → store backup ciphertext
      (requires CKA_EXTRACTABLE=true on master seed — DPoD blocker)

Wallet Creation (per derivation path)
  ├─ Derive child key from master seed using BIP-32 path
  │   Option A: C_DeriveKey with CKM_SP800_108_COUNTER_KDF (if Luna supports)
  │   Option B: Unwrap master seed → HMAC-SHA512 in HSM → split → EC import
  ├─ Import derived private key as EC session object
  ├─ C_WrapKey with blue:wrap:v1 → AES-256-CBC-PAD ciphertext
  ├─ Store: { path, wrappedKey, publicKey, address }
  └─ C_DestroyObject on session key handle

Signing (per transaction)
  ├─ C_UnwrapKey(blue:wrap:v1, wrappedCiphertext) → session EC key
  ├─ C_SignInit + C_Sign → signature
  └─ C_DestroyObject on session key handle
```

## BIP-44 Path Structure

Standard: `m / purpose' / coin_type' / account' / change / address_index`

| Chain     | Coin Type | Example Path          |
|-----------|-----------|-----------------------|
| Bitcoin   | 0         | m/44'/0'/0'/0/0       |
| Ethereum  | 60        | m/44'/60'/0'/0/0      |
| Litecoin  | 2         | m/44'/2'/0'/0/0       |
| Solana    | 501       | m/44'/501'/0'/0'      |
| BSC       | 60        | m/44'/60'/1'/0/0      |
| Polygon   | 60        | m/44'/60'/2'/0/0      |
| Arbitrum  | 60        | m/44'/60'/3'/0/0      |
| Avalanche | 60        | m/44'/60'/4'/0/0      |
| Tron      | 195       | m/44'/195'/0'/0/0     |

**Account mapping for EVM chains:** Since they all use coin_type=60, we differentiate by account index: Ethereum=0, BSC=1, Polygon=2, Arbitrum=3, Avalanche=4.

**Index allocation:** Each new wallet increments the `address_index`. The next available index is tracked in the `wallets` table.

## HSM Operation Sequence

### 1. Ceremony — Master Seed Generation

```
1. Generate 256-bit entropy via C_GenerateRandom
2. Convert to BIP39 mnemonic (24 words) — display to officer for backup
3. Derive master seed: PBKDF2("mnemonic " + mnemonic, salt=passphrase, 2048, 64)
4. Import as generic secret:
     C_CreateObject(session, [
       CKA_CLASS      = CKO_SECRET_KEY,
       CKA_KEY_TYPE   = CKK_GENERIC_SECRET,
       CKA_VALUE      = masterSeed,        // 64 bytes
       CKA_VALUE_LEN  = 64,
       CKA_TOKEN      = true,              // persistent
       CKA_SENSITIVE  = true,
       CKA_EXTRACTABLE= true,              // ← NEEDED for C_WrapKey (DPoD blocker)
       CKA_LABEL      = "blue:hd:master:v1",
       CKA_WRAP       = false,
       CKA_SIGN       = true,              // for HMAC derivation
     ])
5. Wrap for backup:
     C_WrapKey(session, {mechanism: CKM_AES_CBC_PAD}, blue:wrap:v1, masterHandle)
     → store ciphertext in DB (disaster recovery)
6. Zero mnemonic from application memory
```

### 2. Wallet Creation — Child Key Derivation

```
BIP-32 derivation (HMAC-SHA512 chain):

1. Unwrap master seed (or use persistent handle)
2. For each level in path m/44'/coin'/account'/change/index:
     a. Build HMAC-SHA512 input: parent_chain_code || serialize(parent_key, child_index)
     b. Execute HMAC-SHA512:
        - C_SignInit(session, {mechanism: CKM_SHA512_HMAC}, parentChainCodeHandle)
        - C_Sign(session, input) → 64 bytes
     c. Split: left 32 bytes = child key modifier, right 32 bytes = child chain code
     d. For hardened derivation: input = 0x00 || parent_private_key || index_with_flag
     e. Child private key = (parent_key + modifier) mod n  [secp256k1 order]
3. Import final child private key as EC session object:
     C_CreateObject(session, [
       CKA_CLASS       = CKO_PRIVATE_KEY,
       CKA_KEY_TYPE    = CKK_EC,
       CKA_EC_PARAMS   = secp256k1_OID,
       CKA_VALUE       = childPrivateKey,  // 32 bytes
       CKA_TOKEN       = false,            // session object only
       CKA_SENSITIVE   = true,
       CKA_EXTRACTABLE = true,             // ← NEEDED for wrapping (DPoD blocker)
       CKA_SIGN        = true,
     ])
4. C_WrapKey(session, {mechanism: CKM_AES_CBC_PAD}, blue:wrap:v1, childHandle)
     → ciphertext (IV + encrypted key material)
5. Extract public key from child:
     C_GetAttributeValue(session, childHandle, [CKA_EC_POINT])
6. Derive blockchain address from public key
7. Store in wallets table:
     { id, path: "m/44'/60'/0'/0/0", wrappedPrivateKey: "iv:ciphertext", ... }
8. C_DestroyObject(session, childHandle)
9. Zero all intermediate key material from application memory
```

### 3. Signing — Unwrap → Sign → Destroy

```
1. Read wrappedPrivateKey from DB (iv:ciphertext format)
2. C_UnwrapKey(session, {mechanism: CKM_AES_CBC_PAD}, blue:wrap:v1, ciphertext, [
     CKA_CLASS       = CKO_PRIVATE_KEY,
     CKA_KEY_TYPE    = CKK_EC,
     CKA_EC_PARAMS   = secp256k1_OID,
     CKA_TOKEN       = false,     // session only
     CKA_SENSITIVE   = true,
     CKA_EXTRACTABLE = false,     // no re-extraction after unwrap
     CKA_SIGN        = true,
   ]) → sessionKeyHandle
3. C_SignInit(session, {mechanism: CKM_ECDSA}, sessionKeyHandle)
4. C_Sign(session, hash) → signature
5. C_DestroyObject(session, sessionKeyHandle)
```

## Database Changes

Add columns to `wallets` table:

```sql
ALTER TABLE wallets ADD COLUMN derivation_path TEXT;
ALTER TABLE wallets ADD COLUMN hd_version TEXT DEFAULT 'v1';
```

The `wrappedPrivateKey` column changes from `hsm:<label>` format to `<iv_hex>:<ciphertext_hex>` format for HD-derived keys.

Add a new table for HD master key metadata:

```sql
CREATE TABLE IF NOT EXISTS hd_masters (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,      -- "blue:hd:master:v1"
  wrapped_backup TEXT,             -- AES-wrapped master seed (disaster recovery)
  mnemonic_hash TEXT NOT NULL,     -- SHA-256 of mnemonic (verification only)
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Migration Path

1. **Phase 1 (now):** Continue generating independent HSM token keys (current behavior)
2. **Phase 2 (after DPoD policy change):** New wallets use HD derivation; existing wallets unchanged
3. **Phase 3 (optional):** Offer migration tool that re-keys existing wallets under HD tree

Existing wallets with `hsm:<label>` references continue to work — the signing code path branches on the prefix:
- `hsm:` → find by label, sign directly (legacy)
- `<hex>:<hex>` → unwrap with `blue:wrap:v1`, sign, destroy (HD)

## Security Analysis

| Property | Current | Proposed | Impact |
|----------|---------|----------|--------|
| Key extraction | CKA_EXTRACTABLE=false | CKA_EXTRACTABLE=true (for wrapping only) | Weaker — key material can be wrapped out. Mitigated by non-extractable wrap key. |
| Key at rest | Permanent HSM token | AES-256-CBC-PAD ciphertext in DB | Similar — both depend on HSM access control. DB ciphertext is useless without blue:wrap:v1. |
| Recovery | No recovery without HSM backup | 24-word mnemonic → full deterministic recovery | Stronger — but mnemonic is a single point of compromise. Must be stored with split custody (Shamir or M-of-N). |
| Signing window | Key always on HSM | Key unwrapped for ~10ms during sign | Similar — session key is non-extractable after unwrap. |
| Scalability | 1 HSM object per wallet | 1 HSM object (master) + DB rows | Much better — HSM object count stays constant. |

**Key risk:** The mnemonic is the master secret. It must be:
- Displayed once during ceremony, never stored digitally
- Split via Shamir's Secret Sharing (3-of-5 recommended)
- Each share stored in separate physical safes by different officers
- The `shamirs-secret-sharing` package is already a dependency

## Luna DPoD Policy Requirements

To enable this architecture, the following DPoD partition settings must be changed:

1. **Allow `CKA_EXTRACTABLE=true` on secret keys** — Required for wrapping the master seed
2. **Allow `CKA_EXTRACTABLE=true` on EC private keys** — Required for wrapping derived child keys
3. **Allow `C_WrapKey` on EC keys** — Currently blocked by `CKA_KEY_NOT_WRAPPABLE` policy
4. **Allow `C_UnwrapKey` to import EC keys** — Required for signing flow

These are partition-level policy changes made via the DPoD console or by Thales support. The wrap key (`blue:wrap:v1`) remains non-extractable — only the keys being wrapped need extractability.

**Alternative if DPoD refuses:** Keep derived keys as persistent HSM token objects (current approach but with BIP-32 derivation in application memory). Less secure but doesn't require policy change. Master seed stays in HSM for derivation; child keys are imported as permanent tokens instead of wrapped.

## Files to Modify (When Unblocked)

| File | Change |
|------|--------|
| `src/services/ceremony-service.ts` | Add HD master seed generation, mnemonic display, Shamir split |
| `src/services/kms-service.ts` | Add `deriveChildKey()`, `signWithWrappedKey()` HD path, `unwrapAndSign()` |
| `src/services/wallet-service.ts` | Use derivation path, track index counter |
| `src/db/schema.sql` | Add `derivation_path`, `hd_version` columns; `hd_masters` table |
| `src/routes/ceremony.ts` | Expose mnemonic (one-time) and Shamir shares endpoints |
| `src/types/index.ts` | Add HD-related types |
| `gateway/public/js/pages/create-wallet.js` | Show derivation path in wallet creation |

## Open Questions

1. Should we support BIP-39 passphrase (25th word) for additional entropy?
2. Should Shamir shares be generated inside the HSM or in application memory?
3. Do we want to support BIP-85 (deriving child mnemonics for tenant isolation)?
4. What's the max derivation depth we support? (BIP-44 standard = 5 levels)
