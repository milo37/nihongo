-- ADMIN_FRESH is a separate, provider-bound purpose. LOGIN v2 is unchanged.
-- User-confirmed Apple and Google only; preserve the prior migration.
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

-- Lock User before private-table DDL, matching the native erase lock order.
-- EXCLUSIVE also excludes SELECT FOR UPDATE/KEY SHARE holders and User DML,
-- so an erase cannot commit between orphan backfill and FK validation.
LOCK TABLE "User" IN EXCLUSIVE MODE;

-- Normalize private context ownership so the existing trusted User erasure
-- path cascades the complete row, including provider subject/session context.
-- Only orphaned contexts whose User no longer exists are removed on upgrade;
-- rows belonging to an existing User are backfilled without changing context.
ALTER TABLE "SsoAdminFreshTransaction" ADD COLUMN "userId" UUID;
ALTER TABLE "SsoAdminFreshProof" ADD COLUMN "userId" UUID;
-- Malformed/missing/non-string identities are ephemeral invalid context,
-- not another User's row. No UUID cast is evaluated until shape is proven.
DELETE FROM "SsoAdminFreshTransaction" AS context_row
 WHERE jsonb_typeof(context_row."context"->'userId') IS DISTINCT FROM 'string'
    OR (context_row."context"->>'userId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
DELETE FROM "SsoAdminFreshTransaction" AS context_row
 WHERE NOT EXISTS (SELECT 1 FROM "User" AS actor
   WHERE actor."id" = CASE
     WHEN jsonb_typeof(context_row."context"->'userId') = 'string'
      AND (context_row."context"->>'userId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     THEN (context_row."context"->>'userId')::UUID END);
UPDATE "SsoAdminFreshTransaction" SET "userId" = CASE
 WHEN jsonb_typeof("context"->'userId') = 'string'
  AND ("context"->>'userId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN ("context"->>'userId')::UUID END;
ALTER TABLE "SsoAdminFreshTransaction" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "SsoAdminFreshTransaction"
 ADD CONSTRAINT "SsoAdminFreshTransaction_user_context_check"
 CHECK ("userId" IS NOT DISTINCT FROM ("context"->>'userId')::UUID),
 ADD CONSTRAINT "SsoAdminFreshTransaction_userId_fkey"
 FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
CREATE INDEX "SsoAdminFreshTransaction_userId_idx" ON "SsoAdminFreshTransaction"("userId");
-- Malformed/missing/non-string identities are ephemeral invalid context,
-- not another User's row. No UUID cast is evaluated until shape is proven.
DELETE FROM "SsoAdminFreshProof" AS context_row
 WHERE jsonb_typeof(context_row."context"->'userId') IS DISTINCT FROM 'string'
    OR (context_row."context"->>'userId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
DELETE FROM "SsoAdminFreshProof" AS context_row
 WHERE NOT EXISTS (SELECT 1 FROM "User" AS actor
   WHERE actor."id" = CASE
     WHEN jsonb_typeof(context_row."context"->'userId') = 'string'
      AND (context_row."context"->>'userId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     THEN (context_row."context"->>'userId')::UUID END);
UPDATE "SsoAdminFreshProof" SET "userId" = CASE
 WHEN jsonb_typeof("context"->'userId') = 'string'
  AND ("context"->>'userId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN ("context"->>'userId')::UUID END;
ALTER TABLE "SsoAdminFreshProof" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "SsoAdminFreshProof"
 ADD CONSTRAINT "SsoAdminFreshProof_user_context_check"
 CHECK ("userId" IS NOT DISTINCT FROM ("context"->>'userId')::UUID),
 ADD CONSTRAINT "SsoAdminFreshProof_userId_fkey"
 FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
CREATE INDEX "SsoAdminFreshProof_userId_idx" ON "SsoAdminFreshProof"("userId");

CREATE OR REPLACE FUNCTION "phase7_create_sso_admin_fresh_transaction"(
  provider_value TEXT, state_digest TEXT, binding_digest TEXT, nonce_value TEXT,
  verifier_value TEXT, callback_value TEXT, context_value JSONB
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE expiry TIMESTAMPTZ(3); event_time TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
  IF provider_value IS DISTINCT FROM context_value->>'provider'
    OR NOT "phase7_sso_fresh_context_valid"(context_value)
    OR callback_value IS NULL OR left(callback_value,1) <> '/' OR left(callback_value,2) = '//' THEN RETURN false; END IF;
  SELECT "expiresAt" INTO expiry FROM "Phase7ReauthenticationIntent" WHERE "id" = (context_value->>'intentId')::UUID;
  DELETE FROM "SsoAdminFreshTransaction" WHERE "expiresAt" <= event_time;
  DELETE FROM "SsoAdminFreshProof" WHERE "expiresAt" <= event_time;
  INSERT INTO "SsoAdminFreshTransaction"("userId","provider","stateDigest","bindingDigest","nonce","codeVerifier","callbackURL","context","createdAt","expiresAt")
    VALUES((context_value->>'userId')::UUID,provider_value,state_digest,binding_digest,nonce_value,verifier_value,callback_value,context_value,event_time,least(expiry,event_time + INTERVAL '2 minutes'));
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION "phase7_stage_sso_admin_fresh_proof"(context_value JSONB, provider_value TEXT, subject_value TEXT, proof_digest TEXT, callback_value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE expiry TIMESTAMPTZ(3); event_time TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
  PERFORM 1 FROM "User" WHERE "id" = (context_value->>'userId')::UUID FOR UPDATE;
  IF provider_value IS DISTINCT FROM context_value->>'provider' OR subject_value IS DISTINCT FROM context_value->>'accountId'
    OR NOT "phase7_sso_fresh_context_valid"(context_value) OR callback_value IS NULL OR left(callback_value,1) <> '/' OR left(callback_value,2) = '//' THEN RETURN false; END IF;
  SELECT "expiresAt" INTO expiry FROM "Phase7ReauthenticationIntent" WHERE "id" = (context_value->>'intentId')::UUID;
  INSERT INTO "SsoAdminFreshProof"("userId","proofDigest","context","callbackURL","createdAt","expiresAt")
    VALUES((context_value->>'userId')::UUID,proof_digest,context_value,callback_value,event_time,least(expiry,event_time + INTERVAL '2 minutes'));
  RETURN true;
END;
$function$;

-- Replacement retains signatures, ownership and the original gateway-only ACL.
REVOKE ALL ON TABLE "SsoAdminFreshTransaction", "SsoAdminFreshProof"
 FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_create_sso_admin_fresh_transaction"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB),
 "phase7_stage_sso_admin_fresh_proof"(JSONB,TEXT,TEXT,TEXT,TEXT)
 FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_create_sso_admin_fresh_transaction"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB),
 "phase7_stage_sso_admin_fresh_proof"(JSONB,TEXT,TEXT,TEXT,TEXT)
 TO "nihongo_auth_gateway";
-- Restore the exact runtime contract for every created/replaced definer.
DO $harden_sso_functions$
DECLARE
  target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema', false)::NAME;
  function_signature TEXT;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    '"phase7_create_sso_admin_fresh_transaction"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)',
    '"phase7_stage_sso_admin_fresh_proof"(JSONB,TEXT,TEXT,TEXT,TEXT)'
  ] LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %I.%s SET search_path TO pg_catalog, %I, pg_temp',
      target_schema, function_signature, target_schema);
  END LOOP;
END;
$harden_sso_functions$;
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
