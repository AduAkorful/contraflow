-- Run against the database with:
--   node --env-file=.env.local scripts/migrate.mjs
--
-- Short invoice share links (`/app/i/<token>`). The token is a handle, not access control: the
-- payload is returned only to a signed-in debtor or creditor. Legacy `/app/attest/<payload>`
-- links keep working. Row-level security is on with no policies (the lockdown rail).

CREATE TABLE IF NOT EXISTS invoice_links (
  token       TEXT PRIMARY KEY,
  payload     JSONB NOT NULL,
  debtor      TEXT NOT NULL,
  creditor    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS invoice_links_debtor_idx ON invoice_links (debtor);
CREATE INDEX IF NOT EXISTS invoice_links_creditor_idx ON invoice_links (creditor);

ALTER TABLE invoice_links ENABLE ROW LEVEL SECURITY;
