-- JLP-449 / contracts JLP-445 / QA JLP-446: install a fixed 20-name/24-tuple command.
-- Migration alone registers no tags. Apply only after canonical35 bootstrap (excluding current-catalog)
-- (65 questions / 108 tags / 127 applicability), before any content import or
-- N5/N4/N2 tag command. The separate current-catalog 107/126 profile is rejected.
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

CREATE TABLE "Phase7ApprovedN4N2ReadingTagRegistration" (
  "batch" TEXT PRIMARY KEY CHECK ("batch" = 'jlp-449-n4-n2-reading-tags-v1'),
  "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
REVOKE ALL ON TABLE "Phase7ApprovedN4N2ReadingTagRegistration"
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

CREATE FUNCTION "protect_phase7_approved_n4_n2_reading_tag_registration"()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'Approved N4/N2 tag registration evidence is immutable.'
    USING ERRCODE = '42501';
END;
$function$;
REVOKE ALL ON FUNCTION "protect_phase7_approved_n4_n2_reading_tag_registration"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
CREATE TRIGGER "Phase7ApprovedN4N2ReadingTagRegistration_immutable"
BEFORE UPDATE OR DELETE ON "Phase7ApprovedN4N2ReadingTagRegistration"
FOR EACH ROW EXECUTE FUNCTION "protect_phase7_approved_n4_n2_reading_tag_registration"();

CREATE TRIGGER "Phase7ApprovedN4N2ReadingTagRegistration_no_truncate"
BEFORE TRUNCATE ON "Phase7ApprovedN4N2ReadingTagRegistration"
FOR EACH STATEMENT EXECUTE FUNCTION "protect_phase7_approved_n4_n2_reading_tag_registration"();

CREATE FUNCTION "register_phase7_approved_n4_n2_reading_tag_rows"()
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
BEGIN
  IF TG_OP <> 'INSERT' OR pg_trigger_depth() <> 1
    OR NEW."batch" <> 'jlp-449-n4-n2-reading-tags-v1' THEN
    RAISE EXCEPTION 'Unapproved N4/N2 tag registration.' USING ERRCODE = '42501';
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
    "Phase7ApprovedN4N2ReadingTagRegistration" IN SHARE ROW EXCLUSIVE MODE;
  IF (SELECT COUNT(*) FROM "Question") <> 65
    OR (SELECT COUNT(*) FROM "QuestionVersion") <> 65
    OR (SELECT COUNT(*) FROM "QuestionOption") <> 260
    OR (SELECT COUNT(*) FROM "Tag") <> 108
    OR (SELECT COUNT(*) FROM "TagApplicability") <> 127
    OR EXISTS (SELECT 1 FROM "Phase7ApprovedReadingTagRegistration")
    OR (SELECT COUNT(*) FROM "QuestionVersionTag") <> 130
    OR EXISTS (SELECT 1 FROM "ContentReview")
    OR EXISTS (SELECT 1 FROM "AdminAuditLog")
    OR EXISTS (SELECT 1 FROM "QuestionReport")
    OR EXISTS (SELECT 1 FROM "Phase7OperationIntent")
    OR EXISTS (SELECT 1 FROM "Phase7ApprovedN3ReadingTagRegistration")
    OR EXISTS (SELECT 1 FROM "Phase7ApprovedN4N2ReadingTagRegistration") THEN
    RAISE EXCEPTION 'Approved N4/N2 registration requires the unchanged canonical bootstrap.'
      USING ERRCODE = '23514';
  END IF;

  -- Pin the completed canonical34 prefix; this installation is its sole append.
  -- Bytea aggregation preserves the manifest's NUL/LF digest encoding.
  IF (SELECT COUNT(*) FROM "_prisma_migrations") <> 35
    OR (SELECT COUNT(*) FROM "_prisma_migrations"
        WHERE "migration_name" = '20261009072500_phase7_approved_n4_n2_reading_tags') <> 1
    OR EXISTS (SELECT 1 FROM "_prisma_migrations"
        WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL
          OR COALESCE(btrim("logs"), '') <> ''
          OR "checksum" !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'Approved registration requires the completed canonical35 ledger.' USING ERRCODE = '23514';
  END IF;
  SELECT encode(public.digest(string_agg(
    convert_to("migration_name", 'UTF8') || decode('00', 'hex') ||
      convert_to("checksum" || E'\n', 'UTF8'),
    decode('', 'hex') ORDER BY "migration_name" COLLATE "C"
  ), 'sha256'), 'hex') INTO ledger_digest
  FROM "_prisma_migrations"
  WHERE "migration_name" <> '20261009072500_phase7_approved_n4_n2_reading_tags';
  IF ledger_digest IS DISTINCT FROM
    '4448f7aa40804bb3058f1a986c6af5527eb26ca7375973bcca320fa1bf51d7f8' THEN
    RAISE EXCEPTION 'Approved registration canonical34 ledger prefix drifted.' USING ERRCODE = '23514';
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
      WHERE "createdAt" <> '2026-01-01T00:00:00Z'::timestamptz
        OR "updatedAt" <> '2026-01-01T00:00:00Z'::timestamptz) THEN
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

  IF assignment_digest IS DISTINCT FROM
      '4e3f91b5341b90fed7064fc3d810cf5d6cfa581707012e92440c8b041e1130b1'
    OR applicability_digest IS DISTINCT FROM
      'adeca1ed1c85338c85aa3ec13299d43532f9bf4e0f0515775a29563567f4b078'
    OR semantic_digest IS DISTINCT FROM
      'a180a0ea8dac51200b533fbe99624036fc19984be9cfbdd0c972c624e764444c' THEN
    RAISE EXCEPTION 'Approved N4/N2 registration reviewed catalog digest drifted.'
      USING ERRCODE = '23514';
  END IF;
  FOR existing IN
    SELECT * FROM (VALUES
      ('짧은 글', 'N5', 'SHORT_READING'),
      ('정보 찾기', 'N5', 'INFO_RETRIEVAL'),
      ('중문 독해', 'N3', 'MEDIUM_READING')
    ) AS originals(label, level, question_type)
  LOOP
    SELECT "id" INTO new_tag_id FROM "Tag"
      WHERE "normalizedName" = existing.label AND "label" = existing.label FOR UPDATE;
    IF new_tag_id IS NULL
      OR (SELECT COUNT(*) FROM "TagApplicability" WHERE "tagId" = new_tag_id) <> 1
      OR NOT EXISTS (SELECT 1 FROM "TagApplicability" WHERE "tagId" = new_tag_id
        AND "level" = existing.level::"JlptLevel" AND "subject" = 'READING'
        AND "questionType" = existing.question_type::"QuestionType") THEN
      RAISE EXCEPTION 'Approved original tag identity or applicability drifted.' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM "Tag" WHERE "normalizedName" IN ('행동 변화', '재사용', '요금', '예외 조건', '비교', '선택 이유', '행동 순서', '요리', '분리배출', '물품별 조건', '사례 종합', '역사와 지속 이용', '조사 해석', '판단 근거', '운영 조정', '상충 요구', '반환 연장', '복수 조건', '누적 상한', '다음 개실일')) THEN
    RAISE EXCEPTION 'Approved new names must be absent; partial state is not repaired.' USING ERRCODE = '23514';
  END IF;

  -- Reuse3 global IDs for4 missing cells, then generate20 new global IDs once.
  -- No aliases/upsert/parameters; the unchanged applicability guard runs nested.
  FOR approved IN
    SELECT * FROM (VALUES
      ('짧은 글', 'N4', 'SHORT_READING', false),
      ('정보 찾기', 'N4', 'INFO_RETRIEVAL', false),
      ('중문 독해', 'N2', 'MEDIUM_READING', false),
      ('정보 찾기', 'N2', 'INFO_RETRIEVAL', false),
      ('행동 변화', 'N4', 'SHORT_READING', true),
      ('재사용', 'N4', 'SHORT_READING', true),
      ('요금', 'N4', 'INFO_RETRIEVAL', true),
      ('예외 조건', 'N4', 'INFO_RETRIEVAL', true),
      ('비교', 'N4', 'SHORT_READING', true),
      ('선택 이유', 'N4', 'SHORT_READING', true),
      ('행동 순서', 'N4', 'SHORT_READING', true),
      ('요리', 'N4', 'SHORT_READING', true),
      ('분리배출', 'N4', 'INFO_RETRIEVAL', true),
      ('물품별 조건', 'N4', 'INFO_RETRIEVAL', true),
      ('사례 종합', 'N2', 'MEDIUM_READING', true),
      ('역사와 지속 이용', 'N2', 'MEDIUM_READING', true),
      ('조사 해석', 'N2', 'MEDIUM_READING', true),
      ('판단 근거', 'N2', 'MEDIUM_READING', true),
      ('운영 조정', 'N2', 'MEDIUM_READING', true),
      ('상충 요구', 'N2', 'MEDIUM_READING', true),
      ('반환 연장', 'N2', 'INFO_RETRIEVAL', true),
      ('복수 조건', 'N2', 'INFO_RETRIEVAL', true),
      ('누적 상한', 'N2', 'INFO_RETRIEVAL', true),
      ('다음 개실일', 'N2', 'INFO_RETRIEVAL', true)
    ) AS manifest(label, level, question_type, is_new)
  LOOP
    IF approved.is_new THEN
      new_tag_id := public.gen_random_uuid();
      INSERT INTO "Tag" ("id", "label", "normalizedName", "createdAt", "updatedAt")
        VALUES (new_tag_id, approved.label, approved.label, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    ELSE
      SELECT "id" INTO new_tag_id FROM "Tag"
        WHERE "normalizedName" = approved.label AND "label" = approved.label;
    END IF;
    INSERT INTO "TagApplicability" ("tagId", "level", "subject", "questionType")
      VALUES (new_tag_id, approved.level::"JlptLevel", 'READING', approved.question_type::"QuestionType");
  END LOOP;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION "register_phase7_approved_n4_n2_reading_tag_rows"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
CREATE TRIGGER "Phase7ApprovedN4N2ReadingTagRegistration_exact_twenty_four"
BEFORE INSERT ON "Phase7ApprovedN4N2ReadingTagRegistration"
FOR EACH ROW EXECUTE FUNCTION "register_phase7_approved_n4_n2_reading_tag_rows"();

CREATE FUNCTION "apply_phase7_approved_n4_n2_reading_tags"()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path FROM CURRENT AS $function$
BEGIN
  INSERT INTO "Phase7ApprovedN4N2ReadingTagRegistration" ("batch")
    VALUES ('jlp-449-n4-n2-reading-tags-v1');
END;
$function$;
REVOKE ALL ON FUNCTION "apply_phase7_approved_n4_n2_reading_tags"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "apply_phase7_approved_n4_n2_reading_tags"() TO "nihongo_phase7_migration";
DO $harden$
DECLARE
  target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema');
  function_name TEXT;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'protect_phase7_approved_n4_n2_reading_tag_registration',
    'register_phase7_approved_n4_n2_reading_tag_rows',
    'apply_phase7_approved_n4_n2_reading_tags'
  ] LOOP
    EXECUTE pg_catalog.format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp', target_schema, function_name, target_schema);
  END LOOP;
END;
$harden$;
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
