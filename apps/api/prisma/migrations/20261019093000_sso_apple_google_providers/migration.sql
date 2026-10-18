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
SELECT pg_catalog.set_config('search_path', 'pg_catalog, ' ||
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

ALTER TABLE "SsoLoginTransaction" DROP CONSTRAINT "SsoLoginTransaction_provider_check";
ALTER TABLE "SsoLoginTransaction" ADD CONSTRAINT "SsoLoginTransaction_provider_check"
  CHECK ("provider" IN ('apple', 'google'));

CREATE FUNCTION "phase7_create_sso_transaction_v2"(
  provider_id TEXT,
  state_digest TEXT, binding_digest TEXT, nonce_value TEXT,
  verifier_value TEXT, callback_value TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE event_time TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_runtime_ready"();
  IF provider_id IS NULL OR provider_id NOT IN ('apple', 'google')
    OR state_digest IS NULL OR state_digest !~ '^[0-9a-f]{64}$'
    OR binding_digest IS NULL OR binding_digest !~ '^[0-9a-f]{64}$'
    OR nonce_value IS NULL OR nonce_value !~ '^[A-Za-z0-9_-]{43}$'
    OR verifier_value IS NULL OR verifier_value !~ '^[A-Za-z0-9_-]{86}$'
    OR callback_value IS NULL OR char_length(callback_value) > 2048
    OR left(callback_value, 1) <> '/' OR left(callback_value, 2) = '//'
  THEN RETURN false; END IF;
  DELETE FROM "SsoLoginTransaction" WHERE "expiresAt" <= event_time;
  INSERT INTO "SsoLoginTransaction" (
    "provider", "stateDigest", "bindingDigest", "nonce", "codeVerifier", "callbackURL",
    "createdAt", "expiresAt"
  ) VALUES (provider_id, state_digest, binding_digest, nonce_value, verifier_value,
    callback_value, event_time, event_time + INTERVAL '10 minutes');
  RETURN true;
END;
$function$;

CREATE FUNCTION "phase7_consume_sso_transaction_v2"(
  provider_id TEXT,
  state_digest TEXT, binding_digest TEXT
) RETURNS TABLE ("provider" TEXT, "nonce" TEXT, "codeVerifier" TEXT, "callbackURL" TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_runtime_ready"();
  -- DELETE RETURNING is one atomic consumption, including concurrent callbacks.
  RETURN QUERY DELETE FROM "SsoLoginTransaction" AS transaction
  WHERE transaction."stateDigest" = state_digest
    AND transaction."bindingDigest" = binding_digest
    AND transaction."provider" = provider_id
    AND transaction."expiresAt" > clock_timestamp()
  RETURNING transaction."provider"::TEXT, transaction."nonce"::TEXT, transaction."codeVerifier"::TEXT,
    transaction."callbackURL"::TEXT;
END;
$function$;
REVOKE ALL ON FUNCTION "phase7_create_sso_transaction_v2"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),
  "phase7_consume_sso_transaction_v2"(TEXT,TEXT,TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_create_sso_transaction_v2"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),
  "phase7_consume_sso_transaction_v2"(TEXT,TEXT,TEXT) TO "nihongo_auth_gateway";
REVOKE EXECUTE ON FUNCTION "phase7_create_sso_transaction"(TEXT,TEXT,TEXT,TEXT,TEXT),
  "phase7_consume_sso_transaction"(TEXT,TEXT) FROM "nihongo_auth_gateway";
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
