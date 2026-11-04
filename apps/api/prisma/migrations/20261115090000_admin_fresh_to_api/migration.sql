-- JLP-701 (#504 P7 PR3b-1): SSO ADMIN_FRESH re-authentication runs in the API
-- (auth/adminFreshAuthority.ts) with the lock order and conditions of the
-- dropped functions. The Session family and rotation fence model stays.
-- nihongo_app gets column grants for those reads and writes, and DELETE (a
-- table privilege in PostgreSQL) on four tables whose deletable rows new
-- BEFORE DELETE triggers limit. Session_validate_authority_write and the
-- rotation fence insert trigger also accept the API writes of a live intent.
-- Rollback: re-run the dropped and replaced definitions from
-- 20260827101000_phase7_admin_cms_foundation,
-- 20260916120000_phase7_reauthentication_foundation, 20261019103000_sso_admin_fresh,
-- 20261019110000_sso_admin_fresh_erasure_ownership,
-- 20261019113000_sso_admin_fresh_column_qualification and
-- 20261114090000_session_issuance_to_api, drop the delete-limit triggers and
-- revoke the grants below.
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
    RAISE EXCEPTION 'Admin fresh API migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

GRANT SELECT ("emailVerified") ON TABLE "User" TO "nihongo_app";
-- The staged PENDING_REAUTH replacement names its authorization state.
GRANT INSERT ("authorizationState") ON TABLE "Session" TO "nihongo_app";
GRANT SELECT ("userId", "providerId", "accountId") ON TABLE "Account" TO "nihongo_app";
GRANT SELECT ("id", "environment") ON TABLE "Phase7DatabaseCapability" TO "nihongo_app";
GRANT SELECT (
    "id", "operationId", "requestId", "userId", "oldSessionId",
    "oldTokenDigest", "oldFenceTokenDigest", "sessionFamilyId",
    "capturedAuthorityGeneration", "capturedRole", "capturedAccountStatus",
    "state", "stagedSessionId", "stagedTokenDigest", "environment",
    "expiresAt", "finalizedAt"
  ),
  INSERT (
    "id", "operationId", "requestId", "userId", "oldSessionId",
    "oldTokenDigest", "oldFenceTokenDigest", "sessionFamilyId",
    "capturedAuthorityGeneration", "capturedRole", "capturedAccountStatus",
    "state", "environment", "createdAt", "expiresAt"
  ),
  UPDATE ("state", "stagedSessionId", "stagedTokenDigest", "finalizedAt"),
  DELETE
  ON TABLE "Phase7ReauthenticationIntent" TO "nihongo_app";
GRANT SELECT (
    "provider", "stateDigest", "bindingDigest", "nonce", "codeVerifier",
    "callbackURL", "context", "createdAt", "expiresAt"
  ),
  INSERT (
    "userId", "provider", "stateDigest", "bindingDigest", "nonce",
    "codeVerifier", "callbackURL", "context", "createdAt", "expiresAt"
  ),
  DELETE
  ON TABLE "SsoAdminFreshTransaction" TO "nihongo_app";
GRANT SELECT (
    "proofDigest", "context", "callbackURL", "expiresAt",
    "completedSessionId", "completedAt"
  ),
  INSERT (
    "userId", "proofDigest", "context", "callbackURL", "createdAt", "expiresAt"
  ),
  UPDATE ("completedSessionId", "completedAt", "expiresAt"),
  DELETE
  ON TABLE "SsoAdminFreshProof" TO "nihongo_app";
GRANT SELECT (
    "oldSessionId", "oldFamilyId", "replacementSessionId", "operationId",
    "expiresAt"
  ),
  INSERT (
    "oldSessionId", "oldTokenDigest", "userId", "oldFamilyId",
    "replacementFamilyId", "replacementSessionId", "operationId", "expiresAt"
  )
  ON TABLE "AuthSessionRotationFence" TO "nihongo_app";
GRANT SELECT ("tokenDigest", "expiresAt"), DELETE
  ON TABLE "Phase7AuthorityRevocationEvidence" TO "nihongo_app";

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
  api_reauthentication BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT trusted_delete AND api_writer
      AND OLD."issuerProtocolVersion" = 'PHASE7_V1'
      AND (
        EXISTS (
          SELECT 1 FROM "AuthSessionFamily"
          WHERE "id" = OLD."sessionFamilyId" AND "userId" = OLD."userId"
            AND "status" = 'REVOKED'
        )
        -- #504 P7 PR3b-1: an unfinished re-authentication's staged Session.
        OR OLD."authorizationState" = 'PENDING_REAUTH'
        -- #504 P7 PR3b-1: the old Session of a STAGED rotation.
        OR EXISTS (
          SELECT 1 FROM "Phase7ReauthenticationIntent" AS intent
          WHERE intent."oldSessionId" = OLD."id"
            AND intent."userId" = OLD."userId"
            AND intent."sessionFamilyId" = OLD."sessionFamilyId"
            AND intent."state" = 'STAGED'
            AND intent."expiresAt" > clock_timestamp()
        )
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
    IF api_writer AND NOT trusted_v1 THEN
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
      -- #504 P7 PR3b-1: the API stages a PENDING_REAUTH replacement only for
      -- the User's live PREPARED intent in the same family and generation.
      api_reauthentication := api_writer AND NOT trusted_v1
        AND NEW."authorizationState" = 'PENDING_REAUTH'
        AND EXISTS (
          SELECT 1 FROM "Phase7ReauthenticationIntent" AS intent
          WHERE intent."userId" = NEW."userId"
            AND intent."sessionFamilyId" = NEW."sessionFamilyId"
            AND intent."state" = 'PREPARED'
            AND intent."expiresAt" > clock_timestamp()
            AND intent."capturedAuthorityGeneration" = user_row."authorityGeneration"
        );
      IF ((trusted_reauthentication OR api_reauthentication)
          AND NEW."authorizationState" <> 'PENDING_REAUTH')
        OR (NOT (trusted_reauthentication OR api_reauthentication)
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
    AND (trusted_reauthentication OR (api_writer AND EXISTS (
      -- #504 P7 PR3b-1: the API activates only the staged Session of a live
      -- STAGED intent.
      SELECT 1 FROM "Phase7ReauthenticationIntent" AS intent
      WHERE intent."stagedSessionId" = OLD."id"
        AND intent."userId" = OLD."userId"
        AND intent."sessionFamilyId" = OLD."sessionFamilyId"
        AND intent."state" = 'STAGED'
        AND intent."expiresAt" > clock_timestamp()
    ))) THEN
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
      AND NOT (api_writer AND OLD."expiresAt" > OLD."createdAt" + INTERVAL '1 day'
        AND EXISTS (
          SELECT 1 FROM "User" AS refresh_user
          JOIN "AuthSessionFamily" AS refresh_family
            ON refresh_family."userId" = refresh_user."id"
           AND refresh_family."id" = OLD."sessionFamilyId"
          WHERE refresh_user."id" = OLD."userId"
            AND refresh_user."accountStatus" = 'ACTIVE'
            AND refresh_user."authorityGeneration" = OLD."authorityGeneration"
            AND refresh_family."status" = 'ACTIVE'
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

CREATE OR REPLACE FUNCTION "validate_phase7_rotation_fence"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
BEGIN
  -- #504 P7 PR3b-1: the API writes the fence of its own STAGED rotation.
  -- The function stays SECURITY INVOKER, so this check reads with the
  -- API's own column grants before any trusted-execution check.
  IF effective_caller = 'nihongo_app' AND EXISTS (
    SELECT 1 FROM "Phase7ReauthenticationIntent" AS intent
    WHERE intent."operationId" = NEW."operationId"
      AND intent."userId" = NEW."userId"
      AND intent."oldSessionId" = NEW."oldSessionId"
      AND intent."oldFenceTokenDigest" = NEW."oldTokenDigest"
      AND intent."sessionFamilyId" = NEW."oldFamilyId"
      AND intent."sessionFamilyId" = NEW."replacementFamilyId"
      AND intent."stagedSessionId" = NEW."replacementSessionId"
      AND intent."state" = 'STAGED'
      AND intent."expiresAt" > clock_timestamp()
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT "phase7_trusted_execution_active"('REAUTHENTICATE') THEN
    RAISE EXCEPTION 'Rotation fence requires owned reauthentication.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION "limit_phase7_reauthentication_intent_delete"()
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
  IF NOT (OLD."state" <> 'FINALIZED'
    OR OLD."finalizedAt" <= clock_timestamp() - INTERVAL '15 minutes') THEN
    RAISE EXCEPTION 'Only unfinished or settled reauthentication intents can be deleted.' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE TRIGGER "Phase7ReauthenticationIntent_limit_api_delete"
BEFORE DELETE ON "Phase7ReauthenticationIntent"
FOR EACH ROW EXECUTE FUNCTION "limit_phase7_reauthentication_intent_delete"();

CREATE FUNCTION "limit_sso_admin_fresh_proof_delete"()
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
  IF NOT (OLD."completedSessionId" IS NULL OR OLD."expiresAt" <= clock_timestamp()) THEN
    RAISE EXCEPTION 'Only unfinished or expired ADMIN_FRESH proofs can be deleted.' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE TRIGGER "SsoAdminFreshProof_limit_api_delete"
BEFORE DELETE ON "SsoAdminFreshProof"
FOR EACH ROW EXECUTE FUNCTION "limit_sso_admin_fresh_proof_delete"();

CREATE FUNCTION "limit_sso_admin_fresh_transaction_delete"()
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
  IF NOT (OLD."createdAt" <= clock_timestamp()) THEN
    RAISE EXCEPTION 'ADMIN_FRESH transactions are deleted only by their one-time use or expiry.' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE TRIGGER "SsoAdminFreshTransaction_limit_api_delete"
BEFORE DELETE ON "SsoAdminFreshTransaction"
FOR EACH ROW EXECUTE FUNCTION "limit_sso_admin_fresh_transaction_delete"();

CREATE FUNCTION "limit_phase7_authority_revocation_evidence_delete"()
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
  IF NOT (OLD."expiresAt" <= clock_timestamp()) THEN
    RAISE EXCEPTION 'Only expired authority revocation evidence can be deleted.' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE TRIGGER "Phase7AuthorityRevocationEvidence_limit_api_delete"
BEFORE DELETE ON "Phase7AuthorityRevocationEvidence"
FOR EACH ROW EXECUTE FUNCTION "limit_phase7_authority_revocation_evidence_delete"();

-- Every trigger function this migration replaces or creates keeps a fixed
-- search_path, like the existing trigger functions.
DO $fixed_path$
DECLARE
  target_schema TEXT := pg_catalog.current_setting('app.phase7_target_schema', false);
  function_name TEXT;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'validate_phase7_session_write',
    'validate_phase7_rotation_fence',
    'limit_phase7_reauthentication_intent_delete',
    'limit_sso_admin_fresh_proof_delete',
    'limit_sso_admin_fresh_transaction_delete',
    'limit_phase7_authority_revocation_evidence_delete'
  ] LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      target_schema, function_name, target_schema
    );
  END LOOP;
END;
$fixed_path$;
REVOKE ALL ON FUNCTION
  "limit_phase7_reauthentication_intent_delete"(),
  "limit_sso_admin_fresh_proof_delete"(),
  "limit_sso_admin_fresh_transaction_delete"(),
  "limit_phase7_authority_revocation_evidence_delete"()
FROM PUBLIC;

DROP FUNCTION "phase7_complete_sso_admin_fresh"(TEXT, TEXT, UUID, TEXT, TEXT, TEXT);
DROP FUNCTION "phase7_reconcile_sso_admin_fresh"(TEXT, TEXT);
DROP FUNCTION "phase7_cancel_sso_admin_fresh_proof"(TEXT);
DROP FUNCTION "phase7_prepare_sso_admin_fresh"(TEXT, TEXT);
DROP FUNCTION "phase7_create_sso_admin_fresh_transaction"(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION "phase7_consume_sso_admin_fresh_transaction"(TEXT, TEXT, TEXT);
DROP FUNCTION "phase7_stage_sso_admin_fresh_proof"(JSONB, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION "phase7_cleanup_reauthentication"(INTEGER);
DROP FUNCTION "phase7_abort_reauthentication"(UUID);
DROP FUNCTION "phase7_reconcile_reauthentication"(UUID, TEXT);
DROP FUNCTION "phase7_finalize_reauthentication"(UUID, TEXT);
DROP FUNCTION "phase7_stage_reauthentication_session"(UUID, UUID, TEXT, UUID, TIMESTAMPTZ, TEXT, TEXT);
DROP FUNCTION "phase7_prepare_reauthentication"(TEXT, UUID, UUID, "AdminAuditEnvironment", UUID);
DROP FUNCTION "phase7_confirm_v1_session_issuance"(TEXT, UUID, UUID, INTEGER, "UserRole", "UserAccountStatus");
DROP FUNCTION "phase7_confirm_v1_session_issuance_pre_reauthentication"(TEXT, UUID, UUID, INTEGER, "UserRole", "UserAccountStatus");
DROP FUNCTION "phase7_sso_fresh_context_valid"(JSONB);
DROP FUNCTION "phase7_rotation_fence_token_digest"(TEXT);
DROP FUNCTION "validate_phase7_sso_fresh_operation"();
DROP FUNCTION "phase7_sso_admin_session_is_fresh"(TEXT);
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
