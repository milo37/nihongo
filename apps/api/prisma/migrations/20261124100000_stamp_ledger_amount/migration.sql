-- Stamp ledger amount (#1094, operator approval 2026-11-19): each row gets an
-- "amount" (a DAILY_GOAL row is always 1), and the one-row-per-member, day and
-- reason rule covers only rows that add stamps (amount > 0). A later row that
-- uses stamps (amount < 0) may then repeat on a day without changing the
-- index. The table, the other columns and the INSERT and SELECT only access
-- stay as 20261124090000_stamp_ledger made them.
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

ALTER TABLE "StampLedger"
  ADD COLUMN "amount" smallint DEFAULT 1 NOT NULL,
  ADD CONSTRAINT "StampLedger_amount_check"
    CHECK ("amount" <> 0 AND ("reason" <> 'DAILY_GOAL' OR "amount" = 1)),
  DROP CONSTRAINT "StampLedger_userId_earnedOn_reason_key";

CREATE UNIQUE INDEX "StampLedger_userId_earnedOn_reason_earn_key"
  ON "StampLedger" ("userId", "earnedOn", "reason")
  WHERE "amount" > 0;

GRANT SELECT ("amount"), INSERT ("amount") ON TABLE "StampLedger" TO nihongo_app;

SET LOCAL ROLE "nihongo_migration";
COMMIT;
