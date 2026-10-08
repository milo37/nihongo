-- Phase 7 Slice 1, unit 1 of 2: enum values only.
-- PostgreSQL cannot safely consume newly-added enum values in the same
-- transaction, so every dependent object is intentionally in the next
-- forward migration.

BEGIN;

SELECT pg_catalog.set_config(
  'app.phase7_enum_target_schema',
  pg_catalog.current_schema(),
  true
);
SELECT pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true);

DO $pgcrypto_schema$
DECLARE
  pgcrypto_oid OID;
  pgcrypto_owner OID;
BEGIN
  SELECT extension.oid, extension.extowner
  INTO pgcrypto_oid, pgcrypto_owner
  FROM pg_catalog.pg_extension AS extension
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pgcrypto'
    AND namespace.nspname = 'public';
  IF pgcrypto_oid IS NULL THEN
    RAISE EXCEPTION 'pgcrypto must be installed in the trusted public schema.'
      USING ERRCODE = '55000';
  END IF;

  -- These are the exact PostgreSQL 18 pgcrypto C entry points consumed by the
  -- migration.  Do not trust a member merely because ALTER EXTENSION attached
  -- it: CREATE OR REPLACE can preserve that membership while changing the
  -- executable symbol, volatility, security context, owner, or ACL.
  IF EXISTS (
    WITH expected(
      routine_name, argument_types, argument_count, return_type, source_symbol,
      volatility, is_strict
    ) AS (
      VALUES
        ('digest'::NAME, '25 25'::pg_catalog.oidvector, 2, 17::OID,
          'pg_digest'::TEXT, 'i'::"char", true),
        ('digest'::NAME, '17 25'::pg_catalog.oidvector, 2, 17::OID,
          'pg_digest'::TEXT, 'i'::"char", true),
        ('gen_random_uuid'::NAME, ''::pg_catalog.oidvector, 0, 2950::OID,
          'pg_random_uuid'::TEXT, 'v'::"char", false)
    )
    SELECT 1
    FROM expected
    LEFT JOIN pg_catalog.pg_proc AS procedure
      ON procedure.pronamespace = 'public'::pg_catalog.regnamespace
     AND procedure.proname = expected.routine_name
     AND procedure.proargtypes = expected.argument_types
    LEFT JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
    WHERE procedure.oid IS NULL
      OR procedure.pronargs IS DISTINCT FROM expected.argument_count
      OR procedure.prorettype IS DISTINCT FROM expected.return_type
      OR procedure.proowner IS DISTINCT FROM pgcrypto_owner
      OR language.lanname IS DISTINCT FROM 'c'
      OR language.lanowner IS DISTINCT FROM 10::OID
      OR language.lanispl
      OR language.lanpltrusted
      OR language.lanplcallfoid <> 0
      OR language.laninline <> 0
      OR language.lanvalidator IS DISTINCT FROM
        'pg_catalog.fmgr_c_validator(oid)'::pg_catalog.regprocedure
      OR language.lanacl IS NOT NULL
      OR procedure.prosrc IS DISTINCT FROM expected.source_symbol
      OR procedure.probin IS DISTINCT FROM '$libdir/pgcrypto'
      OR procedure.proconfig IS NOT NULL
      OR procedure.prosecdef
      OR procedure.proleakproof
      OR procedure.provolatile IS DISTINCT FROM expected.volatility
      OR procedure.proisstrict IS DISTINCT FROM expected.is_strict
      OR procedure.proparallel IS DISTINCT FROM 's'::"char"
      OR procedure.prokind IS DISTINCT FROM 'f'::"char"
      OR procedure.proretset
      OR procedure.provariadic <> 0
      OR procedure.prosupport <> 0
      OR procedure.pronargdefaults <> 0
      OR procedure.proargdefaults IS NOT NULL
      OR procedure.proallargtypes IS NOT NULL
      OR procedure.proargmodes IS NOT NULL
      OR procedure.proargnames IS NOT NULL
      OR procedure.protrftypes IS NOT NULL
      OR procedure.prosqlbody IS NOT NULL
      OR procedure.procost <> 1
      OR procedure.prorows <> 0
      OR procedure.proacl IS NOT NULL
      OR (
        SELECT count(*)
        FROM pg_catalog.pg_depend AS membership
        WHERE membership.classid =
            'pg_catalog.pg_proc'::pg_catalog.regclass
          AND membership.objid = procedure.oid
          AND membership.objsubid = 0
          AND membership.refclassid =
            'pg_catalog.pg_extension'::pg_catalog.regclass
          AND membership.deptype = 'e'
      ) <> 1
      OR NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_depend AS membership
        WHERE membership.classid =
            'pg_catalog.pg_proc'::pg_catalog.regclass
          AND membership.objid = procedure.oid
          AND membership.objsubid = 0
          AND membership.refclassid =
            'pg_catalog.pg_extension'::pg_catalog.regclass
          AND membership.refobjid = pgcrypto_oid
          AND membership.refobjsubid = 0
          AND membership.deptype = 'e'
      )
  ) THEN
    RAISE EXCEPTION
      'Phase 7 required pgcrypto routine manifest is not exact.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_extension AS extension
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = extension.extnamespace
    WHERE extension.extname = 'pgcrypto'
      AND namespace.nspname = 'public'
  ) THEN
    RAISE EXCEPTION 'pgcrypto must be installed in the trusted public schema.'
      USING ERRCODE = '55000';
  END IF;
END;
$pgcrypto_schema$;

-- Cluster roles, wrapper logins, memberships, database/schema ownership, and
-- pgcrypto are external provisioning prerequisites. This migration consumes
-- that exact graph and never bootstraps or repairs cluster authority.
DO $phase7_external_provisioning$
DECLARE
  target_schema NAME := pg_catalog.current_setting(
    'app.phase7_enum_target_schema', false
  )::NAME;
  wrapper_prefix TEXT := CASE
    WHEN current_database() ~ '_test$' THEN 'nihongo_test'
    WHEN current_database() ~ '_dev$' THEN 'nihongo_development'
    ELSE NULL
  END;
  expected_migration_login TEXT;
  database_owner TEXT;
  schema_owner TEXT;
  role_row RECORD;
  membership_row RECORD;
BEGIN
  expected_migration_login := wrapper_prefix || '_phase7_migration_login';
  IF pg_catalog.current_setting('session_replication_role') <> 'origin' THEN
    RAISE EXCEPTION 'Phase 7 migration requires session_replication_role=origin.'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_parameter_acl AS parameter_acl
    CROSS JOIN LATERAL pg_catalog.aclexplode(parameter_acl.paracl) AS acl_entry
    LEFT JOIN pg_catalog.pg_roles AS grantee_role
      ON grantee_role.oid = acl_entry.grantee
    WHERE parameter_acl.parname = 'session_replication_role'
      AND acl_entry.privilege_type IN ('SET', 'ALTER SYSTEM')
      AND (
        acl_entry.grantee = 0
        OR grantee_role.rolname IN (
          'nihongo_phase7_owner', 'nihongo_phase7_migration', 'nihongo_app',
          'nihongo_auth_gateway', 'nihongo_erasure_worker',
          'nihongo_test_phase7_migration_login', 'nihongo_test_app_login',
          'nihongo_test_auth_gateway_login', 'nihongo_test_erasure_worker_login',
          'nihongo_test_legacy_app_login',
          'nihongo_development_phase7_migration_login',
          'nihongo_development_app_login',
          'nihongo_development_auth_gateway_login',
          'nihongo_development_erasure_worker_login',
          'nihongo_development_legacy_app_login'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'Phase 7 protected roles cannot delegate session_replication_role.'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS protected_role
    CROSS JOIN LATERAL unnest(protected_role.rolconfig) AS role_config(setting)
    WHERE protected_role.rolname IN (
      'nihongo_phase7_owner', 'nihongo_phase7_migration', 'nihongo_app',
      'nihongo_auth_gateway', 'nihongo_erasure_worker',
      'nihongo_test_phase7_migration_login', 'nihongo_test_app_login',
      'nihongo_test_auth_gateway_login', 'nihongo_test_erasure_worker_login',
      'nihongo_test_legacy_app_login',
      'nihongo_development_phase7_migration_login',
      'nihongo_development_app_login',
      'nihongo_development_auth_gateway_login',
      'nihongo_development_erasure_worker_login',
      'nihongo_development_legacy_app_login'
    )
      AND split_part(role_config.setting, '=', 1) IN (
        'session_replication_role', 'row_security', 'search_path', 'role'
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_db_role_setting AS role_setting
    LEFT JOIN pg_catalog.pg_roles AS protected_role
      ON protected_role.oid = role_setting.setrole
    CROSS JOIN LATERAL unnest(role_setting.setconfig) AS db_config(setting)
    WHERE (
      role_setting.setrole = 0
      OR protected_role.rolname IN (
        'nihongo_phase7_owner', 'nihongo_phase7_migration', 'nihongo_app',
        'nihongo_auth_gateway', 'nihongo_erasure_worker',
        'nihongo_test_phase7_migration_login', 'nihongo_test_app_login',
        'nihongo_test_auth_gateway_login', 'nihongo_test_erasure_worker_login',
        'nihongo_test_legacy_app_login',
        'nihongo_development_phase7_migration_login',
        'nihongo_development_app_login',
        'nihongo_development_auth_gateway_login',
        'nihongo_development_erasure_worker_login',
        'nihongo_development_legacy_app_login'
      )
    ) AND split_part(db_config.setting, '=', 1) IN (
      'session_replication_role', 'row_security', 'search_path', 'role'
    )
  ) THEN
    RAISE EXCEPTION 'Phase 7 protected role configuration is unsafe.'
      USING ERRCODE = '42501';
  END IF;
  IF wrapper_prefix IS NULL
    OR SESSION_USER <> expected_migration_login
    OR CURRENT_USER <> 'nihongo_phase7_migration'
    OR pg_catalog.current_setting('role', true) <>
      'nihongo_phase7_migration' THEN
    RAISE EXCEPTION
      'Phase 7 requires its canonical migration wrapper and startup role.'
      USING ERRCODE = '42501';
  END IF;

  SELECT owner_role.rolname INTO database_owner
  FROM pg_catalog.pg_database AS database_row
  JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = database_row.datdba
  WHERE database_row.datname = current_database();
  SELECT owner_role.rolname INTO schema_owner
  FROM pg_catalog.pg_namespace AS namespace
  JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = namespace.nspowner
  WHERE namespace.nspname = target_schema;
  IF database_owner <> 'nihongo_phase7_migration'
    OR schema_owner <> 'nihongo_phase7_migration' THEN
    RAISE EXCEPTION 'Phase 7 external database/schema ownership is not exact.'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_database AS database_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
      database_row.datacl,
      pg_catalog.acldefault('d', database_row.datdba)
    )) AS acl_entry
    LEFT JOIN pg_catalog.pg_roles AS grantee_role
      ON grantee_role.oid = acl_entry.grantee
    WHERE database_row.datname = current_database()
      AND NOT (
        grantee_role.rolname = 'nihongo_phase7_migration'
          AND acl_entry.privilege_type IN ('CREATE', 'TEMPORARY')
          AND NOT acl_entry.is_grantable
        OR grantee_role.rolname IN (
          wrapper_prefix || '_phase7_migration_login',
          wrapper_prefix || '_app_login',
          wrapper_prefix || '_auth_gateway_login',
          wrapper_prefix || '_erasure_worker_login',
          wrapper_prefix || '_legacy_app_login'
        ) AND acl_entry.privilege_type = 'CONNECT'
          AND NOT acl_entry.is_grantable
      )
  ) OR EXISTS (
    SELECT 1
    FROM (VALUES
      (wrapper_prefix || '_phase7_migration_login', 'CONNECT'),
      ('nihongo_phase7_migration', 'CREATE'),
      ('nihongo_phase7_migration', 'TEMPORARY'),
      (wrapper_prefix || '_app_login', 'CONNECT'),
      (wrapper_prefix || '_auth_gateway_login', 'CONNECT'),
      (wrapper_prefix || '_erasure_worker_login', 'CONNECT'),
      (wrapper_prefix || '_legacy_app_login', 'CONNECT')
    ) AS expected(grantee_name, privilege_type)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_database AS database_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
        database_row.datacl,
        pg_catalog.acldefault('d', database_row.datdba)
      )) AS acl_entry
      JOIN pg_catalog.pg_roles AS grantee_role
        ON grantee_role.oid = acl_entry.grantee
      WHERE database_row.datname = current_database()
        AND grantee_role.rolname = expected.grantee_name
        AND acl_entry.privilege_type = expected.privilege_type
        AND NOT acl_entry.is_grantable
    )
  ) THEN
    RAISE EXCEPTION 'Phase 7 migration database ACL is not exact.'
      USING ERRCODE = '42501';
  END IF;

  FOR role_row IN
    SELECT required.name, role_value.*
    FROM unnest(ARRAY[
      'nihongo_phase7_owner', 'nihongo_phase7_migration', 'nihongo_app',
      'nihongo_auth_gateway', 'nihongo_erasure_worker'
    ]) AS required(name)
    LEFT JOIN pg_catalog.pg_roles AS role_value
      ON role_value.rolname = required.name
  LOOP
    IF role_row.rolname IS NULL OR role_row.rolcanlogin OR role_row.rolinherit
      OR role_row.rolsuper OR role_row.rolcreatedb OR role_row.rolcreaterole
      OR role_row.rolreplication OR role_row.rolbypassrls THEN
      RAISE EXCEPTION 'Phase 7 NOLOGIN group % is not exact.', role_row.name
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  FOR role_row IN
    SELECT required.name, role_value.*
    FROM unnest(ARRAY[
      'nihongo_test_phase7_migration_login', 'nihongo_test_app_login',
      'nihongo_test_auth_gateway_login', 'nihongo_test_erasure_worker_login',
      'nihongo_test_legacy_app_login',
      'nihongo_development_phase7_migration_login',
      'nihongo_development_app_login',
      'nihongo_development_auth_gateway_login',
      'nihongo_development_erasure_worker_login',
      'nihongo_development_legacy_app_login'
    ]) AS required(name)
    LEFT JOIN pg_catalog.pg_roles AS role_value
      ON role_value.rolname = required.name
  LOOP
    IF role_row.rolname IS NULL OR NOT role_row.rolcanlogin
      OR role_row.rolinherit OR role_row.rolsuper OR role_row.rolcreatedb
      OR role_row.rolcreaterole OR role_row.rolreplication
      OR role_row.rolbypassrls THEN
      RAISE EXCEPTION 'Phase 7 LOGIN wrapper % is not exact.', role_row.name
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
    JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
    WHERE member_role.rolname = 'nihongo_phase7_migration'
      AND granted_role.rolname = 'nihongo_phase7_owner'
      AND NOT membership.admin_option AND NOT membership.inherit_option
      AND membership.set_option
  ) THEN
    RAISE EXCEPTION 'Phase 7 migration-to-owner SET-only edge is missing.'
      USING ERRCODE = '42501';
  END IF;

  FOR membership_row IN
    SELECT expected.member_name, expected.granted_name
    FROM (VALUES
      ('nihongo_test_phase7_migration_login', 'nihongo_phase7_migration'),
      ('nihongo_test_app_login', 'nihongo_app'),
      ('nihongo_test_auth_gateway_login', 'nihongo_auth_gateway'),
      ('nihongo_test_erasure_worker_login', 'nihongo_erasure_worker'),
      ('nihongo_development_phase7_migration_login', 'nihongo_phase7_migration'),
      ('nihongo_development_app_login', 'nihongo_app'),
      ('nihongo_development_auth_gateway_login', 'nihongo_auth_gateway'),
      ('nihongo_development_erasure_worker_login', 'nihongo_erasure_worker')
    ) AS expected(member_name, granted_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
      WHERE member_role.rolname = expected.member_name
        AND granted_role.rolname = expected.granted_name
        AND NOT membership.admin_option AND NOT membership.inherit_option
        AND membership.set_option
    )
  LOOP
    RAISE EXCEPTION 'Phase 7 wrapper SET-only edge is missing: % -> %.',
      membership_row.member_name, membership_row.granted_name
      USING ERRCODE = '42501';
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
    JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
    WHERE member_role.rolname IN (
      'nihongo_test_phase7_migration_login', 'nihongo_test_app_login',
      'nihongo_test_auth_gateway_login', 'nihongo_test_erasure_worker_login',
      'nihongo_test_legacy_app_login',
      'nihongo_development_phase7_migration_login',
      'nihongo_development_app_login',
      'nihongo_development_auth_gateway_login',
      'nihongo_development_erasure_worker_login',
      'nihongo_development_legacy_app_login'
    ) AND NOT (
      EXISTS (
        SELECT 1 FROM (VALUES
          ('nihongo_test_phase7_migration_login', 'nihongo_phase7_migration'),
          ('nihongo_test_app_login', 'nihongo_app'),
          ('nihongo_test_auth_gateway_login', 'nihongo_auth_gateway'),
          ('nihongo_test_erasure_worker_login', 'nihongo_erasure_worker'),
          ('nihongo_development_phase7_migration_login', 'nihongo_phase7_migration'),
          ('nihongo_development_app_login', 'nihongo_app'),
          ('nihongo_development_auth_gateway_login', 'nihongo_auth_gateway'),
          ('nihongo_development_erasure_worker_login', 'nihongo_erasure_worker')
        ) AS allowed(member_name, granted_name)
        WHERE allowed.member_name = member_role.rolname
          AND allowed.granted_name = granted_role.rolname
          AND NOT membership.admin_option AND NOT membership.inherit_option
          AND membership.set_option
      )
    )
  ) THEN
    RAISE EXCEPTION 'Phase 7 wrapper membership graph is not exact.'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
    JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
    WHERE (
      member_role.rolname IN (
        'nihongo_phase7_owner', 'nihongo_phase7_migration', 'nihongo_app',
        'nihongo_auth_gateway', 'nihongo_erasure_worker'
      ) OR granted_role.rolname IN (
        'nihongo_phase7_owner', 'nihongo_phase7_migration', 'nihongo_app',
        'nihongo_auth_gateway', 'nihongo_erasure_worker'
      )
    ) AND NOT (
      member_role.rolname = 'nihongo_phase7_migration'
        AND granted_role.rolname = 'nihongo_phase7_owner'
        AND NOT membership.admin_option AND NOT membership.inherit_option
        AND membership.set_option
      OR EXISTS (
        SELECT 1 FROM (VALUES
          ('nihongo_test_phase7_migration_login', 'nihongo_phase7_migration'),
          ('nihongo_test_app_login', 'nihongo_app'),
          ('nihongo_test_auth_gateway_login', 'nihongo_auth_gateway'),
          ('nihongo_test_erasure_worker_login', 'nihongo_erasure_worker'),
          ('nihongo_development_phase7_migration_login', 'nihongo_phase7_migration'),
          ('nihongo_development_app_login', 'nihongo_app'),
          ('nihongo_development_auth_gateway_login', 'nihongo_auth_gateway'),
          ('nihongo_development_erasure_worker_login', 'nihongo_erasure_worker')
        ) AS allowed(member_name, granted_name)
        WHERE allowed.member_name = member_role.rolname
          AND allowed.granted_name = granted_role.rolname
          AND NOT membership.admin_option AND NOT membership.inherit_option
          AND membership.set_option
      )
    )
  ) THEN
    RAISE EXCEPTION 'Phase 7 externally provisioned group graph is not exact.'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = membership.roleid
    WHERE granted_role.rolname IN (
      'nihongo_test_phase7_migration_login',
      'nihongo_test_app_login',
      'nihongo_test_auth_gateway_login',
      'nihongo_test_erasure_worker_login',
      'nihongo_test_legacy_app_login',
      'nihongo_development_phase7_migration_login',
      'nihongo_development_app_login',
      'nihongo_development_auth_gateway_login',
      'nihongo_development_erasure_worker_login',
      'nihongo_development_legacy_app_login'
    )
  ) THEN
    RAISE EXCEPTION 'Phase 7 LOGIN wrappers cannot be granted to another role.'
      USING ERRCODE = '42501';
  END IF;
END;
$phase7_external_provisioning$;

DO $phase7_extension_boundary$
DECLARE
  target_schema NAME := pg_catalog.current_setting(
    'app.phase7_enum_target_schema', false
  )::NAME;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_extension AS extension
    JOIN pg_catalog.pg_namespace AS extension_namespace
      ON extension_namespace.oid = extension.extnamespace
    WHERE extension_namespace.nspname = target_schema
      AND NOT (
        extension.extname = 'pgcrypto'
        AND extension_namespace.nspname = 'public'
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_depend AS dependency
    JOIN pg_catalog.pg_extension AS extension
      ON extension.oid = dependency.refobjid
     AND dependency.refclassid =
       'pg_catalog.pg_extension'::pg_catalog.regclass
    CROSS JOIN LATERAL pg_catalog.pg_identify_object(
      dependency.classid, dependency.objid, dependency.objsubid
    ) AS identified
    JOIN pg_catalog.pg_namespace AS extension_namespace
      ON extension_namespace.oid = extension.extnamespace
    WHERE dependency.deptype = 'e'
      AND (
        identified.schema = target_schema
        OR (
          dependency.classid =
            'pg_catalog.pg_namespace'::pg_catalog.regclass
          AND dependency.objid = (
            SELECT namespace.oid
            FROM pg_catalog.pg_namespace AS namespace
            WHERE namespace.nspname = target_schema
          )
        )
        OR (
          identified.schema IS NULL
          AND extension_namespace.nspname = target_schema
        )
      )
      AND NOT (
        extension.extname = 'pgcrypto'
        AND extension_namespace.nspname = 'public'
      )
  ) THEN
    RAISE EXCEPTION
      'Phase 7 target schema contains a non-pgcrypto extension member.'
      USING ERRCODE = '42501';
  END IF;
END;
$phase7_extension_boundary$;

-- Reject cluster-global DDL hooks before creating any temporary helper.
DO $phase7_event_trigger_boundary$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger) THEN
    RAISE EXCEPTION 'Phase 7 requires zero global event triggers.'
      USING ERRCODE = '42501';
  END IF;
END;
$phase7_event_trigger_boundary$;

CREATE FUNCTION pg_temp.phase7_enum_assert_no_external_dependencies(
  target_schema NAME
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $external_dependencies$
DECLARE
  offending_identity TEXT;
BEGIN
  WITH RECURSIVE target_objects(classid, objid) AS (
    SELECT 'pg_catalog.pg_class'::pg_catalog.regclass, relation.oid
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = target_schema
    UNION ALL
    SELECT 'pg_catalog.pg_type'::pg_catalog.regclass, type_row.oid
    FROM pg_catalog.pg_type AS type_row
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = type_row.typnamespace
    WHERE namespace.nspname = target_schema
    UNION ALL
    SELECT 'pg_catalog.pg_proc'::pg_catalog.regclass, procedure.oid
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = target_schema
  ), candidate AS (
    SELECT DISTINCT dependency.classid, dependency.objid,
      dependency.objsubid
    FROM pg_catalog.pg_depend AS dependency
    JOIN target_objects AS target
      ON target.classid = dependency.refclassid
     AND target.objid = dependency.refobjid
  ), ownership_chain(
    root_classid, root_objid, root_objsubid,
    classid, objid, objsubid, visited
  ) AS (
    SELECT candidate.classid, candidate.objid, candidate.objsubid,
      candidate.classid, candidate.objid, candidate.objsubid,
      ARRAY[pg_catalog.format(
        '%s:%s:%s', candidate.classid, candidate.objid,
        candidate.objsubid
      )]
    FROM candidate
    UNION ALL
    SELECT chain.root_classid, chain.root_objid, chain.root_objsubid,
      ownership.refclassid, ownership.refobjid, ownership.refobjsubid,
      chain.visited || pg_catalog.format(
        '%s:%s:%s', ownership.refclassid, ownership.refobjid,
        ownership.refobjsubid
      )
    FROM ownership_chain AS chain
    JOIN pg_catalog.pg_depend AS ownership
      ON ownership.classid = chain.classid
     AND ownership.objid = chain.objid
     AND ownership.objsubid IN (0, chain.objsubid)
     AND ownership.deptype IN ('a', 'i')
    WHERE NOT pg_catalog.format(
      '%s:%s:%s', ownership.refclassid, ownership.refobjid,
      ownership.refobjsubid
    ) = ANY(chain.visited)
  ), classified AS (
    SELECT candidate.*,
      identified.schema AS direct_schema,
      identified.identity,
      EXISTS (
        SELECT 1
        FROM ownership_chain AS chain
        CROSS JOIN LATERAL pg_catalog.pg_identify_object(
          chain.classid, chain.objid, chain.objsubid
        ) AS chain_identity
        WHERE chain.root_classid = candidate.classid
          AND chain.root_objid = candidate.objid
          AND chain.root_objsubid = candidate.objsubid
          AND chain_identity.schema = target_schema
      ) AS has_target_owner,
      EXISTS (
        SELECT 1
        FROM ownership_chain AS chain
        CROSS JOIN LATERAL pg_catalog.pg_identify_object(
          chain.classid, chain.objid, chain.objsubid
        ) AS chain_identity
        WHERE chain.root_classid = candidate.classid
          AND chain.root_objid = candidate.objid
          AND chain.root_objsubid = candidate.objsubid
          AND chain_identity.schema IS NOT NULL
          AND chain_identity.schema <> target_schema
          AND chain_identity.schema NOT IN ('pg_catalog', 'information_schema')
          AND chain_identity.schema !~ '^pg_toast(_temp_[0-9]+)?$'
      ) AS has_external_owner
    FROM candidate
    CROSS JOIN LATERAL pg_catalog.pg_identify_object(
      candidate.classid, candidate.objid, candidate.objsubid
    ) AS identified
  )
  SELECT classified.identity INTO offending_identity
  FROM classified
  WHERE CASE
      WHEN classified.direct_schema = target_schema THEN false
      WHEN classified.direct_schema ~ '^pg_toast(_temp_[0-9]+)?$'
        AND classified.has_target_owner THEN false
      WHEN classified.direct_schema IS NOT NULL THEN true
      ELSE classified.has_external_owner
        OR NOT classified.has_target_owner
    END
  ORDER BY classified.identity
  LIMIT 1;

  IF offending_identity IS NOT NULL THEN
    RAISE EXCEPTION
      'External non-extension object depends on a target-schema relation, type, or routine: %.',
      offending_identity
      USING ERRCODE = '42501';
  END IF;
END;
$external_dependencies$;

DO $phase7_catalog_prewrite$
DECLARE
  target_schema NAME := pg_catalog.current_setting(
    'app.phase7_enum_target_schema', false
  )::NAME;
BEGIN
  PERFORM pg_temp.phase7_enum_assert_no_external_dependencies(target_schema);
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger) THEN
    RAISE EXCEPTION 'Phase 7 canonical baseline forbids event triggers.'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_inherits AS inheritance
    JOIN pg_catalog.pg_class AS child_relation
      ON child_relation.oid = inheritance.inhrelid
    JOIN pg_catalog.pg_namespace AS child_namespace
      ON child_namespace.oid = child_relation.relnamespace
    JOIN pg_catalog.pg_class AS parent_relation
      ON parent_relation.oid = inheritance.inhparent
    JOIN pg_catalog.pg_namespace AS parent_namespace
      ON parent_namespace.oid = parent_relation.relnamespace
    WHERE child_namespace.nspname = target_schema
       OR parent_namespace.nspname = target_schema
  ) THEN
    RAISE EXCEPTION 'Phase 7 canonical baseline forbids table inheritance.'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication WHERE puballtables
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_namespace AS publication_namespace
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = publication_namespace.pnnspid
    WHERE namespace.nspname = target_schema
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_rel AS publication_relation
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = publication_relation.prrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = target_schema
  ) THEN
    RAISE EXCEPTION 'Phase 7 target schema publication surface is not empty.'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS object_row
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = object_row.relnamespace
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = object_row.relowner
    WHERE namespace.nspname = target_schema
      AND owner_role.rolname <> 'nihongo_phase7_migration'
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
          AND dependency.objid = object_row.oid AND dependency.deptype = 'e'
      )
    UNION ALL
    SELECT 1
    FROM pg_catalog.pg_proc AS object_row
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = object_row.pronamespace
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = object_row.proowner
    WHERE namespace.nspname = target_schema
      AND owner_role.rolname <> 'nihongo_phase7_migration'
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
          AND dependency.objid = object_row.oid AND dependency.deptype = 'e'
      )
    UNION ALL
    SELECT 1
    FROM pg_catalog.pg_type AS object_row
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = object_row.typnamespace
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = object_row.typowner
    WHERE namespace.nspname = target_schema
      AND owner_role.rolname <> 'nihongo_phase7_migration'
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
          AND dependency.objid = object_row.oid AND dependency.deptype = 'e'
      )
  ) THEN
    RAISE EXCEPTION 'Phase 7 target object ownership is not canonical.'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = trigger_row.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = target_schema
      AND trigger_row.tgisinternal
      AND trigger_row.tgconstraint <> 0
      AND trigger_row.tgenabled <> 'O'
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
          AND dependency.objid = relation.oid AND dependency.deptype = 'e'
      )
  ) THEN
    RAISE EXCEPTION 'Phase 7 internal constraint trigger is not enabled.'
      USING ERRCODE = '42501';
  END IF;
END;
$phase7_catalog_prewrite$;

CREATE FUNCTION pg_temp.phase7_enum_normalize_schema_shape(
  value TEXT,
  target_schema NAME
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $normalize$
DECLARE
  normalized TEXT := replace(value, '$', '$$');
BEGIN
  normalized := regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(normalized,
    'nihongo_(test|development)_phase7_migration_login',
    '$ENV_PHASE7_MIGRATION_LOGIN', 'g'),
    'nihongo_(test|development)_app_login', '$ENV_APP_LOGIN', 'g'),
    'nihongo_(test|development)_auth_gateway_login',
    '$ENV_AUTH_GATEWAY_LOGIN', 'g'),
    'nihongo_(test|development)_erasure_worker_login',
    '$ENV_ERASURE_WORKER_LOGIN', 'g'),
    'nihongo_(test|development)_legacy_app_login',
    '$ENV_LEGACY_APP_LOGIN', 'g');
  -- Protect the only approved application references to public pgcrypto before
  -- a public target schema is canonicalized.
  normalized := replace(replace(replace(replace(normalized,
    '\"public\".digest', '$PGCRYPTO.digest'),
    '\"public\".gen_random_uuid', '$PGCRYPTO.gen_random_uuid'),
    'public.digest', '$PGCRYPTO.digest'),
    'public.gen_random_uuid', '$PGCRYPTO.gen_random_uuid');
  normalized := replace(normalized,
    'SET search_path TO ' || quote_ident(target_schema) ||
      ', pg_catalog, pg_temp',
    'SET search_path TO "$SCHEMA", pg_catalog, pg_temp');
  normalized := replace(normalized,
    'SET search_path TO ' || quote_literal(target_schema) ||
      ', ''pg_catalog'', ''pg_temp''',
    'SET search_path TO ''$SCHEMA'', ''pg_catalog'', ''pg_temp''');
  normalized := replace(normalized,
    'SET search_path TO pg_catalog, ' || quote_ident(target_schema) ||
      ', pg_temp',
    'SET search_path TO pg_catalog, "$SCHEMA", pg_temp');
  normalized := replace(normalized,
    'SET search_path TO ''pg_catalog'', ' || quote_literal(target_schema) ||
      ', ''pg_temp''',
    'SET search_path TO ''pg_catalog'', ''$SCHEMA'', ''pg_temp''');
  -- pg_proc.proconfig is serialized separately from pg_get_functiondef and
  -- stores the hardened SECURITY DEFINER path as an unquoted GUC value.
  normalized := replace(normalized,
    'search_path=pg_catalog, ' || target_schema || ', pg_temp',
    'search_path=pg_catalog, $SCHEMA, pg_temp');
  normalized := replace(normalized,
    'search_path=' || target_schema || ', pg_catalog, pg_temp',
    'search_path=$SCHEMA, pg_catalog, pg_temp');
  normalized := replace(normalized,
    '\"' || target_schema || '\".', '\"$SCHEMA\".');
  normalized := replace(normalized,
    quote_ident(target_schema) || '.', '"$SCHEMA".');
  normalized := regexp_replace(normalized,
    '(^|[^A-Za-z0-9_$])' || target_schema || '\.',
    '\1$SCHEMA.', 'g');
  normalized := replace(normalized,
    quote_literal(target_schema), quote_literal('$SCHEMA'));
  -- The attested schema name may also occur as a standalone catalog field or
  -- inside a future pg_get_* rendering. It is a deployment identifier, never
  -- semantic application data, so canonicalize any remaining exact token.
  normalized := replace(normalized, target_schema::TEXT, '$SCHEMA');
  RETURN normalized;
END;
$normalize$;

-- Hash the schema's semantic catalog shape independently of its generated
-- schema name and of deployment-only ownership/ACL state. Extension members
-- are deliberately outside this application-owned fingerprint.
CREATE FUNCTION pg_temp.phase7_enum_schema_shape_digest(target_schema NAME)
RETURNS TEXT
LANGUAGE SQL
STABLE
SET search_path = pg_catalog, pg_temp
AS $schema_shape$
WITH target AS (
  SELECT namespace.oid AS schema_oid,
    namespace.nspname AS schema_name,
    quote_ident(namespace.nspname) AS quoted_schema_name
  FROM pg_catalog.pg_namespace AS namespace
  WHERE namespace.nspname = target_schema
), catalog_rows(kind, identity, definition) AS (
  SELECT 'EXT'::TEXT, extension.extname::TEXT,
    pg_catalog.jsonb_build_array(extension.extversion,
      extension_namespace.nspname,
      (SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_array(
            identified.type, '$PGCRYPTO',
            replace(identified.name, '$', '$$'),
            replace(replace(replace(identified.identity, '$', '$$'),
              '"public".', '"$PGCRYPTO".'),
              'public.', '$PGCRYPTO.')
          ) ORDER BY identified.type COLLATE "C",
            COALESCE(identified.schema, '') COLLATE "C",
            COALESCE(identified.name, '') COLLATE "C",
            identified.identity COLLATE "C")
       FROM pg_catalog.pg_depend AS dependency
       CROSS JOIN LATERAL pg_catalog.pg_identify_object(
         dependency.classid, dependency.objid, dependency.objsubid
       ) AS identified
       WHERE dependency.refclassid =
           'pg_catalog.pg_extension'::pg_catalog.regclass
         AND dependency.refobjid = extension.oid
         AND dependency.deptype = 'e'))::TEXT
  FROM pg_catalog.pg_extension AS extension
  JOIN pg_catalog.pg_namespace AS extension_namespace
    ON extension_namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pgcrypto'
    AND extension_namespace.nspname = 'public'

  UNION ALL
  SELECT 'REL', relation.relname,
    pg_catalog.jsonb_build_array(relation.relkind, relation.relpersistence,
      relation.relrowsecurity, relation.relforcerowsecurity,
      relation.relreplident, access_method.amname,
      relation.reloptions,
      CASE WHEN relation.relkind IN ('v', 'm')
        THEN pg_catalog.pg_get_viewdef(relation.oid, false) END,
      pg_catalog.pg_get_expr(relation.relpartbound, relation.oid, false))::TEXT
  FROM target
  JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = target.schema_oid
  LEFT JOIN pg_catalog.pg_am AS access_method
    ON access_method.oid = relation.relam
  WHERE relation.relkind <> 'i'
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_depend AS dependency
      WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
        AND dependency.objid = relation.oid AND dependency.deptype = 'e'
    )

  UNION ALL
  SELECT 'COL', relation.relname || '.' || attribute.attname,
    pg_catalog.jsonb_build_array(
      (SELECT COUNT(*)::INTEGER
       FROM pg_catalog.pg_attribute AS logical_attribute
       WHERE logical_attribute.attrelid = attribute.attrelid
         AND logical_attribute.attnum > 0
         AND NOT logical_attribute.attisdropped
         AND logical_attribute.attnum <= attribute.attnum),
      attribute.attname,
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
      attribute.attnotnull, attribute.attidentity, attribute.attgenerated,
      pg_catalog.jsonb_build_array(collation_namespace.nspname,
        collation_record.collname), attribute.attstorage, attribute.attcompression,
      pg_catalog.pg_get_expr(attribute_default.adbin,
        attribute_default.adrelid, false))::TEXT
  FROM target
  JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = target.schema_oid
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = relation.oid
  LEFT JOIN pg_catalog.pg_attrdef AS attribute_default
    ON attribute_default.adrelid = relation.oid
   AND attribute_default.adnum = attribute.attnum
  LEFT JOIN pg_catalog.pg_collation AS collation_record
    ON collation_record.oid = attribute.attcollation
  LEFT JOIN pg_catalog.pg_namespace AS collation_namespace
    ON collation_namespace.oid = collation_record.collnamespace
  WHERE relation.relkind <> 'i' AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_depend AS dependency
      WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
        AND dependency.objid = relation.oid AND dependency.deptype = 'e'
    )

  UNION ALL
  SELECT 'CON', pg_catalog.jsonb_build_array(
      relation.relname, type_value.typname, constraint_row.conname)::TEXT,
    pg_catalog.jsonb_build_array(constraint_row.contype,
      constraint_row.condeferrable,
      constraint_row.condeferred, constraint_row.convalidated,
      constraint_row.connoinherit,
      pg_catalog.pg_get_constraintdef(constraint_row.oid, false))::TEXT
  FROM target
  JOIN pg_catalog.pg_constraint AS constraint_row
    ON constraint_row.connamespace = target.schema_oid
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.oid = constraint_row.conrelid
  LEFT JOIN pg_catalog.pg_type AS type_value
    ON type_value.oid = constraint_row.contypid
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend AS dependency
    WHERE dependency.classid =
        'pg_catalog.pg_constraint'::pg_catalog.regclass
      AND dependency.objid = constraint_row.oid AND dependency.deptype = 'e'
  )

  UNION ALL
  SELECT 'IDX', index_relation.relname,
    pg_catalog.jsonb_build_array(index_row.indisunique, index_row.indisprimary,
      index_row.indisexclusion, index_row.indimmediate,
      index_row.indisclustered, index_row.indisvalid, index_row.indisready,
      index_row.indislive, index_row.indisreplident,
      index_row.indnkeyatts, index_row.indnatts,
      pg_catalog.pg_get_indexdef(index_relation.oid, 0, false))::TEXT
  FROM target
  JOIN pg_catalog.pg_class AS index_relation
    ON index_relation.relnamespace = target.schema_oid
   AND index_relation.relkind = 'i'
  JOIN pg_catalog.pg_index AS index_row
    ON index_row.indexrelid = index_relation.oid
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend AS dependency
    WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
      AND dependency.objid = index_relation.oid AND dependency.deptype = 'e'
  )

  UNION ALL
  SELECT 'TRG', relation.relname || '.' || trigger_row.tgname,
    pg_catalog.jsonb_build_array(trigger_row.tgenabled,
      pg_catalog.pg_get_triggerdef(trigger_row.oid, false))::TEXT
  FROM target
  JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = target.schema_oid
  JOIN pg_catalog.pg_trigger AS trigger_row
    ON trigger_row.tgrelid = relation.oid
  WHERE NOT trigger_row.tgisinternal
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_depend AS dependency
      WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
        AND dependency.objid = relation.oid AND dependency.deptype = 'e'
    )

  UNION ALL
  SELECT 'INTERNAL_TRG',
    pg_catalog.jsonb_build_array(
      relation.relname, constraint_row.conname,
      function_namespace.nspname, trigger_function.proname,
      pg_catalog.pg_get_function_identity_arguments(trigger_function.oid)
    )::TEXT,
    pg_catalog.jsonb_build_array(
      trigger_row.tgtype, trigger_row.tgenabled,
      trigger_row.tgdeferrable, trigger_row.tginitdeferred
    )::TEXT
  FROM target
  JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = target.schema_oid
  JOIN pg_catalog.pg_trigger AS trigger_row
    ON trigger_row.tgrelid = relation.oid
  JOIN pg_catalog.pg_constraint AS constraint_row
    ON constraint_row.oid = trigger_row.tgconstraint
  JOIN pg_catalog.pg_proc AS trigger_function
    ON trigger_function.oid = trigger_row.tgfoid
  JOIN pg_catalog.pg_namespace AS function_namespace
    ON function_namespace.oid = trigger_function.pronamespace
  WHERE trigger_row.tgisinternal
    AND trigger_row.tgconstraint <> 0
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_depend AS dependency
      WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
        AND dependency.objid = relation.oid AND dependency.deptype = 'e'
    )

  UNION ALL
  SELECT 'PROC', procedure.proname || '(' ||
      pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')',
    pg_catalog.jsonb_build_array(procedure.prokind, procedure.provolatile,
      procedure.proparallel, procedure.proisstrict, procedure.prosecdef,
      procedure.proleakproof, procedure.proconfig,
      pg_catalog.pg_get_functiondef(procedure.oid))::TEXT
  FROM target
  JOIN pg_catalog.pg_proc AS procedure
    ON procedure.pronamespace = target.schema_oid
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend AS dependency
    WHERE dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
      AND dependency.objid = procedure.oid AND dependency.deptype = 'e'
  )

  UNION ALL
  SELECT 'RULE', relation.relname || '.' || rewrite.rulename,
    pg_catalog.jsonb_build_array(rewrite.ev_enabled,
      pg_catalog.pg_get_ruledef(rewrite.oid, false))::TEXT
  FROM target
  JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = target.schema_oid
  JOIN pg_catalog.pg_rewrite AS rewrite ON rewrite.ev_class = relation.oid
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend AS dependency
    WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
      AND dependency.objid = relation.oid AND dependency.deptype = 'e'
  )

  UNION ALL
  SELECT 'POLICY', relation.relname || '.' || policy.polname,
    pg_catalog.jsonb_build_array(policy.polcmd, policy.polpermissive,
      (SELECT pg_catalog.jsonb_agg(COALESCE(role_row.rolname, 'PUBLIC')
          ORDER BY COALESCE(role_row.rolname, 'PUBLIC') COLLATE "C")
       FROM unnest(policy.polroles) AS policy_role(role_oid)
       LEFT JOIN pg_catalog.pg_roles AS role_row
         ON role_row.oid = policy_role.role_oid),
      pg_catalog.pg_get_expr(policy.polqual, policy.polrelid, false),
      pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid, false))::TEXT
  FROM target
  JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = target.schema_oid
  JOIN pg_catalog.pg_policy AS policy ON policy.polrelid = relation.oid
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend AS dependency
    WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
      AND dependency.objid = relation.oid AND dependency.deptype = 'e'
  )

  UNION ALL
  SELECT 'EVT', event_trigger.evtname,
    pg_catalog.jsonb_build_array(event_trigger.evtevent,
      event_trigger.evtenabled,
      (SELECT pg_catalog.jsonb_agg(tag ORDER BY tag COLLATE "C")
       FROM unnest(event_trigger.evttags) AS event_tag(tag)),
      procedure.proname || '(' ||
      pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')')::TEXT
  FROM target
  JOIN pg_catalog.pg_proc AS procedure
    ON procedure.pronamespace = target.schema_oid
  JOIN pg_catalog.pg_event_trigger AS event_trigger
    ON event_trigger.evtfoid = procedure.oid
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend AS dependency
      WHERE dependency.classid =
        'pg_catalog.pg_event_trigger'::pg_catalog.regclass
      AND dependency.objid = event_trigger.oid AND dependency.deptype = 'e'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend AS dependency
    WHERE dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
      AND dependency.objid = procedure.oid AND dependency.deptype = 'e'
  )

  UNION ALL
  SELECT 'SEQ', sequence_class.relname,
    pg_catalog.jsonb_build_array(
      pg_catalog.format_type(sequence.seqtypid, NULL),
      sequence.seqstart, sequence.seqincrement, sequence.seqmax,
      sequence.seqmin, sequence.seqcache, sequence.seqcycle)::TEXT
  FROM target
  JOIN pg_catalog.pg_class AS sequence_class
    ON sequence_class.relnamespace = target.schema_oid
   AND sequence_class.relkind = 'S'
  JOIN pg_catalog.pg_sequence AS sequence
    ON sequence.seqrelid = sequence_class.oid
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend AS dependency
    WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
      AND dependency.objid = sequence_class.oid AND dependency.deptype = 'e'
  )

  UNION ALL
  SELECT 'TYPE', type_value.typname,
    pg_catalog.jsonb_build_array(type_value.typtype, type_value.typcategory,
      type_value.typispreferred, type_value.typdelim, type_value.typnotnull,
      pg_catalog.format_type(NULLIF(type_value.typbasetype, 0),
        type_value.typtypmod),
      pg_catalog.jsonb_build_array(type_collation_namespace.nspname,
        collation_record.collname),
      (SELECT pg_catalog.jsonb_agg(enum.enumlabel ORDER BY enum.enumsortorder)
       FROM pg_catalog.pg_enum AS enum
       WHERE enum.enumtypid = type_value.oid),
      (SELECT pg_catalog.jsonb_build_array(
          pg_catalog.format_type(range_row.rngsubtype, NULL),
          pg_catalog.jsonb_build_array(operator_class_namespace.nspname,
            operator_class.opcname),
          pg_catalog.jsonb_build_array(range_collation_namespace.nspname,
            range_collation.collname),
          range_row.rngcanonical::pg_catalog.regprocedure::TEXT,
          range_row.rngsubdiff::pg_catalog.regprocedure::TEXT,
          pg_catalog.format_type(range_row.rngmultitypid, NULL))
       FROM pg_catalog.pg_range AS range_row
       JOIN pg_catalog.pg_opclass AS operator_class
         ON operator_class.oid = range_row.rngsubopc
       JOIN pg_catalog.pg_namespace AS operator_class_namespace
         ON operator_class_namespace.oid = operator_class.opcnamespace
       LEFT JOIN pg_catalog.pg_collation AS range_collation
         ON range_collation.oid = range_row.rngcollation
       LEFT JOIN pg_catalog.pg_namespace AS range_collation_namespace
         ON range_collation_namespace.oid = range_collation.collnamespace
       WHERE range_row.rngtypid = type_value.oid))::TEXT
  FROM target
  JOIN pg_catalog.pg_type AS type_value
    ON type_value.typnamespace = target.schema_oid
  LEFT JOIN pg_catalog.pg_collation AS collation_record
    ON collation_record.oid = type_value.typcollation
  LEFT JOIN pg_catalog.pg_namespace AS type_collation_namespace
    ON type_collation_namespace.oid = collation_record.collnamespace
  WHERE type_value.typrelid = 0
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_depend AS dependency
      WHERE dependency.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
        AND dependency.objid = type_value.oid AND dependency.deptype = 'e'
    )

  UNION ALL
  SELECT 'OPER', operator.oprname || '(' ||
      pg_catalog.format_type(operator.oprleft, NULL) || ',' ||
      pg_catalog.format_type(operator.oprright, NULL) || ')',
    pg_catalog.jsonb_build_array(operator.oprkind, operator.oprcanmerge,
      operator.oprcanhash, pg_catalog.format_type(operator.oprresult, NULL),
      NULLIF(operator.oprcom, 0)::pg_catalog.regoperator::TEXT,
      NULLIF(operator.oprnegate, 0)::pg_catalog.regoperator::TEXT,
      operator.oprcode::pg_catalog.regprocedure::TEXT,
      operator.oprrest::pg_catalog.regprocedure::TEXT,
      operator.oprjoin::pg_catalog.regprocedure::TEXT)::TEXT
  FROM target
  JOIN pg_catalog.pg_operator AS operator
    ON operator.oprnamespace = target.schema_oid
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend AS dependency
    WHERE dependency.classid = 'pg_catalog.pg_operator'::pg_catalog.regclass
      AND dependency.objid = operator.oid AND dependency.deptype = 'e'
  )

  UNION ALL
  SELECT 'COLL', collation_record.collname,
    pg_catalog.jsonb_build_array(collation_record.collencoding,
      collation_record.collprovider,
      collation_record.collisdeterministic, collation_record.collcollate,
      collation_record.collctype, collation_record.collversion)::TEXT
  FROM target
  JOIN pg_catalog.pg_collation AS collation_record
    ON collation_record.collnamespace = target.schema_oid
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend AS dependency
    WHERE dependency.classid = 'pg_catalog.pg_collation'::pg_catalog.regclass
      AND dependency.objid = collation_record.oid AND dependency.deptype = 'e'
  )

  UNION ALL
  SELECT 'OPCLASS', access_method.amname || '.' || operator_class.opcname,
    pg_catalog.jsonb_build_array(operator_class.opcdefault,
      pg_catalog.format_type(operator_class.opcintype, NULL),
      pg_catalog.format_type(NULLIF(operator_class.opckeytype, 0), NULL),
      pg_catalog.jsonb_build_array(operator_family_namespace.nspname,
        operator_family.opfname),
      (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
          member.amopstrategy,
          member.amoppurpose,
          pg_catalog.format_type(member.amoplefttype, NULL),
          pg_catalog.format_type(member.amoprighttype, NULL),
          member.amopopr::pg_catalog.regoperator::TEXT,
          pg_catalog.jsonb_build_array(sort_family_namespace.nspname,
            sort_family.opfname)) ORDER BY member.amopstrategy,
          member.amoppurpose, member.amoplefttype, member.amoprighttype,
          member.amopopr)
       FROM pg_catalog.pg_amop AS member
       LEFT JOIN pg_catalog.pg_opfamily AS sort_family
         ON sort_family.oid = member.amopsortfamily
       LEFT JOIN pg_catalog.pg_namespace AS sort_family_namespace
         ON sort_family_namespace.oid = sort_family.opfnamespace
       WHERE member.amopfamily = operator_family.oid),
      (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
          member.amprocnum,
          pg_catalog.format_type(member.amproclefttype, NULL),
          pg_catalog.format_type(member.amprocrighttype, NULL),
          member.amproc::pg_catalog.regprocedure::TEXT)
          ORDER BY member.amprocnum, member.amproclefttype,
            member.amprocrighttype, member.amproc)
       FROM pg_catalog.pg_amproc AS member
       WHERE member.amprocfamily = operator_family.oid))::TEXT
  FROM target
  JOIN pg_catalog.pg_opclass AS operator_class
    ON operator_class.opcnamespace = target.schema_oid
  JOIN pg_catalog.pg_am AS access_method
    ON access_method.oid = operator_class.opcmethod
  JOIN pg_catalog.pg_opfamily AS operator_family
    ON operator_family.oid = operator_class.opcfamily
  JOIN pg_catalog.pg_namespace AS operator_family_namespace
    ON operator_family_namespace.oid = operator_family.opfnamespace
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend AS dependency
    WHERE dependency.classid = 'pg_catalog.pg_opclass'::pg_catalog.regclass
      AND dependency.objid = operator_class.oid AND dependency.deptype = 'e'
  )

  UNION ALL
  SELECT 'OPFAMILY', access_method.amname || '.' || operator_family.opfname,
    pg_catalog.jsonb_build_array(
      (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
          member.amopstrategy, member.amoppurpose,
          pg_catalog.format_type(member.amoplefttype, NULL),
          pg_catalog.format_type(member.amoprighttype, NULL),
          member.amopopr::pg_catalog.regoperator::TEXT,
          pg_catalog.jsonb_build_array(sort_namespace.nspname,
            sort_family.opfname)) ORDER BY member.amopstrategy,
          member.amoppurpose, member.amoplefttype, member.amoprighttype,
          member.amopopr)
       FROM pg_catalog.pg_amop AS member
       LEFT JOIN pg_catalog.pg_opfamily AS sort_family
         ON sort_family.oid = member.amopsortfamily
       LEFT JOIN pg_catalog.pg_namespace AS sort_namespace
         ON sort_namespace.oid = sort_family.opfnamespace
       WHERE member.amopfamily = operator_family.oid),
      (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
          member.amprocnum,
          pg_catalog.format_type(member.amproclefttype, NULL),
          pg_catalog.format_type(member.amprocrighttype, NULL),
          member.amproc::pg_catalog.regprocedure::TEXT)
          ORDER BY member.amprocnum, member.amproclefttype,
            member.amprocrighttype, member.amproc)
       FROM pg_catalog.pg_amproc AS member
       WHERE member.amprocfamily = operator_family.oid))::TEXT
  FROM target
  JOIN pg_catalog.pg_opfamily AS operator_family
    ON operator_family.opfnamespace = target.schema_oid
  JOIN pg_catalog.pg_am AS access_method
    ON access_method.oid = operator_family.opfmethod
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend AS dependency
    WHERE dependency.classid =
        'pg_catalog.pg_opfamily'::pg_catalog.regclass
      AND dependency.objid = operator_family.oid AND dependency.deptype = 'e'
  )
), normalized AS (
  SELECT kind,
    CASE WHEN kind = 'EXT' THEN identity ELSE
    pg_temp.phase7_enum_normalize_schema_shape(
      identity, target.schema_name::NAME
    ) END AS identity,
    CASE WHEN kind = 'EXT' THEN definition ELSE
    pg_temp.phase7_enum_normalize_schema_shape(
      definition, target.schema_name::NAME
    ) END AS definition
  FROM catalog_rows CROSS JOIN target
), canonical AS (
  SELECT string_agg(
    pg_catalog.jsonb_build_array(kind, identity, definition)::TEXT,
    E'\n' ORDER BY kind COLLATE "C", identity COLLATE "C",
      definition COLLATE "C"
  ) AS payload
  FROM normalized
)
SELECT pg_catalog.encode(pg_catalog.sha256(
  pg_catalog.convert_to(COALESCE(payload, ''), 'UTF8')
), 'hex')
FROM canonical
$schema_shape$;


DO $phase7_enum_preflight$
DECLARE
  target_schema NAME := pg_catalog.current_setting(
    'app.phase7_enum_target_schema',
    false
  )::NAME;
  current_labels TEXT[];
BEGIN
  IF pg_catalog.current_database() !~ '(_test|_dev)$' THEN
    RAISE EXCEPTION 'Phase 7 enum migration is TEST/DEVELOPMENT only.'
      USING ERRCODE = '42501';
  END IF;
  IF target_schema IS NULL OR target_schema IN ('pg_catalog', 'pg_temp')
    OR target_schema !~ '^[a-z_][a-z0-9_]*$'
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_namespace AS temp_namespace
      WHERE temp_namespace.nspname = target_schema
        AND (
          temp_namespace.oid = pg_catalog.pg_my_temp_schema()
          OR pg_catalog.pg_is_other_temp_schema(temp_namespace.oid)
          OR temp_namespace.nspname ~ '^pg_(toast_)?temp_[0-9]+$'
        )
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_namespace AS namespace
      JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = namespace.nspowner
      WHERE namespace.nspname = target_schema
        AND owner_role.rolname = CURRENT_USER
    ) THEN
    RAISE EXCEPTION 'Phase 7 enum migration must own a safe target schema.'
      USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.array_agg(enum_row.enumlabel ORDER BY enum_row.enumsortorder)
  INTO current_labels
  FROM pg_catalog.pg_type AS type_row
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = type_row.typnamespace
  JOIN pg_catalog.pg_enum AS enum_row ON enum_row.enumtypid = type_row.oid
  WHERE namespace.nspname = target_schema
    AND type_row.typname = 'QuestionVersionStatus';
  IF current_labels IS DISTINCT FROM ARRAY['DRAFT','PUBLISHED','RETIRED']::TEXT[] THEN
    RAISE EXCEPTION 'QuestionVersionStatus preflight labels are not exact.'
      USING ERRCODE = '23514';
  END IF;
  PERFORM pg_catalog.set_config(
    'search_path',
    pg_catalog.format('%I, pg_catalog, pg_temp', target_schema),
    true
  );
END;
$phase7_enum_preflight$;

DO $phase7_pre_enum_schema_shape$
DECLARE
  actual_digest TEXT := pg_temp.phase7_enum_schema_shape_digest(
    pg_catalog.current_setting('app.phase7_enum_target_schema', false)::NAME
  );
  expected_digest CONSTANT TEXT :=
    'ed940b179d87a48e3e1591b50c799855783a32a6b173ce00d6cfad5396579f23';
BEGIN
  IF actual_digest <> expected_digest THEN
    RAISE EXCEPTION
      'Pristine pre-enum Phase 6 canonical schema shape drifted: %.',
      actual_digest USING ERRCODE = '55000';
  END IF;
END;
$phase7_pre_enum_schema_shape$;

ALTER TYPE "QuestionVersionStatus" ADD VALUE 'IN_REVIEW' AFTER 'DRAFT';
ALTER TYPE "QuestionVersionStatus" ADD VALUE 'CHANGES_REQUESTED' AFTER 'IN_REVIEW';
ALTER TYPE "QuestionVersionStatus" ADD VALUE 'APPROVED' AFTER 'CHANGES_REQUESTED';

SELECT pg_temp.phase7_enum_assert_no_external_dependencies(
  pg_catalog.current_setting(
    'app.phase7_enum_target_schema', false
  )::NAME
);

COMMIT;
