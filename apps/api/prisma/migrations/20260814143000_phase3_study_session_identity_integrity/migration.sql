-- Phase 3 Slice 3: fail closed on legacy selection/filter mismatches and make
-- the StudySession identity immutable so deferred selection validation cannot
-- be bypassed by changing the parent primary key inside its creation tx.

BEGIN;

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "StudySessionQuestion" AS item
    JOIN "StudySession" AS session
      ON session."id" = item."studySessionId"
    JOIN "QuestionVersion" AS version
      ON version."id" = item."questionVersionId"
      AND version."questionId" = item."questionId"
    WHERE version."level" IS DISTINCT FROM session."level"
      OR version."subject" IS DISTINCT FROM session."subject"
  ) THEN
    RAISE EXCEPTION 'Existing StudySession selection does not match its filters.'
      USING ERRCODE = '23514';
  END IF;
END;
$block$;

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

COMMIT;
