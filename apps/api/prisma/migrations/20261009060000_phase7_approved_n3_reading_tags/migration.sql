-- JLP-429 / QA JLP-420: install a closed N3 reading04 dictionary command.
-- Migration alone registers no tags. Apply only after canonical33 bootstrap
-- (65 questions / 108 tags / 127 applicability), before any content import or
-- N5 tag command. The separate current-catalog 107/126 profile is rejected.
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

CREATE TABLE "Phase7ApprovedN3ReadingTagRegistration" (
  "batch" TEXT PRIMARY KEY CHECK ("batch" = 'jlp-429-n3-reading04-tags-v1'),
  "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
REVOKE ALL ON TABLE "Phase7ApprovedN3ReadingTagRegistration"
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

CREATE FUNCTION "protect_phase7_approved_n3_reading_tag_registration"()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'Approved N3 tag registration evidence is immutable.'
    USING ERRCODE = '42501';
END;
$function$;
REVOKE ALL ON FUNCTION "protect_phase7_approved_n3_reading_tag_registration"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
CREATE TRIGGER "Phase7ApprovedN3ReadingTagRegistration_immutable"
BEFORE UPDATE OR DELETE ON "Phase7ApprovedN3ReadingTagRegistration"
FOR EACH ROW EXECUTE FUNCTION "protect_phase7_approved_n3_reading_tag_registration"();

CREATE FUNCTION "register_phase7_approved_n3_reading_tag_rows"()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path FROM CURRENT AS $function$
DECLARE
  short_reading_tag_id UUID;
  approved_label TEXT;
  new_tag_id UUID;
BEGIN
  IF TG_OP <> 'INSERT' OR pg_trigger_depth() <> 1
    OR NEW."batch" <> 'jlp-429-n3-reading04-tags-v1' THEN
    RAISE EXCEPTION 'Unapproved N3 tag registration.' USING ERRCODE = '42501';
  END IF;
  LOCK TABLE "Tag", "TagApplicability", "Question", "QuestionVersion",
    "QuestionOption" IN SHARE ROW EXCLUSIVE MODE;
  IF (SELECT COUNT(*) FROM "Question") <> 65
    OR (SELECT COUNT(*) FROM "QuestionVersion") <> 65
    OR (SELECT COUNT(*) FROM "QuestionOption") <> 260
    OR (SELECT COUNT(*) FROM "Tag") <> 108
    OR (SELECT COUNT(*) FROM "TagApplicability") <> 127
    OR EXISTS (SELECT 1 FROM "Phase7ApprovedReadingTagRegistration")
    OR EXISTS (SELECT 1 FROM "Phase7ApprovedN3ReadingTagRegistration") THEN
    RAISE EXCEPTION 'Approved N3 registration requires the unchanged canonical bootstrap.'
      USING ERRCODE = '23514';
  END IF;

  SELECT "id" INTO short_reading_tag_id FROM "Tag"
    WHERE "normalizedName" = '짧은 글' AND "label" = '짧은 글' FOR UPDATE;
  IF short_reading_tag_id IS NULL
    OR (SELECT COUNT(*) FROM "TagApplicability" WHERE "tagId" = short_reading_tag_id) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM "TagApplicability" WHERE "tagId" = short_reading_tag_id
        AND "level" = 'N5' AND "subject" = 'READING' AND "questionType" = 'SHORT_READING'
    )
    OR EXISTS (SELECT 1 FROM "Tag" WHERE "normalizedName" IN ('업무 연락', '조건별 기한')) THEN
    RAISE EXCEPTION 'Approved N3 tag identities or original applicability drifted.'
      USING ERRCODE = '23514';
  END IF;

  -- Reuse the reviewed live Tag ID; leave the N5 mapping and snapshots intact.
  -- The existing applicability guard is unchanged and runs at nested depth.
  INSERT INTO "TagApplicability" ("tagId", "level", "subject", "questionType")
    VALUES (short_reading_tag_id, 'N3', 'READING', 'SHORT_READING');
  FOREACH approved_label IN ARRAY ARRAY['업무 연락', '조건별 기한'] LOOP
    -- No upsert or caller-provided name/tuple: partial or replayed state fails.
    new_tag_id := public.gen_random_uuid();
    INSERT INTO "Tag" ("id", "label", "normalizedName", "createdAt", "updatedAt")
      VALUES (new_tag_id, approved_label, approved_label, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    INSERT INTO "TagApplicability" ("tagId", "level", "subject", "questionType")
      VALUES (new_tag_id, 'N3', 'READING', 'SHORT_READING');
  END LOOP;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION "register_phase7_approved_n3_reading_tag_rows"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
CREATE TRIGGER "Phase7ApprovedN3ReadingTagRegistration_exact_three"
BEFORE INSERT ON "Phase7ApprovedN3ReadingTagRegistration"
FOR EACH ROW EXECUTE FUNCTION "register_phase7_approved_n3_reading_tag_rows"();

CREATE FUNCTION "apply_phase7_approved_n3_reading_tags"()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path FROM CURRENT AS $function$
BEGIN
  INSERT INTO "Phase7ApprovedN3ReadingTagRegistration" ("batch")
    VALUES ('jlp-429-n3-reading04-tags-v1');
END;
$function$;
REVOKE ALL ON FUNCTION "apply_phase7_approved_n3_reading_tags"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "apply_phase7_approved_n3_reading_tags"() TO "nihongo_phase7_migration";
DO $harden$
DECLARE
  target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema');
  function_name TEXT;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'protect_phase7_approved_n3_reading_tag_registration',
    'register_phase7_approved_n3_reading_tag_rows',
    'apply_phase7_approved_n3_reading_tags'
  ] LOOP
    EXECUTE pg_catalog.format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp', target_schema, function_name, target_schema);
  END LOOP;
END;
$harden$;
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
