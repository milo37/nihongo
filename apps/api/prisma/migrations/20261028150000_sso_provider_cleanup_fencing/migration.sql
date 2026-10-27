-- Forward-only provider dispatch and claim-token fencing; applied migrations stay immutable.
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
    RAISE EXCEPTION 'Erasure fencing migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

-- A dispatched call with an unknown outcome must never be retried merely
-- because its lease expired. The marker survives worker death and cancellation.
ALTER TABLE "SsoAccountErasureRequest"
 ADD COLUMN "leaseToken" UUID,
 ADD COLUMN "activeProvider" TEXT CHECK ("activeProvider" IN ('apple','google'));

CREATE OR REPLACE FUNCTION "phase7_claim_sso_provider_cleanups"(
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
  SET "leaseToken"=gen_random_uuid(),"leaseExpiresAt"=clock_timestamp()+pg_catalog.make_interval(secs=>lease_seconds)
  WHERE r."id" IN (
   SELECT c."id" FROM "SsoAccountErasureRequest" c
   WHERE c."appStatus"='DELETION_PENDING'
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(c."providerCleanup") x WHERE x->>'status' IS DISTINCT FROM 'COMPLETED')
    AND c."activeProvider" IS NULL
    -- Legacy claims have no token and may already have dispatched: quarantine.
    AND (c."leaseExpiresAt" IS NULL
      OR (c."leaseToken" IS NOT NULL AND c."leaseExpiresAt"<=clock_timestamp()))
   ORDER BY c."createdAt",c."id" LIMIT batch_limit
   FOR UPDATE SKIP LOCKED
  )
  RETURNING r."leaseToken",r."id",r."userId",r."providerCleanup",r."createdAt"
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',c."id",'leaseToken',c."leaseToken",
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

-- The old recorder cannot prove ownership; keep its historical body but
-- remove every runtime route to it (including the original 3-argument overload).
REVOKE ALL ON FUNCTION "phase7_record_sso_provider_cleanup"(UUID,TEXT,TEXT),
 "phase7_record_sso_provider_cleanup"(UUID,TEXT,TEXT,"AdminAuditEnvironment")
 FROM PUBLIC,"nihongo_app","nihongo_auth_gateway","nihongo_erasure_worker";

CREATE FUNCTION "phase7_begin_sso_provider_cleanup"(
 request_id UUID,provider_value TEXT,lease_token UUID,
 environment_value "AdminAuditEnvironment"
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE r "SsoAccountErasureRequest"%ROWTYPE;
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_erasure_worker'); PERFORM "phase7_require_database_capability"(environment_value);
 SELECT * INTO r FROM "SsoAccountErasureRequest" WHERE "id"=request_id FOR UPDATE;
 IF r."id" IS NULL OR r."appStatus" IS DISTINCT FROM 'DELETION_PENDING'
 OR lease_token IS NULL OR r."leaseToken" IS DISTINCT FROM lease_token
 OR r."leaseExpiresAt" IS NULL OR r."leaseExpiresAt"<=clock_timestamp()
 OR r."activeProvider" IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r."providerCleanup") x
  WHERE x->>'provider'=provider_value AND x->>'status' IS DISTINCT FROM 'COMPLETED') THEN RETURN false; END IF;
 UPDATE "SsoAccountErasureRequest" SET "activeProvider"=provider_value
 WHERE "id"=request_id AND "leaseExpiresAt">clock_timestamp();
 RETURN FOUND;
END;
$function$;

CREATE FUNCTION "phase7_record_sso_provider_cleanup"(
 request_id UUID,provider_value TEXT,status_value TEXT,lease_token UUID,
 environment_value "AdminAuditEnvironment"
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE r "SsoAccountErasureRequest"%ROWTYPE;
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_erasure_worker'); PERFORM "phase7_require_database_capability"(environment_value);
 IF provider_value IS NULL OR provider_value NOT IN ('apple','google')
 OR status_value IS NULL OR status_value NOT IN ('COMPLETED','FAILED','UNAVAILABLE') THEN RETURN false; END IF;
 SELECT * INTO r FROM "SsoAccountErasureRequest" WHERE "id"=request_id FOR UPDATE;
 -- Check the live clock after lock acquisition, never the transaction start.
 IF r."id" IS NULL OR r."appStatus" IS DISTINCT FROM 'DELETION_PENDING'
 OR lease_token IS NULL OR r."leaseToken" IS DISTINCT FROM lease_token
 OR r."leaseExpiresAt" IS NULL OR r."leaseExpiresAt"<=clock_timestamp()
 OR r."activeProvider" IS DISTINCT FROM provider_value THEN RETURN false; END IF;
 UPDATE "SsoAccountErasureRequest" SET
 "providerCleanup"=CASE WHEN status_value='UNAVAILABLE' THEN r."providerCleanup" ELSE (
  SELECT jsonb_agg(CASE WHEN x->>'provider'=provider_value THEN jsonb_set(x,'{status}',to_jsonb(status_value)) ELSE x END ORDER BY x->>'provider')
  FROM jsonb_array_elements(r."providerCleanup") x
 ) END,
 -- FAILED may mean the remote server processed a request whose reply was lost.
 -- UNAVAILABLE is permitted only when the adapter sent no provider request.
 "activeProvider"=CASE WHEN status_value IN ('COMPLETED','UNAVAILABLE') THEN NULL ELSE r."activeProvider" END
 WHERE "id"=request_id AND "leaseToken"=lease_token AND "leaseExpiresAt">clock_timestamp();
 RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_begin_sso_provider_cleanup"(UUID,TEXT,UUID,"AdminAuditEnvironment"),
 "phase7_record_sso_provider_cleanup"(UUID,TEXT,TEXT,UUID,"AdminAuditEnvironment")
 FROM PUBLIC,"nihongo_app","nihongo_auth_gateway","nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_begin_sso_provider_cleanup"(UUID,TEXT,UUID,"AdminAuditEnvironment"),
 "phase7_record_sso_provider_cleanup"(UUID,TEXT,TEXT,UUID,"AdminAuditEnvironment")
 TO "nihongo_erasure_worker";
DO $harden_erasure_fencing$
DECLARE target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema',false)::NAME; signature TEXT;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  '"phase7_claim_sso_provider_cleanups"(INTEGER,INTEGER,"AdminAuditEnvironment")',
  '"phase7_begin_sso_provider_cleanup"(UUID,TEXT,UUID,"AdminAuditEnvironment")',
  '"phase7_record_sso_provider_cleanup"(UUID,TEXT,TEXT,UUID,"AdminAuditEnvironment")'
 ] LOOP
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.%s SET search_path TO pg_catalog, %I, pg_temp',target_schema,signature,target_schema);
 END LOOP;
END;
$harden_erasure_fencing$;
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
