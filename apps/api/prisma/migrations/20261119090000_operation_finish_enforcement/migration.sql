-- JLP-701 (#504 P7 PR4c-1): the database again refuses an admin command
-- that skips its finish. beginAdminOperation records a Phase7OperationIntent
-- row in its transaction and finishAdminOperation deletes it; the existing
-- deferred Phase7OperationIntent_must_finish trigger refuses a commit that
-- still holds the row. nihongo_app inserts three columns only; the backend and
-- transaction of the row are server defaults it cannot write, and it deletes
-- only the row of its own transaction.
-- Trusted execution kinds that nothing opens any more (ISSUE_V1,
-- REAUTHENTICATE, REFRESH, SIGN_OUT, PASSWORD_CHANGE, RESET_CONSUME,
-- RESET_ISSUE, ERASURE, FENCE_CLEANUP) are removed from five trigger
-- functions; every other condition stays. The SQL finish and the remember
-- helper have no caller and are dropped. The SQL audit digest stays as the
-- independent check that tests compare the API digest with.
-- Rollback: re-run the replaced and dropped definitions from
-- 20260827101000_phase7_admin_cms_foundation, 20261116090000_erasure_to_api,
-- 20261117090000_session_family_removal and
-- 20261118090000_erasure_request_to_api, restore the column defaults and
-- NOT NULL below, drop the trigger created below and revoke the grants below.
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
    RAISE EXCEPTION 'Operation finish migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

ALTER TABLE "Phase7OperationIntent"
  ALTER COLUMN "requestId" DROP NOT NULL,
  ALTER COLUMN "referencedUserIds" SET DEFAULT '{}'::UUID[],
  ALTER COLUMN "backendPid" SET DEFAULT pg_backend_pid(),
  ALTER COLUMN "transactionId" SET DEFAULT txid_current();
GRANT SELECT ("operationId"), INSERT ("operationId", "command", "environment"),
  DELETE
  ON TABLE "Phase7OperationIntent" TO "nihongo_app";

-- nihongo_app consumes only the intent of its own backend and transaction.
CREATE FUNCTION "limit_phase7_operation_intent_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  -- This function runs as its caller: current_user is nihongo_app only for a
  -- direct API statement.
  IF current_user = 'nihongo_app'
    AND (OLD."backendPid" <> pg_backend_pid()
      OR OLD."transactionId" <> txid_current()) THEN
    RAISE EXCEPTION 'Phase 7 operation intent belongs to another transaction.'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE TRIGGER "Phase7OperationIntent_limit_api_delete"
BEFORE DELETE ON "Phase7OperationIntent"
FOR EACH ROW EXECUTE FUNCTION "limit_phase7_operation_intent_delete"();

CREATE OR REPLACE FUNCTION "protect_phase7_account"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  legacy_disabled BOOLEAN;
  legacy_login TEXT := CASE
    WHEN current_database() ~ '_test$' THEN 'nihongo_test_legacy_app_login'
    WHEN current_database() ~ '_dev$' THEN 'nihongo_development_legacy_app_login'
    ELSE NULL
  END;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- #504 P7 PR4a: an erased User's Accounts go with the User delete, which
    -- User_limit_erasure_delete accepts only for a confirmed erasure.
    IF OLD."providerId" = 'credential'
      AND EXISTS (SELECT 1 FROM "User" WHERE "id" = OLD."userId") THEN
      RAISE EXCEPTION 'Credential Account delete is erasure-only.'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."accountId" <> OLD."accountId"
    OR NEW."providerId" <> OLD."providerId" OR NEW."userId" <> OLD."userId"
    OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'Account identity is insert-only.' USING ERRCODE = '23514';
  END IF;
  IF OLD."providerId" = 'credential' THEN
    IF SESSION_USER = legacy_login THEN
      SELECT "legacyIssuerDisabled" INTO legacy_disabled
      FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
      IF FOUND AND legacy_disabled IS NOT DISTINCT FROM false
        AND (to_jsonb(NEW) - 'password' - 'updatedAt') =
            (to_jsonb(OLD) - 'password' - 'updatedAt') THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'Credential Account update requires owned password authority.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION "protect_phase7_evidence_history"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  erasure_mode BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Phase 7 evidence delete is forbidden.'
      USING ERRCODE = '23514';
  END IF;
  -- #504 P7 PR4a: the API writes the tombstones of a confirmed erasure. This
  -- function runs as its caller, so current_user is nihongo_app only for a
  -- direct API statement. No other writer remains (#504 P7 PR4c-1).
  IF current_user = 'nihongo_app' THEN
    IF TG_TABLE_NAME = 'ContentReview' THEN
      erasure_mode :=
        (NEW."actorUserId" IS NOT DISTINCT FROM OLD."actorUserId"
          AND NEW."actorLabel" IS NOT DISTINCT FROM OLD."actorLabel"
          OR NEW."actorUserId" IS NULL
            AND NEW."actorLabel" IN ('DELETED_ADMIN', 'DELETED_USER')
            AND "phase7_user_erasure_confirmed"(OLD."actorId"))
        AND (NEW."counterpartUserId" IS NOT DISTINCT FROM OLD."counterpartUserId"
          AND NEW."counterpartLabel" IS NOT DISTINCT FROM OLD."counterpartLabel"
          OR NEW."counterpartUserId" IS NULL
            AND NEW."counterpartLabel" IN ('DELETED_ADMIN', 'DELETED_USER')
            AND "phase7_user_erasure_confirmed"(OLD."counterpartActorId"));
    ELSIF TG_TABLE_NAME = 'AdminAuditLog' THEN
      erasure_mode := NEW."actorUserId" IS NULL
        AND NEW."actorLabel" IN ('DELETED_ADMIN', 'DELETED_USER')
        AND "phase7_user_erasure_confirmed"(OLD."actorId");
    END IF;
  END IF;
  IF NOT erasure_mode THEN
    RAISE EXCEPTION 'Phase 7 evidence is append-only.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'ContentReview' AND (
    to_jsonb(NEW)
      - 'actorUserId' - 'actorLabel'
      - 'counterpartUserId' - 'counterpartLabel'
  ) <> (
    to_jsonb(OLD)
      - 'actorUserId' - 'actorLabel'
      - 'counterpartUserId' - 'counterpartLabel'
  ) THEN
    RAISE EXCEPTION 'ContentReview erasure tombstone changed immutable evidence.'
      USING ERRCODE = '23514';
  ELSIF TG_TABLE_NAME = 'AdminAuditLog' AND (
    to_jsonb(NEW) - 'actorUserId' - 'actorLabel'
  ) <> (
    to_jsonb(OLD) - 'actorUserId' - 'actorLabel'
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog erasure tombstone changed immutable evidence.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION "validate_phase7_session_write"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  user_row "User"%ROWTYPE;
  legacy_disabled BOOLEAN;
  trusted_delete BOOLEAN :=
    "phase7_trusted_execution_active"('ACTIVATE')
    OR "phase7_trusted_execution_active"('AUTHORITY_CHANGE');
  remember_session BOOLEAN := false;
  issued_at TIMESTAMPTZ(3);
  -- #504 P7 PR3a: the API writes owned V1 Sessions as nihongo_app.
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
  api_writer BOOLEAN := effective_caller = 'nihongo_app';
  api_reauthentication BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- #504 P7 PR4b-1: the API deletes V1 Sessions (sign-out, re-authentication
    -- rotation and cleanup, erasure). Before, it could already revoke any
    -- Session family and then delete that family's Sessions.
    IF NOT trusted_delete AND api_writer
      AND OLD."issuerProtocolVersion" = 'PHASE7_V1' THEN
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
    IF api_writer THEN
      -- #504 P7 PR3b-1: activation is one-way false to true
      -- (protect_phase7_auth_issuer_activation), so the API path reads it
      -- without a lock and keeps the User-first lock order.
      SELECT "legacyIssuerDisabled" INTO legacy_disabled
        FROM "AuthIssuerActivation" WHERE "id" = 1;
    ELSE
      SELECT "legacyIssuerDisabled" INTO legacy_disabled
        FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
    END IF;
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
    ELSE
      IF NOT api_writer THEN
        RAISE EXCEPTION 'PHASE7_V1 Session requires the owned issuer.'
          USING ERRCODE = '42501';
      END IF;
      IF legacy_disabled IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'V1 Session issuance requires activated authority.'
          USING ERRCODE = '42501';
      END IF;
      -- The API asks for 7 days when remembered and 1 day otherwise; the
      -- 3 day threshold is far from both, so clock rounding cannot flip it.
      remember_session := NEW."expiresAt" > clock_timestamp() + INTERVAL '3 days';
      -- #504 P7 PR3b-1: the API stages a PENDING_REAUTH replacement only for
      -- the User's live PREPARED intent in the same generation.
      api_reauthentication := NEW."authorizationState" = 'PENDING_REAUTH'
        AND EXISTS (
          SELECT 1 FROM "Phase7ReauthenticationIntent" AS intent
          WHERE intent."userId" = NEW."userId"
            AND intent."state" = 'PREPARED'
            AND intent."expiresAt" > clock_timestamp()
            AND intent."capturedAuthorityGeneration" = user_row."authorityGeneration"
        );
      IF (api_reauthentication
          AND NEW."authorizationState" <> 'PENDING_REAUTH')
        OR (NOT api_reauthentication
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

    IF NEW."authorityGeneration" <> user_row."authorityGeneration" THEN
      RAISE EXCEPTION 'Session generation authority is invalid.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" <> OLD."id" OR NEW."token" <> OLD."token"
    OR NEW."userId" <> OLD."userId"
    OR NEW."createdAt" <> OLD."createdAt"
    OR NEW."authorityGeneration" <> OLD."authorityGeneration"
    OR NEW."issuerProtocolVersion" <> OLD."issuerProtocolVersion" THEN
    RAISE EXCEPTION 'Session authority identity is immutable.'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."authorizationState" = 'PENDING_REAUTH'
    AND NEW."authorizationState" = 'ACTIVE'
    AND (api_writer AND EXISTS (
      -- #504 P7 PR3b-1: the API activates only the staged Session of a live
      -- STAGED intent.
      SELECT 1 FROM "Phase7ReauthenticationIntent" AS intent
      WHERE intent."stagedSessionId" = OLD."id"
        AND intent."userId" = OLD."userId"
        AND intent."state" = 'STAGED'
        AND intent."expiresAt" > clock_timestamp()
    )) THEN
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
    IF NOT (api_writer AND OLD."expiresAt" > OLD."createdAt" + INTERVAL '1 day'
        AND EXISTS (
          SELECT 1 FROM "User" AS refresh_user
          WHERE refresh_user."id" = OLD."userId"
            AND refresh_user."accountStatus" = 'ACTIVE'
            AND refresh_user."authorityGeneration" = OLD."authorityGeneration"
        )) THEN
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

CREATE OR REPLACE FUNCTION "validate_phase7_user_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  authority_invalidation BOOLEAN :=
    "phase7_trusted_execution_active"('AUTHORITY_CHANGE');
  revocation_reason "Phase7AuthorityRevocationReason";
  -- #504 P7 PR4b-2: the API records an SSO erasure request as nihongo_app.
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
BEGIN
  IF NEW."id" <> OLD."id" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'User identity is insert-only.' USING ERRCODE = '23514';
  END IF;
  IF NEW."role" IS DISTINCT FROM OLD."role"
    OR NEW."accountStatus" IS DISTINCT FROM OLD."accountStatus" THEN
    IF NOT authority_invalidation THEN
      -- Only ACTIVE to DELETION_PENDING, only that change, and only with the
      -- User's erasure request inserted in this transaction.
      IF effective_caller = 'nihongo_app'
        AND OLD."accountStatus" = 'ACTIVE'
        AND NEW."accountStatus" = 'DELETION_PENDING'
        AND NEW."role" IS NOT DISTINCT FROM OLD."role"
        AND (to_jsonb(NEW) - 'accountStatus') = (to_jsonb(OLD) - 'accountStatus')
        AND EXISTS (
          SELECT 1 FROM "SsoAccountErasureRequest"
          WHERE "userId" = OLD."id" AND "appStatus" = 'DELETION_PENDING'
            AND "completedAt" IS NULL AND "createdAt" >= now()
        ) THEN
        NEW."updatedAt" := clock_timestamp();
      ELSE
        RAISE EXCEPTION 'User role/status change requires owned authority.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM "QuestionVersion"
      WHERE "createdByActorId" = OLD."id"
        AND "status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
    ) THEN
      RAISE EXCEPTION 'Open candidate blocks role/status authority change.'
        USING ERRCODE = '23514';
    END IF;
    revocation_reason := CASE
      WHEN OLD."role" = 'ADMIN'
        AND (NEW."role" <> 'ADMIN' OR NEW."accountStatus" <> 'ACTIVE')
        THEN 'ADMIN_AUTHORITY_LOST'::"Phase7AuthorityRevocationReason"
      ELSE 'SESSION_INVALIDATED'::"Phase7AuthorityRevocationReason"
    END;
    PERFORM "phase7_record_authority_revocation"(
      OLD."id", revocation_reason
    );
    NEW."authorityGeneration" := OLD."authorityGeneration" + 1;
    DELETE FROM "Session" WHERE "userId" = OLD."id";
  ELSIF NEW."authorityGeneration" <> OLD."authorityGeneration"
    AND NOT authority_invalidation THEN
    RAISE EXCEPTION 'User authorityGeneration is server-owned.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION "validate_phase7_verification_write"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  legacy_disabled BOOLEAN;
  -- #504 P7 PR4a: the API deletes the reset intents of a confirmed erasure.
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."purpose" = 'PASSWORD_RESET_V1'
      AND NOT "phase7_trusted_execution_active"('ACTIVATE')
      AND NOT (effective_caller = 'nihongo_app'
        AND "phase7_user_erasure_confirmed"(OLD."resetUserId")) THEN
      RAISE EXCEPTION 'Password reset intent delete requires owned authority.'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  -- The API holds UPDATE on createdAt only to lock rows for erasure.
  IF TG_OP = 'UPDATE' AND NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Verification createdAt is insert-only.'
      USING ERRCODE = '23514';
  END IF;

  SELECT "legacyIssuerDisabled" INTO legacy_disabled
  FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth issuer activation singleton is missing.'
      USING ERRCODE = '42501';
  END IF;

  -- #504 P6a dropped password reset issuance, so no writer can add one.
  IF TG_OP = 'INSERT' AND NEW."purpose" = 'PASSWORD_RESET_V1' THEN
    RAISE EXCEPTION 'Password reset intent requires owned issuance.'
      USING ERRCODE = '42501';
  ELSIF TG_OP = 'INSERT' AND legacy_disabled THEN
    RAISE EXCEPTION 'Legacy Verification issuance is disabled.'
      USING ERRCODE = '42501';
  ELSIF TG_OP = 'UPDATE' AND (
    OLD."purpose" = 'PASSWORD_RESET_V1'
    OR NEW."purpose" = 'PASSWORD_RESET_V1'
  ) THEN
    RAISE EXCEPTION 'Password-reset Verification rows are fully immutable.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- Every function this migration replaces or creates keeps a fixed search_path.
DO $fixed_path$
DECLARE
  target_schema TEXT := pg_catalog.current_setting('app.phase7_target_schema', false);
  function_name TEXT;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'limit_phase7_operation_intent_delete',
    'protect_phase7_account',
    'protect_phase7_evidence_history',
    'validate_phase7_session_write',
    'validate_phase7_user_change',
    'validate_phase7_verification_write'
  ] LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      target_schema, function_name, target_schema
    );
  END LOOP;
END;
$fixed_path$;
REVOKE ALL ON FUNCTION "limit_phase7_operation_intent_delete"() FROM PUBLIC;

DROP FUNCTION "phase7_finish_admin_operation"(UUID);
DROP FUNCTION "phase7_finish_admin_operation_pre_reauthentication"(UUID);
DROP FUNCTION "phase7_trusted_execution_remember"();
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
