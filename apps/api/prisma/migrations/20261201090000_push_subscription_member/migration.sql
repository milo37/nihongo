-- Web push goal (#1046, operator-approved 2026-11-25): the daily push says
-- the member's daily goal, so a subscription belongs to a member. Adds the
-- member column, deleted with the member, and nothing else. The table must
-- be empty (no screen turned push on yet); it stops instead of deleting rows.
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

DO $empty$
BEGIN
  IF EXISTS (SELECT 1 FROM "PushSubscription") THEN
    RAISE EXCEPTION 'PushSubscription is not empty.' USING ERRCODE = '55000';
  END IF;
END;
$empty$;

ALTER TABLE "PushSubscription"
  ADD COLUMN "userId" uuid NOT NULL,
  ADD CONSTRAINT "PushSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE INDEX "PushSubscription_userId_idx"
  ON "PushSubscription" ("userId");

-- The same browser can be turned on by another member: the owner moves.
GRANT SELECT ("userId"), INSERT ("userId"), UPDATE ("userId")
  ON TABLE "PushSubscription" TO nihongo_app;

SET LOCAL ROLE "nihongo_migration";
COMMIT;
