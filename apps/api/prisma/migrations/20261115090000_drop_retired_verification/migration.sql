-- Drop the retired email Verification table (JLP-748, operator decision 7,
-- 2026-11-13): email sign-in was removed for SSO, and nothing writes the
-- table. The API from #675 (erasure checks the table exists first) must be
-- deployed before this migration is applied; an older image would fail
-- account erasure without the table.
--   1. The "Verification" table with its trigger, constraints, indexes and
--      grants. Any remaining rows are unused email tokens.
--   2. Its trigger function validate_verification_write().
--   3. The enum "AuthVerificationPurpose", used only by that table.
-- No other table, function or grant changes.
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

DROP TABLE "Verification";
DROP FUNCTION validate_verification_write();
DROP TYPE "AuthVerificationPurpose";

SET LOCAL ROLE "nihongo_migration";
COMMIT;
