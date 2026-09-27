-- API v1: tenants (integrating platforms), their API keys, the permissions parties sign for them,
-- and the webhook outbox. None of these tables is ever joined into a public path.

CREATE TABLE IF NOT EXISTS tenants (
  tenant_id    TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only a SHA-256 hash of each key is stored; the key itself is shown once, when issued.
CREATE TABLE IF NOT EXISTS tenant_api_keys (
  key_hash     TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants (tenant_id),
  mode         TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  prefix       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tenant_api_keys_tenant ON tenant_api_keys (tenant_id);

-- A party's signed grant letting a tenant act for it within `scopes`. Never lets the tenant sign.
CREATE TABLE IF NOT EXISTS tenant_permissions (
  permission_id TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants (tenant_id),
  chain_id      TEXT NOT NULL,
  party         TEXT NOT NULL,
  scopes        INT  NOT NULL,
  expires_at    BIGINT NOT NULL,
  nonce         TEXT NOT NULL,
  signature     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  UNIQUE (tenant_id, chain_id, party, nonce)
);

CREATE INDEX IF NOT EXISTS tenant_permissions_lookup ON tenant_permissions (tenant_id, chain_id, party);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  tenant_id          TEXT PRIMARY KEY REFERENCES tenants (tenant_id),
  url                TEXT NOT NULL,
  secret             TEXT NOT NULL,
  previous_secret    TEXT,
  previous_expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id      TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants (tenant_id),
  type          TEXT NOT NULL,
  payload       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts      INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed'))
);

CREATE INDEX IF NOT EXISTS webhook_events_due ON webhook_events (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  event_id      TEXT NOT NULL REFERENCES webhook_events (event_id),
  attempt       INT  NOT NULL,
  status_code   INT,
  error         TEXT,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, attempt)
);

-- Replays of a POST with the same Idempotency-Key return the stored response.
CREATE TABLE IF NOT EXISTS api_idempotency (
  tenant_id     TEXT NOT NULL REFERENCES tenants (tenant_id),
  idem_key      TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  status_code   INT  NOT NULL,
  response      JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, idem_key)
);

ALTER TABLE netting_proposals ADD COLUMN IF NOT EXISTS created_by_tenant TEXT;
