-- Removes the tag applicability table and the tag snapshots (JLP-733, #646,
-- owner-approved 2026-11-07). Tags become a fixed list loaded by an operator
-- command; a question version keeps only its tagId, and readers join "Tag"
-- for the name. Dropped: TagApplicability with its write guard, the
-- QuestionVersionTag snapshot columns with their checks and unique key, and
-- the triggers that copied, re-checked and serialized those snapshots.
-- validate_question_version_content keeps every check except the
-- applicability lookup; its owner and ACL are unchanged and it never had a
-- fixed search_path.
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

DROP TRIGGER "QuestionVersionTag_copy_snapshots" ON "QuestionVersionTag";
DROP TRIGGER "QuestionVersionTag_validate_inserted_snapshots" ON "QuestionVersionTag";
DROP TRIGGER "QuestionVersionTag_lock_assignment_scope" ON "QuestionVersionTag";
DROP TRIGGER "Tag_lock_assignment_scope" ON "Tag";
DROP FUNCTION copy_tag_snapshots();
DROP FUNCTION validate_inserted_tag_snapshots();
DROP FUNCTION lock_tag_assignment_scope();

-- FUNCTION: validate_question_version_content()
CREATE OR REPLACE FUNCTION validate_question_version_content() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  target_version_id UUID;
  changed_row JSONB;
  version_row "QuestionVersion"%ROWTYPE;
  option_count INTEGER;
  normalized_option_count INTEGER;
  tag_count INTEGER;
  expected_fingerprint TEXT;
BEGIN
  IF current_setting('transaction_isolation') NOT IN (
    'read committed', 'serializable'
  ) THEN
    RAISE EXCEPTION 'Question content mutation requires READ COMMITTED or SERIALIZABLE isolation.'
      USING ERRCODE = '25001';
  END IF;
  changed_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  target_version_id := CASE WHEN TG_TABLE_NAME = 'QuestionVersion'
    THEN (changed_row ->> 'id')::UUID
    ELSE (changed_row ->> 'questionVersionId')::UUID
  END;
  SELECT * INTO version_row FROM "QuestionVersion" WHERE "id" = target_version_id;
  IF version_row."id" IS NULL THEN RETURN NULL; END IF;

  SELECT COUNT(*), COUNT(DISTINCT "normalize_option_comparison"("text"))
  INTO option_count, normalized_option_count
  FROM "QuestionOption" WHERE "questionVersionId" = target_version_id;
  SELECT COUNT(*) INTO tag_count
  FROM "QuestionVersionTag" WHERE "questionVersionId" = target_version_id;
  expected_fingerprint := "question_version_fingerprint"(target_version_id);

  IF option_count <> 4 OR normalized_option_count <> 4
    OR tag_count NOT BETWEEN 1 AND 12
    OR NOT EXISTS (
      SELECT 1 FROM "QuestionOption"
      WHERE "questionVersionId" = target_version_id
        AND "id" = version_row."correctOptionId"
    ) OR expected_fingerprint IS NULL
      OR version_row."contentFingerprint" IS DISTINCT FROM expected_fingerprint THEN
    RAISE EXCEPTION 'QuestionVersion must commit complete canonical content.'
      USING ERRCODE = '23514';
  END IF;

  -- READ COMMITTED lifecycle-only paths need an explicit per-fingerprint
  -- winner lock. In a SERIALIZABLE content mutation, the indexed predicate is
  -- to PostgreSQL SSI so an invisible concurrent conflict aborts exactly one
  -- transaction instead of being mistaken for an already-visible duplicate.
  IF current_setting('transaction_isolation') = 'read committed' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(version_row."contentFingerprint", 0)
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM "QuestionVersion" AS duplicate
    WHERE duplicate."contentFingerprint" = version_row."contentFingerprint"
      AND duplicate."questionId" <> version_row."questionId"
  ) THEN
    RAISE EXCEPTION 'Cross-question canonical duplicate is forbidden.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TABLE "TagApplicability";
DROP FUNCTION protect_tag_applicability();

ALTER TABLE "QuestionVersionTag"
  DROP CONSTRAINT "QuestionVersionTag_questionVersionId_normalizedNameSnapshot_key",
  DROP CONSTRAINT "QuestionVersionTag_label_snapshot_trimmed_check",
  DROP CONSTRAINT "QuestionVersionTag_normalized_snapshot_check",
  DROP CONSTRAINT "QuestionVersionTag_snapshot_nonblank_check",
  DROP COLUMN "labelSnapshot",
  DROP COLUMN "normalizedNameSnapshot";

SET LOCAL ROLE "nihongo_migration";
COMMIT;
