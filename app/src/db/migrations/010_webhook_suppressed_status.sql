-- A queued webhook may lose authorization before delivery. Record that terminal outcome
-- separately from a failed HTTP delivery so it is observable without retrying or sending data.
ALTER TABLE webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_status_check;

ALTER TABLE webhook_events
  ADD CONSTRAINT webhook_events_status_check
  CHECK (status IN ('pending', 'delivered', 'failed', 'suppressed'));
