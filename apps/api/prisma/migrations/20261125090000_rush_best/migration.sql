-- Rush best score (#1043, operator decisions 2026-11-19 and 2026-11-20): a
-- member's best score in a 30-second rush, one row per member, mode and
-- level. Members only. The app adds a row or raises "best"; it never lowers
-- or removes one. Erasing the member removes the rows through the foreign
-- key. A later game only adds a "mode" value. No other object changes.
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

CREATE TABLE "RushBest" (
    "userId" uuid NOT NULL,
    "mode" text NOT NULL,
    "level" "JlptLevel" NOT NULL,
    "best" smallint NOT NULL,
    "achievedAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "RushBest_pkey" PRIMARY KEY ("userId", "mode", "level"),
    CONSTRAINT "RushBest_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "User"(id) ON DELETE CASCADE,
    CONSTRAINT "RushBest_mode_check"
      CHECK ("mode" ~ '^[A-Z][A-Z0-9_]{0,31}$'),
    CONSTRAINT "RushBest_best_check" CHECK ("best" BETWEEN 0 AND 60)
);

GRANT SELECT ("userId", "mode", "level", "best", "achievedAt"),
  INSERT ("userId", "mode", "level", "best"),
  UPDATE ("best", "achievedAt")
  ON TABLE "RushBest" TO nihongo_app;

SET LOCAL ROLE "nihongo_migration";
COMMIT;
