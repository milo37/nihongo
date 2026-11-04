-- JLP-701 (#504 P7 PR1): the API runs every SQL facade as nihongo_app.
-- phase7_require_caller_role now also accepts nihongo_app where a facade
-- requires nihongo_auth_gateway or nihongo_erasure_worker; every other check
-- inside the facades (session, authority, trusted execution, locks) is
-- unchanged. nihongo_app gets EXECUTE on the gateway and erasure worker
-- facades. No table, column, schema or type grant changes; the old roles keep
-- their grants until #504 P7 PR5 drops them.
-- Rollback: re-run phase7_require_caller_role from
-- 20260827101000_phase7_admin_cms_foundation and revoke the EXECUTE grants
-- below from nihongo_app.
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
    RAISE EXCEPTION 'Runtime role merge migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

CREATE OR REPLACE FUNCTION "phase7_require_caller_role"(required_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  effective_caller TEXT := current_setting('role', true);
BEGIN
  IF current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN
    RAISE EXCEPTION 'Phase 7 facades require session_replication_role=origin.'
      USING ERRCODE = '42501';
  END IF;
  IF effective_caller IS NULL OR effective_caller = 'none' THEN
    effective_caller := session_user;
  END IF;
  IF effective_caller IS DISTINCT FROM required_role
    AND NOT (
      effective_caller = 'nihongo_app'
      AND required_role IN ('nihongo_auth_gateway', 'nihongo_erasure_worker')
    ) THEN
    RAISE EXCEPTION 'Caller role % is not authorized for this facade.',
      effective_caller USING ERRCODE = '42501';
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION
  "phase7_abort_reauthentication"(UUID),
  "phase7_begin_sso_provider_cleanup"(UUID, TEXT, UUID, "AdminAuditEnvironment"),
  "phase7_cancel_sso_admin_fresh_proof"(TEXT),
  "phase7_change_user_authority"(TEXT, UUID, INTEGER, "UserRole", "UserAccountStatus", "AdminAuditEnvironment"),
  "phase7_claim_sso_provider_cleanups"(INTEGER, INTEGER, "AdminAuditEnvironment"),
  "phase7_cleanup_expired_auth_state"(INTEGER, "AdminAuditEnvironment"),
  "phase7_cleanup_reauthentication"(INTEGER),
  "phase7_complete_sso_account_erasure"(UUID, "AdminAuditEnvironment"),
  "phase7_complete_sso_account_fresh"(TEXT, TEXT),
  "phase7_complete_sso_account_link"(TEXT, TEXT),
  "phase7_complete_sso_admin_fresh"(TEXT, TEXT, UUID, TEXT, TEXT, TEXT),
  "phase7_confirm_v1_session_issuance"(TEXT, UUID, UUID, INTEGER, "UserRole", "UserAccountStatus"),
  "phase7_consume_sso_account_fresh_transaction"(TEXT, TEXT, TEXT, TEXT),
  "phase7_consume_sso_admin_fresh_transaction"(TEXT, TEXT, TEXT),
  "phase7_consume_sso_transaction_v2"(TEXT, TEXT, TEXT),
  "phase7_create_sso_account_fresh_transaction"(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB),
  "phase7_create_sso_admin_fresh_transaction"(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB),
  "phase7_create_sso_transaction_v2"(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT),
  "phase7_erase_user"(UUID, "AdminAuditEnvironment"),
  "phase7_finalize_reauthentication"(UUID, TEXT),
  "phase7_issue_v1_session"(UUID, INTEGER, "UserRole", "UserAccountStatus", UUID, TEXT, TEXT, TEXT, BOOLEAN),
  "phase7_list_sso_account_erasures"(INTEGER, "AdminAuditEnvironment"),
  "phase7_owned_sign_out"(TEXT),
  "phase7_prepare_reauthentication"(TEXT, UUID, UUID, "AdminAuditEnvironment", UUID),
  "phase7_prepare_sso_account_fresh"(TEXT, TEXT),
  "phase7_prepare_sso_account_link"(TEXT, TEXT, TEXT),
  "phase7_prepare_sso_admin_fresh"(TEXT, TEXT),
  "phase7_reconcile_reauthentication"(UUID, TEXT),
  "phase7_reconcile_sso_admin_fresh"(TEXT, TEXT),
  "phase7_record_sso_provider_cleanup"(UUID, TEXT, TEXT, UUID, "AdminAuditEnvironment"),
  "phase7_redact_expired_report_descriptions"(INTEGER, "AdminAuditEnvironment"),
  "phase7_refresh_current_remembered_session"(TEXT),
  "phase7_refresh_remembered_session"(TEXT, INTEGER, "UserRole", "UserAccountStatus"),
  "phase7_request_sso_account_erasure"(TEXT, TEXT, TEXT),
  "phase7_resolve_sso_identity"(TEXT, TEXT, TEXT, TEXT),
  "phase7_sso_account_capabilities"(TEXT, TEXT[], TEXT),
  "phase7_sso_account_erasure_status"(TEXT),
  "phase7_stage_reauthentication_session"(UUID, UUID, TEXT, UUID, TIMESTAMPTZ, TEXT, TEXT),
  "phase7_stage_sso_account_fresh_proof"(JSONB, TEXT, TEXT, TEXT, TEXT),
  "phase7_stage_sso_admin_fresh_proof"(JSONB, TEXT, TEXT, TEXT, TEXT),
  "phase7_unlink_sso_account"(TEXT, TEXT, TEXT[], TEXT)
TO "nihongo_app";
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
