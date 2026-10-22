-- JLP-461 / JLP-459 diagnosis / JLP-460 independent authority review.
-- Forward-only correction: no tag/content/evidence mutation during installation.
-- Runtime command requires completed canonical36; physical37 includes current-catalog.
-- Preserve old SQL, canonical34/35 prefixes and every original behavioral guard.
BEGIN;
SELECT pg_catalog.set_config('app.phase7_target_schema', pg_catalog.current_schema(), true);
SELECT pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true);
DO $owned_path$
DECLARE target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace AS namespace
    JOIN pg_catalog.pg_roles AS owner ON owner.oid = namespace.nspowner
    WHERE namespace.nspname = target_schema AND owner.rolname = 'nihongo_phase7_owner'
  ) THEN
    RAISE EXCEPTION 'Revision2 correction requires the owned Phase 7 schema.' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.set_config('search_path', pg_catalog.format('%I, pg_catalog, pg_temp', target_schema), true);
END;
$owned_path$;
SET LOCAL ROLE "nihongo_phase7_owner";

DO $revision2_fix$
DECLARE
  target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema');
  function_oid OID;
  original_acl ACLITEM[];
  original_config TEXT[];
  original_owner OID;
  definition TEXT;
  old_fragment TEXT;
  new_fragment TEXT;
BEGIN
  SELECT p.oid, p.proacl, p.proconfig, p.proowner
    INTO function_oid, original_acl, original_config, original_owner
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = target_schema
    AND p.proname = 'register_phase7_approved_n4_n2_reading_tag_rows'
    AND p.pronargs = 0 AND p.prokind = 'f'
    AND p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
    AND p.prosecdef AND p.proowner = 'nihongo_phase7_owner'::pg_catalog.regrole
    AND p.proconfig = ARRAY[pg_catalog.format('search_path=pg_catalog, %I, pg_temp', target_schema)]
    AND encode(public.digest(convert_to(p.prosrc, 'UTF8'), 'sha256'), 'hex') = '75e78505e6e58542bb750c6b72500fc5102e09f2f89ed406cd1c1430feca1573';
  IF function_oid IS NULL THEN
    RAISE EXCEPTION 'Revision2 correction prior registration definition/security drifted.' USING ERRCODE = '23514';
  END IF;
  definition := pg_catalog.pg_get_functiondef(function_oid);
  -- Every approved fragment must occur once; the sealed prior body prevents
  -- accepting unrelated guard, manifest, UUID or authority changes.
  FOR old_fragment, new_fragment IN
    SELECT * FROM (VALUES
      ($before$4e3f91b5341b90fed7064fc3d810cf5d6cfa581707012e92440c8b041e1130b1$before$, $after$d129fccba730359b574914bf68d2e0af13a6b80ab11b6ce5269412fda3535584$after$),
      ($before$a180a0ea8dac51200b533fbe99624036fc19984be9cfbdd0c972c624e764444c$before$, $after$b19be0f3cea53f0918c50f81f2e67978e0933595d3637aa07844b3b68683d103$after$),
      ($before$IF (SELECT COUNT(*) FROM "_prisma_migrations") <> 35$before$, $after$IF (SELECT COUNT(*) FROM "_prisma_migrations") <> 36$after$),
      ($before$    OR (SELECT COUNT(*) FROM "_prisma_migrations"
        WHERE "migration_name" = '20261009072500_phase7_approved_n4_n2_reading_tags') <> 1$before$, $after$    OR (SELECT COUNT(*) FROM "_prisma_migrations"
        WHERE "migration_name" = '20261009072500_phase7_approved_n4_n2_reading_tags') <> 1
    OR (SELECT COUNT(*) FROM "_prisma_migrations"
        WHERE "migration_name" = '20261009092000_phase7_n4_n2_revision2_digest_fix') <> 1$after$),
      ($before$WHERE "migration_name" <> '20261009072500_phase7_approved_n4_n2_reading_tags';$before$, $after$WHERE "migration_name" NOT IN (
    '20261009072500_phase7_approved_n4_n2_reading_tags',
    '20261009092000_phase7_n4_n2_revision2_digest_fix'
  );$after$),
      ($before$  IF ledger_digest IS DISTINCT FROM
    '4448f7aa40804bb3058f1a986c6af5527eb26ca7375973bcca320fa1bf51d7f8' THEN
    RAISE EXCEPTION 'Approved registration canonical34 ledger prefix drifted.' USING ERRCODE = '23514';
  END IF;$before$, $after$  IF ledger_digest IS DISTINCT FROM
    '4448f7aa40804bb3058f1a986c6af5527eb26ca7375973bcca320fa1bf51d7f8' THEN
    RAISE EXCEPTION 'Approved registration canonical34 ledger prefix drifted.' USING ERRCODE = '23514';
  END IF;

  -- Preserve the complete canonical35 predecessor as well as its canonical34 prefix.
  SELECT encode(public.digest(string_agg(
    convert_to("migration_name", 'UTF8') || decode('00', 'hex') ||
      convert_to("checksum" || E'\n', 'UTF8'),
    decode('', 'hex') ORDER BY "migration_name" COLLATE "C"
  ), 'sha256'), 'hex') INTO ledger_digest
  FROM "_prisma_migrations"
  WHERE "migration_name" <> '20261009092000_phase7_n4_n2_revision2_digest_fix';
  IF ledger_digest IS DISTINCT FROM
    'b1599310da408668bd4617f35ebc47109cb6e23d91e23dd737eaff521d49a393' THEN
    RAISE EXCEPTION 'Approved registration canonical35 ledger prefix drifted.' USING ERRCODE = '23514';
  END IF;$after$),
      ($before$Approved registration requires the completed canonical35 ledger.$before$, $after$Approved registration requires the completed canonical36 ledger.$after$),
      ($before$-- Pin the completed canonical34 prefix; this installation is its sole append.$before$, $after$-- Pin the completed canonical34 prefix; the two reviewed appends are excluded.$after$)
    ) AS approved_changes(before_text, after_text)
  LOOP
    IF pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, old_fragment, ''))
      <> pg_catalog.length(old_fragment) THEN
      RAISE EXCEPTION 'Revision2 correction approved fragment drifted.' USING ERRCODE = '23514';
    END IF;
    definition := pg_catalog.replace(definition, old_fragment, new_fragment);
  END LOOP;
  EXECUTE definition;
  IF pg_catalog.pg_get_functiondef(function_oid) IS DISTINCT FROM definition
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = function_oid
        AND (p.proacl IS DISTINCT FROM original_acl OR p.proconfig IS DISTINCT FROM original_config
          OR p.proowner IS DISTINCT FROM original_owner OR NOT p.prosecdef
          OR p.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype
          OR encode(public.digest(convert_to(p.prosrc, 'UTF8'), 'sha256'), 'hex')
            IS DISTINCT FROM '2d1b9e11c9d67a7e942276bf0ca83d88c18a6fca25d779ef280732e02bb3266b')
    ) THEN
    RAISE EXCEPTION 'Revision2 correction changed security or unrelated registration definition.' USING ERRCODE = '23514';
  END IF;
END;
$revision2_fix$;
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
