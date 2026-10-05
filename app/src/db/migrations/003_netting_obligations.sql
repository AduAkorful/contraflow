-- Run against the database with:
--   node --env-file=.env.local scripts/migrate.mjs
--
-- Mode B obligations. Both tables are party-only: read and written only through session-gated
-- actions that check the session address against the row's two parties, and never joined into
-- any public-by-address path (the same rule as invoice_documents).
--
-- netting_proposals holds a proposer's signed proposal behind a short link token until the
-- counterparty signs. netting_obligations holds fully signed obligations; remaining and
-- blinding are a cache of the ledger's onchain commitment, reconciled against it before use.

CREATE TABLE IF NOT EXISTS netting_proposals (
  token              TEXT PRIMARY KEY,
  obligation_id      TEXT NOT NULL UNIQUE,
  chain_id           TEXT NOT NULL,
  ledger             TEXT NOT NULL,
  proposer           TEXT NOT NULL,
  counterparty       TEXT NOT NULL,
  proposer_role      TEXT NOT NULL CHECK (proposer_role IN ('debtor', 'creditor')),
  obligation         JSONB NOT NULL,
  document           JSONB NOT NULL,
  proposer_signature TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'withdrawn')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  closed_by          TEXT,
  closed_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS netting_proposals_proposer_idx ON netting_proposals (proposer);
CREATE INDEX IF NOT EXISTS netting_proposals_counterparty_idx ON netting_proposals (counterparty);

CREATE TABLE IF NOT EXISTS netting_obligations (
  obligation_id      TEXT PRIMARY KEY,
  chain_id           TEXT NOT NULL,
  ledger             TEXT NOT NULL,
  document_hash      TEXT NOT NULL,
  debtor             TEXT NOT NULL,
  creditor           TEXT NOT NULL,
  currency           TEXT NOT NULL,
  amount             TEXT NOT NULL,
  maturity           TEXT NOT NULL,
  early_net_consent  BOOLEAN NOT NULL,
  salt               TEXT NOT NULL,
  debtor_signature   TEXT NOT NULL,
  creditor_signature TEXT NOT NULL,
  description        TEXT NOT NULL,
  remaining          TEXT NOT NULL,
  blinding           TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by          TEXT,
  closed_at          TIMESTAMPTZ,
  CONSTRAINT netting_obligations_document_unique UNIQUE (chain_id, ledger, debtor, creditor, document_hash)
);

CREATE INDEX IF NOT EXISTS netting_obligations_debtor_idx ON netting_obligations (debtor);
CREATE INDEX IF NOT EXISTS netting_obligations_creditor_idx ON netting_obligations (creditor);
CREATE INDEX IF NOT EXISTS netting_obligations_currency_idx ON netting_obligations (chain_id, ledger, currency, status);
