-- Forward-only member SSO account lifecycle; original45 and ADMIN_FRESH remain unchanged.
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


CREATE TABLE "SsoAccountFreshTransaction" (
  "stateDigest" VARCHAR(64) PRIMARY KEY CHECK ("stateDigest" ~ '^[0-9a-f]{64}$'),
  "bindingDigest" VARCHAR(64) NOT NULL CHECK ("bindingDigest" ~ '^[0-9a-f]{64}$'),
  "provider" VARCHAR(32) NOT NULL CHECK ("provider" IN ('apple','google')),
  "nonce" VARCHAR(43) NOT NULL CHECK ("nonce" ~ '^[A-Za-z0-9_-]{43}$'),
  "codeVerifier" VARCHAR(86) NOT NULL CHECK ("codeVerifier" ~ '^[A-Za-z0-9_-]{86}$'),
  "callbackURL" VARCHAR(2048) NOT NULL,
  "context" JSONB NOT NULL CHECK (jsonb_typeof("context") = 'object'),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CHECK ("userId" = ("context"->>'userId')::UUID),
  CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '2 minutes')
);
CREATE INDEX "SsoAccountFreshTransaction_expiresAt_idx" ON "SsoAccountFreshTransaction"("expiresAt");
CREATE TABLE "SsoAccountFreshProof" (
  "proofDigest" VARCHAR(64) PRIMARY KEY CHECK ("proofDigest" ~ '^[0-9a-f]{64}$'),
  "context" JSONB NOT NULL CHECK (jsonb_typeof("context") = 'object'),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "callbackURL" VARCHAR(2048) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "verifiedAt" TIMESTAMPTZ(3),
  CHECK ("userId" = ("context"->>'userId')::UUID),
  CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '7 minutes')
);
CREATE INDEX "SsoAccountFreshProof_expiresAt_idx" ON "SsoAccountFreshProof"("expiresAt");
CREATE TABLE "SsoAccountErasureRequest" (
  "id" UUID PRIMARY KEY DEFAULT public.gen_random_uuid(),
  "userId" UUID UNIQUE REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "receiptDigest" VARCHAR(64) NOT NULL UNIQUE CHECK ("receiptDigest" ~ '^[0-9a-f]{64}$'),
  "appStatus" VARCHAR(32) NOT NULL DEFAULT 'DELETION_PENDING' CHECK ("appStatus" IN ('DELETION_PENDING','DELETED')),
  "providerCleanup" JSONB NOT NULL CHECK (jsonb_typeof("providerCleanup") = 'array'),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "receiptExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3),
  CHECK (("appStatus" = 'DELETED') = ("completedAt" IS NOT NULL))
);
CREATE INDEX "SsoAccountErasureRequest_appStatus_createdAt_idx" ON "SsoAccountErasureRequest"("appStatus","createdAt");
REVOKE ALL ON TABLE "SsoAccountFreshTransaction", "SsoAccountFreshProof", "SsoAccountErasureRequest"
 FROM PUBLIC,"nihongo_app","nihongo_auth_gateway","nihongo_erasure_worker";

-- Private projection: no runtime role can enumerate users, subjects or tokens.
CREATE FUNCTION "phase7_sso_account_session"(raw_token TEXT)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path FROM CURRENT AS $function$
 SELECT jsonb_build_object('userId',u."id",'sessionId',s."id",'role',u."role",
   'authorityGeneration',u."authorityGeneration",'tokenDigest',"phase7_reauthentication_token_digest"(s."token"))
 FROM "Session" s JOIN "User" u ON u."id"=s."userId"
 JOIN "AuthSessionFamily" f ON f."id"=s."sessionFamilyId" AND f."userId"=u."id"
 WHERE s."token"=raw_token AND s."issuerProtocolVersion"='PHASE7_V1' AND s."authorizationState"='ACTIVE'
 AND s."authorityGeneration"=u."authorityGeneration" AND u."accountStatus"='ACTIVE' AND u."deletedAt" IS NULL
 AND f."status"='ACTIVE' AND f."revokedAt" IS NULL AND s."expiresAt">clock_timestamp()
 AND s."createdAt"+INTERVAL '30 days'>clock_timestamp();
$function$;
CREATE FUNCTION "phase7_sso_account_context_valid"(context_value JSONB,raw_token TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE captured_token TEXT;
BEGIN
 SELECT s."token" INTO captured_token FROM "Session" s JOIN "User" u ON u."id"=s."userId"
 JOIN "AuthSessionFamily" f ON f."id"=s."sessionFamilyId" AND f."userId"=u."id"
 WHERE u."id"=(context_value->>'userId')::UUID AND s."id"=(context_value->>'sessionId')::UUID
 AND u."role"::TEXT=context_value->>'role' AND u."authorityGeneration"=(context_value->>'authorityGeneration')::INTEGER
 AND "phase7_reauthentication_token_digest"(s."token")=context_value->>'tokenDigest'
 AND (raw_token IS NULL OR s."token"=raw_token) AND context_value->>'provider' IN ('apple','google')
 AND s."issuerProtocolVersion"='PHASE7_V1' AND s."authorizationState"='ACTIVE'
 AND s."authorityGeneration"=u."authorityGeneration" AND u."accountStatus"='ACTIVE' AND u."deletedAt" IS NULL
 AND f."status"='ACTIVE' AND f."revokedAt" IS NULL AND s."expiresAt">clock_timestamp()
 AND s."createdAt"+INTERVAL '30 days'>clock_timestamp();
 IF captured_token IS NULL THEN RETURN false; END IF;
 IF context_value->>'purpose'='ACCOUNT_FRESH' THEN
  RETURN EXISTS(SELECT 1 FROM "Account" a WHERE a."userId"=(context_value->>'userId')::UUID AND a."providerId"=context_value->>'provider' AND a."accountId"=context_value->>'accountId');
 ELSIF context_value->>'purpose'='ACCOUNT_LINK' THEN
  RETURN "phase7_sso_account_proof_valid"(captured_token,context_value->>'freshProofDigest');
 END IF;
 RETURN false;
END;
$function$;
CREATE FUNCTION "phase7_sso_account_proof_valid"(raw_token TEXT,proof_digest TEXT)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER SET search_path FROM CURRENT AS $function$
 SELECT EXISTS (SELECT 1 FROM "SsoAccountFreshProof" p WHERE p."proofDigest"=proof_digest AND p."context"->>'purpose'='ACCOUNT_FRESH'
 AND p."verifiedAt" IS NOT NULL AND p."verifiedAt"+INTERVAL '5 minutes'>clock_timestamp()
 AND p."expiresAt">clock_timestamp() AND "phase7_sso_account_context_valid"(p."context",raw_token));
$function$;
CREATE FUNCTION "phase7_prepare_sso_account_fresh"(raw_token TEXT,provider_value TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE context_value JSONB; subject_value TEXT;
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
 IF provider_value IS NULL OR provider_value NOT IN ('apple','google') THEN RETURN NULL; END IF;
 context_value := "phase7_sso_account_session"(raw_token);
 IF context_value IS NULL THEN RETURN NULL; END IF;
 PERFORM 1 FROM "User" WHERE "id"=(context_value->>'userId')::UUID FOR UPDATE;
 context_value := "phase7_sso_account_session"(raw_token);
 IF context_value IS NULL THEN RETURN NULL; END IF;
 SELECT min("accountId") INTO subject_value FROM "Account"
 WHERE "userId"=(context_value->>'userId')::UUID AND "providerId"=provider_value HAVING count(*)=1;
 IF subject_value IS NULL THEN RETURN NULL; END IF;
 RETURN context_value || jsonb_build_object('purpose','ACCOUNT_FRESH','provider',provider_value,'accountId',subject_value);
END;
$function$;
CREATE FUNCTION "phase7_create_sso_account_fresh_transaction"(provider_value TEXT,state_digest TEXT,binding_digest TEXT,nonce_value TEXT,verifier_value TEXT,callback_value TEXT,context_value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE event_time TIMESTAMPTZ(3):=clock_timestamp();
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
 PERFORM 1 FROM "User" WHERE "id"=(context_value->>'userId')::UUID FOR UPDATE;
 IF provider_value IS DISTINCT FROM context_value->>'provider' OR NOT "phase7_sso_account_context_valid"(context_value)
 OR callback_value IS NULL OR left(callback_value,1)<>'/' OR left(callback_value,2)='//' THEN RETURN false; END IF;
 DELETE FROM "SsoAccountFreshTransaction" WHERE "userId"=(context_value->>'userId')::UUID AND "expiresAt"<=event_time;
 DELETE FROM "SsoAccountFreshProof" WHERE "userId"=(context_value->>'userId')::UUID AND "expiresAt"<=event_time;
 INSERT INTO "SsoAccountFreshTransaction"("provider","stateDigest","bindingDigest","nonce","codeVerifier","callbackURL","context","userId","createdAt","expiresAt")
 VALUES(provider_value,state_digest,binding_digest,nonce_value,verifier_value,callback_value,context_value,(context_value->>'userId')::UUID,event_time,event_time+INTERVAL '2 minutes');
 RETURN true;
END;
$function$;
CREATE FUNCTION "phase7_consume_sso_account_fresh_transaction"(provider_value TEXT,state_digest TEXT,binding_digest TEXT,purpose_value TEXT)
RETURNS TABLE("provider" TEXT,"nonce" TEXT,"codeVerifier" TEXT,"callbackURL" TEXT,"context" JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
 RETURN QUERY DELETE FROM "SsoAccountFreshTransaction" tx WHERE tx."provider"=provider_value
 AND tx."stateDigest"=state_digest AND tx."bindingDigest"=binding_digest AND tx."context"->>'purpose'=purpose_value AND tx."expiresAt">clock_timestamp()
 RETURNING tx."provider"::TEXT,tx."nonce"::TEXT,tx."codeVerifier"::TEXT,tx."callbackURL"::TEXT,tx."context";
END;
$function$;
CREATE FUNCTION "phase7_stage_sso_account_fresh_proof"(context_value JSONB,provider_value TEXT,subject_value TEXT,proof_digest TEXT,callback_value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE event_time TIMESTAMPTZ(3):=clock_timestamp();
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
 PERFORM 1 FROM "User" WHERE "id"=(context_value->>'userId')::UUID FOR UPDATE;
 IF provider_value IS DISTINCT FROM context_value->>'provider' OR (context_value->>'purpose'='ACCOUNT_FRESH' AND subject_value IS DISTINCT FROM context_value->>'accountId') OR subject_value IS NULL OR char_length(subject_value) NOT BETWEEN 1 AND 255
 OR NOT "phase7_sso_account_context_valid"(context_value) OR callback_value IS NULL OR left(callback_value,1)<>'/' OR left(callback_value,2)='//' THEN RETURN false; END IF;
 INSERT INTO "SsoAccountFreshProof"("proofDigest","context","userId","callbackURL","createdAt","expiresAt")
 VALUES(proof_digest,context_value || jsonb_build_object('accountId',subject_value),(context_value->>'userId')::UUID,callback_value,event_time,event_time+INTERVAL '2 minutes');
 RETURN true;
END;
$function$;
CREATE FUNCTION "phase7_complete_sso_account_fresh"(proof_digest TEXT,raw_token TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE p "SsoAccountFreshProof"%ROWTYPE;
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
 SELECT * INTO p FROM "SsoAccountFreshProof" WHERE "proofDigest"=proof_digest;
 IF p."proofDigest" IS NULL THEN RETURN NULL; END IF;
 PERFORM 1 FROM "User" WHERE "id"=p."userId" FOR UPDATE;
 SELECT * INTO p FROM "SsoAccountFreshProof" WHERE "proofDigest"=proof_digest FOR UPDATE;
 IF p."proofDigest" IS NULL OR p."context"->>'purpose' IS DISTINCT FROM 'ACCOUNT_FRESH' OR p."expiresAt"<=clock_timestamp() OR NOT "phase7_sso_account_context_valid"(p."context",raw_token) THEN RETURN NULL; END IF;
 IF p."verifiedAt" IS NULL THEN
  UPDATE "SsoAccountFreshProof" SET "verifiedAt"=clock_timestamp(),"expiresAt"=least("createdAt"+INTERVAL '7 minutes',clock_timestamp()+INTERVAL '5 minutes') WHERE "proofDigest"=proof_digest;
 END IF;
 RETURN p."callbackURL";
END;
$function$;
CREATE FUNCTION "phase7_prepare_sso_account_link"(raw_token TEXT,provider_value TEXT,proof_digest TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE context_value JSONB;
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
 IF provider_value IS NULL OR provider_value NOT IN ('apple','google') THEN RETURN NULL; END IF;
 context_value := "phase7_sso_account_session"(raw_token); IF context_value IS NULL THEN RETURN NULL; END IF;
 PERFORM 1 FROM "User" WHERE "id"=(context_value->>'userId')::UUID FOR UPDATE;
 context_value := "phase7_sso_account_session"(raw_token);
 IF context_value IS NULL OR NOT "phase7_sso_account_proof_valid"(raw_token,proof_digest)
 OR EXISTS(SELECT 1 FROM "Account" WHERE "userId"=(context_value->>'userId')::UUID AND "providerId"=provider_value) THEN RETURN NULL; END IF;
 RETURN context_value || jsonb_build_object('purpose','ACCOUNT_LINK','provider',provider_value,'accountId',NULL,'freshProofDigest',proof_digest);
END;
$function$;
CREATE FUNCTION "phase7_complete_sso_account_link"(proof_digest TEXT,raw_token TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE p "SsoAccountFreshProof"%ROWTYPE; existing_user UUID; actor UUID;
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
 SELECT * INTO p FROM "SsoAccountFreshProof" WHERE "proofDigest"=proof_digest;
 IF p."proofDigest" IS NULL OR p."context"->>'purpose' IS DISTINCT FROM 'ACCOUNT_LINK' OR p."context"->>'accountId' IS NULL THEN RETURN NULL; END IF;
 -- LOGIN uses this exact advisory lock before any User lock too.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('nihongo:sso:' || (p."context"->>'provider') || ':' || (p."context"->>'accountId'),0));
 actor := p."userId"; PERFORM 1 FROM "User" WHERE "id"=actor FOR UPDATE;
 SELECT * INTO p FROM "SsoAccountFreshProof" WHERE "proofDigest"=proof_digest FOR UPDATE;
 IF p."proofDigest" IS NULL OR p."expiresAt"<=clock_timestamp() OR NOT "phase7_sso_account_context_valid"(p."context",raw_token) THEN RETURN NULL; END IF;
 SELECT "userId" INTO existing_user FROM "Account" WHERE "providerId"=p."context"->>'provider' AND "accountId"=p."context"->>'accountId';
 IF existing_user IS NOT NULL OR EXISTS(SELECT 1 FROM "Account" WHERE "userId"=actor AND "providerId"=p."context"->>'provider') THEN RETURN NULL; END IF;
 INSERT INTO "Account"("id","providerId","accountId","userId","createdAt","updatedAt")
 VALUES(public.gen_random_uuid(),p."context"->>'provider',p."context"->>'accountId',actor,clock_timestamp(),clock_timestamp());
 -- Explicit linking preserves User.id/role/generation/domain ownership. The
 -- linked-provider fresh proof is single use and grants no CMS authority.
 DELETE FROM "SsoAccountFreshProof" WHERE "proofDigest" IN (proof_digest,p."context"->>'freshProofDigest');
 RETURN p."callbackURL";
END;
$function$;
CREATE FUNCTION "phase7_sso_account_capabilities"(raw_token TEXT,available_providers TEXT[],proof_digest TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE context_value JSONB; providers_value JSONB; actor UUID; deletion_blocked BOOLEAN;
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
 context_value := "phase7_sso_account_session"(raw_token); IF context_value IS NULL THEN RETURN NULL; END IF;
 actor := (context_value->>'userId')::UUID;
 SELECT coalesce(jsonb_agg(jsonb_build_object('provider',p.provider,'reauthAvailable',p.accounts=1 AND p.provider=ANY(available_providers),
 'canUnlink',EXISTS(SELECT 1 FROM "Account" a WHERE a."userId"=actor AND a."providerId" IN ('apple','google') AND a."providerId"<>p.provider AND a."providerId"=ANY(available_providers)),
 'unlinkBlockedReason',CASE WHEN NOT EXISTS(SELECT 1 FROM "Account" a WHERE a."userId"=actor AND a."providerId" IN ('apple','google') AND a."providerId"<>p.provider) THEN 'LAST_SIGN_IN_METHOD'
 WHEN NOT EXISTS(SELECT 1 FROM "Account" a WHERE a."userId"=actor AND a."providerId" IN ('apple','google') AND a."providerId"<>p.provider AND a."providerId"=ANY(available_providers)) THEN 'PROVIDER_UNAVAILABLE' ELSE NULL END) ORDER BY p.provider),'[]'::JSONB)
 INTO providers_value FROM (SELECT "providerId" AS provider,count(*) AS accounts FROM "Account" WHERE "userId"=actor AND "providerId" IN ('apple','google') GROUP BY "providerId") p;
 SELECT EXISTS(SELECT 1 FROM "QuestionVersion" WHERE "createdByActorId"=actor AND "status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')) INTO deletion_blocked;
 RETURN jsonb_build_object('providers',providers_value,'unlinkRequiresFresh',context_value->>'role'='ADMIN',
 'canDelete',NOT deletion_blocked,'deletionBlockedReason',CASE WHEN deletion_blocked THEN 'OPEN_ADMIN_WORK' ELSE NULL END,
 'linkableProviders',(SELECT coalesce(jsonb_agg(v ORDER BY v),'[]'::JSONB) FROM unnest(available_providers) v WHERE v IN ('apple','google') AND NOT EXISTS(SELECT 1 FROM "Account" a WHERE a."userId"=actor AND a."providerId"=v)),
 'deleteRequiresFresh',true,'freshVerified',"phase7_sso_account_proof_valid"(raw_token,proof_digest));
END;
$function$;
CREATE FUNCTION "phase7_unlink_sso_account"(raw_token TEXT,provider_value TEXT,available_providers TEXT[],proof_digest TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE context_value JSONB; actor UUID; execution_id UUID;
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
 context_value := "phase7_sso_account_session"(raw_token); IF context_value IS NULL THEN RETURN jsonb_build_object('code','AUTHENTICATION_REQUIRED'); END IF;
 actor := (context_value->>'userId')::UUID; PERFORM 1 FROM "User" WHERE "id"=actor FOR UPDATE;
 context_value := "phase7_sso_account_session"(raw_token); IF context_value IS NULL THEN RETURN jsonb_build_object('code','AUTHENTICATION_REQUIRED'); END IF;
 PERFORM 1 FROM "Account" WHERE "userId"=actor ORDER BY "id" FOR UPDATE;
 IF provider_value IS NULL OR provider_value NOT IN ('apple','google') OR NOT EXISTS(SELECT 1 FROM "Account" WHERE "userId"=actor AND "providerId"=provider_value) THEN RETURN jsonb_build_object('code','SSO_ACCOUNT_NOT_LINKED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM "Account" WHERE "userId"=actor AND "providerId" IN ('apple','google') AND "providerId"<>provider_value) THEN RETURN jsonb_build_object('code','SSO_LAST_SIGN_IN_METHOD'); END IF;
 IF NOT EXISTS(SELECT 1 FROM "Account" WHERE "userId"=actor AND "providerId" IN ('apple','google') AND "providerId"<>provider_value AND "providerId"=ANY(available_providers)) THEN RETURN jsonb_build_object('code','SSO_PROVIDER_UNAVAILABLE'); END IF;
 IF context_value->>'role'='ADMIN' AND NOT "phase7_sso_account_proof_valid"(raw_token,proof_digest) THEN RETURN jsonb_build_object('code','SSO_FRESH_REQUIRED'); END IF;
 PERFORM 1 FROM "AuthSessionFamily" WHERE "userId"=actor ORDER BY "id" FOR UPDATE;
 PERFORM 1 FROM "Session" WHERE "userId"=actor ORDER BY "id" FOR UPDATE;
 execution_id := "phase7_open_trusted_execution"('AUTHORITY_CHANGE',actor,NULL);
 PERFORM "phase7_record_authority_revocation"(actor,'SESSION_INVALIDATED');
 DELETE FROM "Account" WHERE "userId"=actor AND "providerId"=provider_value;
 UPDATE "User" SET "authorityGeneration"="authorityGeneration"+1,"updatedAt"=clock_timestamp() WHERE "id"=actor;
 UPDATE "AuthSessionFamily" SET "status"='REVOKED' WHERE "userId"=actor AND "status"='ACTIVE';
 DELETE FROM "Session" WHERE "userId"=actor;
 DELETE FROM "SsoAccountFreshProof" WHERE "userId"=actor;
 DELETE FROM "SsoAccountFreshTransaction" WHERE "userId"=actor;
 PERFORM "phase7_close_trusted_execution"(execution_id);
 RETURN jsonb_build_object('unlinked',true,'sessionRevoked',true);
END;
$function$;
CREATE FUNCTION "phase7_request_sso_account_erasure"(raw_token TEXT,proof_digest TEXT,receipt_digest TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE context_value JSONB; actor UUID; execution_id UUID; cleanup_value JSONB;
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
 context_value := "phase7_sso_account_session"(raw_token); IF context_value IS NULL THEN RETURN jsonb_build_object('code','AUTHENTICATION_REQUIRED'); END IF;
 actor := (context_value->>'userId')::UUID; PERFORM 1 FROM "User" WHERE "id"=actor FOR UPDATE;
 context_value := "phase7_sso_account_session"(raw_token); IF context_value IS NULL THEN RETURN jsonb_build_object('code','AUTHENTICATION_REQUIRED'); END IF;
 IF NOT "phase7_sso_account_proof_valid"(raw_token,proof_digest) THEN RETURN jsonb_build_object('code','SSO_FRESH_REQUIRED'); END IF;
 IF EXISTS(SELECT 1 FROM "QuestionVersion" WHERE "createdByActorId"=actor AND "status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')) THEN RETURN jsonb_build_object('code','SSO_ACCOUNT_DELETION_BLOCKED'); END IF;
 IF receipt_digest IS NULL OR receipt_digest !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid private erasure receipt.' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM "Account" WHERE "userId"=actor ORDER BY "id" FOR UPDATE;
 SELECT coalesce(jsonb_agg(jsonb_build_object('provider',p.provider,'status','PENDING') ORDER BY p.provider),'[]'::JSONB) INTO cleanup_value
 FROM (SELECT DISTINCT "providerId" AS provider FROM "Account" WHERE "userId"=actor AND "providerId" IN ('apple','google')) p;
 INSERT INTO "SsoAccountErasureRequest"("userId","receiptDigest","providerCleanup","receiptExpiresAt") VALUES(actor,receipt_digest,cleanup_value,clock_timestamp()+INTERVAL '1 day');
 execution_id := "phase7_open_trusted_execution"('AUTHORITY_CHANGE',actor,NULL);
 UPDATE "User" SET "accountStatus"='DELETION_PENDING',"updatedAt"=clock_timestamp() WHERE "id"=actor;
 DELETE FROM "SsoAccountFreshProof" WHERE "userId"=actor;
 DELETE FROM "SsoAccountFreshTransaction" WHERE "userId"=actor;
 PERFORM "phase7_close_trusted_execution"(execution_id);
 RETURN jsonb_build_object('appStatus','DELETION_PENDING','providerCleanup',cleanup_value);
END;
$function$;
CREATE FUNCTION "phase7_sso_account_erasure_status"(receipt_digest TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE result_value JSONB;
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
 SELECT jsonb_build_object('appStatus',r."appStatus",'providerCleanup',r."providerCleanup") INTO result_value
 FROM "SsoAccountErasureRequest" r WHERE r."receiptDigest"=receipt_digest AND r."receiptExpiresAt">clock_timestamp();
 RETURN result_value;
END;
$function$;
-- The API can accept self-service requests, but cannot run physical erasure.
-- The existing worker boundary checks the actual approved DB/environment again.
CREATE FUNCTION "phase7_complete_sso_account_erasure"(request_id UUID,environment_value "AdminAuditEnvironment")
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE r "SsoAccountErasureRequest"%ROWTYPE;
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_erasure_worker'); PERFORM "phase7_require_database_capability"(environment_value);
 SELECT * INTO r FROM "SsoAccountErasureRequest" WHERE "id"=request_id;
 IF r."id" IS NULL THEN RETURN false; END IF;
 IF r."appStatus"='DELETED' THEN RETURN true; END IF;
 PERFORM 1 FROM "User" WHERE "id"=r."userId" FOR UPDATE;
 SELECT * INTO r FROM "SsoAccountErasureRequest" WHERE "id"=request_id FOR UPDATE;
 IF r."appStatus"='DELETED' THEN RETURN true; END IF;
 IF r."userId" IS NULL OR NOT EXISTS(SELECT 1 FROM "User" WHERE "id"=r."userId" AND "accountStatus"='DELETION_PENDING') THEN RETURN false; END IF;
 IF NOT "phase7_erase_user"(r."userId",environment_value) THEN RETURN false; END IF;
 UPDATE "SsoAccountErasureRequest" SET "appStatus"='DELETED',"completedAt"=clock_timestamp() WHERE "id"=request_id;
 RETURN true;
END;
$function$;
CREATE FUNCTION "phase7_record_sso_provider_cleanup"(request_id UUID,provider_value TEXT,status_value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
BEGIN
 PERFORM "phase7_require_caller_role"('nihongo_erasure_worker'); PERFORM "phase7_require_database_capability"(NULL);
 IF provider_value IS NULL OR provider_value NOT IN ('apple','google') OR status_value IS NULL OR status_value NOT IN ('COMPLETED','FAILED') THEN RETURN false; END IF;
 UPDATE "SsoAccountErasureRequest" r SET "providerCleanup"=(SELECT jsonb_agg(CASE WHEN x->>'provider'=provider_value THEN jsonb_set(x,'{status}',to_jsonb(status_value)) ELSE x END ORDER BY x->>'provider') FROM jsonb_array_elements(r."providerCleanup") x)
 WHERE r."id"=request_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(r."providerCleanup") x WHERE x->>'provider'=provider_value);
 RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_sso_account_session"(TEXT),
 "phase7_sso_account_context_valid"(JSONB,TEXT),
 "phase7_sso_account_proof_valid"(TEXT,TEXT),
 "phase7_prepare_sso_account_fresh"(TEXT,TEXT),
 "phase7_create_sso_account_fresh_transaction"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB),
 "phase7_consume_sso_account_fresh_transaction"(TEXT,TEXT,TEXT,TEXT),
 "phase7_stage_sso_account_fresh_proof"(JSONB,TEXT,TEXT,TEXT,TEXT),
 "phase7_complete_sso_account_fresh"(TEXT,TEXT),
 "phase7_prepare_sso_account_link"(TEXT,TEXT,TEXT),
 "phase7_complete_sso_account_link"(TEXT,TEXT),
 "phase7_sso_account_capabilities"(TEXT,TEXT[],TEXT),
 "phase7_unlink_sso_account"(TEXT,TEXT,TEXT[],TEXT),
 "phase7_request_sso_account_erasure"(TEXT,TEXT,TEXT),
 "phase7_sso_account_erasure_status"(TEXT),
 "phase7_complete_sso_account_erasure"(UUID,"AdminAuditEnvironment"),
 "phase7_record_sso_provider_cleanup"(UUID,TEXT,TEXT)
 FROM PUBLIC,"nihongo_app","nihongo_auth_gateway","nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_prepare_sso_account_fresh"(TEXT,TEXT),
 "phase7_create_sso_account_fresh_transaction"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB),
 "phase7_consume_sso_account_fresh_transaction"(TEXT,TEXT,TEXT,TEXT),
 "phase7_stage_sso_account_fresh_proof"(JSONB,TEXT,TEXT,TEXT,TEXT),
 "phase7_complete_sso_account_fresh"(TEXT,TEXT),
 "phase7_prepare_sso_account_link"(TEXT,TEXT,TEXT),
 "phase7_complete_sso_account_link"(TEXT,TEXT),
 "phase7_sso_account_capabilities"(TEXT,TEXT[],TEXT),
 "phase7_unlink_sso_account"(TEXT,TEXT,TEXT[],TEXT),
 "phase7_request_sso_account_erasure"(TEXT,TEXT,TEXT),
 "phase7_sso_account_erasure_status"(TEXT) TO "nihongo_auth_gateway";
GRANT EXECUTE ON FUNCTION "phase7_complete_sso_account_erasure"(UUID,"AdminAuditEnvironment"),
 "phase7_record_sso_provider_cleanup"(UUID,TEXT,TEXT) TO "nihongo_erasure_worker";
DO $harden_sso_account_functions$
DECLARE target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema',false)::NAME; signature TEXT;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  '"phase7_sso_account_session"(TEXT)',
  '"phase7_sso_account_context_valid"(JSONB,TEXT)',
  '"phase7_sso_account_proof_valid"(TEXT,TEXT)',
  '"phase7_prepare_sso_account_fresh"(TEXT,TEXT)',
  '"phase7_create_sso_account_fresh_transaction"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)',
  '"phase7_consume_sso_account_fresh_transaction"(TEXT,TEXT,TEXT,TEXT)',
  '"phase7_stage_sso_account_fresh_proof"(JSONB,TEXT,TEXT,TEXT,TEXT)',
  '"phase7_complete_sso_account_fresh"(TEXT,TEXT)',
  '"phase7_prepare_sso_account_link"(TEXT,TEXT,TEXT)',
  '"phase7_complete_sso_account_link"(TEXT,TEXT)',
  '"phase7_sso_account_capabilities"(TEXT,TEXT[],TEXT)',
  '"phase7_unlink_sso_account"(TEXT,TEXT,TEXT[],TEXT)',
  '"phase7_request_sso_account_erasure"(TEXT,TEXT,TEXT)',
  '"phase7_sso_account_erasure_status"(TEXT)',
  '"phase7_complete_sso_account_erasure"(UUID,"AdminAuditEnvironment")',
  '"phase7_record_sso_provider_cleanup"(UUID,TEXT,TEXT)'
 ] LOOP
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.%s SET search_path TO pg_catalog, %I, pg_temp',target_schema,signature,target_schema);
 END LOOP;
END;
$harden_sso_account_functions$;
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
