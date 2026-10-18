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
SELECT pg_catalog.set_config('search_path', 'pg_catalog, ' ||
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

CREATE TABLE "SsoAdminFreshTransaction" (
  "stateDigest" VARCHAR(64) PRIMARY KEY CHECK ("stateDigest" ~ '^[0-9a-f]{64}$'),
  "bindingDigest" VARCHAR(64) NOT NULL CHECK ("bindingDigest" ~ '^[0-9a-f]{64}$'),
  "provider" VARCHAR(32) NOT NULL CHECK ("provider" IN ('apple','google')),
  "nonce" VARCHAR(43) NOT NULL CHECK ("nonce" ~ '^[A-Za-z0-9_-]{43}$'),
  "codeVerifier" VARCHAR(86) NOT NULL CHECK ("codeVerifier" ~ '^[A-Za-z0-9_-]{86}$'),
  "callbackURL" VARCHAR(2048) NOT NULL,
  "context" JSONB NOT NULL CHECK (jsonb_typeof("context") = 'object'),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '2 minutes')
);
CREATE INDEX "SsoAdminFreshTransaction_expiresAt_idx" ON "SsoAdminFreshTransaction"("expiresAt");
CREATE TABLE "SsoAdminFreshProof" (
  "proofDigest" VARCHAR(64) PRIMARY KEY CHECK ("proofDigest" ~ '^[0-9a-f]{64}$'),
  "context" JSONB NOT NULL CHECK (jsonb_typeof("context") = 'object'),
  "callbackURL" VARCHAR(2048) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "completedSessionId" UUID,
  "completedAt" TIMESTAMPTZ(3),
  CHECK (("completedSessionId" IS NULL) = ("completedAt" IS NULL)),
  CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '7 minutes')
);
CREATE INDEX "SsoAdminFreshProof_expiresAt_idx" ON "SsoAdminFreshProof"("expiresAt");
REVOKE ALL ON TABLE "SsoAdminFreshTransaction", "SsoAdminFreshProof"
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

CREATE FUNCTION "phase7_sso_fresh_context_valid"(context_value JSONB)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $function$
  SELECT EXISTS (
    SELECT 1 FROM "Phase7ReauthenticationIntent" AS intent
    JOIN "User" AS actor ON actor."id" = intent."userId"
    JOIN "AuthSessionFamily" AS family ON family."id" = intent."sessionFamilyId" AND family."userId" = actor."id"
    JOIN "Session" AS session ON session."id" = intent."oldSessionId" AND session."userId" = actor."id" AND session."sessionFamilyId" = family."id"
    JOIN "Account" AS account ON account."userId" = actor."id" AND account."providerId" = context_value->>'provider' AND account."accountId" = context_value->>'accountId'
    WHERE intent."id" = (context_value->>'intentId')::UUID
      AND intent."state" = 'PREPARED' AND intent."expiresAt" > clock_timestamp()
      AND intent."userId" = (context_value->>'userId')::UUID
      AND intent."oldSessionId" = (context_value->>'sessionId')::UUID
      AND intent."capturedAuthorityGeneration" = (context_value->>'authorityGeneration')::INTEGER
      AND actor."authorityGeneration" = intent."capturedAuthorityGeneration"
      AND actor."role" = 'ADMIN' AND actor."accountStatus" = 'ACTIVE'
      AND family."status" = 'ACTIVE'
      AND session."authorizationState" = 'ACTIVE' AND session."issuerProtocolVersion" = 'PHASE7_V1'
      AND session."authorityGeneration" = intent."capturedAuthorityGeneration"
      AND "phase7_reauthentication_token_digest"(session."token") = intent."oldTokenDigest"
      AND session."expiresAt" > clock_timestamp() AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()
  );
$function$;

CREATE FUNCTION "phase7_prepare_sso_admin_fresh"(raw_token TEXT, provider_value TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE actor_id UUID; session_id UUID; generation_value INTEGER; subject_value TEXT;
  intent_id UUID := public.gen_random_uuid(); prepared_id UUID; audit_environment "AdminAuditEnvironment";
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_runtime_ready"();
  IF provider_value IS NULL OR provider_value NOT IN ('apple','google') THEN RETURN NULL; END IF;
  SELECT actor."id" INTO actor_id FROM "Session" AS session
    JOIN "User" AS actor ON actor."id" = session."userId" WHERE session."token" = raw_token;
  IF actor_id IS NULL THEN RETURN NULL; END IF;
  PERFORM 1 FROM "User" WHERE "id" = actor_id FOR UPDATE;
  SELECT session."id", actor."authorityGeneration", account."accountId"
    INTO session_id, generation_value, subject_value
    FROM "Session" AS session
    JOIN "User" AS actor ON actor."id" = session."userId"
    JOIN "AuthSessionFamily" AS family ON family."id" = session."sessionFamilyId" AND family."userId" = actor."id"
    JOIN "Account" AS account ON account."userId" = actor."id" AND account."providerId" = provider_value
    WHERE session."token" = raw_token AND actor."id" = actor_id
      AND actor."role" = 'ADMIN' AND actor."accountStatus" = 'ACTIVE'
      AND session."authorizationState" = 'ACTIVE' AND session."issuerProtocolVersion" = 'PHASE7_V1'
      AND session."authorityGeneration" = actor."authorityGeneration" AND family."status" = 'ACTIVE'
      AND session."expiresAt" > clock_timestamp() AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()
      AND (SELECT count(*) FROM "Account" WHERE "userId" = actor_id AND "providerId" = provider_value) = 1;
  IF session_id IS NULL THEN RETURN NULL; END IF;
  SELECT "environment" INTO audit_environment FROM "Phase7DatabaseCapability" WHERE "id" = 1;
  SELECT result."intentId" INTO prepared_id FROM "phase7_prepare_reauthentication"(
    raw_token, actor_id, public.gen_random_uuid(), audit_environment, intent_id
  ) AS result;
  IF prepared_id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('intentId',prepared_id,'userId',actor_id,'sessionId',session_id,
    'authorityGeneration',generation_value,'provider',provider_value,'accountId',subject_value);
END;
$function$;

CREATE FUNCTION "phase7_create_sso_admin_fresh_transaction"(
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
  INSERT INTO "SsoAdminFreshTransaction"("provider","stateDigest","bindingDigest","nonce","codeVerifier","callbackURL","context","createdAt","expiresAt")
    VALUES(provider_value,state_digest,binding_digest,nonce_value,verifier_value,callback_value,context_value,event_time,least(expiry,event_time + INTERVAL '2 minutes'));
  RETURN true;
END;
$function$;
CREATE FUNCTION "phase7_consume_sso_admin_fresh_transaction"(provider_value TEXT,state_digest TEXT,binding_digest TEXT)
RETURNS TABLE("provider" TEXT,"nonce" TEXT,"codeVerifier" TEXT,"callbackURL" TEXT,"context" JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
  RETURN QUERY DELETE FROM "SsoAdminFreshTransaction" AS tx
    WHERE tx."provider" = provider_value AND tx."stateDigest" = state_digest AND tx."bindingDigest" = binding_digest AND tx."expiresAt" > clock_timestamp()
    RETURNING tx."provider"::TEXT,tx."nonce"::TEXT,tx."codeVerifier"::TEXT,tx."callbackURL"::TEXT,tx."context";
END;
$function$;
CREATE FUNCTION "phase7_stage_sso_admin_fresh_proof"(context_value JSONB, provider_value TEXT, subject_value TEXT, proof_digest TEXT, callback_value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE expiry TIMESTAMPTZ(3); event_time TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
  PERFORM 1 FROM "User" WHERE "id" = (context_value->>'userId')::UUID FOR UPDATE;
  IF provider_value IS DISTINCT FROM context_value->>'provider' OR subject_value IS DISTINCT FROM context_value->>'accountId'
    OR NOT "phase7_sso_fresh_context_valid"(context_value) OR callback_value IS NULL OR left(callback_value,1) <> '/' OR left(callback_value,2) = '//' THEN RETURN false; END IF;
  SELECT "expiresAt" INTO expiry FROM "Phase7ReauthenticationIntent" WHERE "id" = (context_value->>'intentId')::UUID;
  INSERT INTO "SsoAdminFreshProof"("proofDigest","context","callbackURL","createdAt","expiresAt")
    VALUES(proof_digest,context_value,callback_value,event_time,least(expiry,event_time + INTERVAL '2 minutes'));
  RETURN true;
END;
$function$;

CREATE FUNCTION "phase7_complete_sso_admin_fresh"(proof_digest TEXT,raw_old_token TEXT,new_session_id UUID,raw_new_token TEXT,ip_value TEXT,agent_value TEXT)
RETURNS TABLE("id" UUID,"familyId" UUID,"createdAt" TIMESTAMPTZ,"expiresAt" TIMESTAMPTZ,"authorityGeneration" INTEGER,"userId" UUID,"callbackURL" TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE proof "SsoAdminFreshProof"%ROWTYPE; staged_id UUID; replacement RECORD; expected_user_id UUID; intent_id UUID;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
  SELECT * INTO proof FROM "SsoAdminFreshProof" WHERE "proofDigest" = proof_digest;
  IF proof."proofDigest" IS NULL OR proof."completedSessionId" IS NOT NULL THEN RETURN; END IF;
  expected_user_id := (proof."context"->>'userId')::UUID;
  intent_id := (proof."context"->>'intentId')::UUID;
  PERFORM 1 FROM "User" WHERE "id" = expected_user_id FOR UPDATE;
  SELECT * INTO proof FROM "SsoAdminFreshProof" WHERE "proofDigest" = proof_digest FOR UPDATE;
  IF proof."proofDigest" IS NULL OR proof."completedSessionId" IS NOT NULL OR proof."expiresAt" <= clock_timestamp()
    OR NOT "phase7_sso_fresh_context_valid"(proof."context") OR NOT EXISTS (
      SELECT 1 FROM "Session" WHERE "id" = (proof."context"->>'sessionId')::UUID AND "userId" = expected_user_id AND "token" = raw_old_token
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
CREATE FUNCTION "phase7_reconcile_sso_admin_fresh"(proof_digest TEXT,raw_new_token TEXT)
RETURNS TABLE("id" UUID,"familyId" UUID,"createdAt" TIMESTAMPTZ,"expiresAt" TIMESTAMPTZ,"authorityGeneration" INTEGER,"userId" UUID,"callbackURL" TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $function$
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
  RETURN QUERY SELECT result."id",result."familyId",result."createdAt",result."expiresAt",result."authorityGeneration",
    (proof."context"->>'userId')::UUID,proof."callbackURL"::TEXT
    FROM "SsoAdminFreshProof" AS proof
    CROSS JOIN LATERAL "phase7_reconcile_reauthentication"((proof."context"->>'intentId')::UUID,raw_new_token) AS result
    WHERE proof."proofDigest" = proof_digest AND proof."completedSessionId" = result."id"
      AND result."state" = 'FINALIZED' AND proof."expiresAt" > clock_timestamp();
END;
$function$;
CREATE FUNCTION "phase7_cancel_sso_admin_fresh_proof"(proof_digest TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE proof "SsoAdminFreshProof"%ROWTYPE;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway'); PERFORM "phase7_require_runtime_ready"();
  SELECT * INTO proof FROM "SsoAdminFreshProof" WHERE "proofDigest" = proof_digest;
  IF proof."proofDigest" IS NULL THEN RETURN true; END IF;
  IF proof."completedSessionId" IS NOT NULL THEN RETURN false; END IF;
  IF NOT "phase7_abort_reauthentication"((proof."context"->>'intentId')::UUID) THEN RETURN false; END IF;
  DELETE FROM "SsoAdminFreshProof" WHERE "proofDigest" = proof_digest AND "completedSessionId" IS NULL;
  RETURN true;
END;
$function$;
CREATE FUNCTION "phase7_sso_admin_session_is_fresh"(raw_token TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $function$
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_app'); PERFORM "phase7_require_runtime_ready"();
  RETURN EXISTS (
    SELECT 1 FROM "SsoAdminFreshProof" AS proof
    JOIN "Session" AS session ON session."id" = proof."completedSessionId"
    JOIN "User" AS actor ON actor."id" = session."userId" AND actor."id" = (proof."context"->>'userId')::UUID
    JOIN "AuthSessionFamily" AS family ON family."id" = session."sessionFamilyId" AND family."userId" = actor."id"
    JOIN "Account" AS account ON account."userId" = actor."id" AND account."providerId" = proof."context"->>'provider' AND account."accountId" = proof."context"->>'accountId'
    WHERE session."token" = raw_token AND session."authorizationState" = 'ACTIVE' AND session."issuerProtocolVersion" = 'PHASE7_V1'
      AND actor."role" = 'ADMIN' AND actor."accountStatus" = 'ACTIVE' AND actor."authorityGeneration" = (proof."context"->>'authorityGeneration')::INTEGER
      AND session."authorityGeneration" = actor."authorityGeneration" AND family."status" = 'ACTIVE'
      AND proof."expiresAt" > clock_timestamp() AND proof."completedAt" + INTERVAL '5 minutes' > clock_timestamp()
      AND session."createdAt" + INTERVAL '5 minutes' > clock_timestamp() AND session."expiresAt" > clock_timestamp()
  );
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_sso_fresh_context_valid"(JSONB), "phase7_prepare_sso_admin_fresh"(TEXT,TEXT),
  "phase7_create_sso_admin_fresh_transaction"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB),
  "phase7_consume_sso_admin_fresh_transaction"(TEXT,TEXT,TEXT),
  "phase7_stage_sso_admin_fresh_proof"(JSONB,TEXT,TEXT,TEXT,TEXT),
  "phase7_complete_sso_admin_fresh"(TEXT,TEXT,UUID,TEXT,TEXT,TEXT),
  "phase7_reconcile_sso_admin_fresh"(TEXT,TEXT), "phase7_cancel_sso_admin_fresh_proof"(TEXT),
  "phase7_sso_admin_session_is_fresh"(TEXT)
  FROM PUBLIC,"nihongo_app","nihongo_auth_gateway","nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_prepare_sso_admin_fresh"(TEXT,TEXT),
  "phase7_create_sso_admin_fresh_transaction"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB),
  "phase7_consume_sso_admin_fresh_transaction"(TEXT,TEXT,TEXT),
  "phase7_stage_sso_admin_fresh_proof"(JSONB,TEXT,TEXT,TEXT,TEXT),
  "phase7_complete_sso_admin_fresh"(TEXT,TEXT,UUID,TEXT,TEXT,TEXT),
  "phase7_reconcile_sso_admin_fresh"(TEXT,TEXT), "phase7_cancel_sso_admin_fresh_proof"(TEXT) TO "nihongo_auth_gateway";
GRANT EXECUTE ON FUNCTION "phase7_sso_admin_session_is_fresh"(TEXT) TO "nihongo_app";
-- Preserve the original CMS authority/freshness checks and require the SSO
-- assurance at both operation admission and transaction completion. Captured
-- NEW remains available even after finish consumes the one-time intent.
CREATE FUNCTION "validate_phase7_sso_fresh_operation"()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE raw_token TEXT;
BEGIN
  IF NOT NEW."requiresFresh" THEN RETURN NEW; END IF;
  SELECT "token" INTO raw_token FROM "Session" WHERE "id" = NEW."actorSessionId"
    AND "userId" = NEW."actorUserId" AND "sessionFamilyId" = NEW."actorFamilyId"
    AND "authorityGeneration" = NEW."capturedAuthorityGeneration";
  IF raw_token IS NULL OR NOT "phase7_sso_admin_session_is_fresh"(raw_token) THEN
    RAISE EXCEPTION 'Phase 7 operation authority is stale or insufficient.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION "validate_phase7_sso_fresh_operation"() FROM PUBLIC,"nihongo_app","nihongo_auth_gateway","nihongo_erasure_worker";
CREATE TRIGGER "Phase7OperationIntent_sso_fresh_admission" BEFORE INSERT ON "Phase7OperationIntent"
  FOR EACH ROW EXECUTE FUNCTION "validate_phase7_sso_fresh_operation"();
CREATE CONSTRAINT TRIGGER "Phase7OperationIntent_sso_fresh_commit" AFTER INSERT ON "Phase7OperationIntent"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "validate_phase7_sso_fresh_operation"();
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
