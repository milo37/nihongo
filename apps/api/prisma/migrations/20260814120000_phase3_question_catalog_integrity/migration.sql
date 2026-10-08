-- Phase 3 Slice 1 follow-up: preserve applied migration history while
-- strengthening provenance, lifecycle serialization, and child immutability.

ALTER TYPE "CreatorLabelSnapshot" ADD VALUE IF NOT EXISTS 'SYSTEM_SEED';

CREATE OR REPLACE FUNCTION "validate_question_version_change"()
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

CREATE OR REPLACE FUNCTION "protect_question_version_children"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  version_id UUID;
  version_status "QuestionVersionStatus";
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD."questionVersionId" IS DISTINCT FROM NEW."questionVersionId" THEN
    RAISE EXCEPTION 'QuestionVersion children cannot be reparented.'
      USING ERRCODE = '23514';
  END IF;

  version_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD."questionVersionId"
    ELSE NEW."questionVersionId"
  END;

  SELECT "status"
  INTO version_status
  FROM "QuestionVersion"
  WHERE "id" = version_id
  FOR UPDATE;

  IF TG_OP = 'DELETE' AND version_status IS NULL THEN
    RETURN OLD;
  END IF;

  IF version_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Published QuestionVersion children are immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;
