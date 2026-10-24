-- JLP-116: current reviewed bootstrap catalog pins; guards remain intact.
BEGIN;
SELECT pg_catalog.set_config('app.phase7_target_schema', pg_catalog.current_schema(), true);
SELECT pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";
DO $reviewed_catalog$
DECLARE
  target_schema name := pg_catalog.current_setting('app.phase7_target_schema');
  function_oid oid;
  definition text;
  replacement text;
  original_acl aclitem[];
  original_config text[];
  pair record;
BEGIN
  SELECT p.oid, p.proacl, p.proconfig INTO function_oid, original_acl, original_config
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
  WHERE n.nspname = target_schema
    AND p.proname = 'validate_phase7_system_seed_catalog'
    AND p.pronargs = 0 AND p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
    AND p.prosecdef AND r.rolname = 'nihongo_phase7_owner';
  IF function_oid IS NULL THEN
    RAISE EXCEPTION 'Reviewed catalog validator identity/security drifted.';
  END IF;
  definition := pg_catalog.pg_get_functiondef(function_oid);
  replacement := definition;
  FOR pair IN SELECT * FROM (VALUES
    ('(SELECT COUNT(*) FROM "Tag") <> 108', '(SELECT COUNT(*) FROM "Tag") <> 107'),
    ('(SELECT COUNT(*) FROM "TagApplicability") <> 127', '(SELECT COUNT(*) FROM "TagApplicability") <> 126'),
    ('d129fccba730359b574914bf68d2e0af13a6b80ab11b6ce5269412fda3535584', '0e4f6c477108c053a924aa1ba0f3cba8e868853328b8626839f95939bb19c798'),
    ('adeca1ed1c85338c85aa3ec13299d43532f9bf4e0f0515775a29563567f4b078', '81e1accc76657951962be7d3d21fdd976ea67d78c98ddb87abe6f9823edbc6ef'),
    ('b19be0f3cea53f0918c50f81f2e67978e0933595d3637aa07844b3b68683d103', '4f8f2c077bc5e79a4755f007f96cd4b8e57bdd6b14f0f906faefaab79eff2fa9')
  ) AS pins(prior_value, current_value) LOOP
    IF (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(
        definition, pair.prior_value, ''))) <> pg_catalog.length(pair.prior_value)
      OR pg_catalog.strpos(definition, pair.current_value) > 0 THEN
      RAISE EXCEPTION 'Reviewed catalog prior count/pin drifted.';
    END IF;
    replacement := pg_catalog.replace(replacement, pair.prior_value, pair.current_value);
  END LOOP;
  EXECUTE replacement;
  IF pg_catalog.pg_get_functiondef(function_oid) <> replacement
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = function_oid
      AND (p.proacl IS DISTINCT FROM original_acl OR p.proconfig IS DISTINCT FROM original_config
        OR NOT p.prosecdef OR p.proowner <> 'nihongo_phase7_owner'::pg_catalog.regrole
        OR p.pronargs <> 0 OR p.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype)) THEN
    RAISE EXCEPTION 'Reviewed catalog replacement changed security or unrelated definition.';
  END IF;
END;
$reviewed_catalog$;
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
