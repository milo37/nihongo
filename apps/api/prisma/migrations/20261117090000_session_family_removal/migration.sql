-- JLP-701 (#504 P7 PR4b-1): the Session family and rotation fence model is
-- removed (user decision: fence option A). A re-authentication replaces the
-- old Session; an old-tab cookie then finds no Session (401, as after any
-- sign-out) and its sign-out no longer ends the replacement Session.
-- Every Session signs out once here, so no Session of the family model stays.
-- Signed-out Sessions are not restored; users sign in again.
-- The SQL functions and triggers that read families keep every other
-- condition. nihongo_app may delete V1 Sessions: before, it could already
-- revoke any Session family and then delete that family's Sessions.
-- Rollback: recreate AuthSessionFamily, AuthSessionRotationFence and the
-- dropped columns from 20260827101000_phase7_admin_cms_foundation and
-- 20260916120000_phase7_reauthentication_foundation, re-run the replaced and
-- dropped definitions from those migrations and from
-- 20261020230000_sso_account_lifecycle, 20261110100000_admin_audit_to_api,
-- 20261114090000_session_issuance_to_api, 20261115090000_admin_fresh_to_api
-- and 20261116090000_erasure_to_api, and restore their grants. Session
-- families cannot be rebuilt for signed-out users; they sign in again.
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
    RAISE EXCEPTION 'Session family removal migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

-- One sign-out of every Session, under the family model it removes.
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

DROP TRIGGER "Session_revoke_empty_family" ON "Session";
DROP TRIGGER "AuthSessionFamily_protect_lifecycle" ON "AuthSessionFamily";
DROP TRIGGER "AuthSessionRotationFence_validate_insert" ON "AuthSessionRotationFence";
DROP TRIGGER "AuthSessionRotationFence_deferred_replacement" ON "AuthSessionRotationFence";
DROP TRIGGER "AuthSessionRotationFence_protect_history" ON "AuthSessionRotationFence";

-- No other table references a family column, so no drop needs CASCADE.
ALTER TABLE "Phase7ReauthenticationIntent"
  DROP COLUMN "sessionFamilyId",
  DROP COLUMN "oldFenceTokenDigest";
ALTER TABLE "Phase7AuthorityRevocationEvidence" DROP COLUMN "familyId";
ALTER TABLE "Phase7OperationIntent" DROP COLUMN "actorFamilyId";
ALTER TABLE "Session" DROP COLUMN "sessionFamilyId";
DROP TABLE "AuthSessionRotationFence";
DROP TABLE "AuthSessionFamily";
DROP TYPE "AuthSessionFamilyStatus";

CREATE OR REPLACE FUNCTION "phase7_activate_v1_issuer"(
  environment_value "AdminAuditEnvironment"
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  database_name TEXT := current_database();
  execution_id UUID;
  target_schema TEXT;
  type_row RECORD;
  legacy_login TEXT := CASE
    WHEN current_database() ~ '_test$' THEN 'nihongo_test_legacy_app_login'
    WHEN current_database() ~ '_dev$' THEN 'nihongo_development_legacy_app_login'
    ELSE NULL
  END;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_phase7_migration');
  PERFORM "phase7_require_database_capability"(environment_value);
  IF (environment_value = 'TEST' AND database_name !~ '_test$')
    OR (environment_value = 'DEVELOPMENT' AND database_name !~ '_dev$') THEN
    RAISE EXCEPTION 'V1 activation requires an approved DB target.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM "AuthIssuerActivation" WHERE "id" = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth issuer activation singleton is missing.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM "User" ORDER BY "id" FOR UPDATE;
  IF EXISTS (
    SELECT 1
    FROM "User" AS target_user
    LEFT JOIN "Account" AS credential
      ON credential."userId" = target_user."id"
     AND credential."providerId" = 'credential'
    GROUP BY target_user."id"
    HAVING COUNT(credential."id") <> 1
  ) THEN
    RAISE EXCEPTION 'V1 activation requires one credential Account per User.'
      USING ERRCODE = '23514';
  END IF;
  execution_id := "phase7_open_trusted_execution"('ACTIVATE', NULL, NULL);
  DELETE FROM "Session" WHERE "issuerProtocolVersion" = 'LEGACY';
  DELETE FROM "Verification" WHERE "purpose" IS NULL;
  UPDATE "AuthIssuerActivation"
  SET "legacyIssuerDisabled" = true, "updatedAt" = clock_timestamp()
  WHERE "id" = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth issuer activation did not update the singleton.'
      USING ERRCODE = '42501';
  END IF;
  SELECT namespace.nspname INTO target_schema
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE relation.oid = pg_catalog.to_regclass('"AuthIssuerActivation"');
  IF target_schema IS NULL OR legacy_login IS NULL THEN
    RAISE EXCEPTION 'Legacy compatibility ACL target is unavailable.'
      USING ERRCODE = '42501';
  END IF;
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON TABLE %I."User", %I."Session", %I."Account", %I."Verification", %I."RateLimit", %I."GuestPrincipal", %I."StudySession", %I."StudySessionQuestion", %I."StudyDraft", %I."StudyDraftAnswer", %I."Question", %I."Bookmark", %I."QuestionVersion", %I."QuestionOption", %I."Tag", %I."QuestionVersionTag", %I."StudyAnswer", %I."StudyResult", %I."WrongNote", %I."UserMemo", %I."ReviewSchedule", %I."ReviewEvent", %I."IdempotencyRecord" FROM %I',
    target_schema, target_schema, target_schema, target_schema, target_schema,
    target_schema, target_schema, target_schema, target_schema, target_schema,
    target_schema, target_schema, target_schema, target_schema, target_schema,
    target_schema, target_schema, target_schema, target_schema, target_schema,
    target_schema, target_schema, target_schema, legacy_login
  );
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON TABLE %I."_prisma_migrations" FROM %I',
    target_schema,
    legacy_login
  );
  EXECUTE pg_catalog.format(
    'DROP POLICY IF EXISTS phase7_ledger_legacy_read ON %I."_prisma_migrations"',
    target_schema
  );
  FOR type_row IN
    SELECT type_value.typname
    FROM pg_catalog.pg_type AS type_value
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = type_value.typnamespace
    WHERE namespace.nspname = target_schema
      AND type_value.typtype = 'e'
      AND type_value.typrelid = 0
      AND type_value.typname IN (
        'QuestionLifecycleStatus', 'QuestionVersionStatus', 'JlptLevel',
        'QuestionSubject', 'QuestionType', 'QuestionDifficulty',
        'QuestionSourceType', 'CreatorLabelSnapshot', 'UserRole',
        'UserAccountStatus', 'StudyMode', 'StudySessionStatus',
        'StudySessionFallbackReason', 'WrongNoteStatus',
        'ReviewEventSource', 'IdempotencyPrincipalType',
        'IdempotencyOperation', 'IdempotencyState'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_catalog.pg_type'::regclass
          AND dependency.objid = type_value.oid
          AND dependency.deptype = 'e'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE USAGE ON TYPE %I.%I FROM %I',
      target_schema,
      type_row.typname,
      legacy_login
    );
  END LOOP;
  EXECUTE pg_catalog.format(
    'REVOKE USAGE ON SCHEMA %I FROM %I',
    target_schema,
    legacy_login
  );
  PERFORM "phase7_revoke_legacy_database_connect"();
  PERFORM "phase7_close_trusted_execution"(execution_id);
END;
$function$;

CREATE OR REPLACE FUNCTION "phase7_change_user_authority_pre_reauthentication"(
  raw_actor_token TEXT,
  target_user_id UUID,
  expected_target_generation INTEGER,
  new_role "UserRole",
  new_status "UserAccountStatus",
  environment_value "AdminAuditEnvironment"
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  actor_user_id UUID;
  actor_session_id UUID;
  target_user "User"%ROWTYPE;
  checked_at TIMESTAMPTZ(3);
  commit_checked_at TIMESTAMPTZ(3);
  execution_id UUID;
  result_generation INTEGER;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(environment_value);
  PERFORM "phase7_require_runtime_ready"();
  SELECT session."userId", session."id"
  INTO actor_user_id, actor_session_id
  FROM "Session" AS session WHERE session."token" = raw_actor_token;
  IF actor_user_id IS NULL OR actor_user_id = target_user_id THEN
    RAISE EXCEPTION 'Authority change requires a distinct ADMIN actor.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM "User"
  WHERE "id" IN (actor_user_id, target_user_id)
  ORDER BY "id" FOR UPDATE;
  SELECT * INTO target_user FROM "User" WHERE "id" = target_user_id;
  IF target_user."id" IS NULL
    OR target_user."authorityGeneration" <> expected_target_generation
    OR target_user."accountStatus" = 'DELETED'
    OR ((target_user."role" IS DISTINCT FROM new_role)::INTEGER
      + (target_user."accountStatus" IS DISTINCT FROM new_status)::INTEGER) <> 1
    OR (target_user."accountStatus" IS DISTINCT FROM new_status
      AND NOT (
        (target_user."accountStatus" = 'ACTIVE'
          AND new_status = 'DELETION_PENDING')
        OR (target_user."accountStatus" = 'DELETION_PENDING'
          AND new_status = 'ACTIVE')
      )) THEN
    RAISE EXCEPTION 'Target authority transition is stale or invalid.'
      USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM "Verification"
  WHERE "resetUserId" = target_user_id ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "Account"
  WHERE "userId" = target_user_id ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "Session"
  WHERE "userId" IN (actor_user_id, target_user_id)
  ORDER BY "userId", "id" FOR UPDATE;

  checked_at := clock_timestamp();
  PERFORM 1
  FROM "User" AS actor
  JOIN "Session" AS session
    ON session."userId" = actor."id"
   AND session."id" = actor_session_id
  WHERE actor."id" = actor_user_id
    AND actor."role" = 'ADMIN' AND actor."accountStatus" = 'ACTIVE'
    AND session."token" = raw_actor_token
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorityGeneration" = actor."authorityGeneration"
    AND session."expiresAt" > checked_at
    AND session."createdAt" + INTERVAL '30 days' > checked_at
    AND session."createdAt" + INTERVAL '5 minutes' > checked_at
  FOR UPDATE OF session;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authority-change actor is stale or not fresh.'
      USING ERRCODE = '42501';
  END IF;

  execution_id := "phase7_open_trusted_execution"(
    'AUTHORITY_CHANGE', target_user_id, NULL
  );
  UPDATE "User"
  SET "role" = new_role, "accountStatus" = new_status,
      "updatedAt" = checked_at
  WHERE "id" = target_user_id
    AND "authorityGeneration" = expected_target_generation
  RETURNING "authorityGeneration" INTO result_generation;
  IF result_generation IS NULL THEN
    RAISE EXCEPTION 'Target authority compare-and-swap failed.'
      USING ERRCODE = '40001';
  END IF;
  commit_checked_at := clock_timestamp();
  IF NOT EXISTS (
    SELECT 1
    FROM "User" AS actor
    JOIN "Session" AS session
      ON session."userId" = actor."id"
     AND session."id" = actor_session_id
    WHERE actor."id" = actor_user_id
      AND actor."role" = 'ADMIN' AND actor."accountStatus" = 'ACTIVE'
      AND session."token" = raw_actor_token
      AND session."issuerProtocolVersion" = 'PHASE7_V1'
      AND session."authorityGeneration" = actor."authorityGeneration"
      AND session."expiresAt" > commit_checked_at
      AND session."createdAt" + INTERVAL '30 days' > commit_checked_at
      AND session."createdAt" + INTERVAL '5 minutes' > commit_checked_at
  ) THEN
    RAISE EXCEPTION 'Authority-change actor expired before commit.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN result_generation;
END;
$function$;

CREATE OR REPLACE FUNCTION "phase7_classify_admin_authority"(raw_token TEXT)
RETURNS TABLE ("outcome" TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  token_digest_value TEXT;
  authority_lost BOOLEAN;
  live_non_admin BOOLEAN;
  checked_at TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_app');
  PERFORM "phase7_require_runtime_ready"();
  token_digest_value := "phase7_reauthentication_token_digest"(
    COALESCE(raw_token, '')
  );
  SELECT EXISTS (
    SELECT 1 FROM "Phase7AuthorityRevocationEvidence" AS evidence
    WHERE evidence."tokenDigest" = token_digest_value
      AND evidence."reason" = 'ADMIN_AUTHORITY_LOST'
      AND evidence."expiresAt" > checked_at
  ), EXISTS (
    SELECT 1
    FROM "Session" AS session
    JOIN "User" AS target_user ON target_user."id" = session."userId"
    WHERE session."token" = raw_token
      AND session."issuerProtocolVersion" = 'PHASE7_V1'
      AND session."authorizationState" = 'ACTIVE'
      AND session."authorityGeneration" = target_user."authorityGeneration"
      AND session."expiresAt" > checked_at
      AND session."createdAt" + INTERVAL '30 days' > checked_at
      AND (target_user."role" <> 'ADMIN'
        OR target_user."accountStatus" <> 'ACTIVE')
  ) INTO authority_lost, live_non_admin;
  RETURN QUERY SELECT CASE
    WHEN authority_lost OR live_non_admin THEN 'ADMIN_REQUIRED'
    ELSE 'AUTH_SESSION_EXPIRED'
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION "phase7_create_question_report_pre_reauthentication"(
  raw_session_token TEXT,
  report_id UUID,
  question_id_value UUID,
  question_version_id_value UUID,
  reason_value "QuestionReportReason",
  description_value TEXT
)
RETURNS TABLE ("id" UUID, "rowVersion" INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  authority_checked_at TIMESTAMPTZ(3);
  authority_commit_checked_at TIMESTAMPTZ(3);
  event_time TIMESTAMPTZ(3);
  reporter_id UUID;
  reporter_role "UserRole";
  reporter_generation INTEGER;
  reporter_session_id UUID;
  execution_id UUID;
  report_row "QuestionReport"%ROWTYPE;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_app');
  PERFORM "phase7_require_database_capability"(NULL);
  SELECT target_session."userId", target_session."id"
  INTO reporter_id, reporter_session_id
  FROM "Session" AS target_session
  WHERE target_session."token" = raw_session_token;
  IF reporter_id IS NULL THEN
    RAISE EXCEPTION 'QuestionReport reporter authority is stale.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM "User" AS target_user
  WHERE target_user."id" = reporter_id FOR UPDATE;
  PERFORM 1 FROM "Session" AS target_session
  WHERE target_session."id" = reporter_session_id
    AND target_session."userId" = reporter_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QuestionReport reporter Session is stale.'
      USING ERRCODE = '42501';
  END IF;
  authority_checked_at := clock_timestamp();
  SELECT target_user."id", target_user."role",
    target_user."authorityGeneration"
  INTO reporter_id, reporter_role, reporter_generation
  FROM "User" AS target_user
  JOIN "Session" AS target_session
    ON target_session."userId" = target_user."id"
  WHERE target_session."token" = raw_session_token
    AND target_session."id" = reporter_session_id
    AND target_user."accountStatus" = 'ACTIVE'
    AND target_session."issuerProtocolVersion" = 'PHASE7_V1'
    AND target_session."authorityGeneration" = target_user."authorityGeneration"
    AND target_session."expiresAt" > authority_checked_at
    AND target_session."createdAt" + INTERVAL '30 days' > authority_checked_at;
  IF reporter_id IS NULL THEN
    RAISE EXCEPTION 'QuestionReport reporter authority is stale.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM "Question" AS question
  WHERE question."id" = question_id_value
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QuestionReport target Question is missing.'
      USING ERRCODE = '23503';
  END IF;
  PERFORM 1 FROM "QuestionVersion" AS version
  WHERE version."id" = question_version_id_value
    AND version."questionId" = question_id_value
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QuestionReport target version is missing.'
      USING ERRCODE = '23503';
  END IF;
  PERFORM 1
  FROM "StudySessionQuestion" AS session_question
  JOIN "StudySession" AS study_session
    ON study_session."id" = session_question."studySessionId"
  WHERE study_session."userId" = reporter_id
    AND session_question."questionId" = question_id_value
    AND session_question."questionVersionId" = question_version_id_value
  ORDER BY session_question."id"
  FOR SHARE OF session_question, study_session;
  PERFORM 1 FROM "WrongNote" AS note
  WHERE note."userId" = reporter_id
    AND note."questionId" = question_id_value
  ORDER BY note."id" FOR SHARE;

  IF NOT EXISTS (
    SELECT 1 FROM "Question" AS question
    WHERE question."id" = question_id_value
      AND question."lifecycleStatus" = 'ACTIVE'
      AND question."currentPublishedVersionId" = question_version_id_value
  ) AND NOT EXISTS (
    SELECT 1
    FROM "StudySessionQuestion" AS session_question
    JOIN "StudySession" AS study_session
      ON study_session."id" = session_question."studySessionId"
    WHERE study_session."userId" = reporter_id
      AND session_question."questionId" = question_id_value
      AND session_question."questionVersionId" = question_version_id_value
  ) AND NOT EXISTS (
    SELECT 1 FROM "WrongNote" AS note
    WHERE note."userId" = reporter_id
      AND note."questionId" = question_id_value
      AND question_version_id_value IN (
        note."lastWrongQuestionVersionId", note."currentReviewQuestionVersionId"
      )
  ) THEN
    RAISE EXCEPTION 'QuestionReport target is not entitled.'
      USING ERRCODE = '23503';
  END IF;

  event_time := clock_timestamp();
  execution_id := "phase7_open_trusted_execution"(
    'REPORT_CREATE', reporter_id, NULL
  );
  INSERT INTO "QuestionReport" (
    "id", "questionId", "questionVersionId", "reason", "description",
    "descriptionDigest", "status", "reporterUserId", "reporterActorId",
    "reporterRole", "reporterLabel", "rowVersion", "createdAt", "updatedAt"
  ) VALUES (
    report_id, question_id_value, question_version_id_value, reason_value,
    description_value,
    "phase7_question_report_description_digest"(description_value),
    'OPEN', reporter_id, reporter_id, reporter_role,
    CASE reporter_role WHEN 'ADMIN' THEN 'ACTIVE_ADMIN'::"AccountActorLabel"
      ELSE 'ACTIVE_USER'::"AccountActorLabel" END,
    1, event_time, event_time
  ) RETURNING * INTO report_row;
  authority_commit_checked_at := clock_timestamp();
  IF NOT EXISTS (
    SELECT 1
    FROM "User" AS target_user
    JOIN "Session" AS target_session
      ON target_session."userId" = target_user."id"
     AND target_session."id" = reporter_session_id
    WHERE target_user."id" = reporter_id
      AND target_user."role" = reporter_role
      AND target_user."accountStatus" = 'ACTIVE'
      AND target_user."authorityGeneration" = reporter_generation
      AND target_session."token" = raw_session_token
      AND target_session."issuerProtocolVersion" = 'PHASE7_V1'
      AND target_session."authorityGeneration" = reporter_generation
      AND target_session."expiresAt" > authority_commit_checked_at
      AND target_session."createdAt" + INTERVAL '30 days'
        > authority_commit_checked_at
  ) THEN
    RAISE EXCEPTION 'QuestionReport reporter authority expired before commit.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN QUERY SELECT report_row."id", report_row."rowVersion";
END;
$function$;

CREATE OR REPLACE FUNCTION "phase7_finish_admin_operation"(operation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Phase7OperationIntent" AS intent
    WHERE intent."operationId" = operation_id
      AND intent."backendPid" = pg_backend_pid()
      AND intent."transactionId" = txid_current()
      AND intent."actorUserId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "Session" AS session
        WHERE session."id" = intent."actorSessionId"
          AND session."userId" = intent."actorUserId"
          AND session."authorizationState" = 'ACTIVE'
      )
  ) THEN
    RAISE EXCEPTION 'Phase 7 authority expired before commit.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM "phase7_finish_admin_operation_pre_reauthentication"(operation_id);
END;
$function$;

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
    JOIN "Session" AS session
      ON session."userId" = actor."id"
     AND session."id" = intent."actorSessionId"
    WHERE actor."id" = intent."actorUserId"
      AND actor."role" = 'ADMIN'
      AND actor."accountStatus" = 'ACTIVE'
      AND actor."authorityGeneration" = intent."capturedAuthorityGeneration"
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

CREATE OR REPLACE FUNCTION "phase7_record_authority_revocation"(
  target_user_id UUID,
  reason_value "Phase7AuthorityRevocationReason"
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  conflicting_count INTEGER;
  captured_at TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  IF reason_value IS NULL THEN
    RAISE EXCEPTION 'Authority revocation reason is required.'
      USING ERRCODE = '23514';
  END IF;
  SELECT count(*)::INTEGER INTO conflicting_count
  FROM "Session" AS session
  JOIN "User" AS target_user ON target_user."id" = session."userId"
  JOIN "Phase7AuthorityRevocationEvidence" AS evidence
    ON evidence."tokenDigest" =
      "phase7_reauthentication_token_digest"(session."token")
  WHERE session."userId" = target_user_id
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorizationState" = 'ACTIVE'
    AND session."authorityGeneration" = target_user."authorityGeneration"
    AND session."expiresAt" > captured_at
    AND session."createdAt" + INTERVAL '30 days' > captured_at
    AND (evidence."sessionId" IS DISTINCT FROM session."id"
      OR evidence."reason" IS DISTINCT FROM reason_value);
  IF conflicting_count <> 0 THEN
    RAISE EXCEPTION 'Authority revocation evidence collision detected.'
      USING ERRCODE = '23514';
  END IF;
  INSERT INTO "Phase7AuthorityRevocationEvidence" (
    "tokenDigest", "sessionId", "reason",
    "createdAt", "expiresAt"
  )
  SELECT "phase7_reauthentication_token_digest"(session."token"),
    session."id", reason_value,
    captured_at, captured_at + INTERVAL '15 minutes'
  FROM "Session" AS session
  JOIN "User" AS target_user ON target_user."id" = session."userId"
  WHERE session."userId" = target_user_id
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorizationState" = 'ACTIVE'
    AND session."authorityGeneration" = target_user."authorityGeneration"
    AND session."expiresAt" > captured_at
    AND session."createdAt" + INTERVAL '30 days' > captured_at;
END;
$function$;

CREATE OR REPLACE FUNCTION "phase7_sso_account_context_valid"(context_value JSONB,raw_token TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE captured_token TEXT;
BEGIN
 SELECT s."token" INTO captured_token FROM "Session" s JOIN "User" u ON u."id"=s."userId"
 WHERE u."id"=(context_value->>'userId')::UUID AND s."id"=(context_value->>'sessionId')::UUID
 AND u."role"::TEXT=context_value->>'role' AND u."authorityGeneration"=(context_value->>'authorityGeneration')::INTEGER
 AND "phase7_reauthentication_token_digest"(s."token")=context_value->>'tokenDigest'
 AND (raw_token IS NULL OR s."token"=raw_token) AND context_value->>'provider' IN ('apple','google')
 AND s."issuerProtocolVersion"='PHASE7_V1' AND s."authorizationState"='ACTIVE'
 AND s."authorityGeneration"=u."authorityGeneration" AND u."accountStatus"='ACTIVE' AND u."deletedAt" IS NULL
 AND s."expiresAt">clock_timestamp()
 AND s."createdAt"+INTERVAL '30 days'>clock_timestamp();
 IF captured_token IS NULL THEN RETURN false; END IF;
 IF context_value->>'purpose'='ACCOUNT_FRESH' THEN
  RETURN EXISTS(SELECT 1 FROM "Account" a WHERE a."userId"=(context_value->>'userId')::UUID AND a."providerId"=context_value->>'provider' AND a."accountId"=context_value->>'accountId');
 ELSIF context_value->>'purpose'='ACCOUNT_LINK' THEN
  RETURN "phase7_sso_account_proof_valid"(captured_token,context_value->>'freshProofDigest');
 END IF;
 RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION "phase7_sso_account_session"(raw_token TEXT)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path FROM CURRENT AS $function$
 SELECT jsonb_build_object('userId',u."id",'sessionId',s."id",'role',u."role",
   'authorityGeneration',u."authorityGeneration",'tokenDigest',"phase7_reauthentication_token_digest"(s."token"))
 FROM "Session" s JOIN "User" u ON u."id"=s."userId"
 WHERE s."token"=raw_token AND s."issuerProtocolVersion"='PHASE7_V1' AND s."authorizationState"='ACTIVE'
 AND s."authorityGeneration"=u."authorityGeneration" AND u."accountStatus"='ACTIVE' AND u."deletedAt" IS NULL
 AND s."expiresAt">clock_timestamp()
 AND s."createdAt"+INTERVAL '30 days'>clock_timestamp();
$function$;

CREATE OR REPLACE FUNCTION "phase7_unlink_sso_account"(raw_token TEXT,provider_value TEXT,available_providers TEXT[],proof_digest TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE context_value JSONB; actor UUID; execution_id UUID;
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
 context_value := "phase7_sso_account_session"(raw_token); IF context_value IS NULL THEN RETURN jsonb_build_object('code','AUTHENTICATION_REQUIRED'); END IF;
 actor := (context_value->>'userId')::UUID; PERFORM 1 FROM "User" WHERE "id"=actor FOR UPDATE;
 context_value := "phase7_sso_account_session"(raw_token); IF context_value IS NULL THEN RETURN jsonb_build_object('code','AUTHENTICATION_REQUIRED'); END IF;
 PERFORM 1 FROM "Account" WHERE "userId"=actor ORDER BY "id" FOR UPDATE;
 IF provider_value IS NULL OR provider_value NOT IN ('apple','google') OR NOT EXISTS(SELECT 1 FROM "Account" WHERE "userId"=actor AND "providerId"=provider_value) THEN RETURN jsonb_build_object('code','SSO_ACCOUNT_NOT_LINKED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM "Account" WHERE "userId"=actor AND "providerId" IN ('apple','google') AND "providerId"<>provider_value) THEN RETURN jsonb_build_object('code','SSO_LAST_SIGN_IN_METHOD'); END IF;
 IF NOT EXISTS(SELECT 1 FROM "Account" WHERE "userId"=actor AND "providerId" IN ('apple','google') AND "providerId"<>provider_value AND "providerId"=ANY(available_providers)) THEN RETURN jsonb_build_object('code','SSO_PROVIDER_UNAVAILABLE'); END IF;
 IF context_value->>'role'='ADMIN' AND NOT "phase7_sso_account_proof_valid"(raw_token,proof_digest) THEN RETURN jsonb_build_object('code','SSO_FRESH_REQUIRED'); END IF;
 PERFORM 1 FROM "Session" WHERE "userId"=actor ORDER BY "id" FOR UPDATE;
 execution_id := "phase7_open_trusted_execution"('AUTHORITY_CHANGE',actor,NULL);
 PERFORM "phase7_record_authority_revocation"(actor,'SESSION_INVALIDATED');
 DELETE FROM "Account" WHERE "userId"=actor AND "providerId"=provider_value;
 UPDATE "User" SET "authorityGeneration"="authorityGeneration"+1,"updatedAt"=clock_timestamp() WHERE "id"=actor;
 DELETE FROM "Session" WHERE "userId"=actor;
 DELETE FROM "SsoAccountFreshProof" WHERE "userId"=actor;
 DELETE FROM "SsoAccountFreshTransaction" WHERE "userId"=actor;
 PERFORM "phase7_close_trusted_execution"(execution_id);
 RETURN jsonb_build_object('unlinked',true,'sessionRevoked',true);
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
    "phase7_trusted_execution_active"('PASSWORD_CHANGE')
    OR "phase7_trusted_execution_active"('RESET_CONSUME')
    OR "phase7_trusted_execution_active"('AUTHORITY_CHANGE');
  erasure_mode BOOLEAN := "phase7_trusted_execution_active"('ERASURE');
  revocation_reason "Phase7AuthorityRevocationReason";
BEGIN
  IF NEW."id" <> OLD."id" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'User identity is insert-only.' USING ERRCODE = '23514';
  END IF;
  IF NEW."role" IS DISTINCT FROM OLD."role"
    OR NEW."accountStatus" IS DISTINCT FROM OLD."accountStatus" THEN
    IF NOT authority_invalidation AND NOT erasure_mode THEN
      RAISE EXCEPTION 'User role/status change requires owned authority.'
        USING ERRCODE = '42501';
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
      DELETE FROM "Session" WHERE "userId" = OLD."userId";
    END IF;
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
      -- the User's live PREPARED intent in the same generation.
      api_reauthentication := api_writer AND NOT trusted_v1
        AND NEW."authorizationState" = 'PENDING_REAUTH'
        AND EXISTS (
          SELECT 1 FROM "Phase7ReauthenticationIntent" AS intent
          WHERE intent."userId" = NEW."userId"
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
    AND (trusted_reauthentication OR (api_writer AND EXISTS (
      -- #504 P7 PR3b-1: the API activates only the staged Session of a live
      -- STAGED intent.
      SELECT 1 FROM "Phase7ReauthenticationIntent" AS intent
      WHERE intent."stagedSessionId" = OLD."id"
        AND intent."userId" = OLD."userId"
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

-- Every function this migration replaces keeps a fixed search_path.
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
        'phase7_activate_v1_issuer',
        'phase7_change_user_authority_pre_reauthentication',
        'phase7_classify_admin_authority',
        'phase7_create_question_report_pre_reauthentication',
        'phase7_finish_admin_operation',
        'phase7_finish_admin_operation_pre_reauthentication',
        'phase7_record_authority_revocation',
        'phase7_sso_account_context_valid',
        'phase7_sso_account_session',
        'phase7_unlink_sso_account',
        'validate_phase7_user_change',
        'protect_phase7_account',
        'validate_phase7_session_write'
      ]::NAME[])
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET search_path TO pg_catalog, %I, pg_temp',
      function_oid::REGPROCEDURE, target_schema
    );
  END LOOP;
END;
$fixed_path$;

DROP FUNCTION "protect_phase7_session_family"();
DROP FUNCTION "revoke_empty_phase7_session_family"();
DROP FUNCTION "validate_phase7_rotation_fence"();
DROP FUNCTION "validate_phase7_rotation_fence_replacement"();
DROP FUNCTION "protect_phase7_rotation_fence"();
DROP FUNCTION "phase7_cleanup_expired_auth_state"(INTEGER, "AdminAuditEnvironment");
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
