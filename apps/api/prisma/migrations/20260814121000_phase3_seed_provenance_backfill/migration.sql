-- Rows present before Slice 2 can only originate from the reviewed Slice 1
-- catalog seed. Preserve that non-PII provenance explicitly.

ALTER TABLE "QuestionVersion"
  DISABLE TRIGGER "QuestionVersion_validate_change";

UPDATE "QuestionVersion"
SET "createdByLabelSnapshot" = 'SYSTEM_SEED'
WHERE "createdByUserId" IS NULL
  AND "createdByLabelSnapshot" IS NULL
  AND "sourceType" = 'ORIGINAL';

ALTER TABLE "QuestionVersion"
  ENABLE TRIGGER "QuestionVersion_validate_change";

UPDATE "Question" AS question
SET "createdByLabelSnapshot" = 'SYSTEM_SEED'
WHERE question."createdByUserId" IS NULL
  AND question."createdByLabelSnapshot" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "QuestionVersion" AS version
    WHERE version."questionId" = question."id"
      AND version."createdByLabelSnapshot" = 'SYSTEM_SEED'
  );
