-- [JLP-47] Forward-only reviewed SYSTEM_SEED revision2 digest update.
-- Replace only the two reviewed catalog pins. Preserve all guards and security.
BEGIN;
SELECT pg_catalog.set_config('app.phase7_target_schema', pg_catalog.current_schema(), true);
SELECT pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true);

DO $reviewed_seed_preflight$
DECLARE
  target_schema name := pg_catalog.current_setting('app.phase7_target_schema');
  function_oid oid;
  definition text;
BEGIN
  SELECT p.oid INTO function_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
  WHERE n.nspname = target_schema AND p.proname = 'validate_phase7_system_seed_catalog'
    AND p.pronargs = 0 AND p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
    AND p.prosecdef AND r.rolname = 'nihongo_phase7_owner';
  IF function_oid IS NULL THEN
    RAISE EXCEPTION 'Reviewed seed validator identity/security drifted.';
  END IF;
  definition := pg_catalog.pg_get_functiondef(function_oid);
  IF (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition,
      '4e3f91b5341b90fed7064fc3d810cf5d6cfa581707012e92440c8b041e1130b1', ''))) <> 64
    OR (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition,
      'a180a0ea8dac51200b533fbe99624036fc19984be9cfbdd0c972c624e764444c', ''))) <> 64
    OR pg_catalog.strpos(definition,
      'adeca1ed1c85338c85aa3ec13299d43532f9bf4e0f0515775a29563567f4b078') = 0 THEN
    RAISE EXCEPTION 'Reviewed seed validator prior digest pins drifted.';
  END IF;
END;
$reviewed_seed_preflight$;

SET LOCAL ROLE "nihongo_phase7_owner";
DO $reviewed_seed_update$
DECLARE
  target_schema name := pg_catalog.current_setting('app.phase7_target_schema');
  function_oid oid;
  definition text;
  replacement text;
  original_acl aclitem[];
  original_config text[];
BEGIN
  SELECT p.oid, p.proacl, p.proconfig INTO function_oid, original_acl, original_config
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = target_schema AND p.proname = 'validate_phase7_system_seed_catalog'
    AND p.pronargs = 0;
  definition := pg_catalog.pg_get_functiondef(function_oid);
  replacement := pg_catalog.replace(pg_catalog.replace(definition,
    '4e3f91b5341b90fed7064fc3d810cf5d6cfa581707012e92440c8b041e1130b1',
    'd129fccba730359b574914bf68d2e0af13a6b80ab11b6ce5269412fda3535584'),
    'a180a0ea8dac51200b533fbe99624036fc19984be9cfbdd0c972c624e764444c',
    'b19be0f3cea53f0918c50f81f2e67978e0933595d3637aa07844b3b68683d103');
  EXECUTE replacement;
  IF pg_catalog.pg_get_functiondef(function_oid) <> replacement
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = function_oid
      AND (p.proacl IS DISTINCT FROM original_acl OR p.proconfig IS DISTINCT FROM original_config
        OR NOT p.prosecdef OR p.proowner <> 'nihongo_phase7_owner'::pg_catalog.regrole)) THEN
    RAISE EXCEPTION 'Reviewed seed validator replacement changed security or unrelated definition.';
  END IF;
END;
$reviewed_seed_update$;
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
