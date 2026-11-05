-- JLP-701 (#504 P7 PR2): admin operation authority runs in the API.
-- The API transaction keeps the order and conditions of the retired
-- phase7_begin_admin_operation: the isolation per command, the referenced
-- User set, Users locked FOR UPDATE in id order, then the actor Session family
-- and Session FOR UPDATE, the authority conditions and the SSO fresh check, and
-- the same re-check before commit (adminOperationAuthority.ts).
-- nihongo_app gets column SELECT on the authority columns (never Session.token)
-- and one UPDATE column per table, which PostgreSQL requires for FOR UPDATE.
-- Direct writes stay blocked by the existing guard triggers. The capability
-- check function becomes executable by nihongo_app.
-- phase7_finish_admin_operation and Phase7OperationIntent stay for the SQL
-- callers (SSO admin fresh finalize, author erasure). The SSO fresh triggers
-- on Phase7OperationIntent only checked rows with requiresFresh, which only
-- the dropped begin inserted.
-- Rollback: re-run the dropped definitions from
-- 20260827101000_phase7_admin_cms_foundation,
-- 20260916120000_phase7_reauthentication_foundation and
-- 20261019103000_sso_admin_fresh, and revoke the grants below.
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
    RAISE EXCEPTION 'Admin operation API migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

GRANT SELECT ("authorityGeneration"), UPDATE ("authorityGeneration")
  ON TABLE "User" TO "nihongo_app";
GRANT SELECT (
    "id", "userId", "sessionFamilyId", "issuerProtocolVersion",
    "authorityGeneration", "expiresAt", "createdAt", "authorizationState"
  ), UPDATE ("authorizationState")
  ON TABLE "Session" TO "nihongo_app";
GRANT SELECT ("id", "userId", "status"), UPDATE ("status")
  ON TABLE "AuthSessionFamily" TO "nihongo_app";
GRANT EXECUTE ON FUNCTION
  "phase7_require_database_capability"("AdminAuditEnvironment")
TO "nihongo_app";

DROP TRIGGER "Phase7OperationIntent_sso_fresh_admission" ON "Phase7OperationIntent";
DROP TRIGGER "Phase7OperationIntent_sso_fresh_commit" ON "Phase7OperationIntent";
DROP FUNCTION "phase7_begin_admin_operation"(
  "AdminAuditCommand", TEXT, UUID, "AdminAuditEnvironment", UUID[]
);
DROP FUNCTION "phase7_begin_admin_operation_pre_reauthentication"(
  "AdminAuditCommand", TEXT, UUID, "AdminAuditEnvironment", UUID[]
);
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
