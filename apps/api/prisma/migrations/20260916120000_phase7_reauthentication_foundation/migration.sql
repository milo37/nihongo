-- Phase 7 Slice 3R remediation: Better Auth owned reauthentication foundation.
-- This is an append-only migration. Routes remain dormant until the separate
-- activation stop is authorized.

BEGIN;

SELECT pg_catalog.set_config(
  'app.phase7_target_schema',
  pg_catalog.current_schema(),
  true
);
SELECT pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true);

DO $phase7_reauthentication_preflight$
DECLARE
  target_schema pg_catalog.NAME := pg_catalog.current_setting(
    'app.phase7_target_schema', false
  )::pg_catalog.NAME;
  expected_wrapper pg_catalog.TEXT := CASE
    WHEN pg_catalog.current_database() ~ '_test$'
      THEN 'nihongo_test_phase7_migration_login'
    WHEN pg_catalog.current_database() ~ '_dev$'
      THEN 'nihongo_development_phase7_migration_login'
    ELSE NULL
  END;
BEGIN
  IF expected_wrapper IS NULL
    OR SESSION_USER <> expected_wrapper
    OR CURRENT_USER <> 'nihongo_phase7_migration'
    OR pg_catalog.current_setting('role', true)
      <> 'nihongo_phase7_migration'
    OR pg_catalog.current_setting('session_replication_role') <> 'origin' THEN
    RAISE EXCEPTION
      'Phase 7 reauthentication migration principal is not canonical.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespace
    JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.oid = namespace.nspowner
    WHERE namespace.nspname = target_schema
      AND owner_role.rolname = 'nihongo_phase7_owner'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.oid = routine.proowner
    WHERE namespace.nspname = target_schema
      AND routine.proname = 'phase7_reauthenticate_v1_session'
      AND routine.prosecdef
      AND owner_role.rolname = 'nihongo_phase7_owner'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = target_schema
      AND relation.relname = 'Session'
      AND attribute.attname = 'authorizationState'
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION
      'Phase 7 reauthentication foundation preflight failed.'
      USING ERRCODE = '42501';
  END IF;
END;
$phase7_reauthentication_preflight$;

SELECT pg_catalog.set_config(
  'search_path',
  pg_catalog.quote_ident(
    pg_catalog.current_setting('app.phase7_target_schema', false)
  ) || ', pg_catalog, pg_temp',
  true
);
SET LOCAL ROLE "nihongo_phase7_owner";

CREATE TYPE "AuthSessionAuthorizationState" AS ENUM (
  'ACTIVE', 'PENDING_REAUTH'
);
CREATE TYPE "Phase7ReauthenticationIntentState" AS ENUM (
  'PREPARED', 'STAGED', 'FINALIZED'
);
CREATE TYPE "Phase7AuthorityRevocationReason" AS ENUM (
  'ADMIN_AUTHORITY_LOST', 'SESSION_INVALIDATED'
);

ALTER TABLE "Session"
  ADD COLUMN "authorizationState" "AuthSessionAuthorizationState"
  NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE "Phase7ReauthenticationIntent" (
  "id" UUID NOT NULL DEFAULT public.gen_random_uuid(),
  "operationId" UUID NOT NULL DEFAULT public.gen_random_uuid(),
  "requestId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "oldSessionId" UUID NOT NULL,
  "oldTokenDigest" VARCHAR(64) NOT NULL,
  "oldFenceTokenDigest" VARCHAR(64) NOT NULL,
  "sessionFamilyId" UUID NOT NULL,
  "capturedAuthorityGeneration" INTEGER NOT NULL,
  "capturedRole" "UserRole" NOT NULL,
  "capturedAccountStatus" "UserAccountStatus" NOT NULL,
  "state" "Phase7ReauthenticationIntentState" NOT NULL DEFAULT 'PREPARED',
  "stagedSessionId" UUID,
  "stagedTokenDigest" VARCHAR(64),
  "environment" "AdminAuditEnvironment" NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "finalizedAt" TIMESTAMPTZ(3),
  CONSTRAINT "Phase7ReauthenticationIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Phase7ReauthenticationIntent_operationId_key"
    UNIQUE ("operationId"),
  CONSTRAINT "Phase7ReauthenticationIntent_stagedSessionId_key"
    UNIQUE ("stagedSessionId"),
  CONSTRAINT "Phase7ReauthenticationIntent_stagedTokenDigest_key"
    UNIQUE ("stagedTokenDigest"),
  CONSTRAINT "Phase7ReauthenticationIntent_digest_shape_check" CHECK (
    "oldTokenDigest" ~ '^[0-9a-f]{64}$'
    AND "oldFenceTokenDigest" ~ '^[0-9a-f]{64}$'
    AND ("stagedTokenDigest" IS NULL
      OR "stagedTokenDigest" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "Phase7ReauthenticationIntent_authority_check" CHECK (
    "capturedAuthorityGeneration" > 0
    AND "capturedRole" = 'ADMIN'
    AND "capturedAccountStatus" = 'ACTIVE'
  ),
  CONSTRAINT "Phase7ReauthenticationIntent_lifetime_check" CHECK (
    "expiresAt" > "createdAt"
    AND "expiresAt" <= "createdAt" + INTERVAL '5 minutes'
  ),
  CONSTRAINT "Phase7ReauthenticationIntent_state_shape_check" CHECK (
    ("state" = 'PREPARED' AND "stagedSessionId" IS NULL
      AND "stagedTokenDigest" IS NULL AND "finalizedAt" IS NULL)
    OR ("state" = 'STAGED' AND "stagedSessionId" IS NOT NULL
      AND "stagedTokenDigest" IS NOT NULL AND "finalizedAt" IS NULL)
    OR ("state" = 'FINALIZED' AND "stagedSessionId" IS NOT NULL
      AND "stagedTokenDigest" IS NOT NULL AND "finalizedAt" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "Phase7ReauthenticationIntent_live_old_session_key"
  ON "Phase7ReauthenticationIntent" ("oldSessionId")
  WHERE "state" IN ('PREPARED', 'STAGED');
CREATE INDEX "Phase7ReauthenticationIntent_state_expiresAt_id_idx"
  ON "Phase7ReauthenticationIntent" ("state", "expiresAt", "id");
CREATE INDEX "Phase7ReauthenticationIntent_userId_sessionFamilyId_state_idx"
  ON "Phase7ReauthenticationIntent" (
    "userId", "sessionFamilyId", "state"
  );

CREATE TABLE "Phase7AuthorityRevocationEvidence" (
  "tokenDigest" VARCHAR(64) NOT NULL,
  "sessionId" UUID NOT NULL,
  "familyId" UUID NOT NULL,
  "reason" "Phase7AuthorityRevocationReason" NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Phase7AuthorityRevocationEvidence_pkey"
    PRIMARY KEY ("tokenDigest"),
  CONSTRAINT "Phase7AuthorityRevocationEvidence_digest_shape_check"
    CHECK ("tokenDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "Phase7AuthorityRevocationEvidence_lifetime_check" CHECK (
    "expiresAt" > "createdAt"
    AND "expiresAt" <= "createdAt" + INTERVAL '15 minutes'
  )
);
CREATE INDEX "Phase7AuthorityRevocationEvidence_expiresAt_tokenDigest_idx"
  ON "Phase7AuthorityRevocationEvidence" ("expiresAt", "tokenDigest");

REVOKE ALL ON TABLE "Phase7ReauthenticationIntent"
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON TABLE "Phase7AuthorityRevocationEvidence"
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

CREATE FUNCTION "phase7_reauthentication_token_digest"(raw_token TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
  SELECT encode(public.digest(
    convert_to('nihongo-reauthentication-intent-v1', 'UTF8')
      || decode('00', 'hex') || convert_to(raw_token, 'UTF8'),
    'sha256'::TEXT
  ), 'hex');
$function$;

CREATE FUNCTION "phase7_rotation_fence_token_digest"(raw_token TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
  SELECT encode(public.digest(
    convert_to('nihongo-auth-session-rotation-fence-v1', 'UTF8')
      || decode('00', 'hex') || convert_to(raw_token, 'UTF8'),
    'sha256'::TEXT
  ), 'hex');
$function$;

CREATE FUNCTION "phase7_record_authority_revocation"(
  target_user_id UUID,
  reason_value "Phase7AuthorityRevocationReason"
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
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
  JOIN "AuthSessionFamily" AS family
    ON family."id" = session."sessionFamilyId"
   AND family."userId" = session."userId"
  JOIN "User" AS target_user ON target_user."id" = session."userId"
  JOIN "Phase7AuthorityRevocationEvidence" AS evidence
    ON evidence."tokenDigest" =
      "phase7_reauthentication_token_digest"(session."token")
  WHERE session."userId" = target_user_id
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorizationState" = 'ACTIVE'
    AND session."authorityGeneration" = target_user."authorityGeneration"
    AND family."status" = 'ACTIVE'
    AND session."expiresAt" > captured_at
    AND session."createdAt" + INTERVAL '30 days' > captured_at
    AND (evidence."sessionId" IS DISTINCT FROM session."id"
      OR evidence."familyId" IS DISTINCT FROM session."sessionFamilyId"
      OR evidence."reason" IS DISTINCT FROM reason_value);
  IF conflicting_count <> 0 THEN
    RAISE EXCEPTION 'Authority revocation evidence collision detected.'
      USING ERRCODE = '23514';
  END IF;
  INSERT INTO "Phase7AuthorityRevocationEvidence" (
    "tokenDigest", "sessionId", "familyId", "reason",
    "createdAt", "expiresAt"
  )
  SELECT "phase7_reauthentication_token_digest"(session."token"),
    session."id", session."sessionFamilyId", reason_value,
    captured_at, captured_at + INTERVAL '15 minutes'
  FROM "Session" AS session
  JOIN "AuthSessionFamily" AS family
    ON family."id" = session."sessionFamilyId"
   AND family."userId" = session."userId"
  JOIN "User" AS target_user ON target_user."id" = session."userId"
  WHERE session."userId" = target_user_id
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorizationState" = 'ACTIVE'
    AND session."authorityGeneration" = target_user."authorityGeneration"
    AND family."status" = 'ACTIVE'
    AND session."expiresAt" > captured_at
    AND session."createdAt" + INTERVAL '30 days' > captured_at;
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_reauthentication_token_digest"(TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_rotation_fence_token_digest"(TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_record_authority_revocation"(
  UUID, "Phase7AuthorityRevocationReason"
) FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

CREATE OR REPLACE FUNCTION "protect_phase7_account"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  erasure_mode BOOLEAN := "phase7_trusted_execution_active"('ERASURE');
  password_mode BOOLEAN :=
    "phase7_trusted_execution_active"('PASSWORD_CHANGE')
    OR "phase7_trusted_execution_active"('RESET_CONSUME');
  legacy_disabled BOOLEAN;
  legacy_login TEXT := CASE
    WHEN current_database() ~ '_test$' THEN 'nihongo_test_legacy_app_login'
    WHEN current_database() ~ '_dev$' THEN 'nihongo_development_legacy_app_login'
    ELSE NULL
  END;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."providerId" = 'credential' AND NOT erasure_mode THEN
      RAISE EXCEPTION 'Credential Account delete is erasure-only.'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."accountId" <> OLD."accountId"
    OR NEW."providerId" <> OLD."providerId" OR NEW."userId" <> OLD."userId"
    OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'Account identity is insert-only.' USING ERRCODE = '23514';
  END IF;
  IF OLD."providerId" = 'credential' THEN
    IF NOT password_mode AND SESSION_USER = legacy_login THEN
      SELECT "legacyIssuerDisabled" INTO legacy_disabled
      FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
      IF FOUND AND legacy_disabled IS NOT DISTINCT FROM false
        AND (to_jsonb(NEW) - 'password' - 'updatedAt') =
            (to_jsonb(OLD) - 'password' - 'updatedAt') THEN
        RETURN NEW;
      END IF;
    END IF;
    IF NOT password_mode THEN
      RAISE EXCEPTION 'Credential Account update requires owned password authority.'
        USING ERRCODE = '42501';
    END IF;
    IF (to_jsonb(NEW) - 'password' - 'updatedAt') <>
       (to_jsonb(OLD) - 'password' - 'updatedAt') THEN
      RAISE EXCEPTION 'Credential Account only permits password updates.'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."password" IS DISTINCT FROM OLD."password" THEN
      PERFORM "phase7_record_authority_revocation"(
        OLD."userId", 'SESSION_INVALIDATED'
      );
      UPDATE "User"
      SET "authorityGeneration" = "authorityGeneration" + 1,
          "updatedAt" = clock_timestamp()
      WHERE "id" = OLD."userId";
      UPDATE "AuthSessionFamily" SET "status" = 'REVOKED'
      WHERE "userId" = OLD."userId" AND "status" = 'ACTIVE';
      DELETE FROM "Session" WHERE "userId" = OLD."userId";
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION "validate_phase7_user_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  authority_invalidation BOOLEAN :=
    "phase7_trusted_execution_active"('PASSWORD_CHANGE')
    OR "phase7_trusted_execution_active"('RESET_CONSUME')
    OR "phase7_trusted_execution_active"('AUTHORITY_CHANGE');
  erasure_mode BOOLEAN := "phase7_trusted_execution_active"('ERASURE');
  revocation_reason "Phase7AuthorityRevocationReason";
BEGIN
  IF NEW."id" <> OLD."id" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'User identity is insert-only.' USING ERRCODE = '23514';
  END IF;
  IF NEW."role" IS DISTINCT FROM OLD."role"
    OR NEW."accountStatus" IS DISTINCT FROM OLD."accountStatus" THEN
    IF NOT authority_invalidation AND NOT erasure_mode THEN
      RAISE EXCEPTION 'User role/status change requires owned authority.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT erasure_mode AND EXISTS (
      SELECT 1 FROM "QuestionVersion"
      WHERE "createdByActorId" = OLD."id"
        AND "status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
    ) THEN
      RAISE EXCEPTION 'Open candidate blocks role/status authority change.'
        USING ERRCODE = '23514';
    END IF;
    IF NOT erasure_mode THEN
      revocation_reason := CASE
        WHEN OLD."role" = 'ADMIN'
          AND (NEW."role" <> 'ADMIN' OR NEW."accountStatus" <> 'ACTIVE')
          THEN 'ADMIN_AUTHORITY_LOST'::"Phase7AuthorityRevocationReason"
        ELSE 'SESSION_INVALIDATED'::"Phase7AuthorityRevocationReason"
      END;
      PERFORM "phase7_record_authority_revocation"(
        OLD."id", revocation_reason
      );
    END IF;
    NEW."authorityGeneration" := OLD."authorityGeneration" + 1;
    UPDATE "AuthSessionFamily" SET "status" = 'REVOKED'
      WHERE "userId" = OLD."id" AND "status" = 'ACTIVE';
    DELETE FROM "Session" WHERE "userId" = OLD."id";
  ELSIF NEW."authorityGeneration" <> OLD."authorityGeneration"
    AND NOT authority_invalidation AND NOT erasure_mode THEN
    RAISE EXCEPTION 'User authorityGeneration is server-owned.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION "validate_phase7_session_write"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  user_row "User"%ROWTYPE;
  family_row "AuthSessionFamily"%ROWTYPE;
  legacy_disabled BOOLEAN;
  trusted_reauthentication BOOLEAN :=
    "phase7_trusted_execution_active"('REAUTHENTICATE');
  trusted_v1 BOOLEAN :=
    "phase7_trusted_execution_active"('ISSUE_V1')
    OR trusted_reauthentication;
  trusted_refresh BOOLEAN := "phase7_trusted_execution_active"('REFRESH');
  trusted_delete BOOLEAN :=
    "phase7_trusted_execution_active"('SIGN_OUT')
    OR "phase7_trusted_execution_active"('ACTIVATE')
    OR trusted_reauthentication
    OR "phase7_trusted_execution_active"('PASSWORD_CHANGE')
    OR "phase7_trusted_execution_active"('RESET_CONSUME')
    OR "phase7_trusted_execution_active"('AUTHORITY_CHANGE')
    OR "phase7_trusted_execution_active"('FENCE_CLEANUP')
    OR "phase7_trusted_execution_active"('ERASURE');
  remember_session BOOLEAN := "phase7_trusted_execution_remember"();
  issued_at TIMESTAMPTZ(3);
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT trusted_delete THEN
      SELECT "legacyIssuerDisabled" INTO legacy_disabled
      FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
      IF NOT FOUND OR legacy_disabled IS DISTINCT FROM false
        OR OLD."issuerProtocolVersion" <> 'LEGACY' THEN
        RAISE EXCEPTION 'Session delete requires owned authority.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT "legacyIssuerDisabled" INTO legacy_disabled
      FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Auth issuer activation singleton is missing.'
        USING ERRCODE = '42501';
    END IF;
    SELECT * INTO user_row FROM "User" WHERE "id" = NEW."userId" FOR UPDATE;
    IF user_row."id" IS NULL OR user_row."accountStatus" <> 'ACTIVE' THEN
      RAISE EXCEPTION 'Session requires an active User.' USING ERRCODE = '42501';
    END IF;

    IF NEW."issuerProtocolVersion" = 'LEGACY' THEN
      IF legacy_disabled IS DISTINCT FROM false
        OR user_row."authorityGeneration" <> 1
        OR NEW."authorizationState" <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Legacy Session issuance is disabled.'
          USING ERRCODE = '42501';
      END IF;
      NEW."authorityGeneration" := 1;
      INSERT INTO "AuthSessionFamily" (
        "id", "userId", "status", "createdAt", "revokedAt"
      ) VALUES (
        NEW."sessionFamilyId", NEW."userId", 'ACTIVE', NEW."createdAt", NULL
      ) ON CONFLICT ("id") DO NOTHING;
    ELSE
      IF NOT trusted_v1 THEN
        RAISE EXCEPTION 'PHASE7_V1 Session requires the owned issuer.'
          USING ERRCODE = '42501';
      END IF;
      IF (trusted_reauthentication
          AND NEW."authorizationState" <> 'PENDING_REAUTH')
        OR (NOT trusted_reauthentication
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

    SELECT * INTO family_row FROM "AuthSessionFamily"
      WHERE "id" = NEW."sessionFamilyId" AND "userId" = NEW."userId"
      FOR SHARE;
    IF family_row."id" IS NULL OR family_row."status" <> 'ACTIVE'
      OR NEW."authorityGeneration" <> user_row."authorityGeneration" THEN
      RAISE EXCEPTION 'Session family/generation authority is invalid.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" <> OLD."id" OR NEW."token" <> OLD."token"
    OR NEW."userId" <> OLD."userId"
    OR NEW."sessionFamilyId" <> OLD."sessionFamilyId"
    OR NEW."createdAt" <> OLD."createdAt"
    OR NEW."authorityGeneration" <> OLD."authorityGeneration"
    OR NEW."issuerProtocolVersion" <> OLD."issuerProtocolVersion" THEN
    RAISE EXCEPTION 'Session authority identity is immutable.'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."authorizationState" = 'PENDING_REAUTH'
    AND NEW."authorizationState" = 'ACTIVE'
    AND trusted_reauthentication THEN
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
    SELECT "legacyIssuerDisabled" INTO legacy_disabled
    FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
    IF NOT FOUND OR legacy_disabled IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'Legacy Session refresh is disabled.'
        USING ERRCODE = '42501';
    END IF;
    NEW."expiresAt" := LEAST(
      NEW."expiresAt", OLD."createdAt" + INTERVAL '30 days'
    );
  ELSE
    IF NOT trusted_refresh OR NOT remember_session THEN
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
$function$;

REVOKE ALL ON FUNCTION "protect_phase7_account"(),
  "validate_phase7_user_change"(),
  "validate_phase7_session_write"()
FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

CREATE OR REPLACE FUNCTION "phase7_resolve_v1_principal"(raw_token TEXT)
RETURNS TABLE (
  "userId" UUID,
  "name" TEXT,
  "role" "UserRole",
  "targetLevel" "JlptLevel",
  "sessionId" UUID,
  "createdAt" TIMESTAMPTZ,
  "expiresAt" TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  checked_at TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_app');
  PERFORM "phase7_require_runtime_ready"();
  IF raw_token IS NULL OR raw_token = '' THEN RETURN; END IF;

  RETURN QUERY
  SELECT target_user."id", target_user."name"::TEXT, target_user."role",
    target_user."targetLevel", session."id", session."createdAt",
    session."expiresAt"
  FROM "Session" AS session
  JOIN "AuthSessionFamily" AS family
    ON family."id" = session."sessionFamilyId"
   AND family."userId" = session."userId"
  JOIN "User" AS target_user ON target_user."id" = session."userId"
  WHERE session."token" = raw_token
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorizationState" = 'ACTIVE'
    AND session."authorityGeneration" = target_user."authorityGeneration"
    AND target_user."accountStatus" = 'ACTIVE'
    AND family."status" = 'ACTIVE'
    AND session."expiresAt" > checked_at
    AND session."createdAt" + INTERVAL '30 days' > checked_at
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION "phase7_resolve_session_credential"(raw_token TEXT)
RETURNS TABLE (
  "userId" UUID,
  "passwordHash" TEXT,
  "authorityGeneration" INTEGER,
  "role" "UserRole",
  "accountStatus" "UserAccountStatus"
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  checked_at TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_runtime_ready"();
  IF raw_token IS NULL OR raw_token = '' THEN RETURN; END IF;

  RETURN QUERY
  SELECT target_user."id", credential."password",
    target_user."authorityGeneration", target_user."role",
    target_user."accountStatus"
  FROM "Session" AS session
  JOIN "AuthSessionFamily" AS family
    ON family."id" = session."sessionFamilyId"
   AND family."userId" = session."userId"
  JOIN "User" AS target_user ON target_user."id" = session."userId"
  JOIN "Account" AS credential
    ON credential."userId" = target_user."id"
   AND credential."providerId" = 'credential'
   AND credential."accountId" = target_user."id"::TEXT
   AND credential."password" IS NOT NULL
  WHERE session."token" = raw_token
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorizationState" = 'ACTIVE'
    AND session."authorityGeneration" = target_user."authorityGeneration"
    AND target_user."accountStatus" = 'ACTIVE'
    AND family."status" = 'ACTIVE'
    AND session."expiresAt" > checked_at
    AND session."createdAt" + INTERVAL '30 days' > checked_at
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION "phase7_refresh_remembered_session"(
  raw_token TEXT,
  captured_generation_value INTEGER,
  captured_role_value "UserRole",
  captured_status_value "UserAccountStatus"
)
RETURNS TABLE (
  "id" UUID,
  "updatedAt" TIMESTAMPTZ,
  "expiresAt" TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  target_user_id UUID;
  target_family_id UUID;
  target_session_id UUID;
  checked_at TIMESTAMPTZ(3);
  commit_checked_at TIMESTAMPTZ(3);
  final_checked_at TIMESTAMPTZ(3);
  execution_id UUID;
  result_row "Session"%ROWTYPE;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(NULL);
  PERFORM "phase7_require_runtime_ready"();
  SELECT session."userId", session."sessionFamilyId", session."id"
  INTO target_user_id, target_family_id, target_session_id
  FROM "Session" AS session
  WHERE session."token" = raw_token
    AND session."authorizationState" = 'ACTIVE';
  IF target_session_id IS NULL THEN RETURN; END IF;
  PERFORM 1 FROM "User" AS target_user
  WHERE target_user."id" = target_user_id FOR UPDATE;
  PERFORM 1 FROM "AuthSessionFamily" AS family
  WHERE family."id" = target_family_id
    AND family."userId" = target_user_id FOR UPDATE;
  PERFORM 1 FROM "Session" AS session
  WHERE session."id" = target_session_id FOR UPDATE;
  checked_at := clock_timestamp();
  PERFORM 1
  FROM "User" AS target_user
  JOIN "AuthSessionFamily" AS family
    ON family."userId" = target_user."id" AND family."id" = target_family_id
  JOIN "Session" AS session
    ON session."userId" = target_user."id"
   AND session."sessionFamilyId" = family."id"
   AND session."id" = target_session_id
  WHERE target_user."id" = target_user_id
    AND target_user."authorityGeneration" = captured_generation_value
    AND target_user."role" = captured_role_value
    AND target_user."accountStatus" = captured_status_value
    AND family."status" = 'ACTIVE'
    AND session."token" = raw_token
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorizationState" = 'ACTIVE'
    AND session."authorityGeneration" = captured_generation_value
    AND session."expiresAt" > checked_at
    AND session."createdAt" + INTERVAL '30 days' > checked_at
    AND session."expiresAt" > session."createdAt" + INTERVAL '1 day'
  FOR UPDATE OF session;
  IF NOT FOUND THEN RETURN; END IF;

  execution_id := "phase7_open_trusted_execution"(
    'REFRESH', target_user_id, true
  );
  UPDATE "Session" AS target_session
  SET "expiresAt" = target_session."expiresAt",
      "updatedAt" = target_session."updatedAt"
  WHERE target_session."id" = target_session_id
    AND target_session."authorizationState" = 'ACTIVE'
  RETURNING target_session.* INTO result_row;
  commit_checked_at := clock_timestamp();
  IF result_row."id" IS NULL OR NOT EXISTS (
    SELECT 1
    FROM "User" AS target_user
    JOIN "AuthSessionFamily" AS family
      ON family."userId" = target_user."id" AND family."id" = target_family_id
    JOIN "Session" AS session
      ON session."userId" = target_user."id"
     AND session."sessionFamilyId" = family."id"
     AND session."id" = target_session_id
    WHERE target_user."id" = target_user_id
      AND target_user."authorityGeneration" = captured_generation_value
      AND target_user."role" = captured_role_value
      AND target_user."accountStatus" = captured_status_value
      AND family."status" = 'ACTIVE'
      AND session."token" = raw_token
      AND session."issuerProtocolVersion" = 'PHASE7_V1'
      AND session."authorizationState" = 'ACTIVE'
      AND session."authorityGeneration" = captured_generation_value
      AND session."expiresAt" > commit_checked_at
      AND session."createdAt" + INTERVAL '30 days' > commit_checked_at
  ) THEN
    RAISE EXCEPTION 'Remembered Session lost authority before refresh commit.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN QUERY SELECT result_row."id", result_row."updatedAt",
    result_row."expiresAt";
END;
$function$;

CREATE OR REPLACE FUNCTION "phase7_refresh_current_remembered_session"(
  raw_token TEXT
)
RETURNS TABLE (
  "id" UUID,
  "updatedAt" TIMESTAMPTZ,
  "expiresAt" TIMESTAMPTZ,
  "refreshed" BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  target_session_id UUID;
  target_updated_at TIMESTAMPTZ(3);
  target_expires_at TIMESTAMPTZ(3);
  captured_generation INTEGER;
  captured_role "UserRole";
  captured_status "UserAccountStatus";
  checked_at TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_runtime_ready"();
  IF raw_token IS NULL OR raw_token = '' THEN RETURN; END IF;

  SELECT session."id", session."updatedAt", session."expiresAt",
    target_user."authorityGeneration", target_user."role",
    target_user."accountStatus"
  INTO target_session_id, target_updated_at, target_expires_at,
    captured_generation, captured_role, captured_status
  FROM "Session" AS session
  JOIN "AuthSessionFamily" AS family
    ON family."id" = session."sessionFamilyId"
   AND family."userId" = session."userId"
  JOIN "User" AS target_user ON target_user."id" = session."userId"
  WHERE session."token" = raw_token
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorizationState" = 'ACTIVE'
    AND session."authorityGeneration" = target_user."authorityGeneration"
    AND target_user."accountStatus" = 'ACTIVE'
    AND family."status" = 'ACTIVE'
    AND session."expiresAt" > checked_at
    AND session."createdAt" + INTERVAL '30 days' > checked_at
    AND session."expiresAt" > session."createdAt" + INTERVAL '1 day';
  IF target_session_id IS NULL THEN RETURN; END IF;

  IF target_updated_at + INTERVAL '24 hours' > checked_at THEN
    RETURN QUERY SELECT target_session_id, target_updated_at,
      target_expires_at, false;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT refreshed_session."id", refreshed_session."updatedAt",
    refreshed_session."expiresAt", true
  FROM "phase7_refresh_remembered_session"(
    raw_token, captured_generation, captured_role, captured_status
  ) AS refreshed_session;
END;
$function$;

CREATE FUNCTION "phase7_prepare_reauthentication"(
  raw_old_token TEXT,
  expected_actor_id UUID,
  request_id_value UUID,
  environment_value "AdminAuditEnvironment",
  intent_id_value UUID
)
RETURNS TABLE (
  "intentId" UUID,
  "operationId" UUID,
  "requestId" UUID,
  "email" TEXT,
  "expiresAt" TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  target_user_id UUID;
  target_family_id UUID;
  target_session_id UUID;
  target_generation INTEGER;
  target_email TEXT;
  target_intent_id UUID := intent_id_value;
  target_operation_id UUID := public.gen_random_uuid();
  stale_intent_id UUID;
  stale_session_id UUID;
  cleanup_execution_id UUID;
  checked_at TIMESTAMPTZ(3) := clock_timestamp();
  expiry TIMESTAMPTZ(3);
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(environment_value);
  PERFORM "phase7_require_runtime_ready"();
  IF raw_old_token IS NULL OR raw_old_token = ''
    OR expected_actor_id IS NULL OR request_id_value IS NULL
    OR intent_id_value IS NULL THEN
    RETURN;
  END IF;
  SELECT session."userId", session."sessionFamilyId", session."id",
    target_user."authorityGeneration", target_user."email"
  INTO target_user_id, target_family_id, target_session_id,
    target_generation, target_email
  FROM "Session" AS session
  JOIN "AuthSessionFamily" AS family
    ON family."id" = session."sessionFamilyId"
   AND family."userId" = session."userId"
  JOIN "User" AS target_user ON target_user."id" = session."userId"
  WHERE session."token" = raw_old_token
    AND session."userId" = expected_actor_id
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorizationState" = 'ACTIVE'
    AND session."authorityGeneration" = target_user."authorityGeneration"
    AND target_user."role" = 'ADMIN'
    AND target_user."accountStatus" = 'ACTIVE'
    AND target_user."emailVerified"
    AND family."status" = 'ACTIVE'
    AND session."expiresAt" > checked_at
    AND session."createdAt" + INTERVAL '30 days' > checked_at;
  IF target_session_id IS NULL THEN RETURN; END IF;

  PERFORM 1 FROM "User" WHERE "id" = target_user_id FOR UPDATE;
  PERFORM 1 FROM "AuthSessionFamily"
  WHERE "userId" = target_user_id AND "id" = target_family_id FOR UPDATE;
  SELECT intent."id", intent."stagedSessionId"
  INTO stale_intent_id, stale_session_id
  FROM "Phase7ReauthenticationIntent" AS intent
  WHERE intent."oldSessionId" = target_session_id
    AND intent."state" IN ('PREPARED', 'STAGED')
    AND intent."expiresAt" <= clock_timestamp()
  ORDER BY intent."id"
  LIMIT 1;
  PERFORM 1 FROM "Session" AS session
  WHERE session."userId" = target_user_id
    AND session."id" = ANY(
      array_remove(
        ARRAY[target_session_id, stale_session_id]::UUID[], NULL
      )
    )
  ORDER BY session."id"
  FOR UPDATE;
  IF stale_intent_id IS NOT NULL THEN
    PERFORM 1 FROM "Phase7ReauthenticationIntent" AS intent
    WHERE intent."id" = stale_intent_id FOR UPDATE;
    SELECT intent."id", intent."stagedSessionId"
    INTO stale_intent_id, stale_session_id
    FROM "Phase7ReauthenticationIntent" AS intent
    WHERE intent."id" = stale_intent_id
      AND intent."oldSessionId" = target_session_id
      AND intent."state" IN ('PREPARED', 'STAGED')
      AND intent."expiresAt" <= clock_timestamp();
    IF stale_intent_id IS NOT NULL THEN
      cleanup_execution_id := "phase7_open_trusted_execution"(
        'REAUTHENTICATE', target_user_id, false
      );
      DELETE FROM "Session" AS session
      WHERE session."id" = stale_session_id
        AND session."userId" = target_user_id
        AND session."sessionFamilyId" = target_family_id
        AND session."authorizationState" = 'PENDING_REAUTH';
      DELETE FROM "Phase7ReauthenticationIntent" AS intent
      WHERE intent."id" = stale_intent_id
        AND intent."oldSessionId" = target_session_id
        AND intent."state" IN ('PREPARED', 'STAGED')
        AND intent."expiresAt" <= clock_timestamp();
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Expired reauthentication intent cleanup lost its CAS.'
          USING ERRCODE = '40001';
      END IF;
      PERFORM "phase7_close_trusted_execution"(cleanup_execution_id);
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Phase7ReauthenticationIntent" AS intent
    WHERE intent."oldSessionId" = target_session_id
      AND intent."state" IN ('PREPARED', 'STAGED')
  ) THEN
    RAISE EXCEPTION 'A live reauthentication intent already owns this Session.'
      USING ERRCODE = '40001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "Session" AS session
    JOIN "AuthSessionFamily" AS family
      ON family."id" = session."sessionFamilyId"
     AND family."userId" = session."userId"
    JOIN "User" AS target_user ON target_user."id" = session."userId"
    WHERE session."id" = target_session_id
      AND session."token" = raw_old_token
      AND session."authorizationState" = 'ACTIVE'
      AND session."authorityGeneration" = target_generation
      AND target_user."authorityGeneration" = target_generation
      AND target_user."role" = 'ADMIN'
      AND target_user."accountStatus" = 'ACTIVE'
      AND family."status" = 'ACTIVE'
      AND session."expiresAt" > clock_timestamp()
      AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()
  ) THEN RETURN; END IF;

  expiry := clock_timestamp() + INTERVAL '2 minutes';
  INSERT INTO "Phase7ReauthenticationIntent" (
    "id", "operationId", "requestId", "userId", "oldSessionId",
    "oldTokenDigest", "oldFenceTokenDigest", "sessionFamilyId",
    "capturedAuthorityGeneration", "capturedRole",
    "capturedAccountStatus", "state", "environment", "createdAt",
    "expiresAt"
  ) VALUES (
    target_intent_id, target_operation_id, request_id_value, target_user_id,
    target_session_id, "phase7_reauthentication_token_digest"(raw_old_token),
    "phase7_rotation_fence_token_digest"(raw_old_token), target_family_id,
    target_generation, 'ADMIN', 'ACTIVE', 'PREPARED', environment_value,
    checked_at, expiry
  );
  RETURN QUERY SELECT target_intent_id, target_operation_id,
    request_id_value, target_email, expiry;
END;
$function$;

CREATE FUNCTION "phase7_reauthentication_adapter_session"(
  intent_id_value UUID,
  raw_token TEXT
)
RETURNS TABLE (
  "id" UUID,
  "expiresAt" TIMESTAMPTZ,
  "token" TEXT,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" UUID,
  "userName" TEXT,
  "userEmail" TEXT,
  "userEmailVerified" BOOLEAN,
  "userImage" TEXT,
  "userCreatedAt" TIMESTAMPTZ,
  "userUpdatedAt" TIMESTAMPTZ,
  "userRole" "UserRole",
  "userTargetLevel" "JlptLevel",
  "userAccountStatus" "UserAccountStatus",
  "userDeletedAt" TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  checked_at TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_runtime_ready"();
  IF intent_id_value IS NULL OR raw_token IS NULL OR raw_token = '' THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT session."id", session."expiresAt", session."token",
    session."createdAt", session."updatedAt", session."ipAddress",
    session."userAgent", session."userId", target_user."name"::TEXT,
    target_user."email", target_user."emailVerified", target_user."image",
    target_user."createdAt", target_user."updatedAt", target_user."role",
    target_user."targetLevel", target_user."accountStatus",
    target_user."deletedAt"
  FROM "Phase7ReauthenticationIntent" AS intent
  JOIN "Session" AS session
    ON session."id" = intent."oldSessionId"
   AND session."userId" = intent."userId"
   AND session."sessionFamilyId" = intent."sessionFamilyId"
  JOIN "AuthSessionFamily" AS family
    ON family."id" = session."sessionFamilyId"
   AND family."userId" = session."userId"
  JOIN "User" AS target_user ON target_user."id" = session."userId"
  WHERE intent."id" = intent_id_value
    AND intent."state" = 'PREPARED'
    AND intent."expiresAt" > checked_at
    AND intent."oldTokenDigest" =
      "phase7_reauthentication_token_digest"(raw_token)
    AND session."token" = raw_token
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorizationState" = 'ACTIVE'
    AND session."authorityGeneration" =
      intent."capturedAuthorityGeneration"
    AND target_user."authorityGeneration" =
      intent."capturedAuthorityGeneration"
    AND target_user."role" = 'ADMIN'
    AND target_user."accountStatus" = 'ACTIVE'
    AND family."status" = 'ACTIVE'
    AND session."expiresAt" > checked_at
    AND session."createdAt" + INTERVAL '30 days' > checked_at
  LIMIT 1;
END;
$function$;

CREATE FUNCTION "phase7_reauthentication_adapter_accounts"(
  intent_id_value UUID,
  user_id_value UUID
)
RETURNS TABLE (
  "id" UUID,
  "accountId" TEXT,
  "providerId" TEXT,
  "userId" UUID,
  "password" TEXT,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  checked_at TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_runtime_ready"();
  RETURN QUERY
  SELECT account."id", account."accountId", account."providerId",
    account."userId", account."password", account."createdAt",
    account."updatedAt"
  FROM "Phase7ReauthenticationIntent" AS intent
  JOIN "User" AS target_user ON target_user."id" = intent."userId"
  JOIN "Account" AS account
    ON account."userId" = target_user."id"
   AND account."providerId" = 'credential'
   AND account."accountId" = target_user."id"::TEXT
  WHERE intent."id" = intent_id_value
    AND intent."userId" = user_id_value
    AND intent."state" = 'PREPARED'
    AND intent."expiresAt" > clock_timestamp()
    AND target_user."authorityGeneration" =
      intent."capturedAuthorityGeneration"
    AND target_user."role" = 'ADMIN'
    AND target_user."accountStatus" = 'ACTIVE'
    AND account."password" IS NOT NULL
  LIMIT 1;
END;
$function$;

CREATE FUNCTION "phase7_reauthentication_adapter_subject"(
  intent_id_value UUID,
  normalized_email TEXT
)
RETURNS TABLE (
  "id" UUID,
  "name" TEXT,
  "email" TEXT,
  "emailVerified" BOOLEAN,
  "image" TEXT,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ,
  "role" "UserRole",
  "targetLevel" "JlptLevel",
  "accountStatus" "UserAccountStatus",
  "deletedAt" TIMESTAMPTZ,
  "accountId" UUID,
  "credentialAccountId" TEXT,
  "credentialProviderId" TEXT,
  "credentialPassword" TEXT,
  "accountCreatedAt" TIMESTAMPTZ,
  "accountUpdatedAt" TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_runtime_ready"();
  IF normalized_email IS NULL
    OR normalized_email <> lower(btrim(normalized_email)) THEN RETURN; END IF;
  RETURN QUERY
  SELECT target_user."id", target_user."name"::TEXT, target_user."email",
    target_user."emailVerified", target_user."image",
    target_user."createdAt", target_user."updatedAt", target_user."role",
    target_user."targetLevel", target_user."accountStatus",
    target_user."deletedAt", account."id",
    account."accountId", account."providerId", account."password",
    account."createdAt", account."updatedAt"
  FROM "Phase7ReauthenticationIntent" AS intent
  JOIN "User" AS target_user ON target_user."id" = intent."userId"
  JOIN "Account" AS account
    ON account."userId" = target_user."id"
   AND account."providerId" = 'credential'
   AND account."accountId" = target_user."id"::TEXT
  WHERE intent."id" = intent_id_value
    AND intent."state" = 'PREPARED'
    AND intent."expiresAt" > clock_timestamp()
    AND target_user."email" = normalized_email
    AND target_user."authorityGeneration" =
      intent."capturedAuthorityGeneration"
    AND target_user."role" = 'ADMIN'
    AND target_user."accountStatus" = 'ACTIVE'
    AND target_user."emailVerified"
    AND account."password" IS NOT NULL
  LIMIT 1;
END;
$function$;

CREATE FUNCTION "phase7_stage_reauthentication_session"(
  intent_id_value UUID,
  session_id_value UUID,
  raw_new_token TEXT,
  user_id_value UUID,
  expires_at_value TIMESTAMPTZ,
  ip_address_value TEXT,
  user_agent_value TEXT
)
RETURNS TABLE (
  "id" UUID,
  "expiresAt" TIMESTAMPTZ,
  "token" TEXT,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  intent "Phase7ReauthenticationIntent"%ROWTYPE;
  result_row "Session"%ROWTYPE;
  execution_id UUID;
  checked_at TIMESTAMPTZ(3);
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(NULL);
  PERFORM "phase7_require_runtime_ready"();
  IF session_id_value IS NULL OR raw_new_token IS NULL OR raw_new_token = ''
    OR user_id_value IS NULL OR expires_at_value IS NULL THEN RETURN; END IF;

  SELECT intent_row.* INTO intent
  FROM "Phase7ReauthenticationIntent" AS intent_row
  WHERE intent_row."id" = intent_id_value;
  IF intent."id" IS NULL THEN RETURN; END IF;
  PERFORM 1 FROM "User" AS target_user
  WHERE target_user."id" = intent."userId" FOR UPDATE;
  PERFORM 1 FROM "AuthSessionFamily" AS family
  WHERE family."userId" = intent."userId"
    AND family."id" = intent."sessionFamilyId"
  FOR UPDATE;
  SELECT intent_row.* INTO intent
  FROM "Phase7ReauthenticationIntent" AS intent_row
  WHERE intent_row."id" = intent_id_value FOR UPDATE;
  checked_at := clock_timestamp();
  IF intent."state" <> 'PREPARED' OR intent."expiresAt" <= checked_at
    OR intent."userId" <> user_id_value
    OR expires_at_value < checked_at + INTERVAL '23 hours 55 minutes'
    OR expires_at_value > checked_at + INTERVAL '24 hours 5 minutes'
    OR NOT EXISTS (
      SELECT 1
      FROM "User" AS target_user
      JOIN "AuthSessionFamily" AS family
        ON family."userId" = target_user."id"
       AND family."id" = intent."sessionFamilyId"
      JOIN "Session" AS old_session
        ON old_session."id" = intent."oldSessionId"
       AND old_session."userId" = target_user."id"
       AND old_session."sessionFamilyId" = family."id"
      WHERE target_user."id" = intent."userId"
        AND target_user."authorityGeneration" =
          intent."capturedAuthorityGeneration"
        AND target_user."role" = 'ADMIN'
        AND target_user."accountStatus" = 'ACTIVE'
        AND family."status" = 'ACTIVE'
        AND old_session."issuerProtocolVersion" = 'PHASE7_V1'
        AND old_session."authorizationState" = 'ACTIVE'
        AND old_session."authorityGeneration" =
          intent."capturedAuthorityGeneration"
        AND "phase7_reauthentication_token_digest"(old_session."token") =
          intent."oldTokenDigest"
        AND old_session."expiresAt" > checked_at
        AND old_session."createdAt" + INTERVAL '30 days' > checked_at
    ) THEN RETURN; END IF;

  execution_id := "phase7_open_trusted_execution"(
    'REAUTHENTICATE', intent."userId", false
  );
  INSERT INTO "Session" (
    "id", "expiresAt", "token", "createdAt", "updatedAt", "ipAddress",
    "userAgent", "userId", "sessionFamilyId", "authorityGeneration",
    "issuerProtocolVersion", "authorizationState"
  ) VALUES (
    session_id_value, expires_at_value, raw_new_token, checked_at, checked_at,
    left(COALESCE(ip_address_value, ''), 512),
    left(COALESCE(user_agent_value, ''), 512), intent."userId",
    intent."sessionFamilyId", intent."capturedAuthorityGeneration",
    'PHASE7_V1', 'PENDING_REAUTH'
  ) RETURNING * INTO result_row;
  UPDATE "Phase7ReauthenticationIntent" AS target_intent
  SET "state" = 'STAGED', "stagedSessionId" = result_row."id",
      "stagedTokenDigest" =
        "phase7_reauthentication_token_digest"(raw_new_token)
  WHERE target_intent."id" = intent."id"
    AND target_intent."state" = 'PREPARED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reauthentication intent was already consumed.'
      USING ERRCODE = '40001';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN QUERY SELECT result_row."id", result_row."expiresAt",
    result_row."token", result_row."createdAt", result_row."updatedAt",
    result_row."ipAddress", result_row."userAgent", result_row."userId";
END;
$function$;

CREATE FUNCTION "phase7_finalize_reauthentication"(
  intent_id_value UUID,
  raw_new_token TEXT
)
RETURNS TABLE (
  "id" UUID,
  "familyId" UUID,
  "createdAt" TIMESTAMPTZ,
  "expiresAt" TIMESTAMPTZ,
  "authorityGeneration" INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  intent "Phase7ReauthenticationIntent"%ROWTYPE;
  old_session "Session"%ROWTYPE;
  pending_session "Session"%ROWTYPE;
  activated_session "Session"%ROWTYPE;
  deleted_session "Session"%ROWTYPE;
  checked_at TIMESTAMPTZ(3);
  commit_checked_at TIMESTAMPTZ(3);
  final_checked_at TIMESTAMPTZ(3);
  before_state TEXT;
  execution_id UUID;
  digest_value VARCHAR(64);
  metadata_value JSONB :=
    '{"kind":"REAUTHENTICATION_V1","rotation":"OLD_REVOKED_NEW_ISSUED"}'::JSONB;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(NULL);
  PERFORM "phase7_require_runtime_ready"();
  IF intent_id_value IS NULL OR raw_new_token IS NULL
    OR raw_new_token = '' THEN
    RAISE EXCEPTION 'Reauthentication finalization proof is invalid.'
      USING ERRCODE = '22023';
  END IF;

  SELECT intent_row.* INTO intent
  FROM "Phase7ReauthenticationIntent" AS intent_row
  WHERE intent_row."id" = intent_id_value;
  IF intent."id" IS NULL THEN
    RAISE EXCEPTION 'Reauthentication finalization intent is unavailable.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM "User" AS target_user
  WHERE target_user."id" = intent."userId" FOR UPDATE;
  PERFORM 1 FROM "AuthSessionFamily" AS family
  WHERE family."userId" = intent."userId"
    AND family."id" = intent."sessionFamilyId"
  FOR UPDATE;
  PERFORM 1 FROM "Session" AS locked_session
  WHERE locked_session."id" IN (
      intent."oldSessionId", intent."stagedSessionId"
    )
    AND locked_session."userId" = intent."userId"
  ORDER BY locked_session."id" FOR UPDATE;
  SELECT intent_row.* INTO intent
  FROM "Phase7ReauthenticationIntent" AS intent_row
  WHERE intent_row."id" = intent_id_value FOR UPDATE;
  IF intent."id" IS NULL THEN
    RAISE EXCEPTION 'Reauthentication finalization intent is unavailable.'
      USING ERRCODE = '42501';
  END IF;
  checked_at := clock_timestamp();
  IF intent."state" <> 'STAGED' OR intent."expiresAt" <= checked_at
    OR intent."stagedTokenDigest" IS DISTINCT FROM
      "phase7_reauthentication_token_digest"(raw_new_token) THEN
    RAISE EXCEPTION 'Reauthentication finalization intent proof failed.'
      USING ERRCODE = '42501';
  END IF;

  SELECT old_session_row.* INTO old_session
  FROM "Session" AS old_session_row
  WHERE old_session_row."id" = intent."oldSessionId"
    AND old_session_row."userId" = intent."userId"
    AND old_session_row."sessionFamilyId" = intent."sessionFamilyId"
    AND old_session_row."issuerProtocolVersion" = 'PHASE7_V1'
    AND old_session_row."authorizationState" = 'ACTIVE';
  SELECT pending_session_row.* INTO pending_session
  FROM "Session" AS pending_session_row
  WHERE pending_session_row."id" = intent."stagedSessionId"
    AND pending_session_row."userId" = intent."userId"
    AND pending_session_row."sessionFamilyId" = intent."sessionFamilyId"
    AND pending_session_row."token" = raw_new_token
    AND pending_session_row."authorizationState" = 'PENDING_REAUTH';
  IF old_session."id" IS NULL OR pending_session."id" IS NULL
    OR "phase7_reauthentication_token_digest"(old_session."token")
      IS DISTINCT FROM intent."oldTokenDigest"
    OR pending_session."issuerProtocolVersion" <> 'PHASE7_V1'
    OR pending_session."authorityGeneration" <>
      intent."capturedAuthorityGeneration"
    OR pending_session."expiresAt" - pending_session."createdAt"
      <> INTERVAL '1 day'
    OR NOT EXISTS (
      SELECT 1 FROM "User" AS target_user
      JOIN "AuthSessionFamily" AS family
        ON family."userId" = target_user."id"
       AND family."id" = intent."sessionFamilyId"
      WHERE target_user."id" = intent."userId"
        AND target_user."authorityGeneration" =
          intent."capturedAuthorityGeneration"
        AND target_user."role" = intent."capturedRole"
        AND target_user."accountStatus" = intent."capturedAccountStatus"
        AND family."status" = 'ACTIVE'
    )
    OR old_session."expiresAt" <= checked_at
    OR old_session."createdAt" + INTERVAL '30 days' <= checked_at
    OR pending_session."expiresAt" <= checked_at THEN
    RAISE EXCEPTION 'Reauthentication finalization authority proof failed.'
      USING ERRCODE = '42501';
  END IF;
  before_state := CASE
    WHEN old_session."createdAt" + INTERVAL '5 minutes' > checked_at
      THEN 'SESSION_FRESH'
    ELSE 'SESSION_STALE'
  END;

  INSERT INTO "Phase7OperationIntent" (
    "operationId", "requestId", "command", "actorUserId",
    "actorSessionId", "actorFamilyId", "capturedAuthorityGeneration",
    "referencedUserIds", "requiresFresh", "environment", "occurredAt",
    "backendPid", "transactionId"
  ) VALUES (
    intent."operationId", intent."requestId", 'REAUTHENTICATION',
    intent."userId", intent."stagedSessionId", intent."sessionFamilyId",
    intent."capturedAuthorityGeneration", ARRAY[intent."userId"]::UUID[],
    false, intent."environment", checked_at, pg_backend_pid(), txid_current()
  );
  execution_id := "phase7_open_trusted_execution"(
    'REAUTHENTICATE', intent."userId", false
  );
  UPDATE "Session" AS target_session
  SET "authorizationState" = 'ACTIVE'
  WHERE target_session."id" = pending_session."id"
    AND target_session."token" = raw_new_token
    AND target_session."authorizationState" = 'PENDING_REAUTH'
  RETURNING target_session.* INTO activated_session;
  IF activated_session."id" IS NULL THEN
    RAISE EXCEPTION 'Pending Session activation CAS failed.'
      USING ERRCODE = '40001';
  END IF;
  DELETE FROM "Session" AS session
  WHERE session."id" = old_session."id"
    AND session."userId" = intent."userId"
    AND session."sessionFamilyId" = intent."sessionFamilyId"
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorizationState" = 'ACTIVE'
    AND "phase7_reauthentication_token_digest"(session."token") =
      intent."oldTokenDigest"
    AND session."authorityGeneration" = intent."capturedAuthorityGeneration"
  RETURNING session.* INTO deleted_session;
  IF deleted_session."id" IS NULL THEN
    RAISE EXCEPTION 'Reauthentication old Session exact CAS failed.'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO "AuthSessionRotationFence" (
    "oldSessionId", "oldTokenDigest", "userId", "oldFamilyId",
    "replacementFamilyId", "replacementSessionId", "operationId", "expiresAt"
  ) VALUES (
    deleted_session."id", intent."oldFenceTokenDigest", intent."userId",
    intent."sessionFamilyId", intent."sessionFamilyId",
    activated_session."id", intent."operationId",
    activated_session."expiresAt"
  );
  digest_value := "phase7_admin_audit_content_digest"(
    intent."operationId", 'REAUTHENTICATION', 'ADMIN_SESSION',
    intent."operationId", before_state, 'SESSION_FRESH', NULL, NULL,
    '["SESSION_ROTATION"]'::JSONB, metadata_value
  );
  INSERT INTO "AdminAuditLog" (
    "command", "targetType", "targetId", "actorKind", "actorUserId",
    "actorId", "actorRole", "actorLabel", "actorSystemLabel",
    "beforeState", "afterState", "beforeRowVersion", "afterRowVersion",
    "changedFields", "metadata", "contentDigest", "operationId",
    "requestId", "environment", "occurredAt"
  ) VALUES (
    'REAUTHENTICATION', 'ADMIN_SESSION', intent."operationId",
    'ACCOUNT', intent."userId", intent."userId", 'ADMIN', 'ACTIVE_ADMIN',
    NULL, before_state, 'SESSION_FRESH', NULL, NULL,
    '["SESSION_ROTATION"]'::JSONB, metadata_value, digest_value,
    intent."operationId", intent."requestId", intent."environment", checked_at
  );

  commit_checked_at := clock_timestamp();
  IF NOT EXISTS (
    SELECT 1
    FROM "User" AS target_user
    JOIN "AuthSessionFamily" AS family
      ON family."userId" = target_user."id"
     AND family."id" = intent."sessionFamilyId"
    JOIN "Session" AS session
      ON session."id" = activated_session."id"
     AND session."userId" = target_user."id"
     AND session."sessionFamilyId" = family."id"
    WHERE target_user."authorityGeneration" =
        intent."capturedAuthorityGeneration"
      AND target_user."role" = 'ADMIN'
      AND target_user."accountStatus" = 'ACTIVE'
      AND family."status" = 'ACTIVE'
      AND session."token" = raw_new_token
      AND session."issuerProtocolVersion" = 'PHASE7_V1'
      AND session."authorizationState" = 'ACTIVE'
      AND session."authorityGeneration" =
        intent."capturedAuthorityGeneration"
      AND old_session."expiresAt" > commit_checked_at
      AND old_session."createdAt" + INTERVAL '30 days' > commit_checked_at
      AND session."expiresAt" > commit_checked_at
      AND session."createdAt" + INTERVAL '30 days' > commit_checked_at
  ) THEN
    RAISE EXCEPTION 'Reauthentication authority expired before commit.'
      USING ERRCODE = '42501';
  END IF;
  UPDATE "Phase7ReauthenticationIntent" AS target_intent
  SET "state" = 'FINALIZED', "finalizedAt" = commit_checked_at
  WHERE target_intent."id" = intent."id"
    AND target_intent."state" = 'STAGED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reauthentication finalization intent CAS failed.'
      USING ERRCODE = '40001';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  PERFORM "phase7_finish_admin_operation"(intent."operationId");
  final_checked_at := clock_timestamp();
  IF old_session."expiresAt" <= final_checked_at
    OR old_session."createdAt" + INTERVAL '30 days' <= final_checked_at
    OR NOT EXISTS (
      SELECT 1
      FROM "User" AS target_user
      JOIN "AuthSessionFamily" AS family
        ON family."userId" = target_user."id"
       AND family."id" = intent."sessionFamilyId"
      JOIN "Session" AS session
        ON session."id" = activated_session."id"
       AND session."userId" = target_user."id"
       AND session."sessionFamilyId" = family."id"
      WHERE target_user."authorityGeneration" =
          intent."capturedAuthorityGeneration"
        AND target_user."role" = 'ADMIN'
        AND target_user."accountStatus" = 'ACTIVE'
        AND family."status" = 'ACTIVE'
        AND session."token" = raw_new_token
        AND session."issuerProtocolVersion" = 'PHASE7_V1'
        AND session."authorizationState" = 'ACTIVE'
        AND session."authorityGeneration" =
          intent."capturedAuthorityGeneration"
        AND session."expiresAt" > final_checked_at
        AND session."createdAt" + INTERVAL '30 days' > final_checked_at
    ) THEN
    RAISE EXCEPTION 'Reauthentication authority expired before commit.'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT activated_session."id",
    activated_session."sessionFamilyId", activated_session."createdAt",
    activated_session."expiresAt", activated_session."authorityGeneration";
END;
$function$;

CREATE FUNCTION "phase7_reconcile_reauthentication"(
  intent_id_value UUID,
  raw_new_token TEXT
)
RETURNS TABLE (
  "state" TEXT,
  "id" UUID,
  "familyId" UUID,
  "createdAt" TIMESTAMPTZ,
  "expiresAt" TIMESTAMPTZ,
  "authorityGeneration" INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  checked_at TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_runtime_ready"();
  RETURN QUERY
  SELECT intent."state"::TEXT, session."id", session."sessionFamilyId",
    session."createdAt", session."expiresAt", session."authorityGeneration"
  FROM "Phase7ReauthenticationIntent" AS intent
  JOIN "Session" AS session
    ON session."id" = intent."stagedSessionId"
   AND session."userId" = intent."userId"
   AND session."sessionFamilyId" = intent."sessionFamilyId"
  JOIN "AuthSessionFamily" AS family
    ON family."id" = session."sessionFamilyId"
   AND family."userId" = session."userId"
  JOIN "User" AS target_user ON target_user."id" = session."userId"
  JOIN "AuthSessionRotationFence" AS fence
    ON fence."operationId" = intent."operationId"
   AND fence."replacementSessionId" = session."id"
   AND fence."oldSessionId" = intent."oldSessionId"
   AND fence."oldTokenDigest" = intent."oldFenceTokenDigest"
   AND fence."userId" = intent."userId"
   AND fence."oldFamilyId" = intent."sessionFamilyId"
   AND fence."replacementFamilyId" = intent."sessionFamilyId"
   AND fence."expiresAt" = session."expiresAt"
  JOIN "AdminAuditLog" AS audit
   ON audit."operationId" = intent."operationId"
   AND audit."command" = 'REAUTHENTICATION'
   AND audit."targetType" = 'ADMIN_SESSION'
   AND audit."targetId" = intent."operationId"
   AND audit."actorKind" = 'ACCOUNT'
   AND audit."actorUserId" = intent."userId"
   AND audit."actorId" = intent."userId"
   AND audit."actorRole" = 'ADMIN'
   AND audit."actorLabel" = 'ACTIVE_ADMIN'
   AND audit."actorSystemLabel" IS NULL
   AND audit."beforeState" IN ('SESSION_FRESH', 'SESSION_STALE')
   AND audit."afterState" = 'SESSION_FRESH'
   AND audit."beforeRowVersion" IS NULL
   AND audit."afterRowVersion" IS NULL
   AND audit."changedFields" = '["SESSION_ROTATION"]'::JSONB
   AND audit."metadata" =
     '{"kind":"REAUTHENTICATION_V1","rotation":"OLD_REVOKED_NEW_ISSUED"}'::JSONB
   AND audit."requestId" = intent."requestId"
   AND audit."environment" = intent."environment"
   AND audit."contentDigest" = "phase7_admin_audit_content_digest"(
     intent."operationId", 'REAUTHENTICATION', 'ADMIN_SESSION',
     intent."operationId", audit."beforeState", 'SESSION_FRESH', NULL,
     NULL, '["SESSION_ROTATION"]'::JSONB,
     '{"kind":"REAUTHENTICATION_V1","rotation":"OLD_REVOKED_NEW_ISSUED"}'::JSONB
   )
  WHERE intent."id" = intent_id_value
    AND intent."state" = 'FINALIZED'
    AND intent."stagedTokenDigest" =
      "phase7_reauthentication_token_digest"(raw_new_token)
    AND session."token" = raw_new_token
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorizationState" = 'ACTIVE'
    AND session."authorityGeneration" =
      intent."capturedAuthorityGeneration"
    AND target_user."authorityGeneration" =
      intent."capturedAuthorityGeneration"
    AND target_user."role" = 'ADMIN'
    AND target_user."accountStatus" = 'ACTIVE'
    AND family."status" = 'ACTIVE'
    AND session."expiresAt" > checked_at
    AND session."createdAt" + INTERVAL '30 days' > checked_at
  LIMIT 1;
END;
$function$;

CREATE FUNCTION "phase7_abort_reauthentication"(intent_id_value UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  intent "Phase7ReauthenticationIntent"%ROWTYPE;
  execution_id UUID;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(NULL);
  PERFORM "phase7_require_runtime_ready"();
  SELECT * INTO intent FROM "Phase7ReauthenticationIntent"
  WHERE "id" = intent_id_value;
  IF intent."id" IS NULL THEN RETURN true; END IF;
  IF intent."state" = 'FINALIZED' THEN RETURN false; END IF;
  PERFORM 1 FROM "User" WHERE "id" = intent."userId" FOR UPDATE;
  PERFORM 1 FROM "AuthSessionFamily"
  WHERE "userId" = intent."userId" AND "id" = intent."sessionFamilyId"
  FOR UPDATE;
  IF intent."stagedSessionId" IS NOT NULL THEN
    PERFORM 1 FROM "Session"
    WHERE "id" = intent."stagedSessionId" FOR UPDATE;
  END IF;
  SELECT * INTO intent FROM "Phase7ReauthenticationIntent"
  WHERE "id" = intent_id_value FOR UPDATE;
  IF intent."state" = 'FINALIZED' THEN RETURN false; END IF;
  execution_id := "phase7_open_trusted_execution"(
    'REAUTHENTICATE', intent."userId", false
  );
  DELETE FROM "Session"
  WHERE "id" = intent."stagedSessionId"
    AND "userId" = intent."userId"
    AND "sessionFamilyId" = intent."sessionFamilyId"
    AND "authorizationState" = 'PENDING_REAUTH';
  DELETE FROM "Phase7ReauthenticationIntent"
  WHERE "id" = intent."id" AND "state" <> 'FINALIZED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reauthentication abort intent CAS failed.'
      USING ERRCODE = '40001';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN true;
END;
$function$;

CREATE FUNCTION "phase7_abort_reauthentication_classified"(
  intent_id_value UUID,
  raw_old_token TEXT
)
RETURNS TABLE ("aborted" BOOLEAN, "outcome" TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  intent "Phase7ReauthenticationIntent"%ROWTYPE;
  execution_id UUID;
  outcome_value TEXT;
  active_admin BOOLEAN;
  authority_lost BOOLEAN;
  live_non_admin BOOLEAN;
  checked_at TIMESTAMPTZ(3);
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(NULL);
  PERFORM "phase7_require_runtime_ready"();
  IF intent_id_value IS NULL OR raw_old_token IS NULL
    OR raw_old_token = '' THEN RETURN; END IF;
  SELECT * INTO intent FROM "Phase7ReauthenticationIntent"
  WHERE "id" = intent_id_value;
  IF intent."id" IS NULL THEN RETURN; END IF;

  PERFORM 1 FROM "User" WHERE "id" = intent."userId" FOR UPDATE;
  PERFORM 1 FROM "AuthSessionFamily"
  WHERE "userId" = intent."userId" AND "id" = intent."sessionFamilyId"
  FOR UPDATE;
  PERFORM 1 FROM "Session" AS session
  WHERE session."id" IN (intent."oldSessionId", intent."stagedSessionId")
    AND session."userId" = intent."userId"
  ORDER BY session."id" FOR UPDATE;
  SELECT * INTO intent FROM "Phase7ReauthenticationIntent"
  WHERE "id" = intent_id_value FOR UPDATE;
  IF intent."id" IS NULL THEN RETURN; END IF;
  IF intent."oldTokenDigest" <>
    "phase7_reauthentication_token_digest"(raw_old_token) THEN
    RAISE EXCEPTION 'Classified reauthentication abort token mismatch.'
      USING ERRCODE = '22023';
  END IF;

  checked_at := clock_timestamp();
  SELECT EXISTS (
    SELECT 1
    FROM "Session" AS session
    JOIN "AuthSessionFamily" AS family
      ON family."id" = session."sessionFamilyId"
     AND family."userId" = session."userId"
    JOIN "User" AS target_user ON target_user."id" = session."userId"
    WHERE session."id" = intent."oldSessionId"
      AND session."userId" = intent."userId"
      AND session."sessionFamilyId" = intent."sessionFamilyId"
      AND session."token" = raw_old_token
      AND intent."oldTokenDigest" =
        "phase7_reauthentication_token_digest"(raw_old_token)
      AND session."issuerProtocolVersion" = 'PHASE7_V1'
      AND session."authorizationState" = 'ACTIVE'
      AND session."authorityGeneration" =
        intent."capturedAuthorityGeneration"
      AND target_user."authorityGeneration" =
        intent."capturedAuthorityGeneration"
      AND target_user."role" = 'ADMIN'
      AND target_user."accountStatus" = 'ACTIVE'
      AND family."status" = 'ACTIVE'
      AND session."expiresAt" > checked_at
      AND session."createdAt" + INTERVAL '30 days' > checked_at
  ), EXISTS (
    SELECT 1 FROM "Phase7AuthorityRevocationEvidence" AS evidence
    WHERE evidence."tokenDigest" =
      "phase7_reauthentication_token_digest"(raw_old_token)
      AND evidence."reason" = 'ADMIN_AUTHORITY_LOST'
      AND evidence."expiresAt" > checked_at
  ), EXISTS (
    SELECT 1
    FROM "Session" AS session
    JOIN "AuthSessionFamily" AS family
      ON family."id" = session."sessionFamilyId"
     AND family."userId" = session."userId"
    JOIN "User" AS target_user ON target_user."id" = session."userId"
    WHERE session."token" = raw_old_token
      AND session."issuerProtocolVersion" = 'PHASE7_V1'
      AND session."authorizationState" = 'ACTIVE'
      AND session."authorityGeneration" = target_user."authorityGeneration"
      AND family."status" = 'ACTIVE'
      AND session."expiresAt" > checked_at
      AND session."createdAt" + INTERVAL '30 days' > checked_at
      AND (target_user."role" <> 'ADMIN'
        OR target_user."accountStatus" <> 'ACTIVE')
  ) INTO active_admin, authority_lost, live_non_admin;
  IF active_admin THEN
    outcome_value := 'ACTIVE_ADMIN';
  ELSIF authority_lost OR live_non_admin THEN
    outcome_value := 'ADMIN_REQUIRED';
  ELSE
    outcome_value := 'AUTH_SESSION_EXPIRED';
  END IF;

  IF intent."state" = 'FINALIZED' THEN
    RETURN QUERY SELECT false, outcome_value;
    RETURN;
  END IF;
  execution_id := "phase7_open_trusted_execution"(
    'REAUTHENTICATE', intent."userId", false
  );
  DELETE FROM "Session"
  WHERE "id" = intent."stagedSessionId"
    AND "userId" = intent."userId"
    AND "sessionFamilyId" = intent."sessionFamilyId"
    AND "authorizationState" = 'PENDING_REAUTH';
  DELETE FROM "Phase7ReauthenticationIntent"
  WHERE "id" = intent."id" AND "state" <> 'FINALIZED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Classified reauthentication abort intent CAS failed.'
      USING ERRCODE = '40001';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN QUERY SELECT true, outcome_value;
END;
$function$;

CREATE FUNCTION "phase7_compensate_reauthentication"(
  intent_id_value UUID,
  raw_new_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  intent "Phase7ReauthenticationIntent"%ROWTYPE;
  execution_id UUID;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(NULL);
  PERFORM "phase7_require_runtime_ready"();
  IF intent_id_value IS NULL OR raw_new_token IS NULL
    OR raw_new_token = '' THEN RETURN false; END IF;
  SELECT * INTO intent FROM "Phase7ReauthenticationIntent"
  WHERE "id" = intent_id_value;
  IF intent."id" IS NULL OR intent."stagedSessionId" IS NULL
    OR intent."stagedTokenDigest" IS DISTINCT FROM
      "phase7_reauthentication_token_digest"(raw_new_token) THEN
    RETURN false;
  END IF;

  PERFORM 1 FROM "User" WHERE "id" = intent."userId" FOR UPDATE;
  PERFORM 1 FROM "AuthSessionFamily"
  WHERE "userId" = intent."userId" AND "id" = intent."sessionFamilyId"
  FOR UPDATE;
  PERFORM 1 FROM "Session" AS session
  WHERE session."id" IN (intent."oldSessionId", intent."stagedSessionId")
    AND session."userId" = intent."userId"
  ORDER BY session."id" FOR UPDATE;
  SELECT * INTO intent FROM "Phase7ReauthenticationIntent"
  WHERE "id" = intent_id_value FOR UPDATE;
  IF intent."id" IS NULL OR intent."stagedSessionId" IS NULL
    OR intent."stagedTokenDigest" IS DISTINCT FROM
      "phase7_reauthentication_token_digest"(raw_new_token) THEN
    RETURN false;
  END IF;

  IF intent."state" = 'STAGED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "Session" AS session
      WHERE session."id" = intent."stagedSessionId"
        AND session."userId" = intent."userId"
        AND session."sessionFamilyId" = intent."sessionFamilyId"
        AND session."token" = raw_new_token
        AND session."authorizationState" = 'PENDING_REAUTH'
    ) THEN RETURN false; END IF;
    execution_id := "phase7_open_trusted_execution"(
      'REAUTHENTICATE', intent."userId", false
    );
    DELETE FROM "Session" AS session
    WHERE session."id" = intent."stagedSessionId"
      AND session."userId" = intent."userId"
      AND session."sessionFamilyId" = intent."sessionFamilyId"
      AND session."token" = raw_new_token
      AND session."authorizationState" = 'PENDING_REAUTH';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Pending reauthentication compensation lost its CAS.'
        USING ERRCODE = '40001';
    END IF;
    DELETE FROM "Phase7ReauthenticationIntent"
    WHERE "id" = intent."id" AND "state" = 'STAGED';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Staged reauthentication compensation lost its CAS.'
        USING ERRCODE = '40001';
    END IF;
    PERFORM "phase7_close_trusted_execution"(execution_id);
    RETURN true;
  END IF;

  IF intent."state" <> 'FINALIZED' OR NOT EXISTS (
    SELECT 1
    FROM "AuthSessionRotationFence" AS fence
    JOIN "AdminAuditLog" AS audit
      ON audit."operationId" = intent."operationId"
     AND audit."command" = 'REAUTHENTICATION'
     AND audit."targetType" = 'ADMIN_SESSION'
     AND audit."targetId" = intent."operationId"
     AND audit."actorKind" = 'ACCOUNT'
     AND audit."actorUserId" = intent."userId"
     AND audit."actorId" = intent."userId"
     AND audit."actorRole" = 'ADMIN'
     AND audit."actorLabel" = 'ACTIVE_ADMIN'
     AND audit."actorSystemLabel" IS NULL
     AND audit."beforeState" IN ('SESSION_FRESH', 'SESSION_STALE')
     AND audit."afterState" = 'SESSION_FRESH'
     AND audit."beforeRowVersion" IS NULL
     AND audit."afterRowVersion" IS NULL
     AND audit."changedFields" = '["SESSION_ROTATION"]'::JSONB
     AND audit."metadata" =
       '{"kind":"REAUTHENTICATION_V1","rotation":"OLD_REVOKED_NEW_ISSUED"}'::JSONB
     AND audit."requestId" = intent."requestId"
     AND audit."environment" = intent."environment"
     AND audit."contentDigest" = "phase7_admin_audit_content_digest"(
       intent."operationId", 'REAUTHENTICATION', 'ADMIN_SESSION',
       intent."operationId", audit."beforeState", 'SESSION_FRESH', NULL,
       NULL, '["SESSION_ROTATION"]'::JSONB,
       '{"kind":"REAUTHENTICATION_V1","rotation":"OLD_REVOKED_NEW_ISSUED"}'::JSONB
     )
    WHERE fence."operationId" = intent."operationId"
      AND fence."oldSessionId" = intent."oldSessionId"
      AND fence."replacementSessionId" = intent."stagedSessionId"
      AND fence."userId" = intent."userId"
      AND fence."oldFamilyId" = intent."sessionFamilyId"
      AND fence."replacementFamilyId" = intent."sessionFamilyId"
      AND fence."oldTokenDigest" = intent."oldFenceTokenDigest"
  ) THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM "Session" AS session
    WHERE session."id" = intent."stagedSessionId"
      AND (
        session."userId" <> intent."userId"
        OR session."sessionFamilyId" <> intent."sessionFamilyId"
        OR session."token" <> raw_new_token
        OR session."authorizationState" <> 'ACTIVE'
      )
  ) THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "Session" WHERE "id" = intent."stagedSessionId"
  ) THEN RETURN true; END IF;
  execution_id := "phase7_open_trusted_execution"(
    'REAUTHENTICATE', intent."userId", false
  );
  DELETE FROM "Session" AS session
  WHERE session."id" = intent."stagedSessionId"
    AND session."userId" = intent."userId"
    AND session."sessionFamilyId" = intent."sessionFamilyId"
    AND session."token" = raw_new_token
    AND session."authorizationState" = 'ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finalized reauthentication compensation lost its CAS.'
      USING ERRCODE = '40001';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN true;
END;
$function$;

CREATE FUNCTION "phase7_classify_reauthentication_authority"(raw_token TEXT)
RETURNS TABLE ("outcome" TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  token_digest_value TEXT;
  authority_lost BOOLEAN;
  live_non_admin BOOLEAN;
  checked_at TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_runtime_ready"();
  token_digest_value := "phase7_reauthentication_token_digest"(
    COALESCE(raw_token, '')
  );
  SELECT EXISTS (
    SELECT 1 FROM "Phase7AuthorityRevocationEvidence" AS evidence
    WHERE evidence."tokenDigest" = token_digest_value
      AND evidence."reason" = 'ADMIN_AUTHORITY_LOST'
      AND evidence."expiresAt" > checked_at
  ), EXISTS (
    SELECT 1
    FROM "Session" AS session
    JOIN "AuthSessionFamily" AS family
      ON family."id" = session."sessionFamilyId"
     AND family."userId" = session."userId"
    JOIN "User" AS target_user ON target_user."id" = session."userId"
    WHERE session."token" = raw_token
      AND session."issuerProtocolVersion" = 'PHASE7_V1'
      AND session."authorizationState" = 'ACTIVE'
      AND session."authorityGeneration" = target_user."authorityGeneration"
      AND family."status" = 'ACTIVE'
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
$function$;

CREATE FUNCTION "phase7_classify_admin_authority"(raw_token TEXT)
RETURNS TABLE ("outcome" TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  token_digest_value TEXT;
  authority_lost BOOLEAN;
  live_non_admin BOOLEAN;
  checked_at TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_app');
  PERFORM "phase7_require_runtime_ready"();
  token_digest_value := "phase7_reauthentication_token_digest"(
    COALESCE(raw_token, '')
  );
  SELECT EXISTS (
    SELECT 1 FROM "Phase7AuthorityRevocationEvidence" AS evidence
    WHERE evidence."tokenDigest" = token_digest_value
      AND evidence."reason" = 'ADMIN_AUTHORITY_LOST'
      AND evidence."expiresAt" > checked_at
  ), EXISTS (
    SELECT 1
    FROM "Session" AS session
    JOIN "AuthSessionFamily" AS family
      ON family."id" = session."sessionFamilyId"
     AND family."userId" = session."userId"
    JOIN "User" AS target_user ON target_user."id" = session."userId"
    WHERE session."token" = raw_token
      AND session."issuerProtocolVersion" = 'PHASE7_V1'
      AND session."authorizationState" = 'ACTIVE'
      AND session."authorityGeneration" = target_user."authorityGeneration"
      AND family."status" = 'ACTIVE'
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
$function$;

CREATE FUNCTION "phase7_cleanup_reauthentication"(maximum_rows INTEGER)
RETURNS TABLE (
  "pendingSessionsDeleted" INTEGER,
  "intentsDeleted" INTEGER,
  "evidenceDeleted" INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  target_intent_ids UUID[];
  target_session_ids UUID[];
  execution_id UUID;
  session_count INTEGER := 0;
  intent_count INTEGER := 0;
  evidence_count INTEGER := 0;
  checked_at TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(NULL);
  IF maximum_rows NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Reauthentication cleanup batch size is invalid.'
      USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(candidate."id" ORDER BY candidate."userId",
      candidate."sessionFamilyId", candidate."id"),
    array_agg(candidate."stagedSessionId" ORDER BY candidate."userId",
      candidate."sessionFamilyId", candidate."id")
  INTO target_intent_ids, target_session_ids
  FROM (
    SELECT intent."id", intent."userId", intent."sessionFamilyId",
      intent."stagedSessionId"
    FROM "Phase7ReauthenticationIntent" AS intent
    WHERE (intent."state" IN ('PREPARED', 'STAGED')
        AND intent."expiresAt" <= checked_at)
      OR (intent."state" = 'FINALIZED'
        AND intent."finalizedAt" <= checked_at - INTERVAL '15 minutes')
    ORDER BY intent."userId", intent."sessionFamilyId", intent."id"
    LIMIT maximum_rows
  ) AS candidate;
  -- Match the finalizer's lock order. Candidate discovery is deliberately
  -- unlocked and every predicate is revalidated after these ordered locks.
  PERFORM 1 FROM "User" AS target_user
  WHERE target_user."id" IN (
    SELECT intent."userId" FROM "Phase7ReauthenticationIntent" AS intent
    WHERE intent."id" = ANY(COALESCE(target_intent_ids, ARRAY[]::UUID[]))
  )
  ORDER BY target_user."id" FOR UPDATE;
  PERFORM 1 FROM "AuthSessionFamily" AS family
  WHERE (family."userId", family."id") IN (
    SELECT intent."userId", intent."sessionFamilyId"
    FROM "Phase7ReauthenticationIntent" AS intent
    WHERE intent."id" = ANY(COALESCE(target_intent_ids, ARRAY[]::UUID[]))
  )
  ORDER BY family."userId", family."id" FOR UPDATE;
  PERFORM 1 FROM "Session" AS session
  WHERE session."id" = ANY(
    COALESCE(target_session_ids, ARRAY[]::UUID[])
  )
  ORDER BY session."userId", session."id" FOR UPDATE;
  PERFORM 1 FROM "Phase7ReauthenticationIntent" AS intent
  WHERE intent."id" = ANY(
    COALESCE(target_intent_ids, ARRAY[]::UUID[])
  )
  ORDER BY intent."userId", intent."sessionFamilyId", intent."id"
  FOR UPDATE;
  execution_id := "phase7_open_trusted_execution"(
    'REAUTHENTICATE', NULL, false
  );
  DELETE FROM "Session" AS session
  USING "Phase7ReauthenticationIntent" AS intent
  WHERE intent."id" = ANY(
      COALESCE(target_intent_ids, ARRAY[]::UUID[])
    )
    AND ((intent."state" IN ('PREPARED', 'STAGED')
        AND intent."expiresAt" <= checked_at)
      OR (intent."state" = 'FINALIZED'
        AND intent."finalizedAt" <= checked_at - INTERVAL '15 minutes'))
    AND session."id" = intent."stagedSessionId"
    AND session."userId" = intent."userId"
    AND session."sessionFamilyId" = intent."sessionFamilyId"
    AND session."authorizationState" = 'PENDING_REAUTH';
  GET DIAGNOSTICS session_count = ROW_COUNT;
  DELETE FROM "Phase7ReauthenticationIntent" AS intent
  WHERE intent."id" = ANY(
      COALESCE(target_intent_ids, ARRAY[]::UUID[])
    )
    AND ((intent."state" IN ('PREPARED', 'STAGED')
        AND intent."expiresAt" <= checked_at)
      OR (intent."state" = 'FINALIZED'
        AND intent."finalizedAt" <= checked_at - INTERVAL '15 minutes'));
  GET DIAGNOSTICS intent_count = ROW_COUNT;
  DELETE FROM "Phase7AuthorityRevocationEvidence"
  WHERE "tokenDigest" IN (
    SELECT evidence."tokenDigest"
    FROM "Phase7AuthorityRevocationEvidence" AS evidence
    WHERE evidence."expiresAt" <= checked_at
    ORDER BY evidence."tokenDigest"
    LIMIT maximum_rows
  );
  GET DIAGNOSTICS evidence_count = ROW_COUNT;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN QUERY SELECT session_count, intent_count, evidence_count;
END;
$function$;

-- Preserve the already-reviewed implementations as owner-only internals and
-- put an ACTIVE authorization-state fence in front of every runtime facade.
CREATE FUNCTION "phase7_active_authorization_session"(raw_token TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM "Session" AS session
    WHERE session."token" = raw_token
      AND session."authorizationState" = 'ACTIVE'
  );
$function$;

REVOKE ALL ON FUNCTION "phase7_active_authorization_session"(TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

ALTER FUNCTION "phase7_begin_admin_operation"(
  "AdminAuditCommand", TEXT, UUID, "AdminAuditEnvironment", UUID[]
) RENAME TO "phase7_begin_admin_operation_pre_reauthentication";

REVOKE ALL ON FUNCTION "phase7_begin_admin_operation_pre_reauthentication"(
  "AdminAuditCommand", TEXT, UUID, "AdminAuditEnvironment", UUID[]
) FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

CREATE FUNCTION "phase7_begin_admin_operation"(
  command_value "AdminAuditCommand",
  raw_session_token TEXT,
  request_id UUID,
  environment_value "AdminAuditEnvironment",
  referenced_user_ids UUID[]
)
RETURNS TABLE (
  "operationId" UUID,
  "actorUserId" UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
BEGIN
  IF NOT "phase7_active_authorization_session"(raw_session_token) THEN
    RAISE EXCEPTION 'Phase 7 operation authority is stale or insufficient.'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT operation."operationId", operation."actorUserId"
  FROM "phase7_begin_admin_operation_pre_reauthentication"(
    command_value, raw_session_token, request_id, environment_value,
    referenced_user_ids
  ) AS operation;
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_begin_admin_operation"(
  "AdminAuditCommand", TEXT, UUID, "AdminAuditEnvironment", UUID[]
) FROM PUBLIC, "nihongo_auth_gateway", "nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_begin_admin_operation"(
  "AdminAuditCommand", TEXT, UUID, "AdminAuditEnvironment", UUID[]
) TO "nihongo_app";

ALTER FUNCTION "phase7_finish_admin_operation"(UUID)
  RENAME TO "phase7_finish_admin_operation_pre_reauthentication";

REVOKE ALL ON FUNCTION
  "phase7_finish_admin_operation_pre_reauthentication"(UUID)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

CREATE FUNCTION "phase7_finish_admin_operation"(operation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Phase7OperationIntent" AS intent
    WHERE intent."operationId" = operation_id
      AND intent."backendPid" = pg_backend_pid()
      AND intent."transactionId" = txid_current()
      AND intent."actorUserId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "Session" AS session
        WHERE session."id" = intent."actorSessionId"
          AND session."userId" = intent."actorUserId"
          AND session."sessionFamilyId" = intent."actorFamilyId"
          AND session."authorizationState" = 'ACTIVE'
      )
  ) THEN
    RAISE EXCEPTION 'Phase 7 authority expired before commit.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM "phase7_finish_admin_operation_pre_reauthentication"(operation_id);
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_finish_admin_operation"(UUID)
  FROM PUBLIC, "nihongo_auth_gateway", "nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_finish_admin_operation"(UUID)
  TO "nihongo_app";

ALTER FUNCTION "phase7_create_question_report"(
  TEXT, UUID, UUID, UUID, "QuestionReportReason", TEXT
) RENAME TO "phase7_create_question_report_pre_reauthentication";

REVOKE ALL ON FUNCTION "phase7_create_question_report_pre_reauthentication"(
  TEXT, UUID, UUID, UUID, "QuestionReportReason", TEXT
) FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

CREATE FUNCTION "phase7_create_question_report"(
  raw_session_token TEXT,
  report_id UUID,
  question_id_value UUID,
  question_version_id_value UUID,
  reason_value "QuestionReportReason",
  description_value TEXT
)
RETURNS TABLE ("id" UUID, "rowVersion" INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
BEGIN
  IF NOT "phase7_active_authorization_session"(raw_session_token) THEN
    RAISE EXCEPTION 'QuestionReport reporter authority is stale.'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT report."id", report."rowVersion"
  FROM "phase7_create_question_report_pre_reauthentication"(
    raw_session_token, report_id, question_id_value,
    question_version_id_value, reason_value, description_value
  ) AS report;
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_create_question_report"(
  TEXT, UUID, UUID, UUID, "QuestionReportReason", TEXT
) FROM PUBLIC, "nihongo_auth_gateway", "nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_create_question_report"(
  TEXT, UUID, UUID, UUID, "QuestionReportReason", TEXT
) TO "nihongo_app";

ALTER FUNCTION "phase7_change_password_v1"(TEXT, TEXT, TEXT)
  RENAME TO "phase7_change_password_v1_pre_reauthentication";

REVOKE ALL ON FUNCTION "phase7_change_password_v1_pre_reauthentication"(
  TEXT, TEXT, TEXT
) FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

CREATE FUNCTION "phase7_change_password_v1"(
  raw_session_token TEXT,
  expected_password_hash TEXT,
  new_password_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
BEGIN
  IF NOT "phase7_active_authorization_session"(raw_session_token) THEN
    RETURN false;
  END IF;
  RETURN "phase7_change_password_v1_pre_reauthentication"(
    raw_session_token, expected_password_hash, new_password_hash
  );
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_change_password_v1"(TEXT, TEXT, TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_change_password_v1"(TEXT, TEXT, TEXT)
  TO "nihongo_auth_gateway";

ALTER FUNCTION "phase7_confirm_v1_session_issuance"(
  TEXT, UUID, UUID, INTEGER, "UserRole", "UserAccountStatus"
) RENAME TO "phase7_confirm_v1_session_issuance_pre_reauthentication";

REVOKE ALL ON FUNCTION
  "phase7_confirm_v1_session_issuance_pre_reauthentication"(
    TEXT, UUID, UUID, INTEGER, "UserRole", "UserAccountStatus"
  )
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

CREATE FUNCTION "phase7_confirm_v1_session_issuance"(
  raw_token TEXT,
  expected_session_id UUID,
  expected_user_id UUID,
  captured_generation_value INTEGER,
  captured_role_value "UserRole",
  captured_status_value "UserAccountStatus"
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
BEGIN
  IF NOT "phase7_active_authorization_session"(raw_token) THEN
    RETURN false;
  END IF;
  RETURN "phase7_confirm_v1_session_issuance_pre_reauthentication"(
    raw_token, expected_session_id, expected_user_id,
    captured_generation_value, captured_role_value, captured_status_value
  );
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_confirm_v1_session_issuance"(
  TEXT, UUID, UUID, INTEGER, "UserRole", "UserAccountStatus"
) FROM PUBLIC, "nihongo_app", "nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_confirm_v1_session_issuance"(
  TEXT, UUID, UUID, INTEGER, "UserRole", "UserAccountStatus"
) TO "nihongo_auth_gateway";

ALTER FUNCTION "phase7_change_user_authority"(
  TEXT, UUID, INTEGER, "UserRole", "UserAccountStatus",
  "AdminAuditEnvironment"
) RENAME TO "phase7_change_user_authority_pre_reauthentication";

REVOKE ALL ON FUNCTION "phase7_change_user_authority_pre_reauthentication"(
  TEXT, UUID, INTEGER, "UserRole", "UserAccountStatus",
  "AdminAuditEnvironment"
) FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

CREATE FUNCTION "phase7_change_user_authority"(
  raw_actor_token TEXT,
  target_user_id UUID,
  expected_target_generation INTEGER,
  new_role "UserRole",
  new_status "UserAccountStatus",
  environment_value "AdminAuditEnvironment"
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
BEGIN
  IF NOT "phase7_active_authorization_session"(raw_actor_token) THEN
    RAISE EXCEPTION 'Authority-change actor is stale or not fresh.'
      USING ERRCODE = '42501';
  END IF;
  RETURN "phase7_change_user_authority_pre_reauthentication"(
    raw_actor_token, target_user_id, expected_target_generation,
    new_role, new_status, environment_value
  );
END;
$function$;

CREATE OR REPLACE FUNCTION "phase7_owned_sign_out"(raw_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  token_digest TEXT;
  target_user_id UUID;
  target_family_id UUID;
  execution_id UUID;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(NULL);
  PERFORM "phase7_require_runtime_ready"();
  token_digest := encode(public.digest(
    convert_to('nihongo-auth-session-rotation-fence-v1', 'UTF8')
      || decode('00', 'hex') || convert_to(raw_token, 'UTF8'),
    'sha256'::TEXT
  ), 'hex');
  SELECT session."userId", session."sessionFamilyId"
  INTO target_user_id, target_family_id
  FROM "Session" AS session
  WHERE session."token" = raw_token
    AND session."authorizationState" = 'ACTIVE'
  UNION ALL
  SELECT fence."userId", fence."replacementFamilyId"
  FROM "AuthSessionRotationFence" AS fence
  WHERE fence."oldTokenDigest" = token_digest
  LIMIT 1;
  IF target_family_id IS NULL THEN RETURN true; END IF;

  PERFORM 1 FROM "User" WHERE "id" = target_user_id FOR UPDATE;
  PERFORM 1 FROM "AuthSessionFamily"
    WHERE "id" = target_family_id AND "userId" = target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned sign-out family is unavailable.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM "Session"
    WHERE "sessionFamilyId" = target_family_id
    ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "AuthSessionRotationFence"
    WHERE "userId" = target_user_id
      AND "replacementFamilyId" = target_family_id
    ORDER BY "id" FOR UPDATE;
  execution_id := "phase7_open_trusted_execution"(
    'SIGN_OUT', target_user_id, NULL
  );
  UPDATE "AuthSessionFamily" SET "status" = 'REVOKED'
    WHERE "id" = target_family_id AND "status" = 'ACTIVE';
  DELETE FROM "Session" WHERE "sessionFamilyId" = target_family_id;
  IF EXISTS (
    SELECT 1 FROM "Session" WHERE "sessionFamilyId" = target_family_id
  ) OR NOT EXISTS (
    SELECT 1 FROM "AuthSessionFamily"
    WHERE "id" = target_family_id AND "userId" = target_user_id
      AND "status" = 'REVOKED'
  ) THEN
    RAISE EXCEPTION 'Owned sign-out could not clear the Session family.'
      USING ERRCODE = '23514';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_change_user_authority"(
  TEXT, UUID, INTEGER, "UserRole", "UserAccountStatus",
  "AdminAuditEnvironment"
) FROM PUBLIC, "nihongo_app", "nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_change_user_authority"(
  TEXT, UUID, INTEGER, "UserRole", "UserAccountStatus",
  "AdminAuditEnvironment"
) TO "nihongo_auth_gateway";

-- Supersede the prototype rotation function. The auth gateway receives only
-- the bounded prepare/adapter/stage/finalize/abort/classifier capability set.
REVOKE ALL ON FUNCTION "phase7_reauthenticate_v1_session"(
  TEXT, INTEGER, "UserRole", "UserAccountStatus", UUID, TEXT, TEXT, TEXT,
  UUID, UUID, "AdminAuditEnvironment"
) FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

REVOKE ALL ON FUNCTION "phase7_prepare_reauthentication"(
  TEXT, UUID, UUID, "AdminAuditEnvironment", UUID
) FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_reauthentication_adapter_session"(UUID, TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_reauthentication_adapter_accounts"(UUID, UUID)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_reauthentication_adapter_subject"(UUID, TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_stage_reauthentication_session"(
  UUID, UUID, TEXT, UUID, TIMESTAMPTZ, TEXT, TEXT
) FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_finalize_reauthentication"(UUID, TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_reconcile_reauthentication"(UUID, TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_abort_reauthentication"(UUID)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_abort_reauthentication_classified"(UUID, TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_compensate_reauthentication"(UUID, TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_classify_reauthentication_authority"(TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_classify_admin_authority"(TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_cleanup_reauthentication"(INTEGER)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_owned_sign_out"(TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

GRANT EXECUTE ON FUNCTION "phase7_prepare_reauthentication"(
  TEXT, UUID, UUID, "AdminAuditEnvironment", UUID
), "phase7_reauthentication_adapter_session"(UUID, TEXT),
  "phase7_reauthentication_adapter_accounts"(UUID, UUID),
  "phase7_reauthentication_adapter_subject"(UUID, TEXT),
  "phase7_stage_reauthentication_session"(
    UUID, UUID, TEXT, UUID, TIMESTAMPTZ, TEXT, TEXT
  ), "phase7_finalize_reauthentication"(UUID, TEXT),
  "phase7_reconcile_reauthentication"(UUID, TEXT),
  "phase7_abort_reauthentication"(UUID),
  "phase7_abort_reauthentication_classified"(UUID, TEXT),
  "phase7_compensate_reauthentication"(UUID, TEXT),
  "phase7_classify_reauthentication_authority"(TEXT),
  "phase7_cleanup_reauthentication"(INTEGER),
  "phase7_owned_sign_out"(TEXT)
TO "nihongo_auth_gateway";

GRANT EXECUTE ON FUNCTION "phase7_classify_admin_authority"(TEXT)
TO "nihongo_app";

DO $phase7_reauthentication_hardened_paths$
DECLARE
  target_schema NAME := pg_catalog.current_setting(
    'app.phase7_target_schema', false
  )::NAME;
  routine_record RECORD;
BEGIN
  FOR routine_record IN
    SELECT routine.oid::pg_catalog.regprocedure AS identity
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = target_schema
      AND routine.proname = ANY(ARRAY[
        'phase7_reauthentication_token_digest',
        'phase7_rotation_fence_token_digest',
        'phase7_record_authority_revocation',
        'protect_phase7_account',
        'validate_phase7_user_change',
        'validate_phase7_session_write',
        'phase7_resolve_v1_principal',
        'phase7_resolve_session_credential',
        'phase7_refresh_remembered_session',
        'phase7_refresh_current_remembered_session',
        'phase7_active_authorization_session',
        'phase7_begin_admin_operation',
        'phase7_begin_admin_operation_pre_reauthentication',
        'phase7_finish_admin_operation',
        'phase7_finish_admin_operation_pre_reauthentication',
        'phase7_create_question_report',
        'phase7_create_question_report_pre_reauthentication',
        'phase7_change_password_v1',
        'phase7_change_password_v1_pre_reauthentication',
        'phase7_confirm_v1_session_issuance',
        'phase7_confirm_v1_session_issuance_pre_reauthentication',
        'phase7_change_user_authority',
        'phase7_change_user_authority_pre_reauthentication',
        'phase7_prepare_reauthentication',
        'phase7_reauthentication_adapter_session',
        'phase7_reauthentication_adapter_accounts',
        'phase7_reauthentication_adapter_subject',
        'phase7_stage_reauthentication_session',
        'phase7_finalize_reauthentication',
        'phase7_reconcile_reauthentication',
        'phase7_abort_reauthentication',
        'phase7_abort_reauthentication_classified',
        'phase7_compensate_reauthentication',
        'phase7_classify_reauthentication_authority',
        'phase7_classify_admin_authority',
        'phase7_cleanup_reauthentication',
        'phase7_owned_sign_out'
      ]::TEXT[])
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET search_path TO pg_catalog, %I, pg_temp',
      routine_record.identity,
      target_schema
    );
  END LOOP;
END;
$phase7_reauthentication_hardened_paths$;

DO $phase7_reauthentication_acl_attestation$
DECLARE
  target_schema NAME := pg_catalog.current_setting(
    'app.phase7_target_schema', false
  )::NAME;
  relation_name TEXT;
  runtime_role TEXT;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY[
    'nihongo_app', 'nihongo_auth_gateway', 'nihongo_erasure_worker'
  ]::TEXT[] LOOP
    FOREACH relation_name IN ARRAY ARRAY[
      'User', 'Account', 'Session', 'AuthSessionFamily',
      'AuthSessionRotationFence',
      'Phase7ReauthenticationIntent', 'Phase7AuthorityRevocationEvidence'
    ]::TEXT[] LOOP
      IF pg_catalog.has_table_privilege(
        runtime_role,
        pg_catalog.format('%I.%I', target_schema, relation_name),
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      ) THEN
        RAISE EXCEPTION 'Runtime role retained raw auth table privilege.'
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS column_acl
    LEFT JOIN pg_catalog.pg_roles AS grantee_role
      ON grantee_role.oid = column_acl.grantee
    WHERE namespace.nspname = target_schema
      AND relation.relname = ANY(ARRAY[
        'User', 'Account', 'Session', 'AuthSessionFamily',
        'AuthSessionRotationFence',
        'Phase7ReauthenticationIntent', 'Phase7AuthorityRevocationEvidence'
      ]::TEXT[])
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND column_acl.privilege_type = ANY(ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
      ]::TEXT[])
      AND (
        column_acl.grantee = 0
        OR grantee_role.rolname = ANY(ARRAY[
          'nihongo_app', 'nihongo_auth_gateway', 'nihongo_erasure_worker'
        ]::TEXT[])
      )
  ) THEN
    RAISE EXCEPTION 'Runtime role retained raw auth column privilege.'
      USING ERRCODE = '42501';
  END IF;
END;
$phase7_reauthentication_acl_attestation$;

SET LOCAL ROLE "nihongo_phase7_migration";

COMMIT;
