-- #504 P8-2: removes the phase name from the database objects the baseline
-- kept (user decision): the AuthSessionIssuerProtocolVersion value PHASE7_V1
-- becomes OWNED_V1, eight exception messages lose their 'Phase 7' prefix, and
-- require_caller_role drops its nihongo_auth_gateway/nihongo_erasure_worker
-- alias (its three callers now name nihongo_app). Behavior, SQLSTATEs, owners
-- and privileges are unchanged; the function bodies differ only in those
-- strings. Old keyed rate windows are dropped. CREATE OR REPLACE keeps each function's ACL and owner but resets its
-- SET clause, so the fixed search_path is set again below.
BEGIN;
SELECT pg_catalog.set_config('app.target_schema', pg_catalog.current_schema(), true);
SELECT pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true);
DO $preflight$
DECLARE
  target_schema NAME := pg_catalog.current_setting('app.target_schema', false)::NAME;
  expected_wrapper TEXT := CASE
    WHEN pg_catalog.current_database() ~ '_test$' THEN 'nihongo_test_migration_login'
    WHEN pg_catalog.current_database() ~ '_dev$' THEN 'nihongo_development_migration_login'
    WHEN pg_catalog.current_database() = 'nihongo' THEN 'nihongo_production_migration_login'
    ELSE NULL END;
BEGIN
  IF expected_wrapper IS NULL OR SESSION_USER <> expected_wrapper
    OR CURRENT_USER <> 'nihongo_migration'
    OR pg_catalog.current_setting('session_replication_role') <> 'origin'
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace n
      JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
      WHERE n.nspname = target_schema AND r.rolname = 'nihongo_owner'
    ) THEN
    RAISE EXCEPTION 'Migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL check_function_bodies = false;
SET LOCAL ROLE "nihongo_owner";

ALTER TYPE "AuthSessionIssuerProtocolVersion" RENAME VALUE 'PHASE7_V1' TO 'OWNED_V1';

-- Keyed admin/report rate windows now use the application:keyed: prefix; the
-- old windows (at most one hour of counts) are dropped instead of migrated.
DELETE FROM "RateLimit" WHERE "key" LIKE 'application:phase7:%';

-- FUNCTION: limit_operation_intent_delete
CREATE OR REPLACE FUNCTION limit_operation_intent_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- This function runs as its caller: current_user is nihongo_app only for a
  -- direct API statement.
  IF current_user = 'nihongo_app'
    AND (OLD."backendPid" <> pg_backend_pid()
      OR OLD."transactionId" <> txid_current()) THEN
    RAISE EXCEPTION 'Operation intent belongs to another transaction.'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

-- FUNCTION: classify_admin_authority
CREATE OR REPLACE FUNCTION classify_admin_authority(raw_token text) RETURNS TABLE(outcome text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
DECLARE
  token_digest_value TEXT;
  authority_lost BOOLEAN;
  live_non_admin BOOLEAN;
  checked_at TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "require_caller_role"('nihongo_app');
  PERFORM "require_runtime_ready"();
  token_digest_value := "reauthentication_token_digest"(
    COALESCE(raw_token, '')
  );
  SELECT EXISTS (
    SELECT 1 FROM "AuthorityRevocationEvidence" AS evidence
    WHERE evidence."tokenDigest" = token_digest_value
      AND evidence."reason" = 'ADMIN_AUTHORITY_LOST'
      AND evidence."expiresAt" > checked_at
  ), EXISTS (
    SELECT 1
    FROM "Session" AS session
    JOIN "User" AS target_user ON target_user."id" = session."userId"
    WHERE session."token" = raw_token
      AND session."issuerProtocolVersion" = 'OWNED_V1'
      AND session."authorizationState" = 'ACTIVE'
      AND session."authorityGeneration" = target_user."authorityGeneration"
      AND session."expiresAt" > checked_at
      AND session."createdAt" + INTERVAL '30 days' > checked_at
      AND (target_user."role" <> 'ADMIN'
        OR target_user."accountStatus" <> 'ACTIVE')
  ) INTO authority_lost, live_non_admin;
  RETURN QUERY SELECT CASE
    WHEN authority_lost OR live_non_admin THEN 'ADMIN_REQUIRED'
    ELSE 'AUTH_SESSION_EXPIRED'
  END;
END;
$$;

-- FUNCTION: consume_sso_transaction_v2
CREATE OR REPLACE FUNCTION consume_sso_transaction_v2(provider_id text, state_digest text, binding_digest text) RETURNS TABLE(provider text, nonce text, "codeVerifier" text, "callbackURL" text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  PERFORM "require_caller_role"('nihongo_app');
  PERFORM "require_runtime_ready"();
  -- DELETE RETURNING is one atomic consumption, including concurrent callbacks.
  RETURN QUERY DELETE FROM "SsoLoginTransaction" AS transaction
  WHERE transaction."stateDigest" = state_digest
    AND transaction."bindingDigest" = binding_digest
    AND transaction."provider" = provider_id
    AND transaction."expiresAt" > clock_timestamp()
  RETURNING transaction."provider"::TEXT, transaction."nonce"::TEXT, transaction."codeVerifier"::TEXT,
    transaction."callbackURL"::TEXT;
END;
$$;

-- FUNCTION: create_sso_transaction_v2
CREATE OR REPLACE FUNCTION create_sso_transaction_v2(provider_id text, state_digest text, binding_digest text, nonce_value text, verifier_value text, callback_value text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
DECLARE event_time TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "require_caller_role"('nihongo_app');
  PERFORM "require_runtime_ready"();
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
$_$;

-- FUNCTION: record_authority_revocation
CREATE OR REPLACE FUNCTION record_authority_revocation(target_user_id uuid, reason_value "AuthorityRevocationReason") RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  conflicting_count INTEGER;
  captured_at TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  IF reason_value IS NULL THEN
    RAISE EXCEPTION 'Authority revocation reason is required.'
      USING ERRCODE = '23514';
  END IF;
  SELECT count(*)::INTEGER INTO conflicting_count
  FROM "Session" AS session
  JOIN "User" AS target_user ON target_user."id" = session."userId"
  JOIN "AuthorityRevocationEvidence" AS evidence
    ON evidence."tokenDigest" =
      "reauthentication_token_digest"(session."token")
  WHERE session."userId" = target_user_id
    AND session."issuerProtocolVersion" = 'OWNED_V1'
    AND session."authorizationState" = 'ACTIVE'
    AND session."authorityGeneration" = target_user."authorityGeneration"
    AND session."expiresAt" > captured_at
    AND session."createdAt" + INTERVAL '30 days' > captured_at
    AND (evidence."sessionId" IS DISTINCT FROM session."id"
      OR evidence."reason" IS DISTINCT FROM reason_value);
  IF conflicting_count <> 0 THEN
    RAISE EXCEPTION 'Authority revocation evidence collision detected.'
      USING ERRCODE = '23514';
  END IF;
  INSERT INTO "AuthorityRevocationEvidence" (
    "tokenDigest", "sessionId", "reason",
    "createdAt", "expiresAt"
  )
  SELECT "reauthentication_token_digest"(session."token"),
    session."id", reason_value,
    captured_at, captured_at + INTERVAL '15 minutes'
  FROM "Session" AS session
  JOIN "User" AS target_user ON target_user."id" = session."userId"
  WHERE session."userId" = target_user_id
    AND session."issuerProtocolVersion" = 'OWNED_V1'
    AND session."authorizationState" = 'ACTIVE'
    AND session."authorityGeneration" = target_user."authorityGeneration"
    AND session."expiresAt" > captured_at
    AND session."createdAt" + INTERVAL '30 days' > captured_at;
END;
$$;

-- FUNCTION: require_caller_role
CREATE OR REPLACE FUNCTION require_caller_role(required_role text) RETURNS void
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  effective_caller TEXT := current_setting('role', true);
BEGIN
  IF current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN
    RAISE EXCEPTION 'Facades require session_replication_role=origin.'
      USING ERRCODE = '42501';
  END IF;
  IF effective_caller IS NULL OR effective_caller = 'none' THEN
    effective_caller := session_user;
  END IF;
  IF effective_caller IS DISTINCT FROM required_role THEN
    RAISE EXCEPTION 'Caller role % is not authorized for this facade.',
      effective_caller USING ERRCODE = '42501';
  END IF;
END;
$$;

-- FUNCTION: require_database_capability
CREATE OR REPLACE FUNCTION require_database_capability(environment_value "AdminAuditEnvironment" DEFAULT NULL::"AdminAuditEnvironment") RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $_$
DECLARE
  capability "DatabaseCapability"%ROWTYPE;
  actual_address INET := inet_server_addr();
  actual_port INTEGER := inet_server_port();
BEGIN
  SELECT * INTO capability
  FROM "DatabaseCapability"
  WHERE "id" = 1;
  IF capability."id" IS NULL
    OR capability."databaseName" <> current_database()
    OR capability."serverAddress" IS DISTINCT FROM actual_address
    OR capability."serverPort" IS DISTINCT FROM actual_port
    OR (environment_value IS NOT NULL
      AND capability."environment" IS DISTINCT FROM environment_value)
    OR (capability."environment" = 'TEST'
      AND capability."databaseName" !~ '_test$')
    OR (capability."environment" = 'DEVELOPMENT'
      AND capability."databaseName" !~ '_dev$') THEN
    RAISE EXCEPTION 'Database capability is absent or stale.'
      USING ERRCODE = '42501';
  END IF;
END;
$_$;

-- FUNCTION: require_runtime_ready
CREATE OR REPLACE FUNCTION require_runtime_ready() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
DECLARE
  effective_caller TEXT := current_setting('role', true);
BEGIN
  IF current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN
    RAISE EXCEPTION 'Runtime requires session_replication_role=origin.'
      USING ERRCODE = '42501';
  END IF;
  IF effective_caller IS NULL OR effective_caller = 'none' THEN
    effective_caller := session_user;
  END IF;
  IF effective_caller <> 'nihongo_app' THEN
    RAISE EXCEPTION 'Caller role % is not a runtime role.',
      effective_caller USING ERRCODE = '42501';
  END IF;
  PERFORM "require_database_capability"(NULL);
  RETURN true;
END;
$$;

-- FUNCTION: resolve_sso_identity
CREATE OR REPLACE FUNCTION resolve_sso_identity(provider_id text, provider_subject text, contact_email text, display_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE target_user "User"%ROWTYPE; target_id UUID; event_time TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "require_caller_role"('nihongo_app');
  PERFORM "require_runtime_ready"();
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
$$;

-- FUNCTION: protect_evidence_history
CREATE OR REPLACE FUNCTION protect_evidence_history() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  erasure_mode BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Evidence delete is forbidden.'
      USING ERRCODE = '23514';
  END IF;
  -- #504 P7 PR4a: the API writes the tombstones of a confirmed erasure. This
  -- function runs as its caller, so current_user is nihongo_app only for a
  -- direct API statement. No other writer remains (#504 P7 PR4c-1).
  IF current_user = 'nihongo_app' THEN
    IF TG_TABLE_NAME = 'ContentReview' THEN
      erasure_mode :=
        (NEW."actorUserId" IS NOT DISTINCT FROM OLD."actorUserId"
          AND NEW."actorLabel" IS NOT DISTINCT FROM OLD."actorLabel"
          OR NEW."actorUserId" IS NULL
            AND NEW."actorLabel" IN ('DELETED_ADMIN', 'DELETED_USER')
            AND "user_erasure_confirmed"(OLD."actorId"))
        AND (NEW."counterpartUserId" IS NOT DISTINCT FROM OLD."counterpartUserId"
          AND NEW."counterpartLabel" IS NOT DISTINCT FROM OLD."counterpartLabel"
          OR NEW."counterpartUserId" IS NULL
            AND NEW."counterpartLabel" IN ('DELETED_ADMIN', 'DELETED_USER')
            AND "user_erasure_confirmed"(OLD."counterpartActorId"));
    ELSIF TG_TABLE_NAME = 'AdminAuditLog' THEN
      erasure_mode := NEW."actorUserId" IS NULL
        AND NEW."actorLabel" IN ('DELETED_ADMIN', 'DELETED_USER')
        AND "user_erasure_confirmed"(OLD."actorId");
    END IF;
  END IF;
  IF NOT erasure_mode THEN
    RAISE EXCEPTION 'Evidence is append-only.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'ContentReview' AND (
    to_jsonb(NEW)
      - 'actorUserId' - 'actorLabel'
      - 'counterpartUserId' - 'counterpartLabel'
  ) <> (
    to_jsonb(OLD)
      - 'actorUserId' - 'actorLabel'
      - 'counterpartUserId' - 'counterpartLabel'
  ) THEN
    RAISE EXCEPTION 'ContentReview erasure tombstone changed immutable evidence.'
      USING ERRCODE = '23514';
  ELSIF TG_TABLE_NAME = 'AdminAuditLog' AND (
    to_jsonb(NEW) - 'actorUserId' - 'actorLabel'
  ) <> (
    to_jsonb(OLD) - 'actorUserId' - 'actorLabel'
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog erasure tombstone changed immutable evidence.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- FUNCTION: reject_unfinished_operation
CREATE OR REPLACE FUNCTION reject_unfinished_operation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "OperationIntent"
    WHERE "operationId" = NEW."operationId"
  ) THEN
    RAISE EXCEPTION 'Operation was not verified and consumed.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

-- FUNCTION: validate_session_write
CREATE OR REPLACE FUNCTION validate_session_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  user_row "User"%ROWTYPE;
  -- #504 P7 PR4c-2: the migration operator (activation, first-admin
  -- bootstrap). #504 P7 PR5b: trusted execution is gone.
  trusted_delete BOOLEAN :=
    COALESCE(NULLIF(current_setting('role', true), 'none'), session_user) = 'nihongo_migration';
  remember_session BOOLEAN := false;
  issued_at TIMESTAMPTZ(3);
  -- #504 P7 PR3a: the API writes owned V1 Sessions as nihongo_app.
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
  api_writer BOOLEAN := effective_caller = 'nihongo_app';
  api_reauthentication BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- #504 P7 PR4b-1: the API deletes V1 Sessions (sign-out, re-authentication
    -- rotation and cleanup, erasure). Before, it could already revoke any
    -- Session family and then delete that family's Sessions.
    IF NOT trusted_delete AND api_writer
      AND OLD."issuerProtocolVersion" = 'OWNED_V1' THEN
      RETURN OLD;
    END IF;
    IF NOT trusted_delete THEN
      RAISE EXCEPTION 'Session delete requires owned authority.'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO user_row FROM "User" WHERE "id" = NEW."userId" FOR UPDATE;
    IF user_row."id" IS NULL OR user_row."accountStatus" <> 'ACTIVE' THEN
      RAISE EXCEPTION 'Session requires an active User.' USING ERRCODE = '42501';
    END IF;

    IF NEW."issuerProtocolVersion" = 'LEGACY' THEN
      RAISE EXCEPTION 'Legacy Session issuance is disabled.'
        USING ERRCODE = '42501';
    ELSE
      IF NOT api_writer THEN
        RAISE EXCEPTION 'OWNED_V1 Session requires the owned issuer.'
          USING ERRCODE = '42501';
      END IF;
      -- The API asks for 7 days when remembered and 1 day otherwise; the
      -- 3 day threshold is far from both, so clock rounding cannot flip it.
      remember_session := NEW."expiresAt" > clock_timestamp() + INTERVAL '3 days';
      -- #504 P7 PR3b-1: the API stages a PENDING_REAUTH replacement only for
      -- the User's live PREPARED intent in the same generation.
      api_reauthentication := NEW."authorizationState" = 'PENDING_REAUTH'
        AND EXISTS (
          SELECT 1 FROM "ReauthenticationIntent" AS intent
          WHERE intent."userId" = NEW."userId"
            AND intent."state" = 'PREPARED'
            AND intent."expiresAt" > clock_timestamp()
            AND intent."capturedAuthorityGeneration" = user_row."authorityGeneration"
        );
      IF (api_reauthentication
          AND NEW."authorizationState" <> 'PENDING_REAUTH')
        OR (NOT api_reauthentication
          AND NEW."authorizationState" <> 'ACTIVE') THEN
        RAISE EXCEPTION 'Session authorization state does not match issuer.'
          USING ERRCODE = '42501';
      END IF;
      issued_at := clock_timestamp();
      NEW."createdAt" := issued_at;
      NEW."updatedAt" := issued_at;
      NEW."expiresAt" := issued_at
        + CASE WHEN remember_session
          THEN INTERVAL '7 days' ELSE INTERVAL '1 day' END;
      NEW."authorityGeneration" := user_row."authorityGeneration";
    END IF;

    IF NEW."authorityGeneration" <> user_row."authorityGeneration" THEN
      RAISE EXCEPTION 'Session generation authority is invalid.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" <> OLD."id" OR NEW."token" <> OLD."token"
    OR NEW."userId" <> OLD."userId"
    OR NEW."createdAt" <> OLD."createdAt"
    OR NEW."authorityGeneration" <> OLD."authorityGeneration"
    OR NEW."issuerProtocolVersion" <> OLD."issuerProtocolVersion" THEN
    RAISE EXCEPTION 'Session authority identity is immutable.'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."authorizationState" = 'PENDING_REAUTH'
    AND NEW."authorizationState" = 'ACTIVE'
    AND (api_writer AND EXISTS (
      -- #504 P7 PR3b-1: the API activates only the staged Session of a live
      -- STAGED intent.
      SELECT 1 FROM "ReauthenticationIntent" AS intent
      WHERE intent."stagedSessionId" = OLD."id"
        AND intent."userId" = OLD."userId"
        AND intent."state" = 'STAGED'
        AND intent."expiresAt" > clock_timestamp()
    )) THEN
    IF (to_jsonb(NEW) - 'authorizationState') <>
       (to_jsonb(OLD) - 'authorizationState') THEN
      RAISE EXCEPTION 'Pending Session activation may only change authority state.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."authorizationState" IS DISTINCT FROM OLD."authorizationState"
    OR OLD."authorizationState" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Session authorization state transition is invalid.'
      USING ERRCODE = '42501';
  END IF;
  IF OLD."issuerProtocolVersion" = 'LEGACY' THEN
    RAISE EXCEPTION 'Legacy Session refresh is disabled.'
      USING ERRCODE = '42501';
  ELSE
    IF NOT (api_writer AND OLD."expiresAt" > OLD."createdAt" + INTERVAL '1 day'
        AND EXISTS (
          SELECT 1 FROM "User" AS refresh_user
          WHERE refresh_user."id" = OLD."userId"
            AND refresh_user."accountStatus" = 'ACTIVE'
            AND refresh_user."authorityGeneration" = OLD."authorityGeneration"
        )) THEN
      RAISE EXCEPTION 'V1 Session refresh requires remembered owned context.'
        USING ERRCODE = '42501';
    END IF;
    NEW."updatedAt" := clock_timestamp();
    NEW."expiresAt" := LEAST(
      NEW."updatedAt" + INTERVAL '7 days',
      OLD."createdAt" + INTERVAL '30 days'
    );
  END IF;
  RETURN NEW;
END;
$$;

DO $fixed_path$
DECLARE
  target_schema TEXT := pg_catalog.current_setting('app.target_schema', false);
  function_oid OID;
BEGIN
  FOR function_oid IN
    SELECT procedure_record.oid
    FROM pg_catalog.pg_proc AS procedure_record
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure_record.pronamespace
    WHERE namespace.nspname = target_schema
      AND procedure_record.proname = ANY(ARRAY[
        'limit_operation_intent_delete',
        'classify_admin_authority',
        'consume_sso_transaction_v2',
        'create_sso_transaction_v2',
        'record_authority_revocation',
        'require_database_capability',
        'require_runtime_ready',
        'resolve_sso_identity',
        'protect_evidence_history',
        'reject_unfinished_operation',
        'validate_session_write'
      ]::NAME[])
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET search_path TO pg_catalog, %I, pg_temp',
      function_oid::REGPROCEDURE, target_schema
    );
  END LOOP;
END;
$fixed_path$;

SET LOCAL ROLE "nihongo_migration";
COMMIT;
