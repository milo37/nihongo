-- JLP-701 (#504 P2): the operations console member list, detail and
-- restriction commands run in the API (adminMemberRepository) instead of
-- SECURITY DEFINER functions. The API masks email before it leaves the
-- repository. Grant nihongo_app the columns and tables those queries use,
-- then drop the five admin member functions. Tables, keys, indexes and CHECK
-- constraints stay.
-- Rollback: re-run the function definitions and grants from
-- 20261105090000_admin_member_console and revoke the grants below.
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
    RAISE EXCEPTION 'Admin member API migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

GRANT SELECT ("id", "email", "role", "accountStatus", "deletedAt", "createdAt")
  ON TABLE "User" TO "nihongo_app";
GRANT INSERT, DELETE ON TABLE "UserAccountRestriction" TO "nihongo_app";
GRANT SELECT, INSERT ON TABLE "UserAccountRestrictionEvent" TO "nihongo_app";

DROP FUNCTION "admin_set_member_restriction"(UUID, UUID, INTEGER, BOOLEAN, TEXT);
DROP FUNCTION "admin_get_member"(UUID, UUID);
DROP FUNCTION "admin_list_members"(UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER);
DROP FUNCTION "admin_assert_member_console_actor"(UUID);
DROP FUNCTION "admin_mask_member_email"(TEXT);
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
