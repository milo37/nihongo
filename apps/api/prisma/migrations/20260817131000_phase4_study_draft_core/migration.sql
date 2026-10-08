-- Phase 4 Slice 1: versioned practice sessions, server-authoritative drafts,
-- operation-aware idempotency, resumable discovery, and lifecycle integrity.
-- The enum values used here were committed by the preceding enum-only
-- migration. Existing migrations remain immutable.

BEGIN;

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "IdempotencyRecord"
    WHERE "operation" <> 'STUDY_SUBMIT'
  ) THEN
    RAISE EXCEPTION 'Reserved Phase 4 idempotency operations must have zero rows before Slice 1.'
      USING ERRCODE = '23514';
  END IF;
END;
$block$;

ALTER TABLE "StudySession"
  ADD COLUMN "practiceContractVersion" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "StudySession_practice_contract_version_check" CHECK (
    "practiceContractVersion" IN (1, 2)
  ),
  ADD CONSTRAINT "StudySession_v2_no_fallback_check" CHECK (
    "practiceContractVersion" = 1
    OR (NOT "usedFallback" AND "fallbackReason" IS NULL)
  );

ALTER TABLE "IdempotencyRecord"
  ADD COLUMN "contractVersion" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "IdempotencyRecord_contract_version_check" CHECK (
    "contractVersion" IN (1, 2)
  );

CREATE TABLE "StudyDraft" (
  "studySessionId" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "currentOrdinal" INTEGER NOT NULL DEFAULT 1,
  "savedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "StudyDraft_pkey" PRIMARY KEY ("studySessionId"),
  CONSTRAINT "StudyDraft_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "StudyDraft_current_ordinal_check" CHECK (
    "currentOrdinal" BETWEEN 1 AND 20
  ),
  CONSTRAINT "StudyDraft_saved_revision_check" CHECK (
    ("revision" = 0 AND "savedAt" IS NULL)
    OR ("revision" > 0 AND "savedAt" IS NOT NULL)
  ),
  CONSTRAINT "StudyDraft_timestamp_check" CHECK (
    "updatedAt" >= "createdAt"
    AND ("savedAt" IS NULL OR "updatedAt" = "savedAt")
  )
);

CREATE TABLE "StudyDraftAnswer" (
  "studySessionId" UUID NOT NULL,
  "studySessionQuestionId" UUID NOT NULL,
  "questionVersionId" UUID NOT NULL,
  "selectedOptionId" UUID,
  "elapsedSec" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "StudyDraftAnswer_pkey" PRIMARY KEY (
    "studySessionId",
    "studySessionQuestionId"
  ),
  CONSTRAINT "StudyDraftAnswer_elapsed_check" CHECK (
    "elapsedSec" BETWEEN 0 AND 86400
  )
);

CREATE UNIQUE INDEX "StudySessionQuestion_studySessionId_id_key"
  ON "StudySessionQuestion"("studySessionId", "id");

CREATE INDEX "StudySession_userId_startedAt_id_resumable_idx"
  ON "StudySession"("userId", "startedAt" DESC, "id")
  INCLUDE ("expiresAt")
  WHERE "userId" IS NOT NULL AND "status" = 'IN_PROGRESS';

CREATE INDEX "StudySession_guestPrincipalId_startedAt_id_resumable_idx"
  ON "StudySession"("guestPrincipalId", "startedAt" DESC, "id")
  INCLUDE ("expiresAt")
  WHERE "guestPrincipalId" IS NOT NULL AND "status" = 'IN_PROGRESS';

CREATE INDEX "StudyDraft_savedAt_studySessionId_idx"
  ON "StudyDraft"("savedAt" DESC NULLS LAST, "studySessionId");

CREATE INDEX "StudyDraftAnswer_studySessionQuestionId_questionVersionId_idx"
  ON "StudyDraftAnswer"("studySessionQuestionId", "questionVersionId");

CREATE INDEX "StudyDraftAnswer_questionVersionId_selectedOptionId_idx"
  ON "StudyDraftAnswer"("questionVersionId", "selectedOptionId")
  WHERE "selectedOptionId" IS NOT NULL;

DROP INDEX "IdempotencyRecord_expiresAt_idx";
CREATE INDEX "IdempotencyRecord_operation_expiresAt_id_idx"
  ON "IdempotencyRecord"("operation", "expiresAt", "id")
  WHERE "state" = 'SUCCEEDED' AND "expiresAt" IS NOT NULL;

DROP INDEX "IdempotencyRecord_studySessionId_succeeded_key";
CREATE UNIQUE INDEX "IdempotencyRecord_studySessionId_submit_succeeded_key"
  ON "IdempotencyRecord"("studySessionId")
  WHERE "state" = 'SUCCEEDED' AND "operation" = 'STUDY_SUBMIT';

ALTER TABLE "StudyDraft"
  ADD CONSTRAINT "StudyDraft_studySessionId_fkey"
  FOREIGN KEY ("studySessionId") REFERENCES "StudySession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudyDraftAnswer"
  ADD CONSTRAINT "StudyDraftAnswer_studySessionId_fkey"
  FOREIGN KEY ("studySessionId") REFERENCES "StudyDraft"("studySessionId")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "StudyDraftAnswer_studySessionId_studySessionQuestionId_fkey"
  FOREIGN KEY ("studySessionId", "studySessionQuestionId")
  REFERENCES "StudySessionQuestion"("studySessionId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "StudyDraftAnswer_studySessionQuestionId_questionVersionId_fkey"
  FOREIGN KEY ("studySessionQuestionId", "questionVersionId")
  REFERENCES "StudySessionQuestion"("id", "questionVersionId")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "StudyDraftAnswer_questionVersionId_selectedOptionId_fkey"
  FOREIGN KEY ("questionVersionId", "selectedOptionId")
  REFERENCES "QuestionOption"("questionVersionId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IdempotencyRecord"
  DROP CONSTRAINT "IdempotencyRecord_state_check",
  ADD CONSTRAINT "IdempotencyRecord_state_check" CHECK (
    ("state" = 'PROCESSING'
      AND "responseStatus" IS NULL
      AND "responseBody" IS NULL
      AND "completedAt" IS NULL
      AND "expiresAt" IS NULL)
    OR ("state" = 'SUCCEEDED'
      AND "responseStatus" IS NOT NULL
      AND "responseBody" IS NOT NULL
      AND JSONB_TYPEOF("responseBody") = 'object'
      AND "completedAt" IS NOT NULL
      AND "expiresAt" IS NOT NULL
      AND "completedAt" >= "createdAt"
      AND (
        ("operation" = 'STUDY_SUBMIT'
          AND "responseStatus" = 201
          AND "expiresAt" = "completedAt" + INTERVAL '24 hours')
        OR ("operation" = 'STUDY_DRAFT_SAVE'
          AND "responseStatus" = 200
          AND "expiresAt" = "completedAt" + INTERVAL '48 hours')
      ))
  );

CREATE OR REPLACE FUNCTION "validate_study_session_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."status" <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'StudySession must be inserted IN_PROGRESS.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."guestPrincipalId" IS DISTINCT FROM OLD."guestPrincipalId"
    OR NEW."level" IS DISTINCT FROM OLD."level"
    OR NEW."subject" IS DISTINCT FROM OLD."subject"
    OR NEW."mode" IS DISTINCT FROM OLD."mode"
    OR NEW."requestedCount" IS DISTINCT FROM OLD."requestedCount"
    OR NEW."actualCount" IS DISTINCT FROM OLD."actualCount"
    OR NEW."usedFallback" IS DISTINCT FROM OLD."usedFallback"
    OR NEW."fallbackReason" IS DISTINCT FROM OLD."fallbackReason"
    OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
    OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
    OR NEW."practiceContractVersion" IS DISTINCT FROM
      OLD."practiceContractVersion"
  ) THEN
    RAISE EXCEPTION 'StudySession selection metadata is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Terminal StudySession is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW."status" NOT IN ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Invalid StudySession state transition.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE FUNCTION "validate_study_draft_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  parent_version INTEGER;
  parent_status "StudySessionStatus";
  parent_actual_count INTEGER;
  parent_user_id UUID;
  parent_guest_id UUID;
BEGIN
  SELECT
    session."practiceContractVersion",
    session."status",
    session."actualCount",
    session."userId",
    session."guestPrincipalId"
  INTO
    parent_version,
    parent_status,
    parent_actual_count,
    parent_user_id,
    parent_guest_id
  FROM "StudySession" AS session
  WHERE session."id" = CASE
    WHEN TG_OP = 'DELETE' THEN OLD."studySessionId"
    ELSE NEW."studySessionId"
  END;

  IF TG_OP = 'DELETE' THEN
    IF NOT FOUND OR parent_status <> 'IN_PROGRESS' THEN
      RETURN OLD;
    END IF;
    IF parent_user_id IS NOT NULL THEN
      PERFORM 1 FROM "User" WHERE "id" = parent_user_id;
      IF NOT FOUND THEN
        RETURN OLD;
      END IF;
    ELSE
      PERFORM 1 FROM "GuestPrincipal" WHERE "id" = parent_guest_id;
      IF NOT FOUND THEN
        RETURN OLD;
      END IF;
    END IF;
    RAISE EXCEPTION 'IN_PROGRESS StudyDraft cannot be deleted before a terminal transition.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT FOUND
    OR parent_version <> 2
    OR parent_status <> 'IN_PROGRESS'
    OR NEW."currentOrdinal" > parent_actual_count THEN
    RAISE EXCEPTION 'StudyDraft requires an editable version 2 StudySession.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."revision" <> 0
      OR NEW."currentOrdinal" <> 1
      OR NEW."savedAt" IS NOT NULL
      OR NEW."updatedAt" IS DISTINCT FROM NEW."createdAt" THEN
      RAISE EXCEPTION 'StudyDraft must start as revision zero.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."studySessionId" IS DISTINCT FROM OLD."studySessionId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."revision" <> OLD."revision" + 1
    OR NEW."savedAt" IS NULL
    OR NEW."savedAt" <= COALESCE(OLD."savedAt", OLD."createdAt")
    OR NEW."updatedAt" IS DISTINCT FROM NEW."savedAt" THEN
    RAISE EXCEPTION 'StudyDraft update must advance exactly one revision.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER "StudyDraft_validate_change"
BEFORE INSERT OR UPDATE OR DELETE ON "StudyDraft"
FOR EACH ROW EXECUTE FUNCTION "validate_study_draft_change"();

CREATE FUNCTION "validate_study_draft_answer_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  parent_revision INTEGER;
  parent_created_at TIMESTAMPTZ(3);
  parent_version INTEGER;
  parent_status "StudySessionStatus";
  parent_user_id UUID;
  parent_guest_id UUID;
BEGIN
  SELECT
    draft."revision",
    draft."createdAt",
    session."practiceContractVersion",
    session."status",
    session."userId",
    session."guestPrincipalId"
  INTO
    parent_revision,
    parent_created_at,
    parent_version,
    parent_status,
    parent_user_id,
    parent_guest_id
  FROM "StudyDraft" AS draft
  JOIN "StudySession" AS session
    ON session."id" = draft."studySessionId"
  WHERE draft."studySessionId" = CASE
    WHEN TG_OP = 'DELETE' THEN OLD."studySessionId"
    ELSE NEW."studySessionId"
  END;

  IF TG_OP = 'DELETE' THEN
    IF NOT FOUND OR parent_status <> 'IN_PROGRESS' THEN
      RETURN OLD;
    END IF;
    IF parent_user_id IS NOT NULL THEN
      PERFORM 1 FROM "User" WHERE "id" = parent_user_id;
      IF NOT FOUND THEN
        RETURN OLD;
      END IF;
    ELSE
      PERFORM 1 FROM "GuestPrincipal" WHERE "id" = parent_guest_id;
      IF NOT FOUND THEN
        RETURN OLD;
      END IF;
    END IF;
    RAISE EXCEPTION 'IN_PROGRESS StudyDraftAnswer cannot be deleted.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT FOUND OR parent_version <> 2 OR parent_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'StudyDraftAnswer requires an editable version 2 draft.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF parent_revision <> 0
      OR NEW."selectedOptionId" IS NOT NULL
      OR NEW."elapsedSec" <> 0
      OR NEW."updatedAt" IS DISTINCT FROM parent_created_at THEN
      RAISE EXCEPTION 'Initial StudyDraftAnswer must be an empty revision-zero fact.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."studySessionId" IS DISTINCT FROM OLD."studySessionId"
    OR NEW."studySessionQuestionId" IS DISTINCT FROM
      OLD."studySessionQuestionId"
    OR NEW."questionVersionId" IS DISTINCT FROM OLD."questionVersionId"
    OR NEW."updatedAt" <= OLD."updatedAt" THEN
    RAISE EXCEPTION 'StudyDraftAnswer identity is immutable and time is monotonic.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER "StudyDraftAnswer_validate_change"
BEFORE INSERT OR UPDATE OR DELETE ON "StudyDraftAnswer"
FOR EACH ROW EXECUTE FUNCTION "validate_study_draft_answer_change"();

CREATE FUNCTION "validate_study_draft_aggregate"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  target_session_id UUID;
  parent_version INTEGER;
  parent_status "StudySessionStatus";
  parent_actual_count INTEGER;
  draft_count INTEGER;
  draft_revision INTEGER;
  draft_current_ordinal INTEGER;
  draft_saved_at TIMESTAMPTZ(3);
  draft_created_at TIMESTAMPTZ(3);
  answer_count INTEGER;
  invalid_answer_timestamp_count INTEGER;
  invalid_initial_answer_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'StudySession' THEN
    target_session_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD."id"
      ELSE NEW."id"
    END;
  ELSE
    target_session_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD."studySessionId"
      ELSE NEW."studySessionId"
    END;
  END IF;

  SELECT
    session."practiceContractVersion",
    session."status",
    session."actualCount"
  INTO parent_version, parent_status, parent_actual_count
  FROM "StudySession" AS session
  WHERE session."id" = target_session_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    COUNT(*)::INTEGER,
    MAX(draft."revision"),
    MAX(draft."currentOrdinal"),
    MAX(draft."savedAt"),
    MAX(draft."createdAt")
  INTO
    draft_count,
    draft_revision,
    draft_current_ordinal,
    draft_saved_at,
    draft_created_at
  FROM "StudyDraft" AS draft
  WHERE draft."studySessionId" = target_session_id;

  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (
      WHERE draft."revision" > 0
        AND answer."updatedAt" IS DISTINCT FROM draft."savedAt"
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE draft."revision" = 0
        AND (
          answer."selectedOptionId" IS NOT NULL
          OR answer."elapsedSec" <> 0
          OR answer."updatedAt" IS DISTINCT FROM draft."createdAt"
        )
    )::INTEGER
  INTO
    answer_count,
    invalid_answer_timestamp_count,
    invalid_initial_answer_count
  FROM "StudyDraftAnswer" AS answer
  JOIN "StudyDraft" AS draft
    ON draft."studySessionId" = answer."studySessionId"
  WHERE answer."studySessionId" = target_session_id;

  IF parent_version = 1 THEN
    IF draft_count <> 0 OR answer_count <> 0 THEN
      RAISE EXCEPTION 'Version 1 StudySession cannot own a server draft.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END IF;

  IF parent_status = 'IN_PROGRESS' THEN
    IF draft_count <> 1
      OR answer_count <> parent_actual_count
      OR draft_current_ordinal NOT BETWEEN 1 AND parent_actual_count
      OR invalid_answer_timestamp_count <> 0
      OR invalid_initial_answer_count <> 0
      OR (draft_revision = 0 AND draft_saved_at IS NOT NULL)
      OR (draft_revision > 0 AND draft_saved_at IS NULL)
      OR draft_created_at IS NULL THEN
      RAISE EXCEPTION 'Version 2 IN_PROGRESS StudySession requires one complete draft.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF draft_count <> 0 OR answer_count <> 0 THEN
    RAISE EXCEPTION 'Terminal version 2 StudySession cannot retain a draft.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER "StudySession_validate_draft_aggregate"
AFTER INSERT OR UPDATE OR DELETE ON "StudySession"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_study_draft_aggregate"();

CREATE CONSTRAINT TRIGGER "StudySessionQuestion_validate_draft_aggregate"
AFTER INSERT OR UPDATE OR DELETE ON "StudySessionQuestion"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_study_draft_aggregate"();

CREATE CONSTRAINT TRIGGER "StudyDraft_validate_aggregate"
AFTER INSERT OR UPDATE OR DELETE ON "StudyDraft"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_study_draft_aggregate"();

CREATE CONSTRAINT TRIGGER "StudyDraftAnswer_validate_aggregate"
AFTER INSERT OR UPDATE OR DELETE ON "StudyDraftAnswer"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_study_draft_aggregate"();

CREATE OR REPLACE FUNCTION "validate_idempotency_record_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."userId" IS NOT NULL THEN
      PERFORM 1 FROM "User" WHERE "id" = OLD."userId";
      IF NOT FOUND THEN
        RETURN OLD;
      END IF;
    ELSE
      PERFORM 1
      FROM "GuestPrincipal"
      WHERE "id" = OLD."guestPrincipalId";
      IF NOT FOUND THEN
        RETURN OLD;
      END IF;
    END IF;
    PERFORM 1 FROM "StudySession" WHERE "id" = OLD."studySessionId";
    IF NOT FOUND THEN
      RETURN OLD;
    END IF;
    IF OLD."state" = 'SUCCEEDED'
      AND OLD."expiresAt" <= CURRENT_TIMESTAMP THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Active IdempotencyRecord cannot be deleted.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."operation" = 'STUDY_RETRY_CREATE' THEN
    RAISE EXCEPTION 'STUDY_RETRY_CREATE is reserved until the Slice 5 migration.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."operation" = 'STUDY_DRAFT_SAVE'
    AND NEW."contractVersion" <> 2 THEN
    RAISE EXCEPTION 'Draft idempotency records require contract version 2.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."state" <> 'PROCESSING' THEN
      RAISE EXCEPTION 'Idempotency reservation must start in PROCESSING.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."principalType" IS DISTINCT FROM OLD."principalType"
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."guestPrincipalId" IS DISTINCT FROM OLD."guestPrincipalId"
    OR NEW."operation" IS DISTINCT FROM OLD."operation"
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR NEW."studySessionId" IS DISTINCT FROM OLD."studySessionId"
    OR NEW."requestHash" IS DISTINCT FROM OLD."requestHash"
    OR NEW."contractVersion" IS DISTINCT FROM OLD."contractVersion"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR OLD."state" <> 'PROCESSING'
    OR NEW."state" <> 'SUCCEEDED' THEN
    RAISE EXCEPTION 'IdempotencyRecord only allows PROCESSING to SUCCEEDED.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION "validate_idempotency_record_committed_state"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  target_record_id UUID;
  current_state "IdempotencyState";
  current_operation "IdempotencyOperation";
  current_contract_version INTEGER;
  current_session_id UUID;
  current_request_hash VARCHAR(64);
  current_response_status INTEGER;
  current_response_body JSONB;
  current_created_at TIMESTAMPTZ(3);
  current_completed_at TIMESTAMPTZ(3);
  current_expires_at TIMESTAMPTZ(3);
  parent_status "StudySessionStatus";
  parent_contract_version INTEGER;
  parent_submission_hash VARCHAR(64);
  current_draft_revision INTEGER;
  current_draft_ordinal INTEGER;
  current_draft_saved_at TIMESTAMPTZ(3);
  current_response_key_count INTEGER;
  expected_draft_answers JSONB;
BEGIN
  target_record_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD."id"
    ELSE NEW."id"
  END;

  SELECT
    record."state",
    record."operation",
    record."contractVersion",
    record."studySessionId",
    record."requestHash",
    record."responseStatus",
    record."responseBody",
    record."createdAt",
    record."completedAt",
    record."expiresAt"
  INTO
    current_state,
    current_operation,
    current_contract_version,
    current_session_id,
    current_request_hash,
    current_response_status,
    current_response_body,
    current_created_at,
    current_completed_at,
    current_expires_at
  FROM "IdempotencyRecord" AS record
  WHERE record."id" = target_record_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    session."status",
    session."practiceContractVersion",
    session."submissionHash"
  INTO parent_status, parent_contract_version, parent_submission_hash
  FROM "StudySession" AS session
  WHERE session."id" = current_session_id;

  IF NOT FOUND
    OR current_state <> 'SUCCEEDED'
    OR current_response_body IS NULL
    OR JSONB_TYPEOF(current_response_body) IS DISTINCT FROM 'object'
    OR current_completed_at IS NULL
    OR current_completed_at < current_created_at
    OR current_expires_at IS NULL THEN
    RAISE EXCEPTION 'Committed idempotency state is incomplete.'
      USING ERRCODE = '23514';
  END IF;

  IF current_operation = 'STUDY_SUBMIT' THEN
    IF current_response_status IS DISTINCT FROM 201
      OR current_contract_version IS DISTINCT FROM parent_contract_version
      OR current_expires_at IS DISTINCT FROM
        current_completed_at + INTERVAL '24 hours'
      OR parent_status <> 'SUBMITTED'
      OR current_request_hash IS DISTINCT FROM parent_submission_hash
      OR current_response_body ->> 'sessionId' IS DISTINCT FROM
        current_session_id::TEXT THEN
      RAISE EXCEPTION 'Committed submit idempotency state does not match its session.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF current_operation = 'STUDY_DRAFT_SAVE' THEN
    SELECT
      draft."revision",
      draft."currentOrdinal",
      draft."savedAt"
    INTO
      current_draft_revision,
      current_draft_ordinal,
      current_draft_saved_at
    FROM "StudyDraft" AS draft
    WHERE draft."studySessionId" = current_session_id;

    SELECT COUNT(*)
    INTO current_response_key_count
    FROM JSONB_OBJECT_KEYS(current_response_body);

    SELECT JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'studySessionQuestionId', answer."studySessionQuestionId",
        'selectedOptionId', answer."selectedOptionId",
        'elapsedSec', answer."elapsedSec"
      )
      ORDER BY question."ordinal", question."id"
    )
    INTO expected_draft_answers
    FROM "StudyDraftAnswer" AS answer
    INNER JOIN "StudySessionQuestion" AS question
      ON question."studySessionId" = answer."studySessionId"
      AND question."id" = answer."studySessionQuestionId"
    WHERE answer."studySessionId" = current_session_id;

    IF current_response_status IS DISTINCT FROM 200
      OR current_contract_version <> 2
      OR parent_contract_version <> 2
      OR parent_status <> 'IN_PROGRESS'
      OR current_draft_revision IS NULL
      OR current_draft_saved_at IS NULL
      OR current_expires_at IS DISTINCT FROM
        current_completed_at + INTERVAL '48 hours'
      OR current_response_key_count <> 5
      OR NOT current_response_body ?& ARRAY[
        'studySessionId',
        'revision',
        'currentOrdinal',
        'savedAt',
        'answers'
      ]
      OR current_response_body ->> 'studySessionId' IS DISTINCT FROM
        current_session_id::TEXT
      OR JSONB_TYPEOF(current_response_body -> 'revision') IS DISTINCT FROM
        'number'
      OR (current_response_body ->> 'revision')::NUMERIC IS DISTINCT FROM
        current_draft_revision::NUMERIC
      OR JSONB_TYPEOF(current_response_body -> 'currentOrdinal') IS DISTINCT FROM
        'number'
      OR (current_response_body ->> 'currentOrdinal')::NUMERIC IS DISTINCT FROM
        current_draft_ordinal::NUMERIC
      OR JSONB_TYPEOF(current_response_body -> 'savedAt') IS DISTINCT FROM
        'string'
      OR (current_response_body ->> 'savedAt')::TIMESTAMPTZ IS DISTINCT FROM
        current_draft_saved_at
      OR JSONB_TYPEOF(current_response_body -> 'answers') IS DISTINCT FROM
        'array'
      OR current_response_body -> 'answers' IS DISTINCT FROM
        expected_draft_answers THEN
      RAISE EXCEPTION 'Committed draft idempotency state does not match its draft.'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Reserved retry idempotency state cannot be committed in Slice 1.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION "validate_study_submission_snapshot"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  target_session_id UUID;
  session_status "StudySessionStatus";
  session_user_id UUID;
  session_guest_id UUID;
  session_actual_count INTEGER;
  session_duration_sec INTEGER;
  session_submission_hash VARCHAR(64);
  answer_count INTEGER;
  correct_answer_count INTEGER;
  answer_grading_version_count INTEGER;
  result_count INTEGER;
  result_total_count INTEGER;
  result_correct_count INTEGER;
  result_incorrect_count INTEGER;
  result_duration_sec INTEGER;
  result_grading_version VARCHAR(64);
  succeeded_idempotency_count INTEGER;
  invalid_event_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'StudySession' THEN
    target_session_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD."id"
      ELSE NEW."id"
    END;
  ELSIF TG_TABLE_NAME = 'StudyAnswer' THEN
    SELECT item."studySessionId"
    INTO target_session_id
    FROM "StudySessionQuestion" AS item
    WHERE item."id" = CASE
      WHEN TG_OP = 'DELETE' THEN OLD."studySessionQuestionId"
      ELSE NEW."studySessionQuestionId"
    END;
  ELSIF TG_TABLE_NAME = 'StudyResult' THEN
    target_session_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD."studySessionId"
      ELSE NEW."studySessionId"
    END;
  ELSIF TG_TABLE_NAME = 'ReviewEvent' THEN
    target_session_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD."studySessionId"
      ELSE NEW."studySessionId"
    END;
  END IF;

  IF target_session_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    session."status",
    session."userId",
    session."guestPrincipalId",
    session."actualCount",
    session."durationSec",
    session."submissionHash"
  INTO
    session_status,
    session_user_id,
    session_guest_id,
    session_actual_count,
    session_duration_sec,
    session_submission_hash
  FROM "StudySession" AS session
  WHERE session."id" = target_session_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE answer."isCorrect")::INTEGER,
    COUNT(DISTINCT answer."gradingVersion")::INTEGER
  INTO answer_count, correct_answer_count, answer_grading_version_count
  FROM "StudyAnswer" AS answer
  JOIN "StudySessionQuestion" AS item
    ON item."id" = answer."studySessionQuestionId"
    AND item."questionVersionId" = answer."questionVersionId"
  WHERE item."studySessionId" = target_session_id;

  SELECT
    COUNT(*)::INTEGER,
    MAX(result."totalCount"),
    MAX(result."correctCount"),
    MAX(result."incorrectCount"),
    MAX(result."durationSec"),
    MAX(result."gradingVersion")
  INTO
    result_count,
    result_total_count,
    result_correct_count,
    result_incorrect_count,
    result_duration_sec,
    result_grading_version
  FROM "StudyResult" AS result
  WHERE result."studySessionId" = target_session_id;

  IF session_status <> 'SUBMITTED' THEN
    IF answer_count <> 0 OR result_count <> 0 THEN
      RAISE EXCEPTION 'Non-submitted StudySession cannot retain answers or a result.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO succeeded_idempotency_count
  FROM "IdempotencyRecord" AS record
  WHERE record."studySessionId" = target_session_id
    AND record."operation" = 'STUDY_SUBMIT'
    AND record."requestHash" = session_submission_hash
    AND record."state" = 'SUCCEEDED';

  SELECT COUNT(*)::INTEGER
  INTO invalid_event_count
  FROM "StudyAnswer" AS answer
  JOIN "StudySessionQuestion" AS item
    ON item."id" = answer."studySessionQuestionId"
    AND item."questionVersionId" = answer."questionVersionId"
  LEFT JOIN "ReviewEvent" AS event
    ON event."studyAnswerId" = answer."id"
  LEFT JOIN "WrongNote" AS note
    ON note."userId" = session_user_id
    AND note."questionId" = item."questionId"
  WHERE item."studySessionId" = target_session_id
    AND (
      (session_guest_id IS NOT NULL AND event."id" IS NOT NULL)
      OR (
        session_user_id IS NOT NULL
        AND (
          (
            (NOT answer."isCorrect" OR note."id" IS NOT NULL)
            AND event."id" IS NULL
          )
          OR (
            answer."isCorrect"
            AND note."id" IS NULL
            AND event."id" IS NOT NULL
          )
        )
      )
    );

  IF answer_count <> session_actual_count
    OR correct_answer_count <> result_correct_count
    OR result_count <> 1
    OR result_total_count <> session_actual_count
    OR result_incorrect_count <> session_actual_count - correct_answer_count
    OR result_duration_sec IS DISTINCT FROM session_duration_sec
    OR answer_grading_version_count <> 1
    OR result_grading_version <> 'server-grading-v1'
    OR succeeded_idempotency_count <> 1
    OR invalid_event_count <> 0 THEN
    RAISE EXCEPTION 'Submitted StudySession facts are incomplete or inconsistent.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$function$;

COMMIT;
