-- Set the V2 default using the canonical table owner.
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
    RAISE EXCEPTION 'Study contract migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

-- Only the bounded facade can enter this transaction-scoped execution kind.
ALTER TABLE "Phase7TrustedExecution" DROP CONSTRAINT "Phase7TrustedExecution_kind_check";
ALTER TABLE "Phase7TrustedExecution" ADD CONSTRAINT "Phase7TrustedExecution_kind_check" CHECK (
  "kind" IN ('ISSUE_V1', 'SIGN_OUT', 'ACTIVATE', 'REAUTHENTICATE', 'REFRESH',
    'FENCE_CLEANUP', 'PASSWORD_CHANGE', 'RESET_ISSUE', 'RESET_CONSUME',
    'AUTHORITY_CHANGE', 'ERASURE', 'REPORT_CREATE', 'REPORT_REDACTION', 'V1_RETIREMENT')
);

CREATE OR REPLACE FUNCTION "validate_wrong_note_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  old_pointer_version_number INTEGER;
  new_pointer_version_number INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF SESSION_USER = 'nihongo_test_phase7_migration_login'
      AND pg_catalog.current_database() ~ '_test$'
      AND pg_catalog.current_setting('role', true) = 'nihongo_phase7_migration'
      AND "phase7_trusted_execution_active"('V1_RETIREMENT') THEN
      RETURN OLD;
    END IF;
    PERFORM 1 FROM "User" WHERE "id" = OLD."userId";
    IF FOUND THEN
      RAISE EXCEPTION 'WrongNote can only be deleted with its user aggregate.'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."currentReviewQuestionVersionId" IS NOT NULL THEN
      RAISE EXCEPTION 'WrongNote current review pointer must start null.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."questionId" IS DISTINCT FROM OLD."questionId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'WrongNote identity is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."updatedAt" < OLD."updatedAt" THEN
    RAISE EXCEPTION 'WrongNote updatedAt must be monotonic.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."currentReviewQuestionVersionId" IS NOT NULL
    AND NEW."currentReviewQuestionVersionId" IS NULL THEN
    RAISE EXCEPTION 'WrongNote current review pointer cannot return to null.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."currentReviewQuestionVersionId" IS NOT NULL
    AND NEW."currentReviewQuestionVersionId" IS DISTINCT FROM
      OLD."currentReviewQuestionVersionId" THEN
    SELECT version."versionNumber"
    INTO new_pointer_version_number
    FROM "Question" AS question
    JOIN "QuestionVersion" AS version
      ON version."questionId" = question."id"
      AND version."id" = question."currentPublishedVersionId"
    WHERE question."id" = NEW."questionId"
      AND question."lifecycleStatus" = 'ACTIVE'
      AND version."id" = NEW."currentReviewQuestionVersionId"
      AND version."status" = 'PUBLISHED'
    FOR SHARE OF question, version;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'WrongNote current review pointer must target the current published version.'
        USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE'
      AND OLD."currentReviewQuestionVersionId" IS NOT NULL THEN
      SELECT "versionNumber"
      INTO old_pointer_version_number
      FROM "QuestionVersion"
      WHERE "questionId" = OLD."questionId"
        AND "id" = OLD."currentReviewQuestionVersionId";

      IF NOT FOUND
        OR new_pointer_version_number < old_pointer_version_number THEN
        RAISE EXCEPTION 'WrongNote current review pointer cannot rewind.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION "protect_submitted_user_study_session_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
BEGIN
  IF OLD."userId" IS NOT NULL AND OLD."status" = 'SUBMITTED' THEN
    IF OLD."practiceContractVersion" = 1 AND SESSION_USER = 'nihongo_test_phase7_migration_login'
      AND pg_catalog.current_database() ~ '_test$'
      AND pg_catalog.current_setting('role', true) = 'nihongo_phase7_migration'
      AND "phase7_trusted_execution_active"('V1_RETIREMENT') THEN
      RETURN OLD;
    END IF;
    PERFORM 1 FROM "User" WHERE "id" = OLD."userId";
    IF FOUND THEN
      RAISE EXCEPTION 'Submitted USER StudySession can only be deleted with its user.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN OLD;
END;
$function$;

CREATE FUNCTION "phase7_retire_v1_sessions"(target_ids UUID[])
RETURNS TABLE ("deletedSessionCount" INTEGER, "deletedWrongNoteCount" INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT
AS $function$
DECLARE
  execution_id UUID;
  session_count INTEGER;
  note_count INTEGER;
BEGIN
  IF pg_catalog.current_database() !~ '_test$'
    OR SESSION_USER <> 'nihongo_test_phase7_migration_login'
    OR pg_catalog.current_setting('role', true) <> 'nihongo_phase7_migration'
    OR pg_catalog.current_setting('session_replication_role') <> 'origin'
    OR target_ids IS NULL OR pg_catalog.cardinality(target_ids) < 1
    OR pg_catalog.cardinality(target_ids) > 500
    OR EXISTS (SELECT 1 FROM pg_catalog.unnest(target_ids) AS ids(id) WHERE id IS NULL)
    OR (SELECT pg_catalog.count(DISTINCT id) FROM pg_catalog.unnest(target_ids) AS ids(id)) <> pg_catalog.cardinality(target_ids)
  THEN RAISE EXCEPTION 'V1 retirement facade requires bounded TEST targets.' USING ERRCODE = '42501'; END IF;

  PERFORM 1 FROM "StudySession" AS session WHERE session."id" = ANY(target_ids)
    ORDER BY session."id" FOR UPDATE;
  SELECT count(*) INTO session_count FROM "StudySession" AS session
    WHERE session."id" = ANY(target_ids) AND session."practiceContractVersion" = 1
      AND session."status" <> 'IN_PROGRESS'
      AND ((session."userId" IS NOT NULL AND session."guestPrincipalId" IS NULL)
        OR (session."userId" IS NULL AND session."guestPrincipalId" IS NOT NULL))
      AND NOT EXISTS (SELECT 1 FROM "StudySession" AS retry WHERE retry."retryOfStudySessionId" = session."id");
  IF session_count <> pg_catalog.cardinality(target_ids) THEN
    RAISE EXCEPTION 'V1 retirement target changed or has a retry.' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM "WrongNote" AS note WHERE EXISTS (
    SELECT 1 FROM "ReviewEvent" AS event WHERE event."wrongNoteId" = note."id"
      AND event."studySessionId" = ANY(target_ids)) ORDER BY note."id" FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM "ReviewEvent" AS event JOIN "WrongNote" AS note ON note."id" = event."wrongNoteId"
    WHERE event."studySessionId" = ANY(target_ids) AND (
      EXISTS (SELECT 1 FROM "UserMemo" AS memo WHERE memo."wrongNoteId" = note."id")
      OR EXISTS (SELECT 1 FROM "ReviewEvent" AS other WHERE other."wrongNoteId" = note."id"
        AND (other."studySessionId" IS NULL OR NOT (other."studySessionId" = ANY(target_ids))))
    )
  ) THEN RAISE EXCEPTION 'V1 retirement review history is shared or has a memo.' USING ERRCODE = '23514'; END IF;

  execution_id := "phase7_open_trusted_execution"('V1_RETIREMENT', NULL, NULL);
  DELETE FROM "WrongNote" AS note WHERE EXISTS (
    SELECT 1 FROM "ReviewEvent" AS event WHERE event."wrongNoteId" = note."id"
      AND event."studySessionId" = ANY(target_ids));
  GET DIAGNOSTICS note_count = ROW_COUNT;
  DELETE FROM "StudySession" AS session WHERE session."id" = ANY(target_ids)
    AND session."practiceContractVersion" = 1
    AND NOT EXISTS (SELECT 1 FROM "StudySession" AS retry WHERE retry."retryOfStudySessionId" = session."id")
    AND NOT EXISTS (SELECT 1 FROM "ReviewEvent" AS event WHERE event."studySessionId" = session."id");
  GET DIAGNOSTICS session_count = ROW_COUNT;
  IF session_count <> pg_catalog.cardinality(target_ids) THEN
    RAISE EXCEPTION 'V1 retirement target changed during cleanup.' USING ERRCODE = '40001';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN QUERY SELECT session_count, note_count;
END;
$function$;
REVOKE ALL ON FUNCTION "phase7_retire_v1_sessions"(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "phase7_retire_v1_sessions"(UUID[]) TO "nihongo_phase7_migration";

SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
