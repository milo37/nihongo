-- JLP-701 (#504 P7 PR4c-2): QuestionReport creation runs in the API
-- (admin/questionReportAuthority.ts) with the checks, lock order and
-- SQLSTATE of phase7_create_question_report. The insert trigger owns the
-- report state, digest, row version, times and reporter snapshot, and accepts
-- only nihongo_app.
-- The migration-operator functions (V1 activation, first-admin bootstrap,
-- V1 retirement) no longer open trusted execution: the activation, Session
-- and Verification triggers check the migration operator role instead of
-- ACTIVATE, and the User trigger accepts the operator's first-admin change
-- only from USER to ADMIN, only that change, while no ACTIVE ADMIN exists.
-- Trusted execution stays only for AUTHORITY_CHANGE (unlink, SQL authority
-- change) until #504 P7 PR5.
-- Rollback: re-run the replaced and dropped definitions from
-- 20260827101000_phase7_admin_cms_foundation,
-- 20260916120000_phase7_reauthentication_foundation,
-- 20261020233000_sso_first_admin_bootstrap,
-- 20261028170000_study_v1_retirement_authority,
-- 20261117090000_session_family_removal and
-- 20261119090000_operation_finish_enforcement, and revoke the grant below.
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
    RAISE EXCEPTION 'Trusted execution users migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

GRANT INSERT (
    "id", "questionId", "questionVersionId", "reason", "description",
    "reporterUserId"
  )
  ON TABLE "QuestionReport" TO "nihongo_app";

CREATE OR REPLACE FUNCTION "validate_phase7_question_report_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $function$
DECLARE
  -- nihongo_app reads only these User columns (column grants).
  reporter RECORD;
BEGIN
  -- #504 P7 PR4c-2: the API creates reports as nihongo_app after its Session
  -- checks; the server owns the state, digest, row version, times and the
  -- reporter snapshot. No other writer remains. The trigger runs with the
  -- caller's rights (no SECURITY DEFINER).
  IF current_user <> 'nihongo_app' THEN
    RAISE EXCEPTION 'QuestionReport insert requires owned reporter authority.'
      USING ERRCODE = '42501';
  END IF;
  NEW."status" := 'OPEN';
  NEW."rowVersion" := 1;
  NEW."createdAt" := clock_timestamp();
  NEW."updatedAt" := NEW."createdAt";
  NEW."descriptionDigest" :=
    "phase7_question_report_description_digest"(NEW."description");
  NEW."reporterActorId" := NEW."reporterUserId";
  SELECT "role" INTO NEW."reporterRole" FROM "User" WHERE "id" = NEW."reporterUserId";
  NEW."reporterLabel" := CASE NEW."reporterRole"
    WHEN 'ADMIN' THEN 'ACTIVE_ADMIN'::"AccountActorLabel"
    ELSE 'ACTIVE_USER'::"AccountActorLabel" END;
  IF NEW."status" <> 'OPEN' OR NEW."rowVersion" <> 1
    OR NEW."description" IS NULL
    OR NEW."description" <> "phase7_normalize_report_description"(NEW."description")
    OR position(E'\r' IN NEW."description") <> 0
    OR char_length(NEW."description") NOT BETWEEN 1 AND 2000
    OR NEW."descriptionDigest" <>
      "phase7_question_report_description_digest"(NEW."description") THEN
    RAISE EXCEPTION 'QuestionReport create contract is invalid.'
      USING ERRCODE = '23514';
  END IF;

  SELECT "id", "role", "accountStatus" INTO reporter
  FROM "User" WHERE "id" = NEW."reporterUserId" FOR SHARE;
  IF reporter."id" IS NULL OR reporter."id" <> NEW."reporterActorId"
    OR reporter."role" <> NEW."reporterRole"
    OR reporter."accountStatus" <> 'ACTIVE'
    OR NEW."reporterLabel" <> (CASE reporter."role"
      WHEN 'ADMIN' THEN 'ACTIVE_ADMIN'::"AccountActorLabel"
      ELSE 'ACTIVE_USER'::"AccountActorLabel" END) THEN
    RAISE EXCEPTION 'QuestionReport reporter snapshot is invalid.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Question" AS question
    WHERE question."id" = NEW."questionId"
      AND question."lifecycleStatus" = 'ACTIVE'
      AND question."currentPublishedVersionId" = NEW."questionVersionId"
  ) AND NOT EXISTS (
    SELECT 1
    FROM "StudySessionQuestion" AS session_question
    JOIN "StudySession" AS session
      ON session."id" = session_question."studySessionId"
    WHERE session."userId" = NEW."reporterActorId"
      AND session_question."questionId" = NEW."questionId"
      AND session_question."questionVersionId" = NEW."questionVersionId"
  ) AND NOT EXISTS (
    SELECT 1 FROM "WrongNote" AS note
    WHERE note."userId" = NEW."reporterActorId"
      AND note."questionId" = NEW."questionId"
      AND NEW."questionVersionId" IN (
        note."lastWrongQuestionVersionId", note."currentReviewQuestionVersionId"
      )
  ) THEN
    RAISE EXCEPTION 'QuestionReport target is not entitled.'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION "protect_phase7_auth_issuer_activation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'AuthIssuerActivation singleton identity is immutable.'
      USING ERRCODE = '23514';
  END IF;
  -- #504 P7 PR4c-2: only the migration operator (phase7_activate_v1_issuer).
  IF COALESCE(NULLIF(current_setting('role', true), 'none'), session_user) <> 'nihongo_phase7_migration' THEN
    RAISE EXCEPTION 'Auth issuer activation requires owned authority.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW."id" <> 1 OR OLD."id" <> 1
    OR OLD."legacyIssuerDisabled" IS NOT FALSE
    OR NEW."legacyIssuerDisabled" IS NOT TRUE THEN
    RAISE EXCEPTION 'Auth issuer activation is one-way false to true.'
      USING ERRCODE = '23514';
  END IF;
  NEW."updatedAt" := clock_timestamp();
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
  legacy_disabled BOOLEAN;
  -- #504 P7 PR4c-2: the migration operator (activation, first-admin
  -- bootstrap) replaces ACTIVATE; AUTHORITY_CHANGE stays for unlink and the
  -- SQL authority change until #504 P7 PR5.
  trusted_delete BOOLEAN :=
    COALESCE(NULLIF(current_setting('role', true), 'none'), session_user) = 'nihongo_phase7_migration'
    OR "phase7_trusted_execution_active"('AUTHORITY_CHANGE');
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

CREATE OR REPLACE FUNCTION "validate_phase7_verification_write"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  legacy_disabled BOOLEAN;
  -- #504 P7 PR4a: the API deletes the reset intents of a confirmed erasure.
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."purpose" = 'PASSWORD_RESET_V1'
      AND COALESCE(NULLIF(current_setting('role', true), 'none'), session_user) <> 'nihongo_phase7_migration'
      AND NOT (effective_caller = 'nihongo_app'
        AND "phase7_user_erasure_confirmed"(OLD."resetUserId")) THEN
      RAISE EXCEPTION 'Password reset intent delete requires owned authority.'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  -- The API holds UPDATE on createdAt only to lock rows for erasure.
  IF TG_OP = 'UPDATE' AND NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Verification createdAt is insert-only.'
      USING ERRCODE = '23514';
  END IF;

  SELECT "legacyIssuerDisabled" INTO legacy_disabled
  FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth issuer activation singleton is missing.'
      USING ERRCODE = '42501';
  END IF;

  -- #504 P6a dropped password reset issuance, so no writer can add one.
  IF TG_OP = 'INSERT' AND NEW."purpose" = 'PASSWORD_RESET_V1' THEN
    RAISE EXCEPTION 'Password reset intent requires owned issuance.'
      USING ERRCODE = '42501';
  ELSIF TG_OP = 'INSERT' AND legacy_disabled THEN
    RAISE EXCEPTION 'Legacy Verification issuance is disabled.'
      USING ERRCODE = '42501';
  ELSIF TG_OP = 'UPDATE' AND (
    OLD."purpose" = 'PASSWORD_RESET_V1'
    OR NEW."purpose" = 'PASSWORD_RESET_V1'
  ) THEN
    RAISE EXCEPTION 'Password-reset Verification rows are fully immutable.'
      USING ERRCODE = '42501';
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
    "phase7_trusted_execution_active"('AUTHORITY_CHANGE');
  revocation_reason "Phase7AuthorityRevocationReason";
  -- #504 P7 PR4b-2: the API records an SSO erasure request as nihongo_app.
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
BEGIN
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
    RAISE EXCEPTION 'User authorityGeneration is server-owned.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION "phase7_activate_v1_issuer"(
  environment_value "AdminAuditEnvironment"
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  database_name TEXT := current_database();
  target_schema TEXT;
  type_row RECORD;
  legacy_login TEXT := CASE
    WHEN current_database() ~ '_test$' THEN 'nihongo_test_legacy_app_login'
    WHEN current_database() ~ '_dev$' THEN 'nihongo_development_legacy_app_login'
    ELSE NULL
  END;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_phase7_migration');
  PERFORM "phase7_require_database_capability"(environment_value);
  IF (environment_value = 'TEST' AND database_name !~ '_test$')
    OR (environment_value = 'DEVELOPMENT' AND database_name !~ '_dev$') THEN
    RAISE EXCEPTION 'V1 activation requires an approved DB target.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM "AuthIssuerActivation" WHERE "id" = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth issuer activation singleton is missing.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM "User" ORDER BY "id" FOR UPDATE;
  IF EXISTS (
    SELECT 1
    FROM "User" AS target_user
    LEFT JOIN "Account" AS credential
      ON credential."userId" = target_user."id"
     AND credential."providerId" = 'credential'
    GROUP BY target_user."id"
    HAVING COUNT(credential."id") <> 1
  ) THEN
    RAISE EXCEPTION 'V1 activation requires one credential Account per User.'
      USING ERRCODE = '23514';
  END IF;
  DELETE FROM "Session" WHERE "issuerProtocolVersion" = 'LEGACY';
  DELETE FROM "Verification" WHERE "purpose" IS NULL;
  UPDATE "AuthIssuerActivation"
  SET "legacyIssuerDisabled" = true, "updatedAt" = clock_timestamp()
  WHERE "id" = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth issuer activation did not update the singleton.'
      USING ERRCODE = '42501';
  END IF;
  SELECT namespace.nspname INTO target_schema
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE relation.oid = pg_catalog.to_regclass('"AuthIssuerActivation"');
  IF target_schema IS NULL OR legacy_login IS NULL THEN
    RAISE EXCEPTION 'Legacy compatibility ACL target is unavailable.'
      USING ERRCODE = '42501';
  END IF;
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON TABLE %I."User", %I."Session", %I."Account", %I."Verification", %I."RateLimit", %I."GuestPrincipal", %I."StudySession", %I."StudySessionQuestion", %I."StudyDraft", %I."StudyDraftAnswer", %I."Question", %I."Bookmark", %I."QuestionVersion", %I."QuestionOption", %I."Tag", %I."QuestionVersionTag", %I."StudyAnswer", %I."StudyResult", %I."WrongNote", %I."UserMemo", %I."ReviewSchedule", %I."ReviewEvent", %I."IdempotencyRecord" FROM %I',
    target_schema, target_schema, target_schema, target_schema, target_schema,
    target_schema, target_schema, target_schema, target_schema, target_schema,
    target_schema, target_schema, target_schema, target_schema, target_schema,
    target_schema, target_schema, target_schema, target_schema, target_schema,
    target_schema, target_schema, target_schema, legacy_login
  );
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON TABLE %I."_prisma_migrations" FROM %I',
    target_schema,
    legacy_login
  );
  EXECUTE pg_catalog.format(
    'DROP POLICY IF EXISTS phase7_ledger_legacy_read ON %I."_prisma_migrations"',
    target_schema
  );
  FOR type_row IN
    SELECT type_value.typname
    FROM pg_catalog.pg_type AS type_value
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = type_value.typnamespace
    WHERE namespace.nspname = target_schema
      AND type_value.typtype = 'e'
      AND type_value.typrelid = 0
      AND type_value.typname IN (
        'QuestionLifecycleStatus', 'QuestionVersionStatus', 'JlptLevel',
        'QuestionSubject', 'QuestionType', 'QuestionDifficulty',
        'QuestionSourceType', 'CreatorLabelSnapshot', 'UserRole',
        'UserAccountStatus', 'StudyMode', 'StudySessionStatus',
        'StudySessionFallbackReason', 'WrongNoteStatus',
        'ReviewEventSource', 'IdempotencyPrincipalType',
        'IdempotencyOperation', 'IdempotencyState'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_catalog.pg_type'::regclass
          AND dependency.objid = type_value.oid
          AND dependency.deptype = 'e'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE USAGE ON TYPE %I.%I FROM %I',
      target_schema,
      type_row.typname,
      legacy_login
    );
  END LOOP;
  EXECUTE pg_catalog.format(
    'REVOKE USAGE ON SCHEMA %I FROM %I',
    target_schema,
    legacy_login
  );
  PERFORM "phase7_revoke_legacy_database_connect"();
END;
$function$;

CREATE OR REPLACE FUNCTION "phase7_bootstrap_first_google_admin"(
  target_user_id UUID,
  google_subject TEXT,
  expected_generation INTEGER,
  expected_schema TEXT,
  environment_value "AdminAuditEnvironment"
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  expected_wrapper TEXT;
  resolved_schema TEXT;
  target_user "User"%ROWTYPE;
  result_generation INTEGER;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_phase7_migration');
  expected_wrapper := CASE
    WHEN environment_value = 'TEST' AND current_database() ~ '_test$'
      THEN 'nihongo_test_phase7_migration_login'
    WHEN environment_value = 'DEVELOPMENT' AND current_database() ~ '_dev$'
      THEN 'nihongo_development_phase7_migration_login'
    ELSE NULL END;
  SELECT n.nspname INTO resolved_schema
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
  WHERE c.oid = '"User"'::regclass AND r.rolname = 'nihongo_phase7_owner';
  IF expected_wrapper IS NULL OR SESSION_USER <> expected_wrapper
    OR CURRENT_USER <> 'nihongo_phase7_owner'
    OR expected_schema IS NULL OR resolved_schema IS DISTINCT FROM expected_schema
    OR current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'First-admin operator target is not canonical.' USING ERRCODE = '42501';
  END IF;
  IF target_user_id IS NULL OR google_subject IS NULL
    OR char_length(google_subject) NOT BETWEEN 1 AND 255
    OR google_subject <> btrim(google_subject) OR google_subject ~ '[[:cntrl:]]'
    OR expected_generation IS NULL OR expected_generation NOT BETWEEN 1 AND 2147483646 THEN
    RAISE EXCEPTION 'First-admin target input is invalid.' USING ERRCODE = '22023';
  END IF;
  PERFORM "phase7_require_database_capability"(environment_value);
  -- Serializes first-admin decisions and canonical unlink before any User row lock.
  LOCK TABLE "User" IN EXCLUSIVE MODE;
  IF NOT EXISTS (
    SELECT 1 FROM "AuthIssuerActivation" WHERE "id" = 1 AND "legacyIssuerDisabled"
  ) THEN
    RAISE EXCEPTION 'First-admin bootstrap requires activated owned auth.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO target_user FROM "User" WHERE "id" = target_user_id FOR UPDATE;
  PERFORM 1 FROM "Account" WHERE "userId" = target_user_id ORDER BY "id" FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "User" WHERE "role" = 'ADMIN' AND "accountStatus" = 'ACTIVE') THEN
    RAISE EXCEPTION 'First-admin bootstrap is already closed.' USING ERRCODE = '42501';
  END IF;
  IF target_user."id" IS NULL OR target_user."role" <> 'USER'
    OR target_user."accountStatus" <> 'ACTIVE' OR target_user."deletedAt" IS NOT NULL
    OR target_user."authorityGeneration" <> expected_generation
    OR (SELECT count(*) FROM "Account" WHERE "userId" = target_user_id AND "providerId" = 'google') <> 1
    OR NOT EXISTS (
      SELECT 1 FROM "Account" WHERE "providerId" = 'google'
        AND "accountId" = google_subject AND "userId" = target_user_id
    ) THEN
    RAISE EXCEPTION 'First-admin linked target is unavailable or stale.' USING ERRCODE = '23514';
  END IF;

  UPDATE "User" SET "role" = 'ADMIN', "updatedAt" = clock_timestamp()
  WHERE "id" = target_user_id AND "role" = 'USER' AND "accountStatus" = 'ACTIVE'
    AND "deletedAt" IS NULL AND "authorityGeneration" = expected_generation
  RETURNING "authorityGeneration" INTO result_generation;
  IF result_generation IS DISTINCT FROM expected_generation + 1 THEN
    RAISE EXCEPTION 'First-admin authority compare-and-swap failed.' USING ERRCODE = '40001';
  END IF;
  RETURN result_generation;
END;
$function$;

CREATE OR REPLACE FUNCTION "phase7_retire_v1_sessions"(target_ids UUID[])
RETURNS TABLE ("deletedSessionCount" INTEGER, "deletedWrongNoteCount" INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT
AS $function$
DECLARE
  session_count INTEGER;
  note_count INTEGER;
BEGIN
  IF pg_catalog.current_database() !~ '_test$'
    OR SESSION_USER <> 'nihongo_test_phase7_migration_login'
    OR pg_catalog.current_setting('role', true) <> 'nihongo_phase7_migration'
    OR pg_catalog.current_setting('session_replication_role') <> 'origin'
    OR target_ids IS NULL OR pg_catalog.cardinality(target_ids) < 1
    OR pg_catalog.cardinality(target_ids) > 500
    OR EXISTS (SELECT 1 FROM pg_catalog.unnest(target_ids) AS ids(id) WHERE id IS NULL)
    OR (SELECT pg_catalog.count(DISTINCT id) FROM pg_catalog.unnest(target_ids) AS ids(id)) <> pg_catalog.cardinality(target_ids)
  THEN RAISE EXCEPTION 'V1 retirement facade requires bounded TEST targets.' USING ERRCODE = '42501'; END IF;

  PERFORM 1 FROM "StudySession" AS session WHERE session."id" = ANY(target_ids)
    ORDER BY session."id" FOR UPDATE;
  SELECT count(*) INTO session_count FROM "StudySession" AS session
    WHERE session."id" = ANY(target_ids) AND session."practiceContractVersion" = 1
      AND session."status" <> 'IN_PROGRESS'
      AND ((session."userId" IS NOT NULL AND session."guestPrincipalId" IS NULL)
        OR (session."userId" IS NULL AND session."guestPrincipalId" IS NOT NULL))
      AND NOT EXISTS (SELECT 1 FROM "StudySession" AS retry WHERE retry."retryOfStudySessionId" = session."id");
  IF session_count <> pg_catalog.cardinality(target_ids) THEN
    RAISE EXCEPTION 'V1 retirement target changed or has a retry.' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM "WrongNote" AS note WHERE EXISTS (
    SELECT 1 FROM "ReviewEvent" AS event WHERE event."wrongNoteId" = note."id"
      AND event."studySessionId" = ANY(target_ids)) ORDER BY note."id" FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM "ReviewEvent" AS event JOIN "WrongNote" AS note ON note."id" = event."wrongNoteId"
    WHERE event."studySessionId" = ANY(target_ids) AND (
      EXISTS (SELECT 1 FROM "UserMemo" AS memo WHERE memo."wrongNoteId" = note."id")
      OR EXISTS (SELECT 1 FROM "ReviewEvent" AS other WHERE other."wrongNoteId" = note."id"
        AND (other."studySessionId" IS NULL OR NOT (other."studySessionId" = ANY(target_ids))))
    )
  ) THEN RAISE EXCEPTION 'V1 retirement review history is shared or has a memo.' USING ERRCODE = '23514'; END IF;

  DELETE FROM "WrongNote" AS note WHERE EXISTS (
    SELECT 1 FROM "ReviewEvent" AS event WHERE event."wrongNoteId" = note."id"
      AND event."studySessionId" = ANY(target_ids));
  GET DIAGNOSTICS note_count = ROW_COUNT;
  DELETE FROM "StudySession" AS session WHERE session."id" = ANY(target_ids)
    AND session."practiceContractVersion" = 1
    AND NOT EXISTS (SELECT 1 FROM "StudySession" AS retry WHERE retry."retryOfStudySessionId" = session."id")
    AND NOT EXISTS (SELECT 1 FROM "ReviewEvent" AS event WHERE event."studySessionId" = session."id");
  GET DIAGNOSTICS session_count = ROW_COUNT;
  IF session_count <> pg_catalog.cardinality(target_ids) THEN
    RAISE EXCEPTION 'V1 retirement target changed during cleanup.' USING ERRCODE = '40001';
  END IF;
  RETURN QUERY SELECT session_count, note_count;
END;
$function$;

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
        'validate_phase7_question_report_insert',
        'protect_phase7_auth_issuer_activation',
        'validate_phase7_session_write',
        'validate_phase7_verification_write',
        'validate_phase7_user_change',
        'phase7_activate_v1_issuer',
        'phase7_bootstrap_first_google_admin',
        'phase7_retire_v1_sessions'
      ]::NAME[])
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET search_path TO pg_catalog, %I, pg_temp',
      function_oid::REGPROCEDURE, target_schema
    );
  END LOOP;
END;
$fixed_path$;

-- phase7_revoke_legacy_database_connect belongs to the migration role, which
-- owns the database CONNECT privilege it revokes.
SET LOCAL ROLE "nihongo_phase7_migration";
CREATE OR REPLACE FUNCTION "phase7_revoke_legacy_database_connect"()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  database_name TEXT := current_database();
  database_owner TEXT;
  legacy_login TEXT := CASE
    WHEN current_database() ~ '_test$' THEN 'nihongo_test_legacy_app_login'
    WHEN current_database() ~ '_dev$' THEN 'nihongo_development_legacy_app_login'
    ELSE NULL
  END;
BEGIN
  -- #504 P7 PR4c-2: called only by phase7_activate_v1_issuer, which requires
  -- the migration operator.
  IF COALESCE(NULLIF(current_setting('role', true), 'none'), session_user) <> 'nihongo_phase7_migration' THEN
    RAISE EXCEPTION 'Legacy CONNECT revoke requires active V1 activation.'
      USING ERRCODE = '42501';
  END IF;
  SELECT owner_role.rolname INTO database_owner
  FROM pg_catalog.pg_database AS database_row
  JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = database_row.datdba
  WHERE database_row.datname = database_name;
  IF database_owner IS DISTINCT FROM CURRENT_USER OR legacy_login IS NULL THEN
    RAISE EXCEPTION 'Legacy CONNECT revoke requires the migration DB owner.'
      USING ERRCODE = '42501';
  END IF;
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I',
    database_name,
    legacy_login
  );
END;
$function$;

DO $fixed_revoke_path$
DECLARE
  target_schema TEXT := pg_catalog.current_setting('app.phase7_target_schema', false);
BEGIN
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp',
    target_schema, 'phase7_revoke_legacy_database_connect', target_schema
  );
END;
$fixed_revoke_path$;
SET LOCAL ROLE "nihongo_phase7_owner";

DROP FUNCTION "phase7_create_question_report"(
  TEXT, UUID, UUID, UUID, "QuestionReportReason", TEXT
);
DROP FUNCTION "phase7_create_question_report_pre_reauthentication"(
  TEXT, UUID, UUID, UUID, "QuestionReportReason", TEXT
);
DROP FUNCTION "phase7_trusted_execution_target"(TEXT);
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
