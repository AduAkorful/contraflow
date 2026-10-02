-- API idempotency reservations need an owner token and expiry so a specifically recoverable
-- operation can take over a crashed worker without allowing the old worker to mutate afterward.
-- Existing pending rows intentionally get no expiry: a timeout alone cannot prove that their
-- underlying operation did not commit, so they require manual reconciliation.
ALTER TABLE api_idempotency ADD COLUMN IF NOT EXISTS lease_token TEXT;
ALTER TABLE api_idempotency ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS api_idempotency_expired_leases
  ON api_idempotency (lease_expires_at)
  WHERE status_code = 0 AND lease_expires_at IS NOT NULL;
