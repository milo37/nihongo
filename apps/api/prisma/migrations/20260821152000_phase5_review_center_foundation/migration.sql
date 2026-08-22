-- Phase 5 Slice 1: UserMemo persistence, stable ReviewEvent history cursor,
-- targeted-review idempotency invariants, and zero-drift preflight.
-- Existing migrations remain immutable.

BEGIN;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum AS enum_value
    JOIN pg_type AS enum_type
      ON enum_type.oid = enum_value.enumtypid
    JOIN pg_namespace AS enum_namespace
      ON enum_namespace.oid = enum_type.typnamespace
    WHERE enum_namespace.nspname = current_schema()
      AND enum_type.typname = 'IdempotencyOperation'
      AND enum_value.enumlabel = 'STUDY_TARGETED_REVIEW_CREATE'
  ) THEN
    RAISE EXCEPTION
      'Phase 5 review-center foundation requires the committed enum migration.'
      USING ERRCODE = '23514';
  END IF;

  IF to_regclass('"UserMemo"') IS NOT NULL
    OR to_regclass('"ReviewEvent_wrongNoteId_occurredAt_id_idx"') IS NOT NULL
    OR to_regprocedure('normalize_user_memo_text(text)') IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_record
      WHERE constraint_record.conrelid = '"IdempotencyRecord"'::regclass
        AND constraint_record.conname = 'IdempotencyRecord_state_check'
        AND pg_get_constraintdef(constraint_record.oid) LIKE
          '%STUDY_TARGETED_REVIEW_CREATE%'
    )
    OR EXISTS (
      SELECT 1
      FROM pg_proc AS procedure_record
      JOIN pg_namespace AS procedure_namespace
        ON procedure_namespace.oid = procedure_record.pronamespace
      WHERE procedure_namespace.nspname = current_schema()
        AND procedure_record.proname IN (
          'validate_idempotency_record_change',
          'validate_idempotency_record_committed_state'
        )
        AND pg_get_functiondef(procedure_record.oid) LIKE
          '%STUDY_TARGETED_REVIEW_CREATE%'
    )
    OR (
      SELECT COUNT(*)
      FROM pg_trigger AS trigger_record
      JOIN pg_proc AS trigger_procedure
        ON trigger_procedure.oid = trigger_record.tgfoid
      JOIN pg_namespace AS trigger_procedure_namespace
        ON trigger_procedure_namespace.oid = trigger_procedure.pronamespace
      WHERE trigger_record.tgrelid = '"IdempotencyRecord"'::regclass
        AND NOT trigger_record.tgisinternal
        AND trigger_record.tgenabled = 'O'
        AND trigger_record.tgqual IS NULL
        AND trigger_record.tgattr = ''::int2vector
        AND trigger_record.tgnargs = 0
        AND trigger_procedure_namespace.nspname = current_schema()
        AND (
          (trigger_record.tgname = 'IdempotencyRecord_validate_change'
            AND trigger_procedure.proname =
              'validate_idempotency_record_change'
            AND trigger_record.tgtype = 31
            AND trigger_record.tgconstraint = 0
            AND NOT trigger_record.tgdeferrable
            AND NOT trigger_record.tginitdeferred)
          OR (trigger_record.tgname =
                'IdempotencyRecord_validate_committed_state'
            AND trigger_procedure.proname =
              'validate_idempotency_record_committed_state'
            AND trigger_record.tgtype = 21
            AND trigger_record.tgconstraint <> 0
            AND trigger_record.tgdeferrable
            AND trigger_record.tginitdeferred)
        )
    ) <> 2 THEN
    RAISE EXCEPTION
      'Phase 5 review-center foundation requires zero partial objects.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "IdempotencyRecord"
    WHERE "operation" = 'STUDY_TARGETED_REVIEW_CREATE'
  ) THEN
    RAISE EXCEPTION
      'Reserved targeted-review idempotency rows must be empty before migration.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH ordered_event AS (
      SELECT
        event.*,
        ROW_NUMBER() OVER (
          PARTITION BY event."wrongNoteId"
          ORDER BY event."occurredAt" ASC, event."id" ASC
        ) AS event_ordinal,
        LAG(event."nextStatus") OVER (
          PARTITION BY event."wrongNoteId"
          ORDER BY event."occurredAt" ASC, event."id" ASC
        ) AS expected_previous_status,
        LAG(event."nextCorrectStreak") OVER (
          PARTITION BY event."wrongNoteId"
          ORDER BY event."occurredAt" ASC, event."id" ASC
        ) AS expected_previous_streak,
        LAG(event."wrongCountAfter") OVER (
          PARTITION BY event."wrongNoteId"
          ORDER BY event."occurredAt" ASC, event."id" ASC
        ) AS expected_previous_wrong_count,
        LAG(event."occurredAt") OVER (
          PARTITION BY event."wrongNoteId"
          ORDER BY event."occurredAt" ASC, event."id" ASC
        ) AS expected_previous_occurred_at
      FROM "ReviewEvent" AS event
    )
    SELECT 1
    FROM ordered_event
    WHERE (event_ordinal = 1 AND (
        "previousStatus" IS NOT NULL
        OR "previousCorrectStreak" IS NOT NULL
        OR "previousWrongCount" IS NOT NULL
      ))
      OR (event_ordinal > 1 AND (
        "previousStatus" IS DISTINCT FROM expected_previous_status
        OR "previousCorrectStreak" IS DISTINCT FROM expected_previous_streak
        OR "previousWrongCount" IS DISTINCT FROM expected_previous_wrong_count
        OR "occurredAt" <= expected_previous_occurred_at
      ))
  ) THEN
    RAISE EXCEPTION
      'ReviewEvent history contains a broken previous/next chain.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH latest_event AS (
      SELECT DISTINCT ON (event."wrongNoteId")
        event."wrongNoteId",
        event."nextStatus",
        event."nextCorrectStreak",
        event."wrongCountAfter"
      FROM "ReviewEvent" AS event
      ORDER BY event."wrongNoteId", event."occurredAt" DESC, event."id" DESC
    )
    SELECT 1
    FROM "WrongNote" AS note
    LEFT JOIN latest_event
      ON latest_event."wrongNoteId" = note."id"
    WHERE latest_event."wrongNoteId" IS NULL
      OR note."status" IS DISTINCT FROM latest_event."nextStatus"
      OR note."correctStreak" IS DISTINCT FROM
        latest_event."nextCorrectStreak"
      OR note."wrongCount" IS DISTINCT FROM latest_event."wrongCountAfter"
  ) THEN
    RAISE EXCEPTION
      'WrongNote materialized state does not match its latest ReviewEvent.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH latest_substantive_event AS (
      SELECT DISTINCT ON (event."wrongNoteId")
        event."wrongNoteId",
        event."isCorrect",
        event."nextCorrectStreak",
        event."algorithmVersion",
        event."occurredAt",
        event."questionVersionId",
        COUNT(*) OVER (
          PARTITION BY event."wrongNoteId"
        ) AS substantive_event_count,
        CASE
          WHEN NOT event."isCorrect" THEN 1
          WHEN event."nextCorrectStreak" = 1 THEN 3
          WHEN event."nextCorrectStreak" = 2 THEN 7
          WHEN event."nextCorrectStreak" = 3 THEN 14
          ELSE 30
        END AS expected_interval_days
      FROM "ReviewEvent" AS event
      WHERE event."source" <> 'VERSION_REBASE'
      ORDER BY event."wrongNoteId", event."occurredAt" DESC, event."id" DESC
    ),
    latest_wrong_event AS (
      SELECT DISTINCT ON (event."wrongNoteId")
        event."wrongNoteId",
        event."questionVersionId",
        event."occurredAt"
      FROM "ReviewEvent" AS event
      WHERE event."source" <> 'VERSION_REBASE'
        AND NOT event."isCorrect"
      ORDER BY event."wrongNoteId", event."occurredAt" DESC, event."id" DESC
    )
    SELECT 1
    FROM "WrongNote" AS note
    LEFT JOIN latest_substantive_event AS event
      ON event."wrongNoteId" = note."id"
    LEFT JOIN "ReviewSchedule" AS schedule
      ON schedule."wrongNoteId" = note."id"
    LEFT JOIN latest_wrong_event AS wrong_event
      ON wrong_event."wrongNoteId" = note."id"
    WHERE event."wrongNoteId" IS NULL
      OR wrong_event."wrongNoteId" IS NULL
      OR schedule."wrongNoteId" IS NULL
      OR event."algorithmVersion" <> 1
      OR schedule."algorithmVersion" <> event."algorithmVersion"
      OR schedule."intervalDays" <> event.expected_interval_days
      OR schedule."nextReviewAt" <>
        event."occurredAt" + event.expected_interval_days * INTERVAL '24 hours'
      OR note."lastWrongQuestionVersionId" IS DISTINCT FROM
        wrong_event."questionVersionId"
      OR note."lastWrongAt" IS DISTINCT FROM wrong_event."occurredAt"
      OR note."lastReviewedAt" IS DISTINCT FROM CASE
        WHEN event.substantive_event_count = 1 THEN NULL
        ELSE event."occurredAt"
      END
      OR note."updatedAt" IS DISTINCT FROM event."occurredAt"
      OR schedule."updatedAt" IS DISTINCT FROM event."occurredAt"
  ) THEN
    RAISE EXCEPTION
      'ReviewSchedule does not match the latest substantive ReviewEvent.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ReviewEvent" AS event
    LEFT JOIN "QuestionVersion" AS version
      ON version."id" = event."questionVersionId"
      AND version."questionId" = event."questionId"
    LEFT JOIN "StudyAnswer" AS answer
      ON answer."id" = event."studyAnswerId"
      AND answer."questionVersionId" = event."questionVersionId"
    LEFT JOIN "StudySessionQuestion" AS item
      ON item."id" = answer."studySessionQuestionId"
      AND item."studySessionId" = event."studySessionId"
      AND item."questionId" = event."questionId"
      AND item."questionVersionId" = event."questionVersionId"
    LEFT JOIN "StudySession" AS session
      ON session."id" = event."studySessionId"
    WHERE version."id" IS NULL
      OR (event."source" = 'VERSION_REBASE' AND (
        event."studySessionId" IS NOT NULL
        OR event."studyAnswerId" IS NOT NULL
        OR event."selectedOptionId" IS NOT NULL
        OR event."isCorrect" IS NOT NULL
      ))
      OR (event."source" <> 'VERSION_REBASE' AND (
        answer."id" IS NULL
        OR item."id" IS NULL
        OR session."id" IS NULL
        OR session."status" <> 'SUBMITTED'
        OR session."userId" IS DISTINCT FROM event."userId"
        OR event."isCorrect" IS DISTINCT FROM answer."isCorrect"
        OR event."selectedOptionId" IS DISTINCT FROM answer."selectedOptionId"
        OR (event."source" = 'STUDY_SUBMIT'
          AND session."mode" NOT IN ('RANDOM', 'WEAKNESS', 'BOOKMARK'))
        OR (event."source" = 'WRONG_NOTE_REVIEW'
          AND session."mode" NOT IN ('WRONG_NOTE', 'DAILY_REVIEW'))
        OR (session."retryOfStudySessionId" IS NOT NULL AND NOT (
          event."source" = 'WRONG_NOTE_REVIEW'
          AND session."mode" = 'WRONG_NOTE'
          AND EXISTS (
            SELECT 1
            FROM "StudySessionQuestion" AS source_item
            JOIN "StudyAnswer" AS source_answer
              ON source_answer."studySessionQuestionId" = source_item."id"
              AND source_answer."questionVersionId" =
                source_item."questionVersionId"
            WHERE source_item."studySessionId" =
                session."retryOfStudySessionId"
              AND source_item."questionId" = event."questionId"
              AND source_item."questionVersionId" =
                event."questionVersionId"
              AND NOT source_answer."isCorrect"
          )
        ))
      ))
      OR EXISTS (
        SELECT 1
        FROM "ReviewEvent" AS duplicate_event
        WHERE duplicate_event."studyAnswerId" IS NOT NULL
        GROUP BY duplicate_event."studyAnswerId"
        HAVING COUNT(*) > 1
      )
  ) THEN
    RAISE EXCEPTION
      'ReviewEvent contains invalid version or answer evidence.'
      USING ERRCODE = '23514';
  END IF;
END;
$block$;

CREATE FUNCTION "normalize_user_memo_text"(TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
  SELECT btrim(
    $1,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
  )
$function$;

CREATE TABLE "UserMemo" (
  "id" UUID NOT NULL,
  "wrongNoteId" UUID NOT NULL,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "UserMemo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserMemo_wrongNoteId_key" UNIQUE ("wrongNoteId"),
  CONSTRAINT "UserMemo_wrongNoteId_fkey"
    FOREIGN KEY ("wrongNoteId") REFERENCES "WrongNote"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserMemo_text_normalized_check" CHECK (
    "text" = "normalize_user_memo_text"("text")
    AND char_length("text") BETWEEN 1 AND 2000
  ),
  CONSTRAINT "UserMemo_timestamp_order_check" CHECK (
    "updatedAt" >= "createdAt"
  )
);

CREATE INDEX "ReviewEvent_wrongNoteId_occurredAt_id_idx"
  ON "ReviewEvent"("wrongNoteId", "occurredAt" DESC, "id" DESC);

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
        OR ("operation" IN (
            'STUDY_RETRY_CREATE',
            'STUDY_TARGETED_REVIEW_CREATE'
          )
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
    IF OLD."state" = 'SUCCEEDED'
      AND OLD."expiresAt" <= CURRENT_TIMESTAMP THEN
      RETURN OLD;
    END IF;
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
    RAISE EXCEPTION 'Active IdempotencyRecord cannot be deleted.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."operation" IN (
      'STUDY_DRAFT_SAVE',
      'STUDY_RETRY_CREATE',
      'STUDY_TARGETED_REVIEW_CREATE'
    )
    AND NEW."contractVersion" <> 2 THEN
    RAISE EXCEPTION
      'Draft, retry, and targeted-review records require contract version 2.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."operation" = 'STUDY_TARGETED_REVIEW_CREATE'
    AND (
      NEW."principalType" <> 'USER'
      OR NEW."userId" IS NULL
      OR NEW."guestPrincipalId" IS NOT NULL
    ) THEN
    RAISE EXCEPTION
      'Targeted-review idempotency records require a user principal.'
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
  current_principal_type "IdempotencyPrincipalType";
  current_user_id UUID;
  current_guest_id UUID;
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
  parent_user_id UUID;
  parent_guest_id UUID;
  source_status "StudySessionStatus";
  current_draft_revision INTEGER;
  current_draft_ordinal INTEGER;
  current_draft_saved_at TIMESTAMPTZ(3);
  current_draft_answer_count INTEGER;
  current_session_question_count INTEGER;
  current_response_key_count INTEGER;
  current_session_key_count INTEGER;
  current_response_question_count INTEGER;
  target_question_id UUID;
  target_question_version_id UUID;
  target_pointer_count INTEGER;
  target_review_event_count INTEGER;
  target_study_answer_count INTEGER;
  target_study_result_count INTEGER;
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
    record."principalType",
    record."userId",
    record."guestPrincipalId",
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
    current_principal_type,
    current_user_id,
    current_guest_id,
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
    session."mode",
    session."userId",
    session."guestPrincipalId"
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
    parent_mode,
    parent_user_id,
    parent_guest_id
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
  ELSIF current_operation = 'STUDY_TARGETED_REVIEW_CREATE' THEN
    SELECT COUNT(*)
    INTO current_session_question_count
    FROM "StudySessionQuestion" AS item
    WHERE item."studySessionId" = current_session_id;

    SELECT
      item."questionId",
      item."questionVersionId"
    INTO
      target_question_id,
      target_question_version_id
    FROM "StudySessionQuestion" AS item
    JOIN "Question" AS question
      ON question."id" = item."questionId"
      AND question."lifecycleStatus" = 'ACTIVE'
      AND question."currentPublishedVersionId" = item."questionVersionId"
    JOIN "QuestionVersion" AS version
      ON version."id" = item."questionVersionId"
      AND version."questionId" = item."questionId"
      AND version."status" = 'PUBLISHED'
    WHERE item."studySessionId" = current_session_id
      AND item."ordinal" = 1;

    SELECT
      draft."revision",
      draft."currentOrdinal",
      draft."savedAt",
      COUNT(answer."studySessionQuestionId")::INTEGER
    INTO
      current_draft_revision,
      current_draft_ordinal,
      current_draft_saved_at,
      current_draft_answer_count
    FROM "StudyDraft" AS draft
    LEFT JOIN "StudyDraftAnswer" AS answer
      ON answer."studySessionId" = draft."studySessionId"
    WHERE draft."studySessionId" = current_session_id
    GROUP BY draft."revision", draft."currentOrdinal", draft."savedAt";

    SELECT COUNT(*)
    INTO target_pointer_count
    FROM "WrongNote" AS note
    WHERE note."userId" = current_user_id
      AND note."questionId" = target_question_id
      AND note."currentReviewQuestionVersionId" = target_question_version_id;

    SELECT
      COUNT(DISTINCT event."id")::INTEGER,
      COUNT(DISTINCT answer."id")::INTEGER,
      COUNT(DISTINCT result."id")::INTEGER
    INTO
      target_review_event_count,
      target_study_answer_count,
      target_study_result_count
    FROM "StudySession" AS session
    LEFT JOIN "ReviewEvent" AS event
      ON event."studySessionId" = session."id"
    LEFT JOIN "StudySessionQuestion" AS item
      ON item."studySessionId" = session."id"
    LEFT JOIN "StudyAnswer" AS answer
      ON answer."studySessionQuestionId" = item."id"
      AND answer."questionVersionId" = item."questionVersionId"
    LEFT JOIN "StudyResult" AS result
      ON result."studySessionId" = session."id"
    WHERE session."id" = current_session_id;

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
      'submittedAt', NULL,
      'durationSec', NULL,
      'practiceContractVersion', parent_contract_version
    );

    IF current_principal_type <> 'USER'
      OR current_user_id IS NULL
      OR current_guest_id IS NOT NULL
      OR parent_user_id IS DISTINCT FROM current_user_id
      OR parent_guest_id IS NOT NULL
      OR current_response_status IS DISTINCT FROM 201
      OR current_contract_version <> 2
      OR parent_contract_version <> 2
      OR parent_status <> 'IN_PROGRESS'
      OR parent_mode <> 'WRONG_NOTE'
      OR parent_requested_count <> 1
      OR parent_actual_count <> 1
      OR parent_used_fallback
      OR parent_fallback_reason IS NOT NULL
      OR parent_retry_id IS NOT NULL
      OR current_session_question_count <> 1
      OR target_question_id IS NULL
      OR target_question_version_id IS NULL
      OR current_draft_revision IS DISTINCT FROM 0
      OR current_draft_ordinal IS DISTINCT FROM 1
      OR current_draft_saved_at IS NOT NULL
      OR current_draft_answer_count IS DISTINCT FROM 1
      OR target_pointer_count <> 1
      OR target_review_event_count <> 0
      OR target_study_answer_count <> 0
      OR target_study_result_count <> 0
      OR current_expires_at IS DISTINCT FROM
        current_completed_at + INTERVAL '7 days'
      OR current_response_body IS DISTINCT FROM JSONB_BUILD_OBJECT(
        'session', expected_retry_session,
        'questions', expected_retry_questions
      ) THEN
      RAISE EXCEPTION
        'Committed targeted-review state does not match its owner, note, draft, or response.'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported idempotency operation.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$function$;

COMMIT;
