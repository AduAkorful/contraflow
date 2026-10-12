-- A declining counterparty can leave a short reason for the proposer, and the party that did not
-- raise a dispute can leave a short reply. Both are free text of at most 200 characters, shown
-- only to the two parties like the rest of these rows. Re-runnable; apply before deploying the code
-- that writes them.
ALTER TABLE netting_proposals ADD COLUMN IF NOT EXISTS close_note TEXT;
ALTER TABLE netting_proposals DROP CONSTRAINT IF EXISTS netting_proposals_close_note_length;
ALTER TABLE netting_proposals ADD CONSTRAINT netting_proposals_close_note_length
  CHECK (close_note IS NULL OR char_length(close_note) <= 200);

ALTER TABLE netting_obligations ADD COLUMN IF NOT EXISTS dispute_reply TEXT;
ALTER TABLE netting_obligations ADD COLUMN IF NOT EXISTS dispute_replied_at TIMESTAMPTZ;
ALTER TABLE netting_obligations DROP CONSTRAINT IF EXISTS netting_obligations_dispute_reply_length;
ALTER TABLE netting_obligations ADD CONSTRAINT netting_obligations_dispute_reply_length
  CHECK (dispute_reply IS NULL OR char_length(dispute_reply) <= 200);
