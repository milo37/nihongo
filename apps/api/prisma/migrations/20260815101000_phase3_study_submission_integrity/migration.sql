-- Phase 3 Slice 4 follow-up: close SQL NULL semantics and make WrongNote
-- materialization provably follow the append-only ReviewEvent chain.

BEGIN;

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "IdempotencyRecord" AS record
    WHERE (
      (record."state" = 'PROCESSING'
        AND record."responseStatus" IS NULL
        AND record."responseBody" IS NULL
        AND record."completedAt" IS NULL
        AND record."expiresAt" IS NULL)
      OR (record."state" = 'SUCCEEDED'
        AND record."responseStatus" IS NOT NULL
        AND record."responseStatus" = 201
        AND record."responseBody" IS NOT NULL
        AND JSONB_TYPEOF(record."responseBody") = 'object'
        AND record."completedAt" IS NOT NULL
        AND record."completedAt" >= record."createdAt"
        AND record."expiresAt" IS NOT NULL
        AND record."expiresAt" =
          record."completedAt" + INTERVAL '24 hours')
    ) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'Existing IdempotencyRecord state is invalid for Slice 4 integrity.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH ordered_events AS (
      SELECT
        event."previousStatus",
        event."previousCorrectStreak",
        event."previousWrongCount",
        event."occurredAt",
        ROW_NUMBER() OVER event_order AS event_number,
        LAG(event."nextStatus") OVER event_order AS prior_status,
        LAG(event."nextCorrectStreak") OVER event_order AS prior_streak,
        LAG(event."wrongCountAfter") OVER event_order AS prior_wrong_count,
        LAG(event."occurredAt") OVER event_order AS prior_occurred_at
      FROM "ReviewEvent" AS event
      WINDOW event_order AS (
        PARTITION BY event."wrongNoteId"
        ORDER BY event."occurredAt", event."id"
      )
    )
    SELECT 1
    FROM ordered_events
    WHERE (
      event_number = 1
      AND (
        "previousStatus" IS NOT NULL
        OR "previousCorrectStreak" IS NOT NULL
        OR "previousWrongCount" IS NOT NULL
      )
    ) OR (
      event_number > 1
      AND (
        "previousStatus" IS DISTINCT FROM prior_status
        OR "previousCorrectStreak" IS DISTINCT FROM prior_streak
        OR "previousWrongCount" IS DISTINCT FROM prior_wrong_count
        OR "occurredAt" <= prior_occurred_at
      )
    )
  ) THEN
    RAISE EXCEPTION 'Existing ReviewEvent history is not a monotonic exact chain.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "WrongNote" AS note
    LEFT JOIN LATERAL (
      SELECT
        event."id",
        event."source",
        event."nextStatus",
        event."nextCorrectStreak",
        event."wrongCountAfter",
        event."occurredAt"
      FROM "ReviewEvent" AS event
      WHERE event."wrongNoteId" = note."id"
      ORDER BY event."occurredAt" DESC, event."id" DESC
      LIMIT 1
    ) AS latest_event ON TRUE
    LEFT JOIN "ReviewSchedule" AS schedule
      ON schedule."wrongNoteId" = note."id"
    WHERE latest_event."id" IS NULL
      OR schedule."id" IS NULL
      OR note."status" IS DISTINCT FROM latest_event."nextStatus"
      OR note."correctStreak" <> latest_event."nextCorrectStreak"
      OR note."wrongCount" <> latest_event."wrongCountAfter"
      OR (
        latest_event."source" <> 'VERSION_REBASE'
        AND (
          note."updatedAt" <> latest_event."occurredAt"
          OR schedule."updatedAt" <> latest_event."occurredAt"
        )
      )
  ) THEN
    RAISE EXCEPTION 'Existing WrongNote does not match its latest ReviewEvent.'
      USING ERRCODE = '23514';
  END IF;
END;
$block$;

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
      AND "responseStatus" = 201
      AND "responseBody" IS NOT NULL
      AND JSONB_TYPEOF("responseBody") = 'object'
      AND "completedAt" IS NOT NULL
      AND "completedAt" >= "createdAt"
      AND "expiresAt" IS NOT NULL
      AND "expiresAt" = "completedAt" + INTERVAL '24 hours')
  );

CREATE OR REPLACE FUNCTION "validate_idempotency_record_committed_state"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  target_record_id UUID;
  current_state "IdempotencyState";
  current_session_id UUID;
  current_request_hash VARCHAR(64);
  current_response_status INTEGER;
  current_response_body JSONB;
  current_response_session_id TEXT;
  current_created_at TIMESTAMPTZ(3);
  current_completed_at TIMESTAMPTZ(3);
  current_expires_at TIMESTAMPTZ(3);
  parent_status "StudySessionStatus";
  parent_submission_hash VARCHAR(64);
BEGIN
  target_record_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD."id"
    ELSE NEW."id"
  END;

  SELECT
    record."state",
    record."studySessionId",
    record."requestHash",
    record."responseStatus",
    record."responseBody",
    record."responseBody" ->> 'sessionId',
    record."createdAt",
    record."completedAt",
    record."expiresAt"
  INTO
    current_state,
    current_session_id,
    current_request_hash,
    current_response_status,
    current_response_body,
    current_response_session_id,
    current_created_at,
    current_completed_at,
    current_expires_at
  FROM "IdempotencyRecord" AS record
  WHERE record."id" = target_record_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT session."status", session."submissionHash"
  INTO parent_status, parent_submission_hash
  FROM "StudySession" AS session
  WHERE session."id" = current_session_id;

  IF NOT FOUND
    OR current_state <> 'SUCCEEDED'
    OR current_response_status IS DISTINCT FROM 201
    OR current_response_body IS NULL
    OR JSONB_TYPEOF(current_response_body) IS DISTINCT FROM 'object'
    OR current_completed_at IS NULL
    OR current_completed_at < current_created_at
    OR current_expires_at IS NULL
    OR current_expires_at IS DISTINCT FROM
      current_completed_at + INTERVAL '24 hours'
    OR parent_status <> 'SUBMITTED'
    OR current_request_hash IS DISTINCT FROM parent_submission_hash
    OR current_response_session_id IS DISTINCT FROM current_session_id::TEXT THEN
    RAISE EXCEPTION 'Committed idempotency state does not match its submitted session.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION "validate_wrong_note_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM "User" WHERE "id" = OLD."userId";
    IF FOUND THEN
      RAISE EXCEPTION 'WrongNote can only be deleted with its user aggregate.'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."questionId" IS DISTINCT FROM OLD."questionId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'WrongNote identity is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."updatedAt" < OLD."updatedAt" THEN
    RAISE EXCEPTION 'WrongNote updatedAt must be monotonic.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
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
      RAISE EXCEPTION 'ReviewEvent must extend the latest event snapshot monotonically.'
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
    session."status"
  INTO
    evidence_selected_option_id,
    evidence_is_correct,
    evidence_question_id,
    evidence_session_id,
    evidence_user_id,
    evidence_mode,
    evidence_status
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
      AND evidence_mode <> 'WRONG_NOTE')
    OR (NEW."source" = 'STUDY_SUBMIT'
      AND evidence_mode = 'WRONG_NOTE') THEN
    RAISE EXCEPTION 'ReviewEvent evidence does not match its StudyAnswer owner.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION "validate_wrong_note_snapshot"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  target_wrong_note_id UUID;
  note_status "WrongNoteStatus";
  note_wrong_count INTEGER;
  note_correct_streak INTEGER;
  note_last_wrong_version_id UUID;
  note_last_wrong_at TIMESTAMPTZ(3);
  note_last_reviewed_at TIMESTAMPTZ(3);
  note_updated_at TIMESTAMPTZ(3);
  event_source "ReviewEventSource";
  event_question_version_id UUID;
  event_is_correct BOOLEAN;
  event_previous_status "WrongNoteStatus";
  event_next_status "WrongNoteStatus";
  event_next_correct_streak INTEGER;
  event_wrong_count_after INTEGER;
  event_algorithm_version INTEGER;
  event_occurred_at TIMESTAMPTZ(3);
  schedule_interval_days INTEGER;
  schedule_algorithm_version INTEGER;
  schedule_next_review_at TIMESTAMPTZ(3);
  schedule_updated_at TIMESTAMPTZ(3);
  expected_interval_days INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'WrongNote' THEN
    target_wrong_note_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD."id"
      ELSE NEW."id"
    END;
  ELSE
    target_wrong_note_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD."wrongNoteId"
      ELSE NEW."wrongNoteId"
    END;
  END IF;

  SELECT
    note."status",
    note."wrongCount",
    note."correctStreak",
    note."lastWrongQuestionVersionId",
    note."lastWrongAt",
    note."lastReviewedAt",
    note."updatedAt"
  INTO
    note_status,
    note_wrong_count,
    note_correct_streak,
    note_last_wrong_version_id,
    note_last_wrong_at,
    note_last_reviewed_at,
    note_updated_at
  FROM "WrongNote" AS note
  WHERE note."id" = target_wrong_note_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    event."source",
    event."questionVersionId",
    event."isCorrect",
    event."previousStatus",
    event."nextStatus",
    event."nextCorrectStreak",
    event."wrongCountAfter",
    event."algorithmVersion",
    event."occurredAt"
  INTO
    event_source,
    event_question_version_id,
    event_is_correct,
    event_previous_status,
    event_next_status,
    event_next_correct_streak,
    event_wrong_count_after,
    event_algorithm_version,
    event_occurred_at
  FROM "ReviewEvent" AS event
  WHERE event."wrongNoteId" = target_wrong_note_id
  ORDER BY event."occurredAt" DESC, event."id" DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WrongNote materialized state requires latest ReviewEvent evidence.'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    schedule."intervalDays",
    schedule."algorithmVersion",
    schedule."nextReviewAt",
    schedule."updatedAt"
  INTO
    schedule_interval_days,
    schedule_algorithm_version,
    schedule_next_review_at,
    schedule_updated_at
  FROM "ReviewSchedule" AS schedule
  WHERE schedule."wrongNoteId" = target_wrong_note_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WrongNote requires exactly one ReviewSchedule.'
      USING ERRCODE = '23514';
  END IF;

  IF note_status IS DISTINCT FROM event_next_status
    OR note_correct_streak <> event_next_correct_streak
    OR note_wrong_count <> event_wrong_count_after
    OR event_algorithm_version <> 1 THEN
    RAISE EXCEPTION 'WrongNote must match its latest ReviewEvent snapshot.'
      USING ERRCODE = '23514';
  END IF;

  IF event_source = 'VERSION_REBASE' THEN
    RETURN NULL;
  END IF;

  expected_interval_days := CASE
    WHEN NOT event_is_correct THEN 1
    WHEN event_next_correct_streak = 1 THEN 3
    WHEN event_next_correct_streak = 2 THEN 7
    WHEN event_next_correct_streak = 3 THEN 14
    ELSE 30
  END;

  IF schedule_algorithm_version <> event_algorithm_version
    OR schedule_interval_days <> expected_interval_days
    OR schedule_next_review_at <>
      event_occurred_at + expected_interval_days * INTERVAL '24 hours'
    OR note_updated_at <> event_occurred_at
    OR schedule_updated_at <> event_occurred_at
    OR (NOT event_is_correct
      AND note_last_wrong_version_id <> event_question_version_id)
    OR (event_is_correct
      AND note_last_reviewed_at <> event_occurred_at)
    OR (NOT event_is_correct
      AND event_previous_status IS NULL
      AND note_last_reviewed_at IS NOT NULL)
    OR (NOT event_is_correct
      AND event_previous_status IS NOT NULL
      AND note_last_reviewed_at <> event_occurred_at) THEN
    RAISE EXCEPTION 'WrongNote, ReviewSchedule, and latest ReviewEvent diverged.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$function$;

COMMIT;
