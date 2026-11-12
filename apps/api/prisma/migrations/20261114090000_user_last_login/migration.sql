-- The last sign-in time of each member (JLP-852, operator decision,
-- 2026-11-12): a member who has not signed in for a year is erased with the
-- study records, through the existing erasure request and its 7-day grace.
-- Additions only; no existing function, trigger or constraint changes.
--   1. "User"."lastLoginAt": the database fills existing rows with the time
--      this migration runs, so every existing member starts a fresh year.
--      New members get their creation time.
--   2. An index for the hourly search of members past the year.
--   3. nihongo_app may read the column and set it when a session is issued.
BEGIN;
SELECT pg_catalog.set_config('app.target_schema', pg_catalog.current_schema(), true);
SELECT pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true);
DO $preflight$
DECLARE
  target_schema NAME := pg_catalog.current_setting('app.target_schema', false)::NAME;
  expected_wrapper TEXT := CASE
    WHEN pg_catalog.current_database() ~ '_test$' THEN 'nihongo_test_migration_login'
    WHEN pg_catalog.current_database() ~ '_dev$' THEN 'nihongo_development_migration_login'
    WHEN pg_catalog.current_database() = 'nihongo' THEN 'nihongo_production_migration_login'
    ELSE NULL END;
BEGIN
  IF expected_wrapper IS NULL OR SESSION_USER <> expected_wrapper
    OR CURRENT_USER <> 'nihongo_migration'
    OR pg_catalog.current_setting('session_replication_role') <> 'origin'
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace n
      JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
      WHERE n.nspname = target_schema AND r.rolname = 'nihongo_owner'
    ) THEN
    RAISE EXCEPTION 'Migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL check_function_bodies = false;
SET LOCAL ROLE "nihongo_owner";

ALTER TABLE "User"
  ADD COLUMN "lastLoginAt" timestamp(3) with time zone
    DEFAULT CURRENT_TIMESTAMP NOT NULL;

CREATE INDEX "User_lastLoginAt_idx" ON "User" USING btree ("lastLoginAt");

GRANT SELECT ("lastLoginAt"), UPDATE ("lastLoginAt")
  ON TABLE "User" TO nihongo_app;

SET LOCAL ROLE "nihongo_migration";
COMMIT;
