-- Reading passages stored once (#986 step 1, operator decision 2026-11-21):
-- each passage text is one "ReadingPassage" row, and a question version
-- points to it with "passageId" and its place under it with "passageOrder".
-- The "passage" text column stays as it is (step 2 drops it separately), so a
-- code rollback alone restores the old behaviour. A passage row's text never
-- changes: an edited passage is a new row. No other object changes.
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

CREATE TABLE "ReadingPassage" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "level" "JlptLevel" NOT NULL,
    "subject" "QuestionSubject" NOT NULL,
    "text" text NOT NULL,
    "textMd5" character varying(32) NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "ReadingPassage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReadingPassage_text_check"
      CHECK (btrim("text") <> '' AND "textMd5" = md5("text"))
);

-- One row per exact text within a level and subject.
CREATE UNIQUE INDEX "ReadingPassage_level_subject_textMd5_key"
  ON "ReadingPassage" ("level", "subject", "textMd5");

ALTER TABLE "QuestionVersion"
  ADD COLUMN "passageId" uuid,
  ADD COLUMN "passageOrder" smallint;

-- backfill:start
INSERT INTO "ReadingPassage" ("level", "subject", "text", "textMd5")
SELECT DISTINCT version."level", version."subject", version."passage",
  md5(version."passage")
FROM "QuestionVersion" AS version
WHERE version."passage" IS NOT NULL;

-- The questions under a passage keep the order they were imported in (the
-- import result lists them in file order); others follow by creation. The
-- versions of one question share its place.
WITH imported AS (
  SELECT (item.value ->> 'questionId')::uuid AS "questionId",
    result."createdAt" AS "importedAt", item.ordinality AS "position"
  FROM "QuestionImportResult" AS result
  CROSS JOIN LATERAL jsonb_array_elements(
    result."response" -> 'response' -> 'items'
  ) WITH ORDINALITY AS item(value, ordinality)
), placed AS (
  SELECT version."id", passage."id" AS "passageId",
    dense_rank() OVER (
      PARTITION BY passage."id"
      ORDER BY COALESCE(imported."importedAt", question."createdAt"),
        imported."position" NULLS LAST, question."createdAt", question."id"
    ) AS "passageOrder"
  FROM "QuestionVersion" AS version
  JOIN "Question" AS question ON question."id" = version."questionId"
  JOIN "ReadingPassage" AS passage
    ON passage."level" = version."level"
    AND passage."subject" = version."subject"
    AND passage."textMd5" = md5(version."passage")
    AND passage."text" = version."passage"
  LEFT JOIN imported ON imported."questionId" = version."questionId"
)
UPDATE "QuestionVersion" AS version
SET "passageId" = placed."passageId",
  "passageOrder" = placed."passageOrder"
FROM placed
WHERE version."id" = placed."id";
-- backfill:end

-- The backfill update queues the deferred content checks of each version it
-- touched; run them now, so the version table can be altered below.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE "QuestionVersion"
  ADD CONSTRAINT "QuestionVersion_passageId_fkey"
    FOREIGN KEY ("passageId") REFERENCES "ReadingPassage"("id")
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  ADD CONSTRAINT "QuestionVersion_passage_link_check"
    CHECK (("passage" IS NULL) = ("passageId" IS NULL)
      AND ("passageId" IS NULL) = ("passageOrder" IS NULL)
      AND ("passageOrder" IS NULL OR "passageOrder" >= 1));

CREATE INDEX "QuestionVersion_passageId_passageOrder_idx"
  ON "QuestionVersion" ("passageId", "passageOrder");

-- Every write links the version to the row of its passage text, so no
-- caller sets or moves the link: a changed text links to its own row, and
-- a question new to a passage takes the next place.
CREATE FUNCTION link_question_version_passage() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  linked UUID;
  place SMALLINT;
BEGIN
  IF NEW."passage" IS NULL THEN
    NEW."passageId" := NULL;
    NEW."passageOrder" := NULL;
    RETURN NEW;
  END IF;
  INSERT INTO "ReadingPassage" ("level", "subject", "text", "textMd5")
  VALUES (NEW."level", NEW."subject", NEW."passage", md5(NEW."passage"))
  ON CONFLICT ("level", "subject", "textMd5") DO NOTHING;
  SELECT passage."id" INTO linked
  FROM "ReadingPassage" AS passage
  WHERE passage."level" = NEW."level"
    AND passage."subject" = NEW."subject"
    AND passage."textMd5" = md5(NEW."passage")
    AND passage."text" = NEW."passage";
  IF linked IS NULL THEN
    RAISE EXCEPTION 'The reading passage row is not visible.'
      USING ERRCODE = '40001';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."passageId" = linked THEN
    NEW."passageId" := linked;
    NEW."passageOrder" := OLD."passageOrder";
    RETURN NEW;
  END IF;
  -- A new version keeps its question's place under the same passage.
  SELECT version."passageOrder" INTO place
  FROM "QuestionVersion" AS version
  WHERE version."questionId" = NEW."questionId"
    AND version."passageId" = linked
    AND version."id" <> NEW."id"
  ORDER BY version."versionNumber" DESC
  LIMIT 1;
  IF place IS NULL THEN
    SELECT COALESCE(max(version."passageOrder"), 0) + 1 INTO place
    FROM "QuestionVersion" AS version
    WHERE version."passageId" = linked
      AND version."questionId" <> NEW."questionId";
  END IF;
  NEW."passageId" := linked;
  NEW."passageOrder" := place;
  RETURN NEW;
END;
$$;

DO $fixed_path$
DECLARE
  target_schema TEXT := pg_catalog.current_setting('app.target_schema', false);
  function_oid OID;
BEGIN
  FOR function_oid IN
    SELECT procedure_record.oid
    FROM pg_catalog.pg_proc AS procedure_record
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure_record.pronamespace
    WHERE namespace.nspname = target_schema
      AND procedure_record.proname = 'link_question_version_passage'
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET search_path TO pg_catalog, %I, pg_temp',
      function_oid::REGPROCEDURE, target_schema
    );
  END LOOP;
END;
$fixed_path$;

REVOKE ALL ON FUNCTION link_question_version_passage() FROM PUBLIC;

CREATE TRIGGER "QuestionVersion_link_passage"
  BEFORE INSERT OR UPDATE OF "level", "subject", "passage", "passageId",
    "passageOrder"
  ON "QuestionVersion"
  FOR EACH ROW EXECUTE FUNCTION link_question_version_passage();

GRANT SELECT ON TABLE "ReadingPassage" TO nihongo_app;

SET LOCAL ROLE "nihongo_migration";
COMMIT;
