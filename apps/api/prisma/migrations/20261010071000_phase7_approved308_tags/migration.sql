-- JLP-478 approved308: objects-only successor, current physical38 ONLY.
-- Inventory adbbaf21660607b509a4a95fe68604bbdbe28ee897a053c1f0889141f1057a81.
-- Original65/107/126 stays immutable; the closed command adds293 names/323 cells.
-- No question import/publication, aliases, repair, historical command or ACL changes.
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
DECLARE predecessor_count BIGINT; ledger_digest TEXT;
  assignment_digest TEXT; applicability_digest TEXT; semantic_digest TEXT;
BEGIN
  LOCK TABLE "Tag", "TagApplicability", "Question", "QuestionVersion", "QuestionOption", "QuestionVersionTag", "ContentReview", "AdminAuditLog", "QuestionReport", "Phase7OperationIntent", "_prisma_migrations", "Phase7ApprovedReadingTagRegistration", "Phase7ApprovedN3ReadingTagRegistration", "Phase7ApprovedN4N2ReadingTagRegistration", "Phase7ApprovedN4ReadingBatch7TagRegistration" IN SHARE ROW EXCLUSIVE MODE;
  IF (SELECT COUNT(*) FROM "_prisma_migrations" WHERE "migration_name" = '20261010071000_phase7_approved308_tags') > 1
    OR EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" <> '20261010071000_phase7_approved308_tags'
      AND ("finished_at" IS NULL OR "rolled_back_at" IS NOT NULL
        OR COALESCE(btrim("logs"), '') <> '' OR "applied_steps_count" <> 1
        OR "checksum" !~ '^[0-9a-f]{64}$')) THEN
    RAISE EXCEPTION 'Approved308 requires completed current38 predecessor rows.' USING ERRCODE = '23514';
  END IF;
  SELECT COUNT(*), encode(public.digest(string_agg(
    convert_to("migration_name", 'UTF8') || decode('00', 'hex') ||
      convert_to("checksum" || E'\n', 'UTF8'),
    decode('', 'hex') ORDER BY "migration_name" COLLATE "C"
  ), 'sha256'), 'hex') INTO predecessor_count, ledger_digest
  FROM "_prisma_migrations" WHERE "migration_name" <> '20261010071000_phase7_approved308_tags';
  IF predecessor_count <> 38 OR ledger_digest IS DISTINCT FROM '6aa49828fc3138b2b544830794cad68c05ed11ae2ffa018b9e43a2800cb578dd' THEN
    RAISE EXCEPTION 'Approved308 exact current38 ledger prefix drifted.' USING ERRCODE = '23514';
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
      OR EXISTS (SELECT 1 FROM "Phase7ApprovedN4N2ReadingTagRegistration")
      OR EXISTS (SELECT 1 FROM "Phase7ApprovedN4ReadingBatch7TagRegistration") THEN
      RAISE EXCEPTION 'Approved308 current installation requires the unchanged65/107/126 bootstrap.' USING ERRCODE = '23514';
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
      RAISE EXCEPTION 'Approved308 current installation requires original seed identities and snapshots.' USING ERRCODE = '23514';
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
      RAISE EXCEPTION 'Approved308 current reviewed catalog digest drifted.' USING ERRCODE = '23514';
    END IF;
END;
$predecessor$;

CREATE TABLE "Phase7Approved308TagRegistration" (
  "batch" TEXT PRIMARY KEY CHECK ("batch" = 'jlp-478-approved308-adbbaf21-v1'),
  "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
REVOKE ALL ON TABLE "Phase7Approved308TagRegistration"
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker", "nihongo_phase7_migration";
CREATE FUNCTION "protect_phase7_approved308_tag_registration"()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'Approved308 registration evidence is immutable.' USING ERRCODE = '42501';
END;
$function$;
REVOKE ALL ON FUNCTION "protect_phase7_approved308_tag_registration"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker", "nihongo_phase7_migration";
CREATE TRIGGER "Phase7Approved308TagRegistration_immutable"
BEFORE UPDATE OR DELETE ON "Phase7Approved308TagRegistration" FOR EACH ROW
EXECUTE FUNCTION "protect_phase7_approved308_tag_registration"();
CREATE TRIGGER "Phase7Approved308TagRegistration_no_truncate"
BEFORE TRUNCATE ON "Phase7Approved308TagRegistration" FOR EACH STATEMENT
EXECUTE FUNCTION "protect_phase7_approved308_tag_registration"();

CREATE FUNCTION "register_phase7_approved308_tag_rows"()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path FROM CURRENT AS $function$
DECLARE
  approved RECORD; target_tag_id UUID;
  predecessor_count BIGINT; ledger_digest TEXT;
  before_state JSONB; after_state JSONB; tuple_digest TEXT;
  sealed_predecessor_digest CONSTANT TEXT := 'JLP478_APPROVED308_PREDECESSOR_UNSET';
BEGIN
  IF TG_OP <> 'INSERT' OR pg_trigger_depth() <> 1 OR NEW."batch" <> 'jlp-478-approved308-adbbaf21-v1' THEN
    RAISE EXCEPTION 'Unapproved308 registration.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n
    JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
    WHERE n.nspname = TG_TABLE_SCHEMA AND r.rolname = 'nihongo_phase7_owner') THEN
    RAISE EXCEPTION 'Approved308 schema owner drifted.' USING ERRCODE = '42501';
  END IF;
  LOCK TABLE "Tag", "TagApplicability", "Question", "QuestionVersion", "QuestionOption", "QuestionVersionTag", "ContentReview", "AdminAuditLog", "QuestionReport", "Phase7OperationIntent", "_prisma_migrations", "Phase7ApprovedReadingTagRegistration", "Phase7ApprovedN3ReadingTagRegistration", "Phase7ApprovedN4N2ReadingTagRegistration", "Phase7ApprovedN4ReadingBatch7TagRegistration", "Phase7Approved308TagRegistration" IN SHARE ROW EXCLUSIVE MODE;
  IF (SELECT COUNT(*) FROM "_prisma_migrations") <> 39
    OR (SELECT COUNT(*) FROM "_prisma_migrations" WHERE "migration_name" = '20261010071000_phase7_approved308_tags') <> 1
    OR EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE "finished_at" IS NULL
      OR "rolled_back_at" IS NOT NULL OR COALESCE(btrim("logs"), '') <> ''
      OR "applied_steps_count" <> 1 OR "checksum" !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'Approved308 requires the completed current39 ledger.' USING ERRCODE = '23514';
  END IF;
  IF (SELECT COUNT(*) FROM "_prisma_migrations" WHERE "migration_name" = '20261010071000_phase7_approved308_tags') > 1
    OR EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" <> '20261010071000_phase7_approved308_tags'
      AND ("finished_at" IS NULL OR "rolled_back_at" IS NOT NULL
        OR COALESCE(btrim("logs"), '') <> '' OR "applied_steps_count" <> 1
        OR "checksum" !~ '^[0-9a-f]{64}$')) THEN
    RAISE EXCEPTION 'Approved308 requires completed current38 predecessor rows.' USING ERRCODE = '23514';
  END IF;
  SELECT COUNT(*), encode(public.digest(string_agg(
    convert_to("migration_name", 'UTF8') || decode('00', 'hex') ||
      convert_to("checksum" || E'\n', 'UTF8'),
    decode('', 'hex') ORDER BY "migration_name" COLLATE "C"
  ), 'sha256'), 'hex') INTO predecessor_count, ledger_digest
  FROM "_prisma_migrations" WHERE "migration_name" <> '20261010071000_phase7_approved308_tags';
  IF predecessor_count <> 38 OR ledger_digest IS DISTINCT FROM '6aa49828fc3138b2b544830794cad68c05ed11ae2ffa018b9e43a2800cb578dd' THEN
    RAISE EXCEPTION 'Approved308 exact current38 ledger prefix drifted.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "Phase7Approved308TagRegistration") THEN
    RAISE EXCEPTION 'Approved308 registration is one-shot.' USING ERRCODE = '23514';
  END IF;
  SELECT jsonb_build_object(
    'tags', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t."id") FROM "Tag" t),
    'applicability', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a."tagId", a."level", a."subject", a."questionType") FROM "TagApplicability" a),
    'questions', (SELECT jsonb_agg(to_jsonb(q) ORDER BY q."id") FROM "Question" q),
    'versions', (SELECT jsonb_agg(to_jsonb(v) ORDER BY v."id") FROM "QuestionVersion" v),
    'options', (SELECT jsonb_agg(to_jsonb(o) ORDER BY o."id") FROM "QuestionOption" o),
    'snapshots', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "QuestionVersionTag" s),
    'review', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r."id") FROM "ContentReview" r),
    'audit', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l."id") FROM "AdminAuditLog" l),
    'reports', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p."id") FROM "QuestionReport" p),
    'intent', (SELECT jsonb_agg(to_jsonb(i) ORDER BY i."operationId") FROM "Phase7OperationIntent" i),
    'priorEvidence0', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedReadingTagRegistration" e),
    'priorEvidence1', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedN3ReadingTagRegistration" e),
    'priorEvidence2', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedN4N2ReadingTagRegistration" e),
    'priorEvidence3', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedN4ReadingBatch7TagRegistration" e)
  ) INTO before_state;
  IF encode(public.digest(convert_to(before_state::TEXT, 'UTF8'), 'sha256'), 'hex')
      IS DISTINCT FROM sealed_predecessor_digest THEN
    RAISE EXCEPTION 'Approved308 sealed current65/107/126 rows drifted.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "Tag" WHERE "normalizedName" IN ('あながち', 'いかんでは', 'い형용사 과거', 'おおむね', 'かった', 'からまで', 'そうだ', 'その結果', 'それでも', 'それに', 'たことがある', 'たり', 'たるもの', 'だけでは', 'ちいさい', 'ておく', 'てきた', 'てはいけません', 'て初めて', 'で', 'ところが', 'とたんに', 'とは限らない', 'ともなると', 'どころか', 'なければならない', 'な형용사 연결', 'につれて', 'に先立って', 'に応じて', 'に限らず', 'はく', 'ば', 'まで', 'も', 'ものだから', 'ものを', 'より', 'を問わず', '一方で', '二百', '右', '山', '延期', '手順', '打開', '是正', '次第で', '甚大', '省く', '購入', '遵守', '隠蔽', '가치 판단', '감사', '개별 승낙', '개요', '개인 가치', '거리', '격차', '결과 연결', '결론 이유', '결석 자료', '결승전', '결정 과정', '경로 선택', '경로와 기한', '경험', '경험의 조건', '계획 유지', '공공시설', '공동 발표', '공동 작업실', '관점 대비', '관점 변화', '관찰과 체험', '교정 요청', '교착 해결', '구매', '금액', '금지', '기대와 실제', '기록', '날씨', '날짜 기준 요금', '내용 추가', '논지 종합', '놓친 기회', '누적 상한', '다음 개실일', '다음 시도', '단가', '담당 구분', '대략', '대리 수령', '대여 방향', '대응 기준', '도서관', '독립 조건', '동반 변화', '동음어', '두 요구', '두 이유 결합', '두 장점', '등록 후 변경', '마감 준비물', '목적 이해', '목적 확인', '무료와 절차', '문맥 어휘', '문맥 의미', '문장문법', '물리적 지지', '물품별 조건', '미끄러짐', '미래 대비', '반례', '반환 연장', '방', '방향', '범위 확장', '범위와 예외', '변경 방향', '변화 진행', '변화 평가', '보관 반환', '보관 장소 변경', '복수 조건', '부족 조건', '부족분 보충', '분리배출', '분반', '불문', '비', '비교', '비교 기록', '사례 종합', '사용법', '사용자 검증', '사전 조치', '사전 준비', '사정 설명', '상담', '상충 요구', '생략', '생활 환경', '선의와 자유', '선택', '선택 이유', '설명 방식', '설명회', '소식 반응', '소유권과 관리', '소중함', '수량', '수량 변화', '수령 경로 비교', '수령 방식 구분', '수리 가능성', '수영장', '순간', '승인', '시각 장소', '시간 요금', '시도 비교', '시설 안내', '시설 요금', '시작점 끝점', '시점 구별', '식사', '신청 안내', '신청시각 기준', '안전 검사', '약속 정보', '양보 연결', '어미 구별', '얼어붙은 길', '업무 연락', '업무 인계', '역사와 지속 이용', '역할 대비', '역할별 조건', '연속성과 적응', '연장 상한', '영화', '예상 밖', '예약 변경', '예외 조건', '예정 변경', '옷 수거', '완료와 미완료', '요금', '요리', '요청', '용도별 신청', '용법', '우산', '운반', '운영 조정', '운영시간 준비물', '원인과 결과', '유사 독음', '유사 한자', '유사한자', '유지 정보', '음성 기록', '음성 안내기', '음주', '의무', '의존 조건', '이동 수단', '이동 시간', '이점과 부담', '이해 정도', '인물 정보', '인용 맥락', '인원', '일반화 제한', '임시 체류', '입장권 유효기간', '자동사 타동사', '자료 보관', '자전거 보관', '자제', '작업', '작업과 휴식', '장문 독해', '장음 탁음', '재검토 조건', '재료', '재사용', '전달 메모', '전문가 상담', '전언', '전체와 세부', '전화', '접수', '정도 대조', '정리', '정보 누락', '정보 출처', '제한적 판단', '조건', '조건 내용', '조건 변화', '조건과 결과', '조건별 기한', '조건별 장소', '조건형', '조사 해석', '종료 시점', '준비물', '준비물 예외', '지시어', '지위 당위', '지탱', '진행과 상태', '짐 이동', '착용', '참가 이력', '참가 증명', '참여 과정', '참여 기회', '참여 조건', '초대', '최초 가능', '추가 조사', '출입 시간', '친절', '침묵과 동의', '크기', '택배 수령', '통학', '특별한 단계', '판단 근거', '편리함', '평소와 예외', '포함과 제외', '표기', '표정', '피해', '학년 시간', '해석의 근거', '행동 나열', '행동 변화', '행동 순서', '행동 시기', '행동 주체', '행동 확인', '혼잡 회피', '환기', '후기', '휴일')) THEN
    RAISE EXCEPTION 'Approved308 new names must be absent; partial state is not repaired.' USING ERRCODE = '23514';
  END IF;
  FOR approved IN SELECT * FROM (VALUES
      (1, 'あながち', 'あながち', 'N1', 'VOCABULARY', 'PARAPHRASE'),
      (2, 'いかんでは', 'いかんでは', 'N1', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (3, 'い형용사 과거', 'い형용사 과거', 'N5', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (4, 'おおむね', 'おおむね', 'N2', 'VOCABULARY', 'PARAPHRASE'),
      (5, 'かった', 'かった', 'N5', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (6, 'からまで', 'からまで', 'N5', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (7, 'そうだ', 'そうだ', 'N3', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (8, 'その結果', 'その結果', 'N4', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (9, 'それでも', 'それでも', 'N4', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (10, 'それに', 'それに', 'N4', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (11, 'たことがある', 'たことがある', 'N4', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (12, 'たり', 'たり', 'N4', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (13, 'たるもの', 'たるもの', 'N1', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (14, 'だけでは', 'だけでは', 'N3', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (15, 'ちいさい', 'ちいさい', 'N5', 'VOCABULARY', 'PARAPHRASE'),
      (16, 'ておく', 'ておく', 'N4', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (17, 'てきた', 'てきた', 'N3', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (18, 'てはいけません', 'てはいけません', 'N5', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (19, 'て初めて', 'て初めて', 'N2', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (20, 'で', 'で', 'N5', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (21, 'ところが', 'ところが', 'N4', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (22, 'とたんに', 'とたんに', 'N3', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (23, 'とは限らない', 'とは限らない', 'N2', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (24, 'ともなると', 'ともなると', 'N1', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (25, 'どころか', 'どころか', 'N1', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (26, 'なければならない', 'なければならない', 'N4', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (27, 'な형용사 연결', 'な형용사 연결', 'N5', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (28, 'につれて', 'につれて', 'N2', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (29, 'に先立って', 'に先立って', 'N2', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (30, 'に応じて', 'に応じて', 'N2', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (31, 'に限らず', 'に限らず', 'N2', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (32, 'はく', 'はく', 'N5', 'VOCABULARY', 'WORD_USAGE'),
      (33, 'ば', 'ば', 'N4', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (34, 'まで', 'まで', 'N3', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (35, 'も', 'も', 'N5', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (36, 'ものだから', 'ものだから', 'N2', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (37, 'ものを', 'ものを', 'N1', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (38, 'より', 'より', 'N4', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (39, 'を問わず', 'を問わず', 'N2', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (40, '一方で', '一方で', 'N2', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (41, '二百', '二百', 'N5', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (42, '右', '右', 'N5', 'VOCABULARY', 'ORTHOGRAPHY'),
      (43, '山', '山', 'N5', 'VOCABULARY', 'KANJI_READING'),
      (44, '延期', '延期', 'N3', 'VOCABULARY', 'WORD_USAGE'),
      (45, '手順', '手順', 'N2', 'VOCABULARY', 'KANJI_READING'),
      (46, '打開', '打開', 'N1', 'VOCABULARY', 'WORD_USAGE'),
      (47, '是正', '是正', 'N1', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (48, '次第で', '次第で', 'N2', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (49, '甚大', '甚大', 'N1', 'VOCABULARY', 'KANJI_READING'),
      (50, '省く', '省く', 'N2', 'VOCABULARY', 'WORD_USAGE'),
      (51, '購入', '購入', 'N2', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (52, '遵守', '遵守', 'N2', 'VOCABULARY', 'ORTHOGRAPHY'),
      (53, '隠蔽', '隠蔽', 'N1', 'VOCABULARY', 'ORTHOGRAPHY'),
      (54, '가치 판단', '가치 판단', 'N1', 'READING', 'MEDIUM_READING'),
      (55, '감사', '감사', 'N3', 'VOCABULARY', 'KANJI_READING'),
      (56, '개별 승낙', '개별 승낙', 'N1', 'READING', 'INFO_RETRIEVAL'),
      (57, '개요', '개요', 'N2', 'VOCABULARY', 'PARAPHRASE'),
      (58, '개인 가치', '개인 가치', 'N4', 'VOCABULARY', 'PARAPHRASE'),
      (59, '거리', '거리', 'N3', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (60, '격차', '격차', 'N1', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (61, '결과 연결', '결과 연결', 'N4', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (62, '결론 이유', '결론 이유', 'N3', 'READING', 'MEDIUM_READING'),
      (63, '결석 자료', '결석 자료', 'N2', 'READING', 'INFO_RETRIEVAL'),
      (64, '결승전', '결승전', 'N1', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (65, '결정 과정', '결정 과정', 'N2', 'READING', 'MEDIUM_READING'),
      (66, '경로 선택', '경로 선택', 'N3', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (67, '경로와 기한', '경로와 기한', 'N3', 'READING', 'INFO_RETRIEVAL'),
      (68, '경험', '경험', 'N4', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (69, '경험의 조건', '경험의 조건', 'N3', 'READING', 'MEDIUM_READING'),
      (70, '계획 유지', '계획 유지', 'N4', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (71, '공공시설', '공공시설', 'N1', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (72, '공동 발표', '공동 발표', 'N1', 'READING', 'INFO_RETRIEVAL'),
      (73, '공동 작업실', '공동 작업실', 'N2', 'READING', 'INFO_RETRIEVAL'),
      (74, '관점 대비', '관점 대비', 'N2', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (75, '관점 변화', '관점 변화', 'N1', 'READING', 'LONG_READING'),
      (76, '관찰과 체험', '관찰과 체험', 'N1', 'READING', 'MEDIUM_READING'),
      (77, '교정 요청', '교정 요청', 'N3', 'READING', 'SHORT_READING'),
      (78, '교착 해결', '교착 해결', 'N1', 'VOCABULARY', 'WORD_USAGE'),
      (79, '교통', '교통', 'N4', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (80, '구매', '구매', 'N5', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (81, '규칙', '규칙', 'N2', 'VOCABULARY', 'ORTHOGRAPHY'),
      (82, '금액', '금액', 'N5', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (83, '금지', '금지', 'N5', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (84, '기대와 실제', '기대와 실제', 'N4', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (85, '기록', '기록', 'N1', 'VOCABULARY', 'ORTHOGRAPHY'),
      (86, '날씨', '날씨', 'N5', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (87, '날짜 기준 요금', '날짜 기준 요금', 'N4', 'READING', 'INFO_RETRIEVAL'),
      (88, '내용 추가', '내용 추가', 'N4', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (89, '논지 종합', '논지 종합', 'N1', 'READING', 'LONG_READING'),
      (90, '놓친 기회', '놓친 기회', 'N1', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (91, '누적 상한', '누적 상한', 'N2', 'READING', 'INFO_RETRIEVAL'),
      (92, '다음 개실일', '다음 개실일', 'N2', 'READING', 'INFO_RETRIEVAL'),
      (93, '다음 시도', '다음 시도', 'N2', 'READING', 'MEDIUM_READING'),
      (94, '단가', '단가', 'N2', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (95, '단어 용법', '단어 용법', 'N3', 'VOCABULARY', 'WORD_USAGE'),
      (96, '담당 구분', '담당 구분', 'N3', 'READING', 'SHORT_READING'),
      (97, '대략', '대략', 'N4', 'VOCABULARY', 'PARAPHRASE'),
      (98, '대리 수령', '대리 수령', 'N2', 'READING', 'INFO_RETRIEVAL'),
      (99, '대여 방향', '대여 방향', 'N4', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (100, '대응 기준', '대응 기준', 'N2', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (101, '도서관', '도서관', 'N5', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (102, '독립 조건', '독립 조건', 'N1', 'READING', 'INFO_RETRIEVAL'),
      (103, '동반 변화', '동반 변화', 'N2', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (104, '동사', '동사', 'N4', 'VOCABULARY', 'ORTHOGRAPHY'),
      (105, '동사 활용', '동사 활용', 'N4', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (106, '동음어', '동음어', 'N2', 'VOCABULARY', 'ORTHOGRAPHY'),
      (107, '두 요구', '두 요구', 'N3', 'READING', 'MEDIUM_READING'),
      (108, '두 이유 결합', '두 이유 결합', 'N4', 'READING', 'SHORT_READING'),
      (109, '두 장점', '두 장점', 'N4', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (110, '등록 후 변경', '등록 후 변경', 'N1', 'READING', 'INFO_RETRIEVAL'),
      (111, '마감 준비물', '마감 준비물', 'N4', 'READING', 'INFO_RETRIEVAL'),
      (112, '목적 이해', '목적 이해', 'N3', 'READING', 'MEDIUM_READING'),
      (113, '목적 확인', '목적 확인', 'N1', 'READING', 'MEDIUM_READING'),
      (114, '무료와 절차', '무료와 절차', 'N3', 'READING', 'INFO_RETRIEVAL'),
      (115, '문맥 어휘', '문맥 어휘', 'N1', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (116, '문맥 어휘', '문맥 어휘', 'N2', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (117, '문맥 어휘', '문맥 어휘', 'N3', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (118, '문맥 어휘', '문맥 어휘', 'N4', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (119, '문맥 어휘', '문맥 어휘', 'N5', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (120, '문맥 의미', '문맥 의미', 'N4', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (121, '문장문법', '문장문법', 'N4', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (122, '물리적 지지', '물리적 지지', 'N3', 'VOCABULARY', 'WORD_USAGE'),
      (123, '물품별 조건', '물품별 조건', 'N4', 'READING', 'INFO_RETRIEVAL'),
      (124, '미끄러짐', '미끄러짐', 'N4', 'VOCABULARY', 'WORD_USAGE'),
      (125, '미래 대비', '미래 대비', 'N4', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (126, '반례', '반례', 'N2', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (127, '반환 연장', '반환 연장', 'N2', 'READING', 'INFO_RETRIEVAL'),
      (128, '방', '방', 'N5', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (129, '방향', '방향', 'N5', 'VOCABULARY', 'ORTHOGRAPHY'),
      (130, '범위 확장', '범위 확장', 'N2', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (131, '범위와 예외', '범위와 예외', 'N1', 'READING', 'INFO_RETRIEVAL'),
      (132, '변경 방향', '변경 방향', 'N1', 'READING', 'INFO_RETRIEVAL'),
      (133, '변화 진행', '변화 진행', 'N3', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (134, '변화 평가', '변화 평가', 'N1', 'READING', 'MEDIUM_READING'),
      (135, '보관 반환', '보관 반환', 'N3', 'READING', 'INFO_RETRIEVAL'),
      (136, '보관 장소 변경', '보관 장소 변경', 'N4', 'READING', 'SHORT_READING'),
      (137, '복수 조건', '복수 조건', 'N2', 'READING', 'INFO_RETRIEVAL'),
      (138, '부사', '부사', 'N3', 'VOCABULARY', 'PARAPHRASE'),
      (139, '부족 조건', '부족 조건', 'N3', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (140, '부족분 보충', '부족분 보충', 'N2', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (141, '분리배출', '분리배출', 'N4', 'READING', 'INFO_RETRIEVAL'),
      (142, '분반', '분반', 'N2', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (143, '불문', '불문', 'N2', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (144, '비', '비', 'N5', 'READING', 'SHORT_READING'),
      (145, '비교', '비교', 'N4', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (146, '비교', '비교', 'N4', 'READING', 'SHORT_READING'),
      (147, '비교 기록', '비교 기록', 'N2', 'READING', 'MEDIUM_READING'),
      (148, '사례 종합', '사례 종합', 'N2', 'READING', 'MEDIUM_READING'),
      (149, '사용법', '사용법', 'N3', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (150, '사용자 검증', '사용자 검증', 'N2', 'READING', 'MEDIUM_READING'),
      (151, '사전 조치', '사전 조치', 'N2', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (152, '사전 준비', '사전 준비', 'N4', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (153, '사정 설명', '사정 설명', 'N2', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (154, '상담', '상담', 'N3', 'VOCABULARY', 'ORTHOGRAPHY'),
      (155, '상충 요구', '상충 요구', 'N2', 'READING', 'MEDIUM_READING'),
      (156, '생략', '생략', 'N2', 'VOCABULARY', 'WORD_USAGE'),
      (157, '생활 환경', '생활 환경', 'N4', 'VOCABULARY', 'KANJI_READING'),
      (158, '선의와 자유', '선의와 자유', 'N1', 'READING', 'LONG_READING'),
      (159, '선택', '선택', 'N4', 'VOCABULARY', 'ORTHOGRAPHY'),
      (160, '선택 이유', '선택 이유', 'N4', 'READING', 'SHORT_READING'),
      (161, '설명 방식', '설명 방식', 'N3', 'READING', 'MEDIUM_READING'),
      (162, '설명회', '설명회', 'N2', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (163, '소식 반응', '소식 반응', 'N3', 'VOCABULARY', 'PARAPHRASE'),
      (164, '소유권과 관리', '소유권과 관리', 'N1', 'READING', 'INFO_RETRIEVAL'),
      (165, '소중함', '소중함', 'N4', 'VOCABULARY', 'PARAPHRASE'),
      (166, '수량', '수량', 'N4', 'VOCABULARY', 'PARAPHRASE'),
      (167, '수량 변화', '수량 변화', 'N4', 'VOCABULARY', 'WORD_USAGE'),
      (168, '수령 경로 비교', '수령 경로 비교', 'N3', 'READING', 'INFO_RETRIEVAL'),
      (169, '수령 방식 구분', '수령 방식 구분', 'N2', 'READING', 'INFO_RETRIEVAL'),
      (170, '수리 가능성', '수리 가능성', 'N1', 'READING', 'MEDIUM_READING'),
      (171, '수영장', '수영장', 'N5', 'READING', 'INFO_RETRIEVAL'),
      (172, '순간', '순간', 'N3', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (173, '승인', '승인', 'N2', 'VOCABULARY', 'ORTHOGRAPHY'),
      (174, '시각 장소', '시각 장소', 'N5', 'READING', 'SHORT_READING'),
      (175, '시간 요금', '시간 요금', 'N2', 'READING', 'INFO_RETRIEVAL'),
      (176, '시도 비교', '시도 비교', 'N3', 'READING', 'MEDIUM_READING'),
      (177, '시설 안내', '시설 안내', 'N5', 'READING', 'INFO_RETRIEVAL'),
      (178, '시설 요금', '시설 요금', 'N2', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (179, '시작점 끝점', '시작점 끝점', 'N5', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (180, '시점 구별', '시점 구별', 'N4', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (181, '식사', '식사', 'N1', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (182, '신청 안내', '신청 안내', 'N4', 'READING', 'INFO_RETRIEVAL'),
      (183, '신청시각 기준', '신청시각 기준', 'N3', 'READING', 'INFO_RETRIEVAL'),
      (184, '안전 검사', '안전 검사', 'N1', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (185, '약속 정보', '약속 정보', 'N5', 'READING', 'SHORT_READING'),
      (186, '양보 연결', '양보 연결', 'N4', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (187, '어미 구별', '어미 구별', 'N4', 'VOCABULARY', 'ORTHOGRAPHY'),
      (188, '얼어붙은 길', '얼어붙은 길', 'N4', 'VOCABULARY', 'WORD_USAGE'),
      (189, '업무 연락', '업무 연락', 'N3', 'READING', 'SHORT_READING'),
      (190, '업무 인계', '업무 인계', 'N2', 'READING', 'MEDIUM_READING'),
      (191, '역사와 지속 이용', '역사와 지속 이용', 'N2', 'READING', 'MEDIUM_READING'),
      (192, '역할 대비', '역할 대비', 'N1', 'READING', 'MEDIUM_READING'),
      (193, '역할별 조건', '역할별 조건', 'N3', 'READING', 'INFO_RETRIEVAL'),
      (194, '연속성과 적응', '연속성과 적응', 'N1', 'READING', 'MEDIUM_READING'),
      (195, '연장 상한', '연장 상한', 'N2', 'READING', 'INFO_RETRIEVAL'),
      (196, '영화', '영화', 'N5', 'READING', 'SHORT_READING'),
      (197, '예상 밖', '예상 밖', 'N3', 'VOCABULARY', 'PARAPHRASE'),
      (198, '예약 변경', '예약 변경', 'N3', 'READING', 'INFO_RETRIEVAL'),
      (199, '예약 변경', '예약 변경', 'N4', 'READING', 'SHORT_READING'),
      (200, '예외 조건', '예외 조건', 'N4', 'READING', 'INFO_RETRIEVAL'),
      (201, '예정 변경', '예정 변경', 'N3', 'VOCABULARY', 'WORD_USAGE'),
      (202, '옷 수거', '옷 수거', 'N4', 'READING', 'SHORT_READING'),
      (203, '완료와 미완료', '완료와 미완료', 'N5', 'READING', 'SHORT_READING'),
      (204, '요금', '요금', 'N4', 'READING', 'INFO_RETRIEVAL'),
      (205, '요리', '요리', 'N4', 'READING', 'SHORT_READING'),
      (206, '요청', '요청', 'N5', 'READING', 'SHORT_READING'),
      (207, '용도별 신청', '용도별 신청', 'N1', 'READING', 'INFO_RETRIEVAL'),
      (208, '용법', '용법', 'N2', 'VOCABULARY', 'WORD_USAGE'),
      (209, '용법', '용법', 'N3', 'VOCABULARY', 'WORD_USAGE'),
      (210, '용법', '용법', 'N4', 'VOCABULARY', 'WORD_USAGE'),
      (211, '우산', '우산', 'N4', 'READING', 'SHORT_READING'),
      (212, '운반', '운반', 'N4', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (213, '운영 조정', '운영 조정', 'N2', 'READING', 'MEDIUM_READING'),
      (214, '운영시간 준비물', '운영시간 준비물', 'N5', 'READING', 'INFO_RETRIEVAL'),
      (215, '원인과 결과', '원인과 결과', 'N2', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (216, '유감', '유감', 'N1', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (217, '유사 독음', '유사 독음', 'N2', 'VOCABULARY', 'KANJI_READING'),
      (218, '유사 한자', '유사 한자', 'N3', 'VOCABULARY', 'ORTHOGRAPHY'),
      (219, '유사한자', '유사한자', 'N3', 'VOCABULARY', 'ORTHOGRAPHY'),
      (220, '유의 표현', '유의 표현', 'N5', 'VOCABULARY', 'PARAPHRASE'),
      (221, '유지 정보', '유지 정보', 'N3', 'READING', 'SHORT_READING'),
      (222, '음성 기록', '음성 기록', 'N3', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (223, '음성 안내기', '음성 안내기', 'N3', 'READING', 'INFO_RETRIEVAL'),
      (224, '음주', '음주', 'N2', 'VOCABULARY', 'WORD_USAGE'),
      (225, '의무', '의무', 'N4', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (226, '의존 조건', '의존 조건', 'N2', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (227, '이동 수단', '이동 수단', 'N4', 'READING', 'SHORT_READING'),
      (228, '이동 시간', '이동 시간', 'N5', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (229, '이유', '이유', 'N5', 'READING', 'SHORT_READING'),
      (230, '이점과 부담', '이점과 부담', 'N2', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (231, '이해 정도', '이해 정도', 'N2', 'VOCABULARY', 'PARAPHRASE'),
      (232, '인물 정보', '인물 정보', 'N5', 'READING', 'SHORT_READING'),
      (233, '인용 맥락', '인용 맥락', 'N2', 'READING', 'MEDIUM_READING'),
      (234, '인원', '인원', 'N2', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (235, '일반화 제한', '일반화 제한', 'N2', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (236, '임시 체류', '임시 체류', 'N3', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (237, '입장권 유효기간', '입장권 유효기간', 'N2', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (238, '자동사 타동사', '자동사 타동사', 'N4', 'VOCABULARY', 'WORD_USAGE'),
      (239, '자료 보관', '자료 보관', 'N1', 'READING', 'INFO_RETRIEVAL'),
      (240, '자전거 보관', '자전거 보관', 'N4', 'READING', 'INFO_RETRIEVAL'),
      (241, '자제', '자제', 'N2', 'VOCABULARY', 'WORD_USAGE'),
      (242, '작업', '작업', 'N2', 'VOCABULARY', 'KANJI_READING'),
      (243, '작업과 휴식', '작업과 휴식', 'N3', 'READING', 'MEDIUM_READING'),
      (244, '장문 독해', '장문 독해', 'N1', 'READING', 'LONG_READING'),
      (245, '장음 탁음', '장음 탁음', 'N3', 'VOCABULARY', 'KANJI_READING'),
      (246, '재검토 조건', '재검토 조건', 'N1', 'READING', 'LONG_READING'),
      (247, '재료', '재료', 'N2', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (248, '재사용', '재사용', 'N4', 'READING', 'SHORT_READING'),
      (249, '전달 메모', '전달 메모', 'N4', 'READING', 'SHORT_READING'),
      (250, '전문가 상담', '전문가 상담', 'N1', 'READING', 'MEDIUM_READING'),
      (251, '전언', '전언', 'N3', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (252, '전체와 세부', '전체와 세부', 'N2', 'VOCABULARY', 'PARAPHRASE'),
      (253, '전화', '전화', 'N3', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (254, '접수', '접수', 'N4', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (255, '정도 대조', '정도 대조', 'N1', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (256, '정리', '정리', 'N4', 'VOCABULARY', 'ORTHOGRAPHY'),
      (257, '정보 검색', '정보 검색', 'N5', 'READING', 'INFO_RETRIEVAL'),
      (258, '정보 누락', '정보 누락', 'N2', 'READING', 'MEDIUM_READING'),
      (259, '정보 찾기', '정보 찾기', 'N1', 'READING', 'INFO_RETRIEVAL'),
      (260, '정보 찾기', '정보 찾기', 'N2', 'READING', 'INFO_RETRIEVAL'),
      (261, '정보 찾기', '정보 찾기', 'N3', 'READING', 'INFO_RETRIEVAL'),
      (262, '정보 찾기', '정보 찾기', 'N4', 'READING', 'INFO_RETRIEVAL'),
      (263, '정보 출처', '정보 출처', 'N3', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (264, '제한적 판단', '제한적 판단', 'N1', 'VOCABULARY', 'PARAPHRASE'),
      (265, '조건', '조건', 'N5', 'READING', 'INFO_RETRIEVAL'),
      (266, '조건 내용', '조건 내용', 'N1', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (267, '조건 변화', '조건 변화', 'N4', 'READING', 'SHORT_READING'),
      (268, '조건과 결과', '조건과 결과', 'N2', 'READING', 'MEDIUM_READING'),
      (269, '조건별 기한', '조건별 기한', 'N3', 'READING', 'SHORT_READING'),
      (270, '조건별 장소', '조건별 장소', 'N5', 'READING', 'INFO_RETRIEVAL'),
      (271, '조건형', '조건형', 'N4', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (272, '조사 해석', '조사 해석', 'N2', 'READING', 'MEDIUM_READING'),
      (273, '종료 시점', '종료 시점', 'N3', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (274, '주장 파악', '주장 파악', 'N3', 'READING', 'MEDIUM_READING'),
      (275, '준비물', '준비물', 'N5', 'READING', 'SHORT_READING'),
      (276, '준비물 예외', '준비물 예외', 'N3', 'READING', 'INFO_RETRIEVAL'),
      (277, '중문 독해', '중문 독해', 'N1', 'READING', 'MEDIUM_READING'),
      (278, '중문 독해', '중문 독해', 'N2', 'READING', 'MEDIUM_READING'),
      (279, '지시어', '지시어', 'N5', 'READING', 'SHORT_READING'),
      (280, '지위 당위', '지위 당위', 'N1', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (281, '지탱', '지탱', 'N3', 'VOCABULARY', 'WORD_USAGE'),
      (282, '진행과 상태', '진행과 상태', 'N2', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (283, '짐 이동', '짐 이동', 'N4', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (284, '짧은 글', '짧은 글', 'N3', 'READING', 'SHORT_READING'),
      (285, '짧은 글', '짧은 글', 'N4', 'READING', 'SHORT_READING'),
      (286, '착용', '착용', 'N5', 'VOCABULARY', 'WORD_USAGE'),
      (287, '참가 이력', '참가 이력', 'N4', 'READING', 'INFO_RETRIEVAL'),
      (288, '참가 증명', '참가 증명', 'N1', 'READING', 'INFO_RETRIEVAL'),
      (289, '참여 과정', '참여 과정', 'N3', 'READING', 'MEDIUM_READING'),
      (290, '참여 기회', '참여 기회', 'N1', 'READING', 'LONG_READING'),
      (291, '참여 조건', '참여 조건', 'N4', 'READING', 'SHORT_READING'),
      (292, '초대', '초대', 'N3', 'VOCABULARY', 'ORTHOGRAPHY'),
      (293, '최초 가능', '최초 가능', 'N2', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (294, '추가 조사', '추가 조사', 'N5', 'GRAMMAR', 'TEXT_GRAMMAR'),
      (295, '출입 시간', '출입 시간', 'N4', 'READING', 'INFO_RETRIEVAL'),
      (296, '친절', '친절', 'N4', 'VOCABULARY', 'KANJI_READING'),
      (297, '침묵과 동의', '침묵과 동의', 'N1', 'READING', 'LONG_READING'),
      (298, '크기', '크기', 'N5', 'VOCABULARY', 'PARAPHRASE'),
      (299, '택배 수령', '택배 수령', 'N3', 'READING', 'INFO_RETRIEVAL'),
      (300, '통학', '통학', 'N5', 'READING', 'SHORT_READING'),
      (301, '특별한 단계', '특별한 단계', 'N1', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (302, '판단 근거', '판단 근거', 'N2', 'READING', 'MEDIUM_READING'),
      (303, '편리함', '편리함', 'N4', 'VOCABULARY', 'KANJI_READING'),
      (304, '평소와 예외', '평소와 예외', 'N5', 'READING', 'SHORT_READING'),
      (305, '포함과 제외', '포함과 제외', 'N2', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (306, '표기', '표기', 'N2', 'VOCABULARY', 'ORTHOGRAPHY'),
      (307, '표기', '표기', 'N3', 'VOCABULARY', 'ORTHOGRAPHY'),
      (308, '표기', '표기', 'N4', 'VOCABULARY', 'ORTHOGRAPHY'),
      (309, '표정', '표정', 'N3', 'VOCABULARY', 'KANJI_READING'),
      (310, '피해', '피해', 'N1', 'VOCABULARY', 'KANJI_READING'),
      (311, '학년 시간', '학년 시간', 'N5', 'READING', 'INFO_RETRIEVAL'),
      (312, '해석의 근거', '해석의 근거', 'N1', 'READING', 'LONG_READING'),
      (313, '행동 나열', '행동 나열', 'N4', 'GRAMMAR', 'GRAMMAR_SELECT'),
      (314, '행동 변화', '행동 변화', 'N4', 'READING', 'SHORT_READING'),
      (315, '행동 순서', '행동 순서', 'N4', 'READING', 'SHORT_READING'),
      (316, '행동 시기', '행동 시기', 'N3', 'VOCABULARY', 'PARAPHRASE'),
      (317, '행동 주체', '행동 주체', 'N2', 'READING', 'MEDIUM_READING'),
      (318, '행동 확인', '행동 확인', 'N5', 'READING', 'SHORT_READING'),
      (319, '형용동사', '형용동사', 'N4', 'VOCABULARY', 'KANJI_READING'),
      (320, '혼잡 회피', '혼잡 회피', 'N3', 'VOCABULARY', 'CONTEXT_VOCABULARY'),
      (321, '환기', '환기', 'N2', 'VOCABULARY', 'KANJI_READING'),
      (322, '후기', '후기', 'N3', 'READING', 'MEDIUM_READING'),
      (323, '휴일', '휴일', 'N4', 'GRAMMAR', 'GRAMMAR_SELECT')
  ) AS manifest(ordinal, label, normalized_name, level, subject, question_type) ORDER BY ordinal
  LOOP
    SELECT "id" INTO target_tag_id FROM "Tag" WHERE "normalizedName" = approved.normalized_name;
    IF target_tag_id IS NULL THEN
      target_tag_id := public.gen_random_uuid();
      INSERT INTO "Tag" ("id", "label", "normalizedName", "createdAt", "updatedAt")
      VALUES (target_tag_id, approved.label, approved.normalized_name, NEW."appliedAt", NEW."appliedAt");
    END IF;
    INSERT INTO "TagApplicability" ("tagId", "level", "subject", "questionType")
    VALUES (target_tag_id, approved.level::"JlptLevel", approved.subject::"QuestionSubject", approved.question_type::"QuestionType");
  END LOOP;
  SELECT jsonb_build_object(
    'tags', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t."id") FROM "Tag" t WHERE t."id" IN (SELECT (value->>'id')::UUID FROM jsonb_array_elements(before_state->'tags'))),
    'applicability', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a."tagId", a."level", a."subject", a."questionType") FROM "TagApplicability" a WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(before_state->'applicability') p
      WHERE p->>'tagId' = a."tagId"::TEXT AND p->>'level' = a."level"::TEXT
        AND p->>'subject' = a."subject"::TEXT AND p->>'questionType' = a."questionType"::TEXT)),
    'questions', (SELECT jsonb_agg(to_jsonb(q) ORDER BY q."id") FROM "Question" q),
    'versions', (SELECT jsonb_agg(to_jsonb(v) ORDER BY v."id") FROM "QuestionVersion" v),
    'options', (SELECT jsonb_agg(to_jsonb(o) ORDER BY o."id") FROM "QuestionOption" o),
    'snapshots', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "QuestionVersionTag" s),
    'review', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r."id") FROM "ContentReview" r),
    'audit', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l."id") FROM "AdminAuditLog" l),
    'reports', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p."id") FROM "QuestionReport" p),
    'intent', (SELECT jsonb_agg(to_jsonb(i) ORDER BY i."operationId") FROM "Phase7OperationIntent" i),
    'priorEvidence0', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedReadingTagRegistration" e),
    'priorEvidence1', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedN3ReadingTagRegistration" e),
    'priorEvidence2', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedN4N2ReadingTagRegistration" e),
    'priorEvidence3', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedN4ReadingBatch7TagRegistration" e)
  ) INTO after_state;
  IF before_state IS DISTINCT FROM after_state
    OR (SELECT COUNT(*) FROM "Tag") <> 400
    OR (SELECT COUNT(*) FROM "TagApplicability") <> 449 THEN
    RAISE EXCEPTION 'Approved308 changed parent rows or exceeded293/323.' USING ERRCODE = '23514';
  END IF;
  SELECT encode(public.digest(string_agg(
    convert_to(t."normalizedName", 'UTF8') || decode('00', 'hex') ||
    convert_to(a."level"::TEXT, 'UTF8') || decode('00', 'hex') ||
    convert_to(a."subject"::TEXT, 'UTF8') || decode('00', 'hex') ||
    convert_to(a."questionType"::TEXT || E'\n', 'UTF8'),
    decode('', 'hex') ORDER BY t."normalizedName" COLLATE "C", a."level"::TEXT COLLATE "C",
      a."subject"::TEXT COLLATE "C", a."questionType"::TEXT COLLATE "C"
  ), 'sha256'), 'hex') INTO tuple_digest
  FROM "Tag" t JOIN "TagApplicability" a ON a."tagId" = t."id"
  WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(before_state->'applicability') p
    WHERE p->>'tagId' = a."tagId"::TEXT AND p->>'level' = a."level"::TEXT
      AND p->>'subject' = a."subject"::TEXT AND p->>'questionType' = a."questionType"::TEXT);
  IF tuple_digest IS DISTINCT FROM '94b63e5f57d94b9d594dd15450e5459e1eea6fbfa93069e40ccee47527fc95a0'
    OR (SELECT COUNT(*) FROM "Tag" WHERE "normalizedName" IN ('あながち', 'いかんでは', 'い형용사 과거', 'おおむね', 'かった', 'からまで', 'そうだ', 'その結果', 'それでも', 'それに', 'たことがある', 'たり', 'たるもの', 'だけでは', 'ちいさい', 'ておく', 'てきた', 'てはいけません', 'て初めて', 'で', 'ところが', 'とたんに', 'とは限らない', 'ともなると', 'どころか', 'なければならない', 'な형용사 연결', 'につれて', 'に先立って', 'に応じて', 'に限らず', 'はく', 'ば', 'まで', 'も', 'ものだから', 'ものを', 'より', 'を問わず', '一方で', '二百', '右', '山', '延期', '手順', '打開', '是正', '次第で', '甚大', '省く', '購入', '遵守', '隠蔽', '가치 판단', '감사', '개별 승낙', '개요', '개인 가치', '거리', '격차', '결과 연결', '결론 이유', '결석 자료', '결승전', '결정 과정', '경로 선택', '경로와 기한', '경험', '경험의 조건', '계획 유지', '공공시설', '공동 발표', '공동 작업실', '관점 대비', '관점 변화', '관찰과 체험', '교정 요청', '교착 해결', '구매', '금액', '금지', '기대와 실제', '기록', '날씨', '날짜 기준 요금', '내용 추가', '논지 종합', '놓친 기회', '누적 상한', '다음 개실일', '다음 시도', '단가', '담당 구분', '대략', '대리 수령', '대여 방향', '대응 기준', '도서관', '독립 조건', '동반 변화', '동음어', '두 요구', '두 이유 결합', '두 장점', '등록 후 변경', '마감 준비물', '목적 이해', '목적 확인', '무료와 절차', '문맥 어휘', '문맥 의미', '문장문법', '물리적 지지', '물품별 조건', '미끄러짐', '미래 대비', '반례', '반환 연장', '방', '방향', '범위 확장', '범위와 예외', '변경 방향', '변화 진행', '변화 평가', '보관 반환', '보관 장소 변경', '복수 조건', '부족 조건', '부족분 보충', '분리배출', '분반', '불문', '비', '비교', '비교 기록', '사례 종합', '사용법', '사용자 검증', '사전 조치', '사전 준비', '사정 설명', '상담', '상충 요구', '생략', '생활 환경', '선의와 자유', '선택', '선택 이유', '설명 방식', '설명회', '소식 반응', '소유권과 관리', '소중함', '수량', '수량 변화', '수령 경로 비교', '수령 방식 구분', '수리 가능성', '수영장', '순간', '승인', '시각 장소', '시간 요금', '시도 비교', '시설 안내', '시설 요금', '시작점 끝점', '시점 구별', '식사', '신청 안내', '신청시각 기준', '안전 검사', '약속 정보', '양보 연결', '어미 구별', '얼어붙은 길', '업무 연락', '업무 인계', '역사와 지속 이용', '역할 대비', '역할별 조건', '연속성과 적응', '연장 상한', '영화', '예상 밖', '예약 변경', '예외 조건', '예정 변경', '옷 수거', '완료와 미완료', '요금', '요리', '요청', '용도별 신청', '용법', '우산', '운반', '운영 조정', '운영시간 준비물', '원인과 결과', '유사 독음', '유사 한자', '유사한자', '유지 정보', '음성 기록', '음성 안내기', '음주', '의무', '의존 조건', '이동 수단', '이동 시간', '이점과 부담', '이해 정도', '인물 정보', '인용 맥락', '인원', '일반화 제한', '임시 체류', '입장권 유효기간', '자동사 타동사', '자료 보관', '자전거 보관', '자제', '작업', '작업과 휴식', '장문 독해', '장음 탁음', '재검토 조건', '재료', '재사용', '전달 메모', '전문가 상담', '전언', '전체와 세부', '전화', '접수', '정도 대조', '정리', '정보 누락', '정보 출처', '제한적 판단', '조건', '조건 내용', '조건 변화', '조건과 결과', '조건별 기한', '조건별 장소', '조건형', '조사 해석', '종료 시점', '준비물', '준비물 예외', '지시어', '지위 당위', '지탱', '진행과 상태', '짐 이동', '착용', '참가 이력', '참가 증명', '참여 과정', '참여 기회', '참여 조건', '초대', '최초 가능', '추가 조사', '출입 시간', '친절', '침묵과 동의', '크기', '택배 수령', '통학', '특별한 단계', '판단 근거', '편리함', '평소와 예외', '포함과 제외', '표기', '표정', '피해', '학년 시간', '해석의 근거', '행동 나열', '행동 변화', '행동 순서', '행동 시기', '행동 주체', '행동 확인', '혼잡 회피', '환기', '후기', '휴일')) <> 293
    OR EXISTS (SELECT 1 FROM "Tag" WHERE "normalizedName" IN ('あながち', 'いかんでは', 'い형용사 과거', 'おおむね', 'かった', 'からまで', 'そうだ', 'その結果', 'それでも', 'それに', 'たことがある', 'たり', 'たるもの', 'だけでは', 'ちいさい', 'ておく', 'てきた', 'てはいけません', 'て初めて', 'で', 'ところが', 'とたんに', 'とは限らない', 'ともなると', 'どころか', 'なければならない', 'な형용사 연결', 'につれて', 'に先立って', 'に応じて', 'に限らず', 'はく', 'ば', 'まで', 'も', 'ものだから', 'ものを', 'より', 'を問わず', '一方で', '二百', '右', '山', '延期', '手順', '打開', '是正', '次第で', '甚大', '省く', '購入', '遵守', '隠蔽', '가치 판단', '감사', '개별 승낙', '개요', '개인 가치', '거리', '격차', '결과 연결', '결론 이유', '결석 자료', '결승전', '결정 과정', '경로 선택', '경로와 기한', '경험', '경험의 조건', '계획 유지', '공공시설', '공동 발표', '공동 작업실', '관점 대비', '관점 변화', '관찰과 체험', '교정 요청', '교착 해결', '구매', '금액', '금지', '기대와 실제', '기록', '날씨', '날짜 기준 요금', '내용 추가', '논지 종합', '놓친 기회', '누적 상한', '다음 개실일', '다음 시도', '단가', '담당 구분', '대략', '대리 수령', '대여 방향', '대응 기준', '도서관', '독립 조건', '동반 변화', '동음어', '두 요구', '두 이유 결합', '두 장점', '등록 후 변경', '마감 준비물', '목적 이해', '목적 확인', '무료와 절차', '문맥 어휘', '문맥 의미', '문장문법', '물리적 지지', '물품별 조건', '미끄러짐', '미래 대비', '반례', '반환 연장', '방', '방향', '범위 확장', '범위와 예외', '변경 방향', '변화 진행', '변화 평가', '보관 반환', '보관 장소 변경', '복수 조건', '부족 조건', '부족분 보충', '분리배출', '분반', '불문', '비', '비교', '비교 기록', '사례 종합', '사용법', '사용자 검증', '사전 조치', '사전 준비', '사정 설명', '상담', '상충 요구', '생략', '생활 환경', '선의와 자유', '선택', '선택 이유', '설명 방식', '설명회', '소식 반응', '소유권과 관리', '소중함', '수량', '수량 변화', '수령 경로 비교', '수령 방식 구분', '수리 가능성', '수영장', '순간', '승인', '시각 장소', '시간 요금', '시도 비교', '시설 안내', '시설 요금', '시작점 끝점', '시점 구별', '식사', '신청 안내', '신청시각 기준', '안전 검사', '약속 정보', '양보 연결', '어미 구별', '얼어붙은 길', '업무 연락', '업무 인계', '역사와 지속 이용', '역할 대비', '역할별 조건', '연속성과 적응', '연장 상한', '영화', '예상 밖', '예약 변경', '예외 조건', '예정 변경', '옷 수거', '완료와 미완료', '요금', '요리', '요청', '용도별 신청', '용법', '우산', '운반', '운영 조정', '운영시간 준비물', '원인과 결과', '유사 독음', '유사 한자', '유사한자', '유지 정보', '음성 기록', '음성 안내기', '음주', '의무', '의존 조건', '이동 수단', '이동 시간', '이점과 부담', '이해 정도', '인물 정보', '인용 맥락', '인원', '일반화 제한', '임시 체류', '입장권 유효기간', '자동사 타동사', '자료 보관', '자전거 보관', '자제', '작업', '작업과 휴식', '장문 독해', '장음 탁음', '재검토 조건', '재료', '재사용', '전달 메모', '전문가 상담', '전언', '전체와 세부', '전화', '접수', '정도 대조', '정리', '정보 누락', '정보 출처', '제한적 판단', '조건', '조건 내용', '조건 변화', '조건과 결과', '조건별 기한', '조건별 장소', '조건형', '조사 해석', '종료 시점', '준비물', '준비물 예외', '지시어', '지위 당위', '지탱', '진행과 상태', '짐 이동', '착용', '참가 이력', '참가 증명', '참여 과정', '참여 기회', '참여 조건', '초대', '최초 가능', '추가 조사', '출입 시간', '친절', '침묵과 동의', '크기', '택배 수령', '통학', '특별한 단계', '판단 근거', '편리함', '평소와 예외', '포함과 제외', '표기', '표정', '피해', '학년 시간', '해석의 근거', '행동 나열', '행동 변화', '행동 순서', '행동 시기', '행동 주체', '행동 확인', '혼잡 회피', '환기', '후기', '휴일')
      AND ("createdAt" IS DISTINCT FROM NEW."appliedAt"::timestamptz(3)
        OR "updatedAt" IS DISTINCT FROM NEW."appliedAt"::timestamptz(3))) THEN
    RAISE EXCEPTION 'Approved308 final exact tuple or new identity digest drifted.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION "register_phase7_approved308_tag_rows"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker", "nihongo_phase7_migration";
CREATE TRIGGER "Phase7Approved308TagRegistration_exact323"
BEFORE INSERT ON "Phase7Approved308TagRegistration" FOR EACH ROW
EXECUTE FUNCTION "register_phase7_approved308_tag_rows"();

CREATE FUNCTION "apply_phase7_approved308_tags"()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path FROM CURRENT AS $function$
BEGIN
  INSERT INTO "Phase7Approved308TagRegistration" ("batch") VALUES ('jlp-478-approved308-adbbaf21-v1');
END;
$function$;
REVOKE ALL ON FUNCTION "apply_phase7_approved308_tags"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker", "nihongo_phase7_migration";
GRANT EXECUTE ON FUNCTION "apply_phase7_approved308_tags"() TO "nihongo_phase7_migration";

DO $harden$
DECLARE target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema');
  function_name TEXT; predecessor_state JSONB; predecessor_digest TEXT; definition TEXT;
BEGIN
  FOREACH function_name IN ARRAY ARRAY['protect_phase7_approved308_tag_registration',
    'register_phase7_approved308_tag_rows', 'apply_phase7_approved308_tags'] LOOP
    EXECUTE pg_catalog.format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp', target_schema, function_name, target_schema);
  END LOOP;
  SELECT jsonb_build_object(
    'tags', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t."id") FROM "Tag" t),
    'applicability', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a."tagId", a."level", a."subject", a."questionType") FROM "TagApplicability" a),
    'questions', (SELECT jsonb_agg(to_jsonb(q) ORDER BY q."id") FROM "Question" q),
    'versions', (SELECT jsonb_agg(to_jsonb(v) ORDER BY v."id") FROM "QuestionVersion" v),
    'options', (SELECT jsonb_agg(to_jsonb(o) ORDER BY o."id") FROM "QuestionOption" o),
    'snapshots', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "QuestionVersionTag" s),
    'review', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r."id") FROM "ContentReview" r),
    'audit', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l."id") FROM "AdminAuditLog" l),
    'reports', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p."id") FROM "QuestionReport" p),
    'intent', (SELECT jsonb_agg(to_jsonb(i) ORDER BY i."operationId") FROM "Phase7OperationIntent" i),
    'priorEvidence0', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedReadingTagRegistration" e),
    'priorEvidence1', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedN3ReadingTagRegistration" e),
    'priorEvidence2', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedN4N2ReadingTagRegistration" e),
    'priorEvidence3', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedN4ReadingBatch7TagRegistration" e)
  ) INTO predecessor_state;
  predecessor_digest := encode(public.digest(convert_to(predecessor_state::TEXT, 'UTF8'), 'sha256'), 'hex');
  definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    pg_catalog.format('%I.register_phase7_approved308_tag_rows()', target_schema)));
  IF definition IS NULL OR pg_catalog.strpos(definition,
    pg_catalog.quote_literal('JLP478_APPROVED308_PREDECESSOR_UNSET')) = 0 THEN
    RAISE EXCEPTION 'Approved308 predecessor constant is missing.' USING ERRCODE = '23514';
  END IF;
  EXECUTE pg_catalog.replace(definition, pg_catalog.quote_literal('JLP478_APPROVED308_PREDECESSOR_UNSET'), pg_catalog.quote_literal(predecessor_digest));
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.register_phase7_approved308_tag_rows() SET TimeZone TO UTC', target_schema);
END;
$harden$;
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
