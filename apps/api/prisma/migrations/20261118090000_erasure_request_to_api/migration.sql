-- JLP-701 (#504 P7 PR4b-2): the SSO account erasure request runs in the API
-- (auth/accountErasureAuthority.ts requestSsoAccountErasure) with the checks
-- and order of phase7_request_sso_account_erasure: the account Session, the
-- User lock, the ACCOUNT_FRESH proof, open authored candidates, the receipt,
-- the Account locks, the request row, DELETION_PENDING, and the fresh proof
-- and transaction cleanup. Response codes do not change.
-- nihongo_app gets the columns it writes and reads. The request insert
-- trigger fills the provider cleanup list, the receipt expiry and the state
-- itself, so the API cannot mark a provider cleanup complete. The User trigger
-- accepts only ACTIVE to DELETION_PENDING by nihongo_app, only with that
-- request just inserted, and then revokes every Session as before.
-- Rollback: re-run phase7_request_sso_account_erasure from
-- 20261020230000_sso_account_lifecycle and validate_phase7_user_change from
-- 20261117090000_session_family_removal, drop the triggers created below and
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
    RAISE EXCEPTION 'Erasure request API migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

GRANT UPDATE ("accountStatus") ON TABLE "User" TO "nihongo_app";
GRANT INSERT ("userId", "receiptDigest", "providerCleanup", "receiptExpiresAt")
  ON TABLE "SsoAccountErasureRequest" TO "nihongo_app";
GRANT SELECT ("proofDigest", "context", "verifiedAt", "expiresAt", "userId"),
  DELETE
  ON TABLE "SsoAccountFreshProof" TO "nihongo_app";
GRANT SELECT ("userId"), DELETE ON TABLE "SsoAccountFreshTransaction" TO "nihongo_app";

-- The API names the User and the receipt only; the rest is server-owned.
CREATE FUNCTION "prepare_sso_account_erasure_request"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  -- This function runs as its caller: current_user is nihongo_app only for a
  -- direct API statement.
  IF current_user <> 'nihongo_app' THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "User"
    WHERE "id" = NEW."userId" AND "accountStatus" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'SSO erasure request requires an active User.'
      USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'provider', p.provider, 'status', 'PENDING'
    ) ORDER BY p.provider), '[]'::jsonb)
  INTO NEW."providerCleanup"
  FROM (
    SELECT DISTINCT "providerId" AS provider FROM "Account"
    WHERE "userId" = NEW."userId" AND "providerId" IN ('apple', 'google')
  ) AS p;
  NEW."appStatus" := 'DELETION_PENDING';
  NEW."createdAt" := clock_timestamp();
  NEW."receiptExpiresAt" := clock_timestamp() + INTERVAL '1 day';
  NEW."completedAt" := NULL;
  NEW."leaseToken" := NULL;
  NEW."leaseExpiresAt" := NULL;
  NEW."activeProvider" := NULL;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "SsoAccountErasureRequest_prepare_api_insert"
BEFORE INSERT ON "SsoAccountErasureRequest"
FOR EACH ROW EXECUTE FUNCTION "prepare_sso_account_erasure_request"();

-- nihongo_app deletes fresh proofs and transactions only for a User whose
-- erasure request it just recorded. User delete cascades run as the owner.
CREATE FUNCTION "limit_sso_account_fresh_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF current_user <> 'nihongo_app' THEN RETURN OLD; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "SsoAccountErasureRequest"
    WHERE "userId" = OLD."userId" AND "appStatus" = 'DELETION_PENDING'
  ) THEN
    RAISE EXCEPTION 'SSO account fresh state is deleted only for an erasure request.'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE TRIGGER "SsoAccountFreshProof_limit_api_delete"
BEFORE DELETE ON "SsoAccountFreshProof"
FOR EACH ROW EXECUTE FUNCTION "limit_sso_account_fresh_delete"();
CREATE TRIGGER "SsoAccountFreshTransaction_limit_api_delete"
BEFORE DELETE ON "SsoAccountFreshTransaction"
FOR EACH ROW EXECUTE FUNCTION "limit_sso_account_fresh_delete"();

CREATE OR REPLACE FUNCTION "validate_phase7_user_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  authority_invalidation BOOLEAN :=
    "phase7_trusted_execution_active"('PASSWORD_CHANGE')
    OR "phase7_trusted_execution_active"('RESET_CONSUME')
    OR "phase7_trusted_execution_active"('AUTHORITY_CHANGE');
  erasure_mode BOOLEAN := "phase7_trusted_execution_active"('ERASURE');
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
    IF NOT authority_invalidation AND NOT erasure_mode THEN
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
    IF NOT erasure_mode AND EXISTS (
      SELECT 1 FROM "QuestionVersion"
      WHERE "createdByActorId" = OLD."id"
        AND "status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
    ) THEN
      RAISE EXCEPTION 'Open candidate blocks role/status authority change.'
        USING ERRCODE = '23514';
    END IF;
    IF NOT erasure_mode THEN
      revocation_reason := CASE
        WHEN OLD."role" = 'ADMIN'
          AND (NEW."role" <> 'ADMIN' OR NEW."accountStatus" <> 'ACTIVE')
          THEN 'ADMIN_AUTHORITY_LOST'::"Phase7AuthorityRevocationReason"
        ELSE 'SESSION_INVALIDATED'::"Phase7AuthorityRevocationReason"
      END;
      PERFORM "phase7_record_authority_revocation"(
        OLD."id", revocation_reason
      );
    END IF;
    NEW."authorityGeneration" := OLD."authorityGeneration" + 1;
    DELETE FROM "Session" WHERE "userId" = OLD."id";
  ELSIF NEW."authorityGeneration" <> OLD."authorityGeneration"
    AND NOT authority_invalidation AND NOT erasure_mode THEN
    RAISE EXCEPTION 'User authorityGeneration is server-owned.'
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
    'prepare_sso_account_erasure_request',
    'limit_sso_account_fresh_delete',
    'validate_phase7_user_change'
  ] LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
      target_schema, function_name, target_schema
    );
  END LOOP;
END;
$fixed_path$;
REVOKE ALL ON FUNCTION
  "prepare_sso_account_erasure_request"(),
  "limit_sso_account_fresh_delete"()
FROM PUBLIC;

DROP FUNCTION "phase7_request_sso_account_erasure"(TEXT, TEXT, TEXT);
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
