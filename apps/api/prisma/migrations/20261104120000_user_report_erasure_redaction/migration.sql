-- #491 additive: when a reporter account is erased, its UserReport text is
-- redacted like QuestionReport (row kept, reporter detached, text removed).
-- New function and trigger on UserReport only; existing objects unchanged.
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
    RAISE EXCEPTION 'Report erasure migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

-- The FK ON DELETE SET NULL action is the only path that clears the reporter.
CREATE FUNCTION "redact_user_report_on_reporter_erasure"()
RETURNS TRIGGER
LANGUAGE plpgsql AS $function$
BEGIN
  IF OLD."reporterUserId" IS NOT NULL AND NEW."reporterUserId" IS NULL THEN
    NEW."description" := '탈퇴한 회원의 제보 내용은 삭제되었습니다.';
    NEW."rowVersion" := OLD."rowVersion" + 1;
    NEW."updatedAt" := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION "redact_user_report_on_reporter_erasure"() FROM PUBLIC,
  "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

CREATE TRIGGER "UserReport_redact_on_reporter_erasure"
BEFORE UPDATE OF "reporterUserId" ON "UserReport"
FOR EACH ROW EXECUTE FUNCTION "redact_user_report_on_reporter_erasure"();

DO $harden_user_report_functions$
DECLARE
  target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema', false)::NAME;
BEGIN
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %I."redact_user_report_on_reporter_erasure"() SET search_path TO pg_catalog, %I, pg_temp',
    target_schema, target_schema);
END;
$harden_user_report_functions$;
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
