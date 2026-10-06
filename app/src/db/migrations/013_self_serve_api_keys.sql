-- A signed-in address owns at most one API tenant and creates its own test keys.
-- Operator-created tenants leave owner_address null. Apply with scripts/migrate.mjs;
-- do not point it at production from an agent session.
--
-- Row-level security is already on for tenants (011). This adds a column, not a table.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_address TEXT;

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_owner_address_hex;
ALTER TABLE tenants ADD CONSTRAINT tenants_owner_address_hex
  CHECK (owner_address IS NULL OR owner_address ~ '^0x[0-9a-f]{40}$');

CREATE UNIQUE INDEX IF NOT EXISTS tenants_owner_address_unique
  ON tenants (owner_address)
  WHERE owner_address IS NOT NULL;
