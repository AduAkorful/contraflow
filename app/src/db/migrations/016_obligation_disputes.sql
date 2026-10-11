-- A party can mark an obligation disputed. A disputed obligation is left out of loop searches and
-- certificates (those read only `active` rows), and only the party that raised the dispute can
-- withdraw it. Re-runnable.
ALTER TABLE netting_obligations DROP CONSTRAINT IF EXISTS netting_obligations_status_check;
ALTER TABLE netting_obligations ADD CONSTRAINT netting_obligations_status_check
  CHECK (status IN ('active', 'closed', 'out_of_sync', 'disputed'));

ALTER TABLE netting_obligations ADD COLUMN IF NOT EXISTS disputed_by TEXT;
ALTER TABLE netting_obligations ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ;
ALTER TABLE netting_obligations ADD COLUMN IF NOT EXISTS dispute_note TEXT;
