-- JLP-701 (#504 P6a): drop the retired email/password auth SQL functions.
-- The auth gateway allows only sign-out and the SSO paths (isAllowedOperation
-- in authGateway.ts); every email/password route answers 404 since JLP-483.
-- No API code calls these functions any more, and no live SQL function,
-- trigger or view depends on them. Sessions, triggers and grants are
-- unchanged; SSO session issuance, sign-out, refresh and cleanup stay until
-- #504 P6b.
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
    RAISE EXCEPTION 'Retired credential auth migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

DROP FUNCTION "phase7_resolve_sign_in_credential"(TEXT);
DROP FUNCTION "phase7_resolve_session_credential"(TEXT);
DROP FUNCTION "phase7_change_password_v1"(TEXT, TEXT, TEXT);
DROP FUNCTION "phase7_change_password_v1_pre_reauthentication"(TEXT, TEXT, TEXT);
DROP FUNCTION "phase7_change_password"(UUID, TEXT, TEXT);
DROP FUNCTION "phase7_request_password_reset"(TEXT, UUID, TEXT);
DROP FUNCTION "phase7_resolve_password_reset_credential"(TEXT);
DROP FUNCTION "phase7_consume_password_reset"(TEXT, TEXT);
DROP FUNCTION "phase7_sign_up_credential"(UUID, UUID, TEXT, TEXT, "JlptLevel", TEXT);
DROP FUNCTION "phase7_resolve_email_verification_subject"(TEXT);
DROP FUNCTION "phase7_verify_email"(UUID, TEXT);
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
