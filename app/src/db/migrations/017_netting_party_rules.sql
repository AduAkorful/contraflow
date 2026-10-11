-- A party's own netting rules: with the allowlist on, the party only nets in loops whose other
-- members are all on its approved list. Party-only, like the other netting tables: reached only
-- through session-gated actions, never joined into a public path. Re-runnable.
CREATE TABLE IF NOT EXISTS netting_party_rules (
  party             TEXT PRIMARY KEY,
  allowlist_enabled BOOLEAN NOT NULL DEFAULT false,
  allowed           TEXT[] NOT NULL DEFAULT '{}',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE netting_party_rules ENABLE ROW LEVEL SECURITY;
