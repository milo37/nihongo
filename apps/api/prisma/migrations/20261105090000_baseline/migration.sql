-- #504 P8-1: the single baseline. It replaces the 76 migrations up to
-- 20261122090000_trusted_execution_drop with their resulting schema, without
-- the legacy issuer, the V1 activation and retirement steps, the approved tag
-- registration commands and eight functions no caller used, and with the
-- phase name removed from every object. The equivalence test (adminCms
-- foundation, data in db/fixtures/baseline/) checks the result against the
-- 76-migration catalog with exactly those exclusions and renames.
-- A database migrated before this baseline is recreated, not upgraded.
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
    OR pg_catalog.current_setting('role', true) <> 'nihongo_migration'
    OR pg_catalog.current_setting('session_replication_role') <> 'origin'
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace n
      JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
      WHERE n.nspname = target_schema AND r.rolname = 'nihongo_migration'
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_extension e
      JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'pgcrypto' AND n.nspname = 'public'
    ) THEN
    RAISE EXCEPTION 'Baseline migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
  -- The ledger first: the migration role reaches the schema only as its
  -- owner, and the new ledger owner needs CREATE on the schema.
  EXECUTE pg_catalog.format('GRANT USAGE, CREATE ON SCHEMA %I TO nihongo_owner', target_schema);
  EXECUTE pg_catalog.format('ALTER TABLE %I."_prisma_migrations" OWNER TO nihongo_owner', target_schema);
  EXECUTE pg_catalog.format('ALTER SCHEMA %I OWNER TO nihongo_owner', target_schema);
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL check_function_bodies = false;
SET LOCAL ROLE "nihongo_owner";

-- TYPE: AccountActorLabel
CREATE TYPE "AccountActorLabel" AS ENUM (
    'ACTIVE_USER',
    'DELETED_USER',
    'ACTIVE_ADMIN',
    'DELETED_ADMIN'
);

-- TYPE: AdminAuditCommand
CREATE TYPE "AdminAuditCommand" AS ENUM (
    'QUESTION_CREATE',
    'QUESTION_VERSION_CREATE',
    'QUESTION_VERSION_UPDATE',
    'REVIEW_REQUEST',
    'CHANGE_REQUEST',
    'APPROVAL',
    'APPROVAL_WITHDRAWAL',
    'PUBLICATION',
    'RETIREMENT',
    'QUESTION_ARCHIVE',
    'REVIEW_REQUEST_BATCH',
    'IMPORT_APPLY',
    'EXPORT',
    'REPORT_TRIAGE',
    'REPORT_RESOLUTION',
    'REAUTHENTICATION',
    'AUTHOR_ERASURE_ABANDON'
);

-- TYPE: AdminAuditEnvironment
CREATE TYPE "AdminAuditEnvironment" AS ENUM (
    'TEST',
    'DEVELOPMENT',
    'PRODUCTION'
);

-- TYPE: AdminAuditTargetType
CREATE TYPE "AdminAuditTargetType" AS ENUM (
    'QUESTION',
    'QUESTION_VERSION',
    'QUESTION_REPORT',
    'REVIEW_REQUEST_BATCH',
    'IMPORT_REQUEST',
    'EXPORT_REQUEST',
    'ADMIN_SESSION',
    'USER_ERASURE'
);

-- TYPE: AuthSessionAuthorizationState
CREATE TYPE "AuthSessionAuthorizationState" AS ENUM (
    'ACTIVE',
    'PENDING_REAUTH'
);

-- TYPE: AuthSessionIssuerProtocolVersion
CREATE TYPE "AuthSessionIssuerProtocolVersion" AS ENUM (
    'LEGACY',
    'PHASE7_V1'
);

-- TYPE: AuthVerificationPurpose
CREATE TYPE "AuthVerificationPurpose" AS ENUM (
    'PASSWORD_RESET_V1'
);

-- TYPE: ContentReviewAction
CREATE TYPE "ContentReviewAction" AS ENUM (
    'REQUESTED',
    'CHANGES_REQUESTED',
    'APPROVED',
    'APPROVAL_WITHDRAWN',
    'PUBLISHED',
    'RETIRED',
    'ARCHIVE_ABANDONED',
    'AUTHOR_ERASURE_ABANDONED'
);

-- TYPE: CreatorLabelSnapshot
CREATE TYPE "CreatorLabelSnapshot" AS ENUM (
    'ACTIVE_ADMIN',
    'DELETED_ADMIN',
    'SYSTEM_SEED'
);

-- TYPE: EvidenceActorKind
CREATE TYPE "EvidenceActorKind" AS ENUM (
    'ACCOUNT',
    'SYSTEM'
);

-- TYPE: EvidenceActorRole
CREATE TYPE "EvidenceActorRole" AS ENUM (
    'USER',
    'ADMIN',
    'SYSTEM'
);

-- TYPE: IdempotencyOperation
CREATE TYPE "IdempotencyOperation" AS ENUM (
    'STUDY_SUBMIT',
    'STUDY_DRAFT_SAVE',
    'STUDY_RETRY_CREATE',
    'STUDY_TARGETED_REVIEW_CREATE'
);

-- TYPE: IdempotencyPrincipalType
CREATE TYPE "IdempotencyPrincipalType" AS ENUM (
    'USER',
    'GUEST'
);

-- TYPE: IdempotencyState
CREATE TYPE "IdempotencyState" AS ENUM (
    'PROCESSING',
    'SUCCEEDED'
);

-- TYPE: JlptLevel
CREATE TYPE "JlptLevel" AS ENUM (
    'N5',
    'N4',
    'N3',
    'N2',
    'N1'
);

-- TYPE: AuthorityRevocationReason
CREATE TYPE "AuthorityRevocationReason" AS ENUM (
    'ADMIN_AUTHORITY_LOST',
    'SESSION_INVALIDATED'
);

-- TYPE: ReauthenticationIntentState
CREATE TYPE "ReauthenticationIntentState" AS ENUM (
    'PREPARED',
    'STAGED',
    'FINALIZED'
);

-- TYPE: QuestionDifficulty
CREATE TYPE "QuestionDifficulty" AS ENUM (
    'EASY',
    'NORMAL',
    'HARD'
);

-- TYPE: QuestionLifecycleStatus
CREATE TYPE "QuestionLifecycleStatus" AS ENUM (
    'ACTIVE',
    'ARCHIVED'
);

-- TYPE: QuestionReportReason
CREATE TYPE "QuestionReportReason" AS ENUM (
    'ANSWER_ERROR',
    'EXPLANATION_ERROR',
    'TYPO_OR_GRAMMAR',
    'AMBIGUOUS',
    'LEVEL_OR_TAXONOMY',
    'OTHER'
);

-- TYPE: QuestionReportResolutionOutcome
CREATE TYPE "QuestionReportResolutionOutcome" AS ENUM (
    'RESOLVED',
    'DISMISSED'
);

-- TYPE: QuestionReportStatus
CREATE TYPE "QuestionReportStatus" AS ENUM (
    'OPEN',
    'TRIAGED',
    'RESOLVED',
    'DISMISSED'
);

-- TYPE: QuestionSourceType
CREATE TYPE "QuestionSourceType" AS ENUM (
    'ORIGINAL'
);

-- TYPE: QuestionSubject
CREATE TYPE "QuestionSubject" AS ENUM (
    'VOCABULARY',
    'GRAMMAR',
    'READING'
);

-- TYPE: QuestionType
CREATE TYPE "QuestionType" AS ENUM (
    'KANJI_READING',
    'ORTHOGRAPHY',
    'CONTEXT_VOCABULARY',
    'PARAPHRASE',
    'WORD_USAGE',
    'GRAMMAR_SELECT',
    'SENTENCE_ORDER',
    'TEXT_GRAMMAR',
    'SHORT_READING',
    'MEDIUM_READING',
    'LONG_READING',
    'INFO_RETRIEVAL'
);

-- TYPE: QuestionVersionStatus
CREATE TYPE "QuestionVersionStatus" AS ENUM (
    'DRAFT',
    'IN_REVIEW',
    'CHANGES_REQUESTED',
    'APPROVED',
    'PUBLISHED',
    'RETIRED'
);

-- TYPE: RetirementKind
CREATE TYPE "RetirementKind" AS ENUM (
    'PUBLISHED_RETIREMENT',
    'AUTHOR_ERASURE_ABANDONED',
    'QUESTION_ARCHIVE_ABANDONED'
);

-- TYPE: ReviewEventSource
CREATE TYPE "ReviewEventSource" AS ENUM (
    'STUDY_SUBMIT',
    'WRONG_NOTE_REVIEW',
    'VERSION_REBASE'
);

-- TYPE: StudyMode
CREATE TYPE "StudyMode" AS ENUM (
    'RANDOM',
    'WRONG_NOTE',
    'WEAKNESS',
    'BOOKMARK',
    'DAILY_REVIEW'
);

-- TYPE: StudySessionFallbackReason
CREATE TYPE "StudySessionFallbackReason" AS ENUM (
    'INSUFFICIENT_ELIGIBLE_QUESTIONS',
    'INSUFFICIENT_MODE_CANDIDATES'
);

-- TYPE: StudySessionStatus
CREATE TYPE "StudySessionStatus" AS ENUM (
    'IN_PROGRESS',
    'SUBMITTED',
    'EXPIRED',
    'CANCELLED'
);

-- TYPE: SystemActorLabel
CREATE TYPE "SystemActorLabel" AS ENUM (
    'ACCOUNT_ERASURE'
);

-- TYPE: UserAccountStatus
CREATE TYPE "UserAccountStatus" AS ENUM (
    'ACTIVE',
    'DELETION_PENDING',
    'DELETED'
);

-- TYPE: UserRole
CREATE TYPE "UserRole" AS ENUM (
    'USER',
    'ADMIN'
);

-- TYPE: WrongNoteStatus
CREATE TYPE "WrongNoteStatus" AS ENUM (
    'NEW',
    'REVIEWING',
    'AGAIN',
    'SOLVED'
);

-- FUNCTION: copy_tag_snapshots()
CREATE FUNCTION copy_tag_snapshots() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  tag_row "Tag"%ROWTYPE;
  version_row "QuestionVersion"%ROWTYPE;
BEGIN
  SELECT * INTO tag_row FROM "Tag" WHERE "id" = NEW."tagId";
  SELECT * INTO version_row FROM "QuestionVersion"
    WHERE "id" = NEW."questionVersionId" FOR SHARE;
  IF tag_row."id" IS NULL OR version_row."id" IS NULL THEN
    RAISE EXCEPTION 'QuestionVersionTag target is missing.'
      USING ERRCODE = '23503';
  END IF;
  IF NEW."labelSnapshot" NOT IN ('', tag_row."label")
    OR NEW."normalizedNameSnapshot" NOT IN ('', tag_row."normalizedName") THEN
    RAISE EXCEPTION 'QuestionVersionTag snapshots must exactly copy the live Tag.'
      USING ERRCODE = '23514';
  END IF;
  NEW."labelSnapshot" := tag_row."label";
  NEW."normalizedNameSnapshot" := tag_row."normalizedName";

  IF version_row."createdByLabelSnapshot" = 'SYSTEM_SEED' THEN
    INSERT INTO "TagApplicability" ("tagId", "level", "subject", "questionType")
    VALUES (NEW."tagId", version_row."level", version_row."subject", version_row."questionType")
    ON CONFLICT DO NOTHING;
  ELSIF NOT EXISTS (
    SELECT 1 FROM "TagApplicability"
    WHERE "tagId" = NEW."tagId" AND "level" = version_row."level"
      AND "subject" = version_row."subject"
      AND "questionType" = version_row."questionType"
  ) THEN
    RAISE EXCEPTION 'Tag is not applicable to the QuestionVersion taxonomy.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- FUNCTION: limit_account_api_insert()
CREATE FUNCTION limit_account_api_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- #504 P7 PR5a: the API links an SSO Account only from the User's staged,
  -- unexpired ACCOUNT_LINK proof for that provider subject. SQL sign-in runs
  -- as the function owner and keeps its own rules.
  IF current_user <> 'nihongo_app' THEN RETURN NEW; END IF;
  IF NEW."providerId" NOT IN ('apple', 'google') OR NOT EXISTS (
    SELECT 1 FROM "SsoAccountFreshProof" AS proof
    WHERE proof."userId" = NEW."userId"
      AND proof."context"->>'purpose' = 'ACCOUNT_LINK'
      AND proof."context"->>'provider' = NEW."providerId"
      AND proof."context"->>'accountId' = NEW."accountId"
      AND proof."expiresAt" > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'SSO Account link requires a staged link proof.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- FUNCTION: limit_authority_revocation_evidence_delete()
CREATE FUNCTION limit_authority_revocation_evidence_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
BEGIN
  -- Trusted SQL paths (erasure, legacy cleanup) keep their own rules.
  IF effective_caller <> 'nihongo_app' THEN RETURN OLD; END IF;
  IF NOT (OLD."expiresAt" <= clock_timestamp()) THEN
    RAISE EXCEPTION 'Only expired authority revocation evidence can be deleted.' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

-- FUNCTION: limit_operation_intent_delete()
CREATE FUNCTION limit_operation_intent_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- This function runs as its caller: current_user is nihongo_app only for a
  -- direct API statement.
  IF current_user = 'nihongo_app'
    AND (OLD."backendPid" <> pg_backend_pid()
      OR OLD."transactionId" <> txid_current()) THEN
    RAISE EXCEPTION 'Phase 7 operation intent belongs to another transaction.'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

-- FUNCTION: limit_reauthentication_intent_delete()
CREATE FUNCTION limit_reauthentication_intent_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
BEGIN
  -- Trusted SQL paths (erasure, legacy cleanup) keep their own rules.
  IF effective_caller <> 'nihongo_app' THEN RETURN OLD; END IF;
  IF NOT (OLD."state" <> 'FINALIZED'
    OR OLD."finalizedAt" <= clock_timestamp() - INTERVAL '15 minutes') THEN
    RAISE EXCEPTION 'Only unfinished or settled reauthentication intents can be deleted.' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

-- FUNCTION: limit_user_delete()
CREATE FUNCTION limit_user_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
BEGIN
  IF effective_caller <> 'nihongo_app'
    OR NOT "user_erasure_confirmed"(OLD."id") THEN
    RAISE EXCEPTION 'User delete requires a matching owned erasure intent.'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
      SELECT 1 FROM "QuestionVersion"
      WHERE "createdByUserId" = OLD."id"
        OR ("createdByActorId" = OLD."id"
          AND "status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED'))
    )
    OR EXISTS (SELECT 1 FROM "Question" WHERE "createdByUserId" = OLD."id")
    OR EXISTS (
      SELECT 1 FROM "ContentReview"
      WHERE "actorUserId" = OLD."id" OR "counterpartUserId" = OLD."id"
    )
    OR EXISTS (SELECT 1 FROM "AdminAuditLog" WHERE "actorUserId" = OLD."id")
    OR EXISTS (
      SELECT 1 FROM "QuestionReport"
      WHERE "reporterUserId" = OLD."id" OR "assigneeUserId" = OLD."id"
    )
    OR EXISTS (SELECT 1 FROM "Session" WHERE "userId" = OLD."id") THEN
    RAISE EXCEPTION 'User erasure must tombstone authored history first.'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

-- FUNCTION: limit_sso_account_erasure_request_update()
CREATE FUNCTION limit_sso_account_erasure_request_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
BEGIN
  IF effective_caller = 'nihongo_app'
    AND (NEW."appStatus" IS DISTINCT FROM OLD."appStatus"
      OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt")
    AND NOT (
      OLD."appStatus" = 'DELETION_PENDING' AND NEW."appStatus" = 'DELETED'
      AND OLD."completedAt" IS NULL AND NEW."completedAt" IS NOT NULL
      AND NEW."userId" IS NULL
    ) THEN
    RAISE EXCEPTION 'SSO erasure request completes only after its User is erased.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- FUNCTION: limit_sso_admin_fresh_proof_delete()
CREATE FUNCTION limit_sso_admin_fresh_proof_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
BEGIN
  -- Trusted SQL paths (erasure, legacy cleanup) keep their own rules.
  IF effective_caller <> 'nihongo_app' THEN RETURN OLD; END IF;
  -- #504 P7 PR4a: a proof goes with its User when the API erases that User.
  IF NOT EXISTS (SELECT 1 FROM "User" WHERE "id" = OLD."userId") THEN
    RETURN OLD;
  END IF;
  IF NOT (OLD."completedSessionId" IS NULL OR OLD."expiresAt" <= clock_timestamp()) THEN
    RAISE EXCEPTION 'Only unfinished or expired ADMIN_FRESH proofs can be deleted.' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

-- FUNCTION: limit_sso_admin_fresh_transaction_delete()
CREATE FUNCTION limit_sso_admin_fresh_transaction_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
BEGIN
  -- Trusted SQL paths (erasure, legacy cleanup) keep their own rules.
  IF effective_caller <> 'nihongo_app' THEN RETURN OLD; END IF;
  IF NOT (OLD."createdAt" <= clock_timestamp()) THEN
    RAISE EXCEPTION 'ADMIN_FRESH transactions are deleted only by their one-time use or expiry.' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

-- FUNCTION: lock_tag_assignment_scope()
CREATE FUNCTION lock_tag_assignment_scope() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Retain one transaction-scoped mutex before any QVT row/parent lock or Tag
  -- rename row lock. Multiple statements in one operation therefore cannot
  -- accumulate Tag locks in caller order; the statement verifier below still
  -- locks the complete live Tag set in UUID order.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nihongo-tag-assignment-scope-v1', 0)
  );
  RETURN NULL;
END;
$$;

-- FUNCTION: normalize_user_memo_text(text)
CREATE FUNCTION normalize_user_memo_text(text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $_$
  SELECT btrim(
    $1,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
  )
$_$;

-- FUNCTION: account_snapshot_valid(uuid, uuid, 4cb4dbc64b0d4bb3b66579d8a108a534_test."UserRole", 4cb4dbc64b0d4bb3b66579d8a108a534_test."AccountActorLabel", boolean)
CREATE FUNCTION account_snapshot_valid(live_user_id uuid, actor_id uuid, actor_role "UserRole", actor_label "AccountActorLabel", optional_position boolean) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT CASE
    WHEN live_user_id IS NULL AND actor_id IS NULL
      AND actor_role IS NULL AND actor_label IS NULL
      THEN optional_position
    WHEN actor_id IS NULL OR actor_role IS NULL OR actor_label IS NULL
      THEN false
    WHEN actor_role = 'USER' AND actor_label NOT IN ('ACTIVE_USER', 'DELETED_USER')
      THEN false
    WHEN actor_role = 'ADMIN' AND actor_label NOT IN ('ACTIVE_ADMIN', 'DELETED_ADMIN')
      THEN false
    WHEN actor_label IN ('ACTIVE_USER', 'ACTIVE_ADMIN')
      THEN live_user_id IS NOT NULL AND live_user_id = actor_id
    WHEN actor_label IN ('DELETED_USER', 'DELETED_ADMIN')
      THEN live_user_id IS NULL
    ELSE false
  END;
$$;

-- FUNCTION: audit_metadata_valid(jsonb)
CREATE FUNCTION audit_metadata_valid(value jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    AS $_$
DECLARE
  kind TEXT;
  key_count INTEGER;
  item_count NUMERIC;
  question_count NUMERIC;
  version_count NUMERIC;
  abandoned_count NUMERIC;
  retired_count NUMERIC;
BEGIN
  IF jsonb_typeof(value) <> 'object' OR jsonb_typeof(value->'kind') <> 'string' THEN
    RETURN false;
  END IF;
  kind := value->>'kind';
  key_count := "jsonb_object_size"(value);

  IF kind = 'NONE_V1' THEN
    RETURN key_count = 1;
  ELSIF kind = 'REVIEW_REQUEST_BATCH_V1' THEN
    item_count := (value->>'itemCount')::NUMERIC;
    RETURN key_count = 2 AND jsonb_typeof(value->'itemCount') = 'number'
      AND item_count = trunc(item_count) AND item_count BETWEEN 1 AND 20;
  ELSIF kind = 'IMPORT_APPLY_V1' THEN
    item_count := (value->>'itemCount')::NUMERIC;
    RETURN key_count = 4 AND jsonb_typeof(value->'itemCount') = 'number'
      AND item_count = trunc(item_count) AND item_count BETWEEN 1 AND 100
      AND value->>'validationDigest' ~ '^[0-9a-f]{64}$'
      AND value->>'mappingDigest' ~ '^[0-9a-f]{64}$';
  ELSIF kind = 'EXPORT_V1' THEN
    question_count := (value->>'questionCount')::NUMERIC;
    version_count := (value->>'versionCount')::NUMERIC;
    RETURN key_count = 5
      AND jsonb_typeof(value->'questionCount') = 'number'
      AND jsonb_typeof(value->'versionCount') = 'number'
      AND question_count = trunc(question_count)
      AND version_count = trunc(version_count)
      AND question_count BETWEEN 1 AND 100
      AND version_count >= question_count
      AND version_count <= 9007199254740991
      AND value->>'selectionDigest' ~ '^[0-9a-f]{64}$'
      AND value->>'responseBodyDigest' ~ '^[0-9a-f]{64}$';
  ELSIF kind = 'REAUTHENTICATION_V1' THEN
    RETURN key_count = 2
      AND value->>'rotation' = 'OLD_REVOKED_NEW_ISSUED';
  ELSIF kind = 'QUESTION_ARCHIVE_V1' THEN
    retired_count := (value->>'retiredPublishedCount')::NUMERIC;
    abandoned_count := (value->>'abandonedCandidateCount')::NUMERIC;
    RETURN key_count = 3
      AND jsonb_typeof(value->'retiredPublishedCount') = 'number'
      AND jsonb_typeof(value->'abandonedCandidateCount') = 'number'
      AND retired_count IN (0, 1) AND abandoned_count IN (0, 1);
  ELSIF kind = 'AUTHOR_ERASURE_V1' THEN
    abandoned_count := (value->>'abandonedCount')::NUMERIC;
    RETURN key_count = 3
      AND jsonb_typeof(value->'abandonedCount') = 'number'
      AND abandoned_count = trunc(abandoned_count)
      AND abandoned_count BETWEEN 1 AND 9007199254740991
      AND value->>'subjectActorDigest' ~ '^[0-9a-f]{64}$';
  END IF;

  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$_$;

-- FUNCTION: audit_row_valid(4cb4dbc64b0d4bb3b66579d8a108a534_test."AdminAuditCommand", 4cb4dbc64b0d4bb3b66579d8a108a534_test."AdminAuditTargetType", 4cb4dbc64b0d4bb3b66579d8a108a534_test."EvidenceActorKind", 4cb4dbc64b0d4bb3b66579d8a108a534_test."EvidenceActorRole", text, text, integer, integer, jsonb, jsonb)
CREATE FUNCTION audit_row_valid(command_value "AdminAuditCommand", target_type_value "AdminAuditTargetType", actor_kind_value "EvidenceActorKind", actor_role_value "EvidenceActorRole", before_state_value text, after_state_value text, before_version_value integer, after_version_value integer, changed_fields_value jsonb, metadata_value jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
    AS $$
DECLARE
  metadata_kind TEXT := metadata_value->>'kind';
  is_increment BOOLEAN := before_version_value > 0
    AND after_version_value = before_version_value + 1;
BEGIN
  IF actor_kind_value = 'SYSTEM' THEN
    IF command_value <> 'AUTHOR_ERASURE_ABANDON'
      OR actor_role_value <> 'SYSTEM' THEN
      RETURN false;
    END IF;
  ELSIF actor_role_value <> 'ADMIN' THEN
    RETURN false;
  END IF;

  CASE command_value
    WHEN 'QUESTION_CREATE' THEN
      RETURN target_type_value = 'QUESTION'
        AND before_state_value IS NULL AND after_state_value = 'ACTIVE'
        AND before_version_value IS NULL AND after_version_value = 1
        AND changed_fields_value = '["LIFECYCLE_STATUS","LEVEL","SUBJECT","QUESTION_TYPE","DIFFICULTY","PASSAGE","QUESTION_TEXT","EXPLANATION_KO","EXPLANATION_JA","OPTIONS","CORRECT_OPTION","TAGS"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'QUESTION_VERSION_CREATE' THEN
      RETURN target_type_value = 'QUESTION_VERSION'
        AND before_state_value IS NULL AND after_state_value = 'DRAFT'
        AND before_version_value IS NULL AND after_version_value = 1
        AND changed_fields_value = '["VERSION_STATUS","LEVEL","SUBJECT","QUESTION_TYPE","DIFFICULTY","PASSAGE","QUESTION_TEXT","EXPLANATION_KO","EXPLANATION_JA","OPTIONS","CORRECT_OPTION","TAGS"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'QUESTION_VERSION_UPDATE' THEN
      RETURN target_type_value = 'QUESTION_VERSION'
        AND before_state_value = after_state_value
        AND before_state_value IN ('DRAFT', 'CHANGES_REQUESTED')
        AND is_increment AND metadata_kind = 'NONE_V1'
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(changed_fields_value) AS field
          WHERE field NOT IN ('LEVEL','SUBJECT','QUESTION_TYPE','DIFFICULTY',
            'PASSAGE','QUESTION_TEXT','EXPLANATION_KO','EXPLANATION_JA',
            'OPTIONS','CORRECT_OPTION','TAGS')
        );
    WHEN 'REVIEW_REQUEST' THEN
      RETURN target_type_value = 'QUESTION_VERSION'
        AND before_state_value IN ('DRAFT', 'CHANGES_REQUESTED')
        AND after_state_value = 'IN_REVIEW' AND is_increment
        AND changed_fields_value = '["VERSION_STATUS"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'CHANGE_REQUEST' THEN
      RETURN target_type_value = 'QUESTION_VERSION'
        AND before_state_value = 'IN_REVIEW'
        AND after_state_value = 'CHANGES_REQUESTED' AND is_increment
        AND changed_fields_value = '["VERSION_STATUS"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'APPROVAL' THEN
      RETURN target_type_value = 'QUESTION_VERSION'
        AND before_state_value = 'IN_REVIEW' AND after_state_value = 'APPROVED'
        AND is_increment AND changed_fields_value = '["VERSION_STATUS"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'APPROVAL_WITHDRAWAL' THEN
      RETURN target_type_value = 'QUESTION_VERSION'
        AND before_state_value = 'APPROVED'
        AND after_state_value = 'CHANGES_REQUESTED' AND is_increment
        AND changed_fields_value = '["VERSION_STATUS"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'PUBLICATION' THEN
      RETURN target_type_value = 'QUESTION_VERSION'
        AND before_state_value = 'APPROVED' AND after_state_value = 'PUBLISHED'
        AND is_increment
        AND changed_fields_value = '["VERSION_STATUS","CURRENT_PUBLISHED_VERSION_ID"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'RETIREMENT' THEN
      RETURN target_type_value = 'QUESTION_VERSION'
        AND before_state_value = 'PUBLISHED' AND after_state_value = 'RETIRED'
        AND is_increment
        AND changed_fields_value = '["VERSION_STATUS","CURRENT_PUBLISHED_VERSION_ID"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'QUESTION_ARCHIVE' THEN
      RETURN target_type_value = 'QUESTION'
        AND before_state_value = 'ACTIVE' AND after_state_value = 'ARCHIVED'
        AND is_increment AND metadata_kind = 'QUESTION_ARCHIVE_V1'
        AND changed_fields_value IN (
          '["LIFECYCLE_STATUS"]'::JSONB,
          '["LIFECYCLE_STATUS","VERSION_STATUS"]'::JSONB,
          '["LIFECYCLE_STATUS","CURRENT_PUBLISHED_VERSION_ID"]'::JSONB,
          '["LIFECYCLE_STATUS","VERSION_STATUS","CURRENT_PUBLISHED_VERSION_ID"]'::JSONB
        );
    WHEN 'REVIEW_REQUEST_BATCH' THEN
      RETURN target_type_value = 'REVIEW_REQUEST_BATCH'
        AND before_state_value IS NULL AND after_state_value IS NULL
        AND before_version_value IS NULL AND after_version_value IS NULL
        AND changed_fields_value = '["VERSION_STATUS"]'::JSONB
        AND metadata_kind = 'REVIEW_REQUEST_BATCH_V1';
    WHEN 'IMPORT_APPLY' THEN
      RETURN target_type_value = 'IMPORT_REQUEST'
        AND before_state_value IS NULL AND after_state_value IS NULL
        AND before_version_value IS NULL AND after_version_value IS NULL
        AND changed_fields_value = '["IMPORT_ITEMS"]'::JSONB
        AND metadata_kind = 'IMPORT_APPLY_V1';
    WHEN 'EXPORT' THEN
      RETURN target_type_value = 'EXPORT_REQUEST'
        AND before_state_value IS NULL AND after_state_value IS NULL
        AND before_version_value IS NULL AND after_version_value IS NULL
        AND changed_fields_value = '["EXPORT_SELECTION"]'::JSONB
        AND metadata_kind = 'EXPORT_V1';
    WHEN 'REPORT_TRIAGE' THEN
      RETURN target_type_value = 'QUESTION_REPORT'
        AND before_state_value = 'OPEN' AND after_state_value = 'TRIAGED'
        AND is_increment
        AND changed_fields_value = '["ASSIGNEE","REPORT_STATUS"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'REPORT_RESOLUTION' THEN
      RETURN target_type_value = 'QUESTION_REPORT'
        AND before_state_value = 'TRIAGED'
        AND after_state_value IN ('RESOLVED', 'DISMISSED')
        AND is_increment
        AND changed_fields_value = '["RESOLUTION","REPORT_STATUS"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'REAUTHENTICATION' THEN
      RETURN target_type_value = 'ADMIN_SESSION'
        AND before_state_value IN ('SESSION_STALE', 'SESSION_FRESH')
        AND after_state_value = 'SESSION_FRESH'
        AND before_version_value IS NULL AND after_version_value IS NULL
        AND changed_fields_value = '["SESSION_ROTATION"]'::JSONB
        AND metadata_kind = 'REAUTHENTICATION_V1';
    WHEN 'AUTHOR_ERASURE_ABANDON' THEN
      IF target_type_value = 'USER_ERASURE' THEN
        RETURN before_state_value IS NULL AND after_state_value IS NULL
          AND before_version_value IS NULL AND after_version_value IS NULL
          AND changed_fields_value = '["AUTHOR_TOMBSTONE"]'::JSONB
          AND metadata_kind = 'AUTHOR_ERASURE_V1';
      END IF;
      RETURN target_type_value = 'QUESTION_VERSION'
        AND before_state_value IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
        AND after_state_value = 'RETIRED' AND is_increment
        AND changed_fields_value = '["VERSION_STATUS","AUTHOR_TOMBSTONE"]'::JSONB
        AND metadata_kind = 'NONE_V1';
  END CASE;
  RETURN false;
END;
$$;

-- FUNCTION: bootstrap_first_google_admin(uuid, text, integer, text, 4cb4dbc64b0d4bb3b66579d8a108a534_test."AdminAuditEnvironment")
CREATE FUNCTION bootstrap_first_google_admin(target_user_id uuid, google_subject text, expected_generation integer, expected_schema text, environment_value "AdminAuditEnvironment") RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
DECLARE
  expected_wrapper TEXT;
  resolved_schema TEXT;
  target_user "User"%ROWTYPE;
  result_generation INTEGER;
BEGIN
  PERFORM "require_caller_role"('nihongo_migration');
  expected_wrapper := CASE
    WHEN environment_value = 'TEST' AND current_database() ~ '_test$'
      THEN 'nihongo_test_migration_login'
    WHEN environment_value = 'DEVELOPMENT' AND current_database() ~ '_dev$'
      THEN 'nihongo_development_migration_login'
    ELSE NULL END;
  SELECT n.nspname INTO resolved_schema
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
  WHERE c.oid = '"User"'::regclass AND r.rolname = 'nihongo_owner';
  IF expected_wrapper IS NULL OR SESSION_USER <> expected_wrapper
    OR CURRENT_USER <> 'nihongo_owner'
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
  PERFORM "require_database_capability"(environment_value);
  -- Serializes first-admin decisions and canonical unlink before any User row lock.
  LOCK TABLE "User" IN EXCLUSIVE MODE;
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
$_$;

-- FUNCTION: changed_fields_valid(jsonb)
CREATE FUNCTION changed_fields_valid(value jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
DECLARE
  allowed TEXT[] := ARRAY[
    'LIFECYCLE_STATUS',
    'VERSION_STATUS',
    'CURRENT_PUBLISHED_VERSION_ID',
    'LEVEL',
    'SUBJECT',
    'QUESTION_TYPE',
    'DIFFICULTY',
    'PASSAGE',
    'QUESTION_TEXT',
    'EXPLANATION_KO',
    'EXPLANATION_JA',
    'OPTIONS',
    'CORRECT_OPTION',
    'TAGS',
    'ASSIGNEE',
    'RESOLUTION',
    'REPORT_STATUS',
    'SESSION_ROTATION',
    'IMPORT_ITEMS',
    'EXPORT_SELECTION',
    'AUTHOR_TOMBSTONE'
  ];
  previous_position INTEGER := 0;
  current_position INTEGER;
  field_value TEXT;
BEGIN
  IF jsonb_typeof(value) <> 'array' OR jsonb_array_length(value) > 64 THEN
    RETURN false;
  END IF;

  FOR field_value IN SELECT jsonb_array_elements_text(value)
  LOOP
    current_position := array_position(allowed, field_value);
    IF current_position IS NULL OR current_position <= previous_position THEN
      RETURN false;
    END IF;
    previous_position := current_position;
  END LOOP;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

-- FUNCTION: classify_admin_authority(text)
CREATE FUNCTION classify_admin_authority(raw_token text) RETURNS TABLE(outcome text)
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
      AND session."issuerProtocolVersion" = 'PHASE7_V1'
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

-- FUNCTION: consume_sso_transaction_v2(text, text, text)
CREATE FUNCTION consume_sso_transaction_v2(provider_id text, state_digest text, binding_digest text) RETURNS TABLE(provider text, nonce text, "codeVerifier" text, "callbackURL" text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  PERFORM "require_caller_role"('nihongo_auth_gateway');
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

-- FUNCTION: create_sso_transaction_v2(text, text, text, text, text, text)
CREATE FUNCTION create_sso_transaction_v2(provider_id text, state_digest text, binding_digest text, nonce_value text, verifier_value text, callback_value text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
DECLARE event_time TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "require_caller_role"('nihongo_auth_gateway');
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

-- FUNCTION: evidence_actor_valid(4cb4dbc64b0d4bb3b66579d8a108a534_test."EvidenceActorKind", uuid, uuid, 4cb4dbc64b0d4bb3b66579d8a108a534_test."EvidenceActorRole", 4cb4dbc64b0d4bb3b66579d8a108a534_test."AccountActorLabel", 4cb4dbc64b0d4bb3b66579d8a108a534_test."SystemActorLabel")
CREATE FUNCTION evidence_actor_valid(actor_kind "EvidenceActorKind", live_user_id uuid, actor_id uuid, actor_role "EvidenceActorRole", actor_label "AccountActorLabel", system_label "SystemActorLabel") RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT CASE actor_kind
    WHEN 'ACCOUNT' THEN
      system_label IS NULL
      AND actor_role IN ('USER', 'ADMIN')
      AND "account_snapshot_valid"(
        live_user_id,
        actor_id,
        actor_role::TEXT::"UserRole",
        actor_label,
        false
      )
    WHEN 'SYSTEM' THEN
      live_user_id IS NULL
      AND actor_id IS NULL
      AND actor_role = 'SYSTEM'
      AND actor_label IS NULL
      AND system_label = 'ACCOUNT_ERASURE'
    ELSE false
  END;
$$;

-- FUNCTION: jsonb_object_size(jsonb)
CREATE FUNCTION jsonb_object_size(value jsonb) RETURNS integer
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
  SELECT COUNT(*)::INTEGER FROM jsonb_object_keys(value);
$$;

-- FUNCTION: normalize_duplicate_text(text)
CREATE FUNCTION normalize_duplicate_text(value text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
  SELECT translate(
    "normalize_option_comparison"(value),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz'
  );
$$;

-- FUNCTION: normalize_option_comparison(text)
CREATE FUNCTION normalize_option_comparison(value text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $_$
  SELECT regexp_replace(
    regexp_replace(
      normalize(value, NFKC),
      U&'^[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+|[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+$',
      '',
      'g'
    ),
    U&'[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+',
    ' ',
    'g'
  );
$_$;

-- FUNCTION: normalize_report_description(text)
CREATE FUNCTION normalize_report_description(value text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $_$
  SELECT regexp_replace(
    normalize(replace(replace(value, E'\r\n', E'\n'), E'\r', E'\n'), NFC),
    U&'^[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+|[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+$',
    '',
    'g'
  );
$_$;

-- FUNCTION: question_report_description_digest(text)
CREATE FUNCTION question_report_description_digest(value text) RETURNS character varying
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
  SELECT encode(public.digest(
    convert_to('nihongo-question-report-description-v1', 'UTF8')
      || decode('00', 'hex')
      || convert_to("normalize_report_description"(value), 'UTF8'),
    'sha256'::TEXT
  ), 'hex');
$$;

-- FUNCTION: question_version_fingerprint(uuid)
CREATE FUNCTION question_version_fingerprint(target_version_id uuid) RETURNS character varying
    LANGUAGE plpgsql STABLE STRICT
    AS $$
DECLARE
  version_row "QuestionVersion"%ROWTYPE;
  option_array TEXT;
  correct_text TEXT;
  canonical_identity TEXT;
BEGIN
  SELECT * INTO version_row
  FROM "QuestionVersion"
  WHERE "id" = target_version_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    '[' || string_agg(
      to_json("normalize_duplicate_text"(option."text"))::TEXT,
      ',' ORDER BY "normalize_duplicate_text"(option."text") COLLATE "C"
    ) || ']'
  INTO option_array
  FROM "QuestionOption" AS option
  WHERE option."questionVersionId" = target_version_id;

  SELECT "normalize_duplicate_text"(option."text")
  INTO correct_text
  FROM "QuestionOption" AS option
  WHERE option."questionVersionId" = target_version_id
    AND option."id" = version_row."correctOptionId";

  IF option_array IS NULL OR correct_text IS NULL THEN
    RETURN NULL;
  END IF;

  canonical_identity :=
    '{"correctOptionText":' || to_json(correct_text)::TEXT ||
    ',"optionTexts":' || option_array ||
    ',"passage":' || COALESCE(
      to_json("normalize_duplicate_text"(version_row."passage"))::TEXT,
      'null'
    ) ||
    ',"questionText":' ||
      to_json("normalize_duplicate_text"(version_row."questionText"))::TEXT ||
    ',"questionType":' || to_json(version_row."questionType"::TEXT)::TEXT ||
    ',"subject":' || to_json(version_row."subject"::TEXT)::TEXT || '}';

  RETURN encode(
    public.digest(
      convert_to(canonical_identity, 'UTF8'),
      'sha256'::TEXT
    ),
    'hex'
  );
END;
$$;

-- FUNCTION: reauthentication_token_digest(text)
CREATE FUNCTION reauthentication_token_digest(raw_token text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT SECURITY DEFINER
    AS $$
  SELECT encode(public.digest(
    convert_to('nihongo-reauthentication-intent-v1', 'UTF8')
      || decode('00', 'hex') || convert_to(raw_token, 'UTF8'),
    'sha256'::TEXT
  ), 'hex');
$$;

-- FUNCTION: record_authority_revocation(uuid, 4cb4dbc64b0d4bb3b66579d8a108a534_test."AuthorityRevocationReason")
CREATE FUNCTION record_authority_revocation(target_user_id uuid, reason_value "AuthorityRevocationReason") RETURNS void
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
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
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
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorizationState" = 'ACTIVE'
    AND session."authorityGeneration" = target_user."authorityGeneration"
    AND session."expiresAt" > captured_at
    AND session."createdAt" + INTERVAL '30 days' > captured_at;
END;
$$;

-- FUNCTION: require_caller_role(text)
CREATE FUNCTION require_caller_role(required_role text) RETURNS void
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  effective_caller TEXT := current_setting('role', true);
BEGIN
  IF current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN
    RAISE EXCEPTION 'Phase 7 facades require session_replication_role=origin.'
      USING ERRCODE = '42501';
  END IF;
  IF effective_caller IS NULL OR effective_caller = 'none' THEN
    effective_caller := session_user;
  END IF;
  IF effective_caller IS DISTINCT FROM required_role
    AND NOT (
      effective_caller = 'nihongo_app'
      AND required_role IN ('nihongo_auth_gateway', 'nihongo_erasure_worker')
    ) THEN
    RAISE EXCEPTION 'Caller role % is not authorized for this facade.',
      effective_caller USING ERRCODE = '42501';
  END IF;
END;
$$;

-- FUNCTION: require_database_capability(4cb4dbc64b0d4bb3b66579d8a108a534_test."AdminAuditEnvironment")
CREATE FUNCTION require_database_capability(environment_value "AdminAuditEnvironment" DEFAULT NULL::"AdminAuditEnvironment") RETURNS void
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
    RAISE EXCEPTION 'Phase 7 database capability is absent or stale.'
      USING ERRCODE = '42501';
  END IF;
END;
$_$;

-- FUNCTION: require_runtime_ready()
CREATE FUNCTION require_runtime_ready() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
DECLARE
  effective_caller TEXT := current_setting('role', true);
BEGIN
  IF current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN
    RAISE EXCEPTION 'Phase 7 runtime requires session_replication_role=origin.'
      USING ERRCODE = '42501';
  END IF;
  IF effective_caller IS NULL OR effective_caller = 'none' THEN
    effective_caller := session_user;
  END IF;
  IF effective_caller <> 'nihongo_app' THEN
    RAISE EXCEPTION 'Caller role % is not a Phase 7 runtime role.',
      effective_caller USING ERRCODE = '42501';
  END IF;
  PERFORM "require_database_capability"(NULL);
  RETURN true;
END;
$$;

-- FUNCTION: resolve_sso_identity(text, text, text, text)
CREATE FUNCTION resolve_sso_identity(provider_id text, provider_subject text, contact_email text, display_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE target_user "User"%ROWTYPE; target_id UUID; event_time TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "require_caller_role"('nihongo_auth_gateway');
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

-- FUNCTION: user_erasure_confirmed(uuid)
CREATE FUNCTION user_erasure_confirmed(target_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $_$
  SELECT target_user_id IS NOT NULL AND (
    EXISTS (
      SELECT 1
      FROM "User" AS target
      JOIN "SsoAccountErasureRequest" AS request
        ON request."userId" = target."id"
      WHERE target."id" = target_user_id
        AND target."accountStatus" = 'DELETION_PENDING'
        AND request."appStatus" = 'DELETION_PENDING'
        AND jsonb_array_length(request."providerCleanup") > 0
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(request."providerCleanup") AS cleanup
          WHERE cleanup->>'status' IS DISTINCT FROM 'COMPLETED'
        )
    )
    OR (
      COALESCE(
        current_setting('nihongo.test_erasure_user', true) = target_user_id::TEXT,
        false
      )
      AND current_database() ~ '_test$'
      AND EXISTS (
        SELECT 1 FROM "DatabaseCapability"
        WHERE "id" = 1 AND "environment" = 'TEST'
          AND "databaseName" = current_database()
      )
    )
  )
$_$;

-- FUNCTION: prepare_sso_account_erasure_request()
CREATE FUNCTION prepare_sso_account_erasure_request() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- This function runs as its caller: current_user is nihongo_app only for a
  -- direct API statement.
  IF current_user <> 'nihongo_app' THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "User"
    WHERE "id" = NEW."userId" AND "accountStatus" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'SSO erasure request requires an active User.'
      USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'provider', p.provider, 'status', 'PENDING'
    ) ORDER BY p.provider), '[]'::jsonb)
  INTO NEW."providerCleanup"
  FROM (
    SELECT DISTINCT "providerId" AS provider FROM "Account"
    WHERE "userId" = NEW."userId" AND "providerId" IN ('apple', 'google')
  ) AS p;
  NEW."appStatus" := 'DELETION_PENDING';
  NEW."createdAt" := clock_timestamp();
  NEW."receiptExpiresAt" := clock_timestamp() + INTERVAL '1 day';
  NEW."completedAt" := NULL;
  NEW."leaseToken" := NULL;
  NEW."leaseExpiresAt" := NULL;
  NEW."activeProvider" := NULL;
  RETURN NEW;
END;
$$;

-- FUNCTION: protect_account()
CREATE FUNCTION protect_account() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- #504 P7 PR4a: an erased User's Accounts go with the User delete, which
    -- User_limit_erasure_delete accepts only for a confirmed erasure.
    IF OLD."providerId" = 'credential'
      AND EXISTS (SELECT 1 FROM "User" WHERE "id" = OLD."userId") THEN
      RAISE EXCEPTION 'Credential Account delete is erasure-only.'
        USING ERRCODE = '42501';
    END IF;
    -- #504 P7 PR5a: an API SSO Account unlink revokes every Session of its
    -- User, as unlink_sso_account did: the User trigger accepts this
    -- generation step, records the revocation and deletes the Sessions. An
    -- erasure removes Accounts with the User row.
    IF COALESCE(NULLIF(current_setting('role', true), 'none'), session_user) = 'nihongo_app'
      AND OLD."providerId" IN ('apple', 'google')
      AND EXISTS (SELECT 1 FROM "User" WHERE "id" = OLD."userId") THEN
      UPDATE "User" SET "authorityGeneration" = "authorityGeneration" + 1
      WHERE "id" = OLD."userId";
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."accountId" <> OLD."accountId"
    OR NEW."providerId" <> OLD."providerId" OR NEW."userId" <> OLD."userId"
    OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'Account identity is insert-only.' USING ERRCODE = '23514';
  END IF;
  IF OLD."providerId" = 'credential' THEN
    RAISE EXCEPTION 'Credential Account update requires owned password authority.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$_$;

-- FUNCTION: protect_evidence_history()
CREATE FUNCTION protect_evidence_history() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  erasure_mode BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Phase 7 evidence delete is forbidden.'
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
    RAISE EXCEPTION 'Phase 7 evidence is append-only.'
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

-- FUNCTION: protect_tag_applicability()
CREATE FUNCTION protect_tag_applicability() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- The reviewed SYSTEM_SEED QVT snapshot trigger is the sole context-free
  -- bootstrap writer. Direct SQL always enters at trigger depth 1.
  IF TG_OP = 'INSERT' AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'TagApplicability is a reviewed immutable mapping.'
    USING ERRCODE = '42501';
END;
$$;

-- FUNCTION: protect_question_history_delete()
CREATE FUNCTION protect_question_history_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'Question hard delete is forbidden.'
    USING ERRCODE = '23514';
END;
$$;

-- FUNCTION: protect_question_version_delete()
CREATE FUNCTION protect_question_version_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'QuestionVersion hard delete is forbidden.'
    USING ERRCODE = '23514';
END;
$$;

-- FUNCTION: redact_user_report_on_reporter_erasure()
CREATE FUNCTION redact_user_report_on_reporter_erasure() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD."reporterUserId" IS NOT NULL AND NEW."reporterUserId" IS NULL THEN
    NEW."description" := '탈퇴한 회원의 제보 내용은 삭제되었습니다.';
    NEW."rowVersion" := OLD."rowVersion" + 1;
    NEW."updatedAt" := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

-- FUNCTION: refresh_question_version_fingerprint()
CREATE FUNCTION refresh_question_version_fingerprint() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  target_id UUID;
  expected_fingerprint VARCHAR(64);
BEGIN
  IF TG_TABLE_NAME = 'QuestionOption' THEN
    target_id := NEW."questionVersionId";
  ELSE
    target_id := NEW."id";
  END IF;
  expected_fingerprint := "question_version_fingerprint"(target_id);

  IF expected_fingerprint IS NOT NULL THEN
    UPDATE "QuestionVersion"
    SET "contentFingerprint" = expected_fingerprint
    WHERE "id" = target_id
      AND "contentFingerprint" IS DISTINCT FROM expected_fingerprint;
  END IF;
  RETURN NEW;
END;
$$;

-- FUNCTION: reject_unfinished_operation()
CREATE FUNCTION reject_unfinished_operation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "OperationIntent"
    WHERE "operationId" = NEW."operationId"
  ) THEN
    RAISE EXCEPTION 'Phase 7 operation was not verified and consumed.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

-- FUNCTION: validate_guest_principal_renewal_change()
CREATE FUNCTION validate_guest_principal_renewal_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."tokenDigest" IS DISTINCT FROM OLD."tokenDigest"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'GuestPrincipal identity is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."lastSeenAt" < OLD."lastSeenAt"
    OR NEW."expiresAt" < OLD."expiresAt" THEN
    RAISE EXCEPTION 'GuestPrincipal renewal timestamps must be monotonic.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- FUNCTION: validate_credential_totality()
CREATE FUNCTION validate_credential_totality() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE target_user_id UUID; changed_row JSONB;
BEGIN
  changed_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  target_user_id := CASE WHEN TG_TABLE_NAME = 'User' THEN (changed_row ->> 'id')::UUID ELSE (changed_row ->> 'userId')::UUID END;
  -- Serialize deferred checks for every mutation of the same User. Two
  -- concurrent removals must not each count the other uncommitted provider.
  PERFORM 1 FROM "User" WHERE "id" = target_user_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "User" WHERE "id" = target_user_id) THEN
    IF NOT EXISTS (SELECT 1 FROM "Account" WHERE "userId" = target_user_id AND "providerId" IN ('credential','apple','google')) THEN
      RAISE EXCEPTION 'Activated auth requires a sign-in Account.' USING ERRCODE = '23514';
    END IF;
    -- A credential password never permits unlinking the last SSO identity.
    IF TG_TABLE_NAME = 'Account' AND TG_OP = 'DELETE'
      AND changed_row ->> 'providerId' IN ('apple','google')
      AND NOT EXISTS (SELECT 1 FROM "Account" WHERE "userId" = target_user_id AND "providerId" IN ('apple','google')) THEN
      RAISE EXCEPTION 'Last SSO sign-in method cannot be removed.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- FUNCTION: validate_inserted_tag_snapshots()
CREATE FUNCTION validate_inserted_tag_snapshots() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  locked_tag "Tag"%ROWTYPE;
BEGIN
  -- The row trigger copies values without taking caller-order locks. This
  -- statement trigger acquires the complete Tag set in canonical UUID order,
  -- then compares each inserted snapshot with the locked live row. A concurrent
  -- rename either precedes the copy or makes the whole statement roll back.
  FOR locked_tag IN
    SELECT tag.*
    FROM "Tag" AS tag
    JOIN (
      SELECT DISTINCT inserted."tagId"
      FROM inserted_tag_rows AS inserted
    ) AS target ON target."tagId" = tag."id"
    ORDER BY tag."id"
    FOR SHARE OF tag
  LOOP
    IF EXISTS (
      SELECT 1
      FROM inserted_tag_rows AS inserted
      WHERE inserted."tagId" = locked_tag."id"
        AND (
          inserted."labelSnapshot" IS DISTINCT FROM locked_tag."label"
          OR inserted."normalizedNameSnapshot"
            IS DISTINCT FROM locked_tag."normalizedName"
        )
    ) THEN
      RAISE EXCEPTION 'QuestionVersionTag snapshot changed during insert.'
        USING ERRCODE = '40001';
    END IF;
  END LOOP;
  IF (SELECT COUNT(DISTINCT "tagId") FROM inserted_tag_rows) <>
    (SELECT COUNT(*) FROM "Tag" AS tag JOIN (
      SELECT DISTINCT "tagId" FROM inserted_tag_rows
    ) AS target ON target."tagId" = tag."id") THEN
    RAISE EXCEPTION 'QuestionVersionTag target disappeared during insert.'
      USING ERRCODE = '23503';
  END IF;
  RETURN NULL;
END;
$$;

-- FUNCTION: validate_question_aggregate()
CREATE FUNCTION validate_question_aggregate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  target_question_id UUID;
  changed_row JSONB;
  parent_row "Question"%ROWTYPE;
  version_count INTEGER;
  v1_count INTEGER;
  open_count INTEGER;
  published_count INTEGER;
  published_id UUID;
  v1_row "QuestionVersion"%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') NOT IN (
    'read committed', 'serializable'
  ) THEN
    RAISE EXCEPTION 'Question content mutation requires READ COMMITTED or SERIALIZABLE isolation.'
      USING ERRCODE = '25001';
  END IF;
  changed_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  target_question_id := CASE WHEN TG_TABLE_NAME = 'Question'
    THEN (changed_row ->> 'id')::UUID
    ELSE (changed_row ->> 'questionId')::UUID
  END;

  SELECT * INTO parent_row FROM "Question" WHERE "id" = target_question_id;
  IF parent_row."id" IS NULL THEN RETURN NULL; END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE "versionNumber" = 1),
    COUNT(*) FILTER (WHERE "status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')),
    COUNT(*) FILTER (WHERE "status" = 'PUBLISHED'),
    min("id"::TEXT) FILTER (WHERE "status" = 'PUBLISHED')::UUID
  INTO version_count, v1_count, open_count, published_count, published_id
  FROM "QuestionVersion" WHERE "questionId" = target_question_id;

  IF version_count < 1 OR v1_count <> 1 OR EXISTS (
    SELECT 1 FROM generate_series(1, version_count) AS expected(number)
    LEFT JOIN "QuestionVersion" AS version
      ON version."questionId" = target_question_id
      AND version."versionNumber" = expected.number
    WHERE version."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'QuestionVersion numbering must be retained contiguous 1..count.'
      USING ERRCODE = '23514';
  END IF;

  IF published_count > 1
    OR (published_count = 1 AND parent_row."currentPublishedVersionId" IS DISTINCT FROM published_id)
    OR (published_count = 0 AND parent_row."currentPublishedVersionId" IS NOT NULL)
    OR (parent_row."lifecycleStatus" = 'ARCHIVED'
      AND (parent_row."currentPublishedVersionId" IS NOT NULL OR open_count <> 0))
    OR (parent_row."lifecycleStatus" <> 'ACTIVE'
      AND (published_count <> 0 OR open_count <> 0)) THEN
    RAISE EXCEPTION 'Question pointer/lifecycle aggregate invariant failed.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v1_row FROM "QuestionVersion"
  WHERE "questionId" = target_question_id AND "versionNumber" = 1;
  IF v1_row."createdByUserId" IS DISTINCT FROM parent_row."createdByUserId"
    OR v1_row."createdByActorId" IS DISTINCT FROM parent_row."createdByActorId"
    OR v1_row."createdByRoleSnapshot" IS DISTINCT FROM parent_row."createdByRoleSnapshot"
    OR v1_row."createdByLabelSnapshot" IS DISTINCT FROM parent_row."createdByLabelSnapshot" THEN
    RAISE EXCEPTION 'Question and version 1 creator provenance must match.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

-- FUNCTION: validate_question_report_insert()
CREATE FUNCTION validate_question_report_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
    "question_report_description_digest"(NEW."description");
  NEW."reporterActorId" := NEW."reporterUserId";
  SELECT "role" INTO NEW."reporterRole" FROM "User" WHERE "id" = NEW."reporterUserId";
  NEW."reporterLabel" := CASE NEW."reporterRole"
    WHEN 'ADMIN' THEN 'ACTIVE_ADMIN'::"AccountActorLabel"
    ELSE 'ACTIVE_USER'::"AccountActorLabel" END;
  IF NEW."status" <> 'OPEN' OR NEW."rowVersion" <> 1
    OR NEW."description" IS NULL
    OR NEW."description" <> "normalize_report_description"(NEW."description")
    OR position(E'\r' IN NEW."description") <> 0
    OR char_length(NEW."description") NOT BETWEEN 1 AND 2000
    OR NEW."descriptionDigest" <>
      "question_report_description_digest"(NEW."description") THEN
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
$$;

-- FUNCTION: validate_question_report_remediation()
CREATE FUNCTION validate_question_report_remediation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  target_number INTEGER;
  remediation "QuestionVersion"%ROWTYPE;
BEGIN
  IF NEW."remediationVersionId" IS NULL THEN RETURN NULL; END IF;
  SELECT "versionNumber" INTO target_number FROM "QuestionVersion"
    WHERE "questionId" = NEW."questionId" AND "id" = NEW."questionVersionId";
  SELECT * INTO remediation FROM "QuestionVersion"
    WHERE "questionId" = NEW."questionId" AND "id" = NEW."remediationVersionId";
  IF NEW."status" <> 'RESOLVED' OR remediation."id" IS NULL
    OR remediation."versionNumber" <= target_number
    OR NOT (
      remediation."status" = 'PUBLISHED'
      OR remediation."status" = 'RETIRED'
        AND remediation."retirementKind" = 'PUBLISHED_RETIREMENT'
        AND remediation."publishedAt" IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'QuestionReport remediation must be later published lineage.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

-- FUNCTION: validate_question_version_content()
CREATE FUNCTION validate_question_version_content() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  target_version_id UUID;
  changed_row JSONB;
  version_row "QuestionVersion"%ROWTYPE;
  option_count INTEGER;
  normalized_option_count INTEGER;
  tag_count INTEGER;
  expected_fingerprint TEXT;
BEGIN
  IF current_setting('transaction_isolation') NOT IN (
    'read committed', 'serializable'
  ) THEN
    RAISE EXCEPTION 'Question content mutation requires READ COMMITTED or SERIALIZABLE isolation.'
      USING ERRCODE = '25001';
  END IF;
  changed_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  target_version_id := CASE WHEN TG_TABLE_NAME = 'QuestionVersion'
    THEN (changed_row ->> 'id')::UUID
    ELSE (changed_row ->> 'questionVersionId')::UUID
  END;
  SELECT * INTO version_row FROM "QuestionVersion" WHERE "id" = target_version_id;
  IF version_row."id" IS NULL THEN RETURN NULL; END IF;

  SELECT COUNT(*), COUNT(DISTINCT "normalize_option_comparison"("text"))
  INTO option_count, normalized_option_count
  FROM "QuestionOption" WHERE "questionVersionId" = target_version_id;
  SELECT COUNT(*) INTO tag_count
  FROM "QuestionVersionTag" WHERE "questionVersionId" = target_version_id;
  expected_fingerprint := "question_version_fingerprint"(target_version_id);

  IF option_count <> 4 OR normalized_option_count <> 4
    OR tag_count NOT BETWEEN 1 AND 12
    OR NOT EXISTS (
      SELECT 1 FROM "QuestionOption"
      WHERE "questionVersionId" = target_version_id
        AND "id" = version_row."correctOptionId"
    ) OR EXISTS (
      SELECT 1 FROM "QuestionVersionTag" AS assignment
      WHERE assignment."questionVersionId" = target_version_id
        AND NOT EXISTS (
          SELECT 1 FROM "TagApplicability" AS applicability
          WHERE applicability."tagId" = assignment."tagId"
            AND applicability."level" = version_row."level"
            AND applicability."subject" = version_row."subject"
            AND applicability."questionType" = version_row."questionType"
        )
    ) OR expected_fingerprint IS NULL
      OR version_row."contentFingerprint" IS DISTINCT FROM expected_fingerprint THEN
    RAISE EXCEPTION 'QuestionVersion must commit complete canonical content.'
      USING ERRCODE = '23514';
  END IF;

  -- READ COMMITTED lifecycle-only paths need an explicit per-fingerprint
  -- winner lock. In a SERIALIZABLE content mutation, the indexed predicate is
  -- to PostgreSQL SSI so an invisible concurrent conflict aborts exactly one
  -- transaction instead of being mistaken for an already-visible duplicate.
  IF current_setting('transaction_isolation') = 'read committed' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(version_row."contentFingerprint", 0)
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM "QuestionVersion" AS duplicate
    WHERE duplicate."contentFingerprint" = version_row."contentFingerprint"
      AND duplicate."questionId" <> version_row."questionId"
  ) THEN
    RAISE EXCEPTION 'Cross-question canonical duplicate is forbidden.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

-- FUNCTION: validate_session_write()
CREATE FUNCTION validate_session_write() RETURNS trigger
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
      AND OLD."issuerProtocolVersion" = 'PHASE7_V1' THEN
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
        RAISE EXCEPTION 'PHASE7_V1 Session requires the owned issuer.'
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

-- FUNCTION: validate_user_change()
CREATE FUNCTION validate_user_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
DECLARE
  -- #504 P7 PR5b: trusted execution is gone; only the TEST-only change
  -- below sets this.
  authority_invalidation BOOLEAN := false;
  revocation_reason "AuthorityRevocationReason";
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
    current_setting('nihongo.test_authority_change', true), ':'
  );
  IF NOT authority_invalidation
    AND effective_caller = 'nihongo_app'
    AND cardinality(test_change) = 3
    AND test_change[1] = OLD."id"::TEXT
    AND current_database() ~ '_test$'
    AND EXISTS (
      SELECT 1 FROM "DatabaseCapability"
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
      ELSIF effective_caller = 'nihongo_migration'
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
        THEN 'ADMIN_AUTHORITY_LOST'::"AuthorityRevocationReason"
      ELSE 'SESSION_INVALIDATED'::"AuthorityRevocationReason"
    END;
    PERFORM "record_authority_revocation"(
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
      PERFORM "record_authority_revocation"(
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
$_$;

-- FUNCTION: validate_verification_write()
CREATE FUNCTION validate_verification_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  -- #504 P7 PR4a: the API deletes the reset intents of a confirmed erasure.
  effective_caller TEXT := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  );
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."purpose" = 'PASSWORD_RESET_V1'
      AND COALESCE(NULLIF(current_setting('role', true), 'none'), session_user) <> 'nihongo_migration'
      AND NOT (effective_caller = 'nihongo_app'
        AND "user_erasure_confirmed"(OLD."resetUserId")) THEN
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

  -- #504 P6a dropped password reset issuance, so no writer can add one.
  IF TG_OP = 'INSERT' AND NEW."purpose" = 'PASSWORD_RESET_V1' THEN
    RAISE EXCEPTION 'Password reset intent requires owned issuance.'
      USING ERRCODE = '42501';
  ELSIF TG_OP = 'INSERT' THEN
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
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

-- TABLE: Account
CREATE TABLE "Account" (
    id uuid NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" uuid NOT NULL,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp(3) with time zone,
    "refreshTokenExpiresAt" timestamp(3) with time zone,
    scope text,
    password text,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL,
    CONSTRAINT "Account_credential_arm_check" CHECK ((("providerId" <> 'credential'::text) OR (("accountId" = ("userId")::text) AND (password IS NOT NULL) AND ("accessToken" IS NULL) AND ("refreshToken" IS NULL) AND ("idToken" IS NULL) AND ("accessTokenExpiresAt" IS NULL) AND ("refreshTokenExpiresAt" IS NULL) AND (scope IS NULL))))
);

-- TABLE: AdminAuditLog
CREATE TABLE "AdminAuditLog" (
    id uuid DEFAULT public.gen_random_uuid() NOT NULL,
    command "AdminAuditCommand" NOT NULL,
    "targetType" "AdminAuditTargetType" NOT NULL,
    "targetId" uuid NOT NULL,
    "actorKind" "EvidenceActorKind" NOT NULL,
    "actorUserId" uuid,
    "actorId" uuid,
    "actorRole" "EvidenceActorRole" NOT NULL,
    "actorLabel" "AccountActorLabel",
    "actorSystemLabel" "SystemActorLabel",
    "beforeState" character varying(64),
    "afterState" character varying(64),
    "beforeRowVersion" integer,
    "afterRowVersion" integer,
    "changedFields" jsonb NOT NULL,
    metadata jsonb NOT NULL,
    "contentDigest" character varying(64) NOT NULL,
    "operationId" uuid NOT NULL,
    "requestId" uuid NOT NULL,
    environment "AdminAuditEnvironment" NOT NULL,
    "occurredAt" timestamp(3) with time zone NOT NULL,
    CONSTRAINT "AdminAuditLog_actor_check" CHECK (evidence_actor_valid("actorKind", "actorUserId", "actorId", "actorRole", "actorLabel", "actorSystemLabel")),
    CONSTRAINT "AdminAuditLog_changed_fields_check" CHECK (changed_fields_valid("changedFields")),
    CONSTRAINT "AdminAuditLog_digest_check" CHECK ((("contentDigest")::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT "AdminAuditLog_matrix_check" CHECK (audit_row_valid(command, "targetType", "actorKind", "actorRole", ("beforeState")::text, ("afterState")::text, "beforeRowVersion", "afterRowVersion", "changedFields", metadata)),
    CONSTRAINT "AdminAuditLog_metadata_check" CHECK (audit_metadata_valid(metadata))
);

-- TABLE: Bookmark
CREATE TABLE "Bookmark" (
    id uuid NOT NULL,
    "userId" uuid NOT NULL,
    "questionId" uuid NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- TABLE: ContentReview
CREATE TABLE "ContentReview" (
    id uuid DEFAULT public.gen_random_uuid() NOT NULL,
    "questionId" uuid NOT NULL,
    "questionVersionId" uuid NOT NULL,
    action "ContentReviewAction" NOT NULL,
    "fromState" "QuestionVersionStatus" NOT NULL,
    "toState" "QuestionVersionStatus" NOT NULL,
    "actorKind" "EvidenceActorKind" NOT NULL,
    "actorUserId" uuid,
    "actorId" uuid,
    "actorRole" "EvidenceActorRole" NOT NULL,
    "actorLabel" "AccountActorLabel",
    "actorSystemLabel" "SystemActorLabel",
    "counterpartUserId" uuid,
    "counterpartActorId" uuid,
    "counterpartRole" "UserRole",
    "counterpartLabel" "AccountActorLabel",
    reason character varying(100),
    comment character varying(1000),
    "operationId" uuid NOT NULL,
    "requestId" uuid NOT NULL,
    "occurredAt" timestamp(3) with time zone NOT NULL,
    CONSTRAINT "ContentReview_action_check" CHECK ((((action = 'REQUESTED'::"ContentReviewAction") AND ("fromState" = ANY (ARRAY['DRAFT'::"QuestionVersionStatus", 'CHANGES_REQUESTED'::"QuestionVersionStatus"])) AND ("toState" = 'IN_REVIEW'::"QuestionVersionStatus") AND ("actorKind" = 'ACCOUNT'::"EvidenceActorKind") AND ("actorRole" = 'ADMIN'::"EvidenceActorRole") AND ("counterpartActorId" IS NULL) AND (reason IS NULL)) OR ((action = 'CHANGES_REQUESTED'::"ContentReviewAction") AND ("fromState" = 'IN_REVIEW'::"QuestionVersionStatus") AND ("toState" = 'CHANGES_REQUESTED'::"QuestionVersionStatus") AND ("actorKind" = 'ACCOUNT'::"EvidenceActorKind") AND ("actorRole" = 'ADMIN'::"EvidenceActorRole") AND ("counterpartActorId" IS NOT NULL) AND ("counterpartRole" = 'ADMIN'::"UserRole") AND ("actorId" <> "counterpartActorId") AND (reason IS NOT NULL)) OR ((action = 'APPROVED'::"ContentReviewAction") AND ("fromState" = 'IN_REVIEW'::"QuestionVersionStatus") AND ("toState" = 'APPROVED'::"QuestionVersionStatus") AND ("actorKind" = 'ACCOUNT'::"EvidenceActorKind") AND ("actorRole" = 'ADMIN'::"EvidenceActorRole") AND ("counterpartActorId" IS NOT NULL) AND ("counterpartRole" = 'ADMIN'::"UserRole") AND (reason IS NULL)) OR ((action = 'APPROVAL_WITHDRAWN'::"ContentReviewAction") AND ("fromState" = 'APPROVED'::"QuestionVersionStatus") AND ("toState" = 'CHANGES_REQUESTED'::"QuestionVersionStatus") AND ("actorKind" = 'ACCOUNT'::"EvidenceActorKind") AND ("actorRole" = 'ADMIN'::"EvidenceActorRole") AND ("counterpartActorId" IS NOT NULL) AND ("counterpartRole" = 'ADMIN'::"UserRole") AND (reason IS NOT NULL)) OR ((action = 'PUBLISHED'::"ContentReviewAction") AND ("fromState" = 'APPROVED'::"QuestionVersionStatus") AND ("toState" = 'PUBLISHED'::"QuestionVersionStatus") AND ("actorKind" = 'ACCOUNT'::"EvidenceActorKind") AND ("actorRole" = 'ADMIN'::"EvidenceActorRole") AND ("counterpartActorId" IS NOT NULL) AND ("counterpartRole" = 'ADMIN'::"UserRole") AND (reason IS NULL) AND (comment IS NULL)) OR ((action = 'RETIRED'::"ContentReviewAction") AND ("fromState" = 'PUBLISHED'::"QuestionVersionStatus") AND ("toState" = 'RETIRED'::"QuestionVersionStatus") AND ("actorKind" = 'ACCOUNT'::"EvidenceActorKind") AND ("actorRole" = 'ADMIN'::"EvidenceActorRole") AND ("counterpartActorId" IS NULL) AND ((reason)::text = ANY ((ARRAY['PUBLISHED_REPLACEMENT'::character varying, 'PUBLISHED_RETIREMENT'::character varying, 'QUESTION_ARCHIVE'::character varying])::text[])) AND (comment IS NULL)) OR ((action = 'ARCHIVE_ABANDONED'::"ContentReviewAction") AND ("fromState" = ANY (ARRAY['DRAFT'::"QuestionVersionStatus", 'IN_REVIEW'::"QuestionVersionStatus", 'CHANGES_REQUESTED'::"QuestionVersionStatus", 'APPROVED'::"QuestionVersionStatus"])) AND ("toState" = 'RETIRED'::"QuestionVersionStatus") AND ("actorKind" = 'ACCOUNT'::"EvidenceActorKind") AND ("actorRole" = 'ADMIN'::"EvidenceActorRole") AND ("counterpartActorId" IS NOT NULL) AND ("counterpartRole" = 'ADMIN'::"UserRole") AND ((reason)::text = 'QUESTION_ARCHIVE'::text) AND (comment IS NULL)) OR ((action = 'AUTHOR_ERASURE_ABANDONED'::"ContentReviewAction") AND ("fromState" = ANY (ARRAY['DRAFT'::"QuestionVersionStatus", 'IN_REVIEW'::"QuestionVersionStatus", 'CHANGES_REQUESTED'::"QuestionVersionStatus", 'APPROVED'::"QuestionVersionStatus"])) AND ("toState" = 'RETIRED'::"QuestionVersionStatus") AND ("actorKind" = 'SYSTEM'::"EvidenceActorKind") AND ("actorRole" = 'SYSTEM'::"EvidenceActorRole") AND ("counterpartActorId" IS NOT NULL) AND ("counterpartRole" = 'ADMIN'::"UserRole") AND ((reason)::text = 'AUTHOR_ERASURE'::text) AND (comment IS NULL)))),
    CONSTRAINT "ContentReview_actor_check" CHECK (evidence_actor_valid("actorKind", "actorUserId", "actorId", "actorRole", "actorLabel", "actorSystemLabel")),
    CONSTRAINT "ContentReview_counterpart_check" CHECK (account_snapshot_valid("counterpartUserId", "counterpartActorId", "counterpartRole", "counterpartLabel", true)),
    CONSTRAINT "ContentReview_text_check" CHECK ((((reason IS NULL) OR (((reason)::text = btrim((reason)::text)) AND ((char_length((reason)::text) >= 1) AND (char_length((reason)::text) <= 100)))) AND ((comment IS NULL) OR (((comment)::text = btrim((comment)::text)) AND ((char_length((comment)::text) >= 1) AND (char_length((comment)::text) <= 1000))))))
);

-- TABLE: GuestPrincipal
CREATE TABLE "GuestPrincipal" (
    id uuid NOT NULL,
    "tokenDigest" character varying(64) NOT NULL,
    "expiresAt" timestamp(3) with time zone NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastSeenAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "GuestPrincipal_digest_format_check" CHECK ((("tokenDigest")::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT "GuestPrincipal_valid_expiry" CHECK ((("lastSeenAt" >= "createdAt") AND ("expiresAt" > "lastSeenAt") AND ("expiresAt" <= ("lastSeenAt" + '7 days'::interval))))
);

-- TABLE: IdempotencyRecord
CREATE TABLE "IdempotencyRecord" (
    id uuid NOT NULL,
    "principalType" "IdempotencyPrincipalType" NOT NULL,
    "userId" uuid,
    "guestPrincipalId" uuid,
    operation "IdempotencyOperation" NOT NULL,
    "idempotencyKey" uuid NOT NULL,
    "studySessionId" uuid NOT NULL,
    "requestHash" character varying(64) NOT NULL,
    state "IdempotencyState" DEFAULT 'PROCESSING'::"IdempotencyState" NOT NULL,
    "responseStatus" integer,
    "responseBody" jsonb,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "completedAt" timestamp(3) with time zone,
    "expiresAt" timestamp(3) with time zone,
    "contractVersion" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "IdempotencyRecord_contract_version_check" CHECK (("contractVersion" = ANY (ARRAY[1, 2]))),
    CONSTRAINT "IdempotencyRecord_hash_check" CHECK ((("requestHash")::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT "IdempotencyRecord_principal_check" CHECK (((("principalType" = 'USER'::"IdempotencyPrincipalType") AND ("userId" IS NOT NULL) AND ("guestPrincipalId" IS NULL)) OR (("principalType" = 'GUEST'::"IdempotencyPrincipalType") AND ("userId" IS NULL) AND ("guestPrincipalId" IS NOT NULL)))),
    CONSTRAINT "IdempotencyRecord_state_check" CHECK ((((state = 'PROCESSING'::"IdempotencyState") AND ("responseStatus" IS NULL) AND ("responseBody" IS NULL) AND ("completedAt" IS NULL) AND ("expiresAt" IS NULL)) OR ((state = 'SUCCEEDED'::"IdempotencyState") AND ("responseStatus" IS NOT NULL) AND ("responseBody" IS NOT NULL) AND (jsonb_typeof("responseBody") = 'object'::text) AND ("completedAt" IS NOT NULL) AND ("expiresAt" IS NOT NULL) AND ("completedAt" >= "createdAt") AND (((operation = 'STUDY_SUBMIT'::"IdempotencyOperation") AND ("responseStatus" = 201) AND ("expiresAt" = ("completedAt" + '24:00:00'::interval))) OR ((operation = 'STUDY_DRAFT_SAVE'::"IdempotencyOperation") AND ("responseStatus" = 200) AND ("expiresAt" = ("completedAt" + '48:00:00'::interval))) OR ((operation = ANY (ARRAY['STUDY_RETRY_CREATE'::"IdempotencyOperation", 'STUDY_TARGETED_REVIEW_CREATE'::"IdempotencyOperation"])) AND ("responseStatus" = 201) AND ("expiresAt" = ("completedAt" + '7 days'::interval)))))))
);

-- TABLE: AuthorityRevocationEvidence
CREATE TABLE "AuthorityRevocationEvidence" (
    "tokenDigest" character varying(64) NOT NULL,
    "sessionId" uuid NOT NULL,
    reason "AuthorityRevocationReason" NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    "expiresAt" timestamp(3) with time zone NOT NULL,
    CONSTRAINT "AuthorityRevocationEvidence_digest_shape_check" CHECK ((("tokenDigest")::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT "AuthorityRevocationEvidence_lifetime_check" CHECK ((("expiresAt" > "createdAt") AND ("expiresAt" <= ("createdAt" + '00:15:00'::interval))))
);

-- TABLE: DatabaseCapability
CREATE TABLE "DatabaseCapability" (
    id smallint DEFAULT 1 NOT NULL,
    "databaseName" text NOT NULL,
    "serverAddress" inet NOT NULL,
    "serverPort" integer NOT NULL,
    environment "AdminAuditEnvironment" NOT NULL,
    "registeredAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "DatabaseCapability_port_check" CHECK ((("serverPort" >= 1) AND ("serverPort" <= 65535))),
    CONSTRAINT "DatabaseCapability_singleton_check" CHECK ((id = 1))
);

-- TABLE: OperationIntent
CREATE TABLE "OperationIntent" (
    "operationId" uuid NOT NULL,
    "requestId" uuid,
    command "AdminAuditCommand" NOT NULL,
    "actorUserId" uuid,
    "actorSessionId" uuid,
    "capturedAuthorityGeneration" integer,
    "referencedUserIds" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    "targetManifest" jsonb,
    "requiresFresh" boolean DEFAULT false NOT NULL,
    environment "AdminAuditEnvironment" NOT NULL,
    "occurredAt" timestamp(3) with time zone,
    "backendPid" integer DEFAULT pg_backend_pid() NOT NULL,
    "transactionId" bigint DEFAULT txid_current() NOT NULL,
    CONSTRAINT "OperationIntent_referenced_users_check" CHECK (((cardinality("referencedUserIds") >= 0) AND (array_position("referencedUserIds", NULL::uuid) IS NULL)))
);

-- TABLE: ReauthenticationIntent
CREATE TABLE "ReauthenticationIntent" (
    id uuid DEFAULT public.gen_random_uuid() NOT NULL,
    "operationId" uuid DEFAULT public.gen_random_uuid() NOT NULL,
    "requestId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    "oldSessionId" uuid NOT NULL,
    "oldTokenDigest" character varying(64) NOT NULL,
    "capturedAuthorityGeneration" integer CONSTRAINT "ReauthenticationInten_capturedAuthorityGeneratio_not_null" NOT NULL,
    "capturedRole" "UserRole" NOT NULL,
    "capturedAccountStatus" "UserAccountStatus" NOT NULL,
    state "ReauthenticationIntentState" DEFAULT 'PREPARED'::"ReauthenticationIntentState" NOT NULL,
    "stagedSessionId" uuid,
    "stagedTokenDigest" character varying(64),
    environment "AdminAuditEnvironment" NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    "expiresAt" timestamp(3) with time zone NOT NULL,
    "finalizedAt" timestamp(3) with time zone,
    CONSTRAINT "ReauthenticationIntent_authority_check" CHECK ((("capturedAuthorityGeneration" > 0) AND ("capturedRole" = 'ADMIN'::"UserRole") AND ("capturedAccountStatus" = 'ACTIVE'::"UserAccountStatus"))),
    CONSTRAINT "ReauthenticationIntent_lifetime_check" CHECK ((("expiresAt" > "createdAt") AND ("expiresAt" <= ("createdAt" + '00:05:00'::interval)))),
    CONSTRAINT "ReauthenticationIntent_state_shape_check" CHECK ((((state = 'PREPARED'::"ReauthenticationIntentState") AND ("stagedSessionId" IS NULL) AND ("stagedTokenDigest" IS NULL) AND ("finalizedAt" IS NULL)) OR ((state = 'STAGED'::"ReauthenticationIntentState") AND ("stagedSessionId" IS NOT NULL) AND ("stagedTokenDigest" IS NOT NULL) AND ("finalizedAt" IS NULL)) OR ((state = 'FINALIZED'::"ReauthenticationIntentState") AND ("stagedSessionId" IS NOT NULL) AND ("stagedTokenDigest" IS NOT NULL) AND ("finalizedAt" IS NOT NULL))))
);

-- TABLE: Question
CREATE TABLE "Question" (
    id uuid NOT NULL,
    "lifecycleStatus" "QuestionLifecycleStatus" DEFAULT 'ACTIVE'::"QuestionLifecycleStatus" NOT NULL,
    "currentPublishedVersionId" uuid,
    "createdByUserId" uuid,
    "createdByLabelSnapshot" "CreatorLabelSnapshot" NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL,
    "archivedAt" timestamp(3) with time zone,
    "rowVersion" integer DEFAULT 1 NOT NULL,
    "createdByActorId" uuid,
    "createdByRoleSnapshot" "UserRole",
    CONSTRAINT "Question_creator_snapshot_check" CHECK (((("createdByLabelSnapshot" = 'SYSTEM_SEED'::"CreatorLabelSnapshot") AND ("createdByUserId" IS NULL) AND ("createdByActorId" IS NULL) AND ("createdByRoleSnapshot" IS NULL)) OR (("createdByLabelSnapshot" = 'ACTIVE_ADMIN'::"CreatorLabelSnapshot") AND ("createdByUserId" IS NOT NULL) AND ("createdByActorId" = "createdByUserId") AND ("createdByRoleSnapshot" = 'ADMIN'::"UserRole")) OR (("createdByLabelSnapshot" = 'DELETED_ADMIN'::"CreatorLabelSnapshot") AND ("createdByUserId" IS NULL) AND ("createdByActorId" IS NOT NULL) AND ("createdByRoleSnapshot" = 'ADMIN'::"UserRole")))),
    CONSTRAINT "Question_lifecycle_check" CHECK (((("lifecycleStatus" = 'ACTIVE'::"QuestionLifecycleStatus") AND ("archivedAt" IS NULL)) OR (("lifecycleStatus" = 'ARCHIVED'::"QuestionLifecycleStatus") AND ("archivedAt" IS NOT NULL) AND ("currentPublishedVersionId" IS NULL)))),
    CONSTRAINT "Question_positive_row_version_check" CHECK (("rowVersion" > 0))
);

-- TABLE: QuestionImportResult
CREATE TABLE "QuestionImportResult" (
    "importId" uuid NOT NULL,
    "actorUserId" uuid NOT NULL,
    "requestDigest" character varying(64) NOT NULL,
    response jsonb NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "QuestionImportResult_requestDigest_check" CHECK ((("requestDigest")::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT "QuestionImportResult_response_check" CHECK ((jsonb_typeof(response) = 'object'::text))
);

-- TABLE: QuestionOption
CREATE TABLE "QuestionOption" (
    id uuid NOT NULL,
    "questionVersionId" uuid NOT NULL,
    label text NOT NULL,
    text text NOT NULL,
    ordinal integer NOT NULL,
    CONSTRAINT "QuestionOption_label_ordinal_check" CHECK ((((ordinal >= 1) AND (ordinal <= 4)) AND (label = (ordinal)::text) AND (btrim(text) <> ''::text)))
);

-- TABLE: QuestionReport
CREATE TABLE "QuestionReport" (
    id uuid DEFAULT public.gen_random_uuid() NOT NULL,
    "questionId" uuid NOT NULL,
    "questionVersionId" uuid NOT NULL,
    reason "QuestionReportReason" NOT NULL,
    description text,
    "descriptionDigest" character varying(64) NOT NULL,
    status "QuestionReportStatus" DEFAULT 'OPEN'::"QuestionReportStatus" NOT NULL,
    "reporterUserId" uuid,
    "reporterActorId" uuid NOT NULL,
    "reporterRole" "UserRole" NOT NULL,
    "reporterLabel" "AccountActorLabel" NOT NULL,
    "assigneeUserId" uuid,
    "assigneeActorId" uuid,
    "assigneeRole" "UserRole",
    "assigneeLabel" "AccountActorLabel",
    "resolutionOutcome" "QuestionReportResolutionOutcome",
    "resolutionReason" character varying(1000),
    "remediationVersionId" uuid,
    "rowVersion" integer DEFAULT 1 NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    "updatedAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    "resolvedAt" timestamp(3) with time zone,
    CONSTRAINT "QuestionReport_assignee_check" CHECK ((account_snapshot_valid("assigneeUserId", "assigneeActorId", "assigneeRole", "assigneeLabel", true) AND (("assigneeRole" IS NULL) OR ("assigneeRole" = 'ADMIN'::"UserRole")))),
    CONSTRAINT "QuestionReport_digest_check" CHECK ((("descriptionDigest")::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT "QuestionReport_reporter_check" CHECK (account_snapshot_valid("reporterUserId", "reporterActorId", "reporterRole", "reporterLabel", false)),
    CONSTRAINT "QuestionReport_state_check" CHECK (((("rowVersion" > 0) AND ("createdAt" <= "updatedAt") AND (((status = 'OPEN'::"QuestionReportStatus") AND ("assigneeActorId" IS NULL) AND ("resolutionOutcome" IS NULL) AND ("resolutionReason" IS NULL) AND ("remediationVersionId" IS NULL) AND ("resolvedAt" IS NULL)) OR ((status = 'TRIAGED'::"QuestionReportStatus") AND ("assigneeActorId" IS NOT NULL) AND ("assigneeRole" = 'ADMIN'::"UserRole") AND ("resolutionOutcome" IS NULL) AND ("resolutionReason" IS NULL) AND ("remediationVersionId" IS NULL) AND ("resolvedAt" IS NULL)) OR ((status = 'RESOLVED'::"QuestionReportStatus") AND ("assigneeActorId" IS NOT NULL) AND ("assigneeRole" = 'ADMIN'::"UserRole") AND ("resolutionOutcome" IS NOT NULL) AND ("resolutionOutcome" = 'RESOLVED'::"QuestionReportResolutionOutcome") AND ("resolutionReason" IS NOT NULL) AND (("resolutionReason")::text = btrim(("resolutionReason")::text)) AND ((char_length(("resolutionReason")::text) >= 1) AND (char_length(("resolutionReason")::text) <= 1000)) AND ("resolvedAt" IS NOT NULL) AND (("resolvedAt" >= "createdAt") AND ("resolvedAt" <= "updatedAt"))) OR ((status = 'DISMISSED'::"QuestionReportStatus") AND ("assigneeActorId" IS NOT NULL) AND ("assigneeRole" = 'ADMIN'::"UserRole") AND ("resolutionOutcome" IS NOT NULL) AND ("resolutionOutcome" = 'DISMISSED'::"QuestionReportResolutionOutcome") AND ("resolutionReason" IS NOT NULL) AND (("resolutionReason")::text = btrim(("resolutionReason")::text)) AND ((char_length(("resolutionReason")::text) >= 1) AND (char_length(("resolutionReason")::text) <= 1000)) AND ("remediationVersionId" IS NULL) AND ("resolvedAt" IS NOT NULL) AND (("resolvedAt" >= "createdAt") AND ("resolvedAt" <= "updatedAt"))))) IS TRUE))
);

-- TABLE: QuestionVersion
CREATE TABLE "QuestionVersion" (
    id uuid NOT NULL,
    "questionId" uuid NOT NULL,
    "versionNumber" integer NOT NULL,
    status "QuestionVersionStatus" DEFAULT 'DRAFT'::"QuestionVersionStatus" NOT NULL,
    level "JlptLevel" NOT NULL,
    subject "QuestionSubject" NOT NULL,
    "questionType" "QuestionType" NOT NULL,
    passage text,
    "questionText" text NOT NULL,
    "correctOptionId" uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    "explanationKo" text NOT NULL,
    "explanationJa" text,
    difficulty "QuestionDifficulty" NOT NULL,
    "sourceType" "QuestionSourceType" DEFAULT 'ORIGINAL'::"QuestionSourceType" NOT NULL,
    "rowVersion" integer DEFAULT 1 NOT NULL,
    "createdByUserId" uuid,
    "createdByLabelSnapshot" "CreatorLabelSnapshot" NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL,
    "publishedAt" timestamp(3) with time zone,
    "retiredAt" timestamp(3) with time zone,
    "retirementKind" "RetirementKind",
    "contentFingerprint" character varying(64) DEFAULT repeat('0'::text, 64) NOT NULL,
    "createdByActorId" uuid,
    "createdByRoleSnapshot" "UserRole",
    CONSTRAINT "QuestionVersion_content_type_check" CHECK ((((subject = 'VOCABULARY'::"QuestionSubject") AND ("questionType" = ANY (ARRAY['KANJI_READING'::"QuestionType", 'ORTHOGRAPHY'::"QuestionType", 'CONTEXT_VOCABULARY'::"QuestionType", 'PARAPHRASE'::"QuestionType", 'WORD_USAGE'::"QuestionType"])) AND (passage IS NULL)) OR ((subject = 'GRAMMAR'::"QuestionSubject") AND ("questionType" = ANY (ARRAY['GRAMMAR_SELECT'::"QuestionType", 'SENTENCE_ORDER'::"QuestionType", 'TEXT_GRAMMAR'::"QuestionType"])) AND (("questionType" = 'TEXT_GRAMMAR'::"QuestionType") OR (passage IS NULL))) OR ((subject = 'READING'::"QuestionSubject") AND (passage IS NOT NULL) AND (((level = ANY (ARRAY['N5'::"JlptLevel", 'N4'::"JlptLevel"])) AND ("questionType" = ANY (ARRAY['SHORT_READING'::"QuestionType", 'INFO_RETRIEVAL'::"QuestionType"]))) OR ((level = 'N3'::"JlptLevel") AND ("questionType" = ANY (ARRAY['SHORT_READING'::"QuestionType", 'MEDIUM_READING'::"QuestionType", 'INFO_RETRIEVAL'::"QuestionType"]))) OR ((level = ANY (ARRAY['N2'::"JlptLevel", 'N1'::"JlptLevel"])) AND ("questionType" = ANY (ARRAY['MEDIUM_READING'::"QuestionType", 'LONG_READING'::"QuestionType", 'INFO_RETRIEVAL'::"QuestionType"]))))))),
    CONSTRAINT "QuestionVersion_creator_snapshot_check" CHECK (((("createdByLabelSnapshot" = 'SYSTEM_SEED'::"CreatorLabelSnapshot") AND ("createdByUserId" IS NULL) AND ("createdByActorId" IS NULL) AND ("createdByRoleSnapshot" IS NULL)) OR (("createdByLabelSnapshot" = 'ACTIVE_ADMIN'::"CreatorLabelSnapshot") AND ("createdByUserId" IS NOT NULL) AND ("createdByActorId" = "createdByUserId") AND ("createdByRoleSnapshot" = 'ADMIN'::"UserRole")) OR (("createdByLabelSnapshot" = 'DELETED_ADMIN'::"CreatorLabelSnapshot") AND ("createdByUserId" IS NULL) AND ("createdByActorId" IS NOT NULL) AND ("createdByRoleSnapshot" = 'ADMIN'::"UserRole")))),
    CONSTRAINT "QuestionVersion_fingerprint_check" CHECK ((("contentFingerprint")::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT "QuestionVersion_lifecycle_timestamp_check" CHECK (((((status = ANY (ARRAY['DRAFT'::"QuestionVersionStatus", 'IN_REVIEW'::"QuestionVersionStatus", 'CHANGES_REQUESTED'::"QuestionVersionStatus", 'APPROVED'::"QuestionVersionStatus"])) AND ("publishedAt" IS NULL) AND ("retiredAt" IS NULL) AND ("retirementKind" IS NULL)) OR ((status = 'PUBLISHED'::"QuestionVersionStatus") AND ("publishedAt" IS NOT NULL) AND ("retiredAt" IS NULL) AND ("retirementKind" IS NULL)) OR ((status = 'RETIRED'::"QuestionVersionStatus") AND ("retirementKind" = 'PUBLISHED_RETIREMENT'::"RetirementKind") AND ("publishedAt" IS NOT NULL) AND ("retiredAt" IS NOT NULL) AND ("retiredAt" >= "publishedAt")) OR ((status = 'RETIRED'::"QuestionVersionStatus") AND ("retirementKind" = ANY (ARRAY['AUTHOR_ERASURE_ABANDONED'::"RetirementKind", 'QUESTION_ARCHIVE_ABANDONED'::"RetirementKind"])) AND ("publishedAt" IS NULL) AND ("retiredAt" IS NOT NULL))) IS TRUE)),
    CONSTRAINT "QuestionVersion_nonblank_content_check" CHECK (((btrim("questionText") <> ''::text) AND (btrim("explanationKo") <> ''::text) AND (("explanationJa" IS NULL) OR (btrim("explanationJa") <> ''::text)) AND ((passage IS NULL) OR (btrim(passage) <> ''::text)))),
    CONSTRAINT "QuestionVersion_positive_version_check" CHECK ((("versionNumber" > 0) AND ("rowVersion" > 0)))
);

-- TABLE: QuestionVersionTag
CREATE TABLE "QuestionVersionTag" (
    id uuid NOT NULL,
    "questionVersionId" uuid NOT NULL,
    "tagId" uuid NOT NULL,
    "labelSnapshot" text NOT NULL,
    "normalizedNameSnapshot" text DEFAULT ''::text NOT NULL,
    CONSTRAINT "QuestionVersionTag_label_snapshot_trimmed_check" CHECK (("labelSnapshot" = btrim("labelSnapshot"))),
    CONSTRAINT "QuestionVersionTag_normalized_snapshot_check" CHECK ((("normalizedNameSnapshot" <> ''::text) AND ("normalizedNameSnapshot" = btrim("normalizedNameSnapshot")))),
    CONSTRAINT "QuestionVersionTag_snapshot_nonblank_check" CHECK ((btrim("labelSnapshot") <> ''::text))
);

-- TABLE: RateLimit
CREATE TABLE "RateLimit" (
    id uuid NOT NULL,
    key text NOT NULL,
    count integer NOT NULL,
    "lastRequest" bigint NOT NULL,
    CONSTRAINT "RateLimit_non_negative_check" CHECK (((count >= 0) AND ("lastRequest" >= 0)))
);

-- TABLE: ReviewEvent
CREATE TABLE "ReviewEvent" (
    id uuid NOT NULL,
    "wrongNoteId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    "questionId" uuid NOT NULL,
    "questionVersionId" uuid NOT NULL,
    source "ReviewEventSource" NOT NULL,
    "studySessionId" uuid,
    "studyAnswerId" uuid,
    "selectedOptionId" uuid,
    "isCorrect" boolean,
    "previousStatus" "WrongNoteStatus",
    "nextStatus" "WrongNoteStatus" NOT NULL,
    "previousCorrectStreak" integer,
    "nextCorrectStreak" integer NOT NULL,
    "previousWrongCount" integer,
    "wrongCountAfter" integer NOT NULL,
    "algorithmVersion" integer NOT NULL,
    "occurredAt" timestamp(3) with time zone NOT NULL,
    CONSTRAINT "ReviewEvent_algorithm_check" CHECK (("algorithmVersion" = 1)),
    CONSTRAINT "ReviewEvent_correct_selection_check" CHECK (((NOT COALESCE("isCorrect", false)) OR ("selectedOptionId" IS NOT NULL))),
    CONSTRAINT "ReviewEvent_evidence_shape_check" CHECK ((((source = ANY (ARRAY['STUDY_SUBMIT'::"ReviewEventSource", 'WRONG_NOTE_REVIEW'::"ReviewEventSource"])) AND ("studySessionId" IS NOT NULL) AND ("studyAnswerId" IS NOT NULL) AND ("isCorrect" IS NOT NULL)) OR ((source = 'VERSION_REBASE'::"ReviewEventSource") AND ("studySessionId" IS NULL) AND ("studyAnswerId" IS NULL) AND ("selectedOptionId" IS NULL) AND ("isCorrect" IS NULL)))),
    CONSTRAINT "ReviewEvent_previous_snapshot_check" CHECK (((("previousStatus" IS NULL) AND ("previousCorrectStreak" IS NULL) AND ("previousWrongCount" IS NULL)) OR (("previousStatus" IS NOT NULL) AND ("previousCorrectStreak" IS NOT NULL) AND ("previousWrongCount" IS NOT NULL) AND ("previousCorrectStreak" >= 0) AND ("previousWrongCount" >= 1)))),
    CONSTRAINT "ReviewEvent_previous_state_check" CHECK ((("previousStatus" IS NULL) OR (("previousStatus" = 'NEW'::"WrongNoteStatus") AND ("previousCorrectStreak" = 0) AND ("previousWrongCount" = 1)) OR (("previousStatus" = 'AGAIN'::"WrongNoteStatus") AND ("previousCorrectStreak" = 0) AND ("previousWrongCount" >= 2)) OR (("previousStatus" = 'REVIEWING'::"WrongNoteStatus") AND ("previousCorrectStreak" = 1)) OR (("previousStatus" = 'SOLVED'::"WrongNoteStatus") AND ("previousCorrectStreak" >= 2)))),
    CONSTRAINT "ReviewEvent_transition_check" CHECK ((((source = 'VERSION_REBASE'::"ReviewEventSource") AND ("previousStatus" IS NOT NULL) AND ("nextStatus" = "previousStatus") AND ("nextCorrectStreak" = "previousCorrectStreak") AND ("wrongCountAfter" = "previousWrongCount")) OR ((source <> 'VERSION_REBASE'::"ReviewEventSource") AND ("previousStatus" IS NULL) AND (NOT "isCorrect") AND ("nextStatus" = 'NEW'::"WrongNoteStatus") AND ("nextCorrectStreak" = 0) AND ("wrongCountAfter" = 1)) OR ((source <> 'VERSION_REBASE'::"ReviewEventSource") AND ("previousStatus" IS NOT NULL) AND (NOT "isCorrect") AND ("nextStatus" = 'AGAIN'::"WrongNoteStatus") AND ("nextCorrectStreak" = 0) AND ("wrongCountAfter" = ("previousWrongCount" + 1))) OR ((source <> 'VERSION_REBASE'::"ReviewEventSource") AND ("previousStatus" IS NOT NULL) AND "isCorrect" AND ("nextCorrectStreak" = ("previousCorrectStreak" + 1)) AND ("wrongCountAfter" = "previousWrongCount") AND ((("nextCorrectStreak" = 1) AND ("nextStatus" = 'REVIEWING'::"WrongNoteStatus")) OR (("nextCorrectStreak" >= 2) AND ("nextStatus" = 'SOLVED'::"WrongNoteStatus"))))))
);

-- TABLE: ReviewSchedule
CREATE TABLE "ReviewSchedule" (
    id uuid NOT NULL,
    "wrongNoteId" uuid NOT NULL,
    "nextReviewAt" timestamp(3) with time zone NOT NULL,
    "intervalDays" integer NOT NULL,
    "algorithmVersion" integer NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL,
    CONSTRAINT "ReviewSchedule_algorithm_check" CHECK ((("algorithmVersion" = 1) AND ("intervalDays" = ANY (ARRAY[1, 3, 7, 14, 30]))))
);

-- TABLE: Session
CREATE TABLE "Session" (
    id uuid NOT NULL,
    "expiresAt" timestamp(3) with time zone NOT NULL,
    token text NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" uuid NOT NULL,
    "authorityGeneration" integer DEFAULT 1 NOT NULL,
    "issuerProtocolVersion" "AuthSessionIssuerProtocolVersion" DEFAULT 'LEGACY'::"AuthSessionIssuerProtocolVersion" NOT NULL,
    "authorizationState" "AuthSessionAuthorizationState" DEFAULT 'ACTIVE'::"AuthSessionAuthorizationState" NOT NULL,
    CONSTRAINT "Session_absolute_lifetime_check" CHECK ((("expiresAt" > "createdAt") AND ("expiresAt" <= ("createdAt" + '30 days'::interval)))),
    CONSTRAINT "Session_positive_authority_generation_check" CHECK (("authorityGeneration" > 0)),
    CONSTRAINT "Session_valid_expiry" CHECK (("expiresAt" > "createdAt"))
);

-- TABLE: SsoAccountErasureRequest
CREATE TABLE "SsoAccountErasureRequest" (
    id uuid DEFAULT public.gen_random_uuid() NOT NULL,
    "userId" uuid,
    "receiptDigest" character varying(64) NOT NULL,
    "appStatus" character varying(32) DEFAULT 'DELETION_PENDING'::character varying NOT NULL,
    "providerCleanup" jsonb NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    "receiptExpiresAt" timestamp(3) with time zone NOT NULL,
    "completedAt" timestamp(3) with time zone,
    "leaseExpiresAt" timestamp(3) with time zone,
    "leaseToken" uuid,
    "activeProvider" text,
    CONSTRAINT "SsoAccountErasureRequest_activeProvider_check" CHECK (("activeProvider" = ANY (ARRAY['apple'::text, 'google'::text]))),
    CONSTRAINT "SsoAccountErasureRequest_appStatus_check" CHECK ((("appStatus")::text = ANY ((ARRAY['DELETION_PENDING'::character varying, 'DELETED'::character varying])::text[]))),
    CONSTRAINT "SsoAccountErasureRequest_check" CHECK (((("appStatus")::text = 'DELETED'::text) = ("completedAt" IS NOT NULL))),
    CONSTRAINT "SsoAccountErasureRequest_providerCleanup_check" CHECK ((jsonb_typeof("providerCleanup") = 'array'::text)),
    CONSTRAINT "SsoAccountErasureRequest_receiptDigest_check" CHECK ((("receiptDigest")::text ~ '^[0-9a-f]{64}$'::text))
);

-- TABLE: SsoAccountFreshProof
CREATE TABLE "SsoAccountFreshProof" (
    "proofDigest" character varying(64) NOT NULL,
    context jsonb NOT NULL,
    "userId" uuid NOT NULL,
    "callbackURL" character varying(2048) NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    "expiresAt" timestamp(3) with time zone NOT NULL,
    "verifiedAt" timestamp(3) with time zone,
    CONSTRAINT "SsoAccountFreshProof_check" CHECK (("userId" = ((context ->> 'userId'::text))::uuid)),
    CONSTRAINT "SsoAccountFreshProof_check1" CHECK ((("expiresAt" > "createdAt") AND ("expiresAt" <= ("createdAt" + '00:07:00'::interval)))),
    CONSTRAINT "SsoAccountFreshProof_context_check" CHECK ((jsonb_typeof(context) = 'object'::text)),
    CONSTRAINT "SsoAccountFreshProof_proofDigest_check" CHECK ((("proofDigest")::text ~ '^[0-9a-f]{64}$'::text))
);

-- TABLE: SsoAccountFreshTransaction
CREATE TABLE "SsoAccountFreshTransaction" (
    "stateDigest" character varying(64) NOT NULL,
    "bindingDigest" character varying(64) NOT NULL,
    provider character varying(32) NOT NULL,
    nonce character varying(43) NOT NULL,
    "codeVerifier" character varying(86) NOT NULL,
    "callbackURL" character varying(2048) NOT NULL,
    context jsonb NOT NULL,
    "userId" uuid NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    "expiresAt" timestamp(3) with time zone NOT NULL,
    CONSTRAINT "SsoAccountFreshTransaction_bindingDigest_check" CHECK ((("bindingDigest")::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT "SsoAccountFreshTransaction_check" CHECK (("userId" = ((context ->> 'userId'::text))::uuid)),
    CONSTRAINT "SsoAccountFreshTransaction_check1" CHECK ((("expiresAt" > "createdAt") AND ("expiresAt" <= ("createdAt" + '00:02:00'::interval)))),
    CONSTRAINT "SsoAccountFreshTransaction_codeVerifier_check" CHECK ((("codeVerifier")::text ~ '^[A-Za-z0-9_-]{86}$'::text)),
    CONSTRAINT "SsoAccountFreshTransaction_context_check" CHECK ((jsonb_typeof(context) = 'object'::text)),
    CONSTRAINT "SsoAccountFreshTransaction_nonce_check" CHECK (((nonce)::text ~ '^[A-Za-z0-9_-]{43}$'::text)),
    CONSTRAINT "SsoAccountFreshTransaction_provider_check" CHECK (((provider)::text = ANY ((ARRAY['apple'::character varying, 'google'::character varying])::text[]))),
    CONSTRAINT "SsoAccountFreshTransaction_stateDigest_check" CHECK ((("stateDigest")::text ~ '^[0-9a-f]{64}$'::text))
);

-- TABLE: SsoAdminFreshProof
CREATE TABLE "SsoAdminFreshProof" (
    "proofDigest" character varying(64) NOT NULL,
    context jsonb NOT NULL,
    "callbackURL" character varying(2048) NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    "expiresAt" timestamp(3) with time zone NOT NULL,
    "completedSessionId" uuid,
    "completedAt" timestamp(3) with time zone,
    "userId" uuid NOT NULL,
    CONSTRAINT "SsoAdminFreshProof_check" CHECK ((("completedSessionId" IS NULL) = ("completedAt" IS NULL))),
    CONSTRAINT "SsoAdminFreshProof_check1" CHECK ((("expiresAt" > "createdAt") AND ("expiresAt" <= ("createdAt" + '00:07:00'::interval)))),
    CONSTRAINT "SsoAdminFreshProof_context_check" CHECK ((jsonb_typeof(context) = 'object'::text)),
    CONSTRAINT "SsoAdminFreshProof_proofDigest_check" CHECK ((("proofDigest")::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT "SsoAdminFreshProof_user_context_check" CHECK ((NOT ("userId" IS DISTINCT FROM ((context ->> 'userId'::text))::uuid)))
);

-- TABLE: SsoAdminFreshTransaction
CREATE TABLE "SsoAdminFreshTransaction" (
    "stateDigest" character varying(64) NOT NULL,
    "bindingDigest" character varying(64) NOT NULL,
    provider character varying(32) NOT NULL,
    nonce character varying(43) NOT NULL,
    "codeVerifier" character varying(86) NOT NULL,
    "callbackURL" character varying(2048) NOT NULL,
    context jsonb NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    "expiresAt" timestamp(3) with time zone NOT NULL,
    "userId" uuid NOT NULL,
    CONSTRAINT "SsoAdminFreshTransaction_bindingDigest_check" CHECK ((("bindingDigest")::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT "SsoAdminFreshTransaction_check" CHECK ((("expiresAt" > "createdAt") AND ("expiresAt" <= ("createdAt" + '00:02:00'::interval)))),
    CONSTRAINT "SsoAdminFreshTransaction_codeVerifier_check" CHECK ((("codeVerifier")::text ~ '^[A-Za-z0-9_-]{86}$'::text)),
    CONSTRAINT "SsoAdminFreshTransaction_context_check" CHECK ((jsonb_typeof(context) = 'object'::text)),
    CONSTRAINT "SsoAdminFreshTransaction_nonce_check" CHECK (((nonce)::text ~ '^[A-Za-z0-9_-]{43}$'::text)),
    CONSTRAINT "SsoAdminFreshTransaction_provider_check" CHECK (((provider)::text = ANY ((ARRAY['apple'::character varying, 'google'::character varying])::text[]))),
    CONSTRAINT "SsoAdminFreshTransaction_stateDigest_check" CHECK ((("stateDigest")::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT "SsoAdminFreshTransaction_user_context_check" CHECK ((NOT ("userId" IS DISTINCT FROM ((context ->> 'userId'::text))::uuid)))
);

-- TABLE: SsoLoginTransaction
CREATE TABLE "SsoLoginTransaction" (
    "stateDigest" character varying(64) NOT NULL,
    "bindingDigest" character varying(64) NOT NULL,
    provider character varying(32) DEFAULT 'google'::character varying NOT NULL,
    nonce character varying(43) NOT NULL,
    "codeVerifier" character varying(86) NOT NULL,
    "callbackURL" character varying(2048) NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    "expiresAt" timestamp(3) with time zone NOT NULL,
    CONSTRAINT "SsoLoginTransaction_bindingDigest_check" CHECK ((("bindingDigest")::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT "SsoLoginTransaction_callbackURL_check" CHECK ((("left"(("callbackURL")::text, 1) = '/'::text) AND ("left"(("callbackURL")::text, 2) <> '//'::text))),
    CONSTRAINT "SsoLoginTransaction_codeVerifier_check" CHECK ((("codeVerifier")::text ~ '^[A-Za-z0-9_-]{86}$'::text)),
    CONSTRAINT "SsoLoginTransaction_nonce_check" CHECK (((nonce)::text ~ '^[A-Za-z0-9_-]{43}$'::text)),
    CONSTRAINT "SsoLoginTransaction_provider_check" CHECK (((provider)::text = ANY ((ARRAY['apple'::character varying, 'google'::character varying])::text[]))),
    CONSTRAINT "SsoLoginTransaction_stateDigest_check" CHECK ((("stateDigest")::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT "SsoLoginTransaction_ttl" CHECK ((("expiresAt" > "createdAt") AND ("expiresAt" <= ("createdAt" + '00:10:00'::interval))))
);

-- TABLE: StudyAnswer
CREATE TABLE "StudyAnswer" (
    id uuid NOT NULL,
    "studySessionQuestionId" uuid NOT NULL,
    "questionVersionId" uuid NOT NULL,
    "selectedOptionId" uuid,
    "isCorrect" boolean NOT NULL,
    "elapsedSec" integer NOT NULL,
    "gradingVersion" character varying(64) NOT NULL,
    "answeredAt" timestamp(3) with time zone NOT NULL,
    "gradedAt" timestamp(3) with time zone NOT NULL,
    CONSTRAINT "StudyAnswer_elapsed_check" CHECK ((("elapsedSec" >= 0) AND ("elapsedSec" <= 86400))),
    CONSTRAINT "StudyAnswer_grading_version_check" CHECK ((("gradingVersion")::text = 'server-grading-v1'::text)),
    CONSTRAINT "StudyAnswer_time_check" CHECK (("gradedAt" >= "answeredAt"))
);

-- TABLE: StudyDraft
CREATE TABLE "StudyDraft" (
    "studySessionId" uuid NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    "currentOrdinal" integer DEFAULT 1 NOT NULL,
    "savedAt" timestamp(3) with time zone,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL,
    CONSTRAINT "StudyDraft_current_ordinal_check" CHECK ((("currentOrdinal" >= 1) AND ("currentOrdinal" <= 20))),
    CONSTRAINT "StudyDraft_revision_check" CHECK ((revision >= 0)),
    CONSTRAINT "StudyDraft_saved_revision_check" CHECK ((((revision = 0) AND ("savedAt" IS NULL)) OR ((revision > 0) AND ("savedAt" IS NOT NULL)))),
    CONSTRAINT "StudyDraft_timestamp_check" CHECK ((("updatedAt" >= "createdAt") AND (("savedAt" IS NULL) OR ("updatedAt" = "savedAt"))))
);

-- TABLE: StudyDraftAnswer
CREATE TABLE "StudyDraftAnswer" (
    "studySessionId" uuid NOT NULL,
    "studySessionQuestionId" uuid NOT NULL,
    "questionVersionId" uuid NOT NULL,
    "selectedOptionId" uuid,
    "elapsedSec" integer DEFAULT 0 NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL,
    CONSTRAINT "StudyDraftAnswer_elapsed_check" CHECK ((("elapsedSec" >= 0) AND ("elapsedSec" <= 86400)))
);

-- TABLE: StudyResult
CREATE TABLE "StudyResult" (
    id uuid NOT NULL,
    "studySessionId" uuid NOT NULL,
    "totalCount" integer NOT NULL,
    "correctCount" integer NOT NULL,
    "incorrectCount" integer NOT NULL,
    "correctRateBasisPoints" integer NOT NULL,
    "durationSec" integer NOT NULL,
    "gradingVersion" character varying(64) NOT NULL,
    "createdAt" timestamp(3) with time zone NOT NULL,
    CONSTRAINT "StudyResult_count_check" CHECK (((("totalCount" >= 1) AND ("totalCount" <= 20)) AND (("correctCount" >= 0) AND ("correctCount" <= "totalCount")) AND (("incorrectCount" >= 0) AND ("incorrectCount" <= "totalCount")) AND (("correctCount" + "incorrectCount") = "totalCount"))),
    CONSTRAINT "StudyResult_duration_check" CHECK ((("durationSec" >= 0) AND ("durationSec" <= 604800))),
    CONSTRAINT "StudyResult_grading_version_check" CHECK ((("gradingVersion")::text = 'server-grading-v1'::text)),
    CONSTRAINT "StudyResult_rate_check" CHECK (((("correctRateBasisPoints" >= 0) AND ("correctRateBasisPoints" <= 10000)) AND ("correctRateBasisPoints" = (round(((("correctCount")::numeric * 10000.0) / ("totalCount")::numeric)))::integer)))
);

-- TABLE: StudySession
CREATE TABLE "StudySession" (
    id uuid NOT NULL,
    "userId" uuid,
    "guestPrincipalId" uuid,
    level "JlptLevel" NOT NULL,
    subject "QuestionSubject" NOT NULL,
    mode "StudyMode" NOT NULL,
    status "StudySessionStatus" DEFAULT 'IN_PROGRESS'::"StudySessionStatus" NOT NULL,
    "requestedCount" integer NOT NULL,
    "actualCount" integer NOT NULL,
    "usedFallback" boolean DEFAULT false NOT NULL,
    "fallbackReason" "StudySessionFallbackReason",
    "startedAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) with time zone NOT NULL,
    "submittedAt" timestamp(3) with time zone,
    "cancelledAt" timestamp(3) with time zone,
    "durationSec" integer,
    "submissionHash" character varying(64),
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL,
    "practiceContractVersion" integer DEFAULT 2 NOT NULL,
    "retryOfStudySessionId" uuid,
    CONSTRAINT "StudySession_count_check" CHECK (((("requestedCount" >= 1) AND ("requestedCount" <= 20)) AND (("actualCount" >= 1) AND ("actualCount" <= "requestedCount")))),
    CONSTRAINT "StudySession_duration_check" CHECK ((("durationSec" IS NULL) OR ("durationSec" >= 0))),
    CONSTRAINT "StudySession_expiry_check" CHECK (("expiresAt" > "startedAt")),
    CONSTRAINT "StudySession_fallback_check" CHECK (("usedFallback" = ("fallbackReason" IS NOT NULL))),
    CONSTRAINT "StudySession_fallback_reason_contract_check" CHECK ((("fallbackReason" IS NULL) OR ("fallbackReason" = 'INSUFFICIENT_MODE_CANDIDATES'::"StudySessionFallbackReason"))),
    CONSTRAINT "StudySession_owner_xor_check" CHECK ((("userId" IS NULL) <> ("guestPrincipalId" IS NULL))),
    CONSTRAINT "StudySession_practice_contract_version_check" CHECK (("practiceContractVersion" = ANY (ARRAY[1, 2]))),
    CONSTRAINT "StudySession_random_no_fallback_check" CHECK (((mode <> 'RANDOM'::"StudyMode") OR ((NOT "usedFallback") AND ("fallbackReason" IS NULL)))),
    CONSTRAINT "StudySession_retry_shape_check" CHECK ((("retryOfStudySessionId" IS NULL) OR (("retryOfStudySessionId" <> id) AND ("practiceContractVersion" = 2) AND (NOT "usedFallback") AND ("fallbackReason" IS NULL) AND ((("userId" IS NOT NULL) AND ("guestPrincipalId" IS NULL) AND (mode = 'WRONG_NOTE'::"StudyMode")) OR (("userId" IS NULL) AND ("guestPrincipalId" IS NOT NULL) AND (mode = 'RANDOM'::"StudyMode")))))),
    CONSTRAINT "StudySession_state_check" CHECK ((((status = 'IN_PROGRESS'::"StudySessionStatus") AND ("submittedAt" IS NULL) AND ("cancelledAt" IS NULL) AND ("durationSec" IS NULL) AND ("submissionHash" IS NULL)) OR ((status = 'SUBMITTED'::"StudySessionStatus") AND ("submittedAt" IS NOT NULL) AND ("cancelledAt" IS NULL) AND ("durationSec" IS NOT NULL) AND ("submissionHash" IS NOT NULL)) OR ((status = 'EXPIRED'::"StudySessionStatus") AND ("submittedAt" IS NULL) AND ("cancelledAt" IS NULL) AND ("durationSec" IS NULL) AND ("submissionHash" IS NULL)) OR ((status = 'CANCELLED'::"StudySessionStatus") AND ("submittedAt" IS NULL) AND ("cancelledAt" IS NOT NULL) AND ("durationSec" IS NULL) AND ("submissionHash" IS NULL)))),
    CONSTRAINT "StudySession_state_timestamp_order_check" CHECK (((("submittedAt" IS NULL) OR ("submittedAt" >= "startedAt")) AND (("cancelledAt" IS NULL) OR ("cancelledAt" >= "startedAt")))),
    CONSTRAINT "StudySession_submission_hash_check" CHECK ((("submissionHash" IS NULL) OR (("submissionHash")::text ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT "StudySession_v2_no_fallback_check" CHECK ((("practiceContractVersion" = 1) OR ((NOT "usedFallback") AND ("fallbackReason" IS NULL))))
);

-- TABLE: StudySessionQuestion
CREATE TABLE "StudySessionQuestion" (
    id uuid NOT NULL,
    "studySessionId" uuid NOT NULL,
    "questionId" uuid NOT NULL,
    "questionVersionId" uuid NOT NULL,
    ordinal integer NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "StudySessionQuestion_ordinal_check" CHECK ((ordinal > 0))
);

-- TABLE: Tag
CREATE TABLE "Tag" (
    id uuid NOT NULL,
    label text NOT NULL,
    "normalizedName" text NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL,
    CONSTRAINT "Tag_nonblank_check" CHECK (((btrim(label) <> ''::text) AND (btrim("normalizedName") <> ''::text)))
);

-- TABLE: TagApplicability
CREATE TABLE "TagApplicability" (
    "tagId" uuid NOT NULL,
    level "JlptLevel" NOT NULL,
    subject "QuestionSubject" NOT NULL,
    "questionType" "QuestionType" NOT NULL
);

-- TABLE: User
CREATE TABLE "User" (
    id uuid NOT NULL,
    name character varying(80) NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean DEFAULT false NOT NULL,
    image text,
    role "UserRole" DEFAULT 'USER'::"UserRole" NOT NULL,
    "targetLevel" "JlptLevel",
    "accountStatus" "UserAccountStatus" DEFAULT 'ACTIVE'::"UserAccountStatus" NOT NULL,
    "deletedAt" timestamp(3) with time zone,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL,
    "authorityGeneration" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "User_email_normalized_check" CHECK (((email = lower(email)) AND (email = btrim(email)))),
    CONSTRAINT "User_name_contract_check" CHECK ((((name)::text = btrim((name)::text)) AND ((char_length((name)::text) >= 1) AND (char_length((name)::text) <= 80)))),
    CONSTRAINT "User_positive_authority_generation_check" CHECK (("authorityGeneration" > 0))
);

-- TABLE: UserAccountRestriction
CREATE TABLE "UserAccountRestriction" (
    "userId" uuid NOT NULL,
    reason text NOT NULL,
    "restrictedAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "UserAccountRestriction_reason_check" CHECK (((char_length(reason) >= 1) AND (char_length(reason) <= 500)))
);

-- TABLE: UserAccountRestrictionEvent
CREATE TABLE "UserAccountRestrictionEvent" (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "userId" uuid NOT NULL,
    action text NOT NULL,
    "actorUserId" uuid,
    reason text,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "UserAccountRestrictionEvent_action_shape_check" CHECK ((((action = 'RESTRICT'::text) AND ((char_length(reason) >= 1) AND (char_length(reason) <= 500))) OR ((action = 'RELEASE'::text) AND (reason IS NULL))))
);

-- TABLE: UserMemo
CREATE TABLE "UserMemo" (
    id uuid NOT NULL,
    "wrongNoteId" uuid NOT NULL,
    text text NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL,
    CONSTRAINT "UserMemo_text_normalized_check" CHECK (((text = normalize_user_memo_text(text)) AND ((char_length(text) >= 1) AND (char_length(text) <= 2000)))),
    CONSTRAINT "UserMemo_timestamp_order_check" CHECK (("updatedAt" >= "createdAt"))
);

-- TABLE: UserReport
CREATE TABLE "UserReport" (
    id uuid DEFAULT public.gen_random_uuid() NOT NULL,
    kind character varying(16) NOT NULL,
    status character varying(16) DEFAULT 'RECEIVED'::character varying NOT NULL,
    location character varying(200) NOT NULL,
    "questionId" uuid,
    "questionVersionId" uuid,
    description text NOT NULL,
    "reporterUserId" uuid,
    "reporterReply" text,
    "repliedAt" timestamp(3) with time zone,
    "internalNote" text,
    "closedAt" timestamp(3) with time zone,
    "rowVersion" integer DEFAULT 1 NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    "updatedAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "UserReport_description_check" CHECK (((char_length(description) >= 1) AND (char_length(description) <= 1000))),
    CONSTRAINT "UserReport_internalNote_check" CHECK (((char_length("internalNote") >= 1) AND (char_length("internalNote") <= 1000))),
    CONSTRAINT "UserReport_kind_check" CHECK (((kind)::text = ANY ((ARRAY['QUESTION'::character varying, 'APP_ERROR'::character varying])::text[]))),
    CONSTRAINT "UserReport_kind_target_check" CHECK (((((kind)::text = 'QUESTION'::text) = ("questionId" IS NOT NULL)) AND (("questionId" IS NULL) = ("questionVersionId" IS NULL)))),
    CONSTRAINT "UserReport_location_check" CHECK (((char_length((location)::text) >= 1) AND (char_length((location)::text) <= 200))),
    CONSTRAINT "UserReport_reporterReply_check" CHECK (((char_length("reporterReply") >= 1) AND (char_length("reporterReply") <= 1000))),
    CONSTRAINT "UserReport_rowVersion_check" CHECK (("rowVersion" >= 1)),
    CONSTRAINT "UserReport_status_check" CHECK (((status)::text = ANY ((ARRAY['RECEIVED'::character varying, 'ANSWERED'::character varying, 'CLOSED'::character varying])::text[]))),
    CONSTRAINT "UserReport_status_fields_check" CHECK (((((status)::text = 'RECEIVED'::text) AND ("reporterReply" IS NULL) AND ("repliedAt" IS NULL) AND ("closedAt" IS NULL)) OR (((status)::text = 'ANSWERED'::text) AND ("reporterReply" IS NOT NULL) AND ("repliedAt" IS NOT NULL) AND ("closedAt" = "repliedAt")) OR (((status)::text = 'CLOSED'::text) AND ("reporterReply" IS NULL) AND ("repliedAt" IS NULL) AND ("closedAt" IS NOT NULL))))
);

-- TABLE: Verification
CREATE TABLE "Verification" (
    id uuid NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp(3) with time zone NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL,
    purpose "AuthVerificationPurpose",
    "resetUserId" uuid,
    "capturedGeneration" integer,
    "tokenSelector" character varying(64),
    CONSTRAINT "Verification_reset_arm_check" CHECK (((((purpose IS NULL) AND ("resetUserId" IS NULL) AND ("capturedGeneration" IS NULL) AND ("tokenSelector" IS NULL)) OR ((purpose IS NOT NULL) AND (purpose = 'PASSWORD_RESET_V1'::"AuthVerificationPurpose") AND ("resetUserId" IS NOT NULL) AND ("capturedGeneration" IS NOT NULL) AND ("capturedGeneration" > 0) AND ("tokenSelector" IS NOT NULL) AND (("tokenSelector")::text ~ '^[0-9a-f]{64}$'::text) AND (identifier = 'PASSWORD_RESET_V1'::text) AND (value = 'PASSWORD_RESET_V1'::text))) IS TRUE))
);

-- TABLE: WrongNote
CREATE TABLE "WrongNote" (
    id uuid NOT NULL,
    "userId" uuid NOT NULL,
    "questionId" uuid NOT NULL,
    "lastWrongQuestionVersionId" uuid NOT NULL,
    "currentReviewQuestionVersionId" uuid,
    "wrongCount" integer NOT NULL,
    "correctStreak" integer NOT NULL,
    status "WrongNoteStatus" NOT NULL,
    "lastWrongAt" timestamp(3) with time zone NOT NULL,
    "lastReviewedAt" timestamp(3) with time zone,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL,
    CONSTRAINT "WrongNote_created_updated_check" CHECK (("createdAt" <= "updatedAt")),
    CONSTRAINT "WrongNote_state_check" CHECK ((((status = 'NEW'::"WrongNoteStatus") AND ("wrongCount" = 1) AND ("correctStreak" = 0) AND ("lastReviewedAt" IS NULL)) OR ((status = 'AGAIN'::"WrongNoteStatus") AND ("wrongCount" >= 2) AND ("correctStreak" = 0) AND ("lastReviewedAt" IS NOT NULL)) OR ((status = 'REVIEWING'::"WrongNoteStatus") AND ("wrongCount" >= 1) AND ("correctStreak" = 1) AND ("lastReviewedAt" IS NOT NULL)) OR ((status = 'SOLVED'::"WrongNoteStatus") AND ("wrongCount" >= 1) AND ("correctStreak" >= 2) AND ("lastReviewedAt" IS NOT NULL)))),
    CONSTRAINT "WrongNote_time_check" CHECK ((("lastReviewedAt" IS NULL) OR ("lastReviewedAt" >= "lastWrongAt")))
);

-- CONSTRAINT: Account Account_pkey
ALTER TABLE ONLY "Account"
    ADD CONSTRAINT "Account_pkey" PRIMARY KEY (id);

-- CONSTRAINT: AdminAuditLog AdminAuditLog_pkey
ALTER TABLE ONLY "AdminAuditLog"
    ADD CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY (id);

-- CONSTRAINT: Bookmark Bookmark_pkey
ALTER TABLE ONLY "Bookmark"
    ADD CONSTRAINT "Bookmark_pkey" PRIMARY KEY (id);

-- CONSTRAINT: Bookmark Bookmark_userId_questionId_key
ALTER TABLE ONLY "Bookmark"
    ADD CONSTRAINT "Bookmark_userId_questionId_key" UNIQUE ("userId", "questionId");

-- CONSTRAINT: ContentReview ContentReview_pkey
ALTER TABLE ONLY "ContentReview"
    ADD CONSTRAINT "ContentReview_pkey" PRIMARY KEY (id);

-- CONSTRAINT: GuestPrincipal GuestPrincipal_pkey
ALTER TABLE ONLY "GuestPrincipal"
    ADD CONSTRAINT "GuestPrincipal_pkey" PRIMARY KEY (id);

-- CONSTRAINT: IdempotencyRecord IdempotencyRecord_pkey
ALTER TABLE ONLY "IdempotencyRecord"
    ADD CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY (id);

-- CONSTRAINT: AuthorityRevocationEvidence AuthorityRevocationEvidence_pkey
ALTER TABLE ONLY "AuthorityRevocationEvidence"
    ADD CONSTRAINT "AuthorityRevocationEvidence_pkey" PRIMARY KEY ("tokenDigest");

-- CONSTRAINT: DatabaseCapability DatabaseCapability_pkey
ALTER TABLE ONLY "DatabaseCapability"
    ADD CONSTRAINT "DatabaseCapability_pkey" PRIMARY KEY (id);

-- CONSTRAINT: OperationIntent OperationIntent_backend_transaction_key
ALTER TABLE ONLY "OperationIntent"
    ADD CONSTRAINT "OperationIntent_backend_transaction_key" UNIQUE ("backendPid", "transactionId");

-- CONSTRAINT: OperationIntent OperationIntent_pkey
ALTER TABLE ONLY "OperationIntent"
    ADD CONSTRAINT "OperationIntent_pkey" PRIMARY KEY ("operationId");

-- CONSTRAINT: ReauthenticationIntent ReauthenticationIntent_operationId_key
ALTER TABLE ONLY "ReauthenticationIntent"
    ADD CONSTRAINT "ReauthenticationIntent_operationId_key" UNIQUE ("operationId");

-- CONSTRAINT: ReauthenticationIntent ReauthenticationIntent_pkey
ALTER TABLE ONLY "ReauthenticationIntent"
    ADD CONSTRAINT "ReauthenticationIntent_pkey" PRIMARY KEY (id);

-- CONSTRAINT: ReauthenticationIntent ReauthenticationIntent_stagedSessionId_key
ALTER TABLE ONLY "ReauthenticationIntent"
    ADD CONSTRAINT "ReauthenticationIntent_stagedSessionId_key" UNIQUE ("stagedSessionId");

-- CONSTRAINT: ReauthenticationIntent ReauthenticationIntent_stagedTokenDigest_key
ALTER TABLE ONLY "ReauthenticationIntent"
    ADD CONSTRAINT "ReauthenticationIntent_stagedTokenDigest_key" UNIQUE ("stagedTokenDigest");

-- CONSTRAINT: QuestionImportResult QuestionImportResult_pkey
ALTER TABLE ONLY "QuestionImportResult"
    ADD CONSTRAINT "QuestionImportResult_pkey" PRIMARY KEY ("importId");

-- CONSTRAINT: QuestionOption QuestionOption_pkey
ALTER TABLE ONLY "QuestionOption"
    ADD CONSTRAINT "QuestionOption_pkey" PRIMARY KEY (id);

-- CONSTRAINT: QuestionOption QuestionOption_questionVersionId_label_key
ALTER TABLE ONLY "QuestionOption"
    ADD CONSTRAINT "QuestionOption_questionVersionId_label_key" UNIQUE ("questionVersionId", label) DEFERRABLE;

-- CONSTRAINT: QuestionOption QuestionOption_questionVersionId_ordinal_key
ALTER TABLE ONLY "QuestionOption"
    ADD CONSTRAINT "QuestionOption_questionVersionId_ordinal_key" UNIQUE ("questionVersionId", ordinal) DEFERRABLE;

-- CONSTRAINT: QuestionReport QuestionReport_pkey
ALTER TABLE ONLY "QuestionReport"
    ADD CONSTRAINT "QuestionReport_pkey" PRIMARY KEY (id);

-- CONSTRAINT: QuestionVersionTag QuestionVersionTag_pkey
ALTER TABLE ONLY "QuestionVersionTag"
    ADD CONSTRAINT "QuestionVersionTag_pkey" PRIMARY KEY (id);

-- CONSTRAINT: QuestionVersionTag QuestionVersionTag_questionVersionId_normalizedNameSnapshot_key
ALTER TABLE ONLY "QuestionVersionTag"
    ADD CONSTRAINT "QuestionVersionTag_questionVersionId_normalizedNameSnapshot_key" UNIQUE ("questionVersionId", "normalizedNameSnapshot") DEFERRABLE;

-- CONSTRAINT: QuestionVersion QuestionVersion_pkey
ALTER TABLE ONLY "QuestionVersion"
    ADD CONSTRAINT "QuestionVersion_pkey" PRIMARY KEY (id);

-- CONSTRAINT: Question Question_pkey
ALTER TABLE ONLY "Question"
    ADD CONSTRAINT "Question_pkey" PRIMARY KEY (id);

-- CONSTRAINT: RateLimit RateLimit_pkey
ALTER TABLE ONLY "RateLimit"
    ADD CONSTRAINT "RateLimit_pkey" PRIMARY KEY (id);

-- CONSTRAINT: ReviewEvent ReviewEvent_pkey
ALTER TABLE ONLY "ReviewEvent"
    ADD CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY (id);

-- CONSTRAINT: ReviewSchedule ReviewSchedule_pkey
ALTER TABLE ONLY "ReviewSchedule"
    ADD CONSTRAINT "ReviewSchedule_pkey" PRIMARY KEY (id);

-- CONSTRAINT: Session Session_pkey
ALTER TABLE ONLY "Session"
    ADD CONSTRAINT "Session_pkey" PRIMARY KEY (id);

-- CONSTRAINT: SsoAccountErasureRequest SsoAccountErasureRequest_pkey
ALTER TABLE ONLY "SsoAccountErasureRequest"
    ADD CONSTRAINT "SsoAccountErasureRequest_pkey" PRIMARY KEY (id);

-- CONSTRAINT: SsoAccountErasureRequest SsoAccountErasureRequest_receiptDigest_key
ALTER TABLE ONLY "SsoAccountErasureRequest"
    ADD CONSTRAINT "SsoAccountErasureRequest_receiptDigest_key" UNIQUE ("receiptDigest");

-- CONSTRAINT: SsoAccountErasureRequest SsoAccountErasureRequest_userId_key
ALTER TABLE ONLY "SsoAccountErasureRequest"
    ADD CONSTRAINT "SsoAccountErasureRequest_userId_key" UNIQUE ("userId");

-- CONSTRAINT: SsoAccountFreshProof SsoAccountFreshProof_pkey
ALTER TABLE ONLY "SsoAccountFreshProof"
    ADD CONSTRAINT "SsoAccountFreshProof_pkey" PRIMARY KEY ("proofDigest");

-- CONSTRAINT: SsoAccountFreshTransaction SsoAccountFreshTransaction_pkey
ALTER TABLE ONLY "SsoAccountFreshTransaction"
    ADD CONSTRAINT "SsoAccountFreshTransaction_pkey" PRIMARY KEY ("stateDigest");

-- CONSTRAINT: SsoAdminFreshProof SsoAdminFreshProof_pkey
ALTER TABLE ONLY "SsoAdminFreshProof"
    ADD CONSTRAINT "SsoAdminFreshProof_pkey" PRIMARY KEY ("proofDigest");

-- CONSTRAINT: SsoAdminFreshTransaction SsoAdminFreshTransaction_pkey
ALTER TABLE ONLY "SsoAdminFreshTransaction"
    ADD CONSTRAINT "SsoAdminFreshTransaction_pkey" PRIMARY KEY ("stateDigest");

-- CONSTRAINT: SsoLoginTransaction SsoLoginTransaction_pkey
ALTER TABLE ONLY "SsoLoginTransaction"
    ADD CONSTRAINT "SsoLoginTransaction_pkey" PRIMARY KEY ("stateDigest");

-- CONSTRAINT: StudyAnswer StudyAnswer_pkey
ALTER TABLE ONLY "StudyAnswer"
    ADD CONSTRAINT "StudyAnswer_pkey" PRIMARY KEY (id);

-- CONSTRAINT: StudyDraftAnswer StudyDraftAnswer_pkey
ALTER TABLE ONLY "StudyDraftAnswer"
    ADD CONSTRAINT "StudyDraftAnswer_pkey" PRIMARY KEY ("studySessionId", "studySessionQuestionId");

-- CONSTRAINT: StudyDraft StudyDraft_pkey
ALTER TABLE ONLY "StudyDraft"
    ADD CONSTRAINT "StudyDraft_pkey" PRIMARY KEY ("studySessionId");

-- CONSTRAINT: StudyResult StudyResult_pkey
ALTER TABLE ONLY "StudyResult"
    ADD CONSTRAINT "StudyResult_pkey" PRIMARY KEY (id);

-- CONSTRAINT: StudySessionQuestion StudySessionQuestion_pkey
ALTER TABLE ONLY "StudySessionQuestion"
    ADD CONSTRAINT "StudySessionQuestion_pkey" PRIMARY KEY (id);

-- CONSTRAINT: StudySession StudySession_pkey
ALTER TABLE ONLY "StudySession"
    ADD CONSTRAINT "StudySession_pkey" PRIMARY KEY (id);

-- CONSTRAINT: TagApplicability TagApplicability_pkey
ALTER TABLE ONLY "TagApplicability"
    ADD CONSTRAINT "TagApplicability_pkey" PRIMARY KEY ("tagId", level, subject, "questionType");

-- CONSTRAINT: Tag Tag_pkey
ALTER TABLE ONLY "Tag"
    ADD CONSTRAINT "Tag_pkey" PRIMARY KEY (id);

-- CONSTRAINT: UserAccountRestrictionEvent UserAccountRestrictionEvent_pkey
ALTER TABLE ONLY "UserAccountRestrictionEvent"
    ADD CONSTRAINT "UserAccountRestrictionEvent_pkey" PRIMARY KEY (id);

-- CONSTRAINT: UserAccountRestriction UserAccountRestriction_pkey
ALTER TABLE ONLY "UserAccountRestriction"
    ADD CONSTRAINT "UserAccountRestriction_pkey" PRIMARY KEY ("userId");

-- CONSTRAINT: UserMemo UserMemo_pkey
ALTER TABLE ONLY "UserMemo"
    ADD CONSTRAINT "UserMemo_pkey" PRIMARY KEY (id);

-- CONSTRAINT: UserMemo UserMemo_wrongNoteId_key
ALTER TABLE ONLY "UserMemo"
    ADD CONSTRAINT "UserMemo_wrongNoteId_key" UNIQUE ("wrongNoteId");

-- CONSTRAINT: UserReport UserReport_pkey
ALTER TABLE ONLY "UserReport"
    ADD CONSTRAINT "UserReport_pkey" PRIMARY KEY (id);

-- CONSTRAINT: User User_pkey
ALTER TABLE ONLY "User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);

-- CONSTRAINT: Verification Verification_pkey
ALTER TABLE ONLY "Verification"
    ADD CONSTRAINT "Verification_pkey" PRIMARY KEY (id);

-- CONSTRAINT: Verification Verification_purpose_resetUserId_key
ALTER TABLE ONLY "Verification"
    ADD CONSTRAINT "Verification_purpose_resetUserId_key" UNIQUE (purpose, "resetUserId");

-- CONSTRAINT: Verification Verification_tokenSelector_key
ALTER TABLE ONLY "Verification"
    ADD CONSTRAINT "Verification_tokenSelector_key" UNIQUE ("tokenSelector");

-- CONSTRAINT: WrongNote WrongNote_pkey
ALTER TABLE ONLY "WrongNote"
    ADD CONSTRAINT "WrongNote_pkey" PRIMARY KEY (id);

-- INDEX: Account_one_credential_per_user_key
CREATE UNIQUE INDEX "Account_one_credential_per_user_key" ON "Account" USING btree ("userId") WHERE ("providerId" = 'credential'::text);

-- INDEX: Account_providerId_accountId_key
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account" USING btree ("providerId", "accountId");

-- INDEX: Account_userId_idx
CREATE INDEX "Account_userId_idx" ON "Account" USING btree ("userId");

-- INDEX: AdminAuditLog_occurredAt_id_idx
CREATE INDEX "AdminAuditLog_occurredAt_id_idx" ON "AdminAuditLog" USING btree ("occurredAt" DESC, id DESC);

-- INDEX: AdminAuditLog_operationId_idx
CREATE INDEX "AdminAuditLog_operationId_idx" ON "AdminAuditLog" USING btree ("operationId");

-- INDEX: AdminAuditLog_operation_entity_target_key
CREATE UNIQUE INDEX "AdminAuditLog_operation_entity_target_key" ON "AdminAuditLog" USING btree ("operationId", "targetType", "targetId") WHERE ("targetType" = ANY (ARRAY['QUESTION'::"AdminAuditTargetType", 'QUESTION_VERSION'::"AdminAuditTargetType", 'QUESTION_REPORT'::"AdminAuditTargetType"]));

-- INDEX: AdminAuditLog_request_target_operation_key
CREATE UNIQUE INDEX "AdminAuditLog_request_target_operation_key" ON "AdminAuditLog" USING btree (command, "targetType", "targetId") WHERE (("targetType" = ANY (ARRAY['REVIEW_REQUEST_BATCH'::"AdminAuditTargetType", 'IMPORT_REQUEST'::"AdminAuditTargetType", 'EXPORT_REQUEST'::"AdminAuditTargetType", 'ADMIN_SESSION'::"AdminAuditTargetType", 'USER_ERASURE'::"AdminAuditTargetType"])) AND ("targetId" = "operationId"));

-- INDEX: AdminAuditLog_targetType_targetId_idx
CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog" USING btree ("targetType", "targetId");

-- INDEX: Bookmark_questionId_id_idx
CREATE INDEX "Bookmark_questionId_id_idx" ON "Bookmark" USING btree ("questionId", id);

-- INDEX: Bookmark_userId_createdAt_id_idx
CREATE INDEX "Bookmark_userId_createdAt_id_idx" ON "Bookmark" USING btree ("userId", "createdAt" DESC, id);

-- INDEX: Bookmark_userId_createdAt_questionId_idx
CREATE INDEX "Bookmark_userId_createdAt_questionId_idx" ON "Bookmark" USING btree ("userId", "createdAt" DESC, "questionId");

-- INDEX: ContentReview_operationId_idx
CREATE INDEX "ContentReview_operationId_idx" ON "ContentReview" USING btree ("operationId");

-- INDEX: ContentReview_operation_version_key
CREATE UNIQUE INDEX "ContentReview_operation_version_key" ON "ContentReview" USING btree ("operationId", "questionVersionId");

-- INDEX: ContentReview_questionVersionId_occurredAt_id_idx
CREATE INDEX "ContentReview_questionVersionId_occurredAt_id_idx" ON "ContentReview" USING btree ("questionVersionId", "occurredAt" DESC, id DESC);

-- INDEX: GuestPrincipal_expiresAt_idx
CREATE INDEX "GuestPrincipal_expiresAt_idx" ON "GuestPrincipal" USING btree ("expiresAt");

-- INDEX: GuestPrincipal_tokenDigest_key
CREATE UNIQUE INDEX "GuestPrincipal_tokenDigest_key" ON "GuestPrincipal" USING btree ("tokenDigest");

-- INDEX: IdempotencyRecord_guest_scope_key
CREATE UNIQUE INDEX "IdempotencyRecord_guest_scope_key" ON "IdempotencyRecord" USING btree ("guestPrincipalId", operation, "idempotencyKey") WHERE ("guestPrincipalId" IS NOT NULL);

-- INDEX: IdempotencyRecord_operation_expiresAt_id_idx
CREATE INDEX "IdempotencyRecord_operation_expiresAt_id_idx" ON "IdempotencyRecord" USING btree (operation, "expiresAt", id) WHERE ((state = 'SUCCEEDED'::"IdempotencyState") AND ("expiresAt" IS NOT NULL));

-- INDEX: IdempotencyRecord_studySessionId_requestHash_idx
CREATE INDEX "IdempotencyRecord_studySessionId_requestHash_idx" ON "IdempotencyRecord" USING btree ("studySessionId", "requestHash");

-- INDEX: IdempotencyRecord_studySessionId_submit_succeeded_key
CREATE UNIQUE INDEX "IdempotencyRecord_studySessionId_submit_succeeded_key" ON "IdempotencyRecord" USING btree ("studySessionId") WHERE ((state = 'SUCCEEDED'::"IdempotencyState") AND (operation = 'STUDY_SUBMIT'::"IdempotencyOperation"));

-- INDEX: IdempotencyRecord_user_scope_key
CREATE UNIQUE INDEX "IdempotencyRecord_user_scope_key" ON "IdempotencyRecord" USING btree ("userId", operation, "idempotencyKey") WHERE ("userId" IS NOT NULL);

-- INDEX: AuthorityRevocationEvidence_expiresAt_tokenDigest_idx
CREATE INDEX "AuthorityRevocationEvidence_expiresAt_tokenDigest_idx" ON "AuthorityRevocationEvidence" USING btree ("expiresAt", "tokenDigest");

-- INDEX: ReauthenticationIntent_live_old_session_key
CREATE UNIQUE INDEX "ReauthenticationIntent_live_old_session_key" ON "ReauthenticationIntent" USING btree ("oldSessionId") WHERE (state = ANY (ARRAY['PREPARED'::"ReauthenticationIntentState", 'STAGED'::"ReauthenticationIntentState"]));

-- INDEX: ReauthenticationIntent_state_expiresAt_id_idx
CREATE INDEX "ReauthenticationIntent_state_expiresAt_id_idx" ON "ReauthenticationIntent" USING btree (state, "expiresAt", id);

-- INDEX: QuestionImportResult_createdAt_idx
CREATE INDEX "QuestionImportResult_createdAt_idx" ON "QuestionImportResult" USING btree ("createdAt");

-- INDEX: QuestionOption_questionVersionId_id_key
CREATE UNIQUE INDEX "QuestionOption_questionVersionId_id_key" ON "QuestionOption" USING btree ("questionVersionId", id);

-- INDEX: QuestionReport_open_duplicate_key
CREATE UNIQUE INDEX "QuestionReport_open_duplicate_key" ON "QuestionReport" USING btree ("reporterActorId", "questionVersionId", reason) WHERE (status = ANY (ARRAY['OPEN'::"QuestionReportStatus", 'TRIAGED'::"QuestionReportStatus"]));

-- INDEX: QuestionReport_questionId_status_idx
CREATE INDEX "QuestionReport_questionId_status_idx" ON "QuestionReport" USING btree ("questionId", status);

-- INDEX: QuestionReport_reporterActorId_questionVersionId_reason_idx
CREATE INDEX "QuestionReport_reporterActorId_questionVersionId_reason_idx" ON "QuestionReport" USING btree ("reporterActorId", "questionVersionId", reason);

-- INDEX: QuestionReport_status_updatedAt_id_idx
CREATE INDEX "QuestionReport_status_updatedAt_id_idx" ON "QuestionReport" USING btree (status, "updatedAt" DESC, id DESC);

-- INDEX: QuestionVersionTag_questionVersionId_tagId_key
CREATE UNIQUE INDEX "QuestionVersionTag_questionVersionId_tagId_key" ON "QuestionVersionTag" USING btree ("questionVersionId", "tagId");

-- INDEX: QuestionVersionTag_tagId_idx
CREATE INDEX "QuestionVersionTag_tagId_idx" ON "QuestionVersionTag" USING btree ("tagId");

-- INDEX: QuestionVersion_contentFingerprint_idx
CREATE INDEX "QuestionVersion_contentFingerprint_idx" ON "QuestionVersion" USING btree ("contentFingerprint");

-- INDEX: QuestionVersion_createdByUserId_idx
CREATE INDEX "QuestionVersion_createdByUserId_idx" ON "QuestionVersion" USING btree ("createdByUserId");

-- INDEX: QuestionVersion_id_correctOptionId_key
CREATE UNIQUE INDEX "QuestionVersion_id_correctOptionId_key" ON "QuestionVersion" USING btree (id, "correctOptionId");

-- INDEX: QuestionVersion_one_open_candidate_per_question_key
CREATE UNIQUE INDEX "QuestionVersion_one_open_candidate_per_question_key" ON "QuestionVersion" USING btree ("questionId") WHERE (status = ANY (ARRAY['DRAFT'::"QuestionVersionStatus", 'IN_REVIEW'::"QuestionVersionStatus", 'CHANGES_REQUESTED'::"QuestionVersionStatus", 'APPROVED'::"QuestionVersionStatus"]));

-- INDEX: QuestionVersion_one_published_per_question_key
CREATE UNIQUE INDEX "QuestionVersion_one_published_per_question_key" ON "QuestionVersion" USING btree ("questionId") WHERE (status = 'PUBLISHED'::"QuestionVersionStatus");

-- INDEX: QuestionVersion_questionId_id_key
CREATE UNIQUE INDEX "QuestionVersion_questionId_id_key" ON "QuestionVersion" USING btree ("questionId", id);

-- INDEX: QuestionVersion_questionId_status_versionNumber_idx
CREATE INDEX "QuestionVersion_questionId_status_versionNumber_idx" ON "QuestionVersion" USING btree ("questionId", status, "versionNumber" DESC);

-- INDEX: QuestionVersion_questionId_versionNumber_id_idx
CREATE INDEX "QuestionVersion_questionId_versionNumber_id_idx" ON "QuestionVersion" USING btree ("questionId", "versionNumber" DESC, id DESC);

-- INDEX: QuestionVersion_questionId_versionNumber_key
CREATE UNIQUE INDEX "QuestionVersion_questionId_versionNumber_key" ON "QuestionVersion" USING btree ("questionId", "versionNumber");

-- INDEX: QuestionVersion_questionText_prefix_idx
CREATE INDEX "QuestionVersion_questionText_prefix_idx" ON "QuestionVersion" USING btree ("questionText" COLLATE "C" text_pattern_ops);

-- INDEX: QuestionVersion_status_level_subject_questionType_difficult_idx
CREATE INDEX "QuestionVersion_status_level_subject_questionType_difficult_idx" ON "QuestionVersion" USING btree (status, level, subject, "questionType", difficulty);

-- INDEX: Question_createdByUserId_idx
CREATE INDEX "Question_createdByUserId_idx" ON "Question" USING btree ("createdByUserId");

-- INDEX: Question_currentPublishedVersionId_key
CREATE UNIQUE INDEX "Question_currentPublishedVersionId_key" ON "Question" USING btree ("currentPublishedVersionId");

-- INDEX: Question_id_currentPublishedVersionId_key
CREATE UNIQUE INDEX "Question_id_currentPublishedVersionId_key" ON "Question" USING btree (id, "currentPublishedVersionId");

-- INDEX: Question_lifecycleStatus_currentPublishedVersionId_idx
CREATE INDEX "Question_lifecycleStatus_currentPublishedVersionId_idx" ON "Question" USING btree ("lifecycleStatus", "currentPublishedVersionId");

-- INDEX: RateLimit_key_key
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit" USING btree (key);

-- INDEX: ReviewEvent_questionId_questionVersionId_idx
CREATE INDEX "ReviewEvent_questionId_questionVersionId_idx" ON "ReviewEvent" USING btree ("questionId", "questionVersionId");

-- INDEX: ReviewEvent_questionVersionId_selectedOptionId_idx
CREATE INDEX "ReviewEvent_questionVersionId_selectedOptionId_idx" ON "ReviewEvent" USING btree ("questionVersionId", "selectedOptionId");

-- INDEX: ReviewEvent_studyAnswerId_key
CREATE UNIQUE INDEX "ReviewEvent_studyAnswerId_key" ON "ReviewEvent" USING btree ("studyAnswerId");

-- INDEX: ReviewEvent_studyAnswerId_questionVersionId_key
CREATE UNIQUE INDEX "ReviewEvent_studyAnswerId_questionVersionId_key" ON "ReviewEvent" USING btree ("studyAnswerId", "questionVersionId");

-- INDEX: ReviewEvent_studySessionId_idx
CREATE INDEX "ReviewEvent_studySessionId_idx" ON "ReviewEvent" USING btree ("studySessionId");

-- INDEX: ReviewEvent_wrongNoteId_occurredAt_id_idx
CREATE INDEX "ReviewEvent_wrongNoteId_occurredAt_id_idx" ON "ReviewEvent" USING btree ("wrongNoteId", "occurredAt" DESC, id DESC);

-- INDEX: ReviewEvent_wrongNoteId_occurredAt_idx
CREATE INDEX "ReviewEvent_wrongNoteId_occurredAt_idx" ON "ReviewEvent" USING btree ("wrongNoteId", "occurredAt" DESC);

-- INDEX: ReviewSchedule_nextReviewAt_wrongNoteId_idx
CREATE INDEX "ReviewSchedule_nextReviewAt_wrongNoteId_idx" ON "ReviewSchedule" USING btree ("nextReviewAt", "wrongNoteId");

-- INDEX: ReviewSchedule_wrongNoteId_key
CREATE UNIQUE INDEX "ReviewSchedule_wrongNoteId_key" ON "ReviewSchedule" USING btree ("wrongNoteId");

-- INDEX: Session_expiresAt_idx
CREATE INDEX "Session_expiresAt_idx" ON "Session" USING btree ("expiresAt");

-- INDEX: Session_token_key
CREATE UNIQUE INDEX "Session_token_key" ON "Session" USING btree (token);

-- INDEX: Session_userId_issuerProtocolVersion_expiresAt_idx
CREATE INDEX "Session_userId_issuerProtocolVersion_expiresAt_idx" ON "Session" USING btree ("userId", "issuerProtocolVersion", "expiresAt");

-- INDEX: SsoAccountErasureRequest_appStatus_createdAt_idx
CREATE INDEX "SsoAccountErasureRequest_appStatus_createdAt_idx" ON "SsoAccountErasureRequest" USING btree ("appStatus", "createdAt");

-- INDEX: SsoAccountFreshProof_expiresAt_idx
CREATE INDEX "SsoAccountFreshProof_expiresAt_idx" ON "SsoAccountFreshProof" USING btree ("expiresAt");

-- INDEX: SsoAccountFreshTransaction_expiresAt_idx
CREATE INDEX "SsoAccountFreshTransaction_expiresAt_idx" ON "SsoAccountFreshTransaction" USING btree ("expiresAt");

-- INDEX: SsoAdminFreshProof_expiresAt_idx
CREATE INDEX "SsoAdminFreshProof_expiresAt_idx" ON "SsoAdminFreshProof" USING btree ("expiresAt");

-- INDEX: SsoAdminFreshProof_userId_idx
CREATE INDEX "SsoAdminFreshProof_userId_idx" ON "SsoAdminFreshProof" USING btree ("userId");

-- INDEX: SsoAdminFreshTransaction_expiresAt_idx
CREATE INDEX "SsoAdminFreshTransaction_expiresAt_idx" ON "SsoAdminFreshTransaction" USING btree ("expiresAt");

-- INDEX: SsoAdminFreshTransaction_userId_idx
CREATE INDEX "SsoAdminFreshTransaction_userId_idx" ON "SsoAdminFreshTransaction" USING btree ("userId");

-- INDEX: SsoLoginTransaction_expiresAt_idx
CREATE INDEX "SsoLoginTransaction_expiresAt_idx" ON "SsoLoginTransaction" USING btree ("expiresAt");

-- INDEX: StudyAnswer_id_questionVersionId_key
CREATE UNIQUE INDEX "StudyAnswer_id_questionVersionId_key" ON "StudyAnswer" USING btree (id, "questionVersionId");

-- INDEX: StudyAnswer_questionVersionId_selectedOptionId_idx
CREATE INDEX "StudyAnswer_questionVersionId_selectedOptionId_idx" ON "StudyAnswer" USING btree ("questionVersionId", "selectedOptionId");

-- INDEX: StudyAnswer_studySessionQuestionId_key
CREATE UNIQUE INDEX "StudyAnswer_studySessionQuestionId_key" ON "StudyAnswer" USING btree ("studySessionQuestionId");

-- INDEX: StudyAnswer_studySessionQuestionId_questionVersionId_key
CREATE UNIQUE INDEX "StudyAnswer_studySessionQuestionId_questionVersionId_key" ON "StudyAnswer" USING btree ("studySessionQuestionId", "questionVersionId");

-- INDEX: StudyDraftAnswer_questionVersionId_selectedOptionId_idx
CREATE INDEX "StudyDraftAnswer_questionVersionId_selectedOptionId_idx" ON "StudyDraftAnswer" USING btree ("questionVersionId", "selectedOptionId") WHERE ("selectedOptionId" IS NOT NULL);

-- INDEX: StudyDraftAnswer_studySessionQuestionId_questionVersionId_idx
CREATE INDEX "StudyDraftAnswer_studySessionQuestionId_questionVersionId_idx" ON "StudyDraftAnswer" USING btree ("studySessionQuestionId", "questionVersionId");

-- INDEX: StudyDraft_savedAt_studySessionId_idx
CREATE INDEX "StudyDraft_savedAt_studySessionId_idx" ON "StudyDraft" USING btree ("savedAt" DESC NULLS LAST, "studySessionId");

-- INDEX: StudyResult_studySessionId_key
CREATE UNIQUE INDEX "StudyResult_studySessionId_key" ON "StudyResult" USING btree ("studySessionId");

-- INDEX: StudySessionQuestion_id_questionVersionId_key
CREATE UNIQUE INDEX "StudySessionQuestion_id_questionVersionId_key" ON "StudySessionQuestion" USING btree (id, "questionVersionId");

-- INDEX: StudySessionQuestion_questionId_questionVersionId_idx
CREATE INDEX "StudySessionQuestion_questionId_questionVersionId_idx" ON "StudySessionQuestion" USING btree ("questionId", "questionVersionId");

-- INDEX: StudySessionQuestion_studySessionId_id_key
CREATE UNIQUE INDEX "StudySessionQuestion_studySessionId_id_key" ON "StudySessionQuestion" USING btree ("studySessionId", id);

-- INDEX: StudySessionQuestion_studySessionId_ordinal_key
CREATE UNIQUE INDEX "StudySessionQuestion_studySessionId_ordinal_key" ON "StudySessionQuestion" USING btree ("studySessionId", ordinal);

-- INDEX: StudySessionQuestion_studySessionId_questionId_key
CREATE UNIQUE INDEX "StudySessionQuestion_studySessionId_questionId_key" ON "StudySessionQuestion" USING btree ("studySessionId", "questionId");

-- INDEX: StudySessionQuestion_studySessionId_questionVersionId_key
CREATE UNIQUE INDEX "StudySessionQuestion_studySessionId_questionVersionId_key" ON "StudySessionQuestion" USING btree ("studySessionId", "questionVersionId");

-- INDEX: StudySession_guestPrincipalId_startedAt_id_resumable_idx
CREATE INDEX "StudySession_guestPrincipalId_startedAt_id_resumable_idx" ON "StudySession" USING btree ("guestPrincipalId", "startedAt" DESC, id) INCLUDE ("expiresAt") WHERE (("guestPrincipalId" IS NOT NULL) AND (status = 'IN_PROGRESS'::"StudySessionStatus"));

-- INDEX: StudySession_guestPrincipalId_status_expiresAt_idx
CREATE INDEX "StudySession_guestPrincipalId_status_expiresAt_idx" ON "StudySession" USING btree ("guestPrincipalId", status, "expiresAt");

-- INDEX: StudySession_guestPrincipalId_status_submittedAt_idx
CREATE INDEX "StudySession_guestPrincipalId_status_submittedAt_idx" ON "StudySession" USING btree ("guestPrincipalId", status, "submittedAt");

-- INDEX: StudySession_guest_level_subject_submittedAt_id_weakness_idx
CREATE INDEX "StudySession_guest_level_subject_submittedAt_id_weakness_idx" ON "StudySession" USING btree ("guestPrincipalId", level, subject, "submittedAt" DESC, id) WHERE (("guestPrincipalId" IS NOT NULL) AND (status = 'SUBMITTED'::"StudySessionStatus") AND ("submittedAt" IS NOT NULL));

-- INDEX: StudySession_id_guestPrincipalId_key
CREATE UNIQUE INDEX "StudySession_id_guestPrincipalId_key" ON "StudySession" USING btree (id, "guestPrincipalId");

-- INDEX: StudySession_id_userId_key
CREATE UNIQUE INDEX "StudySession_id_userId_key" ON "StudySession" USING btree (id, "userId");

-- INDEX: StudySession_retryOfStudySessionId_id_idx
CREATE INDEX "StudySession_retryOfStudySessionId_id_idx" ON "StudySession" USING btree ("retryOfStudySessionId", id);

-- INDEX: StudySession_retry_guest_source_idx
CREATE INDEX "StudySession_retry_guest_source_idx" ON "StudySession" USING btree ("retryOfStudySessionId", "guestPrincipalId") WHERE (("retryOfStudySessionId" IS NOT NULL) AND ("guestPrincipalId" IS NOT NULL));

-- INDEX: StudySession_retry_user_source_idx
CREATE INDEX "StudySession_retry_user_source_idx" ON "StudySession" USING btree ("retryOfStudySessionId", "userId") WHERE (("retryOfStudySessionId" IS NOT NULL) AND ("userId" IS NOT NULL));

-- INDEX: StudySession_status_expiresAt_idx
CREATE INDEX "StudySession_status_expiresAt_idx" ON "StudySession" USING btree (status, "expiresAt");

-- INDEX: StudySession_userId_level_subject_submittedAt_id_weakness_idx
CREATE INDEX "StudySession_userId_level_subject_submittedAt_id_weakness_idx" ON "StudySession" USING btree ("userId", level, subject, "submittedAt" DESC, id) WHERE (("userId" IS NOT NULL) AND (status = 'SUBMITTED'::"StudySessionStatus") AND ("submittedAt" IS NOT NULL));

-- INDEX: StudySession_userId_startedAt_id_resumable_idx
CREATE INDEX "StudySession_userId_startedAt_id_resumable_idx" ON "StudySession" USING btree ("userId", "startedAt" DESC, id) INCLUDE ("expiresAt") WHERE (("userId" IS NOT NULL) AND (status = 'IN_PROGRESS'::"StudySessionStatus"));

-- INDEX: StudySession_userId_status_startedAt_idx
CREATE INDEX "StudySession_userId_status_startedAt_idx" ON "StudySession" USING btree ("userId", status, "startedAt" DESC);

-- INDEX: StudySession_userId_submittedAt_id_dashboard_idx
CREATE INDEX "StudySession_userId_submittedAt_id_dashboard_idx" ON "StudySession" USING btree ("userId", "submittedAt" DESC, id) WHERE (("userId" IS NOT NULL) AND (status = 'SUBMITTED'::"StudySessionStatus") AND ("submittedAt" IS NOT NULL));

-- INDEX: TagApplicability_taxonomy_idx
CREATE INDEX "TagApplicability_taxonomy_idx" ON "TagApplicability" USING btree (level, subject, "questionType", "tagId");

-- INDEX: Tag_normalizedName_key
CREATE UNIQUE INDEX "Tag_normalizedName_key" ON "Tag" USING btree ("normalizedName");

-- INDEX: UserAccountRestrictionEvent_actorUserId_idx
CREATE INDEX "UserAccountRestrictionEvent_actorUserId_idx" ON "UserAccountRestrictionEvent" USING btree ("actorUserId");

-- INDEX: UserAccountRestrictionEvent_userId_createdAt_idx
CREATE INDEX "UserAccountRestrictionEvent_userId_createdAt_idx" ON "UserAccountRestrictionEvent" USING btree ("userId", "createdAt");

-- INDEX: UserReport_admin_order_idx
CREATE INDEX "UserReport_admin_order_idx" ON "UserReport" USING btree ((((status)::text = 'RECEIVED'::text)) DESC, "createdAt" DESC, id DESC);

-- INDEX: UserReport_open_question_report_key
CREATE UNIQUE INDEX "UserReport_open_question_report_key" ON "UserReport" USING btree ("reporterUserId", "questionVersionId") WHERE (((kind)::text = 'QUESTION'::text) AND ((status)::text = 'RECEIVED'::text));

-- INDEX: UserReport_reporter_idx
CREATE INDEX "UserReport_reporter_idx" ON "UserReport" USING btree ("reporterUserId", "createdAt" DESC, id DESC);

-- INDEX: User_email_key
CREATE UNIQUE INDEX "User_email_key" ON "User" USING btree (email);

-- INDEX: User_email_normalized_key
CREATE UNIQUE INDEX "User_email_normalized_key" ON "User" USING btree (lower(email));

-- INDEX: User_role_accountStatus_idx
CREATE INDEX "User_role_accountStatus_idx" ON "User" USING btree (role, "accountStatus");

-- INDEX: Verification_expiresAt_idx
CREATE INDEX "Verification_expiresAt_idx" ON "Verification" USING btree ("expiresAt");

-- INDEX: Verification_identifier_expiresAt_idx
CREATE INDEX "Verification_identifier_expiresAt_idx" ON "Verification" USING btree (identifier, "expiresAt");

-- INDEX: WrongNote_id_userId_questionId_key
CREATE UNIQUE INDEX "WrongNote_id_userId_questionId_key" ON "WrongNote" USING btree (id, "userId", "questionId");

-- INDEX: WrongNote_questionId_currentReviewQuestionVersionId_idx
CREATE INDEX "WrongNote_questionId_currentReviewQuestionVersionId_idx" ON "WrongNote" USING btree ("questionId", "currentReviewQuestionVersionId");

-- INDEX: WrongNote_questionId_lastWrongQuestionVersionId_idx
CREATE INDEX "WrongNote_questionId_lastWrongQuestionVersionId_idx" ON "WrongNote" USING btree ("questionId", "lastWrongQuestionVersionId");

-- INDEX: WrongNote_userId_lastWrongAt_idx
CREATE INDEX "WrongNote_userId_lastWrongAt_idx" ON "WrongNote" USING btree ("userId", "lastWrongAt" DESC);

-- INDEX: WrongNote_userId_questionId_key
CREATE UNIQUE INDEX "WrongNote_userId_questionId_key" ON "WrongNote" USING btree ("userId", "questionId");

-- INDEX: WrongNote_userId_status_id_questionId_daily_idx
CREATE INDEX "WrongNote_userId_status_id_questionId_daily_idx" ON "WrongNote" USING btree ("userId", status, id, "questionId");

-- INDEX: WrongNote_userId_status_lastWrongAt_idx
CREATE INDEX "WrongNote_userId_status_lastWrongAt_idx" ON "WrongNote" USING btree ("userId", status, "lastWrongAt" DESC);

-- INDEX: WrongNote_userId_wrongCount_lastWrongAt_id_idx
CREATE INDEX "WrongNote_userId_wrongCount_lastWrongAt_id_idx" ON "WrongNote" USING btree ("userId", "wrongCount" DESC, "lastWrongAt" DESC, id);

-- INDEX: WrongNote_user_status_lastWrongAt_wrongCount_questionId_idx
CREATE INDEX "WrongNote_user_status_lastWrongAt_wrongCount_questionId_idx" ON "WrongNote" USING btree ("userId", status, "lastWrongAt" DESC, "wrongCount" DESC, "questionId");

-- TRIGGER: Account Account_deferred_credential_totality
CREATE CONSTRAINT TRIGGER "Account_deferred_credential_totality" AFTER INSERT OR DELETE OR UPDATE ON "Account" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_credential_totality();

-- TRIGGER: Account Account_limit_api_insert
CREATE TRIGGER "Account_limit_api_insert" BEFORE INSERT ON "Account" FOR EACH ROW EXECUTE FUNCTION limit_account_api_insert();

-- TRIGGER: Account Account_protect_identity_and_password
CREATE TRIGGER "Account_protect_identity_and_password" BEFORE DELETE OR UPDATE ON "Account" FOR EACH ROW EXECUTE FUNCTION protect_account();

-- TRIGGER: AdminAuditLog AdminAuditLog_protect_history
CREATE TRIGGER "AdminAuditLog_protect_history" BEFORE DELETE OR UPDATE ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION protect_evidence_history();

-- TRIGGER: ContentReview ContentReview_protect_history
CREATE TRIGGER "ContentReview_protect_history" BEFORE DELETE OR UPDATE ON "ContentReview" FOR EACH ROW EXECUTE FUNCTION protect_evidence_history();

-- TRIGGER: GuestPrincipal GuestPrincipal_validate_renewal_change
CREATE TRIGGER "GuestPrincipal_validate_renewal_change" BEFORE UPDATE ON "GuestPrincipal" FOR EACH ROW EXECUTE FUNCTION validate_guest_principal_renewal_change();

-- TRIGGER: AuthorityRevocationEvidence AuthorityRevocationEvidence_limit_api_delete
CREATE TRIGGER "AuthorityRevocationEvidence_limit_api_delete" BEFORE DELETE ON "AuthorityRevocationEvidence" FOR EACH ROW EXECUTE FUNCTION limit_authority_revocation_evidence_delete();

-- TRIGGER: OperationIntent OperationIntent_limit_api_delete
CREATE TRIGGER "OperationIntent_limit_api_delete" BEFORE DELETE ON "OperationIntent" FOR EACH ROW EXECUTE FUNCTION limit_operation_intent_delete();

-- TRIGGER: OperationIntent OperationIntent_must_finish
CREATE CONSTRAINT TRIGGER "OperationIntent_must_finish" AFTER INSERT ON "OperationIntent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_unfinished_operation();

-- TRIGGER: ReauthenticationIntent ReauthenticationIntent_limit_api_delete
CREATE TRIGGER "ReauthenticationIntent_limit_api_delete" BEFORE DELETE ON "ReauthenticationIntent" FOR EACH ROW EXECUTE FUNCTION limit_reauthentication_intent_delete();

-- TRIGGER: QuestionOption QuestionOption_deferred_full_content
CREATE CONSTRAINT TRIGGER "QuestionOption_deferred_full_content" AFTER INSERT OR DELETE OR UPDATE ON "QuestionOption" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_question_version_content();

-- TRIGGER: QuestionOption QuestionOption_refresh_fingerprint
CREATE TRIGGER "QuestionOption_refresh_fingerprint" AFTER INSERT OR UPDATE OF text ON "QuestionOption" FOR EACH ROW EXECUTE FUNCTION refresh_question_version_fingerprint();

-- TRIGGER: QuestionReport QuestionReport_deferred_remediation
CREATE CONSTRAINT TRIGGER "QuestionReport_deferred_remediation" AFTER INSERT OR UPDATE ON "QuestionReport" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_question_report_remediation();

-- TRIGGER: QuestionReport QuestionReport_validate_insert
CREATE TRIGGER "QuestionReport_validate_insert" BEFORE INSERT ON "QuestionReport" FOR EACH ROW EXECUTE FUNCTION validate_question_report_insert();

-- TRIGGER: QuestionVersionTag QuestionVersionTag_copy_snapshots
CREATE TRIGGER "QuestionVersionTag_copy_snapshots" BEFORE INSERT ON "QuestionVersionTag" FOR EACH ROW EXECUTE FUNCTION copy_tag_snapshots();

-- TRIGGER: QuestionVersionTag QuestionVersionTag_deferred_full_content
CREATE CONSTRAINT TRIGGER "QuestionVersionTag_deferred_full_content" AFTER INSERT OR DELETE OR UPDATE ON "QuestionVersionTag" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_question_version_content();

-- TRIGGER: QuestionVersionTag QuestionVersionTag_lock_assignment_scope
CREATE TRIGGER "QuestionVersionTag_lock_assignment_scope" BEFORE INSERT OR DELETE ON "QuestionVersionTag" FOR EACH STATEMENT EXECUTE FUNCTION lock_tag_assignment_scope();

-- TRIGGER: QuestionVersionTag QuestionVersionTag_validate_inserted_snapshots
CREATE TRIGGER "QuestionVersionTag_validate_inserted_snapshots" AFTER INSERT ON "QuestionVersionTag" REFERENCING NEW TABLE AS inserted_tag_rows FOR EACH STATEMENT EXECUTE FUNCTION validate_inserted_tag_snapshots();

-- TRIGGER: QuestionVersion QuestionVersion_deferred_full_content
CREATE CONSTRAINT TRIGGER "QuestionVersion_deferred_full_content" AFTER INSERT OR UPDATE ON "QuestionVersion" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_question_version_content();

-- TRIGGER: QuestionVersion QuestionVersion_deferred_question_aggregate
CREATE CONSTRAINT TRIGGER "QuestionVersion_deferred_question_aggregate" AFTER INSERT OR DELETE OR UPDATE ON "QuestionVersion" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_question_aggregate();

-- TRIGGER: QuestionVersion QuestionVersion_protect_delete
CREATE TRIGGER "QuestionVersion_protect_delete" BEFORE DELETE ON "QuestionVersion" FOR EACH ROW EXECUTE FUNCTION protect_question_version_delete();

-- TRIGGER: QuestionVersion QuestionVersion_refresh_fingerprint
CREATE TRIGGER "QuestionVersion_refresh_fingerprint" AFTER INSERT OR UPDATE OF level, subject, "questionType", passage, "questionText", "correctOptionId" ON "QuestionVersion" FOR EACH ROW EXECUTE FUNCTION refresh_question_version_fingerprint();

-- TRIGGER: Question Question_deferred_aggregate
CREATE CONSTRAINT TRIGGER "Question_deferred_aggregate" AFTER INSERT OR UPDATE ON "Question" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_question_aggregate();

-- TRIGGER: Question Question_protect_history_delete
CREATE TRIGGER "Question_protect_history_delete" BEFORE DELETE ON "Question" FOR EACH ROW EXECUTE FUNCTION protect_question_history_delete();

-- TRIGGER: Session Session_validate_authority_write
CREATE TRIGGER "Session_validate_authority_write" BEFORE INSERT OR DELETE OR UPDATE ON "Session" FOR EACH ROW EXECUTE FUNCTION validate_session_write();

-- TRIGGER: SsoAccountErasureRequest SsoAccountErasureRequest_limit_api_update
CREATE TRIGGER "SsoAccountErasureRequest_limit_api_update" BEFORE UPDATE ON "SsoAccountErasureRequest" FOR EACH ROW EXECUTE FUNCTION limit_sso_account_erasure_request_update();

-- TRIGGER: SsoAccountErasureRequest SsoAccountErasureRequest_prepare_api_insert
CREATE TRIGGER "SsoAccountErasureRequest_prepare_api_insert" BEFORE INSERT ON "SsoAccountErasureRequest" FOR EACH ROW EXECUTE FUNCTION prepare_sso_account_erasure_request();

-- TRIGGER: SsoAdminFreshProof SsoAdminFreshProof_limit_api_delete
CREATE TRIGGER "SsoAdminFreshProof_limit_api_delete" BEFORE DELETE ON "SsoAdminFreshProof" FOR EACH ROW EXECUTE FUNCTION limit_sso_admin_fresh_proof_delete();

-- TRIGGER: SsoAdminFreshTransaction SsoAdminFreshTransaction_limit_api_delete
CREATE TRIGGER "SsoAdminFreshTransaction_limit_api_delete" BEFORE DELETE ON "SsoAdminFreshTransaction" FOR EACH ROW EXECUTE FUNCTION limit_sso_admin_fresh_transaction_delete();

-- TRIGGER: TagApplicability TagApplicability_protect_write
CREATE TRIGGER "TagApplicability_protect_write" BEFORE INSERT OR DELETE OR UPDATE ON "TagApplicability" FOR EACH ROW EXECUTE FUNCTION protect_tag_applicability();

-- TRIGGER: Tag Tag_lock_assignment_scope
CREATE TRIGGER "Tag_lock_assignment_scope" BEFORE UPDATE ON "Tag" FOR EACH STATEMENT EXECUTE FUNCTION lock_tag_assignment_scope();

-- TRIGGER: UserReport UserReport_redact_on_reporter_erasure
CREATE TRIGGER "UserReport_redact_on_reporter_erasure" BEFORE UPDATE OF "reporterUserId" ON "UserReport" FOR EACH ROW EXECUTE FUNCTION redact_user_report_on_reporter_erasure();

-- TRIGGER: User User_deferred_credential_totality
CREATE CONSTRAINT TRIGGER "User_deferred_credential_totality" AFTER INSERT OR UPDATE ON "User" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_credential_totality();

-- TRIGGER: User User_limit_erasure_delete
CREATE TRIGGER "User_limit_erasure_delete" BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION limit_user_delete();

-- TRIGGER: User User_validate_identity_authority
CREATE TRIGGER "User_validate_identity_authority" BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION validate_user_change();

-- TRIGGER: Verification Verification_validate_write
CREATE TRIGGER "Verification_validate_write" BEFORE INSERT OR DELETE OR UPDATE ON "Verification" FOR EACH ROW EXECUTE FUNCTION validate_verification_write();

-- FK CONSTRAINT: Account Account_userId_fkey
ALTER TABLE ONLY "Account"
    ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;

-- FK CONSTRAINT: AdminAuditLog AdminAuditLog_actorUserId_fkey
ALTER TABLE ONLY "AdminAuditLog"
    ADD CONSTRAINT "AdminAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"(id) ON DELETE SET NULL;

-- FK CONSTRAINT: Bookmark Bookmark_questionId_fkey
ALTER TABLE ONLY "Bookmark"
    ADD CONSTRAINT "Bookmark_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- FK CONSTRAINT: Bookmark Bookmark_userId_fkey
ALTER TABLE ONLY "Bookmark"
    ADD CONSTRAINT "Bookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;

-- FK CONSTRAINT: ContentReview ContentReview_actorUserId_fkey
ALTER TABLE ONLY "ContentReview"
    ADD CONSTRAINT "ContentReview_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"(id) ON DELETE SET NULL;

-- FK CONSTRAINT: ContentReview ContentReview_counterpartUserId_fkey
ALTER TABLE ONLY "ContentReview"
    ADD CONSTRAINT "ContentReview_counterpartUserId_fkey" FOREIGN KEY ("counterpartUserId") REFERENCES "User"(id) ON DELETE SET NULL;

-- FK CONSTRAINT: ContentReview ContentReview_questionId_fkey
ALTER TABLE ONLY "ContentReview"
    ADD CONSTRAINT "ContentReview_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"(id) ON DELETE RESTRICT;

-- FK CONSTRAINT: ContentReview ContentReview_questionId_questionVersionId_fkey
ALTER TABLE ONLY "ContentReview"
    ADD CONSTRAINT "ContentReview_questionId_questionVersionId_fkey" FOREIGN KEY ("questionId", "questionVersionId") REFERENCES "QuestionVersion"("questionId", id) ON DELETE RESTRICT;

-- FK CONSTRAINT: IdempotencyRecord IdempotencyRecord_guestPrincipalId_fkey
ALTER TABLE ONLY "IdempotencyRecord"
    ADD CONSTRAINT "IdempotencyRecord_guestPrincipalId_fkey" FOREIGN KEY ("guestPrincipalId") REFERENCES "GuestPrincipal"(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT: IdempotencyRecord IdempotencyRecord_studySessionId_fkey
ALTER TABLE ONLY "IdempotencyRecord"
    ADD CONSTRAINT "IdempotencyRecord_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "StudySession"(id) ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- FK CONSTRAINT: IdempotencyRecord IdempotencyRecord_studySessionId_guestPrincipalId_fkey
ALTER TABLE ONLY "IdempotencyRecord"
    ADD CONSTRAINT "IdempotencyRecord_studySessionId_guestPrincipalId_fkey" FOREIGN KEY ("studySessionId", "guestPrincipalId") REFERENCES "StudySession"(id, "guestPrincipalId") ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- FK CONSTRAINT: IdempotencyRecord IdempotencyRecord_studySessionId_userId_fkey
ALTER TABLE ONLY "IdempotencyRecord"
    ADD CONSTRAINT "IdempotencyRecord_studySessionId_userId_fkey" FOREIGN KEY ("studySessionId", "userId") REFERENCES "StudySession"(id, "userId") ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- FK CONSTRAINT: IdempotencyRecord IdempotencyRecord_userId_fkey
ALTER TABLE ONLY "IdempotencyRecord"
    ADD CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;

-- FK CONSTRAINT: QuestionOption QuestionOption_questionVersionId_fkey
ALTER TABLE ONLY "QuestionOption"
    ADD CONSTRAINT "QuestionOption_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"(id) ON DELETE RESTRICT;

-- FK CONSTRAINT: QuestionReport QuestionReport_assigneeUserId_fkey
ALTER TABLE ONLY "QuestionReport"
    ADD CONSTRAINT "QuestionReport_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"(id) ON DELETE SET NULL;

-- FK CONSTRAINT: QuestionReport QuestionReport_questionId_fkey
ALTER TABLE ONLY "QuestionReport"
    ADD CONSTRAINT "QuestionReport_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"(id) ON DELETE RESTRICT;

-- FK CONSTRAINT: QuestionReport QuestionReport_questionId_questionVersionId_fkey
ALTER TABLE ONLY "QuestionReport"
    ADD CONSTRAINT "QuestionReport_questionId_questionVersionId_fkey" FOREIGN KEY ("questionId", "questionVersionId") REFERENCES "QuestionVersion"("questionId", id) ON DELETE RESTRICT;

-- FK CONSTRAINT: QuestionReport QuestionReport_questionId_remediationVersionId_fkey
ALTER TABLE ONLY "QuestionReport"
    ADD CONSTRAINT "QuestionReport_questionId_remediationVersionId_fkey" FOREIGN KEY ("questionId", "remediationVersionId") REFERENCES "QuestionVersion"("questionId", id) ON DELETE RESTRICT;

-- FK CONSTRAINT: QuestionReport QuestionReport_reporterUserId_fkey
ALTER TABLE ONLY "QuestionReport"
    ADD CONSTRAINT "QuestionReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"(id) ON DELETE SET NULL;

-- FK CONSTRAINT: QuestionVersionTag QuestionVersionTag_questionVersionId_fkey
ALTER TABLE ONLY "QuestionVersionTag"
    ADD CONSTRAINT "QuestionVersionTag_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"(id) ON DELETE RESTRICT;

-- FK CONSTRAINT: QuestionVersionTag QuestionVersionTag_tagId_fkey
ALTER TABLE ONLY "QuestionVersionTag"
    ADD CONSTRAINT "QuestionVersionTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"(id) ON DELETE RESTRICT;

-- FK CONSTRAINT: QuestionVersion QuestionVersion_createdByUserId_fkey
ALTER TABLE ONLY "QuestionVersion"
    ADD CONSTRAINT "QuestionVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"(id) ON DELETE SET NULL;

-- FK CONSTRAINT: QuestionVersion QuestionVersion_id_correctOptionId_fkey
ALTER TABLE ONLY "QuestionVersion"
    ADD CONSTRAINT "QuestionVersion_id_correctOptionId_fkey" FOREIGN KEY (id, "correctOptionId") REFERENCES "QuestionOption"("questionVersionId", id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

-- FK CONSTRAINT: QuestionVersion QuestionVersion_questionId_fkey
ALTER TABLE ONLY "QuestionVersion"
    ADD CONSTRAINT "QuestionVersion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"(id) ON DELETE RESTRICT;

-- FK CONSTRAINT: Question Question_createdByUserId_fkey
ALTER TABLE ONLY "Question"
    ADD CONSTRAINT "Question_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"(id) ON DELETE SET NULL;

-- FK CONSTRAINT: Question Question_id_currentPublishedVersionId_fkey
ALTER TABLE ONLY "Question"
    ADD CONSTRAINT "Question_id_currentPublishedVersionId_fkey" FOREIGN KEY (id, "currentPublishedVersionId") REFERENCES "QuestionVersion"("questionId", id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

-- FK CONSTRAINT: ReviewEvent ReviewEvent_questionId_questionVersionId_fkey
ALTER TABLE ONLY "ReviewEvent"
    ADD CONSTRAINT "ReviewEvent_questionId_questionVersionId_fkey" FOREIGN KEY ("questionId", "questionVersionId") REFERENCES "QuestionVersion"("questionId", id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- FK CONSTRAINT: ReviewEvent ReviewEvent_questionVersionId_selectedOptionId_fkey
ALTER TABLE ONLY "ReviewEvent"
    ADD CONSTRAINT "ReviewEvent_questionVersionId_selectedOptionId_fkey" FOREIGN KEY ("questionVersionId", "selectedOptionId") REFERENCES "QuestionOption"("questionVersionId", id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- FK CONSTRAINT: ReviewEvent ReviewEvent_studyAnswerId_questionVersionId_fkey
ALTER TABLE ONLY "ReviewEvent"
    ADD CONSTRAINT "ReviewEvent_studyAnswerId_questionVersionId_fkey" FOREIGN KEY ("studyAnswerId", "questionVersionId") REFERENCES "StudyAnswer"(id, "questionVersionId") ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT: ReviewEvent ReviewEvent_studySessionId_fkey
ALTER TABLE ONLY "ReviewEvent"
    ADD CONSTRAINT "ReviewEvent_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "StudySession"(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT: ReviewEvent ReviewEvent_wrongNoteId_userId_questionId_fkey
ALTER TABLE ONLY "ReviewEvent"
    ADD CONSTRAINT "ReviewEvent_wrongNoteId_userId_questionId_fkey" FOREIGN KEY ("wrongNoteId", "userId", "questionId") REFERENCES "WrongNote"(id, "userId", "questionId") ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT: ReviewSchedule ReviewSchedule_wrongNoteId_fkey
ALTER TABLE ONLY "ReviewSchedule"
    ADD CONSTRAINT "ReviewSchedule_wrongNoteId_fkey" FOREIGN KEY ("wrongNoteId") REFERENCES "WrongNote"(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT: Session Session_userId_fkey
ALTER TABLE ONLY "Session"
    ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;

-- FK CONSTRAINT: SsoAccountErasureRequest SsoAccountErasureRequest_userId_fkey
ALTER TABLE ONLY "SsoAccountErasureRequest"
    ADD CONSTRAINT "SsoAccountErasureRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- FK CONSTRAINT: SsoAccountFreshProof SsoAccountFreshProof_userId_fkey
ALTER TABLE ONLY "SsoAccountFreshProof"
    ADD CONSTRAINT "SsoAccountFreshProof_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT: SsoAccountFreshTransaction SsoAccountFreshTransaction_userId_fkey
ALTER TABLE ONLY "SsoAccountFreshTransaction"
    ADD CONSTRAINT "SsoAccountFreshTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT: SsoAdminFreshProof SsoAdminFreshProof_userId_fkey
ALTER TABLE ONLY "SsoAdminFreshProof"
    ADD CONSTRAINT "SsoAdminFreshProof_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;

-- FK CONSTRAINT: SsoAdminFreshTransaction SsoAdminFreshTransaction_userId_fkey
ALTER TABLE ONLY "SsoAdminFreshTransaction"
    ADD CONSTRAINT "SsoAdminFreshTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;

-- FK CONSTRAINT: StudyAnswer StudyAnswer_questionVersionId_selectedOptionId_fkey
ALTER TABLE ONLY "StudyAnswer"
    ADD CONSTRAINT "StudyAnswer_questionVersionId_selectedOptionId_fkey" FOREIGN KEY ("questionVersionId", "selectedOptionId") REFERENCES "QuestionOption"("questionVersionId", id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- FK CONSTRAINT: StudyAnswer StudyAnswer_studySessionQuestionId_questionVersionId_fkey
ALTER TABLE ONLY "StudyAnswer"
    ADD CONSTRAINT "StudyAnswer_studySessionQuestionId_questionVersionId_fkey" FOREIGN KEY ("studySessionQuestionId", "questionVersionId") REFERENCES "StudySessionQuestion"(id, "questionVersionId") ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT: StudyDraftAnswer StudyDraftAnswer_questionVersionId_selectedOptionId_fkey
ALTER TABLE ONLY "StudyDraftAnswer"
    ADD CONSTRAINT "StudyDraftAnswer_questionVersionId_selectedOptionId_fkey" FOREIGN KEY ("questionVersionId", "selectedOptionId") REFERENCES "QuestionOption"("questionVersionId", id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- FK CONSTRAINT: StudyDraftAnswer StudyDraftAnswer_studySessionId_fkey
ALTER TABLE ONLY "StudyDraftAnswer"
    ADD CONSTRAINT "StudyDraftAnswer_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "StudyDraft"("studySessionId") ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT: StudyDraftAnswer StudyDraftAnswer_studySessionId_studySessionQuestionId_fkey
ALTER TABLE ONLY "StudyDraftAnswer"
    ADD CONSTRAINT "StudyDraftAnswer_studySessionId_studySessionQuestionId_fkey" FOREIGN KEY ("studySessionId", "studySessionQuestionId") REFERENCES "StudySessionQuestion"("studySessionId", id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT: StudyDraftAnswer StudyDraftAnswer_studySessionQuestionId_questionVersionId_fkey
ALTER TABLE ONLY "StudyDraftAnswer"
    ADD CONSTRAINT "StudyDraftAnswer_studySessionQuestionId_questionVersionId_fkey" FOREIGN KEY ("studySessionQuestionId", "questionVersionId") REFERENCES "StudySessionQuestion"(id, "questionVersionId") ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT: StudyDraft StudyDraft_studySessionId_fkey
ALTER TABLE ONLY "StudyDraft"
    ADD CONSTRAINT "StudyDraft_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "StudySession"(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT: StudyResult StudyResult_studySessionId_fkey
ALTER TABLE ONLY "StudyResult"
    ADD CONSTRAINT "StudyResult_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "StudySession"(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT: StudySessionQuestion StudySessionQuestion_questionId_fkey
ALTER TABLE ONLY "StudySessionQuestion"
    ADD CONSTRAINT "StudySessionQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- FK CONSTRAINT: StudySessionQuestion StudySessionQuestion_questionId_questionVersionId_fkey
ALTER TABLE ONLY "StudySessionQuestion"
    ADD CONSTRAINT "StudySessionQuestion_questionId_questionVersionId_fkey" FOREIGN KEY ("questionId", "questionVersionId") REFERENCES "QuestionVersion"("questionId", id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- FK CONSTRAINT: StudySessionQuestion StudySessionQuestion_studySessionId_fkey
ALTER TABLE ONLY "StudySessionQuestion"
    ADD CONSTRAINT "StudySessionQuestion_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "StudySession"(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT: StudySession StudySession_guestPrincipalId_fkey
ALTER TABLE ONLY "StudySession"
    ADD CONSTRAINT "StudySession_guestPrincipalId_fkey" FOREIGN KEY ("guestPrincipalId") REFERENCES "GuestPrincipal"(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT: StudySession StudySession_retryOfStudySessionId_fkey
ALTER TABLE ONLY "StudySession"
    ADD CONSTRAINT "StudySession_retryOfStudySessionId_fkey" FOREIGN KEY ("retryOfStudySessionId") REFERENCES "StudySession"(id) ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- FK CONSTRAINT: StudySession StudySession_retryOfStudySessionId_guestPrincipalId_fkey
ALTER TABLE ONLY "StudySession"
    ADD CONSTRAINT "StudySession_retryOfStudySessionId_guestPrincipalId_fkey" FOREIGN KEY ("retryOfStudySessionId", "guestPrincipalId") REFERENCES "StudySession"(id, "guestPrincipalId") ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- FK CONSTRAINT: StudySession StudySession_retryOfStudySessionId_userId_fkey
ALTER TABLE ONLY "StudySession"
    ADD CONSTRAINT "StudySession_retryOfStudySessionId_userId_fkey" FOREIGN KEY ("retryOfStudySessionId", "userId") REFERENCES "StudySession"(id, "userId") ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- FK CONSTRAINT: StudySession StudySession_userId_fkey
ALTER TABLE ONLY "StudySession"
    ADD CONSTRAINT "StudySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;

-- FK CONSTRAINT: TagApplicability TagApplicability_tagId_fkey
ALTER TABLE ONLY "TagApplicability"
    ADD CONSTRAINT "TagApplicability_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"(id) ON DELETE RESTRICT;

-- FK CONSTRAINT: UserAccountRestrictionEvent UserAccountRestrictionEvent_actorUserId_fkey
ALTER TABLE ONLY "UserAccountRestrictionEvent"
    ADD CONSTRAINT "UserAccountRestrictionEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"(id) ON DELETE SET NULL;

-- FK CONSTRAINT: UserAccountRestrictionEvent UserAccountRestrictionEvent_userId_fkey
ALTER TABLE ONLY "UserAccountRestrictionEvent"
    ADD CONSTRAINT "UserAccountRestrictionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;

-- FK CONSTRAINT: UserAccountRestriction UserAccountRestriction_userId_fkey
ALTER TABLE ONLY "UserAccountRestriction"
    ADD CONSTRAINT "UserAccountRestriction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;

-- FK CONSTRAINT: UserMemo UserMemo_wrongNoteId_fkey
ALTER TABLE ONLY "UserMemo"
    ADD CONSTRAINT "UserMemo_wrongNoteId_fkey" FOREIGN KEY ("wrongNoteId") REFERENCES "WrongNote"(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT: UserReport UserReport_question_version_fkey
ALTER TABLE ONLY "UserReport"
    ADD CONSTRAINT "UserReport_question_version_fkey" FOREIGN KEY ("questionId", "questionVersionId") REFERENCES "QuestionVersion"("questionId", id) ON DELETE RESTRICT;

-- FK CONSTRAINT: UserReport UserReport_reporterUserId_fkey
ALTER TABLE ONLY "UserReport"
    ADD CONSTRAINT "UserReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"(id) ON DELETE SET NULL;

-- FK CONSTRAINT: Verification Verification_resetUserId_fkey
ALTER TABLE ONLY "Verification"
    ADD CONSTRAINT "Verification_resetUserId_fkey" FOREIGN KEY ("resetUserId") REFERENCES "User"(id) ON DELETE RESTRICT;

-- FK CONSTRAINT: WrongNote WrongNote_questionId_currentReviewQuestionVersionId_fkey
ALTER TABLE ONLY "WrongNote"
    ADD CONSTRAINT "WrongNote_questionId_currentReviewQuestionVersionId_fkey" FOREIGN KEY ("questionId", "currentReviewQuestionVersionId") REFERENCES "QuestionVersion"("questionId", id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- FK CONSTRAINT: WrongNote WrongNote_questionId_fkey
ALTER TABLE ONLY "WrongNote"
    ADD CONSTRAINT "WrongNote_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- FK CONSTRAINT: WrongNote WrongNote_questionId_lastWrongQuestionVersionId_fkey
ALTER TABLE ONLY "WrongNote"
    ADD CONSTRAINT "WrongNote_questionId_lastWrongQuestionVersionId_fkey" FOREIGN KEY ("questionId", "lastWrongQuestionVersionId") REFERENCES "QuestionVersion"("questionId", id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- FK CONSTRAINT: WrongNote WrongNote_userId_fkey
ALTER TABLE ONLY "WrongNote"
    ADD CONSTRAINT "WrongNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;

-- ROW SECURITY: _prisma_migrations
ALTER TABLE _prisma_migrations ENABLE ROW LEVEL SECURITY;

-- POLICY: _prisma_migrations ledger_app_read
CREATE POLICY ledger_app_read ON _prisma_migrations FOR SELECT TO nihongo_app USING (true);

-- POLICY: _prisma_migrations ledger_full_access
CREATE POLICY ledger_full_access ON _prisma_migrations TO nihongo_migration USING (true) WITH CHECK (true);

-- ACL: TYPE "AccountActorLabel"
REVOKE ALL ON TYPE "AccountActorLabel" FROM PUBLIC;
GRANT ALL ON TYPE "AccountActorLabel" TO nihongo_migration;
GRANT ALL ON TYPE "AccountActorLabel" TO nihongo_app;

-- ACL: TYPE "AdminAuditCommand"
REVOKE ALL ON TYPE "AdminAuditCommand" FROM PUBLIC;
GRANT ALL ON TYPE "AdminAuditCommand" TO nihongo_migration;
GRANT ALL ON TYPE "AdminAuditCommand" TO nihongo_app;

-- ACL: TYPE "AdminAuditEnvironment"
REVOKE ALL ON TYPE "AdminAuditEnvironment" FROM PUBLIC;
GRANT ALL ON TYPE "AdminAuditEnvironment" TO nihongo_migration;
GRANT ALL ON TYPE "AdminAuditEnvironment" TO nihongo_app;

-- ACL: TYPE "AdminAuditTargetType"
REVOKE ALL ON TYPE "AdminAuditTargetType" FROM PUBLIC;
GRANT ALL ON TYPE "AdminAuditTargetType" TO nihongo_migration;
GRANT ALL ON TYPE "AdminAuditTargetType" TO nihongo_app;

-- ACL: TYPE "AuthSessionIssuerProtocolVersion"
REVOKE ALL ON TYPE "AuthSessionIssuerProtocolVersion" FROM PUBLIC;
GRANT ALL ON TYPE "AuthSessionIssuerProtocolVersion" TO nihongo_migration;
GRANT ALL ON TYPE "AuthSessionIssuerProtocolVersion" TO nihongo_app;

-- ACL: TYPE "AuthVerificationPurpose"
REVOKE ALL ON TYPE "AuthVerificationPurpose" FROM PUBLIC;
GRANT ALL ON TYPE "AuthVerificationPurpose" TO nihongo_migration;
GRANT ALL ON TYPE "AuthVerificationPurpose" TO nihongo_app;

-- ACL: TYPE "ContentReviewAction"
REVOKE ALL ON TYPE "ContentReviewAction" FROM PUBLIC;
GRANT ALL ON TYPE "ContentReviewAction" TO nihongo_migration;
GRANT ALL ON TYPE "ContentReviewAction" TO nihongo_app;

-- ACL: TYPE "CreatorLabelSnapshot"
REVOKE ALL ON TYPE "CreatorLabelSnapshot" FROM PUBLIC;
GRANT ALL ON TYPE "CreatorLabelSnapshot" TO nihongo_migration;
GRANT ALL ON TYPE "CreatorLabelSnapshot" TO nihongo_app;

-- ACL: TYPE "EvidenceActorKind"
REVOKE ALL ON TYPE "EvidenceActorKind" FROM PUBLIC;
GRANT ALL ON TYPE "EvidenceActorKind" TO nihongo_migration;
GRANT ALL ON TYPE "EvidenceActorKind" TO nihongo_app;

-- ACL: TYPE "EvidenceActorRole"
REVOKE ALL ON TYPE "EvidenceActorRole" FROM PUBLIC;
GRANT ALL ON TYPE "EvidenceActorRole" TO nihongo_migration;
GRANT ALL ON TYPE "EvidenceActorRole" TO nihongo_app;

-- ACL: TYPE "IdempotencyOperation"
REVOKE ALL ON TYPE "IdempotencyOperation" FROM PUBLIC;
GRANT ALL ON TYPE "IdempotencyOperation" TO nihongo_migration;
GRANT ALL ON TYPE "IdempotencyOperation" TO nihongo_app;

-- ACL: TYPE "IdempotencyPrincipalType"
REVOKE ALL ON TYPE "IdempotencyPrincipalType" FROM PUBLIC;
GRANT ALL ON TYPE "IdempotencyPrincipalType" TO nihongo_migration;
GRANT ALL ON TYPE "IdempotencyPrincipalType" TO nihongo_app;

-- ACL: TYPE "IdempotencyState"
REVOKE ALL ON TYPE "IdempotencyState" FROM PUBLIC;
GRANT ALL ON TYPE "IdempotencyState" TO nihongo_migration;
GRANT ALL ON TYPE "IdempotencyState" TO nihongo_app;

-- ACL: TYPE "JlptLevel"
REVOKE ALL ON TYPE "JlptLevel" FROM PUBLIC;
GRANT ALL ON TYPE "JlptLevel" TO nihongo_migration;
GRANT ALL ON TYPE "JlptLevel" TO nihongo_app;

-- ACL: TYPE "QuestionDifficulty"
REVOKE ALL ON TYPE "QuestionDifficulty" FROM PUBLIC;
GRANT ALL ON TYPE "QuestionDifficulty" TO nihongo_migration;
GRANT ALL ON TYPE "QuestionDifficulty" TO nihongo_app;

-- ACL: TYPE "QuestionLifecycleStatus"
REVOKE ALL ON TYPE "QuestionLifecycleStatus" FROM PUBLIC;
GRANT ALL ON TYPE "QuestionLifecycleStatus" TO nihongo_migration;
GRANT ALL ON TYPE "QuestionLifecycleStatus" TO nihongo_app;

-- ACL: TYPE "QuestionReportReason"
REVOKE ALL ON TYPE "QuestionReportReason" FROM PUBLIC;
GRANT ALL ON TYPE "QuestionReportReason" TO nihongo_migration;
GRANT ALL ON TYPE "QuestionReportReason" TO nihongo_app;

-- ACL: TYPE "QuestionReportResolutionOutcome"
REVOKE ALL ON TYPE "QuestionReportResolutionOutcome" FROM PUBLIC;
GRANT ALL ON TYPE "QuestionReportResolutionOutcome" TO nihongo_migration;
GRANT ALL ON TYPE "QuestionReportResolutionOutcome" TO nihongo_app;

-- ACL: TYPE "QuestionReportStatus"
REVOKE ALL ON TYPE "QuestionReportStatus" FROM PUBLIC;
GRANT ALL ON TYPE "QuestionReportStatus" TO nihongo_migration;
GRANT ALL ON TYPE "QuestionReportStatus" TO nihongo_app;

-- ACL: TYPE "QuestionSourceType"
REVOKE ALL ON TYPE "QuestionSourceType" FROM PUBLIC;
GRANT ALL ON TYPE "QuestionSourceType" TO nihongo_migration;
GRANT ALL ON TYPE "QuestionSourceType" TO nihongo_app;

-- ACL: TYPE "QuestionSubject"
REVOKE ALL ON TYPE "QuestionSubject" FROM PUBLIC;
GRANT ALL ON TYPE "QuestionSubject" TO nihongo_migration;
GRANT ALL ON TYPE "QuestionSubject" TO nihongo_app;

-- ACL: TYPE "QuestionType"
REVOKE ALL ON TYPE "QuestionType" FROM PUBLIC;
GRANT ALL ON TYPE "QuestionType" TO nihongo_migration;
GRANT ALL ON TYPE "QuestionType" TO nihongo_app;

-- ACL: TYPE "QuestionVersionStatus"
REVOKE ALL ON TYPE "QuestionVersionStatus" FROM PUBLIC;
GRANT ALL ON TYPE "QuestionVersionStatus" TO nihongo_migration;
GRANT ALL ON TYPE "QuestionVersionStatus" TO nihongo_app;

-- ACL: TYPE "RetirementKind"
REVOKE ALL ON TYPE "RetirementKind" FROM PUBLIC;
GRANT ALL ON TYPE "RetirementKind" TO nihongo_migration;
GRANT ALL ON TYPE "RetirementKind" TO nihongo_app;

-- ACL: TYPE "ReviewEventSource"
REVOKE ALL ON TYPE "ReviewEventSource" FROM PUBLIC;
GRANT ALL ON TYPE "ReviewEventSource" TO nihongo_migration;
GRANT ALL ON TYPE "ReviewEventSource" TO nihongo_app;

-- ACL: TYPE "StudyMode"
REVOKE ALL ON TYPE "StudyMode" FROM PUBLIC;
GRANT ALL ON TYPE "StudyMode" TO nihongo_migration;
GRANT ALL ON TYPE "StudyMode" TO nihongo_app;

-- ACL: TYPE "StudySessionFallbackReason"
REVOKE ALL ON TYPE "StudySessionFallbackReason" FROM PUBLIC;
GRANT ALL ON TYPE "StudySessionFallbackReason" TO nihongo_migration;
GRANT ALL ON TYPE "StudySessionFallbackReason" TO nihongo_app;

-- ACL: TYPE "StudySessionStatus"
REVOKE ALL ON TYPE "StudySessionStatus" FROM PUBLIC;
GRANT ALL ON TYPE "StudySessionStatus" TO nihongo_migration;
GRANT ALL ON TYPE "StudySessionStatus" TO nihongo_app;

-- ACL: TYPE "SystemActorLabel"
REVOKE ALL ON TYPE "SystemActorLabel" FROM PUBLIC;
GRANT ALL ON TYPE "SystemActorLabel" TO nihongo_migration;
GRANT ALL ON TYPE "SystemActorLabel" TO nihongo_app;

-- ACL: TYPE "UserAccountStatus"
REVOKE ALL ON TYPE "UserAccountStatus" FROM PUBLIC;
GRANT ALL ON TYPE "UserAccountStatus" TO nihongo_migration;
GRANT ALL ON TYPE "UserAccountStatus" TO nihongo_app;

-- ACL: TYPE "UserRole"
REVOKE ALL ON TYPE "UserRole" FROM PUBLIC;
GRANT ALL ON TYPE "UserRole" TO nihongo_migration;
GRANT ALL ON TYPE "UserRole" TO nihongo_app;

-- ACL: TYPE "WrongNoteStatus"
REVOKE ALL ON TYPE "WrongNoteStatus" FROM PUBLIC;
GRANT ALL ON TYPE "WrongNoteStatus" TO nihongo_migration;
GRANT ALL ON TYPE "WrongNoteStatus" TO nihongo_app;

-- ACL: FUNCTION limit_authority_revocation_evidence_delete()
REVOKE ALL ON FUNCTION limit_authority_revocation_evidence_delete() FROM PUBLIC;

-- ACL: FUNCTION limit_operation_intent_delete()
REVOKE ALL ON FUNCTION limit_operation_intent_delete() FROM PUBLIC;

-- ACL: FUNCTION limit_reauthentication_intent_delete()
REVOKE ALL ON FUNCTION limit_reauthentication_intent_delete() FROM PUBLIC;

-- ACL: FUNCTION limit_user_delete()
REVOKE ALL ON FUNCTION limit_user_delete() FROM PUBLIC;

-- ACL: FUNCTION limit_sso_account_erasure_request_update()
REVOKE ALL ON FUNCTION limit_sso_account_erasure_request_update() FROM PUBLIC;

-- ACL: FUNCTION limit_sso_admin_fresh_proof_delete()
REVOKE ALL ON FUNCTION limit_sso_admin_fresh_proof_delete() FROM PUBLIC;

-- ACL: FUNCTION limit_sso_admin_fresh_transaction_delete()
REVOKE ALL ON FUNCTION limit_sso_admin_fresh_transaction_delete() FROM PUBLIC;

-- ACL: FUNCTION bootstrap_first_google_admin(target_user_id uuid, google_subject text, expected_generation integer, expected_schema text, environment_value 4cb4dbc64b0d4bb3b66579d8a108a534_test."AdminAuditEnvironment")
REVOKE ALL ON FUNCTION bootstrap_first_google_admin(target_user_id uuid, google_subject text, expected_generation integer, expected_schema text, environment_value "AdminAuditEnvironment") FROM PUBLIC;
GRANT ALL ON FUNCTION bootstrap_first_google_admin(target_user_id uuid, google_subject text, expected_generation integer, expected_schema text, environment_value "AdminAuditEnvironment") TO nihongo_migration;

-- ACL: FUNCTION classify_admin_authority(raw_token text)
REVOKE ALL ON FUNCTION classify_admin_authority(raw_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION classify_admin_authority(raw_token text) TO nihongo_app;

-- ACL: FUNCTION consume_sso_transaction_v2(provider_id text, state_digest text, binding_digest text)
REVOKE ALL ON FUNCTION consume_sso_transaction_v2(provider_id text, state_digest text, binding_digest text) FROM PUBLIC;
GRANT ALL ON FUNCTION consume_sso_transaction_v2(provider_id text, state_digest text, binding_digest text) TO nihongo_app;

-- ACL: FUNCTION create_sso_transaction_v2(provider_id text, state_digest text, binding_digest text, nonce_value text, verifier_value text, callback_value text)
REVOKE ALL ON FUNCTION create_sso_transaction_v2(provider_id text, state_digest text, binding_digest text, nonce_value text, verifier_value text, callback_value text) FROM PUBLIC;
GRANT ALL ON FUNCTION create_sso_transaction_v2(provider_id text, state_digest text, binding_digest text, nonce_value text, verifier_value text, callback_value text) TO nihongo_app;

-- ACL: FUNCTION reauthentication_token_digest(raw_token text)
REVOKE ALL ON FUNCTION reauthentication_token_digest(raw_token text) FROM PUBLIC;

-- ACL: FUNCTION record_authority_revocation(target_user_id uuid, reason_value 4cb4dbc64b0d4bb3b66579d8a108a534_test."AuthorityRevocationReason")
REVOKE ALL ON FUNCTION record_authority_revocation(target_user_id uuid, reason_value "AuthorityRevocationReason") FROM PUBLIC;

-- ACL: FUNCTION require_caller_role(required_role text)
REVOKE ALL ON FUNCTION require_caller_role(required_role text) FROM PUBLIC;

-- ACL: FUNCTION require_database_capability(environment_value 4cb4dbc64b0d4bb3b66579d8a108a534_test."AdminAuditEnvironment")
REVOKE ALL ON FUNCTION require_database_capability(environment_value "AdminAuditEnvironment") FROM PUBLIC;
GRANT ALL ON FUNCTION require_database_capability(environment_value "AdminAuditEnvironment") TO nihongo_app;

-- ACL: FUNCTION require_runtime_ready()
REVOKE ALL ON FUNCTION require_runtime_ready() FROM PUBLIC;
GRANT ALL ON FUNCTION require_runtime_ready() TO nihongo_app;

-- ACL: FUNCTION resolve_sso_identity(provider_id text, provider_subject text, contact_email text, display_name text)
REVOKE ALL ON FUNCTION resolve_sso_identity(provider_id text, provider_subject text, contact_email text, display_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION resolve_sso_identity(provider_id text, provider_subject text, contact_email text, display_name text) TO nihongo_app;

-- ACL: FUNCTION user_erasure_confirmed(target_user_id uuid)
REVOKE ALL ON FUNCTION user_erasure_confirmed(target_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION user_erasure_confirmed(target_user_id uuid) TO nihongo_app;

-- ACL: FUNCTION prepare_sso_account_erasure_request()
REVOKE ALL ON FUNCTION prepare_sso_account_erasure_request() FROM PUBLIC;

-- ACL: FUNCTION protect_account()
REVOKE ALL ON FUNCTION protect_account() FROM PUBLIC;

-- ACL: FUNCTION redact_user_report_on_reporter_erasure()
REVOKE ALL ON FUNCTION redact_user_report_on_reporter_erasure() FROM PUBLIC;

-- ACL: FUNCTION reject_unfinished_operation()
REVOKE ALL ON FUNCTION reject_unfinished_operation() FROM PUBLIC;

-- ACL: FUNCTION validate_credential_totality()
REVOKE ALL ON FUNCTION validate_credential_totality() FROM PUBLIC;

-- ACL: FUNCTION validate_inserted_tag_snapshots()
REVOKE ALL ON FUNCTION validate_inserted_tag_snapshots() FROM PUBLIC;

-- ACL: FUNCTION validate_question_report_remediation()
REVOKE ALL ON FUNCTION validate_question_report_remediation() FROM PUBLIC;

-- ACL: FUNCTION validate_session_write()
REVOKE ALL ON FUNCTION validate_session_write() FROM PUBLIC;

-- ACL: FUNCTION validate_user_change()
REVOKE ALL ON FUNCTION validate_user_change() FROM PUBLIC;

-- ACL: FUNCTION validate_verification_write()
REVOKE ALL ON FUNCTION validate_verification_write() FROM PUBLIC;

-- ACL: TABLE "Account"
GRANT DELETE ON TABLE "Account" TO nihongo_app;

-- ACL: COLUMN "Account".id
GRANT SELECT(id),INSERT(id) ON TABLE "Account" TO nihongo_app;

-- ACL: COLUMN "Account"."accountId"
GRANT SELECT("accountId"),INSERT("accountId") ON TABLE "Account" TO nihongo_app;

-- ACL: COLUMN "Account"."providerId"
GRANT SELECT("providerId"),INSERT("providerId") ON TABLE "Account" TO nihongo_app;

-- ACL: COLUMN "Account"."userId"
GRANT SELECT("userId"),INSERT("userId") ON TABLE "Account" TO nihongo_app;

-- ACL: COLUMN "Account"."createdAt"
GRANT INSERT("createdAt"),UPDATE("createdAt") ON TABLE "Account" TO nihongo_app;

-- ACL: COLUMN "Account"."updatedAt"
GRANT INSERT("updatedAt") ON TABLE "Account" TO nihongo_app;

-- ACL: TABLE "AdminAuditLog"
GRANT SELECT,INSERT ON TABLE "AdminAuditLog" TO nihongo_app;

-- ACL: COLUMN "AdminAuditLog"."actorUserId"
GRANT UPDATE("actorUserId") ON TABLE "AdminAuditLog" TO nihongo_app;

-- ACL: COLUMN "AdminAuditLog"."actorLabel"
GRANT UPDATE("actorLabel") ON TABLE "AdminAuditLog" TO nihongo_app;

-- ACL: TABLE "Bookmark"
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "Bookmark" TO nihongo_app;

-- ACL: TABLE "ContentReview"
GRANT SELECT,INSERT ON TABLE "ContentReview" TO nihongo_app;

-- ACL: COLUMN "ContentReview"."actorUserId"
GRANT UPDATE("actorUserId") ON TABLE "ContentReview" TO nihongo_app;

-- ACL: COLUMN "ContentReview"."actorLabel"
GRANT UPDATE("actorLabel") ON TABLE "ContentReview" TO nihongo_app;

-- ACL: COLUMN "ContentReview"."counterpartUserId"
GRANT UPDATE("counterpartUserId") ON TABLE "ContentReview" TO nihongo_app;

-- ACL: COLUMN "ContentReview"."counterpartLabel"
GRANT UPDATE("counterpartLabel") ON TABLE "ContentReview" TO nihongo_app;

-- ACL: TABLE "GuestPrincipal"
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "GuestPrincipal" TO nihongo_app;

-- ACL: TABLE "IdempotencyRecord"
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "IdempotencyRecord" TO nihongo_app;

-- ACL: TABLE "AuthorityRevocationEvidence"
GRANT DELETE ON TABLE "AuthorityRevocationEvidence" TO nihongo_app;

-- ACL: COLUMN "AuthorityRevocationEvidence"."tokenDigest"
GRANT SELECT("tokenDigest") ON TABLE "AuthorityRevocationEvidence" TO nihongo_app;

-- ACL: COLUMN "AuthorityRevocationEvidence"."expiresAt"
GRANT SELECT("expiresAt") ON TABLE "AuthorityRevocationEvidence" TO nihongo_app;

-- ACL: TABLE "DatabaseCapability"
GRANT ALL ON TABLE "DatabaseCapability" TO nihongo_migration;

-- ACL: COLUMN "DatabaseCapability".id
GRANT SELECT(id) ON TABLE "DatabaseCapability" TO nihongo_app;

-- ACL: COLUMN "DatabaseCapability".environment
GRANT SELECT(environment) ON TABLE "DatabaseCapability" TO nihongo_app;

-- ACL: TABLE "OperationIntent"
GRANT ALL ON TABLE "OperationIntent" TO nihongo_migration;
GRANT DELETE ON TABLE "OperationIntent" TO nihongo_app;

-- ACL: COLUMN "OperationIntent"."operationId"
GRANT SELECT("operationId"),INSERT("operationId") ON TABLE "OperationIntent" TO nihongo_app;

-- ACL: COLUMN "OperationIntent".command
GRANT INSERT(command) ON TABLE "OperationIntent" TO nihongo_app;

-- ACL: COLUMN "OperationIntent".environment
GRANT INSERT(environment) ON TABLE "OperationIntent" TO nihongo_app;

-- ACL: TABLE "ReauthenticationIntent"
GRANT DELETE ON TABLE "ReauthenticationIntent" TO nihongo_app;

-- ACL: COLUMN "ReauthenticationIntent".id
GRANT SELECT(id),INSERT(id) ON TABLE "ReauthenticationIntent" TO nihongo_app;

-- ACL: COLUMN "ReauthenticationIntent"."operationId"
GRANT SELECT("operationId"),INSERT("operationId") ON TABLE "ReauthenticationIntent" TO nihongo_app;

-- ACL: COLUMN "ReauthenticationIntent"."requestId"
GRANT SELECT("requestId"),INSERT("requestId") ON TABLE "ReauthenticationIntent" TO nihongo_app;

-- ACL: COLUMN "ReauthenticationIntent"."userId"
GRANT SELECT("userId"),INSERT("userId") ON TABLE "ReauthenticationIntent" TO nihongo_app;

-- ACL: COLUMN "ReauthenticationIntent"."oldSessionId"
GRANT SELECT("oldSessionId"),INSERT("oldSessionId") ON TABLE "ReauthenticationIntent" TO nihongo_app;

-- ACL: COLUMN "ReauthenticationIntent"."oldTokenDigest"
GRANT SELECT("oldTokenDigest"),INSERT("oldTokenDigest") ON TABLE "ReauthenticationIntent" TO nihongo_app;

-- ACL: COLUMN "ReauthenticationIntent"."capturedAuthorityGeneration"
GRANT SELECT("capturedAuthorityGeneration"),INSERT("capturedAuthorityGeneration") ON TABLE "ReauthenticationIntent" TO nihongo_app;

-- ACL: COLUMN "ReauthenticationIntent"."capturedRole"
GRANT SELECT("capturedRole"),INSERT("capturedRole") ON TABLE "ReauthenticationIntent" TO nihongo_app;

-- ACL: COLUMN "ReauthenticationIntent"."capturedAccountStatus"
GRANT SELECT("capturedAccountStatus"),INSERT("capturedAccountStatus") ON TABLE "ReauthenticationIntent" TO nihongo_app;

-- ACL: COLUMN "ReauthenticationIntent".state
GRANT SELECT(state),INSERT(state),UPDATE(state) ON TABLE "ReauthenticationIntent" TO nihongo_app;

-- ACL: COLUMN "ReauthenticationIntent"."stagedSessionId"
GRANT SELECT("stagedSessionId"),UPDATE("stagedSessionId") ON TABLE "ReauthenticationIntent" TO nihongo_app;

-- ACL: COLUMN "ReauthenticationIntent"."stagedTokenDigest"
GRANT SELECT("stagedTokenDigest"),UPDATE("stagedTokenDigest") ON TABLE "ReauthenticationIntent" TO nihongo_app;

-- ACL: COLUMN "ReauthenticationIntent".environment
GRANT SELECT(environment),INSERT(environment) ON TABLE "ReauthenticationIntent" TO nihongo_app;

-- ACL: COLUMN "ReauthenticationIntent"."createdAt"
GRANT INSERT("createdAt") ON TABLE "ReauthenticationIntent" TO nihongo_app;

-- ACL: COLUMN "ReauthenticationIntent"."expiresAt"
GRANT SELECT("expiresAt"),INSERT("expiresAt") ON TABLE "ReauthenticationIntent" TO nihongo_app;

-- ACL: COLUMN "ReauthenticationIntent"."finalizedAt"
GRANT SELECT("finalizedAt"),UPDATE("finalizedAt") ON TABLE "ReauthenticationIntent" TO nihongo_app;

-- ACL: TABLE "Question"
GRANT SELECT,INSERT,UPDATE ON TABLE "Question" TO nihongo_app;

-- ACL: TABLE "QuestionImportResult"
GRANT SELECT,INSERT ON TABLE "QuestionImportResult" TO nihongo_app;

-- ACL: TABLE "QuestionOption"
GRANT SELECT,INSERT,UPDATE ON TABLE "QuestionOption" TO nihongo_app;

-- ACL: TABLE "QuestionReport"
GRANT SELECT,UPDATE ON TABLE "QuestionReport" TO nihongo_app;

-- ACL: COLUMN "QuestionReport".id
GRANT INSERT(id) ON TABLE "QuestionReport" TO nihongo_app;

-- ACL: COLUMN "QuestionReport"."questionId"
GRANT INSERT("questionId") ON TABLE "QuestionReport" TO nihongo_app;

-- ACL: COLUMN "QuestionReport"."questionVersionId"
GRANT INSERT("questionVersionId") ON TABLE "QuestionReport" TO nihongo_app;

-- ACL: COLUMN "QuestionReport".reason
GRANT INSERT(reason) ON TABLE "QuestionReport" TO nihongo_app;

-- ACL: COLUMN "QuestionReport".description
GRANT INSERT(description) ON TABLE "QuestionReport" TO nihongo_app;

-- ACL: COLUMN "QuestionReport"."reporterUserId"
GRANT INSERT("reporterUserId") ON TABLE "QuestionReport" TO nihongo_app;

-- ACL: TABLE "QuestionVersion"
GRANT SELECT,INSERT,UPDATE ON TABLE "QuestionVersion" TO nihongo_app;

-- ACL: TABLE "QuestionVersionTag"
GRANT SELECT,INSERT,DELETE ON TABLE "QuestionVersionTag" TO nihongo_app;

-- ACL: TABLE "RateLimit"
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "RateLimit" TO nihongo_app;

-- ACL: TABLE "ReviewEvent"
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ReviewEvent" TO nihongo_app;

-- ACL: TABLE "ReviewSchedule"
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "ReviewSchedule" TO nihongo_app;

-- ACL: TABLE "Session"
GRANT DELETE ON TABLE "Session" TO nihongo_app;

-- ACL: COLUMN "Session".id
GRANT SELECT(id),INSERT(id) ON TABLE "Session" TO nihongo_app;

-- ACL: COLUMN "Session"."expiresAt"
GRANT SELECT("expiresAt"),INSERT("expiresAt"),UPDATE("expiresAt") ON TABLE "Session" TO nihongo_app;

-- ACL: COLUMN "Session".token
GRANT SELECT(token),INSERT(token) ON TABLE "Session" TO nihongo_app;

-- ACL: COLUMN "Session"."createdAt"
GRANT SELECT("createdAt"),INSERT("createdAt") ON TABLE "Session" TO nihongo_app;

-- ACL: COLUMN "Session"."updatedAt"
GRANT SELECT("updatedAt"),INSERT("updatedAt"),UPDATE("updatedAt") ON TABLE "Session" TO nihongo_app;

-- ACL: COLUMN "Session"."ipAddress"
GRANT INSERT("ipAddress") ON TABLE "Session" TO nihongo_app;

-- ACL: COLUMN "Session"."userAgent"
GRANT INSERT("userAgent") ON TABLE "Session" TO nihongo_app;

-- ACL: COLUMN "Session"."userId"
GRANT SELECT("userId"),INSERT("userId") ON TABLE "Session" TO nihongo_app;

-- ACL: COLUMN "Session"."authorityGeneration"
GRANT SELECT("authorityGeneration"),INSERT("authorityGeneration") ON TABLE "Session" TO nihongo_app;

-- ACL: COLUMN "Session"."issuerProtocolVersion"
GRANT SELECT("issuerProtocolVersion"),INSERT("issuerProtocolVersion") ON TABLE "Session" TO nihongo_app;

-- ACL: COLUMN "Session"."authorizationState"
GRANT SELECT("authorizationState"),INSERT("authorizationState"),UPDATE("authorizationState") ON TABLE "Session" TO nihongo_app;

-- ACL: COLUMN "SsoAccountErasureRequest".id
GRANT SELECT(id) ON TABLE "SsoAccountErasureRequest" TO nihongo_app;

-- ACL: COLUMN "SsoAccountErasureRequest"."userId"
GRANT SELECT("userId"),INSERT("userId") ON TABLE "SsoAccountErasureRequest" TO nihongo_app;

-- ACL: COLUMN "SsoAccountErasureRequest"."receiptDigest"
GRANT SELECT("receiptDigest"),INSERT("receiptDigest") ON TABLE "SsoAccountErasureRequest" TO nihongo_app;

-- ACL: COLUMN "SsoAccountErasureRequest"."appStatus"
GRANT SELECT("appStatus"),UPDATE("appStatus") ON TABLE "SsoAccountErasureRequest" TO nihongo_app;

-- ACL: COLUMN "SsoAccountErasureRequest"."providerCleanup"
GRANT SELECT("providerCleanup"),INSERT("providerCleanup"),UPDATE("providerCleanup") ON TABLE "SsoAccountErasureRequest" TO nihongo_app;

-- ACL: COLUMN "SsoAccountErasureRequest"."createdAt"
GRANT SELECT("createdAt") ON TABLE "SsoAccountErasureRequest" TO nihongo_app;

-- ACL: COLUMN "SsoAccountErasureRequest"."receiptExpiresAt"
GRANT SELECT("receiptExpiresAt"),INSERT("receiptExpiresAt") ON TABLE "SsoAccountErasureRequest" TO nihongo_app;

-- ACL: COLUMN "SsoAccountErasureRequest"."completedAt"
GRANT UPDATE("completedAt") ON TABLE "SsoAccountErasureRequest" TO nihongo_app;

-- ACL: COLUMN "SsoAccountErasureRequest"."leaseExpiresAt"
GRANT SELECT("leaseExpiresAt"),UPDATE("leaseExpiresAt") ON TABLE "SsoAccountErasureRequest" TO nihongo_app;

-- ACL: COLUMN "SsoAccountErasureRequest"."leaseToken"
GRANT SELECT("leaseToken"),UPDATE("leaseToken") ON TABLE "SsoAccountErasureRequest" TO nihongo_app;

-- ACL: COLUMN "SsoAccountErasureRequest"."activeProvider"
GRANT SELECT("activeProvider"),UPDATE("activeProvider") ON TABLE "SsoAccountErasureRequest" TO nihongo_app;

-- ACL: TABLE "SsoAccountFreshProof"
GRANT DELETE ON TABLE "SsoAccountFreshProof" TO nihongo_app;

-- ACL: COLUMN "SsoAccountFreshProof"."proofDigest"
GRANT SELECT("proofDigest"),INSERT("proofDigest") ON TABLE "SsoAccountFreshProof" TO nihongo_app;

-- ACL: COLUMN "SsoAccountFreshProof".context
GRANT SELECT(context),INSERT(context) ON TABLE "SsoAccountFreshProof" TO nihongo_app;

-- ACL: COLUMN "SsoAccountFreshProof"."userId"
GRANT SELECT("userId"),INSERT("userId") ON TABLE "SsoAccountFreshProof" TO nihongo_app;

-- ACL: COLUMN "SsoAccountFreshProof"."callbackURL"
GRANT SELECT("callbackURL"),INSERT("callbackURL") ON TABLE "SsoAccountFreshProof" TO nihongo_app;

-- ACL: COLUMN "SsoAccountFreshProof"."createdAt"
GRANT SELECT("createdAt"),INSERT("createdAt") ON TABLE "SsoAccountFreshProof" TO nihongo_app;

-- ACL: COLUMN "SsoAccountFreshProof"."expiresAt"
GRANT SELECT("expiresAt"),INSERT("expiresAt"),UPDATE("expiresAt") ON TABLE "SsoAccountFreshProof" TO nihongo_app;

-- ACL: COLUMN "SsoAccountFreshProof"."verifiedAt"
GRANT SELECT("verifiedAt"),UPDATE("verifiedAt") ON TABLE "SsoAccountFreshProof" TO nihongo_app;

-- ACL: TABLE "SsoAccountFreshTransaction"
GRANT DELETE ON TABLE "SsoAccountFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAccountFreshTransaction"."stateDigest"
GRANT SELECT("stateDigest"),INSERT("stateDigest") ON TABLE "SsoAccountFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAccountFreshTransaction"."bindingDigest"
GRANT SELECT("bindingDigest"),INSERT("bindingDigest") ON TABLE "SsoAccountFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAccountFreshTransaction".provider
GRANT SELECT(provider),INSERT(provider) ON TABLE "SsoAccountFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAccountFreshTransaction".nonce
GRANT SELECT(nonce),INSERT(nonce) ON TABLE "SsoAccountFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAccountFreshTransaction"."codeVerifier"
GRANT SELECT("codeVerifier"),INSERT("codeVerifier") ON TABLE "SsoAccountFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAccountFreshTransaction"."callbackURL"
GRANT SELECT("callbackURL"),INSERT("callbackURL") ON TABLE "SsoAccountFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAccountFreshTransaction".context
GRANT SELECT(context),INSERT(context) ON TABLE "SsoAccountFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAccountFreshTransaction"."userId"
GRANT SELECT("userId"),INSERT("userId") ON TABLE "SsoAccountFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAccountFreshTransaction"."createdAt"
GRANT INSERT("createdAt") ON TABLE "SsoAccountFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAccountFreshTransaction"."expiresAt"
GRANT SELECT("expiresAt"),INSERT("expiresAt") ON TABLE "SsoAccountFreshTransaction" TO nihongo_app;

-- ACL: TABLE "SsoAdminFreshProof"
GRANT DELETE ON TABLE "SsoAdminFreshProof" TO nihongo_app;

-- ACL: COLUMN "SsoAdminFreshProof"."proofDigest"
GRANT SELECT("proofDigest"),INSERT("proofDigest") ON TABLE "SsoAdminFreshProof" TO nihongo_app;

-- ACL: COLUMN "SsoAdminFreshProof".context
GRANT SELECT(context),INSERT(context) ON TABLE "SsoAdminFreshProof" TO nihongo_app;

-- ACL: COLUMN "SsoAdminFreshProof"."callbackURL"
GRANT SELECT("callbackURL"),INSERT("callbackURL") ON TABLE "SsoAdminFreshProof" TO nihongo_app;

-- ACL: COLUMN "SsoAdminFreshProof"."createdAt"
GRANT INSERT("createdAt") ON TABLE "SsoAdminFreshProof" TO nihongo_app;

-- ACL: COLUMN "SsoAdminFreshProof"."expiresAt"
GRANT SELECT("expiresAt"),INSERT("expiresAt"),UPDATE("expiresAt") ON TABLE "SsoAdminFreshProof" TO nihongo_app;

-- ACL: COLUMN "SsoAdminFreshProof"."completedSessionId"
GRANT SELECT("completedSessionId"),UPDATE("completedSessionId") ON TABLE "SsoAdminFreshProof" TO nihongo_app;

-- ACL: COLUMN "SsoAdminFreshProof"."completedAt"
GRANT SELECT("completedAt"),UPDATE("completedAt") ON TABLE "SsoAdminFreshProof" TO nihongo_app;

-- ACL: COLUMN "SsoAdminFreshProof"."userId"
GRANT INSERT("userId") ON TABLE "SsoAdminFreshProof" TO nihongo_app;

-- ACL: TABLE "SsoAdminFreshTransaction"
GRANT DELETE ON TABLE "SsoAdminFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAdminFreshTransaction"."stateDigest"
GRANT SELECT("stateDigest"),INSERT("stateDigest") ON TABLE "SsoAdminFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAdminFreshTransaction"."bindingDigest"
GRANT SELECT("bindingDigest"),INSERT("bindingDigest") ON TABLE "SsoAdminFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAdminFreshTransaction".provider
GRANT SELECT(provider),INSERT(provider) ON TABLE "SsoAdminFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAdminFreshTransaction".nonce
GRANT SELECT(nonce),INSERT(nonce) ON TABLE "SsoAdminFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAdminFreshTransaction"."codeVerifier"
GRANT SELECT("codeVerifier"),INSERT("codeVerifier") ON TABLE "SsoAdminFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAdminFreshTransaction"."callbackURL"
GRANT SELECT("callbackURL"),INSERT("callbackURL") ON TABLE "SsoAdminFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAdminFreshTransaction".context
GRANT SELECT(context),INSERT(context) ON TABLE "SsoAdminFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAdminFreshTransaction"."createdAt"
GRANT SELECT("createdAt"),INSERT("createdAt") ON TABLE "SsoAdminFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAdminFreshTransaction"."expiresAt"
GRANT SELECT("expiresAt"),INSERT("expiresAt") ON TABLE "SsoAdminFreshTransaction" TO nihongo_app;

-- ACL: COLUMN "SsoAdminFreshTransaction"."userId"
GRANT INSERT("userId") ON TABLE "SsoAdminFreshTransaction" TO nihongo_app;

-- ACL: TABLE "StudyAnswer"
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "StudyAnswer" TO nihongo_app;

-- ACL: TABLE "StudyDraft"
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "StudyDraft" TO nihongo_app;

-- ACL: TABLE "StudyDraftAnswer"
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "StudyDraftAnswer" TO nihongo_app;

-- ACL: TABLE "StudyResult"
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "StudyResult" TO nihongo_app;

-- ACL: TABLE "StudySession"
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "StudySession" TO nihongo_app;

-- ACL: TABLE "StudySessionQuestion"
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "StudySessionQuestion" TO nihongo_app;

-- ACL: TABLE "Tag"
GRANT SELECT ON TABLE "Tag" TO nihongo_app;

-- ACL: TABLE "TagApplicability"
GRANT SELECT ON TABLE "TagApplicability" TO nihongo_app;

-- ACL: TABLE "User"
GRANT DELETE ON TABLE "User" TO nihongo_app;

-- ACL: COLUMN "User".id
GRANT SELECT(id) ON TABLE "User" TO nihongo_app;

-- ACL: COLUMN "User".name
GRANT SELECT(name) ON TABLE "User" TO nihongo_app;

-- ACL: COLUMN "User".email
GRANT SELECT(email) ON TABLE "User" TO nihongo_app;

-- ACL: COLUMN "User"."emailVerified"
GRANT SELECT("emailVerified") ON TABLE "User" TO nihongo_app;

-- ACL: COLUMN "User".role
GRANT SELECT(role) ON TABLE "User" TO nihongo_app;

-- ACL: COLUMN "User"."targetLevel"
GRANT SELECT("targetLevel") ON TABLE "User" TO nihongo_app;

-- ACL: COLUMN "User"."accountStatus"
GRANT SELECT("accountStatus"),UPDATE("accountStatus") ON TABLE "User" TO nihongo_app;

-- ACL: COLUMN "User"."deletedAt"
GRANT SELECT("deletedAt") ON TABLE "User" TO nihongo_app;

-- ACL: COLUMN "User"."createdAt"
GRANT SELECT("createdAt") ON TABLE "User" TO nihongo_app;

-- ACL: COLUMN "User"."authorityGeneration"
GRANT SELECT("authorityGeneration"),UPDATE("authorityGeneration") ON TABLE "User" TO nihongo_app;

-- ACL: TABLE "UserAccountRestriction"
GRANT SELECT,INSERT,DELETE ON TABLE "UserAccountRestriction" TO nihongo_app;

-- ACL: TABLE "UserAccountRestrictionEvent"
GRANT SELECT,INSERT ON TABLE "UserAccountRestrictionEvent" TO nihongo_app;

-- ACL: TABLE "UserMemo"
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "UserMemo" TO nihongo_app;

-- ACL: TABLE "UserReport"
GRANT SELECT,INSERT,UPDATE ON TABLE "UserReport" TO nihongo_app;

-- ACL: TABLE "Verification"
GRANT DELETE ON TABLE "Verification" TO nihongo_app;

-- ACL: COLUMN "Verification".id
GRANT SELECT(id) ON TABLE "Verification" TO nihongo_app;

-- ACL: COLUMN "Verification"."createdAt"
GRANT UPDATE("createdAt") ON TABLE "Verification" TO nihongo_app;

-- ACL: COLUMN "Verification"."resetUserId"
GRANT SELECT("resetUserId") ON TABLE "Verification" TO nihongo_app;

-- ACL: TABLE "WrongNote"
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "WrongNote" TO nihongo_app;

-- ACL: TABLE _prisma_migrations
GRANT SELECT ON TABLE _prisma_migrations TO nihongo_app;
GRANT SELECT,INSERT,UPDATE ON TABLE _prisma_migrations TO nihongo_migration;

-- Every function that ran with a fixed search_path keeps it for the target
-- schema.
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
        'bootstrap_first_google_admin',
        'classify_admin_authority',
        'consume_sso_transaction_v2',
        'create_sso_transaction_v2',
        'limit_account_api_insert',
        'limit_authority_revocation_evidence_delete',
        'limit_operation_intent_delete',
        'limit_reauthentication_intent_delete',
        'limit_sso_account_erasure_request_update',
        'limit_sso_admin_fresh_proof_delete',
        'limit_sso_admin_fresh_transaction_delete',
        'limit_user_delete',
        'prepare_sso_account_erasure_request',
        'protect_account',
        'protect_evidence_history',
        'reauthentication_token_digest',
        'record_authority_revocation',
        'redact_user_report_on_reporter_erasure',
        'reject_unfinished_operation',
        'require_database_capability',
        'require_runtime_ready',
        'resolve_sso_identity',
        'user_erasure_confirmed',
        'validate_credential_totality',
        'validate_inserted_tag_snapshots',
        'validate_question_report_insert',
        'validate_question_report_remediation',
        'validate_session_write',
        'validate_user_change',
        'validate_verification_write'
      ]::NAME[])
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET search_path TO pg_catalog, %I, pg_temp',
      function_oid::REGPROCEDURE, target_schema
    );
  END LOOP;
END;
$fixed_path$;

-- Schema privileges, as the 76 migrations left them for the kept roles.
DO $schema_acl$
DECLARE
  target_schema TEXT := pg_catalog.current_setting('app.target_schema', false);
BEGIN
  EXECUTE pg_catalog.format('GRANT ALL ON SCHEMA %I TO nihongo_migration', target_schema);
  EXECUTE pg_catalog.format(
    'GRANT USAGE ON SCHEMA %I TO nihongo_app, nihongo_guest_cleanup_worker',
    target_schema
  );
END;
$schema_acl$;

SET LOCAL ROLE "nihongo_migration";
COMMIT;
