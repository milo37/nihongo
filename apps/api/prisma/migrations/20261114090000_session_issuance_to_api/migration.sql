-- JLP-701 (#504 P7 PR3a): owned V1 Session issuance, refresh, sign-out and
-- principal resolution run in the API (auth/ownedSessionAuthority.ts) with the
-- lock order and conditions of the dropped functions. The Session family model
-- stays: the API creates the family in the same transaction as the Session.
-- nihongo_app gets column grants for those writes (Session.token is read
-- because the Session is found by its token, as better-auth does).
-- Session_validate_authority_write and AuthSessionFamily_protect_lifecycle keep
-- every trusted SQL path and also accept nihongo_app writes that meet the same
-- conditions: a V1 Session for an ACTIVE User with the current generation in
-- an ACTIVE family, a remembered refresh, a Session delete after its family was
-- revoked, a family insert for an ACTIVE User, and a family ACTIVE to REVOKED.
-- Every Session signs out once here, so no Session issued by the dropped SQL
-- issuer stays live; existing cookies answer AUTH_SESSION_EXPIRED.
-- Rollback: re-run the dropped and replaced definitions from
-- 20260827101000_phase7_admin_cms_foundation and
-- 20260916120000_phase7_reauthentication_foundation, and revoke the grants
-- below. Signed-out Sessions are not restored; users sign in again.
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
    RAISE EXCEPTION 'Session issuance API migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

GRANT SELECT ("name", "targetLevel") ON TABLE "User" TO "nihongo_app";
GRANT SELECT ("token", "updatedAt"),
  INSERT (
    "id", "expiresAt", "token", "createdAt", "updatedAt", "ipAddress",
    "userAgent", "userId", "sessionFamilyId", "authorityGeneration",
    "issuerProtocolVersion"
  ),
  UPDATE ("expiresAt", "updatedAt"),
  DELETE
  ON TABLE "Session" TO "nihongo_app";
GRANT INSERT ("id", "userId") ON TABLE "AuthSessionFamily" TO "nihongo_app";
GRANT SELECT ("id", "userId", "oldTokenDigest", "replacementFamilyId"),
  UPDATE ("expiresAt")
  ON TABLE "AuthSessionRotationFence" TO "nihongo_app";

CREATE OR REPLACE FUNCTION "validate_phase7_session_write"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  user_row "User"%ROWTYPE;
  family_row "AuthSessionFamily"%ROWTYPE;
  legacy_disabled BOOLEAN;
  trusted_reauthentication BOOLEAN :=
    "phase7_trusted_execution_active"('REAUTHENTICATE');
  trusted_v1 BOOLEAN :=
    "phase7_trusted_execution_active"('ISSUE_V1')
    OR trusted_reauthentication;
  trusted_refresh BOOLEAN := "phase7_trusted_execution_active"('REFRESH');
  trusted_delete BOOLEAN :=
    "phase7_trusted_execution_active"('SIGN_OUT')
    OR "phase7_trusted_execution_active"('ACTIVATE')
    OR trusted_reauthentication
    OR "phase7_trusted_execution_active"('PASSWORD_CHANGE')
    OR "phase7_trusted_execution_active"('RESET_CONSUME')
    OR "phase7_trusted_execution_active"('AUTHORITY_CHANGE')
    OR "phase7_trusted_execution_active"('FENCE_CLEANUP')
    OR "phase7_trusted_execution_active"('ERASURE');
  remember_session BOOLEAN := "phase7_trusted_execution_remember"();
  issued_at TIMESTAMPTZ(3);
  -- #504 P7 PR3a: the API writes owned V1 Sessions as nihongo_app.
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
  api_writer BOOLEAN := effective_caller = 'nihongo_app';
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT trusted_delete AND api_writer
      AND OLD."issuerProtocolVersion" = 'PHASE7_V1'
      AND EXISTS (
        SELECT 1 FROM "AuthSessionFamily"
        WHERE "id" = OLD."sessionFamilyId" AND "userId" = OLD."userId"
          AND "status" = 'REVOKED'
      ) THEN
      -- API sign-out revokes the family first, then deletes its Sessions.
      RETURN OLD;
    END IF;
    IF NOT trusted_delete THEN
      SELECT "legacyIssuerDisabled" INTO legacy_disabled
      FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
      IF NOT FOUND OR legacy_disabled IS DISTINCT FROM false
        OR OLD."issuerProtocolVersion" <> 'LEGACY' THEN
        RAISE EXCEPTION 'Session delete requires owned authority.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT "legacyIssuerDisabled" INTO legacy_disabled
      FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Auth issuer activation singleton is missing.'
        USING ERRCODE = '42501';
    END IF;
    SELECT * INTO user_row FROM "User" WHERE "id" = NEW."userId" FOR UPDATE;
    IF user_row."id" IS NULL OR user_row."accountStatus" <> 'ACTIVE' THEN
      RAISE EXCEPTION 'Session requires an active User.' USING ERRCODE = '42501';
    END IF;

    IF NEW."issuerProtocolVersion" = 'LEGACY' THEN
      IF legacy_disabled IS DISTINCT FROM false
        OR user_row."authorityGeneration" <> 1
        OR NEW."authorizationState" <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Legacy Session issuance is disabled.'
          USING ERRCODE = '42501';
      END IF;
      NEW."authorityGeneration" := 1;
      INSERT INTO "AuthSessionFamily" (
        "id", "userId", "status", "createdAt", "revokedAt"
      ) VALUES (
        NEW."sessionFamilyId", NEW."userId", 'ACTIVE', NEW."createdAt", NULL
      ) ON CONFLICT ("id") DO NOTHING;
    ELSE
      IF NOT trusted_v1 AND NOT api_writer THEN
        RAISE EXCEPTION 'PHASE7_V1 Session requires the owned issuer.'
          USING ERRCODE = '42501';
      END IF;
      IF NOT trusted_v1 THEN
        IF legacy_disabled IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'V1 Session issuance requires activated authority.'
            USING ERRCODE = '42501';
        END IF;
        -- The API asks for 7 days when remembered and 1 day otherwise; the
        -- 3 day threshold is far from both, so clock rounding cannot flip it.
        remember_session := NEW."expiresAt" > clock_timestamp() + INTERVAL '3 days';
      END IF;
      IF (trusted_reauthentication
          AND NEW."authorizationState" <> 'PENDING_REAUTH')
        OR (NOT trusted_reauthentication
          AND NEW."authorizationState" <> 'ACTIVE') THEN
        RAISE EXCEPTION 'Session authorization state does not match issuer.'
          USING ERRCODE = '42501';
      END IF;
      issued_at := clock_timestamp();
      NEW."createdAt" := issued_at;
      NEW."updatedAt" := issued_at;
      NEW."expiresAt" := issued_at
        + CASE WHEN remember_session
          THEN INTERVAL '7 days' ELSE INTERVAL '1 day' END;
      NEW."authorityGeneration" := user_row."authorityGeneration";
    END IF;

    SELECT * INTO family_row FROM "AuthSessionFamily"
      WHERE "id" = NEW."sessionFamilyId" AND "userId" = NEW."userId"
      FOR SHARE;
    IF family_row."id" IS NULL OR family_row."status" <> 'ACTIVE'
      OR NEW."authorityGeneration" <> user_row."authorityGeneration" THEN
      RAISE EXCEPTION 'Session family/generation authority is invalid.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" <> OLD."id" OR NEW."token" <> OLD."token"
    OR NEW."userId" <> OLD."userId"
    OR NEW."sessionFamilyId" <> OLD."sessionFamilyId"
    OR NEW."createdAt" <> OLD."createdAt"
    OR NEW."authorityGeneration" <> OLD."authorityGeneration"
    OR NEW."issuerProtocolVersion" <> OLD."issuerProtocolVersion" THEN
    RAISE EXCEPTION 'Session authority identity is immutable.'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."authorizationState" = 'PENDING_REAUTH'
    AND NEW."authorizationState" = 'ACTIVE'
    AND trusted_reauthentication THEN
    IF (to_jsonb(NEW) - 'authorizationState') <>
       (to_jsonb(OLD) - 'authorizationState') THEN
      RAISE EXCEPTION 'Pending Session activation may only change authority state.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."authorizationState" IS DISTINCT FROM OLD."authorizationState"
    OR OLD."authorizationState" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Session authorization state transition is invalid.'
      USING ERRCODE = '42501';
  END IF;
  IF OLD."issuerProtocolVersion" = 'LEGACY' THEN
    SELECT "legacyIssuerDisabled" INTO legacy_disabled
    FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
    IF NOT FOUND OR legacy_disabled IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'Legacy Session refresh is disabled.'
        USING ERRCODE = '42501';
    END IF;
    NEW."expiresAt" := LEAST(
      NEW."expiresAt", OLD."createdAt" + INTERVAL '30 days'
    );
  ELSE
    IF NOT (trusted_refresh AND remember_session)
      AND NOT (api_writer AND OLD."expiresAt" > OLD."createdAt" + INTERVAL '1 day') THEN
      RAISE EXCEPTION 'V1 Session refresh requires remembered owned context.'
        USING ERRCODE = '42501';
    END IF;
    NEW."updatedAt" := clock_timestamp();
    NEW."expiresAt" := LEAST(
      NEW."updatedAt" + INTERVAL '7 days',
      OLD."createdAt" + INTERVAL '30 days'
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION "protect_phase7_session_family"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  erasure_mode BOOLEAN := "phase7_trusted_execution_active"('ERASURE');
  legacy_nested_revoke BOOLEAN := false;
  trusted_family_write BOOLEAN :=
    "phase7_trusted_execution_active"('ISSUE_V1')
    OR "phase7_trusted_execution_active"('REAUTHENTICATE')
    OR "phase7_trusted_execution_active"('SIGN_OUT')
    OR "phase7_trusted_execution_active"('ACTIVATE')
    OR "phase7_trusted_execution_active"('PASSWORD_CHANGE')
    OR "phase7_trusted_execution_active"('RESET_CONSUME')
    OR "phase7_trusted_execution_active"('AUTHORITY_CHANGE')
    OR "phase7_trusted_execution_active"('FENCE_CLEANUP')
    OR erasure_mode;
  -- #504 P7 PR3a: the API issues and revokes families as nihongo_app.
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
  api_writer BOOLEAN := effective_caller = 'nihongo_app';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT trusted_family_write AND pg_trigger_depth() <= 1
      AND NOT (api_writer AND EXISTS (
        SELECT 1 FROM "User"
        WHERE "id" = NEW."userId" AND "accountStatus" = 'ACTIVE'
      )) THEN
      RAISE EXCEPTION 'AuthSessionFamily insert requires owned issuance.'
        USING ERRCODE = '42501';
    END IF;
    IF NEW."status" <> 'ACTIVE' OR NEW."revokedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'AuthSessionFamily must begin ACTIVE.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF NOT erasure_mode
      AND NOT "phase7_trusted_execution_active"('FENCE_CLEANUP') THEN
      RAISE EXCEPTION 'AuthSessionFamily delete requires owned cleanup.'
        USING ERRCODE = '23514';
    END IF;
    IF NOT erasure_mode AND (
      OLD."status" <> 'REVOKED'
      OR EXISTS (
        SELECT 1 FROM "Session"
        WHERE "sessionFamilyId" = OLD."id"
      )
      OR EXISTS (
        SELECT 1 FROM "AuthSessionRotationFence"
        WHERE "oldFamilyId" = OLD."id"
          OR "replacementFamilyId" = OLD."id"
      )
    ) THEN
      RAISE EXCEPTION 'Cleanup only removes empty, unfenced REVOKED families.'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NOT trusted_family_write
    AND pg_trigger_depth() > 1 THEN
    SELECT NOT "legacyIssuerDisabled" INTO legacy_nested_revoke
    FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
    legacy_nested_revoke := COALESCE(legacy_nested_revoke, false);
  END IF;
  IF NOT trusted_family_write AND NOT legacy_nested_revoke
    AND NOT api_writer THEN
    RAISE EXCEPTION 'AuthSessionFamily revoke requires owned authority.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."userId" <> OLD."userId"
    OR NEW."createdAt" <> OLD."createdAt"
    OR OLD."status" <> 'ACTIVE' OR NEW."status" <> 'REVOKED'
    OR OLD."revokedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'AuthSessionFamily is ACTIVE to REVOKED only.'
      USING ERRCODE = '23514';
  END IF;
  NEW."revokedAt" := clock_timestamp();
  RETURN NEW;
END;
$function$;

-- The replaced trigger functions keep their fixed search_path.
DO $fixed_path$
DECLARE
  target_schema TEXT := pg_catalog.current_setting('app.phase7_target_schema', false);
  function_name TEXT;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'validate_phase7_session_write', 'protect_phase7_session_family'
  ] LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      target_schema, function_name, target_schema
    );
  END LOOP;
END;
$fixed_path$;

-- One sign-out of every Session.
DO $sign_out$
DECLARE
  execution_id UUID := "phase7_open_trusted_execution"('SIGN_OUT', NULL, NULL);
BEGIN
  PERFORM 1 FROM "User" ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "AuthSessionFamily" ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "Session" ORDER BY "id" FOR UPDATE;
  UPDATE "AuthSessionFamily" SET "status" = 'REVOKED' WHERE "status" = 'ACTIVE';
  DELETE FROM "Session";
  IF EXISTS (SELECT 1 FROM "Session")
    OR EXISTS (SELECT 1 FROM "AuthSessionFamily" WHERE "status" = 'ACTIVE') THEN
    RAISE EXCEPTION 'One-time sign-out left a live Session.' USING ERRCODE = '23514';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
END;
$sign_out$;

DROP FUNCTION "phase7_issue_v1_session"(
  UUID, INTEGER, "UserRole", "UserAccountStatus", UUID, TEXT, TEXT, TEXT, BOOLEAN
);
DROP FUNCTION "phase7_owned_sign_out"(TEXT);
DROP FUNCTION "phase7_refresh_current_remembered_session"(TEXT);
DROP FUNCTION "phase7_refresh_remembered_session"(
  TEXT, INTEGER, "UserRole", "UserAccountStatus"
);
DROP FUNCTION "phase7_resolve_v1_principal"(TEXT);
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
