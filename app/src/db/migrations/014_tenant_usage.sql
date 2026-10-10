-- Daily API usage counts per tenant, for the tenant's own usage view. Counts only: no request
-- contents, amounts or IPs. `party` is the acting party's lowercase address, or '' when a call
-- isn't tied to one. Apply with scripts/migrate.mjs; do not point it at production from an agent
-- session.

CREATE TABLE IF NOT EXISTS tenant_usage_daily (
  tenant_id    TEXT    NOT NULL REFERENCES tenants (tenant_id),
  day          DATE    NOT NULL,
  operation    TEXT    NOT NULL,
  party        TEXT    NOT NULL DEFAULT '',
  status_class TEXT    NOT NULL CHECK (status_class IN ('2xx', '4xx', '5xx')),
  error_code   TEXT    NOT NULL DEFAULT '',
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, day, operation, party, status_class, error_code)
);

-- Row-level security stays on for every table, with no policies (011).
ALTER TABLE tenant_usage_daily ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS tenant_usage_daily_by_day ON tenant_usage_daily (day);

ALTER TABLE tenant_api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
