-- JLP-701 (#504 P4, part 1): admin CMS write rules run in the API.
-- The admin command repositories already lock and re-check every target
-- (state, rowVersion, editability) before they write, and only write the
-- fixed next state of each command. Drop the row triggers that repeated those
-- rules inside the database. No grant changes.
-- Kept until later packets: deferred content/aggregate/fingerprint checks,
-- tag snapshot/scope triggers (#504 P5 rest), the SYSTEM_SEED catalog check
-- (part 2), the erasure trigger on User (#504 P6b).
-- Rollback: re-run the five function definitions and their triggers from
-- 20260827101000_phase7_admin_cms_foundation.
BEGIN;
SELECT pg_catalog.set_config('app.phase7_target_schema', pg_catalog.current_schema(), true);
SELECT pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true);
DO $preflight$
DECLARE
  target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema', false)::NAME;
  expected_wrapper TEXT := CASE
    WHEN pg_catalog.current_database() ~ '_test$' THEN 'nihongo_test_phase7_migration_login'
    WHEN pg_catalog.current_database() ~ '_dev$' THEN 'nihongo_development_phase7_migration_login'
    ELSE NULL END;
BEGIN
  IF expected_wrapper IS NULL OR SESSION_USER <> expected_wrapper
    OR CURRENT_USER <> 'nihongo_phase7_migration'
    OR pg_catalog.current_setting('role', true) <> 'nihongo_phase7_migration'
    OR pg_catalog.current_setting('session_replication_role') <> 'origin'
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace n
      JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
      WHERE n.nspname = target_schema AND r.rolname = 'nihongo_phase7_owner'
    ) THEN
    RAISE EXCEPTION 'CMS rules API migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

DROP TRIGGER "Question_validate_change" ON "Question";
DROP TRIGGER "QuestionVersion_validate_change" ON "QuestionVersion";
DROP TRIGGER "QuestionOption_protect_immutable_version" ON "QuestionOption";
DROP TRIGGER "QuestionVersionTag_protect_immutable_version" ON "QuestionVersionTag";
DROP TRIGGER "Tag_protect_identity" ON "Tag";
DROP TRIGGER "QuestionReport_protect_history" ON "QuestionReport";
DROP FUNCTION "validate_phase7_question_change"();
DROP FUNCTION "validate_question_version_change"();
DROP FUNCTION "protect_question_version_children"();
DROP FUNCTION "protect_phase7_tag_identity"();
DROP FUNCTION "protect_phase7_question_report"();
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
