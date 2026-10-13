-- Phase 3 Slice 4 follow-up: bounded guest proof renewal, immutable submitted
-- USER aggregates, and exact ReviewEvent cardinality for existing notes.

BEGIN;

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "GuestPrincipal" AS guest
    WHERE (
      guest."lastSeenAt" >= guest."createdAt"
      AND guest."expiresAt" > guest."lastSeenAt"
      AND guest."expiresAt" <=
        guest."lastSeenAt" + INTERVAL '7 days'
    ) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'Existing GuestPrincipal expiry is invalid for bounded renewal.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "StudySession" AS session
    JOIN "StudySessionQuestion" AS item
      ON item."studySessionId" = session."id"
    JOIN "StudyAnswer" AS answer
      ON answer."studySessionQuestionId" = item."id"
      AND answer."questionVersionId" = item."questionVersionId"
    LEFT JOIN "ReviewEvent" AS event
      ON event."studyAnswerId" = answer."id"
    WHERE session."status" = 'SUBMITTED'
      AND (
        (session."guestPrincipalId" IS NOT NULL AND event."id" IS NOT NULL)
        OR (
          session."userId" IS NOT NULL
          AND (
            (NOT answer."isCorrect" AND event."id" IS NULL)
            OR (
              answer."isCorrect"
              AND event."id" IS NOT NULL
              AND event."previousStatus" IS NULL
            )
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Existing submitted answer has invalid ReviewEvent cardinality.'
      USING ERRCODE = '23514';
  END IF;
END;
$block$;

ALTER TABLE "GuestPrincipal"
  DROP CONSTRAINT "GuestPrincipal_valid_expiry",
  ADD CONSTRAINT "GuestPrincipal_valid_expiry" CHECK (
    "lastSeenAt" >= "createdAt"
    AND "expiresAt" > "lastSeenAt"
    AND "expiresAt" <= "lastSeenAt" + INTERVAL '7 days'
  );

CREATE FUNCTION "validate_guest_principal_renewal_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."tokenDigest" IS DISTINCT FROM OLD."tokenDigest"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'GuestPrincipal identity is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."lastSeenAt" < OLD."lastSeenAt"
    OR NEW."expiresAt" < OLD."expiresAt" THEN
    RAISE EXCEPTION 'GuestPrincipal renewal timestamps must be monotonic.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER "GuestPrincipal_validate_renewal_change"
BEFORE UPDATE ON "GuestPrincipal"
FOR EACH ROW EXECUTE FUNCTION "validate_guest_principal_renewal_change"();

CREATE FUNCTION "protect_submitted_user_study_session_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD."userId" IS NOT NULL AND OLD."status" = 'SUBMITTED' THEN
    PERFORM 1 FROM "User" WHERE "id" = OLD."userId";
    IF FOUND THEN
      RAISE EXCEPTION 'Submitted USER StudySession can only be deleted with its user.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN OLD;
END;
$function$;

CREATE TRIGGER "StudySession_protect_submitted_user_delete"
BEFORE DELETE ON "StudySession"
FOR EACH ROW EXECUTE FUNCTION "protect_submitted_user_study_session_delete"();

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
