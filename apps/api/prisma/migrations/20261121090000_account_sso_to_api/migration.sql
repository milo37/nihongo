-- JLP-701 (#504 P7 PR5a): SSO account fresh, link, unlink and provider
-- cleanup run in the API (auth/ssoAccountAuthority.ts) with the checks, lock
-- order and answers of the SQL functions dropped below.
-- An API SSO Account delete (unlink) steps the User authority generation from
-- the Account trigger; the User trigger accepts only that step and records the
-- revocation and deletes the Sessions itself. An API link is accepted only
-- from the User's staged ACCOUNT_LINK proof. The pre-fencing provider cleanup
-- recorders, revoked from every role since 20261028150000, are dropped too.
-- phase7_change_user_authority had no product caller; its TEST-only
-- replacement is accepted only in a TEST database.
-- After this nothing opens trusted execution; #504 P7 PR5b drops it.
-- Rollback: re-run the replaced and dropped definitions from
-- 20260916120000_phase7_reauthentication_foundation,
-- 20261020230000_sso_account_lifecycle,
-- 20261028150000_sso_provider_cleanup_fencing,
-- 20261117090000_session_family_removal,
-- 20261118090000_erasure_request_to_api,
-- 20261119090000_operation_finish_enforcement and
-- 20261120090000_trusted_execution_users, and revoke the grants below.
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
    RAISE EXCEPTION 'Account SSO API migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

GRANT INSERT ("id", "providerId", "accountId", "userId", "createdAt", "updatedAt"),
  DELETE
  ON TABLE "Account" TO "nihongo_app";
GRANT SELECT (
    "provider", "stateDigest", "bindingDigest", "nonce", "codeVerifier",
    "callbackURL", "context", "expiresAt"
  ),
  INSERT (
    "provider", "stateDigest", "bindingDigest", "nonce", "codeVerifier",
    "callbackURL", "context", "userId", "createdAt", "expiresAt"
  )
  ON TABLE "SsoAccountFreshTransaction" TO "nihongo_app";
GRANT SELECT ("callbackURL", "createdAt"),
  INSERT (
    "proofDigest", "context", "userId", "callbackURL", "createdAt", "expiresAt"
  ),
  UPDATE ("verifiedAt", "expiresAt")
  ON TABLE "SsoAccountFreshProof" TO "nihongo_app";
GRANT SELECT ("leaseToken", "leaseExpiresAt", "activeProvider"),
  UPDATE ("leaseToken", "leaseExpiresAt", "activeProvider", "providerCleanup")
  ON TABLE "SsoAccountErasureRequest" TO "nihongo_app";

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
  test_change TEXT[];
  -- #504 P7 PR4b-2: the API records an SSO erasure request as nihongo_app.
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
BEGIN
  -- #504 P7 PR5a: the TEST-only authority change of one User
  -- (db/fixtures/userAuthorityChange.ts), accepted only in a TEST database
  -- with a TEST capability, like the TEST-only erasure. The marker names the
  -- User, role and status; nihongo_app holds no User role privilege.
  test_change := string_to_array(
    current_setting('nihongo.phase7_test_authority_change', true), ':'
  );
  IF NOT authority_invalidation
    AND effective_caller = 'nihongo_app'
    AND cardinality(test_change) = 3
    AND test_change[1] = OLD."id"::TEXT
    AND current_database() ~ '_test$'
    AND EXISTS (
      SELECT 1 FROM "Phase7DatabaseCapability"
      WHERE "id" = 1 AND "environment" = 'TEST'
        AND "databaseName" = current_database()
    ) THEN
    NEW."role" := test_change[2]::"UserRole";
    NEW."accountStatus" := test_change[3]::"UserAccountStatus";
    NEW."updatedAt" := clock_timestamp();
    authority_invalidation := true;
  END IF;
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
      -- #504 P7 PR4c-2: the migration operator's first-admin bootstrap, only
      -- USER to ADMIN, only that change, only while no ACTIVE ADMIN exists.
      ELSIF effective_caller = 'nihongo_phase7_migration'
        AND OLD."role" = 'USER' AND NEW."role" = 'ADMIN'
        AND OLD."accountStatus" = 'ACTIVE' AND NEW."accountStatus" = 'ACTIVE'
        AND (to_jsonb(NEW) - 'role' - 'updatedAt')
          = (to_jsonb(OLD) - 'role' - 'updatedAt')
        AND NOT EXISTS (
          SELECT 1 FROM "User"
          WHERE "role" = 'ADMIN' AND "accountStatus" = 'ACTIVE'
            AND "id" <> OLD."id"
        ) THEN
        NULL;
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
    -- #504 P7 PR5a: an API SSO Account unlink steps the generation from the
    -- Account trigger (never a direct nihongo_app statement), only that
    -- change; this records the revocation evidence and deletes the Sessions.
    IF effective_caller = 'nihongo_app'
      AND pg_trigger_depth() > 1
      AND NEW."authorityGeneration" = OLD."authorityGeneration" + 1
      AND (to_jsonb(NEW) - 'authorityGeneration' - 'updatedAt')
        = (to_jsonb(OLD) - 'authorityGeneration' - 'updatedAt') THEN
      PERFORM "phase7_record_authority_revocation"(
        OLD."id", 'SESSION_INVALIDATED'
      );
      NEW."updatedAt" := clock_timestamp();
      DELETE FROM "Session" WHERE "userId" = OLD."id";
    ELSE
      RAISE EXCEPTION 'User authorityGeneration is server-owned.'
        USING ERRCODE = '42501';
    END IF;
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
    -- #504 P7 PR5a: an API SSO Account unlink revokes every Session of its
    -- User, as phase7_unlink_sso_account did: the User trigger accepts this
    -- generation step, records the revocation and deletes the Sessions. An
    -- erasure removes Accounts with the User row.
    IF COALESCE(NULLIF(current_setting('role', true), 'none'), session_user) = 'nihongo_app'
      AND OLD."providerId" IN ('apple', 'google')
      AND EXISTS (SELECT 1 FROM "User" WHERE "id" = OLD."userId") THEN
      UPDATE "User" SET "authorityGeneration" = "authorityGeneration" + 1
      WHERE "id" = OLD."userId";
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

CREATE FUNCTION "limit_phase7_account_api_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  -- #504 P7 PR5a: the API links an SSO Account only from the User's staged,
  -- unexpired ACCOUNT_LINK proof for that provider subject. SQL sign-in runs
  -- as the function owner and keeps its own rules.
  IF current_user <> 'nihongo_app' THEN RETURN NEW; END IF;
  IF NEW."providerId" NOT IN ('apple', 'google') OR NOT EXISTS (
    SELECT 1 FROM "SsoAccountFreshProof" AS proof
    WHERE proof."userId" = NEW."userId"
      AND proof."context"->>'purpose' = 'ACCOUNT_LINK'
      AND proof."context"->>'provider' = NEW."providerId"
      AND proof."context"->>'accountId' = NEW."accountId"
      AND proof."expiresAt" > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'SSO Account link requires a staged link proof.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "Account_limit_api_insert"
BEFORE INSERT ON "Account"
FOR EACH ROW EXECUTE FUNCTION "limit_phase7_account_api_insert"();

-- The API now deletes its own fresh state (one-time use, expiry, unlink);
-- deleting fresh state only removes authority.
DROP TRIGGER "SsoAccountFreshProof_limit_api_delete" ON "SsoAccountFreshProof";
DROP TRIGGER "SsoAccountFreshTransaction_limit_api_delete" ON "SsoAccountFreshTransaction";
DROP FUNCTION "limit_sso_account_fresh_delete"();

DROP FUNCTION "phase7_prepare_sso_account_fresh"(TEXT, TEXT);
DROP FUNCTION "phase7_prepare_sso_account_link"(TEXT, TEXT, TEXT);
DROP FUNCTION "phase7_create_sso_account_fresh_transaction"(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION "phase7_consume_sso_account_fresh_transaction"(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION "phase7_stage_sso_account_fresh_proof"(JSONB, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION "phase7_complete_sso_account_fresh"(TEXT, TEXT);
DROP FUNCTION "phase7_complete_sso_account_link"(TEXT, TEXT);
DROP FUNCTION "phase7_sso_account_capabilities"(TEXT, TEXT[], TEXT);
DROP FUNCTION "phase7_unlink_sso_account"(TEXT, TEXT, TEXT[], TEXT);
DROP FUNCTION "phase7_claim_sso_provider_cleanups"(INTEGER, INTEGER, "AdminAuditEnvironment");
DROP FUNCTION "phase7_begin_sso_provider_cleanup"(UUID, TEXT, UUID, "AdminAuditEnvironment");
DROP FUNCTION "phase7_record_sso_provider_cleanup"(UUID, TEXT, TEXT, UUID, "AdminAuditEnvironment");
DROP FUNCTION "phase7_record_sso_provider_cleanup"(UUID, TEXT, TEXT, "AdminAuditEnvironment");
DROP FUNCTION "phase7_record_sso_provider_cleanup"(UUID, TEXT, TEXT);
DROP FUNCTION "phase7_sso_account_proof_valid"(TEXT, TEXT);
DROP FUNCTION "phase7_sso_account_context_valid"(JSONB, TEXT);
DROP FUNCTION "phase7_sso_account_session"(TEXT);
DROP FUNCTION "phase7_change_user_authority"(TEXT, UUID, INTEGER, "UserRole", "UserAccountStatus", "AdminAuditEnvironment");
DROP FUNCTION "phase7_change_user_authority_pre_reauthentication"(TEXT, UUID, INTEGER, "UserRole", "UserAccountStatus", "AdminAuditEnvironment");

-- Every function this migration creates or replaces keeps a fixed search_path.
DO $fixed_path$
DECLARE
  target_schema TEXT := pg_catalog.current_setting('app.phase7_target_schema', false);
  function_oid OID;
BEGIN
  FOR function_oid IN
    SELECT procedure_record.oid
    FROM pg_catalog.pg_proc AS procedure_record
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure_record.pronamespace
    WHERE namespace.nspname = target_schema
      AND procedure_record.proname = ANY(ARRAY[
        'validate_phase7_user_change',
        'protect_phase7_account',
        'limit_phase7_account_api_insert'
      ]::NAME[])
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET search_path TO pg_catalog, %I, pg_temp',
      function_oid::REGPROCEDURE, target_schema
    );
  END LOOP;
END;
$fixed_path$;

SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
