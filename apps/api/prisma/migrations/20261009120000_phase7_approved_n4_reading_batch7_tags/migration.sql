-- JLP-472 / frozen JLP-470 contract / independent JLP-471 contract QA.
-- JLP-483: objects only; two closed installation profiles in the SAME target.
-- Legacy: canonical36 -> old20/24 -> append37 -> new15/15.
-- Current: physical37 (catalog included) -> current seed107/126 -> append38;
-- historical registration commands remain closed on the current profile.
-- No content import, aliases, repair, old function replacement or ACL expansion.
BEGIN;
SELECT pg_catalog.set_config('app.phase7_target_schema', pg_catalog.current_schema(), true);
SELECT pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true);
DO $path$
DECLARE target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace AS namespace
    JOIN pg_catalog.pg_roles AS owner ON owner.oid = namespace.nspowner
    WHERE namespace.nspname = target_schema AND owner.rolname = 'nihongo_phase7_owner'
  ) THEN
    RAISE EXCEPTION 'Approved registration requires the owned Phase 7 schema.' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.set_config('search_path', pg_catalog.format('%I, pg_catalog, pg_temp', target_schema), true);
END;
$path$;
SET LOCAL ROLE "nihongo_phase7_owner";
SET LOCAL TIME ZONE 'UTC';

DO $predecessor$
DECLARE
  ledger_digest TEXT;
  predecessor_count BIGINT;
  assignment_digest TEXT;
  applicability_digest TEXT;
  semantic_digest TEXT;
BEGIN
  LOCK TABLE "Tag", "TagApplicability", "Question", "QuestionVersion",
    "QuestionOption", "QuestionVersionTag", "ContentReview", "AdminAuditLog",
    "QuestionReport", "Phase7OperationIntent", "_prisma_migrations",
    "Phase7ApprovedReadingTagRegistration", "Phase7ApprovedN3ReadingTagRegistration",
    "Phase7ApprovedN4N2ReadingTagRegistration" IN SHARE ROW EXCLUSIVE MODE;
  -- Prisma's optional own IN-FLIGHT row is excluded only during installation.
  -- Neither branch accepts unfinished, rolled-back or altered predecessor rows.
  IF (SELECT COUNT(*) FROM "_prisma_migrations" WHERE "migration_name" = '20261009120000_phase7_approved_n4_reading_batch7_tags') > 1
    OR EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" <> '20261009120000_phase7_approved_n4_reading_batch7_tags'
      AND ("finished_at" IS NULL OR "rolled_back_at" IS NOT NULL
        OR COALESCE(btrim("logs"), '') <> '' OR "applied_steps_count" <> 1
        OR "checksum" !~ '^[0-9a-f]{64}$')) THEN
    RAISE EXCEPTION 'Batch7 installation requires completed predecessor rows.' USING ERRCODE = '23514';
  END IF;
  SELECT COUNT(*), encode(public.digest(string_agg(
    convert_to("migration_name", 'UTF8') || decode('00', 'hex') ||
      convert_to("checksum" || E'\n', 'UTF8'),
    decode('', 'hex') ORDER BY "migration_name" COLLATE "C"
  ), 'sha256'), 'hex') INTO predecessor_count, ledger_digest
  FROM "_prisma_migrations"
  WHERE "migration_name" <> '20261009120000_phase7_approved_n4_reading_batch7_tags';
  IF predecessor_count = 36 THEN
    IF ledger_digest IS DISTINCT FROM '96eebebc8d76d1eb858b1cc12d7559685a5e06559a57ff8d9aabdf3b067e3ab3' THEN
      RAISE EXCEPTION 'Batch7 canonical36 ledger prefix drifted.' USING ERRCODE = '23514';
    END IF;
    IF (SELECT COUNT(*) FROM "Tag") <> 128
      OR (SELECT COUNT(*) FROM "TagApplicability") <> 151
      OR (SELECT COUNT(*) FROM "Phase7ApprovedN4N2ReadingTagRegistration") <> 1
      OR NOT EXISTS (SELECT 1 FROM "Phase7ApprovedN4N2ReadingTagRegistration"
        WHERE "batch" = 'jlp-449-n4-n2-reading-tags-v1') THEN
      RAISE EXCEPTION 'Batch7 requires the completed predecessor20/24 application.' USING ERRCODE = '23514';
    END IF;
  ELSIF predecessor_count = 37 THEN
    IF ledger_digest IS DISTINCT FROM '89158202b48454a0d179913983fe1449dc139c0db25aec0ba4c5480040291aad'
      OR (SELECT COUNT(*) FROM "_prisma_migrations"
        WHERE "migration_name" = '20261005183000_phase7_reviewed_catalog_current'
          AND "checksum" = 'c04b27c1ee7610c8648da58a05596c2d9573a48cfad20c1a1b8b9f818dc3554d') <> 1 THEN
      RAISE EXCEPTION 'Batch7 current37 ledger prefix drifted.' USING ERRCODE = '23514';
    END IF;
    -- Current is an independently pinned seed, never a legacy count shortcut.
    IF (SELECT COUNT(*) FROM "Question") <> 65
      OR (SELECT COUNT(*) FROM "QuestionVersion") <> 65
      OR (SELECT COUNT(*) FROM "QuestionOption") <> 260
      OR (SELECT COUNT(*) FROM "QuestionVersionTag") <> 130
      OR (SELECT COUNT(*) FROM "Tag") <> 107
      OR (SELECT COUNT(*) FROM "TagApplicability") <> 126
      OR (SELECT COUNT(DISTINCT "contentFingerprint") FROM "QuestionVersion") <> 65
      OR EXISTS (SELECT 1 FROM "ContentReview")
      OR EXISTS (SELECT 1 FROM "AdminAuditLog")
      OR EXISTS (SELECT 1 FROM "QuestionReport")
      OR EXISTS (SELECT 1 FROM "Phase7OperationIntent")
      OR EXISTS (SELECT 1 FROM "Phase7ApprovedReadingTagRegistration")
      OR EXISTS (SELECT 1 FROM "Phase7ApprovedN3ReadingTagRegistration")
      OR EXISTS (SELECT 1 FROM "Phase7ApprovedN4N2ReadingTagRegistration") THEN
      RAISE EXCEPTION 'Batch7 current installation requires the unchanged65/107/126 bootstrap.' USING ERRCODE = '23514';
    END IF;
    IF (SELECT COUNT(*) FROM "Question" AS question
        JOIN "QuestionVersion" AS version
          ON version."questionId" = question."id"
          AND version."id" = question."currentPublishedVersionId") <> 65
      OR EXISTS (SELECT 1 FROM "Question"
        WHERE "lifecycleStatus" <> 'ACTIVE' OR "rowVersion" <> 1
          OR "createdByLabelSnapshot" <> 'SYSTEM_SEED' OR "createdByUserId" IS NOT NULL
          OR "createdAt" <> '2026-01-01T00:00:00Z'::timestamptz
          OR "updatedAt" <> '2026-01-01T00:00:00Z'::timestamptz)
      OR EXISTS (SELECT 1 FROM "QuestionVersion" AS version
        WHERE version."status" <> 'PUBLISHED' OR version."rowVersion" <> 1
          OR version."versionNumber" <> 1 OR version."createdByLabelSnapshot" <> 'SYSTEM_SEED'
          OR version."createdByUserId" IS NOT NULL
          OR version."createdAt" <> '2026-01-01T00:00:00Z'::timestamptz
          OR version."updatedAt" <> '2026-01-01T00:00:00Z'::timestamptz
          OR version."publishedAt" IS DISTINCT FROM '2026-01-01T00:00:00Z'::timestamptz
          OR version."contentFingerprint" IS DISTINCT FROM "phase7_question_version_fingerprint"(version."id"))
      OR EXISTS (SELECT 1 FROM "Tag"
        WHERE ( "createdAt" <> '2026-01-01T00:00:00Z'::timestamptz
          OR "updatedAt" <> '2026-01-01T00:00:00Z'::timestamptz)) THEN
      RAISE EXCEPTION 'Batch7 current installation requires original seed identities and snapshots.' USING ERRCODE = '23514';
    END IF;

    SELECT encode(public.digest(convert_to(string_agg(
      assignment."id"::TEXT || '|' ||
      assignment."questionVersionId"::TEXT || '|' ||
      assignment."tagId"::TEXT || '|' ||
      assignment."labelSnapshot" || '|' ||
      assignment."normalizedNameSnapshot",
      E'\n' ORDER BY assignment."id"::TEXT COLLATE "C"
    ), 'UTF8'), 'sha256'::TEXT), 'hex')
    INTO assignment_digest
    FROM "QuestionVersionTag" AS assignment;

    SELECT encode(public.digest(convert_to(string_agg(
      applicability."tagId"::TEXT || '|' ||
      applicability."level"::TEXT || '|' ||
      applicability."subject"::TEXT || '|' ||
      applicability."questionType"::TEXT,
      E'\n' ORDER BY (
        applicability."tagId"::TEXT || '|' ||
        applicability."level"::TEXT || '|' ||
        applicability."subject"::TEXT || '|' ||
        applicability."questionType"::TEXT
      ) COLLATE "C"
    ), 'UTF8'), 'sha256'::TEXT), 'hex')
    INTO applicability_digest
    FROM "TagApplicability" AS applicability;

    SELECT encode(public.digest(convert_to(jsonb_build_object(
      'questions', (
        SELECT jsonb_agg(jsonb_build_object(
          'id', question."id",
          'lifecycle', question."lifecycleStatus",
          'pointer', question."currentPublishedVersionId",
          'creator', question."createdByLabelSnapshot"
        ) ORDER BY question."id")
        FROM "Question" AS question
      ),
      'versions', (
        SELECT jsonb_agg(jsonb_build_object(
          'id', version."id",
          'questionId', version."questionId",
          'versionNumber', version."versionNumber",
          'status', version."status",
          'level', version."level",
          'subject', version."subject",
          'questionType', version."questionType",
          'passage', version."passage",
          'questionText', version."questionText",
          'correctOptionId', version."correctOptionId",
          'explanationKo', version."explanationKo",
          'explanationJa', version."explanationJa",
          'difficulty', version."difficulty",
          'sourceType', version."sourceType",
          'rowVersion', version."rowVersion",
          'creator', version."createdByLabelSnapshot"
        ) ORDER BY version."id")
        FROM "QuestionVersion" AS version
      ),
      'options', (
        SELECT jsonb_agg(to_jsonb(option_row) ORDER BY option_row."id")
        FROM (
          SELECT "id", "questionVersionId", "label", "text", "ordinal"
          FROM "QuestionOption"
        ) AS option_row
      ),
      'tags', (
        SELECT jsonb_agg(to_jsonb(tag_row) ORDER BY tag_row."id")
        FROM (
          SELECT "id", "label", "normalizedName" FROM "Tag"
        ) AS tag_row
      ),
      'assignments', (
        SELECT jsonb_agg(to_jsonb(assignment_row)
          ORDER BY assignment_row."id")
        FROM (
          SELECT "id", "questionVersionId", "tagId", "labelSnapshot"
          FROM "QuestionVersionTag"
        ) AS assignment_row
      )
    )::TEXT, 'UTF8'), 'sha256'::TEXT), 'hex') INTO semantic_digest;

    IF assignment_digest IS DISTINCT FROM '0e4f6c477108c053a924aa1ba0f3cba8e868853328b8626839f95939bb19c798'
      OR applicability_digest IS DISTINCT FROM '81e1accc76657951962be7d3d21fdd976ea67d78c98ddb87abe6f9823edbc6ef'
      OR semantic_digest IS DISTINCT FROM '4f8f2c077bc5e79a4755f007f96cd4b8e57bdd6b14f0f906faefaab79eff2fa9' THEN
      RAISE EXCEPTION 'Batch7 current reviewed catalog digest drifted.' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Batch7 installation requires canonical36 or current37 predecessor.' USING ERRCODE = '23514';
  END IF;
END;
$predecessor$;

CREATE TABLE "Phase7ApprovedN4ReadingBatch7TagRegistration" (
  "batch" TEXT PRIMARY KEY CHECK ("batch" = 'jlp-470-n4-reading-batch7-tags-v1'),
  "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
REVOKE ALL ON TABLE "Phase7ApprovedN4ReadingBatch7TagRegistration"
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker", "nihongo_phase7_migration";

CREATE FUNCTION "protect_phase7_approved_n4_reading_batch7_tag_registration"()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'Approved N4 Batch7 tag registration evidence is immutable.'
    USING ERRCODE = '42501';
END;
$function$;
REVOKE ALL ON FUNCTION "protect_phase7_approved_n4_reading_batch7_tag_registration"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker", "nihongo_phase7_migration";
CREATE TRIGGER "Phase7ApprovedN4ReadingBatch7TagRegistration_immutable"
BEFORE UPDATE OR DELETE ON "Phase7ApprovedN4ReadingBatch7TagRegistration"
FOR EACH ROW EXECUTE FUNCTION "protect_phase7_approved_n4_reading_batch7_tag_registration"();

CREATE TRIGGER "Phase7ApprovedN4ReadingBatch7TagRegistration_no_truncate"
BEFORE TRUNCATE ON "Phase7ApprovedN4ReadingBatch7TagRegistration"
FOR EACH STATEMENT EXECUTE FUNCTION "protect_phase7_approved_n4_reading_batch7_tag_registration"();

CREATE FUNCTION "register_phase7_approved_n4_reading_batch7_tag_rows"()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path FROM CURRENT AS $function$
DECLARE
  approved RECORD;
  existing RECORD;
  assignment_digest TEXT;
  applicability_digest TEXT;
  semantic_digest TEXT;
  ledger_digest TEXT;
  new_tag_id UUID;
  prior_applied_at TIMESTAMPTZ;
  before_state JSONB;
  after_state JSONB;
  sealed_predecessor_digest CONSTANT TEXT := 'JLP478_BATCH7_PREDECESSOR_DIGEST_UNSET';
  sealed_installation_profile CONSTANT TEXT := 'JLP483_BATCH7_PROFILE_UNSET';
BEGIN
  IF TG_OP <> 'INSERT' OR pg_trigger_depth() <> 1
    OR NEW."batch" <> 'jlp-470-n4-reading-batch7-tags-v1' THEN
    RAISE EXCEPTION 'Unapproved N4 Batch7 tag registration.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace AS namespace
    JOIN pg_catalog.pg_roles AS owner ON owner.oid = namespace.nspowner
    WHERE namespace.nspname = TG_TABLE_SCHEMA
      AND owner.rolname = 'nihongo_phase7_owner'
  ) THEN
    RAISE EXCEPTION 'Approved registration schema ownership drifted.' USING ERRCODE = '42501';
  END IF;
  LOCK TABLE "Tag", "TagApplicability", "Question", "QuestionVersion",
    "QuestionOption", "QuestionVersionTag", "ContentReview", "AdminAuditLog",
    "QuestionReport", "Phase7OperationIntent", "_prisma_migrations",
    "Phase7ApprovedReadingTagRegistration", "Phase7ApprovedN3ReadingTagRegistration",
    "Phase7ApprovedN4N2ReadingTagRegistration",
    "Phase7ApprovedN4ReadingBatch7TagRegistration" IN SHARE ROW EXCLUSIVE MODE;
  IF sealed_installation_profile = 'CURRENT_PHYSICAL37' THEN
    RAISE EXCEPTION 'Batch7 historical registration is unavailable on the current catalog.' USING ERRCODE = '23514';
  END IF;
  IF (SELECT COUNT(*) FROM "Question") <> 65
    OR (SELECT COUNT(*) FROM "QuestionVersion") <> 65
    OR (SELECT COUNT(*) FROM "QuestionOption") <> 260
    OR (SELECT COUNT(*) FROM "Tag") <> 128
    OR (SELECT COUNT(*) FROM "TagApplicability") <> 151
    OR EXISTS (SELECT 1 FROM "Phase7ApprovedReadingTagRegistration")
    OR (SELECT COUNT(*) FROM "QuestionVersionTag") <> 130
    OR EXISTS (SELECT 1 FROM "ContentReview")
    OR EXISTS (SELECT 1 FROM "AdminAuditLog")
    OR EXISTS (SELECT 1 FROM "QuestionReport")
    OR EXISTS (SELECT 1 FROM "Phase7OperationIntent")
    OR EXISTS (SELECT 1 FROM "Phase7ApprovedN3ReadingTagRegistration")
    OR (SELECT COUNT(*) FROM "Phase7ApprovedN4N2ReadingTagRegistration") <> 1
    OR NOT EXISTS (SELECT 1 FROM "Phase7ApprovedN4N2ReadingTagRegistration" WHERE "batch" = 'jlp-449-n4-n2-reading-tags-v1')
    OR EXISTS (SELECT 1 FROM "Phase7ApprovedN4ReadingBatch7TagRegistration") THEN
    RAISE EXCEPTION 'Approved N4 Batch7 registration requires the unchanged staged128/151 bootstrap.'
      USING ERRCODE = '23514';
  END IF;

  IF (SELECT COUNT(*) FROM "_prisma_migrations") <> 37
    OR (SELECT COUNT(*) FROM "_prisma_migrations" WHERE "migration_name" = '20261009120000_phase7_approved_n4_reading_batch7_tags') <> 1
    OR EXISTS (SELECT 1 FROM "_prisma_migrations"
      WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL
        OR COALESCE(btrim("logs"), '') <> '' OR "applied_steps_count" <> 1
        OR "checksum" !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'Batch7 requires the completed canonical37 ledger.' USING ERRCODE = '23514';
  END IF;
  SELECT encode(public.digest(string_agg(
    convert_to("migration_name", 'UTF8') || decode('00', 'hex') ||
      convert_to("checksum" || E'\n', 'UTF8'),
    decode('', 'hex') ORDER BY "migration_name" COLLATE "C"
  ), 'sha256'), 'hex') INTO ledger_digest
  FROM "_prisma_migrations"
  WHERE "migration_name" <> '20261009120000_phase7_approved_n4_reading_batch7_tags';
  IF ledger_digest IS DISTINCT FROM '96eebebc8d76d1eb858b1cc12d7559685a5e06559a57ff8d9aabdf3b067e3ab3' THEN
    RAISE EXCEPTION 'Batch7 canonical36 ledger prefix drifted.' USING ERRCODE = '23514';
  END IF;
  SELECT "appliedAt" INTO prior_applied_at FROM "Phase7ApprovedN4N2ReadingTagRegistration"
    WHERE "batch" = 'jlp-449-n4-n2-reading-tags-v1';
  IF (SELECT COUNT(*) FROM "Question" AS question
      JOIN "QuestionVersion" AS version
        ON version."questionId" = question."id"
        AND version."id" = question."currentPublishedVersionId") <> 65
    OR EXISTS (SELECT 1 FROM "Question"
      WHERE "lifecycleStatus" <> 'ACTIVE' OR "rowVersion" <> 1
        OR "createdByLabelSnapshot" <> 'SYSTEM_SEED' OR "createdByUserId" IS NOT NULL
        OR "createdAt" <> '2026-01-01T00:00:00Z'::timestamptz
        OR "updatedAt" <> '2026-01-01T00:00:00Z'::timestamptz)
    OR EXISTS (SELECT 1 FROM "QuestionVersion" AS version
      WHERE version."status" <> 'PUBLISHED' OR version."rowVersion" <> 1
        OR version."versionNumber" <> 1 OR version."createdByLabelSnapshot" <> 'SYSTEM_SEED'
        OR version."createdByUserId" IS NOT NULL
        OR version."createdAt" <> '2026-01-01T00:00:00Z'::timestamptz
        OR version."updatedAt" <> '2026-01-01T00:00:00Z'::timestamptz
        OR version."publishedAt" IS DISTINCT FROM '2026-01-01T00:00:00Z'::timestamptz
        OR version."contentFingerprint" IS DISTINCT FROM "phase7_question_version_fingerprint"(version."id"))
    OR EXISTS (SELECT 1 FROM "Tag"
      WHERE "normalizedName" NOT IN ('행동 변화', '재사용', '요금', '예외 조건', '비교', '선택 이유', '행동 순서', '요리', '분리배출', '물품별 조건', '사례 종합', '역사와 지속 이용', '조사 해석', '판단 근거', '운영 조정', '상충 요구', '반환 연장', '복수 조건', '누적 상한', '다음 개실일') AND ( "createdAt" <> '2026-01-01T00:00:00Z'::timestamptz
        OR "updatedAt" <> '2026-01-01T00:00:00Z'::timestamptz)) THEN
    RAISE EXCEPTION 'Approved registration requires original seed identities and snapshots.' USING ERRCODE = '23514';
  END IF;

  SELECT encode(public.digest(convert_to(string_agg(
    assignment."id"::TEXT || '|' ||
    assignment."questionVersionId"::TEXT || '|' ||
    assignment."tagId"::TEXT || '|' ||
    assignment."labelSnapshot" || '|' ||
    assignment."normalizedNameSnapshot",
    E'\n' ORDER BY assignment."id"::TEXT COLLATE "C"
  ), 'UTF8'), 'sha256'::TEXT), 'hex')
  INTO assignment_digest
  FROM "QuestionVersionTag" AS assignment;

  SELECT encode(public.digest(convert_to(string_agg(
    applicability."tagId"::TEXT || '|' ||
    applicability."level"::TEXT || '|' ||
    applicability."subject"::TEXT || '|' ||
    applicability."questionType"::TEXT,
    E'\n' ORDER BY (
      applicability."tagId"::TEXT || '|' ||
      applicability."level"::TEXT || '|' ||
      applicability."subject"::TEXT || '|' ||
      applicability."questionType"::TEXT
    ) COLLATE "C"
  ), 'UTF8'), 'sha256'::TEXT), 'hex')
  INTO applicability_digest
  FROM "TagApplicability" AS applicability
  WHERE NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('짧은 글', 'N4', 'SHORT_READING'),
      ('정보 찾기', 'N4', 'INFO_RETRIEVAL'),
      ('중문 독해', 'N2', 'MEDIUM_READING'),
      ('정보 찾기', 'N2', 'INFO_RETRIEVAL'),
      ('행동 변화', 'N4', 'SHORT_READING'),
      ('재사용', 'N4', 'SHORT_READING'),
      ('요금', 'N4', 'INFO_RETRIEVAL'),
      ('예외 조건', 'N4', 'INFO_RETRIEVAL'),
      ('비교', 'N4', 'SHORT_READING'),
      ('선택 이유', 'N4', 'SHORT_READING'),
      ('행동 순서', 'N4', 'SHORT_READING'),
      ('요리', 'N4', 'SHORT_READING'),
      ('분리배출', 'N4', 'INFO_RETRIEVAL'),
      ('물품별 조건', 'N4', 'INFO_RETRIEVAL'),
      ('사례 종합', 'N2', 'MEDIUM_READING'),
      ('역사와 지속 이용', 'N2', 'MEDIUM_READING'),
      ('조사 해석', 'N2', 'MEDIUM_READING'),
      ('판단 근거', 'N2', 'MEDIUM_READING'),
      ('운영 조정', 'N2', 'MEDIUM_READING'),
      ('상충 요구', 'N2', 'MEDIUM_READING'),
      ('반환 연장', 'N2', 'INFO_RETRIEVAL'),
      ('복수 조건', 'N2', 'INFO_RETRIEVAL'),
      ('누적 상한', 'N2', 'INFO_RETRIEVAL'),
      ('다음 개실일', 'N2', 'INFO_RETRIEVAL')
    ) AS prior(label, level, question_type)
    JOIN "Tag" AS tag ON tag."normalizedName" = prior.label AND tag."label" = prior.label
    WHERE tag."id" = applicability."tagId" AND applicability."level" = prior.level::"JlptLevel"
      AND applicability."subject" = 'READING' AND applicability."questionType" = prior.question_type::"QuestionType"
  );

  SELECT encode(public.digest(convert_to(jsonb_build_object(
    'questions', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', question."id",
        'lifecycle', question."lifecycleStatus",
        'pointer', question."currentPublishedVersionId",
        'creator', question."createdByLabelSnapshot"
      ) ORDER BY question."id")
      FROM "Question" AS question
    ),
    'versions', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', version."id",
        'questionId', version."questionId",
        'versionNumber', version."versionNumber",
        'status', version."status",
        'level', version."level",
        'subject', version."subject",
        'questionType', version."questionType",
        'passage', version."passage",
        'questionText', version."questionText",
        'correctOptionId', version."correctOptionId",
        'explanationKo', version."explanationKo",
        'explanationJa', version."explanationJa",
        'difficulty', version."difficulty",
        'sourceType', version."sourceType",
        'rowVersion', version."rowVersion",
        'creator', version."createdByLabelSnapshot"
      ) ORDER BY version."id")
      FROM "QuestionVersion" AS version
    ),
    'options', (
      SELECT jsonb_agg(to_jsonb(option_row) ORDER BY option_row."id")
      FROM (
        SELECT "id", "questionVersionId", "label", "text", "ordinal"
        FROM "QuestionOption"
      ) AS option_row
    ),
    'tags', (
      SELECT jsonb_agg(to_jsonb(tag_row) ORDER BY tag_row."id")
      FROM (
        SELECT "id", "label", "normalizedName" FROM "Tag"
          WHERE "normalizedName" NOT IN ('행동 변화', '재사용', '요금', '예외 조건', '비교', '선택 이유', '행동 순서', '요리', '분리배출', '물품별 조건', '사례 종합', '역사와 지속 이용', '조사 해석', '판단 근거', '운영 조정', '상충 요구', '반환 연장', '복수 조건', '누적 상한', '다음 개실일')
      ) AS tag_row
    ),
    'assignments', (
      SELECT jsonb_agg(to_jsonb(assignment_row)
        ORDER BY assignment_row."id")
      FROM (
        SELECT "id", "questionVersionId", "tagId", "labelSnapshot"
        FROM "QuestionVersionTag"
      ) AS assignment_row
    )
  )::TEXT, 'UTF8'), 'sha256'::TEXT), 'hex') INTO semantic_digest;

  IF assignment_digest IS DISTINCT FROM
      'd129fccba730359b574914bf68d2e0af13a6b80ab11b6ce5269412fda3535584'
    OR applicability_digest IS DISTINCT FROM
      'adeca1ed1c85338c85aa3ec13299d43532f9bf4e0f0515775a29563567f4b078'
    OR semantic_digest IS DISTINCT FROM
      'b19be0f3cea53f0918c50f81f2e67978e0933595d3637aa07844b3b68683d103' THEN
    RAISE EXCEPTION 'Approved N4/N2 registration reviewed catalog digest drifted.'
      USING ERRCODE = '23514';
  END IF;
  -- Every prior added cell and identity must be exact, not just the counts.
  FOR existing IN
    SELECT * FROM (VALUES
      ('짧은 글', 'N4', 'SHORT_READING'),
      ('정보 찾기', 'N4', 'INFO_RETRIEVAL'),
      ('중문 독해', 'N2', 'MEDIUM_READING'),
      ('정보 찾기', 'N2', 'INFO_RETRIEVAL'),
      ('행동 변화', 'N4', 'SHORT_READING'),
      ('재사용', 'N4', 'SHORT_READING'),
      ('요금', 'N4', 'INFO_RETRIEVAL'),
      ('예외 조건', 'N4', 'INFO_RETRIEVAL'),
      ('비교', 'N4', 'SHORT_READING'),
      ('선택 이유', 'N4', 'SHORT_READING'),
      ('행동 순서', 'N4', 'SHORT_READING'),
      ('요리', 'N4', 'SHORT_READING'),
      ('분리배출', 'N4', 'INFO_RETRIEVAL'),
      ('물품별 조건', 'N4', 'INFO_RETRIEVAL'),
      ('사례 종합', 'N2', 'MEDIUM_READING'),
      ('역사와 지속 이용', 'N2', 'MEDIUM_READING'),
      ('조사 해석', 'N2', 'MEDIUM_READING'),
      ('판단 근거', 'N2', 'MEDIUM_READING'),
      ('운영 조정', 'N2', 'MEDIUM_READING'),
      ('상충 요구', 'N2', 'MEDIUM_READING'),
      ('반환 연장', 'N2', 'INFO_RETRIEVAL'),
      ('복수 조건', 'N2', 'INFO_RETRIEVAL'),
      ('누적 상한', 'N2', 'INFO_RETRIEVAL'),
      ('다음 개실일', 'N2', 'INFO_RETRIEVAL')
    ) AS prior(label, level, question_type)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM "Tag" AS tag JOIN "TagApplicability" AS applicability
      ON applicability."tagId" = tag."id" WHERE tag."label" = existing.label
      AND tag."normalizedName" = existing.label AND applicability."level" = existing.level::"JlptLevel"
      AND applicability."subject" = 'READING'
      AND applicability."questionType" = existing.question_type::"QuestionType") THEN
      RAISE EXCEPTION 'Batch7 prior24 applicability drifted.' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF (SELECT COUNT(*) FROM "Tag" WHERE "normalizedName" IN ('행동 변화', '재사용', '요금', '예외 조건', '비교', '선택 이유', '행동 순서', '요리', '분리배출', '물품별 조건', '사례 종합', '역사와 지속 이용', '조사 해석', '판단 근거', '운영 조정', '상충 요구', '반환 연장', '복수 조건', '누적 상한', '다음 개실일')) <> 20
    OR EXISTS (SELECT 1 FROM "Tag" WHERE "normalizedName" IN ('행동 변화', '재사용', '요금', '예외 조건', '비교', '선택 이유', '행동 순서', '요리', '분리배출', '물품별 조건', '사례 종합', '역사와 지속 이용', '조사 해석', '판단 근거', '운영 조정', '상충 요구', '반환 연장', '복수 조건', '누적 상한', '다음 개실일')
      AND ("label" IS DISTINCT FROM "normalizedName"
        OR "id"::TEXT !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR "createdAt" IS DISTINCT FROM prior_applied_at::timestamptz(3)
        OR "updatedAt" IS DISTINCT FROM prior_applied_at::timestamptz(3))) THEN
    RAISE EXCEPTION 'Batch7 prior20 identities or evidence timestamp drifted.' USING ERRCODE = '23514';
  END IF;
  FOR existing IN
    SELECT * FROM (VALUES
      ('짧은 글', 'bea9e51d-4631-4d41-865d-c5047697a0a9', 'N5', 'SHORT_READING', 2),
      ('정보 찾기', '3880f26a-07ab-4833-83c3-01747c810d61', 'N5', 'INFO_RETRIEVAL', 3),
      ('중문 독해', '0c4bdd12-58b2-407c-82be-fbbaf260eb30', 'N3', 'MEDIUM_READING', 2)
    ) AS originals(label, expected_id, original_level, original_type, expected_cells)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM "Tag" WHERE "id" = existing.expected_id::UUID
      AND "normalizedName" = existing.label AND "label" = existing.label)
      OR (SELECT COUNT(*) FROM "TagApplicability" WHERE "tagId" = existing.expected_id::UUID) <> existing.expected_cells
      OR NOT EXISTS (SELECT 1 FROM "TagApplicability" WHERE "tagId" = existing.expected_id::UUID
        AND "level" = existing.original_level::"JlptLevel" AND "subject" = 'READING'
        AND "questionType" = existing.original_type::"QuestionType") THEN
      RAISE EXCEPTION 'Batch7 original three reused identities drifted.' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM "Tag" WHERE "normalizedName" IN ('전달 메모', '보관 장소 변경', '우산', '옷 수거', '참여 조건', '두 이유 결합', '예약 변경', '이동 수단', '조건 변화', '신청 안내', '참가 이력', '마감 준비물', '자전거 보관', '날짜 기준 요금', '출입 시간')
    OR "label" IN ('전달 메모', '보관 장소 변경', '우산', '옷 수거', '참여 조건', '두 이유 결합', '예약 변경', '이동 수단', '조건 변화', '신청 안내', '참가 이력', '마감 준비물', '자전거 보관', '날짜 기준 요금', '출입 시간')) THEN
    RAISE EXCEPTION 'Batch7 new names must be absent; partial state is not repaired.' USING ERRCODE = '23514';
  END IF;
  SELECT jsonb_build_object(
    'tags', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t."id") FROM "Tag" t ),
    'applicability', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a."tagId", a."level", a."subject", a."questionType") FROM "TagApplicability" a ),
    'priorEvidence', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedN4N2ReadingTagRegistration" e),
    'questions', (SELECT jsonb_agg(to_jsonb(q) ORDER BY q."id") FROM "Question" q),
    'versions', (SELECT jsonb_agg(to_jsonb(v) ORDER BY v."id") FROM "QuestionVersion" v),
    'options', (SELECT jsonb_agg(to_jsonb(o) ORDER BY o."id") FROM "QuestionOption" o),
    'snapshots', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "QuestionVersionTag" s)
  ) INTO before_state;
  -- The installer embeds the same-target full128/151 checkpoint in this owned
  -- function body. A caller cannot supply or override this authority snapshot.
  IF encode(public.digest(convert_to(before_state::TEXT, 'UTF8'), 'sha256'), 'hex')
    IS DISTINCT FROM sealed_predecessor_digest THEN
    RAISE EXCEPTION 'Batch7 sealed predecessor rows drifted.' USING ERRCODE = '23514';
  END IF;
  -- Ordinal ordering makes the final synthetic test observe precisely tuple15.
  FOR approved IN
    SELECT * FROM (VALUES
      (1, '전달 메모', 'N4', 'SHORT_READING'),
      (2, '보관 장소 변경', 'N4', 'SHORT_READING'),
      (3, '우산', 'N4', 'SHORT_READING'),
      (4, '옷 수거', 'N4', 'SHORT_READING'),
      (5, '참여 조건', 'N4', 'SHORT_READING'),
      (6, '두 이유 결합', 'N4', 'SHORT_READING'),
      (7, '예약 변경', 'N4', 'SHORT_READING'),
      (8, '이동 수단', 'N4', 'SHORT_READING'),
      (9, '조건 변화', 'N4', 'SHORT_READING'),
      (10, '신청 안내', 'N4', 'INFO_RETRIEVAL'),
      (11, '참가 이력', 'N4', 'INFO_RETRIEVAL'),
      (12, '마감 준비물', 'N4', 'INFO_RETRIEVAL'),
      (13, '자전거 보관', 'N4', 'INFO_RETRIEVAL'),
      (14, '날짜 기준 요금', 'N4', 'INFO_RETRIEVAL'),
      (15, '출입 시간', 'N4', 'INFO_RETRIEVAL')
    ) AS manifest(ordinal, label, level, question_type) ORDER BY ordinal
  LOOP
    new_tag_id := public.gen_random_uuid();
    INSERT INTO "Tag" ("id", "label", "normalizedName", "createdAt", "updatedAt")
      VALUES (new_tag_id, approved.label, approved.label, NEW."appliedAt", NEW."appliedAt");
    INSERT INTO "TagApplicability" ("tagId", "level", "subject", "questionType")
      VALUES (new_tag_id, approved.level::"JlptLevel", 'READING', approved.question_type::"QuestionType");
  END LOOP;
  SELECT jsonb_build_object(
    'tags', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t."id") FROM "Tag" t WHERE t."normalizedName" NOT IN ('전달 메모', '보관 장소 변경', '우산', '옷 수거', '참여 조건', '두 이유 결합', '예약 변경', '이동 수단', '조건 변화', '신청 안내', '참가 이력', '마감 준비물', '자전거 보관', '날짜 기준 요금', '출입 시간')),
    'applicability', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a."tagId", a."level", a."subject", a."questionType") FROM "TagApplicability" a WHERE a."tagId" NOT IN (SELECT "id" FROM "Tag" WHERE "normalizedName" IN ('전달 메모', '보관 장소 변경', '우산', '옷 수거', '참여 조건', '두 이유 결합', '예약 변경', '이동 수단', '조건 변화', '신청 안내', '참가 이력', '마감 준비물', '자전거 보관', '날짜 기준 요금', '출입 시간'))),
    'priorEvidence', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedN4N2ReadingTagRegistration" e),
    'questions', (SELECT jsonb_agg(to_jsonb(q) ORDER BY q."id") FROM "Question" q),
    'versions', (SELECT jsonb_agg(to_jsonb(v) ORDER BY v."id") FROM "QuestionVersion" v),
    'options', (SELECT jsonb_agg(to_jsonb(o) ORDER BY o."id") FROM "QuestionOption" o),
    'snapshots', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "QuestionVersionTag" s)
  ) INTO after_state;
  IF before_state IS DISTINCT FROM after_state
    OR (SELECT COUNT(*) FROM "Tag") <> 143
    OR (SELECT COUNT(*) FROM "TagApplicability") <> 166 THEN
    RAISE EXCEPTION 'Batch7 changed predecessor rows or exceeded exact15/15.' USING ERRCODE = '23514';
  END IF;
  SELECT encode(public.digest(string_agg(
    convert_to(tag."normalizedName", 'UTF8') || decode('00', 'hex') ||
    convert_to(cell."level"::TEXT, 'UTF8') || decode('00', 'hex') ||
    convert_to(cell."subject"::TEXT, 'UTF8') || decode('00', 'hex') ||
    convert_to(cell."questionType"::TEXT || E'\n', 'UTF8'),
    decode('', 'hex') ORDER BY tag."normalizedName" COLLATE "C"
  ), 'sha256'), 'hex') INTO applicability_digest
  FROM "Tag" tag JOIN "TagApplicability" cell ON cell."tagId" = tag."id"
  WHERE tag."normalizedName" IN ('전달 메모', '보관 장소 변경', '우산', '옷 수거', '참여 조건', '두 이유 결합', '예약 변경', '이동 수단', '조건 변화', '신청 안내', '참가 이력', '마감 준비물', '자전거 보관', '날짜 기준 요금', '출입 시간');
  IF applicability_digest IS DISTINCT FROM '24c51afa35eb85ec0de9a08b6a88bb3608ed558b6c2f1535a6ab042ac5fd77db'
    OR EXISTS (SELECT 1 FROM "Tag" WHERE "normalizedName" IN ('전달 메모', '보관 장소 변경', '우산', '옷 수거', '참여 조건', '두 이유 결합', '예약 변경', '이동 수단', '조건 변화', '신청 안내', '참가 이력', '마감 준비물', '자전거 보관', '날짜 기준 요금', '출입 시간')
      AND ("label" IS DISTINCT FROM "normalizedName"
        OR "createdAt" IS DISTINCT FROM NEW."appliedAt"::timestamptz(3)
        OR "updatedAt" IS DISTINCT FROM NEW."appliedAt"::timestamptz(3))) THEN
    RAISE EXCEPTION 'Batch7 final15 identities or exact tuple digest drifted.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION "register_phase7_approved_n4_reading_batch7_tag_rows"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker", "nihongo_phase7_migration";
CREATE TRIGGER "Phase7ApprovedN4ReadingBatch7TagRegistration_exact_fifteen"
BEFORE INSERT ON "Phase7ApprovedN4ReadingBatch7TagRegistration"
FOR EACH ROW EXECUTE FUNCTION "register_phase7_approved_n4_reading_batch7_tag_rows"();

CREATE FUNCTION "apply_phase7_approved_n4_reading_batch7_tags"()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path FROM CURRENT AS $function$
BEGIN
  INSERT INTO "Phase7ApprovedN4ReadingBatch7TagRegistration" ("batch")
    VALUES ('jlp-470-n4-reading-batch7-tags-v1');
END;
$function$;
REVOKE ALL ON FUNCTION "apply_phase7_approved_n4_reading_batch7_tags"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker", "nihongo_phase7_migration";
GRANT EXECUTE ON FUNCTION "apply_phase7_approved_n4_reading_batch7_tags"() TO "nihongo_phase7_migration";
DO $harden$
DECLARE
  target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema');
  function_name TEXT;
  predecessor_state JSONB;
  predecessor_digest TEXT;
  function_definition TEXT;
  predecessor_count BIGINT;
  ledger_digest TEXT;
  installation_profile TEXT;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'protect_phase7_approved_n4_reading_batch7_tag_registration',
    'register_phase7_approved_n4_reading_batch7_tag_rows',
    'apply_phase7_approved_n4_reading_batch7_tags'
  ] LOOP
    EXECUTE pg_catalog.format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp', target_schema, function_name, target_schema);
  END LOOP;
  -- Locks from $predecessor$ still protect this exact target until COMMIT.
  -- Derive the immutable profile from its ledger, never from caller settings.
  SELECT COUNT(*), encode(public.digest(string_agg(
    convert_to("migration_name", 'UTF8') || decode('00', 'hex') ||
      convert_to("checksum" || E'\n', 'UTF8'),
    decode('', 'hex') ORDER BY "migration_name" COLLATE "C"
  ), 'sha256'), 'hex') INTO predecessor_count, ledger_digest
  FROM "_prisma_migrations"
  WHERE "migration_name" <> '20261009120000_phase7_approved_n4_reading_batch7_tags';
  IF predecessor_count = 36 AND ledger_digest = '96eebebc8d76d1eb858b1cc12d7559685a5e06559a57ff8d9aabdf3b067e3ab3' THEN
    installation_profile := 'LEGACY_CANONICAL36';
  ELSIF predecessor_count = 37 AND ledger_digest = '89158202b48454a0d179913983fe1449dc139c0db25aec0ba4c5480040291aad' THEN
    installation_profile := 'CURRENT_PHYSICAL37';
  ELSE
    RAISE EXCEPTION 'Batch7 installation profile seal drifted.' USING ERRCODE = '23514';
  END IF;
  SELECT jsonb_build_object(
    'tags', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t."id") FROM "Tag" t ),
    'applicability', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a."tagId", a."level", a."subject", a."questionType") FROM "TagApplicability" a ),
    'priorEvidence', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedN4N2ReadingTagRegistration" e),
    'questions', (SELECT jsonb_agg(to_jsonb(q) ORDER BY q."id") FROM "Question" q),
    'versions', (SELECT jsonb_agg(to_jsonb(v) ORDER BY v."id") FROM "QuestionVersion" v),
    'options', (SELECT jsonb_agg(to_jsonb(o) ORDER BY o."id") FROM "QuestionOption" o),
    'snapshots', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "QuestionVersionTag" s)
  ) INTO predecessor_state;
  predecessor_digest := encode(public.digest(convert_to(predecessor_state::TEXT, 'UTF8'), 'sha256'), 'hex');
  -- Custom placeholder parameters require SET authority for function proconfig.
  -- Replace only this new function's constant, retaining its owner, ACL and path.
  function_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    pg_catalog.format('%I.register_phase7_approved_n4_reading_batch7_tag_rows()', target_schema)
  ));
  IF function_definition IS NULL OR pg_catalog.strpos(function_definition,
    pg_catalog.quote_literal('JLP478_BATCH7_PREDECESSOR_DIGEST_UNSET')) = 0
    OR pg_catalog.strpos(function_definition, pg_catalog.quote_literal('JLP483_BATCH7_PROFILE_UNSET')) = 0 THEN
    RAISE EXCEPTION 'Batch7 predecessor digest seal is missing.' USING ERRCODE = '23514';
  END IF;
  function_definition := pg_catalog.replace(function_definition,
    pg_catalog.quote_literal('JLP478_BATCH7_PREDECESSOR_DIGEST_UNSET'),
    pg_catalog.quote_literal(predecessor_digest));
  EXECUTE pg_catalog.replace(function_definition,
    pg_catalog.quote_literal('JLP483_BATCH7_PROFILE_UNSET'),
    pg_catalog.quote_literal(installation_profile));
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.register_phase7_approved_n4_reading_batch7_tag_rows() SET TimeZone TO UTC', target_schema);
END;
$harden$;
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
