-- The administrator access record (JLP-842, operator decision B1,
-- 2026-11-12): who used an admin API, when, from which address, and which
-- path (the path names the member, report or question looked at). The
-- 「개인정보의 안전성 확보조치 기준」 article 8 keeps such records at least one
-- year. Additions only; no existing object changes.
--   1. "AdminAccessLog": nihongo_app inserts the actor, address, method, path
--      and request id; the database stamps the time. Ids are plain values, not
--      foreign keys, so a record outlives the erasure of either account.
--   2. A trigger refuses every UPDATE and every DELETE of a row younger than
--      13 months (one year plus a month of margin), for every role.
--   3. nihongo_app may read the id and time and delete expired rows (the
--      hourly guest cleanup job does).
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

CREATE TABLE "AdminAccessLog" (
    id uuid DEFAULT public.gen_random_uuid() NOT NULL,
    "actorId" uuid NOT NULL,
    "clientIp" character varying(64) NOT NULL,
    method character varying(8) NOT NULL,
    path character varying(512) NOT NULL,
    "requestId" uuid NOT NULL,
    "occurredAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "AdminAccessLog_pkey" PRIMARY KEY (id),
    CONSTRAINT "AdminAccessLog_clientIp_check" CHECK (
      "clientIp" = 'unresolved' OR "clientIp" ~ '^[0-9A-Fa-f:.]{2,45}$'),
    CONSTRAINT "AdminAccessLog_method_check" CHECK (
      method IN ('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS')),
    CONSTRAINT "AdminAccessLog_path_check" CHECK (
      path ~ '^/[\x21-\x7e]*$')
);

CREATE INDEX "AdminAccessLog_occurredAt_idx"
  ON "AdminAccessLog" USING btree ("occurredAt");
CREATE INDEX "AdminAccessLog_actorId_occurredAt_idx"
  ON "AdminAccessLog" USING btree ("actorId", "occurredAt" DESC);

CREATE FUNCTION protect_admin_access_log() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND OLD."occurredAt" <= pg_catalog.clock_timestamp() - INTERVAL '13 months' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Admin access record is kept for 13 months unchanged.'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "AdminAccessLog_protect_history"
  BEFORE DELETE OR UPDATE ON "AdminAccessLog"
  FOR EACH ROW EXECUTE FUNCTION protect_admin_access_log();

REVOKE ALL ON FUNCTION protect_admin_access_log() FROM PUBLIC;
GRANT INSERT ("actorId", "clientIp", method, path, "requestId")
  ON TABLE "AdminAccessLog" TO nihongo_app;
GRANT SELECT (id, "occurredAt") ON TABLE "AdminAccessLog" TO nihongo_app;
GRANT DELETE ON TABLE "AdminAccessLog" TO nihongo_app;

SET LOCAL ROLE "nihongo_migration";
COMMIT;
