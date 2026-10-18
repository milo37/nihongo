-- Forward-only SSO identity mapping; existing IDs, credentials and domain FKs are preserved.
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

CREATE OR REPLACE FUNCTION "validate_phase7_credential_totality"()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE target_user_id UUID; changed_row JSONB; legacy_disabled BOOLEAN;
BEGIN
  changed_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  target_user_id := CASE WHEN TG_TABLE_NAME = 'User' THEN (changed_row ->> 'id')::UUID ELSE (changed_row ->> 'userId')::UUID END;
  -- Serialize deferred checks for every mutation of the same User. Two
  -- concurrent removals must not each count the other uncommitted provider.
  PERFORM 1 FROM "User" WHERE "id" = target_user_id FOR UPDATE;
  SELECT "legacyIssuerDisabled" INTO legacy_disabled FROM "AuthIssuerActivation" WHERE "id" = 1;
  IF legacy_disabled AND EXISTS (SELECT 1 FROM "User" WHERE "id" = target_user_id) THEN
    IF NOT EXISTS (SELECT 1 FROM "Account" WHERE "userId" = target_user_id AND "providerId" IN ('credential','apple','google')) THEN
      RAISE EXCEPTION 'Activated auth requires a sign-in Account.' USING ERRCODE = '23514';
    END IF;
    -- A retained legacy password never permits unlinking the last SSO identity.
    IF TG_TABLE_NAME = 'Account' AND TG_OP = 'DELETE'
      AND changed_row ->> 'providerId' IN ('apple','google')
      AND NOT EXISTS (SELECT 1 FROM "Account" WHERE "userId" = target_user_id AND "providerId" IN ('apple','google')) THEN
      RAISE EXCEPTION 'Last SSO sign-in method cannot be removed.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE FUNCTION "phase7_resolve_sso_identity"(
  provider_id TEXT, provider_subject TEXT, contact_email TEXT, display_name TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE target_user "User"%ROWTYPE; target_id UUID; event_time TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_runtime_ready"();
  IF provider_id IS NULL OR provider_id NOT IN ('apple','google')
    OR provider_subject IS NULL OR char_length(provider_subject) NOT BETWEEN 1 AND 255
    OR contact_email IS NULL OR char_length(contact_email) NOT BETWEEN 3 AND 320
    OR display_name IS NULL OR char_length(display_name) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'Malformed verified SSO identity.' USING ERRCODE = '22023';
  END IF;
  -- Serialize the exact provider/sub pair; unique(providerId,accountId) remains authoritative.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('nihongo:sso:' || provider_id || ':' || provider_subject, 0));
  SELECT account."userId" INTO target_id FROM "Account" AS account
    WHERE account."providerId" = provider_id AND account."accountId" = provider_subject;
  IF target_id IS NULL THEN
    -- Email is contact data, never proof for merging or inheriting ADMIN authority.
    IF EXISTS (SELECT 1 FROM "User" WHERE lower("email") = lower(contact_email)) THEN
      RETURN jsonb_build_object('outcome','TRANSITION_REQUIRED');
    END IF;
    target_id := public.gen_random_uuid();
    BEGIN
      INSERT INTO "User" ("id","name","email","emailVerified","role","accountStatus","authorityGeneration","createdAt","updatedAt")
      VALUES (target_id,display_name,lower(contact_email),true,'USER','ACTIVE',1,event_time,event_time);
      INSERT INTO "Account" ("id","accountId","providerId","userId","createdAt","updatedAt")
      VALUES (public.gen_random_uuid(),provider_subject,provider_id,target_id,event_time,event_time);
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('outcome','IDENTITY_CONFLICT');
    END;
  END IF;
  SELECT * INTO target_user FROM "User" WHERE "id" = target_id FOR UPDATE;
  IF target_user."id" IS NULL OR target_user."accountStatus" <> 'ACTIVE' OR target_user."deletedAt" IS NOT NULL THEN
    RETURN jsonb_build_object('outcome','ACCOUNT_UNAVAILABLE');
  END IF;
  RETURN jsonb_build_object('outcome','RESOLVED','userId',target_user."id",'authorityGeneration',target_user."authorityGeneration",'role',target_user."role",'accountStatus',target_user."accountStatus");
END;
$function$;
REVOKE ALL ON FUNCTION "phase7_resolve_sso_identity"(TEXT,TEXT,TEXT,TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_resolve_sso_identity"(TEXT,TEXT,TEXT,TEXT) TO "nihongo_auth_gateway";
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
