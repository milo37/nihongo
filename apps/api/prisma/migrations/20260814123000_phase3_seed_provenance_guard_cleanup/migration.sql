-- The guard only protects the non-transactional legacy backfill window.
-- Restore one canonical validation trigger after provenance is contracted.

BEGIN;

ALTER TABLE "QuestionVersion"
  ENABLE TRIGGER "QuestionVersion_validate_change";

DROP TRIGGER IF EXISTS "QuestionVersion_validate_backfill_guard"
  ON "QuestionVersion";

DROP FUNCTION IF EXISTS "validate_question_version_backfill_guard"();

DO $function$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM pg_trigger
    WHERE tgrelid = '"QuestionVersion"'::regclass
      AND tgname = 'QuestionVersion_validate_change'
      AND tgenabled = 'O'
      AND NOT tgisinternal
  ) <> 1 THEN
    RAISE EXCEPTION 'Canonical QuestionVersion validation trigger is not enabled.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = '"QuestionVersion"'::regclass
      AND tgname = 'QuestionVersion_validate_backfill_guard'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Temporary QuestionVersion backfill guard still exists.'
      USING ERRCODE = '23514';
  END IF;
END;
$function$;

COMMIT;
