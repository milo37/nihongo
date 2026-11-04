-- JLP-701 (#504 P6b-1): drop the dead password re-authentication SQL functions.
-- POST /api/v1/admin/reauthentication answers 404 RESOURCE_NOT_FOUND without
-- touching the database (adminReauthenticationService.ts); the TS adapter
-- that called the adapter functions is deleted in the same change. No API
-- code, live SQL function body, trigger or constraint references these
-- functions. The intent tables, finalize/prepare/reconcile/abort and the
-- startup cleanup stay: SSO admin fresh sign-in still uses them. Grants
-- are unchanged.
-- Rollback: re-run the dropped definitions from
-- 20260827101000_phase7_admin_cms_foundation and
-- 20260916120000_phase7_reauthentication_foundation.
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
    RAISE EXCEPTION 'Dead reauthentication migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

DROP FUNCTION "phase7_reauthenticate_v1_session"(TEXT, INTEGER, "UserRole", "UserAccountStatus", UUID, TEXT, TEXT, TEXT, UUID, UUID, "AdminAuditEnvironment");
DROP FUNCTION "phase7_reauthentication_commit_matches"(TEXT, UUID, TEXT, UUID, UUID, "AdminAuditEnvironment", INTEGER, "UserRole", "UserAccountStatus");
DROP FUNCTION "phase7_reauthentication_adapter_session"(UUID, TEXT);
DROP FUNCTION "phase7_reauthentication_adapter_subject"(UUID, TEXT);
DROP FUNCTION "phase7_reauthentication_adapter_accounts"(UUID, UUID);
DROP FUNCTION "phase7_classify_reauthentication_authority"(TEXT);
DROP FUNCTION "phase7_abort_reauthentication_classified"(UUID, TEXT);
DROP FUNCTION "phase7_compensate_reauthentication"(UUID, TEXT);
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
