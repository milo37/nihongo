-- JLP-701 (#504 P7 PR4a): account erasure runs in the API
-- (auth/accountErasureAuthority.ts) with the checks, lock order, tombstones
-- and audit rows of phase7_erase_user(_unchecked) and the User delete trigger
-- anonymize_question_creator_on_user_delete. The erasure worker queue
-- (complete, list, receipt status) and the expired QuestionReport description
-- redaction move with it. The SSO erasure request (Session family) and the
-- provider cleanup lease functions stay in SQL.
-- nihongo_app gets column grants for those reads and writes, and DELETE (a
-- table privilege in PostgreSQL) on User, Verification, AuthSessionFamily and
-- AuthSessionRotationFence. Every API write that erasure needs is accepted
-- only for a User whose erasure the database confirms
-- (phase7_user_erasure_confirmed): a completed provider-first request, or the
-- TEST-only direct erasure marker in a TEST database. A new User BEFORE DELETE
-- trigger replaces the anonymize trigger: it accepts only that confirmed
-- erasure, after every authored history row is tombstoned.
-- Rollback: re-run the dropped and replaced definitions from
-- 20260827101000_phase7_admin_cms_foundation,
-- 20260916120000_phase7_reauthentication_foundation,
-- 20261020230000_sso_account_lifecycle,
-- 20261028090000_sso_account_erasure_worker_queue,
-- 20261028120000_sso_account_erasure_claim_lease,
-- 20261114090000_session_issuance_to_api and 20261115090000_admin_fresh_to_api,
-- recreate User_anonymize_question_creator_before_delete, drop the triggers
-- created below and revoke the grants below.
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
    RAISE EXCEPTION 'Erasure API migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

-- The new User delete trigger limits which User rows can be deleted.
GRANT DELETE ON TABLE "User" TO "nihongo_app";
GRANT SELECT ("id", "legacyIssuerDisabled") ON TABLE "AuthIssuerActivation" TO "nihongo_app";
-- UPDATE on an insert-only column is for the FOR UPDATE erasure locks only;
-- the Account and Verification triggers refuse any change to it.
GRANT SELECT ("id", "resetUserId"), UPDATE ("createdAt"), DELETE
  ON TABLE "Verification" TO "nihongo_app";
GRANT SELECT ("id"), UPDATE ("createdAt") ON TABLE "Account" TO "nihongo_app";
GRANT DELETE ON TABLE "AuthSessionFamily", "AuthSessionRotationFence" TO "nihongo_app";
GRANT UPDATE ("actorUserId", "actorLabel", "counterpartUserId", "counterpartLabel")
  ON TABLE "ContentReview" TO "nihongo_app";
GRANT UPDATE ("actorUserId", "actorLabel") ON TABLE "AdminAuditLog" TO "nihongo_app";
GRANT SELECT (
    "id", "userId", "appStatus", "providerCleanup", "createdAt",
    "receiptDigest", "receiptExpiresAt"
  ),
  UPDATE ("appStatus", "completedAt")
  ON TABLE "SsoAccountErasureRequest" TO "nihongo_app";

-- A User whose erasure is confirmed: the provider-first request has completed
-- every provider cleanup, or this transaction marked the TEST-only direct
-- erasure of that User in a TEST database.
CREATE FUNCTION "phase7_user_erasure_confirmed"(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
  SELECT target_user_id IS NOT NULL AND (
    EXISTS (
      SELECT 1
      FROM "User" AS target
      JOIN "SsoAccountErasureRequest" AS request
        ON request."userId" = target."id"
      WHERE target."id" = target_user_id
        AND target."accountStatus" = 'DELETION_PENDING'
        AND request."appStatus" = 'DELETION_PENDING'
        AND jsonb_array_length(request."providerCleanup") > 0
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(request."providerCleanup") AS cleanup
          WHERE cleanup->>'status' IS DISTINCT FROM 'COMPLETED'
        )
    )
    OR (
      COALESCE(
        current_setting('nihongo.phase7_test_erasure_user', true) = target_user_id::TEXT,
        false
      )
      AND current_database() ~ '_test$'
      AND EXISTS (
        SELECT 1 FROM "Phase7DatabaseCapability"
        WHERE "id" = 1 AND "environment" = 'TEST'
          AND "databaseName" = current_database()
      )
    )
  )
$function$;

-- Replaces anonymize_question_creator_on_user_delete. The API tombstones the
-- authored history first; this accepts only a confirmed erasure by nihongo_app
-- with nothing left that names the User.
CREATE FUNCTION "limit_phase7_user_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
BEGIN
  IF effective_caller <> 'nihongo_app'
    OR NOT "phase7_user_erasure_confirmed"(OLD."id") THEN
    RAISE EXCEPTION 'User delete requires a matching owned erasure intent.'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
      SELECT 1 FROM "QuestionVersion"
      WHERE "createdByUserId" = OLD."id"
        OR ("createdByActorId" = OLD."id"
          AND "status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED'))
    )
    OR EXISTS (SELECT 1 FROM "Question" WHERE "createdByUserId" = OLD."id")
    OR EXISTS (
      SELECT 1 FROM "ContentReview"
      WHERE "actorUserId" = OLD."id" OR "counterpartUserId" = OLD."id"
    )
    OR EXISTS (SELECT 1 FROM "AdminAuditLog" WHERE "actorUserId" = OLD."id")
    OR EXISTS (
      SELECT 1 FROM "QuestionReport"
      WHERE "reporterUserId" = OLD."id" OR "assigneeUserId" = OLD."id"
    )
    OR EXISTS (SELECT 1 FROM "Session" WHERE "userId" = OLD."id") THEN
    RAISE EXCEPTION 'User erasure must tombstone authored history first.'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER "User_anonymize_question_creator_before_delete" ON "User";
CREATE TRIGGER "User_limit_erasure_delete"
BEFORE DELETE ON "User"
FOR EACH ROW EXECUTE FUNCTION "limit_phase7_user_delete"();

-- The API marks a request DELETED only after its User is erased. The SQL
-- provider cleanup functions never change appStatus or completedAt.
CREATE FUNCTION "limit_sso_account_erasure_request_update"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
BEGIN
  IF effective_caller = 'nihongo_app'
    AND (NEW."appStatus" IS DISTINCT FROM OLD."appStatus"
      OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt")
    AND NOT (
      OLD."appStatus" = 'DELETION_PENDING' AND NEW."appStatus" = 'DELETED'
      AND OLD."completedAt" IS NULL AND NEW."completedAt" IS NOT NULL
      AND NEW."userId" IS NULL
    ) THEN
    RAISE EXCEPTION 'SSO erasure request completes only after its User is erased.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "SsoAccountErasureRequest_limit_api_update"
BEFORE UPDATE ON "SsoAccountErasureRequest"
FOR EACH ROW EXECUTE FUNCTION "limit_sso_account_erasure_request_update"();

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
  -- direct API statement; trusted SQL paths run as the function owner.
  IF current_user <> 'nihongo_app' THEN
    erasure_mode := "phase7_trusted_execution_active"('ERASURE');
  ELSE
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

CREATE OR REPLACE FUNCTION "protect_phase7_account"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  erasure_mode BOOLEAN := "phase7_trusted_execution_active"('ERASURE');
  password_mode BOOLEAN :=
    "phase7_trusted_execution_active"('PASSWORD_CHANGE')
    OR "phase7_trusted_execution_active"('RESET_CONSUME');
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
    IF OLD."providerId" = 'credential' AND NOT erasure_mode
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
    IF NOT password_mode AND SESSION_USER = legacy_login THEN
      SELECT "legacyIssuerDisabled" INTO legacy_disabled
      FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
      IF FOUND AND legacy_disabled IS NOT DISTINCT FROM false
        AND (to_jsonb(NEW) - 'password' - 'updatedAt') =
            (to_jsonb(OLD) - 'password' - 'updatedAt') THEN
        RETURN NEW;
      END IF;
    END IF;
    IF NOT password_mode THEN
      RAISE EXCEPTION 'Credential Account update requires owned password authority.'
        USING ERRCODE = '42501';
    END IF;
    IF (to_jsonb(NEW) - 'password' - 'updatedAt') <>
       (to_jsonb(OLD) - 'password' - 'updatedAt') THEN
      RAISE EXCEPTION 'Credential Account only permits password updates.'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."password" IS DISTINCT FROM OLD."password" THEN
      PERFORM "phase7_record_authority_revocation"(
        OLD."userId", 'SESSION_INVALIDATED'
      );
      UPDATE "User"
      SET "authorityGeneration" = "authorityGeneration" + 1,
          "updatedAt" = clock_timestamp()
      WHERE "id" = OLD."userId";
      UPDATE "AuthSessionFamily" SET "status" = 'REVOKED'
      WHERE "userId" = OLD."userId" AND "status" = 'ACTIVE';
      DELETE FROM "Session" WHERE "userId" = OLD."userId";
    END IF;
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
  user_generation INTEGER;
  legacy_disabled BOOLEAN;
  -- #504 P7 PR4a: the API deletes the reset intents of a confirmed erasure.
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."purpose" = 'PASSWORD_RESET_V1'
      AND NOT "phase7_trusted_execution_active"('RESET_CONSUME')
      AND NOT "phase7_trusted_execution_active"('RESET_ISSUE')
      AND NOT "phase7_trusted_execution_active"('ERASURE')
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

  IF TG_OP = 'INSERT' AND NEW."purpose" = 'PASSWORD_RESET_V1' THEN
    IF NOT "phase7_trusted_execution_active"('RESET_ISSUE') THEN
      RAISE EXCEPTION 'Password reset intent requires owned issuance.'
        USING ERRCODE = '42501';
    END IF;
    SELECT "authorityGeneration" INTO user_generation FROM "User"
      WHERE "id" = NEW."resetUserId" AND "accountStatus" = 'ACTIVE'
      FOR SHARE;
    IF user_generation IS NULL
      OR NEW."capturedGeneration" IS DISTINCT FROM user_generation
      OR NEW."tokenSelector" IS NULL THEN
      RAISE EXCEPTION 'Password reset intent generation is stale.'
        USING ERRCODE = '42501';
    END IF;
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

CREATE OR REPLACE FUNCTION "protect_phase7_rotation_fence"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'AuthSessionRotationFence is immutable.' USING ERRCODE = '23514';
  END IF;
  -- #504 P7 PR4a: the API deletes the fences of a confirmed erasure. This
  -- function runs as its caller, so current_user is nihongo_app only for a
  -- direct API statement; trusted SQL cleanup runs as the function owner.
  IF current_user = 'nihongo_app' THEN
    IF NOT "phase7_user_erasure_confirmed"(OLD."userId") THEN
      RAISE EXCEPTION 'Rotation fence delete requires cleanup authority.'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT "phase7_trusted_execution_active"('FENCE_CLEANUP')
    AND NOT "phase7_trusted_execution_active"('ERASURE') THEN
    RAISE EXCEPTION 'Rotation fence delete requires cleanup authority.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT "phase7_trusted_execution_active"('ERASURE')
    AND EXISTS (
      SELECT 1 FROM "Session"
      WHERE "sessionFamilyId" = OLD."replacementFamilyId"
        AND "expiresAt" > clock_timestamp()
    ) THEN
    RAISE EXCEPTION 'Live replacement family still needs its rotation fence.'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
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
    -- #504 P7 PR4a: the API deletes the families of a confirmed erasure
    -- after it revoked them and deleted their Sessions and fences.
    IF NOT erasure_mode
      AND NOT "phase7_trusted_execution_active"('FENCE_CLEANUP')
      AND NOT (api_writer AND "phase7_user_erasure_confirmed"(OLD."userId")) THEN
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

CREATE OR REPLACE FUNCTION "limit_sso_admin_fresh_proof_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
BEGIN
  -- Trusted SQL paths (erasure, legacy cleanup) keep their own rules.
  IF effective_caller <> 'nihongo_app' THEN RETURN OLD; END IF;
  -- #504 P7 PR4a: a proof goes with its User when the API erases that User.
  IF NOT EXISTS (SELECT 1 FROM "User" WHERE "id" = OLD."userId") THEN
    RETURN OLD;
  END IF;
  IF NOT (OLD."completedSessionId" IS NULL OR OLD."expiresAt" <= clock_timestamp()) THEN
    RAISE EXCEPTION 'Only unfinished or expired ADMIN_FRESH proofs can be deleted.' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;

-- Every trigger function this migration replaces or creates, and the
-- confirmation check, keeps a fixed search_path like the existing functions.
DO $fixed_path$
DECLARE
  target_schema TEXT := pg_catalog.current_setting('app.phase7_target_schema', false);
  function_signature TEXT;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'phase7_user_erasure_confirmed(uuid)',
    'limit_phase7_user_delete()',
    'limit_sso_account_erasure_request_update()',
    'protect_phase7_evidence_history()',
    'protect_phase7_account()',
    'validate_phase7_verification_write()',
    'protect_phase7_rotation_fence()',
    'protect_phase7_session_family()',
    'limit_sso_admin_fresh_proof_delete()'
  ] LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %I.%s SET search_path TO pg_catalog, %I, pg_temp',
      target_schema, function_signature, target_schema
    );
  END LOOP;
END;
$fixed_path$;
REVOKE ALL ON FUNCTION
  "phase7_user_erasure_confirmed"(UUID),
  "limit_phase7_user_delete"(),
  "limit_sso_account_erasure_request_update"()
FROM PUBLIC;
-- The invoker triggers above call the check as nihongo_app.
GRANT EXECUTE ON FUNCTION "phase7_user_erasure_confirmed"(UUID) TO "nihongo_app";

DROP FUNCTION "phase7_complete_sso_account_erasure"(UUID, "AdminAuditEnvironment");
DROP FUNCTION "phase7_erase_user"(UUID, "AdminAuditEnvironment");
DROP FUNCTION "phase7_erase_user_unchecked"(UUID, "AdminAuditEnvironment");
DROP FUNCTION "anonymize_question_creator_on_user_delete"();
DROP FUNCTION "phase7_trusted_erasure_environment"();
DROP FUNCTION "phase7_list_sso_account_erasures"(INTEGER, "AdminAuditEnvironment");
DROP FUNCTION "phase7_sso_account_erasure_status"(TEXT);
DROP FUNCTION "phase7_redact_expired_report_descriptions"(INTEGER, "AdminAuditEnvironment");
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
