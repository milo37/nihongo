-- Qualify table columns independently of PL/pgSQL output parameter names.
-- Preserve prior migrations and the complete function contract, owner and ACL.
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
    RAISE EXCEPTION 'SSO migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
-- Keep the creation namespace on the owned target; pg_catalog is implicit first.
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

CREATE OR REPLACE FUNCTION "phase7_complete_sso_admin_fresh"(proof_digest TEXT,raw_old_token TEXT,new_session_id UUID,raw_new_token TEXT,ip_value TEXT,agent_value TEXT)
RETURNS TABLE("id" UUID,"familyId" UUID,"createdAt" TIMESTAMPTZ,"expiresAt" TIMESTAMPTZ,"authorityGeneration" INTEGER,"userId" UUID,"callbackURL" TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE proof "SsoAdminFreshProof"%ROWTYPE; staged_id UUID; replacement RECORD; expected_user_id UUID; intent_id UUID;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
  SELECT * INTO proof FROM "SsoAdminFreshProof" WHERE "proofDigest" = proof_digest;
  IF proof."proofDigest" IS NULL OR proof."completedSessionId" IS NOT NULL THEN RETURN; END IF;
  expected_user_id := (proof."context"->>'userId')::UUID;
  intent_id := (proof."context"->>'intentId')::UUID;
  PERFORM 1 FROM "User" AS target_user WHERE target_user."id" = expected_user_id FOR UPDATE;
  SELECT * INTO proof FROM "SsoAdminFreshProof" WHERE "proofDigest" = proof_digest FOR UPDATE;
  IF proof."proofDigest" IS NULL OR proof."completedSessionId" IS NOT NULL OR proof."expiresAt" <= clock_timestamp()
    OR NOT "phase7_sso_fresh_context_valid"(proof."context") OR NOT EXISTS (
      SELECT 1 FROM "Session" AS old_session WHERE old_session."id" = (proof."context"->>'sessionId')::UUID AND old_session."userId" = expected_user_id AND old_session."token" = raw_old_token
    ) THEN RETURN; END IF;
  -- Staging, exact old-session CAS, rotation fence, audit, and confirmation are
  -- one database statement/transaction. Any exception rolls them all back.
  SELECT result."id" INTO staged_id FROM "phase7_stage_reauthentication_session"(
    intent_id,new_session_id,raw_new_token,expected_user_id,clock_timestamp() + INTERVAL '1 day',ip_value,agent_value
  ) AS result;
  IF staged_id IS DISTINCT FROM new_session_id THEN RAISE EXCEPTION 'SSO staging rejected.' USING ERRCODE='42501'; END IF;
  SELECT * INTO replacement FROM "phase7_finalize_reauthentication"(intent_id,raw_new_token);
  IF replacement."id" IS DISTINCT FROM new_session_id OR NOT "phase7_confirm_v1_session_issuance"(
    raw_new_token,new_session_id,expected_user_id,(proof."context"->>'authorityGeneration')::INTEGER,'ADMIN','ACTIVE'
  ) THEN RAISE EXCEPTION 'SSO rotation confirmation rejected.' USING ERRCODE='42501'; END IF;
  UPDATE "SsoAdminFreshProof" SET "completedSessionId" = new_session_id,"completedAt" = replacement."createdAt",
    "expiresAt" = least(replacement."createdAt" + INTERVAL '5 minutes',replacement."expiresAt") WHERE "proofDigest" = proof_digest;
  RETURN QUERY SELECT replacement."id"::UUID,replacement."familyId"::UUID,replacement."createdAt"::TIMESTAMPTZ,replacement."expiresAt"::TIMESTAMPTZ,
    replacement."authorityGeneration"::INTEGER,expected_user_id,proof."callbackURL"::TEXT;
END;
$function$;

-- CREATE OR REPLACE preserves the existing owner and function privileges.
-- Restore the exact hardened search_path of the existing complete function.
DO $harden_sso_function$
DECLARE
  target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema', false)::NAME;
BEGIN
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %I."phase7_complete_sso_admin_fresh"(TEXT,TEXT,UUID,TEXT,TEXT,TEXT) SET search_path TO pg_catalog, %I, pg_temp',
    target_schema, target_schema);
END;
$harden_sso_function$;
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
