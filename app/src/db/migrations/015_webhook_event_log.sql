-- A readable event log. Events are now recorded for every tenant holding read permission, with or
-- without a webhook endpoint, so a tenant can page them with GET /events and catch up after an
-- outage. An event for a tenant that had no endpoint when it was recorded is never delivered later
-- (status no_endpoint). seq gives a stable cursor. Apply with scripts/migrate.mjs before deploying
-- the code that reads it.
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS seq BIGSERIAL;

CREATE INDEX IF NOT EXISTS webhook_events_tenant_seq ON webhook_events (tenant_id, seq);

ALTER TABLE webhook_events DROP CONSTRAINT IF EXISTS webhook_events_status_check;

ALTER TABLE webhook_events
  ADD CONSTRAINT webhook_events_status_check
  CHECK (status IN ('pending', 'delivered', 'failed', 'suppressed', 'no_endpoint'));
