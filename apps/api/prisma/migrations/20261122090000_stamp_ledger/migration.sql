-- Stamp ledger (#1094, operator decisions 2026-11-17 and 2026-11-18): an
-- attendance stamp on the day a member's submitted answers reach their daily
-- goal. Stamps are only collected, never spent; rows are only added, never
-- changed or removed by the app. One row per member, day and reason; a later
-- reason only adds a "reason" value. No other object changes.
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

CREATE TABLE "StampLedger" (
    "id" uuid NOT NULL,
    "userId" uuid NOT NULL,
    -- The Asia/Seoul calendar day the row belongs to.
    "earnedOn" date NOT NULL,
    "reason" text NOT NULL,
    -- The daily goal when a DAILY_GOAL stamp was earned.
    "goalAtEarn" smallint,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "StampLedger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StampLedger_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "User"(id) ON DELETE CASCADE,
    CONSTRAINT "StampLedger_reason_check"
      CHECK ("reason" ~ '^[A-Z][A-Z0-9_]{0,31}$'),
    CONSTRAINT "StampLedger_userId_earnedOn_reason_key"
      UNIQUE ("userId", "earnedOn", "reason"),
    CONSTRAINT "StampLedger_daily_goal_check"
      CHECK ("reason" <> 'DAILY_GOAL' OR ("goalAtEarn" BETWEEN 10 AND 150
        AND "goalAtEarn" % 10 = 0))
);

GRANT SELECT ("id", "userId", "earnedOn", "reason", "goalAtEarn", "createdAt"),
  INSERT ("id", "userId", "earnedOn", "reason", "goalAtEarn")
  ON TABLE "StampLedger" TO nihongo_app;

SET LOCAL ROLE "nihongo_migration";
COMMIT;
