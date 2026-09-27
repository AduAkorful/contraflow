-- Run once against Neon:
--   node --env-file=.env.local scripts/migrate.mjs
--
-- Mode B netting certificates. Party-only, like 003: read and written only through
-- session-gated actions that check the session against the certificate's parties.
--
-- full_view holds the whole certificate: every entry's amounts and blindings. It is server-only;
-- each party only ever receives its own view (its two obligations in full, the rest as hashes).
--
-- The partial unique index on netting_certificate_entries is the lock: an obligation can be in at
-- most one open (collecting or ready) certificate. Every status change that closes a certificate
-- sets locked = false in the same transaction.
--
-- out_of_sync marks an obligation whose stored state disagrees with the ledger. It is never
-- netted again from the stored state.

ALTER TABLE netting_obligations DROP CONSTRAINT IF EXISTS netting_obligations_status_check;
ALTER TABLE netting_obligations ADD CONSTRAINT netting_obligations_status_check
  CHECK (status IN ('active', 'closed', 'out_of_sync'));

CREATE TABLE IF NOT EXISTS netting_certificates (
  certificate_id  TEXT PRIMARY KEY,
  token           TEXT NOT NULL UNIQUE,
  chain_id        TEXT NOT NULL,
  ledger          TEXT NOT NULL,
  currency        TEXT NOT NULL,
  w_net           TEXT NOT NULL,
  deadline        TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  full_view       JSONB NOT NULL,
  proposed_by     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'collecting'
                  CHECK (status IN ('collecting', 'ready', 'applied', 'expired', 'abandoned')),
  applied_tx_hash TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ,
  closed_reason   TEXT
);

CREATE TABLE IF NOT EXISTS netting_certificate_entries (
  certificate_id  TEXT NOT NULL REFERENCES netting_certificates (certificate_id),
  idx             INT  NOT NULL,
  obligation_id   TEXT NOT NULL REFERENCES netting_obligations (obligation_id),
  debtor          TEXT NOT NULL,
  creditor        TEXT NOT NULL,
  locked          BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (certificate_id, idx)
);

CREATE UNIQUE INDEX IF NOT EXISTS netting_certificate_entries_lock
  ON netting_certificate_entries (obligation_id) WHERE locked;
CREATE INDEX IF NOT EXISTS netting_certificate_entries_debtor_idx ON netting_certificate_entries (debtor);
CREATE INDEX IF NOT EXISTS netting_certificate_entries_creditor_idx ON netting_certificate_entries (creditor);

CREATE TABLE IF NOT EXISTS netting_certificate_signatures (
  certificate_id  TEXT NOT NULL REFERENCES netting_certificates (certificate_id),
  idx             INT  NOT NULL,
  signer          TEXT NOT NULL,
  signature       TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (certificate_id, idx)
);
