-- #702 follow-up (operator-approved 2026-11-19): an erasure re-applied after
-- a restore keeps its original deadline, the original request time plus the
-- 7-day grace, instead of starting a new grace period.
-- The API still records the request as a member's own request does (the
-- insert trigger stamps "createdAt" with the current time, and
-- validate_user_change needs a request from this transaction); this new
-- function then moves that fresh request's "createdAt" back to the original
-- request time. Only nihongo_app may call it. It refuses a future time and a
-- time older than 31 days (the logs that carry the time keep 30 days).
-- New objects only; no existing migration, function or grant changes.
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

CREATE FUNCTION backdate_reapplied_sso_erasure_request(
  target_user_id uuid, requested_at timestamptz
) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
  moved INTEGER;
BEGIN
  PERFORM "require_runtime_ready"();
  IF effective_caller <> 'nihongo_app' THEN
    RAISE EXCEPTION 'Only the API may backdate a re-applied erasure.'
      USING ERRCODE = '42501';
  END IF;
  IF target_user_id IS NULL OR requested_at IS NULL
    OR requested_at > clock_timestamp()
    OR requested_at < clock_timestamp() - INTERVAL '31 days' THEN
    RAISE EXCEPTION 'Re-applied erasure time is out of bounds.'
      USING ERRCODE = '22023';
  END IF;
  -- Only the request this transaction just recorded for a pending User.
  UPDATE "SsoAccountErasureRequest" AS request
  SET "createdAt" = requested_at
  WHERE request."userId" = target_user_id
    AND request."appStatus" = 'DELETION_PENDING'
    AND request."completedAt" IS NULL
    AND request."leaseToken" IS NULL
    AND request."leaseExpiresAt" IS NULL
    AND request."createdAt" >= now()
    AND EXISTS (
      SELECT 1 FROM "User" AS target
      WHERE target."id" = target_user_id
        AND target."accountStatus" = 'DELETION_PENDING'
    );
  GET DIAGNOSTICS moved = ROW_COUNT;
  IF moved <> 1 THEN
    RAISE EXCEPTION 'No erasure request was recorded in this transaction.'
      USING ERRCODE = '55000';
  END IF;
  RETURN true;
END;
$$;

DO $fixed_path$
DECLARE
  target_schema TEXT := pg_catalog.current_setting('app.target_schema', false);
  function_oid OID;
BEGIN
  FOR function_oid IN
    SELECT procedure_record.oid
    FROM pg_catalog.pg_proc AS procedure_record
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure_record.pronamespace
    WHERE namespace.nspname = target_schema
      AND procedure_record.proname = 'backdate_reapplied_sso_erasure_request'
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET search_path TO pg_catalog, %I, pg_temp',
      function_oid::REGPROCEDURE, target_schema
    );
  END LOOP;
END;
$fixed_path$;

REVOKE ALL ON FUNCTION backdate_reapplied_sso_erasure_request(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION backdate_reapplied_sso_erasure_request(uuid, timestamptz) TO nihongo_app;

SET LOCAL ROLE "nihongo_migration";
COMMIT;
