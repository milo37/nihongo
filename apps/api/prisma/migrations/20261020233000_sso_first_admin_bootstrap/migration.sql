-- Explicit dev/test operator bootstrap; historical migrations and runtime grants stay unchanged.
BEGIN;
SELECT pg_catalog.set_config('app.phase7_target_schema', pg_catalog.current_schema(), true);
SELECT pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true);
DO $preflight$
DECLARE
  target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema', false)::NAME;
  expected_wrapper TEXT := CASE
    WHEN pg_catalog.current_database() ~ '_test$' THEN 'nihongo_test_phase7_migration_login'
    WHEN pg_catalog.current_database() ~ '_dev$' THEN 'nihongo_development_phase7_migration_login'
    ELSE NULL END;
BEGIN
  IF expected_wrapper IS NULL OR SESSION_USER <> expected_wrapper
    OR CURRENT_USER <> 'nihongo_phase7_migration'
    OR pg_catalog.current_setting('role', true) <> 'nihongo_phase7_migration'
    OR pg_catalog.current_setting('session_replication_role') <> 'origin'
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace n
      JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
      WHERE n.nspname = target_schema AND r.rolname = 'nihongo_phase7_owner'
    ) THEN
    RAISE EXCEPTION 'First-admin migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

CREATE FUNCTION "phase7_bootstrap_first_google_admin"(
  target_user_id UUID,
  google_subject TEXT,
  expected_generation INTEGER,
  expected_schema TEXT,
  environment_value "AdminAuditEnvironment"
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  expected_wrapper TEXT;
  resolved_schema TEXT;
  target_user "User"%ROWTYPE;
  execution_id UUID;
  result_generation INTEGER;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_phase7_migration');
  expected_wrapper := CASE
    WHEN environment_value = 'TEST' AND current_database() ~ '_test$'
      THEN 'nihongo_test_phase7_migration_login'
    WHEN environment_value = 'DEVELOPMENT' AND current_database() ~ '_dev$'
      THEN 'nihongo_development_phase7_migration_login'
    ELSE NULL END;
  SELECT n.nspname INTO resolved_schema
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
  WHERE c.oid = '"User"'::regclass AND r.rolname = 'nihongo_phase7_owner';
  IF expected_wrapper IS NULL OR SESSION_USER <> expected_wrapper
    OR CURRENT_USER <> 'nihongo_phase7_owner'
    OR expected_schema IS NULL OR resolved_schema IS DISTINCT FROM expected_schema
    OR current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'First-admin operator target is not canonical.' USING ERRCODE = '42501';
  END IF;
  IF target_user_id IS NULL OR google_subject IS NULL
    OR char_length(google_subject) NOT BETWEEN 1 AND 255
    OR google_subject <> btrim(google_subject) OR google_subject ~ '[[:cntrl:]]'
    OR expected_generation IS NULL OR expected_generation NOT BETWEEN 1 AND 2147483646 THEN
    RAISE EXCEPTION 'First-admin target input is invalid.' USING ERRCODE = '22023';
  END IF;
  PERFORM "phase7_require_database_capability"(environment_value);
  -- Serializes first-admin decisions and canonical unlink before any User row lock.
  LOCK TABLE "User" IN EXCLUSIVE MODE;
  IF NOT EXISTS (
    SELECT 1 FROM "AuthIssuerActivation" WHERE "id" = 1 AND "legacyIssuerDisabled"
  ) THEN
    RAISE EXCEPTION 'First-admin bootstrap requires activated owned auth.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO target_user FROM "User" WHERE "id" = target_user_id FOR UPDATE;
  PERFORM 1 FROM "Account" WHERE "userId" = target_user_id ORDER BY "id" FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "User" WHERE "role" = 'ADMIN' AND "accountStatus" = 'ACTIVE') THEN
    RAISE EXCEPTION 'First-admin bootstrap is already closed.' USING ERRCODE = '42501';
  END IF;
  IF target_user."id" IS NULL OR target_user."role" <> 'USER'
    OR target_user."accountStatus" <> 'ACTIVE' OR target_user."deletedAt" IS NOT NULL
    OR target_user."authorityGeneration" <> expected_generation
    OR (SELECT count(*) FROM "Account" WHERE "userId" = target_user_id AND "providerId" = 'google') <> 1
    OR NOT EXISTS (
      SELECT 1 FROM "Account" WHERE "providerId" = 'google'
        AND "accountId" = google_subject AND "userId" = target_user_id
    ) THEN
    RAISE EXCEPTION 'First-admin linked target is unavailable or stale.' USING ERRCODE = '23514';
  END IF;

  execution_id := "phase7_open_trusted_execution"('AUTHORITY_CHANGE', target_user_id, NULL);
  UPDATE "User" SET "role" = 'ADMIN', "updatedAt" = clock_timestamp()
  WHERE "id" = target_user_id AND "role" = 'USER' AND "accountStatus" = 'ACTIVE'
    AND "deletedAt" IS NULL AND "authorityGeneration" = expected_generation
  RETURNING "authorityGeneration" INTO result_generation;
  IF result_generation IS DISTINCT FROM expected_generation + 1 THEN
    RAISE EXCEPTION 'First-admin authority compare-and-swap failed.' USING ERRCODE = '40001';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN result_generation;
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_bootstrap_first_google_admin"(
  UUID,TEXT,INTEGER,TEXT,"AdminAuditEnvironment"
) FROM PUBLIC,"nihongo_app","nihongo_auth_gateway","nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_bootstrap_first_google_admin"(
  UUID,TEXT,INTEGER,TEXT,"AdminAuditEnvironment"
) TO "nihongo_phase7_migration";
DO $harden_first_admin$
DECLARE target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema',false)::NAME;
BEGIN
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %I."phase7_bootstrap_first_google_admin"(UUID,TEXT,INTEGER,TEXT,%I."AdminAuditEnvironment") SET search_path TO pg_catalog, %I, pg_temp',
    target_schema,target_schema,target_schema
  );
END;
$harden_first_admin$;
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
