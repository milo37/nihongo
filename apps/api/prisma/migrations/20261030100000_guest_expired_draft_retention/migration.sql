-- Use the existing canonical migration and owner boundary.
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
    RAISE EXCEPTION 'Guest cleanup migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r
    WHERE r.rolname = 'nihongo_guest_cleanup_worker'
      AND NOT r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper
      AND NOT r.rolcreatedb AND NOT r.rolcreaterole
      AND NOT r.rolreplication AND NOT r.rolbypassrls
  ) THEN
    RAISE EXCEPTION 'Guest cleanup role is absent or unsafe.' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.pg_has_role('nihongo_guest_cleanup_worker', 'nihongo_app', 'MEMBER')
    OR pg_catalog.pg_has_role('nihongo_guest_cleanup_worker', 'nihongo_erasure_worker', 'MEMBER')
    OR pg_catalog.has_schema_privilege('nihongo_guest_cleanup_worker', target_schema, 'CREATE')
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = target_schema AND c.relkind IN ('r', 'p')
        AND pg_catalog.has_table_privilege(
          'nihongo_guest_cleanup_worker', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE'
        )
    ) THEN
    RAISE EXCEPTION 'Guest cleanup role has excessive rights.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

-- Retain only naturally expired guest drafts until bounded cleanup.
CREATE OR REPLACE FUNCTION "validate_study_draft_aggregate"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  target_session_id UUID;
  parent_version INTEGER;
  parent_status "StudySessionStatus";
  parent_actual_count INTEGER;
  parent_user_id UUID;
  parent_guest_id UUID;
  parent_expires_at TIMESTAMPTZ(3);
  parent_updated_at TIMESTAMPTZ(3);
  draft_count INTEGER;
  draft_revision INTEGER;
  draft_current_ordinal INTEGER;
  draft_saved_at TIMESTAMPTZ(3);
  draft_created_at TIMESTAMPTZ(3);
  answer_count INTEGER;
  invalid_answer_timestamp_count INTEGER;
  invalid_initial_answer_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'StudySession' THEN
    target_session_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD."id"
      ELSE NEW."id"
    END;
  ELSE
    target_session_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD."studySessionId"
      ELSE NEW."studySessionId"
    END;
  END IF;

  SELECT
    session."practiceContractVersion",
    session."status",
    session."actualCount",
    session."userId",
    session."guestPrincipalId",
    session."expiresAt",
    session."updatedAt"
  INTO parent_version, parent_status, parent_actual_count, parent_user_id,
    parent_guest_id, parent_expires_at, parent_updated_at
  FROM "StudySession" AS session
  WHERE session."id" = target_session_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    COUNT(*)::INTEGER,
    MAX(draft."revision"),
    MAX(draft."currentOrdinal"),
    MAX(draft."savedAt"),
    MAX(draft."createdAt")
  INTO
    draft_count,
    draft_revision,
    draft_current_ordinal,
    draft_saved_at,
    draft_created_at
  FROM "StudyDraft" AS draft
  WHERE draft."studySessionId" = target_session_id;

  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (
      WHERE draft."revision" > 0
        AND answer."updatedAt" IS DISTINCT FROM draft."savedAt"
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE draft."revision" = 0
        AND (
          answer."selectedOptionId" IS NOT NULL
          OR answer."elapsedSec" <> 0
          OR answer."updatedAt" IS DISTINCT FROM draft."createdAt"
        )
    )::INTEGER
  INTO
    answer_count,
    invalid_answer_timestamp_count,
    invalid_initial_answer_count
  FROM "StudyDraftAnswer" AS answer
  JOIN "StudyDraft" AS draft
    ON draft."studySessionId" = answer."studySessionId"
  WHERE answer."studySessionId" = target_session_id;

  IF parent_version = 1 THEN
    IF draft_count <> 0 OR answer_count <> 0 THEN
      RAISE EXCEPTION 'Version 1 StudySession cannot own a server draft.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END IF;

  IF parent_status = 'IN_PROGRESS'
    OR (
      parent_status = 'EXPIRED'
      AND parent_user_id IS NULL
      AND parent_guest_id IS NOT NULL
      AND parent_updated_at >= parent_expires_at
      AND draft_count > 0
    ) THEN
    IF draft_count <> 1
      OR answer_count <> parent_actual_count
      OR draft_current_ordinal NOT BETWEEN 1 AND parent_actual_count
      OR invalid_answer_timestamp_count <> 0
      OR invalid_initial_answer_count <> 0
      OR (draft_revision = 0 AND draft_saved_at IS NOT NULL)
      OR (draft_revision > 0 AND draft_saved_at IS NULL)
      OR draft_created_at IS NULL THEN
      RAISE EXCEPTION 'Version 2 IN_PROGRESS StudySession requires one complete draft.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF draft_count <> 0 OR answer_count <> 0 THEN
    RAISE EXCEPTION 'Terminal version 2 StudySession cannot retain a draft.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$function$;


CREATE OR REPLACE FUNCTION "validate_study_draft_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  parent_version INTEGER;
  parent_status "StudySessionStatus";
  parent_actual_count INTEGER;
  parent_user_id UUID;
  parent_guest_id UUID;
  parent_expires_at TIMESTAMPTZ(3);
BEGIN
  SELECT
    session."practiceContractVersion",
    session."status",
    session."actualCount",
    session."userId",
    session."guestPrincipalId",
    session."expiresAt"
  INTO
    parent_version,
    parent_status,
    parent_actual_count,
    parent_user_id,
    parent_guest_id,
    parent_expires_at
  FROM "StudySession" AS session
  WHERE session."id" = CASE
    WHEN TG_OP = 'DELETE' THEN OLD."studySessionId"
    ELSE NEW."studySessionId"
  END;

  IF TG_OP = 'DELETE' THEN
    IF FOUND AND parent_status = 'EXPIRED' AND parent_user_id IS NULL
      AND parent_guest_id IS NOT NULL
      AND parent_expires_at > clock_timestamp() - INTERVAL '7 days'
      AND EXISTS (SELECT 1 FROM "GuestPrincipal" g WHERE g."id" = parent_guest_id) THEN
      RAISE EXCEPTION 'Expired guest draft retention has not elapsed.'
        USING ERRCODE = '23514';
    END IF;
    IF NOT FOUND OR parent_status <> 'IN_PROGRESS' THEN
      RETURN OLD;
    END IF;
    IF parent_user_id IS NOT NULL THEN
      PERFORM 1 FROM "User" WHERE "id" = parent_user_id;
      IF NOT FOUND THEN
        RETURN OLD;
      END IF;
    ELSE
      PERFORM 1 FROM "GuestPrincipal" WHERE "id" = parent_guest_id;
      IF NOT FOUND THEN
        RETURN OLD;
      END IF;
    END IF;
    RAISE EXCEPTION 'IN_PROGRESS StudyDraft cannot be deleted before a terminal transition.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT FOUND
    OR parent_version <> 2
    OR parent_status <> 'IN_PROGRESS'
    OR NEW."currentOrdinal" > parent_actual_count THEN
    RAISE EXCEPTION 'StudyDraft requires an editable version 2 StudySession.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."revision" <> 0
      OR NEW."currentOrdinal" <> 1
      OR NEW."savedAt" IS NOT NULL
      OR NEW."updatedAt" IS DISTINCT FROM NEW."createdAt" THEN
      RAISE EXCEPTION 'StudyDraft must start as revision zero.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."studySessionId" IS DISTINCT FROM OLD."studySessionId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."revision" <> OLD."revision" + 1
    OR NEW."savedAt" IS NULL
    OR NEW."savedAt" <= COALESCE(OLD."savedAt", OLD."createdAt")
    OR NEW."updatedAt" IS DISTINCT FROM NEW."savedAt" THEN
    RAISE EXCEPTION 'StudyDraft update must advance exactly one revision.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION "validate_study_draft_answer_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  parent_revision INTEGER;
  parent_created_at TIMESTAMPTZ(3);
  parent_version INTEGER;
  parent_status "StudySessionStatus";
  parent_user_id UUID;
  parent_guest_id UUID;
  parent_expires_at TIMESTAMPTZ(3);
BEGIN
  SELECT
    draft."revision",
    draft."createdAt",
    session."practiceContractVersion",
    session."status",
    session."userId",
    session."guestPrincipalId",
    session."expiresAt"
  INTO
    parent_revision,
    parent_created_at,
    parent_version,
    parent_status,
    parent_user_id,
    parent_guest_id,
    parent_expires_at
  FROM "StudyDraft" AS draft
  JOIN "StudySession" AS session
    ON session."id" = draft."studySessionId"
  WHERE draft."studySessionId" = CASE
    WHEN TG_OP = 'DELETE' THEN OLD."studySessionId"
    ELSE NEW."studySessionId"
  END;

  IF TG_OP = 'DELETE' THEN
    IF FOUND AND parent_status = 'EXPIRED' AND parent_user_id IS NULL
      AND parent_guest_id IS NOT NULL
      AND parent_expires_at > clock_timestamp() - INTERVAL '7 days'
      AND EXISTS (SELECT 1 FROM "GuestPrincipal" g WHERE g."id" = parent_guest_id) THEN
      RAISE EXCEPTION 'Expired guest draft retention has not elapsed.'
        USING ERRCODE = '23514';
    END IF;
    IF NOT FOUND OR parent_status <> 'IN_PROGRESS' THEN
      RETURN OLD;
    END IF;
    IF parent_user_id IS NOT NULL THEN
      PERFORM 1 FROM "User" WHERE "id" = parent_user_id;
      IF NOT FOUND THEN
        RETURN OLD;
      END IF;
    ELSE
      PERFORM 1 FROM "GuestPrincipal" WHERE "id" = parent_guest_id;
      IF NOT FOUND THEN
        RETURN OLD;
      END IF;
    END IF;
    RAISE EXCEPTION 'IN_PROGRESS StudyDraftAnswer cannot be deleted.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT FOUND OR parent_version <> 2 OR parent_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'StudyDraftAnswer requires an editable version 2 draft.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF parent_revision <> 0
      OR NEW."selectedOptionId" IS NOT NULL
      OR NEW."elapsedSec" <> 0
      OR NEW."updatedAt" IS DISTINCT FROM parent_created_at THEN
      RAISE EXCEPTION 'Initial StudyDraftAnswer must be an empty revision-zero fact.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."studySessionId" IS DISTINCT FROM OLD."studySessionId"
    OR NEW."studySessionQuestionId" IS DISTINCT FROM
      OLD."studySessionQuestionId"
    OR NEW."questionVersionId" IS DISTINCT FROM OLD."questionVersionId"
    OR NEW."updatedAt" <= OLD."updatedAt" THEN
    RAISE EXCEPTION 'StudyDraftAnswer identity is immutable and time is monotonic.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

-- Unknown key shapes are retained; current known policies use their own windows.
CREATE FUNCTION "phase7_guest_cleanup_rate_window"(key_value TEXT)
RETURNS BIGINT LANGUAGE SQL IMMUTABLE STRICT SET search_path FROM CURRENT AS $function$
  WITH policies(prefix, window_ms) AS (VALUES
    ('application:bookmark-list:', 60000::bigint),
    ('application:bookmark-write:', 60000::bigint),
    ('application:dashboard-insights-read:', 60000::bigint),
    ('application:dashboard-read:', 60000::bigint),
    ('application:question-detail-read:', 60000::bigint),
    ('application:question-list-read:', 60000::bigint),
    ('application:study-cancel:', 60000::bigint),
    ('application:study-create:', 60000::bigint),
    ('application:study-draft-save:', 60000::bigint),
    ('application:study-mutation-ip:', 60000::bigint),
    ('application:study-read:', 60000::bigint),
    ('application:study-result-read:', 60000::bigint),
    ('application:study-result-retry:', 60000::bigint),
    ('application:study-submit:', 60000::bigint),
    ('application:wrong-note-detail:', 60000::bigint),
    ('application:wrong-note-history:', 60000::bigint),
    ('application:wrong-note-list:', 60000::bigint),
    ('application:wrong-note-memo-read:', 60000::bigint),
    ('application:wrong-note-memo-write:', 60000::bigint),
    ('application:wrong-note-review-queue:', 60000::bigint),
    ('application:wrong-note-targeted-review:', 60000::bigint),
    ('application:phase7:ADMIN_READ:ACTOR:', 60000::bigint),
    ('application:phase7:ADMIN_READ:IP:', 60000::bigint),
    ('application:phase7:ADMIN_EDIT:ACTOR:', 600000::bigint),
    ('application:phase7:ADMIN_EDIT:IP:', 600000::bigint),
    ('application:phase7:ADMIN_SENSITIVE:ACTOR:', 900000::bigint),
    ('application:phase7:ADMIN_SENSITIVE:IP:', 900000::bigint),
    ('application:phase7:IMPORT_VALIDATION:ACTOR:', 900000::bigint),
    ('application:phase7:IMPORT_VALIDATION:IP:', 900000::bigint),
    ('application:phase7:REAUTHENTICATION:ACTOR:', 900000::bigint),
    ('application:phase7:REAUTHENTICATION:IP:', 900000::bigint),
    ('application:phase7:REPORT_ACTOR:ACTOR:', 600000::bigint),
    ('application:phase7:REPORT_ACTOR:IP:', 600000::bigint),
    ('application:phase7:REPORT_VERSION:VERSION:', 3600000::bigint)
  )
  SELECT CASE
    WHEN key_value ~ '^(no-trusted-ip|[0-9a-fA-F:.]+)[|]/(sign-in/email|sign-up/email|request-password-reset|send-verification-email)$'
      THEN 60000::bigint
    ELSE (
      SELECT p.window_ms FROM policies p
      WHERE left(key_value, length(p.prefix)) = p.prefix
        AND substring(key_value FROM length(p.prefix) + 1) ~ '^[0-9a-f]{64}$'
      LIMIT 1
    )
  END
$function$;
REVOKE ALL ON FUNCTION "phase7_guest_cleanup_rate_window"(TEXT) FROM PUBLIC;

-- Candidate identifiers remain internal to the cleanup facade.
CREATE FUNCTION "phase7_guest_cleanup_candidates"(now_value TIMESTAMPTZ)
RETURNS TABLE(kind TEXT, id UUID) LANGUAGE SQL VOLATILE SET search_path FROM CURRENT AS $function$
  WITH eligible_drafts AS (
    SELECT s."id" FROM "StudySession" s
    JOIN "StudyDraft" d ON d."studySessionId" = s."id"
    WHERE s."userId" IS NULL AND s."guestPrincipalId" IS NOT NULL
      AND s."practiceContractVersion" = 2 AND s."status" IN ('IN_PROGRESS', 'EXPIRED')
      AND s."expiresAt" <= now_value - INTERVAL '7 days'
      AND NOT EXISTS (SELECT 1 FROM "IdempotencyRecord" i WHERE i."studySessionId" = s."id"
        AND (i."state" <> 'SUCCEEDED' OR i."expiresAt" IS NULL OR i."expiresAt" > now_value))
      AND NOT EXISTS (SELECT 1 FROM "StudySession" retry WHERE retry."retryOfStudySessionId" = s."id")
  ), eligible_sessions AS (
    SELECT s."id" FROM "StudySession" s
    WHERE s."userId" IS NULL AND s."guestPrincipalId" IS NOT NULL
      AND s."status" <> 'IN_PROGRESS' AND s."expiresAt" <= now_value - INTERVAL '7 days'
      AND NOT EXISTS (SELECT 1 FROM "IdempotencyRecord" i WHERE i."studySessionId" = s."id"
        AND (i."state" <> 'SUCCEEDED' OR i."expiresAt" IS NULL OR i."expiresAt" > now_value))
      AND NOT EXISTS (SELECT 1 FROM "StudySession" retry WHERE retry."retryOfStudySessionId" = s."id")
  ), eligible_guests AS (
    SELECT g."id" FROM "GuestPrincipal" g
    WHERE g."expiresAt" <= now_value - INTERVAL '7 days'
      AND NOT EXISTS (SELECT 1 FROM "StudySession" s WHERE s."guestPrincipalId" = g."id")
  ), eligible_idempotency AS (
    SELECT i."id" FROM "IdempotencyRecord" i
    WHERE i."state" = 'SUCCEEDED' AND i."expiresAt" IS NOT NULL AND i."expiresAt" <= now_value
      AND i."operation" IN ('STUDY_SUBMIT', 'STUDY_DRAFT_SAVE', 'STUDY_RETRY_CREATE', 'STUDY_TARGETED_REVIEW_CREATE')
      AND NOT EXISTS (SELECT 1 FROM "StudySession" retry WHERE retry."retryOfStudySessionId" = i."studySessionId"
        AND retry."status" = 'IN_PROGRESS' AND retry."expiresAt" > now_value)
  ), eligible_rates AS (
    SELECT rate."id" FROM "RateLimit" rate
    WHERE "phase7_guest_cleanup_rate_window"(rate."key") IS NOT NULL
      AND rate."lastRequest" >= 0
      AND rate."lastRequest" <= floor(EXTRACT(EPOCH FROM now_value) * 1000)::bigint
        - 604800000 - "phase7_guest_cleanup_rate_window"(rate."key")
  )
  SELECT 'draft'::text, d."id" FROM eligible_drafts d
  UNION ALL SELECT 'session'::text, s."id" FROM eligible_sessions s
  UNION ALL SELECT 'principal'::text, g."id" FROM eligible_guests g
  UNION ALL SELECT 'idempotency'::text, i."id" FROM eligible_idempotency i
  UNION ALL SELECT 'rate'::text, r."id" FROM eligible_rates r
$function$;
REVOKE ALL ON FUNCTION "phase7_guest_cleanup_candidates"(TIMESTAMPTZ) FROM PUBLIC;

CREATE FUNCTION "phase7_guest_cleanup_batch"(
  environment_value "AdminAuditEnvironment", batch_limit INTEGER, dry_run BOOLEAN
)
RETURNS TABLE("deletedCount" BIGINT, "eligibleCount" BIGINT, "hasMore" BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $function$
DECLARE
  now_value TIMESTAMPTZ := clock_timestamp();
  candidate RECORD;
  locked_id UUID;
  session_status "StudySessionStatus";
  affected INTEGER;
  deleted_count BIGINT := 0;
  eligible_count BIGINT;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_guest_cleanup_worker');
  IF environment_value IS NULL THEN
    RAISE EXCEPTION 'Guest cleanup environment is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM "phase7_require_database_capability"(environment_value);
  IF batch_limit IS NULL OR batch_limit < 1 OR batch_limit > 500 OR dry_run IS NULL THEN
    RAISE EXCEPTION 'Invalid guest cleanup batch.' USING ERRCODE = '22023';
  END IF;
  SELECT COUNT(*) INTO eligible_count FROM "phase7_guest_cleanup_candidates"(now_value);
  IF dry_run THEN
    RETURN QUERY SELECT 0::BIGINT, eligible_count, eligible_count > 0;
    RETURN;
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('nihongo_guest_cleanup')) THEN
    RAISE EXCEPTION 'Guest cleanup already running.' USING ERRCODE = '55P03';
  END IF;

  -- A locked row must not consume the deletion limit.
  FOR candidate IN
    SELECT c.kind, c.id FROM "phase7_guest_cleanup_candidates"(now_value) c
    ORDER BY CASE c.kind WHEN 'draft' THEN 1 WHEN 'session' THEN 2
      WHEN 'principal' THEN 3 WHEN 'idempotency' THEN 4 ELSE 5 END, c.id
  LOOP
    locked_id := NULL;
    IF candidate.kind = 'draft' THEN
      SELECT s."id", s."status" INTO locked_id, session_status
      FROM "StudySession" s WHERE s."id" = candidate.id
        AND s."userId" IS NULL AND s."guestPrincipalId" IS NOT NULL
        AND s."practiceContractVersion" = 2 AND s."status" IN ('IN_PROGRESS', 'EXPIRED')
        AND s."expiresAt" <= now_value - INTERVAL '7 days'
        AND EXISTS (SELECT 1 FROM "StudyDraft" d WHERE d."studySessionId" = s."id")
        AND NOT EXISTS (SELECT 1 FROM "IdempotencyRecord" i WHERE i."studySessionId" = s."id"
          AND (i."state" <> 'SUCCEEDED' OR i."expiresAt" IS NULL OR i."expiresAt" > now_value))
        AND NOT EXISTS (SELECT 1 FROM "StudySession" retry WHERE retry."retryOfStudySessionId" = s."id")
      FOR UPDATE OF s SKIP LOCKED;
      IF locked_id IS NOT NULL THEN
        IF session_status = 'IN_PROGRESS' THEN
          UPDATE "StudySession" SET "status" = 'EXPIRED', "updatedAt" = now_value
          WHERE "id" = locked_id AND "userId" IS NULL AND "guestPrincipalId" IS NOT NULL
            AND "status" = 'IN_PROGRESS' AND "expiresAt" <= now_value - INTERVAL '7 days';
          IF NOT FOUND THEN RAISE EXCEPTION 'Guest draft candidate changed.'; END IF;
        END IF;
        DELETE FROM "StudyDraft" d WHERE d."studySessionId" = locked_id
          AND EXISTS (SELECT 1 FROM "StudySession" s WHERE s."id" = locked_id
            AND s."userId" IS NULL AND s."guestPrincipalId" IS NOT NULL
            AND s."status" = 'EXPIRED' AND s."expiresAt" <= now_value - INTERVAL '7 days');
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN RAISE EXCEPTION 'Guest draft candidate changed.'; END IF;
        deleted_count := deleted_count + affected;
      END IF;
    ELSIF candidate.kind = 'session' THEN
      SELECT s."id" INTO locked_id FROM "StudySession" s
      WHERE s."id" = candidate.id AND EXISTS (
        SELECT 1 FROM "phase7_guest_cleanup_candidates"(now_value) c
        WHERE c.kind = 'session' AND c.id = s."id"
      ) FOR UPDATE OF s SKIP LOCKED;
      IF locked_id IS NOT NULL THEN
        DELETE FROM "StudySession" s WHERE s."id" = locked_id
          AND s."userId" IS NULL AND s."guestPrincipalId" IS NOT NULL
          AND s."status" <> 'IN_PROGRESS' AND s."expiresAt" <= now_value - INTERVAL '7 days'
          AND NOT EXISTS (SELECT 1 FROM "IdempotencyRecord" i WHERE i."studySessionId" = s."id"
            AND (i."state" <> 'SUCCEEDED' OR i."expiresAt" IS NULL OR i."expiresAt" > now_value))
          AND NOT EXISTS (SELECT 1 FROM "StudySession" retry WHERE retry."retryOfStudySessionId" = s."id");
        GET DIAGNOSTICS affected = ROW_COUNT;
        deleted_count := deleted_count + affected;
      END IF;
    ELSIF candidate.kind = 'principal' THEN
      SELECT g."id" INTO locked_id FROM "GuestPrincipal" g
      WHERE g."id" = candidate.id AND g."expiresAt" <= now_value - INTERVAL '7 days'
        AND NOT EXISTS (SELECT 1 FROM "StudySession" s WHERE s."guestPrincipalId" = g."id")
      FOR UPDATE OF g SKIP LOCKED;
      IF locked_id IS NOT NULL THEN
        DELETE FROM "GuestPrincipal" g WHERE g."id" = locked_id
          AND g."expiresAt" <= now_value - INTERVAL '7 days'
          AND NOT EXISTS (SELECT 1 FROM "StudySession" s WHERE s."guestPrincipalId" = g."id");
        GET DIAGNOSTICS affected = ROW_COUNT;
        deleted_count := deleted_count + affected;
      END IF;
    ELSIF candidate.kind = 'idempotency' THEN
      SELECT i."id" INTO locked_id FROM "IdempotencyRecord" i
      JOIN "StudySession" s ON s."id" = i."studySessionId"
      WHERE i."id" = candidate.id AND EXISTS (
        SELECT 1 FROM "phase7_guest_cleanup_candidates"(now_value) c
        WHERE c.kind = 'idempotency' AND c.id = i."id"
      ) FOR UPDATE OF s, i SKIP LOCKED;
      IF locked_id IS NOT NULL THEN
        DELETE FROM "IdempotencyRecord" i WHERE i."id" = locked_id
          AND i."state" = 'SUCCEEDED' AND i."expiresAt" IS NOT NULL AND i."expiresAt" <= now_value
          AND i."operation" IN ('STUDY_SUBMIT', 'STUDY_DRAFT_SAVE', 'STUDY_RETRY_CREATE', 'STUDY_TARGETED_REVIEW_CREATE')
          AND NOT EXISTS (SELECT 1 FROM "StudySession" retry WHERE retry."retryOfStudySessionId" = i."studySessionId"
            AND retry."status" = 'IN_PROGRESS' AND retry."expiresAt" > now_value);
        GET DIAGNOSTICS affected = ROW_COUNT;
        deleted_count := deleted_count + affected;
      END IF;
    ELSIF candidate.kind = 'rate' THEN
      SELECT r."id" INTO locked_id FROM "RateLimit" r
      WHERE r."id" = candidate.id AND EXISTS (
        SELECT 1 FROM "phase7_guest_cleanup_candidates"(now_value) c
        WHERE c.kind = 'rate' AND c.id = r."id"
      ) FOR UPDATE OF r SKIP LOCKED;
      IF locked_id IS NOT NULL THEN
        DELETE FROM "RateLimit" r WHERE r."id" = locked_id
          AND "phase7_guest_cleanup_rate_window"(r."key") IS NOT NULL
          AND r."lastRequest" >= 0
          AND r."lastRequest" <= floor(EXTRACT(EPOCH FROM now_value) * 1000)::bigint
            - 604800000 - "phase7_guest_cleanup_rate_window"(r."key");
        GET DIAGNOSTICS affected = ROW_COUNT;
        deleted_count := deleted_count + affected;
      END IF;
    END IF;
    EXIT WHEN deleted_count >= batch_limit;
  END LOOP;
  SELECT COUNT(*) INTO eligible_count FROM "phase7_guest_cleanup_candidates"(now_value);
  RETURN QUERY SELECT deleted_count, eligible_count, eligible_count > 0;
END;
$function$;
REVOKE ALL ON FUNCTION "phase7_guest_cleanup_batch"("AdminAuditEnvironment", INTEGER, BOOLEAN)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_guest_cleanup_batch"("AdminAuditEnvironment", INTEGER, BOOLEAN)
  TO "nihongo_guest_cleanup_worker";

DO $harden_guest_cleanup_functions$
DECLARE target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema', false)::NAME;
BEGIN
  EXECUTE pg_catalog.format(
    'GRANT USAGE ON SCHEMA %I TO "nihongo_guest_cleanup_worker"', target_schema
  );
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %I."validate_study_draft_aggregate"() SET search_path TO pg_catalog, %I, pg_temp',
    target_schema, target_schema
  );
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %I."validate_study_draft_change"() SET search_path TO pg_catalog, %I, pg_temp',
    target_schema, target_schema
  );
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %I."validate_study_draft_answer_change"() SET search_path TO pg_catalog, %I, pg_temp',
    target_schema, target_schema
  );
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %I."phase7_guest_cleanup_rate_window"(TEXT) SET search_path TO pg_catalog, %I, pg_temp',
    target_schema, target_schema
  );
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %I."phase7_guest_cleanup_candidates"(TIMESTAMPTZ) SET search_path TO pg_catalog, %I, pg_temp',
    target_schema, target_schema
  );
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %I."phase7_guest_cleanup_batch"(%I."AdminAuditEnvironment", INTEGER, BOOLEAN) SET search_path TO pg_catalog, %I, pg_temp',
    target_schema, target_schema, target_schema
  );
END;
$harden_guest_cleanup_functions$;
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
