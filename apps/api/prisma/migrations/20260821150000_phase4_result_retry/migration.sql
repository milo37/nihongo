-- Phase 4 Slice 5: historical result-retry sessions, owner-preserving retry
-- relations, and seven-day retry-create idempotency replay.
-- Existing migrations remain immutable.

BEGIN;

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "IdempotencyRecord"
    WHERE "operation" = 'STUDY_RETRY_CREATE'
  ) THEN
    RAISE EXCEPTION
      'Slice 5 requires every reserved retry idempotency operation to have zero rows.'
      USING ERRCODE = '23514';
  END IF;
END;
$block$;

ALTER TABLE "StudySession"
  ADD COLUMN "retryOfStudySessionId" UUID,
  ADD CONSTRAINT "StudySession_retry_shape_check" CHECK (
    "retryOfStudySessionId" IS NULL
    OR (
      "retryOfStudySessionId" <> "id"
      AND "practiceContractVersion" = 2
      AND NOT "usedFallback"
      AND "fallbackReason" IS NULL
      AND (
        ("userId" IS NOT NULL
          AND "guestPrincipalId" IS NULL
          AND "mode" = 'WRONG_NOTE')
        OR ("userId" IS NULL
          AND "guestPrincipalId" IS NOT NULL
          AND "mode" = 'RANDOM')
      )
    )
  );

CREATE INDEX "StudySession_retryOfStudySessionId_id_idx"
  ON "StudySession"("retryOfStudySessionId", "id");
CREATE INDEX "StudySession_retry_user_source_idx"
  ON "StudySession"("retryOfStudySessionId", "userId")
  WHERE "retryOfStudySessionId" IS NOT NULL AND "userId" IS NOT NULL;
CREATE INDEX "StudySession_retry_guest_source_idx"
  ON "StudySession"("retryOfStudySessionId", "guestPrincipalId")
  WHERE "retryOfStudySessionId" IS NOT NULL
    AND "guestPrincipalId" IS NOT NULL;

ALTER TABLE "StudySession"
  ADD CONSTRAINT "StudySession_retryOfStudySessionId_fkey"
  FOREIGN KEY ("retryOfStudySessionId") REFERENCES "StudySession"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT "StudySession_retryOfStudySessionId_userId_fkey"
  FOREIGN KEY ("retryOfStudySessionId", "userId")
  REFERENCES "StudySession"("id", "userId")
  ON DELETE NO ACTION ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT "StudySession_retryOfStudySessionId_guestPrincipalId_fkey"
  FOREIGN KEY ("retryOfStudySessionId", "guestPrincipalId")
  REFERENCES "StudySession"("id", "guestPrincipalId")
  ON DELETE NO ACTION ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

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
    OR NEW."retryOfStudySessionId" IS DISTINCT FROM
      OLD."retryOfStudySessionId"
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

CREATE FUNCTION "validate_study_retry_relation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  target_session_id UUID;
  source_status "StudySessionStatus";
  source_user_id UUID;
  source_guest_id UUID;
  target_user_id UUID;
  target_guest_id UUID;
  target_retry_id UUID;
  target_contract_version INTEGER;
  target_mode "StudyMode";
  source_result_count INTEGER;
BEGIN
  target_session_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD."id"
    ELSE NEW."id"
  END;

  SELECT
    target."retryOfStudySessionId",
    target."userId",
    target."guestPrincipalId",
    target."practiceContractVersion",
    target."mode"
  INTO
    target_retry_id,
    target_user_id,
    target_guest_id,
    target_contract_version,
    target_mode
  FROM "StudySession" AS target
  WHERE target."id" = target_session_id;

  IF NOT FOUND OR target_retry_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    WITH RECURSIVE retry_ancestry AS (
      SELECT source."id", source."retryOfStudySessionId"
      FROM "StudySession" AS source
      WHERE source."id" = target_retry_id
      UNION
      SELECT source."id", source."retryOfStudySessionId"
      FROM "StudySession" AS source
      JOIN retry_ancestry AS child
        ON source."id" = child."retryOfStudySessionId"
    )
    SELECT 1
    FROM retry_ancestry
    WHERE "id" = target_session_id
  ) THEN
    RAISE EXCEPTION 'Retry StudySession relation cannot contain a cycle.'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    source."status",
    source."userId",
    source."guestPrincipalId",
    COUNT(result."studySessionId")::INTEGER
  INTO
    source_status,
    source_user_id,
    source_guest_id,
    source_result_count
  FROM "StudySession" AS source
  LEFT JOIN "StudyResult" AS result
    ON result."studySessionId" = source."id"
  WHERE source."id" = target_retry_id
  GROUP BY source."status", source."userId", source."guestPrincipalId";

  IF NOT FOUND
    OR source_status <> 'SUBMITTED'
    OR source_result_count <> 1
    OR target_contract_version <> 2
    OR target_retry_id = target_session_id
    OR target_user_id IS DISTINCT FROM source_user_id
    OR target_guest_id IS DISTINCT FROM source_guest_id
    OR (target_user_id IS NOT NULL AND target_mode <> 'WRONG_NOTE')
    OR (target_guest_id IS NOT NULL AND target_mode <> 'RANDOM') THEN
    RAISE EXCEPTION
      'Retry StudySession must reference one submitted result owned by the same actor.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER "StudySession_validate_retry_relation"
AFTER INSERT OR UPDATE OR DELETE ON "StudySession"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_study_retry_relation"();

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
        OR ("operation" = 'STUDY_RETRY_CREATE'
          AND "responseStatus" = 201
          AND "expiresAt" = "completedAt" + INTERVAL '7 days')
      ))
  );

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

  IF NEW."operation" IN ('STUDY_DRAFT_SAVE', 'STUDY_RETRY_CREATE')
    AND NEW."contractVersion" <> 2 THEN
    RAISE EXCEPTION
      'Draft and retry idempotency records require contract version 2.'
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
  parent_level "JlptLevel";
  parent_subject "QuestionSubject";
  parent_requested_count INTEGER;
  parent_actual_count INTEGER;
  parent_used_fallback BOOLEAN;
  parent_fallback_reason "StudySessionFallbackReason";
  parent_started_at TIMESTAMPTZ(3);
  parent_expires_at TIMESTAMPTZ(3);
  parent_submitted_at TIMESTAMPTZ(3);
  parent_duration_sec INTEGER;
  parent_submission_hash VARCHAR(64);
  parent_retry_id UUID;
  parent_mode "StudyMode";
  source_status "StudySessionStatus";
  current_draft_revision INTEGER;
  current_draft_ordinal INTEGER;
  current_draft_saved_at TIMESTAMPTZ(3);
  current_response_key_count INTEGER;
  current_session_key_count INTEGER;
  current_response_question_count INTEGER;
  expected_draft_answers JSONB;
  expected_retry_session JSONB;
  expected_retry_questions JSONB;
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
    session."level",
    session."subject",
    session."requestedCount",
    session."actualCount",
    session."usedFallback",
    session."fallbackReason",
    session."startedAt",
    session."expiresAt",
    session."submittedAt",
    session."durationSec",
    session."submissionHash",
    session."retryOfStudySessionId",
    session."mode"
  INTO
    parent_status,
    parent_contract_version,
    parent_level,
    parent_subject,
    parent_requested_count,
    parent_actual_count,
    parent_used_fallback,
    parent_fallback_reason,
    parent_started_at,
    parent_expires_at,
    parent_submitted_at,
    parent_duration_sec,
    parent_submission_hash,
    parent_retry_id,
    parent_mode
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
      RAISE EXCEPTION
        'Committed submit idempotency state does not match its session.'
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
      RAISE EXCEPTION
        'Committed draft idempotency state does not match its draft.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF current_operation = 'STUDY_RETRY_CREATE' THEN
    SELECT source."status"
    INTO source_status
    FROM "StudySession" AS source
    WHERE source."id" = parent_retry_id;

    SELECT COUNT(*)
    INTO current_response_key_count
    FROM JSONB_OBJECT_KEYS(current_response_body);

    IF JSONB_TYPEOF(current_response_body -> 'session') = 'object' THEN
      SELECT COUNT(*)
      INTO current_session_key_count
      FROM JSONB_OBJECT_KEYS(current_response_body -> 'session');
    ELSE
      current_session_key_count := -1;
    END IF;

    IF JSONB_TYPEOF(current_response_body -> 'questions') = 'array' THEN
      current_response_question_count :=
        JSONB_ARRAY_LENGTH(current_response_body -> 'questions');
    ELSE
      current_response_question_count := -1;
    END IF;

    SELECT JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'sessionQuestionId', item."id"::TEXT,
        'ordinal', item."ordinal",
        'question', JSONB_BUILD_OBJECT(
          'id', item."questionId"::TEXT,
          'questionVersionId', version."id"::TEXT,
          'level', version."level"::TEXT,
          'subject', version."subject"::TEXT,
          'questionType', version."questionType"::TEXT,
          'passage', version."passage",
          'questionText', version."questionText",
          'options', (
            SELECT JSONB_AGG(
              JSONB_BUILD_OBJECT(
                'id', option."id"::TEXT,
                'label', option."label",
                'text', option."text"
              )
              ORDER BY option."ordinal" ASC
            )
            FROM "QuestionOption" AS option
            WHERE option."questionVersionId" = version."id"
          ),
          'difficulty', version."difficulty"::TEXT,
          'tags', (
            SELECT JSONB_AGG(
              JSONB_BUILD_OBJECT(
                'id', tag."tagId"::TEXT,
                'label', tag."labelSnapshot"
              )
              ORDER BY tag."labelSnapshot" COLLATE "C" ASC, tag."tagId" ASC
            )
            FROM "QuestionVersionTag" AS tag
            WHERE tag."questionVersionId" = version."id"
          )
        )
      )
      ORDER BY item."ordinal" ASC, item."id" ASC
    )
    INTO expected_retry_questions
    FROM "StudySessionQuestion" AS item
    JOIN "QuestionVersion" AS version
      ON version."id" = item."questionVersionId"
      AND version."questionId" = item."questionId"
    WHERE item."studySessionId" = current_session_id;

    expected_retry_session := JSONB_BUILD_OBJECT(
      'id', current_session_id::TEXT,
      'level', parent_level::TEXT,
      'subject', parent_subject::TEXT,
      'mode', parent_mode::TEXT,
      'status', parent_status::TEXT,
      'requestedCount', parent_requested_count,
      'actualCount', parent_actual_count,
      'usedFallback', parent_used_fallback,
      'fallbackReason', parent_fallback_reason,
      'startedAt', TO_CHAR(
        parent_started_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'expiresAt', TO_CHAR(
        parent_expires_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'submittedAt', CASE
        WHEN parent_submitted_at IS NULL THEN NULL
        ELSE TO_CHAR(
          parent_submitted_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      END,
      'durationSec', parent_duration_sec,
      'practiceContractVersion', parent_contract_version
    );

    IF current_response_status IS DISTINCT FROM 201
      OR current_contract_version <> 2
      OR parent_contract_version <> 2
      OR parent_status <> 'IN_PROGRESS'
      OR parent_retry_id IS NULL
      OR source_status <> 'SUBMITTED'
      OR current_expires_at IS DISTINCT FROM
        current_completed_at + INTERVAL '7 days'
      OR current_response_body IS DISTINCT FROM JSONB_BUILD_OBJECT(
        'session', expected_retry_session,
        'questions', expected_retry_questions
      ) THEN
      RAISE EXCEPTION
        'Committed retry idempotency state does not match its target session.'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported idempotency operation.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION "validate_review_event_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  evidence_selected_option_id UUID;
  evidence_is_correct BOOLEAN;
  evidence_question_id UUID;
  evidence_session_id UUID;
  evidence_user_id UUID;
  evidence_mode "StudyMode";
  evidence_status "StudySessionStatus";
  evidence_retry_source_id UUID;
  prior_status "WrongNoteStatus";
  prior_correct_streak INTEGER;
  prior_wrong_count INTEGER;
  prior_occurred_at TIMESTAMPTZ(3);
  has_prior_event BOOLEAN := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'ReviewEvent is append-only.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM "User" WHERE "id" = OLD."userId";
    IF NOT FOUND THEN
      RETURN OLD;
    END IF;
    PERFORM 1 FROM "WrongNote" WHERE "id" = OLD."wrongNoteId";
    IF NOT FOUND THEN
      RETURN OLD;
    END IF;
    IF OLD."studyAnswerId" IS NOT NULL THEN
      PERFORM 1 FROM "StudyAnswer" WHERE "id" = OLD."studyAnswerId";
      IF NOT FOUND THEN
        RETURN OLD;
      END IF;
    END IF;
    RAISE EXCEPTION 'ReviewEvent is append-only.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM "WrongNote"
  WHERE "id" = NEW."wrongNoteId"
  FOR UPDATE;

  IF FOUND THEN
    SELECT
      event."nextStatus",
      event."nextCorrectStreak",
      event."wrongCountAfter",
      event."occurredAt"
    INTO
      prior_status,
      prior_correct_streak,
      prior_wrong_count,
      prior_occurred_at
    FROM "ReviewEvent" AS event
    WHERE event."wrongNoteId" = NEW."wrongNoteId"
    ORDER BY event."occurredAt" DESC, event."id" DESC
    LIMIT 1;
    has_prior_event := FOUND;

    IF NOT has_prior_event AND (
      NEW."previousStatus" IS NOT NULL
      OR NEW."previousCorrectStreak" IS NOT NULL
      OR NEW."previousWrongCount" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'First ReviewEvent must have a null previous snapshot.'
        USING ERRCODE = '23514';
    END IF;

    IF has_prior_event AND (
      NEW."previousStatus" IS DISTINCT FROM prior_status
      OR NEW."previousCorrectStreak" IS DISTINCT FROM prior_correct_streak
      OR NEW."previousWrongCount" IS DISTINCT FROM prior_wrong_count
      OR NEW."occurredAt" <= prior_occurred_at
    ) THEN
      RAISE EXCEPTION
        'ReviewEvent must extend the latest event snapshot monotonically.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."source" = 'VERSION_REBASE' THEN
    RETURN NEW;
  END IF;

  SELECT
    answer."selectedOptionId",
    answer."isCorrect",
    item."questionId",
    item."studySessionId",
    session."userId",
    session."mode",
    session."status",
    session."retryOfStudySessionId"
  INTO
    evidence_selected_option_id,
    evidence_is_correct,
    evidence_question_id,
    evidence_session_id,
    evidence_user_id,
    evidence_mode,
    evidence_status,
    evidence_retry_source_id
  FROM "StudyAnswer" AS answer
  JOIN "StudySessionQuestion" AS item
    ON item."id" = answer."studySessionQuestionId"
    AND item."questionVersionId" = answer."questionVersionId"
  JOIN "StudySession" AS session
    ON session."id" = item."studySessionId"
  WHERE answer."id" = NEW."studyAnswerId"
    AND answer."questionVersionId" = NEW."questionVersionId";

  IF NOT FOUND
    OR evidence_status <> 'IN_PROGRESS'
    OR evidence_user_id IS NULL
    OR NEW."userId" <> evidence_user_id
    OR NEW."questionId" <> evidence_question_id
    OR NEW."studySessionId" <> evidence_session_id
    OR NEW."selectedOptionId" IS DISTINCT FROM evidence_selected_option_id
    OR NEW."isCorrect" IS DISTINCT FROM evidence_is_correct
    OR (NEW."source" = 'WRONG_NOTE_REVIEW'
      AND evidence_mode NOT IN ('WRONG_NOTE', 'DAILY_REVIEW'))
    OR (NEW."source" = 'STUDY_SUBMIT'
      AND evidence_mode NOT IN ('RANDOM', 'WEAKNESS', 'BOOKMARK'))
    OR (evidence_retry_source_id IS NOT NULL AND (
      evidence_mode <> 'WRONG_NOTE'
      OR NEW."source" <> 'WRONG_NOTE_REVIEW'
      OR NOT EXISTS (
        SELECT 1
        FROM "StudySessionQuestion" AS source_item
        JOIN "StudyAnswer" AS source_answer
          ON source_answer."studySessionQuestionId" = source_item."id"
          AND source_answer."questionVersionId" =
            source_item."questionVersionId"
        WHERE source_item."studySessionId" = evidence_retry_source_id
          AND source_item."questionId" = evidence_question_id
          AND source_item."questionVersionId" = NEW."questionVersionId"
          AND NOT source_answer."isCorrect"
      )
    ))
    OR NEW."source" NOT IN (
      'WRONG_NOTE_REVIEW',
      'STUDY_SUBMIT',
      'VERSION_REBASE'
    ) THEN
    RAISE EXCEPTION 'ReviewEvent evidence does not match its StudyAnswer owner.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
