-- Rush kanji words (#1043, operator decision 2026-11-20): the words the
-- 30-second kanji rush shows, one row per word, loaded from
-- content/rush/kanji-words.v1.json by the operator command
-- (rushWordLoadCommand). The app only reads them. No member data and no link
-- to the question tables. No other object changes.
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

CREATE TABLE "RushKanjiWord" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "sourceKey" text NOT NULL,
    "level" "JlptLevel" NOT NULL,
    "word" text NOT NULL,
    "reading" text NOT NULL,
    "wrong" text[] NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    "updatedAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "RushKanjiWord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RushKanjiWord_sourceKey_check"
      CHECK ("sourceKey" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
    -- A dictionary-form word with a kanji: no conjugation tail (#1043).
    CONSTRAINT "RushKanjiWord_word_check"
      CHECK (char_length("word") BETWEEN 1 AND 8
        AND "word" ~ '[一-鿿々]'
        AND "word" !~ '\s'
        AND "word" !~ '(ます|ました|ません|て|で|た|だ)$'),
    CONSTRAINT "RushKanjiWord_reading_check"
      CHECK ("reading" ~ '^[ぁ-ゖー]{1,16}$'),
    -- Exactly three hiragana wrong readings, apart from each other and the
    -- reading.
    CONSTRAINT "RushKanjiWord_wrong_check"
      CHECK (cardinality("wrong") = 3
        AND array_to_string("wrong", ',')
          ~ '^[ぁ-ゖー]{1,16},[ぁ-ゖー]{1,16},[ぁ-ゖー]{1,16}$'
        AND "wrong"[1] <> "wrong"[2]
        AND "wrong"[1] <> "wrong"[3]
        AND "wrong"[2] <> "wrong"[3]
        AND "reading" <> ALL ("wrong"))
);

CREATE UNIQUE INDEX "RushKanjiWord_sourceKey_key"
  ON "RushKanjiWord" ("sourceKey");
CREATE UNIQUE INDEX "RushKanjiWord_level_word_key"
  ON "RushKanjiWord" ("level", "word");

GRANT SELECT ON TABLE "RushKanjiWord" TO nihongo_app;

SET LOCAL ROLE "nihongo_migration";
COMMIT;
