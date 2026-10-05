-- The app reaches this database only through its own connection string, as the table owner. Supabase
-- also exposes the `public` schema through its Data API (PostgREST) to the `anon` and `authenticated`
-- roles, and these tables hold party-only data and secrets (invoice descriptions, obligations,
-- API-key hashes, webhook signing secrets). Close that door at the database, whatever the project's
-- Data API setting is:
--   1. row-level security on every table, with no policies, so no role except the owner reads a row;
--   2. no table, sequence or function privileges for `anon` and `authenticated`, now or by default.
-- Safe to re-run, and a no-op for the role changes on a database without Supabase's roles. Every new
-- table in a later migration must `ENABLE ROW LEVEL SECURITY` too; `test/db.integration.test.ts`
-- fails if any table in `public` has it off.

DO $$
DECLARE
  t record;
  r text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;

  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;

  -- Functions are executable by PUBLIC unless that is revoked; the change-capture trigger functions run
  -- as triggers, which don't need the caller to hold EXECUTE.
  EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC';
END
$$;
