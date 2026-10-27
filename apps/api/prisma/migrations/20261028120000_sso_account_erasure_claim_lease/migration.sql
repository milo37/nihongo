-- Forward-only provider-revoke lease and direct-erase fencing; applied migrations stay immutable.
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
    RAISE EXCEPTION 'Erasure lease migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";


-- A lease, not a lock, spans remote provider calls: concurrent one-shots skip
-- unexpired claims so one provider revoke is attempted by one worker at a time.
ALTER TABLE "SsoAccountErasureRequest" ADD COLUMN "leaseExpiresAt" TIMESTAMPTZ(3);

-- The direct erase facade predates provider-first erasure. It is renamed so the
-- worker loses it, and its public name becomes a TEST-only cleanup facade.
ALTER FUNCTION "phase7_erase_user"(UUID,"AdminAuditEnvironment") RENAME TO "phase7_erase_user_unchecked";
REVOKE ALL ON FUNCTION "phase7_erase_user_unchecked"(UUID,"AdminAuditEnvironment")
 FROM PUBLIC,"nihongo_app","nihongo_auth_gateway","nihongo_erasure_worker";

CREATE FUNCTION "phase7_erase_user"(
 target_user_id UUID,environment_value "AdminAuditEnvironment"
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_erasure_worker');
 IF environment_value IS DISTINCT FROM 'TEST' THEN
  RAISE EXCEPTION 'Direct erasure is TEST-only; use the provider-first erasure queue.' USING ERRCODE='42501';
 END IF;
 RETURN "phase7_erase_user_unchecked"(target_user_id,environment_value);
END;
$function$;

-- Same provider-first completion as the queue migration, bound to the renamed
-- unchecked eraser so it keeps working in every capability environment.
CREATE OR REPLACE FUNCTION "phase7_complete_sso_account_erasure"(
 request_id UUID,environment_value "AdminAuditEnvironment"
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE r "SsoAccountErasureRequest"%ROWTYPE;
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_erasure_worker'); PERFORM "phase7_require_database_capability"(environment_value);
 SELECT * INTO r FROM "SsoAccountErasureRequest" WHERE "id"=request_id;
 IF r."id" IS NULL OR jsonb_array_length(r."providerCleanup")=0
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(r."providerCleanup") x WHERE x->>'status' IS DISTINCT FROM 'COMPLETED') THEN RETURN false; END IF;
 IF r."appStatus"='DELETED' THEN RETURN true; END IF;
 PERFORM 1 FROM "User" WHERE "id"=r."userId" FOR UPDATE;
 SELECT * INTO r FROM "SsoAccountErasureRequest" WHERE "id"=request_id FOR UPDATE;
 IF r."appStatus"='DELETED' THEN RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r."providerCleanup") x WHERE x->>'status' IS DISTINCT FROM 'COMPLETED'); END IF;
 IF r."userId" IS NULL OR jsonb_array_length(r."providerCleanup")=0
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(r."providerCleanup") x WHERE x->>'status' IS DISTINCT FROM 'COMPLETED')
 OR NOT EXISTS(SELECT 1 FROM "User" WHERE "id"=r."userId" AND "accountStatus"='DELETION_PENDING') THEN RETURN false; END IF;
 IF NOT "phase7_erase_user_unchecked"(r."userId",environment_value) THEN RETURN false; END IF;
 UPDATE "SsoAccountErasureRequest" SET "appStatus"='DELETED',"completedAt"=clock_timestamp() WHERE "id"=request_id;
 RETURN true;
END;
$function$;

-- Claims only requests with unfinished provider cleanup. It returns the
-- provider subject as a credential-vault lookup key; tokens never leave the DB here.
CREATE FUNCTION "phase7_claim_sso_provider_cleanups"(
 batch_limit INTEGER,lease_seconds INTEGER,environment_value "AdminAuditEnvironment"
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE result_value JSONB;
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_erasure_worker'); PERFORM "phase7_require_database_capability"(environment_value);
 IF batch_limit IS NULL OR batch_limit NOT BETWEEN 1 AND 100
 OR lease_seconds IS NULL OR lease_seconds NOT BETWEEN 30 AND 3600 THEN
  RAISE EXCEPTION 'Invalid provider cleanup claim.' USING ERRCODE='22023';
 END IF;
 WITH claimed AS (
  UPDATE "SsoAccountErasureRequest" r
  SET "leaseExpiresAt"=clock_timestamp()+pg_catalog.make_interval(secs=>lease_seconds)
  WHERE r."id" IN (
   SELECT c."id" FROM "SsoAccountErasureRequest" c
   WHERE c."appStatus"='DELETION_PENDING'
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(c."providerCleanup") x WHERE x->>'status' IS DISTINCT FROM 'COMPLETED')
    AND (c."leaseExpiresAt" IS NULL OR c."leaseExpiresAt"<=clock_timestamp())
   ORDER BY c."createdAt",c."id" LIMIT batch_limit
   FOR UPDATE SKIP LOCKED
  )
  RETURNING r."id",r."userId",r."providerCleanup",r."createdAt"
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',c."id",
  'providers',coalesce((
   SELECT jsonb_agg(jsonb_build_object('provider',x->>'provider','subject',a."accountId") ORDER BY x->>'provider')
   FROM jsonb_array_elements(c."providerCleanup") x
   LEFT JOIN "Account" a ON a."userId"=c."userId" AND a."providerId"=x->>'provider'
   WHERE x->>'status' IS DISTINCT FROM 'COMPLETED'
  ),'[]'::JSONB)
 ) ORDER BY c."createdAt",c."id"),'[]'::JSONB)
 INTO result_value FROM claimed c;
 RETURN result_value;
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_erase_user"(UUID,"AdminAuditEnvironment"),
 "phase7_claim_sso_provider_cleanups"(INTEGER,INTEGER,"AdminAuditEnvironment")
 FROM PUBLIC,"nihongo_app","nihongo_auth_gateway","nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_erase_user"(UUID,"AdminAuditEnvironment"),
 "phase7_claim_sso_provider_cleanups"(INTEGER,INTEGER,"AdminAuditEnvironment")
 TO "nihongo_erasure_worker";
DO $harden_erasure_lease$
DECLARE target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema',false)::NAME; signature TEXT;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  '"phase7_erase_user"(UUID,"AdminAuditEnvironment")',
  '"phase7_complete_sso_account_erasure"(UUID,"AdminAuditEnvironment")',
  '"phase7_claim_sso_provider_cleanups"(INTEGER,INTEGER,"AdminAuditEnvironment")'
 ] LOOP
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.%s SET search_path TO pg_catalog, %I, pg_temp',target_schema,signature,target_schema);
 END LOOP;
END;
$harden_erasure_lease$;
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
