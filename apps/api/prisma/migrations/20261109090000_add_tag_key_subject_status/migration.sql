-- Adds the tag list fields (JLP-733, #646, owner-approved 2026-11-07): a
-- stable key, the subject a tag belongs to, and whether it can still be
-- assigned. The tag load command fills them from the tag list file; existing
-- rows stay NULL until then, and NOT NULL comes after the question remap in a
-- separate migration. Only new columns, their checks, index and enum are
-- added; no existing object changes.
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

CREATE TYPE "TagStatus" AS ENUM ('ACTIVE', 'RETIRED');
REVOKE ALL ON TYPE "TagStatus" FROM PUBLIC;
GRANT ALL ON TYPE "TagStatus" TO nihongo_migration;
GRANT ALL ON TYPE "TagStatus" TO nihongo_app;

ALTER TABLE "Tag"
  ADD COLUMN "key" TEXT,
  ADD COLUMN "subject" "QuestionSubject",
  ADD COLUMN "status" "TagStatus",
  ADD CONSTRAINT "Tag_key_format_check"
    CHECK ("key" ~ '^[a-z]+\.[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "Tag_list_fields_check"
    CHECK (("key" IS NULL) = ("subject" IS NULL)
      AND ("key" IS NULL) = ("status" IS NULL));

CREATE UNIQUE INDEX "Tag_key_key" ON "Tag" ("key");

SET LOCAL ROLE "nihongo_migration";
COMMIT;
