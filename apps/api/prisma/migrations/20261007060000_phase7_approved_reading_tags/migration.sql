-- JLP-208: install an owner-only, one-shot exact-six registration command.
-- Apply explicitly AFTER the unchanged 65-question bootstrap; migration alone
-- registers no tags. Existing applicability/seed guards are unchanged.
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

CREATE TABLE "Phase7ApprovedReadingTagRegistration" (
  "batch" TEXT PRIMARY KEY CHECK ("batch" = 'jlp-208-n5-reading-tags-v1'),
  "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
REVOKE ALL ON TABLE "Phase7ApprovedReadingTagRegistration" FROM PUBLIC;

CREATE FUNCTION "protect_phase7_approved_reading_tag_registration"()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'Approved tag registration evidence is immutable.'
    USING ERRCODE = '42501';
END;
$function$;
REVOKE ALL ON FUNCTION "protect_phase7_approved_reading_tag_registration"() FROM PUBLIC;
CREATE TRIGGER "Phase7ApprovedReadingTagRegistration_immutable"
BEFORE UPDATE OR DELETE ON "Phase7ApprovedReadingTagRegistration"
FOR EACH ROW EXECUTE FUNCTION "protect_phase7_approved_reading_tag_registration"();

CREATE FUNCTION "register_phase7_approved_reading_tag_rows"()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path FROM CURRENT AS $function$
DECLARE
  approved RECORD;
  new_tag_id UUID;
BEGIN
  -- The trigger is not a general write capability: its manifest is closed and
  -- its evidence table has no runtime-role grants. Replays conflict on its PK.
  IF TG_OP <> 'INSERT' OR pg_trigger_depth() <> 1
    OR NEW."batch" <> 'jlp-208-n5-reading-tags-v1' THEN
    RAISE EXCEPTION 'Unapproved tag registration.' USING ERRCODE = '42501';
  END IF;
  LOCK TABLE "Tag", "TagApplicability", "Question", "QuestionVersion",
    "QuestionOption" IN SHARE ROW EXCLUSIVE MODE;
  IF (SELECT COUNT(*) FROM "Question") <> 65
    OR (SELECT COUNT(*) FROM "QuestionVersion") <> 65
    OR (SELECT COUNT(*) FROM "QuestionOption") <> 260
    OR (SELECT COUNT(*) FROM "Tag") <> 108
    OR (SELECT COUNT(*) FROM "TagApplicability") <> 127 THEN
    RAISE EXCEPTION 'Approved registration requires the original bootstrap.'
      USING ERRCODE = '23514';
  END IF;
  FOR approved IN
    SELECT * FROM (VALUES
      ('요청', 'SHORT_READING'),
      ('완료와 미완료', 'SHORT_READING'),
      ('시설 안내', 'INFO_RETRIEVAL'),
      ('조건', 'INFO_RETRIEVAL'),
      ('지시어', 'SHORT_READING'),
      ('준비물', 'SHORT_READING')
    ) AS manifest(label, question_type)
  LOOP
    -- No upsert: an existing/altered name fails the entire statement.
    new_tag_id := public.gen_random_uuid();
    INSERT INTO "Tag" ("id", "label", "normalizedName", "createdAt", "updatedAt")
      VALUES (new_tag_id, approved.label, approved.label, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    -- Runs at nested trigger depth through this explicitly approved manifest.
    -- protect_phase7_tag_applicability remains byte-for-byte unchanged.
    INSERT INTO "TagApplicability" ("tagId", "level", "subject", "questionType")
      VALUES (new_tag_id, 'N5', 'READING', approved.question_type::"QuestionType");
  END LOOP;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION "register_phase7_approved_reading_tag_rows"() FROM PUBLIC;
CREATE TRIGGER "Phase7ApprovedReadingTagRegistration_exact_six"
BEFORE INSERT ON "Phase7ApprovedReadingTagRegistration"
FOR EACH ROW EXECUTE FUNCTION "register_phase7_approved_reading_tag_rows"();

CREATE FUNCTION "apply_phase7_approved_reading_tags"()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path FROM CURRENT AS $function$
BEGIN
  INSERT INTO "Phase7ApprovedReadingTagRegistration" ("batch")
    VALUES ('jlp-208-n5-reading-tags-v1');
END;
$function$;
-- No grant to app/auth/CMS roles, no caller-controlled tuple or target schema.
-- The existing migration role alone receives the explicit post-seed command.
REVOKE ALL ON FUNCTION "apply_phase7_approved_reading_tags"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "apply_phase7_approved_reading_tags"() TO "nihongo_phase7_migration";
DO $harden$
DECLARE
  target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema');
  function_name TEXT;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'protect_phase7_approved_reading_tag_registration',
    'register_phase7_approved_reading_tag_rows',
    'apply_phase7_approved_reading_tags'
  ] LOOP
    EXECUTE pg_catalog.format('ALTER FUNCTION %I.%I() SET search_path TO pg_catalog, %I, pg_temp', target_schema, function_name, target_schema);
  END LOOP;
END;
$harden$;
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
