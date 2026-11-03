-- #484 additive: temporary member account restriction (sign-in stays allowed;
-- new study sessions and new reports are refused with ACCOUNT_RESTRICTED).
-- New table only; no existing table, constraint, trigger or grant changes.
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
    RAISE EXCEPTION 'Account restriction migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

-- One row per restricted member; lifting the restriction deletes the row.
CREATE TABLE "UserAccountRestriction" (
  "userId" UUID PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "reason" TEXT NOT NULL CHECK (char_length("reason") BETWEEN 1 AND 500),
  "restrictedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp()
);

REVOKE ALL ON TABLE "UserAccountRestriction" FROM PUBLIC,
  "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
GRANT SELECT ON TABLE "UserAccountRestriction" TO "nihongo_app";
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
