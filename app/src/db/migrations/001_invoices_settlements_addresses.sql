-- Run once against Neon:
--   node --env-file=.env.local scripts/migrate.mjs

CREATE TABLE IF NOT EXISTS invoices (
  invoice_ref          TEXT PRIMARY KEY,
  debtor                TEXT NOT NULL,
  creditor              TEXT NOT NULL,
  amount_usdc           NUMERIC NOT NULL,
  maturity              BIGINT NOT NULL,
  early_net_consent     BOOLEAN NOT NULL,
  status                TEXT NOT NULL,
  register_tx_hash      TEXT NOT NULL,
  settle_tx_hash        TEXT,
  w_net_usdc            NUMERIC,
  remaining_usdc        NUMERIC,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoices_debtor_idx ON invoices (debtor);
CREATE INDEX IF NOT EXISTS invoices_creditor_idx ON invoices (creditor);
CREATE INDEX IF NOT EXISTS invoices_settle_tx_hash_idx ON invoices (settle_tx_hash);

CREATE TABLE IF NOT EXISTS settlements (
  settle_tx_hash        TEXT PRIMARY KEY,
  block_number           BIGINT NOT NULL,
  w_net_usdc              NUMERIC NOT NULL,
  cycle_length            INTEGER NOT NULL,
  gas_paid_wei            NUMERIC NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS addresses (
  address                TEXT PRIMARY KEY,
  starter_grant_tx_hash   TEXT,
  starter_granted_at      TIMESTAMPTZ
);
