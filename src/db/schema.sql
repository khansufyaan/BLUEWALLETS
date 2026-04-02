-- Blue Wallets — PostgreSQL Schema
-- All bigint values stored as TEXT to avoid overflow with crypto amounts

CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  vault_id TEXT DEFAULT '',
  name TEXT NOT NULL,
  key_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  address TEXT NOT NULL,
  public_key TEXT NOT NULL,
  wrapped_private_key TEXT,
  balance TEXT NOT NULL DEFAULT '0',
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB DEFAULT '{}',
  policy_ids JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  from_wallet_id TEXT NOT NULL,
  to_wallet_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  signature TEXT DEFAULT '',
  signed_payload TEXT DEFAULT '',
  policy_evaluations JSONB DEFAULT '[]',
  failure_reason TEXT,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  rules JSONB DEFAULT '[]',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vaults (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  permissions JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  is_managed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'officer',
  must_change_password BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  credential_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key BYTEA NOT NULL,
  counter INTEGER DEFAULT 0,
  transports JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  action TEXT NOT NULL,
  actor_id TEXT,
  actor_username TEXT,
  actor_role TEXT,
  target_type TEXT,
  target_id TEXT,
  details JSONB,
  hash TEXT NOT NULL,
  signature TEXT,
  prev_hash TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wallets_vault_id ON wallets(vault_id);
CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets(address);
CREATE INDEX IF NOT EXISTS idx_wallets_chain ON wallets(chain);
CREATE INDEX IF NOT EXISTS idx_transactions_from ON transactions(from_wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_to ON transactions(to_wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials(user_id);
