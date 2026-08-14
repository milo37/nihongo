-- Keep QuestionVersion invariants active while the following legacy
-- provenance migration temporarily disables the original validation trigger.
-- This migration intentionally sorts before 20260814121000 on fresh databases.

CREATE OR REPLACE FUNCTION "validate_question_version_backfill_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  option_count INTEGER;
  tag_count INTEGER;
BEGIN
  IF TG_OP = 'INSERT' AND NEW."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'QuestionVersion must be inserted as DRAFT.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" = 'RETIRED' THEN
    RAISE EXCEPTION 'RETIRED QuestionVersion is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" = 'PUBLISHED' THEN
    -- The reviewed Slice 1 seed is the only pre-auth catalog. Permit exactly
    -- the one-time, non-PII provenance fill performed by the next migration.
    IF OLD."createdByUserId" IS NULL
      AND OLD."createdByLabelSnapshot" IS NULL
      AND NEW."createdByUserId" IS NULL
      AND NEW."createdByLabelSnapshot" = 'SYSTEM_SEED'
      AND (
        to_jsonb(NEW) - 'createdByLabelSnapshot' - 'updatedAt'
      ) = (
        to_jsonb(OLD) - 'createdByLabelSnapshot' - 'updatedAt'
      ) THEN
      RETURN NEW;
    END IF;

    IF NEW."status" <> 'RETIRED' THEN
      RAISE EXCEPTION 'PUBLISHED QuestionVersion is immutable.'
        USING ERRCODE = '23514';
    END IF;

    PERFORM 1
    FROM "Question"
    WHERE "id" = OLD."questionId"
    FOR UPDATE;

    IF EXISTS (
      SELECT 1
      FROM "Question"
      WHERE "currentPublishedVersionId" = OLD."id"
    ) THEN
      RAISE EXCEPTION 'Current QuestionVersion must be unlinked before retirement.'
        USING ERRCODE = '23514';
    END IF;

    IF (
      to_jsonb(NEW)
        - 'status'
        - 'retiredAt'
        - 'updatedAt'
    ) <> (
      to_jsonb(OLD)
        - 'status'
        - 'retiredAt'
        - 'updatedAt'
    ) THEN
      RAISE EXCEPTION 'Retirement cannot change published content.'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" = 'DRAFT' THEN
    IF NEW."status" = 'RETIRED' THEN
      RAISE EXCEPTION 'DRAFT QuestionVersion cannot be retired.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW."status" = 'PUBLISHED' THEN
      SELECT COUNT(*)
      INTO option_count
      FROM "QuestionOption"
      WHERE "questionVersionId" = NEW."id";

      SELECT COUNT(*)
      INTO tag_count
      FROM "QuestionVersionTag"
      WHERE "questionVersionId" = NEW."id";

      IF option_count <> 4 THEN
        RAISE EXCEPTION 'Published QuestionVersion requires exactly four options.'
          USING ERRCODE = '23514';
      END IF;

      IF tag_count < 1 THEN
        RAISE EXCEPTION 'Published QuestionVersion requires at least one tag.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER "QuestionVersion_validate_backfill_guard"
BEFORE INSERT OR UPDATE ON "QuestionVersion"
FOR EACH ROW
EXECUTE FUNCTION "validate_question_version_backfill_guard"();
