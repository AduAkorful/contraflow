-- Change log for API webhooks. Triggers record every new obligation and certificate and every
-- certificate status change, whichever path made it (the web app or the API), so no event is
-- missed. A background pass fans each change out to tenants holding a party's read permission.

CREATE TABLE IF NOT EXISTS netting_changes (
  change_id     BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('obligation', 'certificate')),
  ref_id        TEXT NOT NULL,
  chain_id      TEXT NOT NULL,
  status        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ
);

ALTER TABLE netting_changes ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS netting_changes_pending ON netting_changes (change_id) WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION record_obligation_change() RETURNS trigger AS $$
BEGIN
  INSERT INTO netting_changes (kind, ref_id, chain_id, status) VALUES ('obligation', NEW.obligation_id, NEW.chain_id, NEW.status);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_certificate_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO netting_changes (kind, ref_id, chain_id, status) VALUES ('certificate', NEW.certificate_id, NEW.chain_id, NEW.status);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS netting_obligations_change ON netting_obligations;
CREATE TRIGGER netting_obligations_change AFTER INSERT ON netting_obligations
  FOR EACH ROW EXECUTE FUNCTION record_obligation_change();

DROP TRIGGER IF EXISTS netting_certificates_change ON netting_certificates;
CREATE TRIGGER netting_certificates_change AFTER INSERT OR UPDATE OF status ON netting_certificates
  FOR EACH ROW EXECUTE FUNCTION record_certificate_change();
