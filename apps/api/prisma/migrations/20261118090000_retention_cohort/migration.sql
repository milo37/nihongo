-- Daily return counts by first-set day (#1042, W1 after launch): numbers
-- only, no member or guest identifier. Additions only; no existing table,
-- function, trigger or grant changes. A deploy rollback keeps this
-- migration: the previous API never reads the table.
--   1. "RetentionCohort": one row per Korea-time first-set day and audience
--      (MEMBER or GUEST). Two days on: the cohort size and how many started
--      a set again on the next day. Eight days on: the cohort size at that
--      reading and how many came back on day 7 and on any day 1 to 7. Each
--      step is written once from one reading of the sets and never changed.
--   2. nihongo_app may read the rows, add them and fill the day-7 step once.
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

CREATE TABLE "RetentionCohort" (
    "cohortDate" date NOT NULL,
    audience text NOT NULL,
    "cohortSize" integer NOT NULL,
    "day1Returned" integer NOT NULL,
    "weekCohortSize" integer,
    "day7Returned" integer,
    "week1Returned" integer,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "RetentionCohort_pkey" PRIMARY KEY ("cohortDate", audience),
    CONSTRAINT "RetentionCohort_audience_check"
      CHECK (audience IN ('MEMBER', 'GUEST')),
    CONSTRAINT "RetentionCohort_next_day_check"
      CHECK ("day1Returned" BETWEEN 0 AND "cohortSize"),
    CONSTRAINT "RetentionCohort_week_check" CHECK (
      ("weekCohortSize" IS NULL AND "day7Returned" IS NULL
        AND "week1Returned" IS NULL)
      OR ("day7Returned" BETWEEN 0 AND "week1Returned"
        AND "week1Returned" BETWEEN 0 AND "weekCohortSize")
    )
);

GRANT SELECT, INSERT ("cohortDate", audience, "cohortSize", "day1Returned"),
  UPDATE ("weekCohortSize", "day7Returned", "week1Returned")
  ON TABLE "RetentionCohort" TO nihongo_app;

SET LOCAL ROLE "nihongo_migration";
COMMIT;
