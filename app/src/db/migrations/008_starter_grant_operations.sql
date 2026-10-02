-- Durable one-time starter grant reservation and recovery state. Do not delete ambiguous rows:
-- they prevent a retry from submitting a second value transfer.
CREATE TABLE IF NOT EXISTS starter_grant_operations (
  address TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'submitted', 'unknown', 'confirmed', 'reverted')),
  tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO starter_grant_operations (address, status, tx_hash)
SELECT lower(address), 'confirmed', starter_grant_tx_hash FROM addresses
WHERE starter_grant_tx_hash IS NOT NULL
ON CONFLICT (address) DO NOTHING;
