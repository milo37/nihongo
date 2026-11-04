-- JLP-691 additive: operations console member list/detail and restriction
-- commands. nihongo_app still cannot read "User" directly; it only gets
-- EXECUTE on the four SECURITY DEFINER functions below, which return masked
-- email only. New table and functions only; no existing table, constraint,
-- trigger, function or grant changes.
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
    RAISE EXCEPTION 'Admin member console migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";


-- Restriction history; its row count per member is the member rowVersion.
-- Written only by the functions below (no direct table grants).
CREATE TABLE "UserAccountRestrictionEvent" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "action" TEXT NOT NULL,
  "actorUserId" UUID REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  "reason" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "UserAccountRestrictionEvent_action_shape_check" CHECK (
    ("action" = 'RESTRICT' AND char_length("reason") BETWEEN 1 AND 500)
    OR ("action" = 'RELEASE' AND "reason" IS NULL)
  )
);
CREATE INDEX "UserAccountRestrictionEvent_userId_createdAt_idx"
  ON "UserAccountRestrictionEvent" ("userId", "createdAt");
CREATE INDEX "UserAccountRestrictionEvent_actorUserId_idx"
  ON "UserAccountRestrictionEvent" ("actorUserId");

REVOKE ALL ON TABLE "UserAccountRestrictionEvent" FROM PUBLIC,
  "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

-- `minsu1@example.com` -> `mi****@e******.com`.
CREATE FUNCTION "admin_mask_member_email"(address TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY DEFINER SET search_path FROM CURRENT
AS $function$
DECLARE
  at_position INTEGER := char_length(address) - strpos(reverse(address), '@') + 1;
  local_part TEXT := substr(address, 1, at_position - 1);
  domain_part TEXT := substr(address, at_position + 1);
  dot_position INTEGER;
  host_part TEXT;
  suffix TEXT := '';
  shown INTEGER;
  masked_local TEXT;
BEGIN
  IF strpos(address, '@') = 0 THEN
    at_position := char_length(address) + 1;
    local_part := address;
    domain_part := '';
  END IF;
  dot_position := CASE WHEN strpos(domain_part, '.') = 0 THEN 0
    ELSE char_length(domain_part) - strpos(reverse(domain_part), '.') + 1 END;
  IF dot_position > 1 THEN
    host_part := substr(domain_part, 1, dot_position - 1);
    suffix := substr(domain_part, dot_position);
  ELSE
    host_part := domain_part;
  END IF;
  shown := LEAST(2, GREATEST(char_length(local_part) - 1, 0));
  masked_local := substr(local_part, 1, shown) || repeat('*', char_length(local_part) - shown);
  shown := LEAST(1, GREATEST(char_length(host_part) - 1, 0));
  RETURN masked_local || '@' || substr(host_part, 1, shown)
    || repeat('*', char_length(host_part) - shown) || suffix;
END;
$function$;

CREATE FUNCTION "admin_assert_member_console_actor"(actor UUID)
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path FROM CURRENT
AS $function$
BEGIN
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM "User" AS u
    WHERE u."id" = actor AND u."role" = 'ADMIN'
      AND u."accountStatus" = 'ACTIVE' AND u."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Member console actor is not an active administrator.'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- Learner accounts that still exist; administrators are not members.
CREATE FUNCTION "admin_list_members"(
  actor UUID,
  exact_email TEXT,
  sort_key TEXT,
  descending BOOLEAN,
  page_limit INTEGER,
  page_offset INTEGER
)
RETURNS TABLE (
  "memberId" UUID,
  "maskedEmail" TEXT,
  "joinedAt" TIMESTAMPTZ(3),
  "lastStudiedAt" TIMESTAMPTZ(3),
  "solvedCount" INTEGER,
  "reportCount" INTEGER,
  "restrictedAt" TIMESTAMPTZ(3),
  "restrictionReason" TEXT,
  "rowVersion" INTEGER,
  "total" BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path FROM CURRENT
AS $function$
BEGIN
  PERFORM "admin_assert_member_console_actor"(actor);
  IF sort_key IS NULL
    OR sort_key NOT IN ('joinedAt', 'lastStudiedAt', 'solvedCount', 'reportCount', 'status')
    OR descending IS NULL
    OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 100
    OR page_offset IS NULL OR page_offset < 0 THEN
    RAISE EXCEPTION 'Member list arguments are invalid.' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH member AS (
    SELECT
      u."id" AS member_id,
      u."email" AS email,
      u."createdAt" AS joined_at,
      study.last_studied_at,
      COALESCE(study.solved_count, 0)::INTEGER AS solved_count,
      (
        (SELECT COUNT(*) FROM "QuestionReport" AS report
          WHERE report."reporterUserId" = u."id")
        + (SELECT COUNT(*) FROM "UserReport" AS report
          WHERE report."reporterUserId" = u."id")
      )::INTEGER AS report_count,
      restriction."restrictedAt" AS restricted_at,
      restriction."reason" AS restriction_reason,
      (1 + (SELECT COUNT(*) FROM "UserAccountRestrictionEvent" AS event
        WHERE event."userId" = u."id"))::INTEGER AS row_version
    FROM "User" AS u
    LEFT JOIN "UserAccountRestriction" AS restriction ON restriction."userId" = u."id"
    LEFT JOIN LATERAL (
      SELECT MAX(answer."answeredAt") AS last_studied_at, COUNT(*) AS solved_count
      FROM "StudySession" AS session
      JOIN "StudySessionQuestion" AS item ON item."studySessionId" = session."id"
      JOIN "StudyAnswer" AS answer ON answer."studySessionQuestionId" = item."id"
      WHERE session."userId" = u."id"
    ) AS study ON TRUE
    WHERE u."role" = 'USER'
      AND u."deletedAt" IS NULL
      AND u."accountStatus" <> 'DELETED'
      AND (exact_email IS NULL OR u."email" = exact_email)
  )
  SELECT
    member.member_id,
    "admin_mask_member_email"(member.email),
    member.joined_at,
    member.last_studied_at,
    member.solved_count,
    member.report_count,
    member.restricted_at,
    member.restriction_reason,
    member.row_version,
    COUNT(*) OVER ()
  FROM member
  ORDER BY
    CASE WHEN sort_key = 'joinedAt' AND NOT descending THEN member.joined_at END ASC,
    CASE WHEN sort_key = 'joinedAt' AND descending THEN member.joined_at END DESC,
    CASE WHEN sort_key = 'lastStudiedAt' AND NOT descending THEN member.last_studied_at END ASC NULLS LAST,
    CASE WHEN sort_key = 'lastStudiedAt' AND descending THEN member.last_studied_at END DESC NULLS LAST,
    CASE WHEN sort_key = 'solvedCount' AND NOT descending THEN member.solved_count END ASC,
    CASE WHEN sort_key = 'solvedCount' AND descending THEN member.solved_count END DESC,
    CASE WHEN sort_key = 'reportCount' AND NOT descending THEN member.report_count END ASC,
    CASE WHEN sort_key = 'reportCount' AND descending THEN member.report_count END DESC,
    CASE WHEN sort_key = 'status' AND NOT descending THEN (member.restricted_at IS NOT NULL) END ASC,
    CASE WHEN sort_key = 'status' AND descending THEN (member.restricted_at IS NOT NULL) END DESC,
    member.member_id ASC
  LIMIT page_limit OFFSET page_offset;
END;
$function$;

CREATE FUNCTION "admin_get_member"(actor UUID, member_id UUID)
RETURNS TABLE (
  "memberId" UUID,
  "maskedEmail" TEXT,
  "joinedAt" TIMESTAMPTZ(3),
  "lastStudiedAt" TIMESTAMPTZ(3),
  "solvedCount" INTEGER,
  "reportCount" INTEGER,
  "restrictedAt" TIMESTAMPTZ(3),
  "restrictionReason" TEXT,
  "rowVersion" INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path FROM CURRENT
AS $function$
BEGIN
  PERFORM "admin_assert_member_console_actor"(actor);
  RETURN QUERY
  SELECT
    u."id",
    "admin_mask_member_email"(u."email"),
    u."createdAt",
    study.last_studied_at,
    COALESCE(study.solved_count, 0)::INTEGER,
    (
      (SELECT COUNT(*) FROM "QuestionReport" AS report
        WHERE report."reporterUserId" = u."id")
      + (SELECT COUNT(*) FROM "UserReport" AS report
        WHERE report."reporterUserId" = u."id")
    )::INTEGER,
    restriction."restrictedAt",
    restriction."reason",
    (1 + (SELECT COUNT(*) FROM "UserAccountRestrictionEvent" AS event
      WHERE event."userId" = u."id"))::INTEGER
  FROM "User" AS u
  LEFT JOIN "UserAccountRestriction" AS restriction ON restriction."userId" = u."id"
  LEFT JOIN LATERAL (
    SELECT MAX(answer."answeredAt") AS last_studied_at, COUNT(*) AS solved_count
    FROM "StudySession" AS session
    JOIN "StudySessionQuestion" AS item ON item."studySessionId" = session."id"
    JOIN "StudyAnswer" AS answer ON answer."studySessionQuestionId" = item."id"
    WHERE session."userId" = u."id"
  ) AS study ON TRUE
  WHERE u."id" = member_id
    AND u."role" = 'USER'
    AND u."deletedAt" IS NULL
    AND u."accountStatus" <> 'DELETED';
END;
$function$;

-- Returns OK, NOT_FOUND, VERSION_CONFLICT or INVALID_STATE_TRANSITION.
CREATE FUNCTION "admin_set_member_restriction"(
  actor UUID,
  member_id UUID,
  expected_row_version INTEGER,
  restrict_member BOOLEAN,
  restriction_reason TEXT
)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path FROM CURRENT
AS $function$
DECLARE
  current_version INTEGER;
  is_restricted BOOLEAN;
BEGIN
  PERFORM "admin_assert_member_console_actor"(actor);
  IF restrict_member IS NULL OR expected_row_version IS NULL
    OR (restrict_member AND (restriction_reason IS NULL
      OR char_length(restriction_reason) NOT BETWEEN 1 AND 500))
    OR (NOT restrict_member AND restriction_reason IS NOT NULL) THEN
    RAISE EXCEPTION 'Member restriction arguments are invalid.' USING ERRCODE = '22023';
  END IF;
  -- Serializes concurrent commands for one member; compatible with FK checks.
  PERFORM 1 FROM "User" AS u
  WHERE u."id" = member_id AND u."role" = 'USER'
    AND u."deletedAt" IS NULL AND u."accountStatus" <> 'DELETED'
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;
  SELECT (1 + COUNT(*))::INTEGER INTO current_version
  FROM "UserAccountRestrictionEvent" AS event WHERE event."userId" = member_id;
  IF current_version <> expected_row_version THEN
    RETURN 'VERSION_CONFLICT';
  END IF;
  is_restricted := EXISTS (
    SELECT 1 FROM "UserAccountRestriction" AS restriction
    WHERE restriction."userId" = member_id
  );
  IF restrict_member = is_restricted THEN
    RETURN 'INVALID_STATE_TRANSITION';
  END IF;
  IF restrict_member THEN
    INSERT INTO "UserAccountRestriction" ("userId", "reason")
    VALUES (member_id, restriction_reason);
  ELSE
    DELETE FROM "UserAccountRestriction" AS restriction
    WHERE restriction."userId" = member_id;
  END IF;
  INSERT INTO "UserAccountRestrictionEvent" ("userId", "action", "actorUserId", "reason")
  VALUES (member_id, CASE WHEN restrict_member THEN 'RESTRICT' ELSE 'RELEASE' END,
    actor, restriction_reason);
  RETURN 'OK';
END;
$function$;

REVOKE ALL ON FUNCTION "admin_mask_member_email"(TEXT),
  "admin_assert_member_console_actor"(UUID),
  "admin_list_members"(UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER),
  "admin_get_member"(UUID, UUID),
  "admin_set_member_restriction"(UUID, UUID, INTEGER, BOOLEAN, TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  "admin_list_members"(UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER),
  "admin_get_member"(UUID, UUID),
  "admin_set_member_restriction"(UUID, UUID, INTEGER, BOOLEAN, TEXT)
  TO "nihongo_app";
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
