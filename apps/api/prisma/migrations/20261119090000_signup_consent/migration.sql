-- Sign-up consent records (#1085, operator decision, 2026-11-17): a member
-- confirms being 14 or older and having read the terms and the privacy
-- policy before the account exists; an existing member confirms once at the
-- next sign-in. Additions only; no existing table, function, trigger or grant
-- changes. A deploy rollback keeps this migration: the previous API never
-- reads the table.
--   1. "UserConsent": one row per member and terms version, with the time of
--      each confirmation. It goes with the User row on erasure.
--   2. No existing member gets a row: each confirms at the next sign-in.
--   3. nihongo_app may read the rows and add one; rows never change.
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

CREATE TABLE "UserConsent" (
    "userId" uuid NOT NULL,
    "termsVersion" text NOT NULL,
    "ageConfirmedAt" timestamp(3) with time zone NOT NULL,
    "termsConfirmedAt" timestamp(3) with time zone NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "UserConsent_pkey" PRIMARY KEY ("userId", "termsVersion"),
    CONSTRAINT "UserConsent_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "User"(id) ON DELETE CASCADE,
    CONSTRAINT "UserConsent_termsVersion_check"
      CHECK ("termsVersion" ~ '^[a-z0-9][a-z0-9.-]{0,31}$')
);

GRANT SELECT ("userId", "termsVersion", "ageConfirmedAt", "termsConfirmedAt",
    "createdAt"),
  INSERT ("userId", "termsVersion", "ageConfirmedAt", "termsConfirmedAt")
  ON TABLE "UserConsent" TO nihongo_app;

SET LOCAL ROLE "nihongo_migration";
COMMIT;
