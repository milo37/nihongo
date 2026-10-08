-- Phase 3 Slice 4: atomic study submission facts, transaction-local
-- idempotency, and USER wrong-note review evidence. Existing migrations are
-- immutable; every invariant in this file is a forward-only addition.

BEGIN;

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "StudySession"
    WHERE "status" = 'SUBMITTED'
  ) THEN
    RAISE EXCEPTION 'Legacy submitted sessions require reviewed backfill before Slice 4.'
      USING ERRCODE = '23514';
  END IF;
END;
$block$;

CREATE TYPE "WrongNoteStatus" AS ENUM (
  'NEW',
  'REVIEWING',
  'AGAIN',
  'SOLVED'
);
CREATE TYPE "ReviewEventSource" AS ENUM (
  'STUDY_SUBMIT',
  'WRONG_NOTE_REVIEW',
  'VERSION_REBASE'
);
CREATE TYPE "IdempotencyPrincipalType" AS ENUM ('USER', 'GUEST');
CREATE TYPE "IdempotencyOperation" AS ENUM ('STUDY_SUBMIT');
CREATE TYPE "IdempotencyState" AS ENUM ('PROCESSING', 'SUCCEEDED');

CREATE TABLE "StudyAnswer" (
  "id" UUID NOT NULL,
  "studySessionQuestionId" UUID NOT NULL,
  "questionVersionId" UUID NOT NULL,
  "selectedOptionId" UUID,
  "isCorrect" BOOLEAN NOT NULL,
  "elapsedSec" INTEGER NOT NULL,
  "gradingVersion" VARCHAR(64) NOT NULL,
  "answeredAt" TIMESTAMPTZ(3) NOT NULL,
  "gradedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "StudyAnswer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudyAnswer_elapsed_check" CHECK (
    "elapsedSec" BETWEEN 0 AND 86400
  ),
  CONSTRAINT "StudyAnswer_grading_version_check" CHECK (
    "gradingVersion" = 'server-grading-v1'
  ),
  CONSTRAINT "StudyAnswer_time_check" CHECK (
    "gradedAt" >= "answeredAt"
  )
);

CREATE TABLE "StudyResult" (
  "id" UUID NOT NULL,
  "studySessionId" UUID NOT NULL,
  "totalCount" INTEGER NOT NULL,
  "correctCount" INTEGER NOT NULL,
  "incorrectCount" INTEGER NOT NULL,
  "correctRateBasisPoints" INTEGER NOT NULL,
  "durationSec" INTEGER NOT NULL,
  "gradingVersion" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "StudyResult_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudyResult_count_check" CHECK (
    "totalCount" BETWEEN 1 AND 20
    AND "correctCount" BETWEEN 0 AND "totalCount"
    AND "incorrectCount" BETWEEN 0 AND "totalCount"
    AND "correctCount" + "incorrectCount" = "totalCount"
  ),
  CONSTRAINT "StudyResult_rate_check" CHECK (
    "correctRateBasisPoints" BETWEEN 0 AND 10000
    AND "correctRateBasisPoints" =
      ROUND(("correctCount" * 10000.0) / "totalCount")::INTEGER
  ),
  CONSTRAINT "StudyResult_duration_check" CHECK (
    "durationSec" BETWEEN 0 AND 604800
  ),
  CONSTRAINT "StudyResult_grading_version_check" CHECK (
    "gradingVersion" = 'server-grading-v1'
  )
);

CREATE TABLE "WrongNote" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "questionId" UUID NOT NULL,
  "lastWrongQuestionVersionId" UUID NOT NULL,
  "currentReviewQuestionVersionId" UUID,
  "wrongCount" INTEGER NOT NULL,
  "correctStreak" INTEGER NOT NULL,
  "status" "WrongNoteStatus" NOT NULL,
  "lastWrongAt" TIMESTAMPTZ(3) NOT NULL,
  "lastReviewedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "WrongNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WrongNote_state_check" CHECK (
    ("status" = 'NEW'
      AND "wrongCount" = 1
      AND "correctStreak" = 0
      AND "lastReviewedAt" IS NULL)
    OR ("status" = 'AGAIN'
      AND "wrongCount" >= 2
      AND "correctStreak" = 0
      AND "lastReviewedAt" IS NOT NULL)
    OR ("status" = 'REVIEWING'
      AND "wrongCount" >= 1
      AND "correctStreak" = 1
      AND "lastReviewedAt" IS NOT NULL)
    OR ("status" = 'SOLVED'
      AND "wrongCount" >= 1
      AND "correctStreak" >= 2
      AND "lastReviewedAt" IS NOT NULL)
  ),
  CONSTRAINT "WrongNote_time_check" CHECK (
    "lastReviewedAt" IS NULL OR "lastReviewedAt" >= "lastWrongAt"
  )
);

CREATE TABLE "ReviewSchedule" (
  "id" UUID NOT NULL,
  "wrongNoteId" UUID NOT NULL,
  "nextReviewAt" TIMESTAMPTZ(3) NOT NULL,
  "intervalDays" INTEGER NOT NULL,
  "algorithmVersion" INTEGER NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ReviewSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReviewSchedule_algorithm_check" CHECK (
    "algorithmVersion" = 1
    AND "intervalDays" IN (1, 3, 7, 14, 30)
  )
);

CREATE TABLE "ReviewEvent" (
  "id" UUID NOT NULL,
  "wrongNoteId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "questionId" UUID NOT NULL,
  "questionVersionId" UUID NOT NULL,
  "source" "ReviewEventSource" NOT NULL,
  "studySessionId" UUID,
  "studyAnswerId" UUID,
  "selectedOptionId" UUID,
  "isCorrect" BOOLEAN,
  "previousStatus" "WrongNoteStatus",
  "nextStatus" "WrongNoteStatus" NOT NULL,
  "previousCorrectStreak" INTEGER,
  "nextCorrectStreak" INTEGER NOT NULL,
  "previousWrongCount" INTEGER,
  "wrongCountAfter" INTEGER NOT NULL,
  "algorithmVersion" INTEGER NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReviewEvent_previous_snapshot_check" CHECK (
    ("previousStatus" IS NULL
      AND "previousCorrectStreak" IS NULL
      AND "previousWrongCount" IS NULL)
    OR ("previousStatus" IS NOT NULL
      AND "previousCorrectStreak" IS NOT NULL
      AND "previousWrongCount" IS NOT NULL
      AND "previousCorrectStreak" >= 0
      AND "previousWrongCount" >= 1)
  ),
  CONSTRAINT "ReviewEvent_previous_state_check" CHECK (
    "previousStatus" IS NULL
    OR ("previousStatus" = 'NEW'
      AND "previousCorrectStreak" = 0
      AND "previousWrongCount" = 1)
    OR ("previousStatus" = 'AGAIN'
      AND "previousCorrectStreak" = 0
      AND "previousWrongCount" >= 2)
    OR ("previousStatus" = 'REVIEWING'
      AND "previousCorrectStreak" = 1)
    OR ("previousStatus" = 'SOLVED'
      AND "previousCorrectStreak" >= 2)
  ),
  CONSTRAINT "ReviewEvent_evidence_shape_check" CHECK (
    ("source" IN ('STUDY_SUBMIT', 'WRONG_NOTE_REVIEW')
      AND "studySessionId" IS NOT NULL
      AND "studyAnswerId" IS NOT NULL
      AND "isCorrect" IS NOT NULL)
    OR ("source" = 'VERSION_REBASE'
      AND "studySessionId" IS NULL
      AND "studyAnswerId" IS NULL
      AND "selectedOptionId" IS NULL
      AND "isCorrect" IS NULL)
  ),
  CONSTRAINT "ReviewEvent_transition_check" CHECK (
    ("source" = 'VERSION_REBASE'
      AND "previousStatus" IS NOT NULL
      AND "nextStatus" = "previousStatus"
      AND "nextCorrectStreak" = "previousCorrectStreak"
      AND "wrongCountAfter" = "previousWrongCount")
    OR ("source" <> 'VERSION_REBASE'
      AND "previousStatus" IS NULL
      AND NOT "isCorrect"
      AND "nextStatus" = 'NEW'
      AND "nextCorrectStreak" = 0
      AND "wrongCountAfter" = 1)
    OR ("source" <> 'VERSION_REBASE'
      AND "previousStatus" IS NOT NULL
      AND NOT "isCorrect"
      AND "nextStatus" = 'AGAIN'
      AND "nextCorrectStreak" = 0
      AND "wrongCountAfter" = "previousWrongCount" + 1)
    OR ("source" <> 'VERSION_REBASE'
      AND "previousStatus" IS NOT NULL
      AND "isCorrect"
      AND "nextCorrectStreak" = "previousCorrectStreak" + 1
      AND "wrongCountAfter" = "previousWrongCount"
      AND (
        ("nextCorrectStreak" = 1 AND "nextStatus" = 'REVIEWING')
        OR ("nextCorrectStreak" >= 2 AND "nextStatus" = 'SOLVED')
      ))
  ),
  CONSTRAINT "ReviewEvent_algorithm_check" CHECK (
    "algorithmVersion" = 1
  ),
  CONSTRAINT "ReviewEvent_correct_selection_check" CHECK (
    NOT COALESCE("isCorrect", false) OR "selectedOptionId" IS NOT NULL
  )
);

CREATE TABLE "IdempotencyRecord" (
  "id" UUID NOT NULL,
  "principalType" "IdempotencyPrincipalType" NOT NULL,
  "userId" UUID,
  "guestPrincipalId" UUID,
  "operation" "IdempotencyOperation" NOT NULL,
  "idempotencyKey" UUID NOT NULL,
  "studySessionId" UUID NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "state" "IdempotencyState" NOT NULL DEFAULT 'PROCESSING',
  "responseStatus" INTEGER,
  "responseBody" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3),
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IdempotencyRecord_principal_check" CHECK (
    ("principalType" = 'USER'
      AND "userId" IS NOT NULL
      AND "guestPrincipalId" IS NULL)
    OR ("principalType" = 'GUEST'
      AND "userId" IS NULL
      AND "guestPrincipalId" IS NOT NULL)
  ),
  CONSTRAINT "IdempotencyRecord_hash_check" CHECK (
    "requestHash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "IdempotencyRecord_state_check" CHECK (
    ("state" = 'PROCESSING'
      AND "responseStatus" IS NULL
      AND "responseBody" IS NULL
      AND "completedAt" IS NULL
      AND "expiresAt" IS NULL)
    OR ("state" = 'SUCCEEDED'
      AND "responseStatus" = 201
      AND JSONB_TYPEOF("responseBody") = 'object'
      AND "completedAt" IS NOT NULL
      AND "completedAt" >= "createdAt"
      AND "expiresAt" IS NOT NULL
      AND "expiresAt" = "completedAt" + INTERVAL '24 hours')
  )
);

CREATE UNIQUE INDEX "StudySession_id_userId_key"
  ON "StudySession"("id", "userId");
CREATE UNIQUE INDEX "StudySession_id_guestPrincipalId_key"
  ON "StudySession"("id", "guestPrincipalId");
CREATE INDEX "StudySession_guestPrincipalId_status_submittedAt_idx"
  ON "StudySession"("guestPrincipalId", "status", "submittedAt");

CREATE UNIQUE INDEX "StudyAnswer_studySessionQuestionId_key"
  ON "StudyAnswer"("studySessionQuestionId");
CREATE UNIQUE INDEX "StudyAnswer_studySessionQuestionId_questionVersionId_key"
  ON "StudyAnswer"("studySessionQuestionId", "questionVersionId");
CREATE UNIQUE INDEX "StudyAnswer_id_questionVersionId_key"
  ON "StudyAnswer"("id", "questionVersionId");
CREATE INDEX "StudyAnswer_questionVersionId_selectedOptionId_idx"
  ON "StudyAnswer"("questionVersionId", "selectedOptionId");
CREATE UNIQUE INDEX "StudyResult_studySessionId_key"
  ON "StudyResult"("studySessionId");

CREATE UNIQUE INDEX "WrongNote_userId_questionId_key"
  ON "WrongNote"("userId", "questionId");
CREATE UNIQUE INDEX "WrongNote_id_userId_questionId_key"
  ON "WrongNote"("id", "userId", "questionId");
CREATE INDEX "WrongNote_userId_status_lastWrongAt_idx"
  ON "WrongNote"("userId", "status", "lastWrongAt" DESC);
CREATE INDEX "WrongNote_userId_lastWrongAt_idx"
  ON "WrongNote"("userId", "lastWrongAt" DESC);
CREATE INDEX "WrongNote_questionId_lastWrongQuestionVersionId_idx"
  ON "WrongNote"("questionId", "lastWrongQuestionVersionId");
CREATE INDEX "WrongNote_questionId_currentReviewQuestionVersionId_idx"
  ON "WrongNote"("questionId", "currentReviewQuestionVersionId");

CREATE UNIQUE INDEX "ReviewSchedule_wrongNoteId_key"
  ON "ReviewSchedule"("wrongNoteId");
CREATE INDEX "ReviewSchedule_nextReviewAt_wrongNoteId_idx"
  ON "ReviewSchedule"("nextReviewAt", "wrongNoteId");

CREATE UNIQUE INDEX "ReviewEvent_studyAnswerId_key"
  ON "ReviewEvent"("studyAnswerId");
CREATE UNIQUE INDEX "ReviewEvent_studyAnswerId_questionVersionId_key"
  ON "ReviewEvent"("studyAnswerId", "questionVersionId");
CREATE INDEX "ReviewEvent_wrongNoteId_occurredAt_idx"
  ON "ReviewEvent"("wrongNoteId", "occurredAt" DESC);
CREATE INDEX "ReviewEvent_questionId_questionVersionId_idx"
  ON "ReviewEvent"("questionId", "questionVersionId");
CREATE INDEX "ReviewEvent_studySessionId_idx"
  ON "ReviewEvent"("studySessionId");
CREATE INDEX "ReviewEvent_questionVersionId_selectedOptionId_idx"
  ON "ReviewEvent"("questionVersionId", "selectedOptionId");

CREATE UNIQUE INDEX "IdempotencyRecord_user_scope_key"
  ON "IdempotencyRecord"("userId", "operation", "idempotencyKey")
  WHERE "userId" IS NOT NULL;
CREATE UNIQUE INDEX "IdempotencyRecord_guest_scope_key"
  ON "IdempotencyRecord"(
    "guestPrincipalId",
    "operation",
    "idempotencyKey"
  ) WHERE "guestPrincipalId" IS NOT NULL;
CREATE INDEX "IdempotencyRecord_expiresAt_idx"
  ON "IdempotencyRecord"("expiresAt");
CREATE INDEX "IdempotencyRecord_studySessionId_requestHash_idx"
  ON "IdempotencyRecord"("studySessionId", "requestHash");
CREATE UNIQUE INDEX "IdempotencyRecord_studySessionId_succeeded_key"
  ON "IdempotencyRecord"("studySessionId")
  WHERE "state" = 'SUCCEEDED';

ALTER TABLE "StudyAnswer"
  ADD CONSTRAINT "StudyAnswer_studySessionQuestionId_questionVersionId_fkey"
  FOREIGN KEY ("studySessionQuestionId", "questionVersionId")
  REFERENCES "StudySessionQuestion"("id", "questionVersionId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyAnswer"
  ADD CONSTRAINT "StudyAnswer_questionVersionId_selectedOptionId_fkey"
  FOREIGN KEY ("questionVersionId", "selectedOptionId")
  REFERENCES "QuestionOption"("questionVersionId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudyResult"
  ADD CONSTRAINT "StudyResult_studySessionId_fkey"
  FOREIGN KEY ("studySessionId") REFERENCES "StudySession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WrongNote"
  ADD CONSTRAINT "WrongNote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WrongNote"
  ADD CONSTRAINT "WrongNote_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "Question"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WrongNote"
  ADD CONSTRAINT "WrongNote_questionId_lastWrongQuestionVersionId_fkey"
  FOREIGN KEY ("questionId", "lastWrongQuestionVersionId")
  REFERENCES "QuestionVersion"("questionId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WrongNote"
  ADD CONSTRAINT "WrongNote_questionId_currentReviewQuestionVersionId_fkey"
  FOREIGN KEY ("questionId", "currentReviewQuestionVersionId")
  REFERENCES "QuestionVersion"("questionId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReviewSchedule"
  ADD CONSTRAINT "ReviewSchedule_wrongNoteId_fkey"
  FOREIGN KEY ("wrongNoteId") REFERENCES "WrongNote"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReviewEvent"
  ADD CONSTRAINT "ReviewEvent_wrongNoteId_userId_questionId_fkey"
  FOREIGN KEY ("wrongNoteId", "userId", "questionId")
  REFERENCES "WrongNote"("id", "userId", "questionId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewEvent"
  ADD CONSTRAINT "ReviewEvent_questionId_questionVersionId_fkey"
  FOREIGN KEY ("questionId", "questionVersionId")
  REFERENCES "QuestionVersion"("questionId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewEvent"
  ADD CONSTRAINT "ReviewEvent_studySessionId_fkey"
  FOREIGN KEY ("studySessionId") REFERENCES "StudySession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewEvent"
  ADD CONSTRAINT "ReviewEvent_studyAnswerId_questionVersionId_fkey"
  FOREIGN KEY ("studyAnswerId", "questionVersionId")
  REFERENCES "StudyAnswer"("id", "questionVersionId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewEvent"
  ADD CONSTRAINT "ReviewEvent_questionVersionId_selectedOptionId_fkey"
  FOREIGN KEY ("questionVersionId", "selectedOptionId")
  REFERENCES "QuestionOption"("questionVersionId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IdempotencyRecord"
  ADD CONSTRAINT "IdempotencyRecord_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdempotencyRecord"
  ADD CONSTRAINT "IdempotencyRecord_guestPrincipalId_fkey"
  FOREIGN KEY ("guestPrincipalId") REFERENCES "GuestPrincipal"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdempotencyRecord"
  ADD CONSTRAINT "IdempotencyRecord_studySessionId_fkey"
  FOREIGN KEY ("studySessionId") REFERENCES "StudySession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "IdempotencyRecord"
  ADD CONSTRAINT "IdempotencyRecord_studySessionId_userId_fkey"
  FOREIGN KEY ("studySessionId", "userId")
  REFERENCES "StudySession"("id", "userId")
  ON DELETE CASCADE ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "IdempotencyRecord"
  ADD CONSTRAINT "IdempotencyRecord_studySessionId_guestPrincipalId_fkey"
  FOREIGN KEY ("studySessionId", "guestPrincipalId")
  REFERENCES "StudySession"("id", "guestPrincipalId")
  ON DELETE CASCADE ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION "validate_study_answer_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  parent_status "StudySessionStatus";
  correct_option_id UUID;
  expected_correct BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'StudyAnswer is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM 1
    FROM "StudySessionQuestion" AS item
    JOIN "StudySession" AS session
      ON session."id" = item."studySessionId"
    WHERE item."id" = OLD."studySessionQuestionId";

    IF FOUND THEN
      RAISE EXCEPTION 'StudyAnswer can only be deleted with its aggregate.'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  SELECT session."status", version."correctOptionId"
  INTO parent_status, correct_option_id
  FROM "StudySessionQuestion" AS item
  JOIN "StudySession" AS session
    ON session."id" = item."studySessionId"
  JOIN "QuestionVersion" AS version
    ON version."id" = item."questionVersionId"
    AND version."questionId" = item."questionId"
  WHERE item."id" = NEW."studySessionQuestionId"
    AND item."questionVersionId" = NEW."questionVersionId";

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF parent_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'StudyAnswer can only be inserted while its session is in progress.'
      USING ERRCODE = '23514';
  END IF;

  expected_correct := NEW."selectedOptionId" IS NOT NULL
    AND NEW."selectedOptionId" = correct_option_id;
  IF NEW."isCorrect" IS DISTINCT FROM expected_correct THEN
    RAISE EXCEPTION 'StudyAnswer outcome must match the pinned correct option.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER "StudyAnswer_validate_change"
BEFORE INSERT OR UPDATE OR DELETE ON "StudyAnswer"
FOR EACH ROW EXECUTE FUNCTION "validate_study_answer_change"();

CREATE FUNCTION "validate_study_result_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  parent_status "StudySessionStatus";
  parent_actual_count INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'StudyResult is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM 1
    FROM "StudySession"
    WHERE "id" = OLD."studySessionId";

    IF FOUND THEN
      RAISE EXCEPTION 'StudyResult can only be deleted with its aggregate.'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  SELECT "status", "actualCount"
  INTO parent_status, parent_actual_count
  FROM "StudySession"
  WHERE "id" = NEW."studySessionId";

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF parent_status <> 'IN_PROGRESS'
    OR NEW."totalCount" <> parent_actual_count THEN
    RAISE EXCEPTION 'StudyResult does not match an in-progress session.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER "StudyResult_validate_change"
BEFORE INSERT OR UPDATE OR DELETE ON "StudyResult"
FOR EACH ROW EXECUTE FUNCTION "validate_study_result_change"();

CREATE FUNCTION "validate_study_submission_snapshot"()
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
    IF TG_OP = 'DELETE' THEN
      target_session_id := OLD."id";
    ELSE
      target_session_id := NEW."id";
    END IF;
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
  WHERE item."studySessionId" = target_session_id
    AND (
      (session_guest_id IS NOT NULL AND event."id" IS NOT NULL)
      OR (session_user_id IS NOT NULL
        AND NOT answer."isCorrect"
        AND event."id" IS NULL)
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

CREATE CONSTRAINT TRIGGER "StudySession_validate_submission_snapshot"
AFTER INSERT OR UPDATE ON "StudySession"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_study_submission_snapshot"();

CREATE CONSTRAINT TRIGGER "StudyAnswer_validate_submission_snapshot"
AFTER INSERT OR DELETE ON "StudyAnswer"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_study_submission_snapshot"();

CREATE CONSTRAINT TRIGGER "StudyResult_validate_submission_snapshot"
AFTER INSERT OR DELETE ON "StudyResult"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_study_submission_snapshot"();

CREATE CONSTRAINT TRIGGER "ReviewEvent_validate_submission_snapshot"
AFTER INSERT OR DELETE ON "ReviewEvent"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_study_submission_snapshot"();

CREATE FUNCTION "validate_wrong_note_change"()
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

  IF TG_OP = 'UPDATE' AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."questionId" IS DISTINCT FROM OLD."questionId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'WrongNote identity is immutable.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER "WrongNote_validate_change"
BEFORE UPDATE OR DELETE ON "WrongNote"
FOR EACH ROW EXECUTE FUNCTION "validate_wrong_note_change"();

CREATE FUNCTION "validate_review_schedule_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM "WrongNote" WHERE "id" = OLD."wrongNoteId";
    IF FOUND THEN
      RAISE EXCEPTION 'ReviewSchedule can only be deleted with its WrongNote.'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."wrongNoteId" IS DISTINCT FROM OLD."wrongNoteId"
  ) THEN
    RAISE EXCEPTION 'ReviewSchedule identity is immutable.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER "ReviewSchedule_validate_change"
BEFORE UPDATE OR DELETE ON "ReviewSchedule"
FOR EACH ROW EXECUTE FUNCTION "validate_review_schedule_change"();

CREATE FUNCTION "validate_review_event_change"()
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

CREATE TRIGGER "ReviewEvent_validate_change"
BEFORE INSERT OR UPDATE OR DELETE ON "ReviewEvent"
FOR EACH ROW EXECUTE FUNCTION "validate_review_event_change"();

CREATE FUNCTION "validate_wrong_note_snapshot"()
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
    note."lastReviewedAt"
  INTO
    note_status,
    note_wrong_count,
    note_correct_streak,
    note_last_wrong_version_id,
    note_last_wrong_at,
    note_last_reviewed_at
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
    AND event."nextStatus" = note_status
    AND event."nextCorrectStreak" = note_correct_streak
    AND event."wrongCountAfter" = note_wrong_count
    AND (
      (event."isCorrect" AND event."occurredAt" = note_last_reviewed_at)
      OR (NOT event."isCorrect" AND event."occurredAt" = note_last_wrong_at)
      OR event."source" = 'VERSION_REBASE'
    )
  ORDER BY event."occurredAt" DESC, event."id" DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WrongNote materialized state requires matching ReviewEvent evidence.'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    schedule."intervalDays",
    schedule."algorithmVersion",
    schedule."nextReviewAt"
  INTO
    schedule_interval_days,
    schedule_algorithm_version,
    schedule_next_review_at
  FROM "ReviewSchedule" AS schedule
  WHERE schedule."wrongNoteId" = target_wrong_note_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WrongNote requires exactly one ReviewSchedule.'
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

  IF note_status IS DISTINCT FROM event_next_status
    OR note_correct_streak <> event_next_correct_streak
    OR note_wrong_count <> event_wrong_count_after
    OR event_algorithm_version <> 1
    OR schedule_algorithm_version <> event_algorithm_version
    OR schedule_interval_days <> expected_interval_days
    OR schedule_next_review_at <>
      event_occurred_at + expected_interval_days * INTERVAL '24 hours'
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
    RAISE EXCEPTION 'WrongNote, ReviewSchedule, and ReviewEvent snapshots diverged.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER "WrongNote_validate_snapshot"
AFTER INSERT OR UPDATE ON "WrongNote"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_wrong_note_snapshot"();

CREATE CONSTRAINT TRIGGER "ReviewSchedule_validate_snapshot"
AFTER INSERT OR UPDATE ON "ReviewSchedule"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_wrong_note_snapshot"();

CREATE CONSTRAINT TRIGGER "ReviewEvent_validate_wrong_note_snapshot"
AFTER INSERT ON "ReviewEvent"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_wrong_note_snapshot"();

CREATE FUNCTION "validate_idempotency_record_change"()
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
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR OLD."state" <> 'PROCESSING'
    OR NEW."state" <> 'SUCCEEDED' THEN
    RAISE EXCEPTION 'IdempotencyRecord only allows PROCESSING to SUCCEEDED.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER "IdempotencyRecord_validate_change"
BEFORE INSERT OR UPDATE OR DELETE ON "IdempotencyRecord"
FOR EACH ROW EXECUTE FUNCTION "validate_idempotency_record_change"();

CREATE FUNCTION "validate_idempotency_record_committed_state"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  target_record_id UUID;
  current_state "IdempotencyState";
  current_session_id UUID;
  current_request_hash VARCHAR(64);
  current_response_session_id TEXT;
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
    record."responseBody" ->> 'sessionId'
  INTO
    current_state,
    current_session_id,
    current_request_hash,
    current_response_session_id
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
    OR parent_status <> 'SUBMITTED'
    OR current_request_hash IS DISTINCT FROM parent_submission_hash
    OR current_response_session_id IS DISTINCT FROM current_session_id::TEXT THEN
    RAISE EXCEPTION 'Committed idempotency state does not match its submitted session.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER "IdempotencyRecord_validate_committed_state"
AFTER INSERT OR UPDATE ON "IdempotencyRecord"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_idempotency_record_committed_state"();

COMMIT;
