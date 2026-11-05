-- JLP-701 (#504 P7 PR5b): nothing opens trusted execution since
-- 20261121090000_account_sso_to_api. This removes its branches from the
-- Session and User triggers and drops its functions and table; moves the SQL
-- audit digest, which only tests still call, to a test fixture
-- (db/fixtures/auditDigestSql.ts); and revokes every schema privilege of the
-- former nihongo_auth_gateway and nihongo_erasure_worker roles, which no
-- runtime uses since #504 P7 PR1, except schema USAGE (name lookup only). The
-- roles, their logins, schema USAGE and database CONNECT go with DevOps
-- provisioning when the roles are dropped.
-- Rollback: re-run the dropped definitions from
-- 20260827101000_phase7_admin_cms_foundation and the replaced ones from
-- 20261120090000_trusted_execution_users and
-- 20261121090000_account_sso_to_api, and re-grant from the migrations that
-- granted them (EXECUTE on the SQL sign-in functions and
-- phase7_require_runtime_ready, and type USAGE).
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
    RAISE EXCEPTION 'Trusted execution drop migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

CREATE OR REPLACE FUNCTION "validate_phase7_session_write"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  user_row "User"%ROWTYPE;
  legacy_disabled BOOLEAN;
  -- #504 P7 PR4c-2: the migration operator (activation, first-admin
  -- bootstrap). #504 P7 PR5b: trusted execution is gone.
  trusted_delete BOOLEAN :=
    COALESCE(NULLIF(current_setting('role', true), 'none'), session_user) = 'nihongo_phase7_migration';
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
      AND OLD."issuerProtocolVersion" = 'PHASE7_V1' THEN
      RETURN OLD;
    END IF;
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
    IF api_writer THEN
      -- #504 P7 PR3b-1: activation is one-way false to true
      -- (protect_phase7_auth_issuer_activation), so the API path reads it
      -- without a lock and keeps the User-first lock order.
      SELECT "legacyIssuerDisabled" INTO legacy_disabled
        FROM "AuthIssuerActivation" WHERE "id" = 1;
    ELSE
      SELECT "legacyIssuerDisabled" INTO legacy_disabled
        FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
    END IF;
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
    ELSE
      IF NOT api_writer THEN
        RAISE EXCEPTION 'PHASE7_V1 Session requires the owned issuer.'
          USING ERRCODE = '42501';
      END IF;
      IF legacy_disabled IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'V1 Session issuance requires activated authority.'
          USING ERRCODE = '42501';
      END IF;
      -- The API asks for 7 days when remembered and 1 day otherwise; the
      -- 3 day threshold is far from both, so clock rounding cannot flip it.
      remember_session := NEW."expiresAt" > clock_timestamp() + INTERVAL '3 days';
      -- #504 P7 PR3b-1: the API stages a PENDING_REAUTH replacement only for
      -- the User's live PREPARED intent in the same generation.
      api_reauthentication := NEW."authorizationState" = 'PENDING_REAUTH'
        AND EXISTS (
          SELECT 1 FROM "Phase7ReauthenticationIntent" AS intent
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
      SELECT 1 FROM "Phase7ReauthenticationIntent" AS intent
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
$function$;

CREATE OR REPLACE FUNCTION "validate_phase7_user_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  -- #504 P7 PR5b: trusted execution is gone; only the TEST-only change
  -- below sets this.
  authority_invalidation BOOLEAN := false;
  revocation_reason "Phase7AuthorityRevocationReason";
  test_change TEXT[];
  -- #504 P7 PR4b-2: the API records an SSO erasure request as nihongo_app.
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
BEGIN
  -- #504 P7 PR5a: the TEST-only authority change of one User
  -- (db/fixtures/userAuthorityChange.ts), accepted only in a TEST database
  -- with a TEST capability, like the TEST-only erasure. The marker names the
  -- User, role and status; nihongo_app holds no User role privilege.
  test_change := string_to_array(
    current_setting('nihongo.phase7_test_authority_change', true), ':'
  );
  IF NOT authority_invalidation
    AND effective_caller = 'nihongo_app'
    AND cardinality(test_change) = 3
    AND test_change[1] = OLD."id"::TEXT
    AND current_database() ~ '_test$'
    AND EXISTS (
      SELECT 1 FROM "Phase7DatabaseCapability"
      WHERE "id" = 1 AND "environment" = 'TEST'
        AND "databaseName" = current_database()
    ) THEN
    NEW."role" := test_change[2]::"UserRole";
    NEW."accountStatus" := test_change[3]::"UserAccountStatus";
    NEW."updatedAt" := clock_timestamp();
    authority_invalidation := true;
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'User identity is insert-only.' USING ERRCODE = '23514';
  END IF;
  IF NEW."role" IS DISTINCT FROM OLD."role"
    OR NEW."accountStatus" IS DISTINCT FROM OLD."accountStatus" THEN
    IF NOT authority_invalidation THEN
      -- Only ACTIVE to DELETION_PENDING, only that change, and only with the
      -- User's erasure request inserted in this transaction.
      IF effective_caller = 'nihongo_app'
        AND OLD."accountStatus" = 'ACTIVE'
        AND NEW."accountStatus" = 'DELETION_PENDING'
        AND NEW."role" IS NOT DISTINCT FROM OLD."role"
        AND (to_jsonb(NEW) - 'accountStatus') = (to_jsonb(OLD) - 'accountStatus')
        AND EXISTS (
          SELECT 1 FROM "SsoAccountErasureRequest"
          WHERE "userId" = OLD."id" AND "appStatus" = 'DELETION_PENDING'
            AND "completedAt" IS NULL AND "createdAt" >= now()
        ) THEN
        NEW."updatedAt" := clock_timestamp();
      -- #504 P7 PR4c-2: the migration operator's first-admin bootstrap, only
      -- USER to ADMIN, only that change, only while no ACTIVE ADMIN exists.
      ELSIF effective_caller = 'nihongo_phase7_migration'
        AND OLD."role" = 'USER' AND NEW."role" = 'ADMIN'
        AND OLD."accountStatus" = 'ACTIVE' AND NEW."accountStatus" = 'ACTIVE'
        AND (to_jsonb(NEW) - 'role' - 'updatedAt')
          = (to_jsonb(OLD) - 'role' - 'updatedAt')
        AND NOT EXISTS (
          SELECT 1 FROM "User"
          WHERE "role" = 'ADMIN' AND "accountStatus" = 'ACTIVE'
            AND "id" <> OLD."id"
        ) THEN
        NULL;
      ELSE
        RAISE EXCEPTION 'User role/status change requires owned authority.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM "QuestionVersion"
      WHERE "createdByActorId" = OLD."id"
        AND "status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
    ) THEN
      RAISE EXCEPTION 'Open candidate blocks role/status authority change.'
        USING ERRCODE = '23514';
    END IF;
    revocation_reason := CASE
      WHEN OLD."role" = 'ADMIN'
        AND (NEW."role" <> 'ADMIN' OR NEW."accountStatus" <> 'ACTIVE')
        THEN 'ADMIN_AUTHORITY_LOST'::"Phase7AuthorityRevocationReason"
      ELSE 'SESSION_INVALIDATED'::"Phase7AuthorityRevocationReason"
    END;
    PERFORM "phase7_record_authority_revocation"(
      OLD."id", revocation_reason
    );
    NEW."authorityGeneration" := OLD."authorityGeneration" + 1;
    DELETE FROM "Session" WHERE "userId" = OLD."id";
  ELSIF NEW."authorityGeneration" <> OLD."authorityGeneration"
    AND NOT authority_invalidation THEN
    -- #504 P7 PR5a: an API SSO Account unlink steps the generation from the
    -- Account trigger (never a direct nihongo_app statement), only that
    -- change; this records the revocation evidence and deletes the Sessions.
    IF effective_caller = 'nihongo_app'
      AND pg_trigger_depth() > 1
      AND NEW."authorityGeneration" = OLD."authorityGeneration" + 1
      AND (to_jsonb(NEW) - 'authorityGeneration' - 'updatedAt')
        = (to_jsonb(OLD) - 'authorityGeneration' - 'updatedAt') THEN
      PERFORM "phase7_record_authority_revocation"(
        OLD."id", 'SESSION_INVALIDATED'
      );
      NEW."updatedAt" := clock_timestamp();
      DELETE FROM "Session" WHERE "userId" = OLD."id";
    ELSE
      RAISE EXCEPTION 'User authorityGeneration is server-owned.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TABLE "Phase7TrustedExecution";
DROP FUNCTION "reject_unfinished_phase7_trusted_execution"();
DROP FUNCTION "phase7_open_trusted_execution"(TEXT, UUID, BOOLEAN);
DROP FUNCTION "phase7_close_trusted_execution"(UUID);
DROP FUNCTION "phase7_trusted_execution_active"(TEXT);
DROP FUNCTION "phase7_admin_audit_content_digest"(
  UUID, "AdminAuditCommand", "AdminAuditTargetType", UUID, TEXT, TEXT,
  INTEGER, INTEGER, JSONB, JSONB
);
DROP FUNCTION "phase7_jcs_audit_metadata"(JSONB);
DROP FUNCTION "phase7_jcs_string_array"(JSONB);

-- Former runtime roles: revoke every privilege they hold in this schema.
DO $former_roles$
DECLARE
  target_schema TEXT := pg_catalog.current_setting('app.phase7_target_schema', false);
  type_record RECORD;
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM "nihongo_auth_gateway", "nihongo_erasure_worker"',
    target_schema
  );
  EXECUTE pg_catalog.format(
    'REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM "nihongo_auth_gateway", "nihongo_erasure_worker"',
    target_schema
  );
  EXECUTE pg_catalog.format(
    'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM "nihongo_auth_gateway", "nihongo_erasure_worker"',
    target_schema
  );
  FOR type_record IN
    SELECT type_entry.typname
    FROM pg_catalog.pg_type AS type_entry
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = type_entry.typnamespace
    WHERE namespace.nspname = target_schema
      AND type_entry.typacl IS NOT NULL
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON TYPE %I.%I FROM "nihongo_auth_gateway", "nihongo_erasure_worker"',
      target_schema, type_record.typname
    );
  END LOOP;
  -- Schema USAGE (name lookup only, no data or EXECUTE) stays until DevOps
  -- drops the roles, so a former role still gets permission denied (42501).
  EXECUTE pg_catalog.format(
    'REVOKE CREATE ON SCHEMA %I FROM "nihongo_auth_gateway", "nihongo_erasure_worker"',
    target_schema
  );
  -- Nothing else in this schema may still name either role.
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT relation.relacl AS acl, relation.relowner AS owner
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = target_schema
      UNION ALL
      SELECT attribute.attacl, NULL
      FROM pg_catalog.pg_attribute AS attribute
      JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = target_schema
      UNION ALL
      SELECT procedure_record.proacl, procedure_record.proowner
      FROM pg_catalog.pg_proc AS procedure_record
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure_record.pronamespace
      WHERE namespace.nspname = target_schema
      UNION ALL
      SELECT type_entry.typacl, type_entry.typowner
      FROM pg_catalog.pg_type AS type_entry
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = type_entry.typnamespace
      WHERE namespace.nspname = target_schema
      UNION ALL
      SELECT default_acl.defaclacl, default_acl.defaclrole
      FROM pg_catalog.pg_default_acl AS default_acl
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = default_acl.defaclnamespace
      WHERE namespace.nspname = target_schema
    ) AS object_acl
    LEFT JOIN LATERAL pg_catalog.aclexplode(object_acl.acl) AS entry ON true
    JOIN pg_catalog.pg_roles AS former_role
      ON former_role.oid IN (entry.grantee, object_acl.owner)
    WHERE former_role.rolname IN ('nihongo_auth_gateway', 'nihongo_erasure_worker')
  ) THEN
    RAISE EXCEPTION 'A former runtime role still holds a schema privilege.'
      USING ERRCODE = '42501';
  END IF;
END;
$former_roles$;

-- Every function this migration replaces keeps a fixed search_path.
DO $fixed_path$
DECLARE
  target_schema TEXT := pg_catalog.current_setting('app.phase7_target_schema', false);
  function_oid OID;
BEGIN
  FOR function_oid IN
    SELECT procedure_record.oid
    FROM pg_catalog.pg_proc AS procedure_record
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure_record.pronamespace
    WHERE namespace.nspname = target_schema
      AND procedure_record.proname = ANY(ARRAY[
        'validate_phase7_session_write',
        'validate_phase7_user_change'
      ]::NAME[])
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET search_path TO pg_catalog, %I, pg_temp',
      function_oid::REGPROCEDURE, target_schema
    );
  END LOOP;
END;
$fixed_path$;

SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
