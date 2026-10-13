-- Phase 3 Slice 2: close authentication and creator provenance invariants.

BEGIN;

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "User"
    WHERE "name" <> btrim("name")
       OR char_length("name") NOT BETWEEN 1 AND 80
  ) THEN
    RAISE EXCEPTION 'User name contract is not satisfied.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Question" AS question
    LEFT JOIN "User" AS creator ON creator."id" = question."createdByUserId"
    WHERE question."createdByLabelSnapshot" = 'ACTIVE_ADMIN'
      AND (
        creator."id" IS NULL
        OR creator."role" <> 'ADMIN'
        OR creator."accountStatus" <> 'ACTIVE'
      )
  ) OR EXISTS (
    SELECT 1
    FROM "QuestionVersion" AS version
    LEFT JOIN "User" AS creator ON creator."id" = version."createdByUserId"
    WHERE version."createdByLabelSnapshot" = 'ACTIVE_ADMIN'
      AND (
        creator."id" IS NULL
        OR creator."role" <> 'ADMIN'
        OR creator."accountStatus" <> 'ACTIVE'
      )
  ) THEN
    RAISE EXCEPTION 'ACTIVE_ADMIN provenance references an invalid creator.'
      USING ERRCODE = '23514';
  END IF;
END;
$block$;

ALTER TABLE "User"
  ALTER COLUMN "name" TYPE VARCHAR(80),
  ADD CONSTRAINT "User_name_contract_check" CHECK (
    "name" = btrim("name")
    AND char_length("name") BETWEEN 1 AND 80
  );

DROP INDEX "Session_userId_idx";
CREATE INDEX "Session_userId_expiresAt_idx"
  ON "Session"("userId", "expiresAt");

DROP INDEX "Verification_identifier_idx";
CREATE INDEX "Verification_identifier_expiresAt_idx"
  ON "Verification"("identifier", "expiresAt");

CREATE FUNCTION "validate_active_admin_creator"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."createdByLabelSnapshot" <> 'ACTIVE_ADMIN' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW."createdByUserId" IS NOT DISTINCT FROM OLD."createdByUserId"
    AND NEW."createdByLabelSnapshot" IS NOT DISTINCT FROM OLD."createdByLabelSnapshot" THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM "User"
  WHERE "id" = NEW."createdByUserId"
    AND "role" = 'ADMIN'
    AND "accountStatus" = 'ACTIVE'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACTIVE_ADMIN provenance requires an active ADMIN creator.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER "Question_validate_active_admin_creator"
BEFORE INSERT OR UPDATE OF "createdByUserId", "createdByLabelSnapshot"
ON "Question"
FOR EACH ROW
EXECUTE FUNCTION "validate_active_admin_creator"();

CREATE TRIGGER "QuestionVersion_validate_active_admin_creator"
BEFORE INSERT OR UPDATE OF "createdByUserId", "createdByLabelSnapshot"
ON "QuestionVersion"
FOR EACH ROW
EXECUTE FUNCTION "validate_active_admin_creator"();

COMMIT;
