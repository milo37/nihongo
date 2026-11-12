-- The last sign-in time of each member (JLP-852, operator decision,
-- 2026-11-12): a member who has not signed in for a year is erased with the
-- study records, through the existing erasure request and its 7-day grace.
-- Additions only; no existing table, function, trigger or grant changes, so
-- the previous API still passes its runtime role check against this schema
-- (a deploy rollback keeps the migration).
--   1. "UserSignIn": one row per member, the time of the last Session
--      issuance. It goes with the User row on erasure.
--   2. Every existing member gets a row with the time this migration runs,
--      so every existing member starts a fresh year. A member without a row
--      counts from the User creation time.
--   3. nihongo_app may read the rows and write the time at Session issuance.
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

CREATE TABLE "UserSignIn" (
    "userId" uuid NOT NULL,
    "lastLoginAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "UserSignIn_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "UserSignIn_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "User"(id) ON DELETE CASCADE
);

CREATE INDEX "UserSignIn_lastLoginAt_idx"
  ON "UserSignIn" USING btree ("lastLoginAt");

INSERT INTO "UserSignIn" ("userId", "lastLoginAt")
SELECT id, CURRENT_TIMESTAMP FROM "User";

GRANT SELECT ("userId", "lastLoginAt"), INSERT ("userId", "lastLoginAt"),
  UPDATE ("lastLoginAt")
  ON TABLE "UserSignIn" TO nihongo_app;

SET LOCAL ROLE "nihongo_migration";
COMMIT;
