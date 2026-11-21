-- Shared reading passages (#1196, operator decision 2026-11-21, follows
-- #986): a passage's text changes only for its whole group, and the group's
-- new versions publish together. This migration records which passage a new
-- passage replaces, keeps each question's place when it moves to the
-- replacing passage, and refuses at commit a published group split between a
-- passage and the passage that replaces it. No existing row changes.
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

ALTER TABLE "ReadingPassage" ADD COLUMN "replacesPassageId" uuid;
ALTER TABLE "ReadingPassage"
  ADD CONSTRAINT "ReadingPassage_replacesPassageId_fkey"
    FOREIGN KEY ("replacesPassageId") REFERENCES "ReadingPassage" ("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "ReadingPassage_replaces_check"
    CHECK ("replacesPassageId" IS NULL OR "replacesPassageId" <> "id");
CREATE INDEX "ReadingPassage_replacesPassageId_idx"
  ON "ReadingPassage" ("replacesPassageId");

-- The link of #986, plus: a passage created for a question that came from
-- another passage replaces that passage, and the question keeps its place
-- there unless another question of the new passage already holds it.
CREATE OR REPLACE FUNCTION link_question_version_passage() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  linked UUID;
  replaced UUID;
  previous_passage UUID;
  previous_place SMALLINT;
  place SMALLINT;
BEGIN
  IF NEW."passage" IS NULL THEN
    NEW."passageId" := NULL;
    NEW."passageOrder" := NULL;
    RETURN NEW;
  END IF;
  SELECT version."passageId", version."passageOrder"
  INTO previous_passage, previous_place
  FROM "QuestionVersion" AS version
  WHERE version."questionId" = NEW."questionId"
    AND version."id" <> NEW."id"
    AND version."passageId" IS NOT NULL
  ORDER BY version."versionNumber" DESC
  LIMIT 1;
  INSERT INTO "ReadingPassage" ("level", "subject", "text", "textMd5",
    "replacesPassageId")
  VALUES (NEW."level", NEW."subject", NEW."passage", md5(NEW."passage"),
    previous_passage)
  ON CONFLICT ("level", "subject", "textMd5") DO NOTHING;
  SELECT passage."id", passage."replacesPassageId" INTO linked, replaced
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
  -- Moving to the passage that replaces its passage keeps its place there.
  IF place IS NULL AND replaced IS NOT NULL
    AND replaced = previous_passage AND NOT EXISTS (
      SELECT 1 FROM "QuestionVersion" AS version
      WHERE version."passageId" = linked
        AND version."questionId" <> NEW."questionId"
        AND version."passageOrder" = previous_place
    ) THEN
    place := previous_place;
  END IF;
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

-- At commit, a published version on a passage leaves no active question
-- published on the passage it replaces or on a passage that replaces it: the
-- group publishes together or not at all.
CREATE FUNCTION validate_passage_group_publication() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  split_question UUID;
BEGIN
  IF NEW."status" <> 'PUBLISHED' OR NEW."passageId" IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT question."id" INTO split_question
  FROM "Question" AS question
  JOIN "QuestionVersion" AS published
    ON published."id" = question."currentPublishedVersionId"
  JOIN "ReadingPassage" AS passage ON passage."id" = published."passageId"
  WHERE question."lifecycleStatus" = 'ACTIVE'
    AND question."currentPublishedVersionId" <> NEW."id"
    AND EXISTS (
      SELECT 1 FROM "QuestionVersion" AS current
      WHERE current."id" = NEW."id" AND current."status" = 'PUBLISHED'
    )
    AND (
      passage."id" = (SELECT linked."replacesPassageId"
        FROM "ReadingPassage" AS linked WHERE linked."id" = NEW."passageId")
      OR passage."replacesPassageId" = NEW."passageId"
    )
  LIMIT 1;
  IF split_question IS NOT NULL THEN
    RAISE EXCEPTION 'A shared reading passage group must publish together.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
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
      AND procedure_record.proname IN ('link_question_version_passage', 'validate_passage_group_publication')
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET search_path TO pg_catalog, %I, pg_temp',
      function_oid::REGPROCEDURE, target_schema
    );
  END LOOP;
END;
$fixed_path$;

REVOKE ALL ON FUNCTION link_question_version_passage() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_passage_group_publication() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER "QuestionVersion_passage_group_publication"
  AFTER INSERT OR UPDATE OF "status" ON "QuestionVersion"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_passage_group_publication();

SET LOCAL ROLE "nihongo_migration";
COMMIT;
