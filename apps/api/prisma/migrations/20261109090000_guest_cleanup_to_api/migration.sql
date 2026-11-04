-- JLP-701 (#504 P3): expired guest data cleanup runs in the API
-- (studyGuestCleanupBatch) as nihongo_app, which already holds the table
-- privileges it needs. Drop the cleanup facade and its helpers. No grant
-- changes; the nihongo_guest_cleanup_worker role is removed with the other
-- runtime roles later (#504 P7).
-- Rollback: re-run the three function definitions and grants from
-- 20261030100000_guest_expired_draft_retention.
BEGIN;
SELECT pg_catalog.set_config('app.phase7_target_schema', pg_catalog.current_schema(), true);
SELECT pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true);
DO $preflight$
DECLARE
  target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema', false)::NAME;
  expected_wrapper TEXT := CASE
    WHEN pg_catalog.current_database() ~ '_test$' THEN 'nihongo_test_phase7_migration_login'
    WHEN pg_catalog.current_database() ~ '_dev$' THEN 'nihongo_development_phase7_migration_login'
    ELSE NULL END;
BEGIN
  IF expected_wrapper IS NULL OR SESSION_USER <> expected_wrapper
    OR CURRENT_USER <> 'nihongo_phase7_migration'
    OR pg_catalog.current_setting('role', true) <> 'nihongo_phase7_migration'
    OR pg_catalog.current_setting('session_replication_role') <> 'origin'
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace n
      JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
      WHERE n.nspname = target_schema AND r.rolname = 'nihongo_phase7_owner'
    ) THEN
    RAISE EXCEPTION 'Guest cleanup API migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

DROP FUNCTION "phase7_guest_cleanup_batch"("AdminAuditEnvironment", INTEGER, BOOLEAN);
DROP FUNCTION "phase7_guest_cleanup_candidates"(TIMESTAMPTZ);
DROP FUNCTION "phase7_guest_cleanup_rate_window"(TEXT);
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
