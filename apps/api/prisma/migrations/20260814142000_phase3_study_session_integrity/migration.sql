-- Phase 3 Slice 3: strengthen immutable session metadata and make the pinned
-- selection agree with the session's level and subject.

BEGIN;

ALTER TABLE "StudySession"
  ADD CONSTRAINT "StudySession_random_no_fallback_check" CHECK (
    "mode" <> 'RANDOM'
    OR (NOT "usedFallback" AND "fallbackReason" IS NULL)
  ),
  ADD CONSTRAINT "StudySession_state_timestamp_order_check" CHECK (
    ("submittedAt" IS NULL OR "submittedAt" >= "startedAt")
    AND ("cancelledAt" IS NULL OR "cancelledAt" >= "startedAt")
  );

CREATE FUNCTION "protect_study_session_created_at"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'StudySession createdAt is immutable.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "StudySession_protect_created_at"
BEFORE UPDATE OF "createdAt" ON "StudySession"
FOR EACH ROW EXECUTE FUNCTION "protect_study_session_created_at"();

CREATE OR REPLACE FUNCTION "validate_study_session_selection_complete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  selected_count INTEGER;
  minimum_ordinal INTEGER;
  maximum_ordinal INTEGER;
  mismatched_count INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "StudySession" WHERE "id" = NEW."id") THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*), MIN(item."ordinal"), MAX(item."ordinal")
  INTO selected_count, minimum_ordinal, maximum_ordinal
  FROM "StudySessionQuestion" AS item
  WHERE item."studySessionId" = NEW."id";

  SELECT COUNT(*)
  INTO mismatched_count
  FROM "StudySessionQuestion" AS item
  JOIN "QuestionVersion" AS version
    ON version."id" = item."questionVersionId"
    AND version."questionId" = item."questionId"
  WHERE item."studySessionId" = NEW."id"
    AND (
      version."level" IS DISTINCT FROM NEW."level"
      OR version."subject" IS DISTINCT FROM NEW."subject"
    );

  IF selected_count <> NEW."actualCount"
    OR minimum_ordinal <> 1
    OR maximum_ordinal <> NEW."actualCount"
    OR mismatched_count <> 0 THEN
    RAISE EXCEPTION 'StudySession selection must be complete and match its filters.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

COMMIT;
