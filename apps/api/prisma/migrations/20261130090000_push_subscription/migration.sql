-- Web push (#1046, operator-approved issue scope): one table of the browser
-- push subscriptions for the one daily notification. A row is the address and
-- keys a browser gave, kept with no user, session or IP; it is deleted when
-- the browser turns it off or the push service says it is gone. The app
-- writes it (subscribe, turn off, the daily send). No other object changes.
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

CREATE TABLE "PushSubscription" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    -- One browser on one device; the push service address.
    "endpoint" text NOT NULL,
    "p256dh" text NOT NULL,
    "auth" text NOT NULL,
    "locale" text NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    "updatedAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    -- The Asia/Seoul day of the last send; the send marks it first, so a
    -- device never gets two in one day.
    "lastSentDay" date,
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PushSubscription_endpoint_check"
      CHECK ("endpoint" ~ '^https://' AND char_length("endpoint") <= 1024),
    CONSTRAINT "PushSubscription_p256dh_check"
      CHECK ("p256dh" ~ '^[A-Za-z0-9_-]{87}$'),
    CONSTRAINT "PushSubscription_auth_check"
      CHECK ("auth" ~ '^[A-Za-z0-9_-]{22}$'),
    CONSTRAINT "PushSubscription_locale_check"
      CHECK ("locale" IN ('ko', 'ja'))
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key"
  ON "PushSubscription" ("endpoint");

GRANT SELECT ("id", "endpoint", "p256dh", "auth", "locale", "createdAt",
    "updatedAt", "lastSentDay"),
  INSERT ("endpoint", "p256dh", "auth", "locale"),
  UPDATE ("p256dh", "auth", "locale", "updatedAt", "lastSentDay"),
  DELETE
  ON TABLE "PushSubscription" TO nihongo_app;

SET LOCAL ROLE "nihongo_migration";
COMMIT;
