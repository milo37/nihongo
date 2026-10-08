-- Phase 3 Slice 1: immutable JLPT question catalog.

CREATE TYPE "QuestionLifecycleStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "QuestionVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "JlptLevel" AS ENUM ('N5', 'N4', 'N3', 'N2', 'N1');
CREATE TYPE "QuestionSubject" AS ENUM ('VOCABULARY', 'GRAMMAR', 'READING');
CREATE TYPE "QuestionType" AS ENUM (
  'KANJI_READING',
  'ORTHOGRAPHY',
  'CONTEXT_VOCABULARY',
  'PARAPHRASE',
  'WORD_USAGE',
  'GRAMMAR_SELECT',
  'SENTENCE_ORDER',
  'TEXT_GRAMMAR',
  'SHORT_READING',
  'MEDIUM_READING',
  'LONG_READING',
  'INFO_RETRIEVAL'
);
CREATE TYPE "QuestionDifficulty" AS ENUM ('EASY', 'NORMAL', 'HARD');
CREATE TYPE "QuestionSourceType" AS ENUM ('ORIGINAL');
CREATE TYPE "CreatorLabelSnapshot" AS ENUM ('ACTIVE_ADMIN', 'DELETED_ADMIN');

CREATE TABLE "Question" (
  "id" UUID NOT NULL,
  "lifecycleStatus" "QuestionLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "currentPublishedVersionId" UUID,
  "createdByUserId" UUID,
  "createdByLabelSnapshot" "CreatorLabelSnapshot",
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "archivedAt" TIMESTAMPTZ(3),
  CONSTRAINT "Question_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Question_lifecycle_check" CHECK (
    (
      "lifecycleStatus" = 'ACTIVE'
      AND "archivedAt" IS NULL
    )
    OR (
      "lifecycleStatus" = 'ARCHIVED'
      AND "archivedAt" IS NOT NULL
      AND "currentPublishedVersionId" IS NULL
    )
  )
);

CREATE TABLE "QuestionVersion" (
  "id" UUID NOT NULL,
  "questionId" UUID NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "status" "QuestionVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "level" "JlptLevel" NOT NULL,
  "subject" "QuestionSubject" NOT NULL,
  "questionType" "QuestionType" NOT NULL,
  "passage" TEXT,
  "questionText" TEXT NOT NULL,
  "correctOptionId" UUID,
  "explanationKo" TEXT NOT NULL,
  "explanationJa" TEXT,
  "difficulty" "QuestionDifficulty" NOT NULL,
  "sourceType" "QuestionSourceType" NOT NULL DEFAULT 'ORIGINAL',
  "rowVersion" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID,
  "createdByLabelSnapshot" "CreatorLabelSnapshot",
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "publishedAt" TIMESTAMPTZ(3),
  "retiredAt" TIMESTAMPTZ(3),
  CONSTRAINT "QuestionVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QuestionVersion_positive_version_check"
    CHECK ("versionNumber" > 0 AND "rowVersion" > 0),
  CONSTRAINT "QuestionVersion_nonblank_content_check"
    CHECK (
      btrim("questionText") <> ''
      AND btrim("explanationKo") <> ''
      AND ("explanationJa" IS NULL OR btrim("explanationJa") <> '')
      AND ("passage" IS NULL OR btrim("passage") <> '')
    ),
  CONSTRAINT "QuestionVersion_reading_passage_check"
    CHECK ("subject" <> 'READING' OR "passage" IS NOT NULL),
  CONSTRAINT "QuestionVersion_status_timestamps_check"
    CHECK (
      (
        "status" = 'DRAFT'
        AND "publishedAt" IS NULL
        AND "retiredAt" IS NULL
      )
      OR (
        "status" = 'PUBLISHED'
        AND "correctOptionId" IS NOT NULL
        AND "publishedAt" IS NOT NULL
        AND "retiredAt" IS NULL
      )
      OR (
        "status" = 'RETIRED'
        AND "correctOptionId" IS NOT NULL
        AND "publishedAt" IS NOT NULL
        AND "retiredAt" IS NOT NULL
      )
    )
);

CREATE TABLE "QuestionOption" (
  "id" UUID NOT NULL,
  "questionVersionId" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  CONSTRAINT "QuestionOption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QuestionOption_label_ordinal_check"
    CHECK (
      "ordinal" BETWEEN 1 AND 4
      AND "label" = "ordinal"::TEXT
      AND btrim("text") <> ''
    )
);

CREATE TABLE "Tag" (
  "id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Tag_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Tag_nonblank_check"
    CHECK (btrim("label") <> '' AND btrim("normalizedName") <> '')
);

CREATE TABLE "QuestionVersionTag" (
  "id" UUID NOT NULL,
  "questionVersionId" UUID NOT NULL,
  "tagId" UUID NOT NULL,
  "labelSnapshot" TEXT NOT NULL,
  CONSTRAINT "QuestionVersionTag_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QuestionVersionTag_snapshot_nonblank_check"
    CHECK (btrim("labelSnapshot") <> '')
);

CREATE UNIQUE INDEX "Question_currentPublishedVersionId_key"
  ON "Question"("currentPublishedVersionId");
CREATE UNIQUE INDEX "Question_id_currentPublishedVersionId_key"
  ON "Question"("id", "currentPublishedVersionId");
CREATE INDEX "Question_lifecycleStatus_currentPublishedVersionId_idx"
  ON "Question"("lifecycleStatus", "currentPublishedVersionId");
CREATE INDEX "Question_createdByUserId_idx"
  ON "Question"("createdByUserId");

CREATE UNIQUE INDEX "QuestionVersion_questionId_versionNumber_key"
  ON "QuestionVersion"("questionId", "versionNumber");
CREATE UNIQUE INDEX "QuestionVersion_questionId_id_key"
  ON "QuestionVersion"("questionId", "id");
CREATE UNIQUE INDEX "QuestionVersion_id_correctOptionId_key"
  ON "QuestionVersion"("id", "correctOptionId");
CREATE INDEX "QuestionVersion_status_level_subject_questionType_difficult_idx"
  ON "QuestionVersion"(
    "status",
    "level",
    "subject",
    "questionType",
    "difficulty"
  );
CREATE INDEX "QuestionVersion_questionId_status_versionNumber_idx"
  ON "QuestionVersion"("questionId", "status", "versionNumber" DESC);
CREATE INDEX "QuestionVersion_createdByUserId_idx"
  ON "QuestionVersion"("createdByUserId");

CREATE UNIQUE INDEX "QuestionOption_questionVersionId_id_key"
  ON "QuestionOption"("questionVersionId", "id");
CREATE UNIQUE INDEX "QuestionOption_questionVersionId_label_key"
  ON "QuestionOption"("questionVersionId", "label");
CREATE UNIQUE INDEX "QuestionOption_questionVersionId_ordinal_key"
  ON "QuestionOption"("questionVersionId", "ordinal");

CREATE UNIQUE INDEX "Tag_normalizedName_key" ON "Tag"("normalizedName");

CREATE UNIQUE INDEX "QuestionVersionTag_questionVersionId_tagId_key"
  ON "QuestionVersionTag"("questionVersionId", "tagId");
CREATE INDEX "QuestionVersionTag_tagId_idx" ON "QuestionVersionTag"("tagId");

ALTER TABLE "QuestionVersion"
  ADD CONSTRAINT "QuestionVersion_questionId_fkey"
  FOREIGN KEY ("questionId")
  REFERENCES "Question"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "QuestionOption"
  ADD CONSTRAINT "QuestionOption_questionVersionId_fkey"
  FOREIGN KEY ("questionVersionId")
  REFERENCES "QuestionVersion"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "QuestionVersionTag"
  ADD CONSTRAINT "QuestionVersionTag_questionVersionId_fkey"
  FOREIGN KEY ("questionVersionId")
  REFERENCES "QuestionVersion"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "QuestionVersionTag"
  ADD CONSTRAINT "QuestionVersionTag_tagId_fkey"
  FOREIGN KEY ("tagId")
  REFERENCES "Tag"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "QuestionVersion"
  ADD CONSTRAINT "QuestionVersion_id_correctOptionId_fkey"
  FOREIGN KEY ("id", "correctOptionId")
  REFERENCES "QuestionOption"("questionVersionId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "Question"
  ADD CONSTRAINT "Question_id_currentPublishedVersionId_fkey"
  FOREIGN KEY ("id", "currentPublishedVersionId")
  REFERENCES "QuestionVersion"("questionId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

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

CREATE TRIGGER "QuestionVersion_validate_change"
BEFORE INSERT OR UPDATE ON "QuestionVersion"
FOR EACH ROW
EXECUTE FUNCTION "validate_question_version_change"();

CREATE OR REPLACE FUNCTION "protect_question_version_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Published QuestionVersion history cannot be deleted.'
      USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END;
$function$;

CREATE TRIGGER "QuestionVersion_protect_delete"
BEFORE DELETE ON "QuestionVersion"
FOR EACH ROW
EXECUTE FUNCTION "protect_question_version_delete"();

CREATE OR REPLACE FUNCTION "protect_question_version_children"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  version_id UUID;
  version_status "QuestionVersionStatus";
BEGIN
  version_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD."questionVersionId"
    ELSE NEW."questionVersionId"
  END;

  SELECT "status"
  INTO version_status
  FROM "QuestionVersion"
  WHERE "id" = version_id;

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

CREATE TRIGGER "QuestionOption_protect_immutable_version"
BEFORE INSERT OR UPDATE OR DELETE ON "QuestionOption"
FOR EACH ROW
EXECUTE FUNCTION "protect_question_version_children"();

CREATE TRIGGER "QuestionVersionTag_protect_immutable_version"
BEFORE INSERT OR UPDATE OR DELETE ON "QuestionVersionTag"
FOR EACH ROW
EXECUTE FUNCTION "protect_question_version_children"();

CREATE OR REPLACE FUNCTION "validate_current_published_version"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."currentPublishedVersionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "QuestionVersion"
    WHERE "id" = NEW."currentPublishedVersionId"
      AND "questionId" = NEW."id"
      AND "status" = 'PUBLISHED'
  ) THEN
    RAISE EXCEPTION 'Current QuestionVersion must be PUBLISHED and same-question.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER "Question_validate_current_version"
BEFORE INSERT OR UPDATE OF "currentPublishedVersionId" ON "Question"
FOR EACH ROW
EXECUTE FUNCTION "validate_current_published_version"();

CREATE OR REPLACE FUNCTION "protect_question_history_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "QuestionVersion"
    WHERE "questionId" = OLD."id"
      AND "status" <> 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'Question with published history cannot be deleted.'
      USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END;
$function$;

CREATE TRIGGER "Question_protect_history_delete"
BEFORE DELETE ON "Question"
FOR EACH ROW
EXECUTE FUNCTION "protect_question_history_delete"();
