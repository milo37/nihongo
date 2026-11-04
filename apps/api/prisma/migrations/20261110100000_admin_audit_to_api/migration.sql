-- JLP-701 (#504 P4, part 2): the admin audit path runs in the API.
-- Admin commands insert their AdminAuditLog/ContentReview rows in the same
-- Prisma transaction as the content change; the API locks and re-checks the
-- targets (adminOperationArm.ts) and computes contentDigest from the shared
-- canonical preimage. Drop the arm facade, the per-row change capture, the
-- evidence/manifest verification and the SYSTEM_SEED catalog check, and keep
-- phase7_finish_admin_operation as the commit-time authority re-check only.
-- Kept until #504 P6: phase7_begin_admin_operation (session authority and
-- User locks), Phase7OperationIntent, phase7_admin_audit_content_digest and
-- the trusted-execution marker, all still used by the auth SQL functions.
-- No grant changes.
-- Rollback: re-run the dropped definitions and Phase7OperationDelta from
-- 20260827101000_phase7_admin_cms_foundation and
-- 20260909120000_phase7_archive_empty_manifest_verifier.
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
    RAISE EXCEPTION 'Admin audit API migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

CREATE OR REPLACE FUNCTION "phase7_finish_admin_operation_pre_reauthentication"(
  operation_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  intent "Phase7OperationIntent"%ROWTYPE;
  authority_commit_checked_at TIMESTAMPTZ(3);
BEGIN
  SELECT * INTO intent FROM "Phase7OperationIntent"
  WHERE "operationId" = operation_id
    AND "backendPid" = pg_backend_pid()
    AND "transactionId" = txid_current()
  FOR UPDATE;
  IF intent."operationId" IS NULL THEN
    RAISE EXCEPTION 'Trusted Phase 7 operation is absent.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM "phase7_require_caller_role"(
    CASE intent."command"
      WHEN 'REAUTHENTICATION' THEN 'nihongo_auth_gateway'
      WHEN 'AUTHOR_ERASURE_ABANDON' THEN 'nihongo_erasure_worker'
      ELSE 'nihongo_app'
    END
  );

  -- Flush the deferred content verifiers so the authority re-check below is
  -- the final validation step of the command.
  SET CONSTRAINTS
    "QuestionOption_questionVersionId_label_key",
    "QuestionOption_questionVersionId_ordinal_key",
    "QuestionVersion_id_correctOptionId_fkey",
    "Question_id_currentPublishedVersionId_fkey",
    "QuestionVersionTag_questionVersionId_normalizedNameSnapshot_key",
    "Question_deferred_aggregate",
    "QuestionVersion_deferred_question_aggregate",
    "QuestionVersion_deferred_full_content",
    "QuestionOption_deferred_full_content",
    "QuestionVersionTag_deferred_full_content",
    "QuestionReport_deferred_remediation",
    "User_deferred_credential_totality",
    "Account_deferred_credential_totality"
  IMMEDIATE;

  DELETE FROM "Phase7OperationIntent" WHERE "operationId" = operation_id;
  SET CONSTRAINTS "Phase7OperationIntent_must_finish" IMMEDIATE;
  IF intent."actorUserId" IS NOT NULL THEN
    authority_commit_checked_at := clock_timestamp();
    PERFORM 1
    FROM "User" AS actor
    JOIN "AuthSessionFamily" AS family
      ON family."userId" = actor."id"
     AND family."id" = intent."actorFamilyId"
    JOIN "Session" AS session
      ON session."userId" = actor."id"
     AND session."sessionFamilyId" = family."id"
     AND session."id" = intent."actorSessionId"
    WHERE actor."id" = intent."actorUserId"
      AND actor."role" = 'ADMIN'
      AND actor."accountStatus" = 'ACTIVE'
      AND actor."authorityGeneration" = intent."capturedAuthorityGeneration"
      AND family."status" = 'ACTIVE'
      AND session."issuerProtocolVersion" = 'PHASE7_V1'
      AND session."authorityGeneration" = intent."capturedAuthorityGeneration"
      AND session."expiresAt" > authority_commit_checked_at
      AND session."createdAt" + INTERVAL '30 days' > authority_commit_checked_at
      AND (NOT intent."requiresFresh"
        OR session."createdAt" + INTERVAL '5 minutes'
          > authority_commit_checked_at);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Phase 7 authority expired before commit.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
END;
$function$;

DO $finish_search_path$
BEGIN
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %I.phase7_finish_admin_operation_pre_reauthentication(UUID) SET search_path TO pg_catalog, %I, pg_temp',
    pg_catalog.current_setting('app.phase7_target_schema', false),
    pg_catalog.current_setting('app.phase7_target_schema', false)
  );
END;
$finish_search_path$;

DROP TRIGGER "Question_deferred_system_seed_catalog" ON "Question";
DROP TRIGGER "QuestionVersion_deferred_system_seed_catalog" ON "QuestionVersion";
DROP FUNCTION "validate_phase7_system_seed_catalog"();

DROP TRIGGER "Question_capture_phase7_delta" ON "Question";
DROP TRIGGER "QuestionVersion_capture_phase7_delta" ON "QuestionVersion";
DROP TRIGGER "QuestionReport_capture_phase7_delta" ON "QuestionReport";
DROP TRIGGER "QuestionOption_capture_phase7_delta_before" ON "QuestionOption";
DROP TRIGGER "QuestionOption_capture_phase7_delta_after" ON "QuestionOption";
DROP TRIGGER "QuestionVersionTag_capture_phase7_delta_before" ON "QuestionVersionTag";
DROP TRIGGER "QuestionVersionTag_capture_phase7_delta_after" ON "QuestionVersionTag";
DROP FUNCTION "capture_phase7_operation_delta"();
DROP FUNCTION "capture_phase7_version_child_delta"();

DROP TRIGGER "AdminAuditLog_validate_insert" ON "AdminAuditLog";
DROP TRIGGER "ContentReview_validate_insert" ON "ContentReview";
DROP FUNCTION "validate_phase7_evidence_insert"();

DROP FUNCTION "phase7_arm_admin_operation"(UUID, JSONB);
DROP FUNCTION "phase7_verify_operation_manifest"(UUID);
DROP FUNCTION "phase7_operation_target_matches"(TEXT, UUID, UUID, TEXT);
DROP FUNCTION "phase7_operation_references_user"(UUID);
DROP FUNCTION "phase7_current_operation_id"();
DROP TABLE "Phase7OperationDelta";
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
