-- JLP-845 (operator-approved 2026-11-12): a member may restore their own
-- account while its erasure request waits out the 7-day grace period.
-- Changes, nothing else:
--   1. validate_user_change: one new branch lets nihongo_app move a User from
--      DELETION_PENDING back to ACTIVE, only while the erasure request has not
--      started; the same statement cancels that request (CANCELLED, userId
--      NULL). Every other branch is the baseline body unchanged.
--   2. limit_sso_account_erasure_request_update: also accepts that
--      DELETION_PENDING -> CANCELLED change, only from the User trigger.
--   3. SsoAccountErasureRequest_appStatus_check also allows CANCELLED, and a
--      new check keeps a CANCELLED request unlinked from any User.
-- CREATE OR REPLACE keeps each function's owner and ACL but resets its SET
-- clause, so the fixed search_path is set again below.
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

ALTER TABLE "SsoAccountErasureRequest"
  DROP CONSTRAINT "SsoAccountErasureRequest_appStatus_check";
ALTER TABLE "SsoAccountErasureRequest"
  ADD CONSTRAINT "SsoAccountErasureRequest_appStatus_check" CHECK ((("appStatus")::text = ANY ((ARRAY['DELETION_PENDING'::character varying, 'DELETED'::character varying, 'CANCELLED'::character varying])::text[])));
ALTER TABLE "SsoAccountErasureRequest"
  ADD CONSTRAINT "SsoAccountErasureRequest_cancelled_unlinked_check" CHECK ((("appStatus")::text <> 'CANCELLED'::text) OR ("userId" IS NULL));

-- FUNCTION: limit_sso_account_erasure_request_update
CREATE OR REPLACE FUNCTION limit_sso_account_erasure_request_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
    )
    -- JLP-845: only validate_user_change cancels a request, inside the
    -- member's restore.
    AND NOT (
      OLD."appStatus" = 'DELETION_PENDING' AND NEW."appStatus" = 'CANCELLED'
      AND OLD."completedAt" IS NULL AND NEW."completedAt" IS NULL
      AND NEW."userId" IS NULL
      AND pg_trigger_depth() > 1
    ) THEN
    RAISE EXCEPTION 'SSO erasure request completes only after its User is erased.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- FUNCTION: validate_user_change
CREATE OR REPLACE FUNCTION validate_user_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
DECLARE
  -- #504 P7 PR5b: trusted execution is gone; only the TEST-only change
  -- below sets this.
  authority_invalidation BOOLEAN := false;
  revocation_reason "AuthorityRevocationReason";
  test_change TEXT[];
  -- #504 P7 PR4b-2: the API records an SSO erasure request as nihongo_app.
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
  -- JLP-845: the erasure request a restore cancels.
  cancelled_requests INTEGER;
BEGIN
  -- #504 P7 PR5a: the TEST-only authority change of one User
  -- (db/fixtures/userAuthorityChange.ts), accepted only in a TEST database
  -- with a TEST capability, like the TEST-only erasure. The marker names the
  -- User, role and status; nihongo_app holds no User role privilege.
  test_change := string_to_array(
    current_setting('nihongo.test_authority_change', true), ':'
  );
  IF NOT authority_invalidation
    AND effective_caller = 'nihongo_app'
    AND cardinality(test_change) = 3
    AND test_change[1] = OLD."id"::TEXT
    AND current_database() ~ '_test$'
    AND EXISTS (
      SELECT 1 FROM "DatabaseCapability"
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
      -- JLP-845: the member's own restore, DELETION_PENDING to ACTIVE, only
      -- that change, only while the erasure request has not started (no
      -- provider cleanup lease, every provider still PENDING). The same
      -- statement cancels that request and unlinks it from the User.
      ELSIF effective_caller = 'nihongo_app'
        AND OLD."accountStatus" = 'DELETION_PENDING'
        AND NEW."accountStatus" = 'ACTIVE'
        AND OLD."deletedAt" IS NULL
        AND NEW."role" IS NOT DISTINCT FROM OLD."role"
        AND (to_jsonb(NEW) - 'accountStatus') = (to_jsonb(OLD) - 'accountStatus') THEN
        UPDATE "SsoAccountErasureRequest" AS request
        SET "appStatus" = 'CANCELLED', "userId" = NULL
        WHERE request."userId" = OLD."id"
          AND request."appStatus" = 'DELETION_PENDING'
          AND request."completedAt" IS NULL
          AND request."leaseToken" IS NULL
          AND request."leaseExpiresAt" IS NULL
          AND request."activeProvider" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(request."providerCleanup") AS x
            WHERE x->>'status' IS DISTINCT FROM 'PENDING'
          );
        GET DIAGNOSTICS cancelled_requests = ROW_COUNT;
        IF cancelled_requests <> 1 THEN
          RAISE EXCEPTION 'Account restore requires an erasure request that has not started.'
            USING ERRCODE = '55000';
        END IF;
        NEW."updatedAt" := clock_timestamp();
      -- #504 P7 PR4c-2: the migration operator's first-admin bootstrap, only
      -- USER to ADMIN, only that change, only while no ACTIVE ADMIN exists.
      ELSIF effective_caller = 'nihongo_migration'
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
        THEN 'ADMIN_AUTHORITY_LOST'::"AuthorityRevocationReason"
      ELSE 'SESSION_INVALIDATED'::"AuthorityRevocationReason"
    END;
    PERFORM "record_authority_revocation"(
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
      PERFORM "record_authority_revocation"(
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
$_$;

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
      AND procedure_record.proname = ANY(ARRAY[
        'limit_sso_account_erasure_request_update',
        'validate_user_change'
      ]::NAME[])
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET search_path TO pg_catalog, %I, pg_temp',
      function_oid::REGPROCEDURE, target_schema
    );
  END LOOP;
END;
$fixed_path$;

SET LOCAL ROLE "nihongo_migration";
COMMIT;
