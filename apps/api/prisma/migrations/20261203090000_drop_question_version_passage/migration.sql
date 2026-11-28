-- Drop the copied passage text "QuestionVersion"."passage" (#1220, #986 step
-- 2, operator approval 2026-11-28). The passage text lives only in
-- "ReadingPassage"; a version points to it with "passageId". Writers resolve
-- the row with resolve_reading_passage() (same one-row-per-level-subject-text
-- rule and replacement link as before), the link trigger keeps only the
-- place, and the duplicate fingerprint reads the passage row's text, so every
-- fingerprint stays exactly as it was (checked below for every version before
-- the column goes). Rollback: a new migration re-adds the column and fills it
-- from "ReadingPassage" (no data is lost); no app-only rollback.
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

-- 1. Every linked version's text is its passage row's text, at its level and
-- subject. The column goes only when the two copies agree everywhere.
DO $copies_agree$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "QuestionVersion" AS version
    LEFT JOIN "ReadingPassage" AS passage ON passage."id" = version."passageId"
    WHERE (version."passage" IS NULL) <> (version."passageId" IS NULL)
      OR (version."passageId" IS NOT NULL AND (
        passage."id" IS NULL
        OR passage."text" IS DISTINCT FROM version."passage"
        OR passage."level" <> version."level"
        OR passage."subject" <> version."subject"))
  ) THEN
    RAISE EXCEPTION 'A version passage differs from its reading passage row.'
      USING ERRCODE = '23514';
  END IF;
END;
$copies_agree$;

-- 2. The fingerprint reads the passage row. Compared with the current one for
-- every version first; any difference stops the migration.
CREATE FUNCTION question_version_fingerprint_1220(target_version_id uuid) RETURNS character varying
    LANGUAGE plpgsql STABLE STRICT
    AS $$
DECLARE
  version_row "QuestionVersion"%ROWTYPE;
  option_array TEXT;
  correct_text TEXT;
  canonical_identity TEXT;
BEGIN
  SELECT * INTO version_row
  FROM "QuestionVersion"
  WHERE "id" = target_version_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    '[' || string_agg(
      to_json("normalize_duplicate_text"(option."text"))::TEXT,
      ',' ORDER BY "normalize_duplicate_text"(option."text") COLLATE "C"
    ) || ']'
  INTO option_array
  FROM "QuestionOption" AS option
  WHERE option."questionVersionId" = target_version_id;

  SELECT "normalize_duplicate_text"(option."text")
  INTO correct_text
  FROM "QuestionOption" AS option
  WHERE option."questionVersionId" = target_version_id
    AND option."id" = version_row."correctOptionId";

  IF option_array IS NULL OR correct_text IS NULL THEN
    RETURN NULL;
  END IF;

  canonical_identity :=
    '{"correctOptionText":' || to_json(correct_text)::TEXT ||
    ',"optionTexts":' || option_array ||
    ',"passage":' || COALESCE(
      to_json("normalize_duplicate_text"((SELECT passage."text" FROM "ReadingPassage" AS passage
        WHERE passage."id" = version_row."passageId")))::TEXT,
      'null'
    ) ||
    ',"questionText":' ||
      to_json("normalize_duplicate_text"(version_row."questionText"))::TEXT ||
    ',"questionType":' || to_json(version_row."questionType"::TEXT)::TEXT ||
    ',"subject":' || to_json(version_row."subject"::TEXT)::TEXT || '}';

  RETURN encode(
    public.digest(
      convert_to(canonical_identity, 'UTF8'),
      'sha256'::TEXT
    ),
    'hex'
  );
END;
$$;

DO $same_fingerprint$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "QuestionVersion" AS version
    WHERE "question_version_fingerprint"(version."id") IS DISTINCT FROM
      "question_version_fingerprint_1220"(version."id")
  ) THEN
    RAISE EXCEPTION 'The passage-row fingerprint differs for a version.'
      USING ERRCODE = '23514';
  END IF;
END;
$same_fingerprint$;
DROP FUNCTION question_version_fingerprint_1220(uuid);

CREATE OR REPLACE FUNCTION question_version_fingerprint(target_version_id uuid) RETURNS character varying
    LANGUAGE plpgsql STABLE STRICT
    AS $$
DECLARE
  version_row "QuestionVersion"%ROWTYPE;
  option_array TEXT;
  correct_text TEXT;
  canonical_identity TEXT;
BEGIN
  SELECT * INTO version_row
  FROM "QuestionVersion"
  WHERE "id" = target_version_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    '[' || string_agg(
      to_json("normalize_duplicate_text"(option."text"))::TEXT,
      ',' ORDER BY "normalize_duplicate_text"(option."text") COLLATE "C"
    ) || ']'
  INTO option_array
  FROM "QuestionOption" AS option
  WHERE option."questionVersionId" = target_version_id;

  SELECT "normalize_duplicate_text"(option."text")
  INTO correct_text
  FROM "QuestionOption" AS option
  WHERE option."questionVersionId" = target_version_id
    AND option."id" = version_row."correctOptionId";

  IF option_array IS NULL OR correct_text IS NULL THEN
    RETURN NULL;
  END IF;

  canonical_identity :=
    '{"correctOptionText":' || to_json(correct_text)::TEXT ||
    ',"optionTexts":' || option_array ||
    ',"passage":' || COALESCE(
      to_json("normalize_duplicate_text"((SELECT passage."text" FROM "ReadingPassage" AS passage
        WHERE passage."id" = version_row."passageId")))::TEXT,
      'null'
    ) ||
    ',"questionText":' ||
      to_json("normalize_duplicate_text"(version_row."questionText"))::TEXT ||
    ',"questionType":' || to_json(version_row."questionType"::TEXT)::TEXT ||
    ',"subject":' || to_json(version_row."subject"::TEXT)::TEXT || '}';

  RETURN encode(
    public.digest(
      convert_to(canonical_identity, 'UTF8'),
      'sha256'::TEXT
    ),
    'hex'
  );
END;
$$;

DROP TRIGGER "QuestionVersion_refresh_fingerprint" ON "QuestionVersion";
CREATE TRIGGER "QuestionVersion_refresh_fingerprint"
  AFTER INSERT OR UPDATE OF "level", "subject", "questionType", "passageId",
    "questionText", "correctOptionId"
  ON "QuestionVersion"
  FOR EACH ROW EXECUTE FUNCTION refresh_question_version_fingerprint();

-- 3. Writers name the passage row; the text finds or makes it. A row made for
-- a question that came from another passage replaces that passage (#1196);
-- as in the old trigger, the version being edited is not its own source.
CREATE FUNCTION resolve_reading_passage(target_question_id uuid,
  target_level "JlptLevel", target_subject "QuestionSubject",
  passage_text text, edited_version_id uuid DEFAULT NULL) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  linked UUID;
  previous_passage UUID;
BEGIN
  IF passage_text IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT version."passageId" INTO previous_passage
  FROM "QuestionVersion" AS version
  WHERE version."questionId" = target_question_id
    AND version."id" IS DISTINCT FROM edited_version_id
    AND version."passageId" IS NOT NULL
  ORDER BY version."versionNumber" DESC
  LIMIT 1;
  INSERT INTO "ReadingPassage" ("level", "subject", "text", "textMd5",
    "replacesPassageId")
  VALUES (target_level, target_subject, passage_text, md5(passage_text),
    previous_passage)
  ON CONFLICT ("level", "subject", "textMd5") DO NOTHING;
  SELECT passage."id" INTO linked
  FROM "ReadingPassage" AS passage
  WHERE passage."level" = target_level
    AND passage."subject" = target_subject
    AND passage."textMd5" = md5(passage_text)
    AND passage."text" = passage_text;
  IF linked IS NULL THEN
    RAISE EXCEPTION 'The reading passage row is not visible.'
      USING ERRCODE = '40001';
  END IF;
  RETURN linked;
END;
$$;

-- 4. The link trigger keeps the place under the named passage (same rules as
-- #986/#1196) and refuses a passage of another level or subject.
CREATE OR REPLACE FUNCTION link_question_version_passage() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  replaced UUID;
  previous_passage UUID;
  previous_place SMALLINT;
  place SMALLINT;
BEGIN
  IF NEW."passageId" IS NULL THEN
    NEW."passageOrder" := NULL;
    RETURN NEW;
  END IF;
  SELECT passage."replacesPassageId" INTO replaced
  FROM "ReadingPassage" AS passage
  WHERE passage."id" = NEW."passageId"
    AND passage."level" = NEW."level"
    AND passage."subject" = NEW."subject";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The reading passage is not of this level and subject.'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."passageId" = NEW."passageId" THEN
    NEW."passageOrder" := OLD."passageOrder";
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
  -- A new version keeps its question's place under the same passage.
  SELECT version."passageOrder" INTO place
  FROM "QuestionVersion" AS version
  WHERE version."questionId" = NEW."questionId"
    AND version."passageId" = NEW."passageId"
    AND version."id" <> NEW."id"
  ORDER BY version."versionNumber" DESC
  LIMIT 1;
  -- Moving to the passage that replaces its passage keeps its place there.
  IF place IS NULL AND replaced IS NOT NULL
    AND replaced = previous_passage AND NOT EXISTS (
      SELECT 1 FROM "QuestionVersion" AS version
      WHERE version."passageId" = NEW."passageId"
        AND version."questionId" <> NEW."questionId"
        AND version."passageOrder" = previous_place
    ) THEN
    place := previous_place;
  END IF;
  IF place IS NULL THEN
    SELECT COALESCE(max(version."passageOrder"), 0) + 1 INTO place
    FROM "QuestionVersion" AS version
    WHERE version."passageId" = NEW."passageId"
      AND version."questionId" <> NEW."questionId";
  END IF;
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
      AND procedure_record.proname IN ('link_question_version_passage', 'resolve_reading_passage')
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET search_path TO pg_catalog, %I, pg_temp',
      function_oid::REGPROCEDURE, target_schema
    );
  END LOOP;
END;
$fixed_path$;

REVOKE ALL ON FUNCTION link_question_version_passage() FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_reading_passage(uuid, "JlptLevel", "QuestionSubject", text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_reading_passage(uuid, "JlptLevel", "QuestionSubject", text, uuid) TO nihongo_app;
GRANT EXECUTE ON FUNCTION resolve_reading_passage(uuid, "JlptLevel", "QuestionSubject", text, uuid) TO nihongo_migration;

DROP TRIGGER "QuestionVersion_link_passage" ON "QuestionVersion";
CREATE TRIGGER "QuestionVersion_link_passage"
  BEFORE INSERT OR UPDATE OF "level", "subject", "passageId", "passageOrder"
  ON "QuestionVersion"
  FOR EACH ROW EXECUTE FUNCTION link_question_version_passage();

-- 5. The content rules read "passageId"; a passage row's text is never blank
-- ("ReadingPassage_text_check").
ALTER TABLE "QuestionVersion"
  DROP CONSTRAINT "QuestionVersion_content_type_check",
  ADD CONSTRAINT "QuestionVersion_content_type_check" CHECK ((((subject = 'VOCABULARY'::"QuestionSubject") AND ("questionType" = ANY (ARRAY['KANJI_READING'::"QuestionType", 'ORTHOGRAPHY'::"QuestionType", 'CONTEXT_VOCABULARY'::"QuestionType", 'PARAPHRASE'::"QuestionType", 'WORD_USAGE'::"QuestionType"])) AND ("passageId" IS NULL)) OR ((subject = 'GRAMMAR'::"QuestionSubject") AND ("questionType" = ANY (ARRAY['GRAMMAR_SELECT'::"QuestionType", 'SENTENCE_ORDER'::"QuestionType", 'TEXT_GRAMMAR'::"QuestionType"])) AND (("questionType" = 'TEXT_GRAMMAR'::"QuestionType") OR ("passageId" IS NULL))) OR ((subject = 'READING'::"QuestionSubject") AND ("passageId" IS NOT NULL) AND (((level = ANY (ARRAY['N5'::"JlptLevel", 'N4'::"JlptLevel"])) AND ("questionType" = ANY (ARRAY['SHORT_READING'::"QuestionType", 'INFO_RETRIEVAL'::"QuestionType"]))) OR ((level = 'N3'::"JlptLevel") AND ("questionType" = ANY (ARRAY['SHORT_READING'::"QuestionType", 'MEDIUM_READING'::"QuestionType", 'INFO_RETRIEVAL'::"QuestionType"]))) OR ((level = ANY (ARRAY['N2'::"JlptLevel", 'N1'::"JlptLevel"])) AND ("questionType" = ANY (ARRAY['MEDIUM_READING'::"QuestionType", 'LONG_READING'::"QuestionType", 'INFO_RETRIEVAL'::"QuestionType"]))))))),
  DROP CONSTRAINT "QuestionVersion_nonblank_content_check",
  ADD CONSTRAINT "QuestionVersion_nonblank_content_check" CHECK (((btrim("questionText") <> ''::text) AND (btrim("explanationKo") <> ''::text) AND (("explanationJa" IS NULL) OR (btrim("explanationJa") <> ''::text)))),
  DROP CONSTRAINT "QuestionVersion_passage_link_check",
  ADD CONSTRAINT "QuestionVersion_passage_link_check"
    CHECK (("passageId" IS NULL) = ("passageOrder" IS NULL)
      AND ("passageOrder" IS NULL OR "passageOrder" >= 1));

-- 6. The copy goes.
ALTER TABLE "QuestionVersion" DROP COLUMN "passage";

SET LOCAL ROLE "nihongo_migration";
COMMIT;
