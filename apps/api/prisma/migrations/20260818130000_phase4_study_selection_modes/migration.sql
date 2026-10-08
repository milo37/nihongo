-- Phase 4 Slice 3: owner-scoped selection indexes, monotonic review pointers,
-- mode-aware ReviewEvent evidence, and all-mode dashboard reads.
-- Existing migrations remain immutable. Populated production indexes require
-- the reviewed maintenance/concurrent-index rollout before mode exposure.

BEGIN;

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "WrongNote"
    WHERE "currentReviewQuestionVersionId" IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Slice 3 requires every existing current review pointer to be null.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ReviewEvent" AS event
    JOIN "StudyAnswer" AS answer
      ON answer."id" = event."studyAnswerId"
    JOIN "StudySessionQuestion" AS item
      ON item."id" = answer."studySessionQuestionId"
    JOIN "StudySession" AS session
      ON session."id" = item."studySessionId"
    WHERE (
      event."source" = 'WRONG_NOTE_REVIEW'
      AND session."mode" NOT IN ('WRONG_NOTE', 'DAILY_REVIEW')
    ) OR (
      event."source" = 'STUDY_SUBMIT'
      AND session."mode" NOT IN ('RANDOM', 'WEAKNESS', 'BOOKMARK')
    )
  ) THEN
    RAISE EXCEPTION
      'Slice 3 requires every existing ReviewEvent source to match its mode.'
      USING ERRCODE = '23514';
  END IF;
END;
$block$;

ALTER TABLE "WrongNote"
  DROP CONSTRAINT "WrongNote_slice4_current_review_check";

CREATE OR REPLACE FUNCTION "validate_wrong_note_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  old_pointer_version_number INTEGER;
  new_pointer_version_number INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
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

DROP TRIGGER "WrongNote_validate_change" ON "WrongNote";

CREATE TRIGGER "WrongNote_validate_change"
BEFORE INSERT OR UPDATE OR DELETE ON "WrongNote"
FOR EACH ROW EXECUTE FUNCTION "validate_wrong_note_change"();

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
      AND evidence_mode NOT IN ('WRONG_NOTE', 'DAILY_REVIEW'))
    OR (NEW."source" = 'STUDY_SUBMIT'
      AND evidence_mode NOT IN ('RANDOM', 'WEAKNESS', 'BOOKMARK'))
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

CREATE INDEX "StudySession_userId_level_subject_submittedAt_id_weakness_idx"
  ON "StudySession"(
    "userId",
    "level",
    "subject",
    "submittedAt" DESC,
    "id"
  )
  WHERE "userId" IS NOT NULL
    AND "status" = 'SUBMITTED'
    AND "submittedAt" IS NOT NULL;

CREATE INDEX "StudySession_guest_level_subject_submittedAt_id_weakness_idx"
  ON "StudySession"(
    "guestPrincipalId",
    "level",
    "subject",
    "submittedAt" DESC,
    "id"
  )
  WHERE "guestPrincipalId" IS NOT NULL
    AND "status" = 'SUBMITTED'
    AND "submittedAt" IS NOT NULL;

CREATE INDEX "WrongNote_user_status_lastWrongAt_wrongCount_questionId_idx"
  ON "WrongNote"(
    "userId",
    "status",
    "lastWrongAt" DESC,
    "wrongCount" DESC,
    "questionId"
  );

CREATE INDEX "WrongNote_userId_status_id_questionId_daily_idx"
  ON "WrongNote"("userId", "status", "id", "questionId");

DROP INDEX "StudySession_userId_submittedAt_id_dashboard_idx";

CREATE INDEX "StudySession_userId_submittedAt_id_dashboard_idx"
  ON "StudySession"("userId", "submittedAt" DESC, "id")
  WHERE "userId" IS NOT NULL
    AND "status" = 'SUBMITTED'
    AND "submittedAt" IS NOT NULL;

COMMIT;
