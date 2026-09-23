-- Run once against Neon:
--   node --env-file=.env.local scripts/migrate.mjs
--
-- Deliberately not a foreign key to invoices(invoice_ref) — the document is created and hashed
-- before either signature exists, let alone before register() succeeds, so its lifecycle starts
-- earlier than an invoices row's.

CREATE TABLE IF NOT EXISTS invoice_documents (
  invoice_ref    TEXT PRIMARY KEY,
  description    TEXT NOT NULL,
  debtor         TEXT NOT NULL,
  creditor       TEXT NOT NULL,
  amount_usdc    TEXT NOT NULL,
  maturity       TEXT NOT NULL,
  created_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_documents_debtor_idx ON invoice_documents (debtor);
CREATE INDEX IF NOT EXISTS invoice_documents_creditor_idx ON invoice_documents (creditor);
