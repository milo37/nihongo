-- Forward-only erasure worker queue and completion guard; applied migrations stay immutable.
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
    RAISE EXCEPTION 'Erasure queue migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

-- Runtime selection still requires exact target proof and a matching persisted
-- capability; adding the enum alone grants no production authority.
ALTER TYPE "AdminAuditEnvironment" ADD VALUE IF NOT EXISTS 'PRODUCTION';

-- The worker role has no table access; this returns only ids and statuses,
-- never user ids, receipts, or provider credentials.
CREATE FUNCTION "phase7_list_sso_account_erasures"(
 batch_limit INTEGER, environment_value "AdminAuditEnvironment"
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE result_value JSONB;
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_erasure_worker'); PERFORM "phase7_require_database_capability"(environment_value);
 IF batch_limit IS NULL OR batch_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid erasure batch limit.' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',q."id",'appStatus',q."appStatus",'providerCleanup',q."providerCleanup") ORDER BY q.pending DESC,q."createdAt",q."id"),'[]'::JSONB)
 INTO result_value FROM (
  SELECT r."id",r."appStatus",r."providerCleanup",r."createdAt",r."appStatus"='DELETION_PENDING' AS pending
  FROM "SsoAccountErasureRequest" r
  WHERE r."appStatus"='DELETION_PENDING'
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(r."providerCleanup") x WHERE x->>'status' IS DISTINCT FROM 'COMPLETED')
  ORDER BY r."appStatus"='DELETION_PENDING' DESC,r."createdAt",r."id" LIMIT batch_limit
 ) q;
 RETURN result_value;
END;
$function$;

-- Cleanup results are environment-bound and may only advance while app data
-- is pending deletion. COMPLETED is terminal, so late retries cannot regress
-- an already accepted provider result or a DELETED request.
CREATE FUNCTION "phase7_record_sso_provider_cleanup"(
 request_id UUID,provider_value TEXT,status_value TEXT,
 environment_value "AdminAuditEnvironment"
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE r "SsoAccountErasureRequest"%ROWTYPE; current_status TEXT;
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_erasure_worker'); PERFORM "phase7_require_database_capability"(environment_value);
 IF provider_value IS NULL OR provider_value NOT IN ('apple','google')
 OR status_value IS NULL OR status_value NOT IN ('COMPLETED','FAILED') THEN RETURN false; END IF;
 SELECT * INTO r FROM "SsoAccountErasureRequest" WHERE "id"=request_id FOR UPDATE;
 IF r."id" IS NULL OR r."appStatus" IS DISTINCT FROM 'DELETION_PENDING' THEN RETURN false; END IF;
 SELECT x->>'status' INTO current_status FROM jsonb_array_elements(r."providerCleanup") x WHERE x->>'provider'=provider_value;
 IF current_status IS NULL THEN RETURN false; END IF;
 IF current_status='COMPLETED' THEN RETURN status_value='COMPLETED'; END IF;
 UPDATE "SsoAccountErasureRequest" SET "providerCleanup"=(
  SELECT jsonb_agg(CASE WHEN x->>'provider'=provider_value THEN jsonb_set(x,'{status}',to_jsonb(status_value)) ELSE x END ORDER BY x->>'provider')
  FROM jsonb_array_elements(r."providerCleanup") x
 ) WHERE "id"=request_id;
 RETURN FOUND;
END;
$function$;

-- Provider cleanup must be recorded before app data is destroyed. The request
-- row is re-read under lock so a concurrent status update cannot cross erasure.
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
 IF NOT "phase7_erase_user"(r."userId",environment_value) THEN RETURN false; END IF;
 UPDATE "SsoAccountErasureRequest" SET "appStatus"='DELETED',"completedAt"=clock_timestamp() WHERE "id"=request_id;
 RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_list_sso_account_erasures"(INTEGER,"AdminAuditEnvironment")
 FROM PUBLIC,"nihongo_app","nihongo_auth_gateway","nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_record_sso_provider_cleanup"(UUID,TEXT,TEXT)
 FROM PUBLIC,"nihongo_app","nihongo_auth_gateway","nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_record_sso_provider_cleanup"(UUID,TEXT,TEXT,"AdminAuditEnvironment")
 FROM PUBLIC,"nihongo_app","nihongo_auth_gateway","nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_list_sso_account_erasures"(INTEGER,"AdminAuditEnvironment") TO "nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_record_sso_provider_cleanup"(UUID,TEXT,TEXT,"AdminAuditEnvironment") TO "nihongo_erasure_worker";
DO $harden_erasure_queue$
DECLARE target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema',false)::NAME; signature TEXT;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  '"phase7_list_sso_account_erasures"(INTEGER,"AdminAuditEnvironment")',
  '"phase7_record_sso_provider_cleanup"(UUID,TEXT,TEXT,"AdminAuditEnvironment")',
  '"phase7_complete_sso_account_erasure"(UUID,"AdminAuditEnvironment")'
 ] LOOP
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.%s SET search_path TO pg_catalog, %I, pg_temp',target_schema,signature,target_schema);
 END LOOP;
END;
$harden_erasure_queue$;
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
