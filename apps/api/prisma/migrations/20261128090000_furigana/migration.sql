-- Furigana (#1182, operator-approved design 1182-furigana-design): one table
-- that holds the reading of one piece of text, keyed by an id that already
-- exists: a reading passage, a question version (question text) or a question
-- option. Step 1 fills reading passages only; the other targets follow without
-- a new table. Rows are written by the operator load command; the app only
-- reads them. No other object changes.
BEGIN;
SELECT pg_catalog.set_config('app.target_schema', pg_catalog.current_schema(), true);
SELECT pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true);
DO $preflight$
DECLARE
  target_schema NAME := pg_catalog.current_setting('app.target_schema', false)::NAME;
  expected_wrapper TEXT := CASE
    WHEN pg_catalog.current_database() ~ '_test$' THEN 'nihongo_test_migration_login'
    WHEN pg_catalog.current_database() ~ '_dev$' THEN 'nihongo_development_migration_login'
    WHEN pg_catalog.current_database() = 'nihongo' THEN 'nihongo_production_migration_login'
    ELSE NULL END;
BEGIN
  IF expected_wrapper IS NULL OR SESSION_USER <> expected_wrapper
    OR CURRENT_USER <> 'nihongo_migration'
    OR pg_catalog.current_setting('session_replication_role') <> 'origin'
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace n
      JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
      WHERE n.nspname = target_schema AND r.rolname = 'nihongo_owner'
    ) THEN
    RAISE EXCEPTION 'Migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL check_function_bodies = false;
SET LOCAL ROLE "nihongo_owner";

CREATE TYPE "FuriganaTarget" AS ENUM ('PASSAGE', 'QUESTION_TEXT', 'OPTION');
CREATE TYPE "FuriganaOrigin" AS ENUM ('AUTO', 'REVIEWED');

CREATE TABLE "Furigana" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "target" "FuriganaTarget" NOT NULL,
    "passageId" uuid,
    "questionVersionId" uuid,
    "questionOptionId" uuid,
    -- md5 of the text the readings were made for; a reader drops a row whose
    -- hash no longer matches the text.
    "textMd5" varchar(32) NOT NULL,
    -- [{"start": 0, "length": 1, "reading": "えき"}, ...] in text order.
    "segments" jsonb NOT NULL,
    "origin" "FuriganaOrigin" NOT NULL,
    "reviewedAt" timestamp(3) with time zone,
    "reviewedBy" text,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    "updatedAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "Furigana_pkey" PRIMARY KEY ("id"),
    -- Exactly the one key that matches the target.
    CONSTRAINT "Furigana_target_check"
      CHECK (("target" = 'PASSAGE') = ("passageId" IS NOT NULL)
        AND ("target" = 'QUESTION_TEXT') = ("questionVersionId" IS NOT NULL)
        AND ("target" = 'OPTION') = ("questionOptionId" IS NOT NULL)),
    CONSTRAINT "Furigana_textMd5_check"
      CHECK ("textMd5" ~ '^[0-9a-f]{32}$'),
    CONSTRAINT "Furigana_segments_check"
      CHECK (jsonb_typeof("segments") = 'array'),
    -- A reviewed row says when and by whom; an automatic row says neither.
    CONSTRAINT "Furigana_review_check"
      CHECK (("origin" = 'REVIEWED') = ("reviewedAt" IS NOT NULL)
        AND ("reviewedAt" IS NULL) = ("reviewedBy" IS NULL)
        AND ("reviewedBy" IS NULL OR char_length(btrim("reviewedBy")) BETWEEN 1 AND 64)),
    CONSTRAINT "Furigana_passageId_fkey" FOREIGN KEY ("passageId")
      REFERENCES "ReadingPassage" ("id") ON DELETE RESTRICT,
    CONSTRAINT "Furigana_questionVersionId_fkey" FOREIGN KEY ("questionVersionId")
      REFERENCES "QuestionVersion" ("id") ON DELETE RESTRICT,
    CONSTRAINT "Furigana_questionOptionId_fkey" FOREIGN KEY ("questionOptionId")
      REFERENCES "QuestionOption" ("id") ON DELETE RESTRICT
);

-- One row per target (NULLs are distinct, so each index covers its target).
CREATE UNIQUE INDEX "Furigana_passageId_key" ON "Furigana" ("passageId");
CREATE UNIQUE INDEX "Furigana_questionVersionId_key"
  ON "Furigana" ("questionVersionId");
CREATE UNIQUE INDEX "Furigana_questionOptionId_key"
  ON "Furigana" ("questionOptionId");

GRANT SELECT ON TABLE "Furigana" TO nihongo_app;

SET LOCAL ROLE "nihongo_migration";
COMMIT;
