-- Finish the expand/backfill/contract sequence. Creator identity is nullable,
-- but its non-PII provenance snapshot must always survive account erasure.

BEGIN;

DO $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Question"
    WHERE "createdByLabelSnapshot" IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM "QuestionVersion"
    WHERE "createdByLabelSnapshot" IS NULL
  ) THEN
    RAISE EXCEPTION 'Creator provenance backfill is incomplete.'
      USING ERRCODE = '23514';
  END IF;
END;
$function$;

ALTER TABLE "Question"
  ALTER COLUMN "createdByLabelSnapshot" SET NOT NULL;

ALTER TABLE "QuestionVersion"
  ALTER COLUMN "createdByLabelSnapshot" SET NOT NULL;

COMMIT;
