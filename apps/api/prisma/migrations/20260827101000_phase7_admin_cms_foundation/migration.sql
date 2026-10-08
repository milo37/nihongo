-- Phase 7 Slice 1, unit 2 of 2: TEST/DEVELOPMENT persistence foundation.
-- This is additive over the immutable Phase 1-6 ledger. Phase 7 HTTP routes
-- remain unregistered until the later activation slices.

BEGIN;

-- Capture the Prisma-selected application schema without resolving any
-- user-schema function/operator, then make extension verification and security
-- preflight work pg_catalog-first. The application schema is not restored to
-- the path until shadow objects have been rejected.
SELECT pg_catalog.set_config(
  'app.phase7_target_schema',
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
    'app.phase7_target_schema', false
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
    'app.phase7_target_schema', false
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

CREATE FUNCTION pg_temp.phase7_assert_no_external_dependencies(
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
    'app.phase7_target_schema', false
  )::NAME;
BEGIN
  PERFORM pg_temp.phase7_assert_no_external_dependencies(target_schema);
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

-- DDL needs the application schema first, but only after the target has no
-- non-extension object capable of shadowing a pg_catalog relation, type,
-- function, operator, collation, or operator class. Explicit CREATE grants are
-- removed from every non-migration principal before switching the path.
DO $phase7_safe_search_path$
DECLARE
  target_schema NAME := pg_catalog.current_setting(
    'app.phase7_target_schema',
    false
  )::NAME;
  unsafe_grantee RECORD;
BEGIN
  IF target_schema IS NULL
    OR target_schema IN ('pg_catalog', 'pg_temp')
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
    ) THEN
    RAISE EXCEPTION 'Phase 7 requires an application schema.'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespace
    JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.oid = namespace.nspowner
    WHERE namespace.nspname = target_schema
      AND owner_role.rolname = CURRENT_USER
  ) THEN
    RAISE EXCEPTION 'Phase 7 migration principal must own the target schema.'
      USING ERRCODE = '42501';
  END IF;
  EXECUTE pg_catalog.format(
    'REVOKE CREATE ON SCHEMA %I FROM PUBLIC',
    target_schema
  );
  FOR unsafe_grantee IN
    SELECT role_row.rolname
    FROM pg_catalog.pg_namespace AS namespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
      namespace.nspacl,
      pg_catalog.acldefault('n', namespace.nspowner)
    )) AS acl_entry
    JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = acl_entry.grantee
    WHERE namespace.nspname = target_schema
      AND acl_entry.privilege_type = 'CREATE'
      AND role_row.rolname <> CURRENT_USER
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE CREATE ON SCHEMA %I FROM %I',
      target_schema,
      unsafe_grantee.rolname
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS target_object
    JOIN pg_catalog.pg_namespace AS target_namespace
      ON target_namespace.oid = target_object.relnamespace
    WHERE target_namespace.nspname = target_schema
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS catalog_object
        JOIN pg_catalog.pg_namespace AS catalog_namespace
          ON catalog_namespace.oid = catalog_object.relnamespace
        WHERE catalog_namespace.nspname = 'pg_catalog'
          AND catalog_object.relname = target_object.relname
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
          AND dependency.objid = target_object.oid
          AND dependency.deptype = 'e'
      )
    UNION ALL
    SELECT 1
    FROM pg_catalog.pg_type AS target_object
    JOIN pg_catalog.pg_namespace AS target_namespace
      ON target_namespace.oid = target_object.typnamespace
    WHERE target_namespace.nspname = target_schema
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_type AS catalog_object
        JOIN pg_catalog.pg_namespace AS catalog_namespace
          ON catalog_namespace.oid = catalog_object.typnamespace
        WHERE catalog_namespace.nspname = 'pg_catalog'
          AND catalog_object.typname = target_object.typname
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
          AND dependency.objid = target_object.oid
          AND dependency.deptype = 'e'
      )
    UNION ALL
    SELECT 1
    FROM pg_catalog.pg_proc AS target_object
    JOIN pg_catalog.pg_namespace AS target_namespace
      ON target_namespace.oid = target_object.pronamespace
    WHERE target_namespace.nspname = target_schema
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS catalog_object
        JOIN pg_catalog.pg_namespace AS catalog_namespace
          ON catalog_namespace.oid = catalog_object.pronamespace
        WHERE catalog_namespace.nspname = 'pg_catalog'
          AND catalog_object.proname = target_object.proname
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
          AND dependency.objid = target_object.oid
          AND dependency.deptype = 'e'
      )
    UNION ALL
    SELECT 1
    FROM pg_catalog.pg_operator AS target_object
    JOIN pg_catalog.pg_namespace AS target_namespace
      ON target_namespace.oid = target_object.oprnamespace
    WHERE target_namespace.nspname = target_schema
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_operator AS catalog_object
        JOIN pg_catalog.pg_namespace AS catalog_namespace
          ON catalog_namespace.oid = catalog_object.oprnamespace
        WHERE catalog_namespace.nspname = 'pg_catalog'
          AND catalog_object.oprname = target_object.oprname
      )
    UNION ALL
    SELECT 1
    FROM pg_catalog.pg_collation AS target_object
    JOIN pg_catalog.pg_namespace AS target_namespace
      ON target_namespace.oid = target_object.collnamespace
    WHERE target_namespace.nspname = target_schema
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_collation AS catalog_object
        JOIN pg_catalog.pg_namespace AS catalog_namespace
          ON catalog_namespace.oid = catalog_object.collnamespace
        WHERE catalog_namespace.nspname = 'pg_catalog'
          AND catalog_object.collname = target_object.collname
      )
    UNION ALL
    SELECT 1
    FROM pg_catalog.pg_opclass AS target_object
    JOIN pg_catalog.pg_namespace AS target_namespace
      ON target_namespace.oid = target_object.opcnamespace
    WHERE target_namespace.nspname = target_schema
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_opclass AS catalog_object
        JOIN pg_catalog.pg_namespace AS catalog_namespace
          ON catalog_namespace.oid = catalog_object.opcnamespace
        WHERE catalog_namespace.nspname = 'pg_catalog'
          AND catalog_object.opcname = target_object.opcname
      )
  ) THEN
    RAISE EXCEPTION 'Phase 7 target schema contains a pg_catalog shadow object.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT pg_catalog.has_schema_privilege(
    CURRENT_USER,
    target_schema,
    'CREATE'
  ) THEN
    RAISE EXCEPTION 'Phase 7 migration principal cannot create target objects.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.set_config(
    'search_path',
    pg_catalog.format('%I, pg_catalog, pg_temp', target_schema),
    true
  );
END;
$phase7_safe_search_path$;

CREATE FUNCTION pg_temp.phase7_normalize_schema_shape(
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
CREATE FUNCTION pg_temp.phase7_schema_shape_digest(target_schema NAME)
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
    pg_temp.phase7_normalize_schema_shape(
      identity, target.schema_name::NAME
    ) END AS identity,
    CASE WHEN kind = 'EXT' THEN definition ELSE
    pg_temp.phase7_normalize_schema_shape(
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

DO $phase7_phase6_schema_shape$
DECLARE
  actual_digest TEXT := pg_temp.phase7_schema_shape_digest(
    pg_catalog.current_setting('app.phase7_target_schema', false)::NAME
  );
  expected_digest CONSTANT TEXT :=
    'ca2e172236d60d253c7d39c64538e96010260a591043662bd3337405054e043a';
BEGIN
  IF actual_digest <> expected_digest THEN
    RAISE EXCEPTION 'Phase 6 canonical schema shape drifted: %.', actual_digest
      USING ERRCODE = '55000';
  END IF;
END;
$phase7_phase6_schema_shape$;

-- A populated pre-Phase-7 catalog must be the reviewed 65-question Phase 6
-- artifact. Empty schemas are allowed so the canonical seed can run after a
-- fresh deploy.
DO $preflight$
DECLARE
  question_count INTEGER;
  version_count INTEGER;
  option_count INTEGER;
  tag_count INTEGER;
  assignment_count INTEGER;
  assignment_digest TEXT;
  semantic_digest TEXT;
BEGIN
  SELECT COUNT(*) INTO question_count FROM "Question";
  SELECT COUNT(*) INTO version_count FROM "QuestionVersion";
  SELECT COUNT(*) INTO option_count FROM "QuestionOption";
  SELECT COUNT(*) INTO tag_count FROM "Tag";
  SELECT COUNT(*) INTO assignment_count FROM "QuestionVersionTag";

  IF question_count NOT IN (0, 65)
    OR (question_count = 0 AND (
      version_count <> 0 OR option_count <> 0 OR tag_count <> 0
      OR assignment_count <> 0
    ))
    OR (question_count = 65 AND (
      version_count <> 65 OR option_count <> 260 OR tag_count <> 108
      OR assignment_count <> 130
    )) THEN
    RAISE EXCEPTION 'Phase 7 requires an empty or canonical Phase 6 catalog.'
      USING ERRCODE = '23514';
  END IF;

  IF question_count = 65 THEN
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

    IF semantic_digest <>
      'a180a0ea8dac51200b533fbe99624036fc19984be9cfbdd0c972c624e764444c' THEN
      RAISE EXCEPTION 'Phase 6 reviewed semantic catalog drifted.'
        USING ERRCODE = '23514';
    END IF;

    SELECT encode(
      public.digest(
        convert_to(
          string_agg(
            assignment."id"::TEXT || '|' ||
            assignment."questionVersionId"::TEXT || '|' ||
            assignment."tagId"::TEXT || '|' ||
            assignment."labelSnapshot" || '|' || tag."normalizedName",
            E'\n' ORDER BY assignment."id"::TEXT COLLATE "C"
          ),
          'UTF8'
        ),
        'sha256'::TEXT
      ),
      'hex'
    )
    INTO assignment_digest
    FROM "QuestionVersionTag" AS assignment
    JOIN "Tag" AS tag ON tag."id" = assignment."tagId";

    IF assignment_digest <>
      '4e3f91b5341b90fed7064fc3d810cf5d6cfa581707012e92440c8b041e1130b1' THEN
      RAISE EXCEPTION 'Phase 6 reviewed tag assignment mapping drifted.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Question" AS question
    JOIN "QuestionVersion" AS version
      ON version."questionId" = question."id"
    WHERE question."currentPublishedVersionId" IS DISTINCT FROM version."id"
      OR version."status" <> 'PUBLISHED'
      OR version."versionNumber" <> 1
  ) OR EXISTS (
    SELECT 1
    FROM "Question"
    WHERE "lifecycleStatus" <> 'ACTIVE'
      OR "currentPublishedVersionId" IS NULL
      OR "createdByLabelSnapshot" <> 'SYSTEM_SEED'
      OR "createdByUserId" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Phase 6 catalog lifecycle/provenance preflight failed.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Question"
    WHERE "createdByLabelSnapshot" = 'DELETED_ADMIN'
  ) OR EXISTS (
    SELECT 1 FROM "QuestionVersion"
    WHERE "createdByLabelSnapshot" = 'DELETED_ADMIN'
  ) THEN
    RAISE EXCEPTION 'Legacy creator tombstones lack retained actor identity.'
      USING ERRCODE = '23514';
  END IF;
END;
$preflight$;

CREATE TYPE "RetirementKind" AS ENUM (
  'PUBLISHED_RETIREMENT',
  'AUTHOR_ERASURE_ABANDONED',
  'QUESTION_ARCHIVE_ABANDONED'
);
CREATE TYPE "AccountActorLabel" AS ENUM (
  'ACTIVE_USER',
  'DELETED_USER',
  'ACTIVE_ADMIN',
  'DELETED_ADMIN'
);
CREATE TYPE "EvidenceActorKind" AS ENUM ('ACCOUNT', 'SYSTEM');
CREATE TYPE "EvidenceActorRole" AS ENUM ('USER', 'ADMIN', 'SYSTEM');
CREATE TYPE "SystemActorLabel" AS ENUM ('ACCOUNT_ERASURE');
CREATE TYPE "ContentReviewAction" AS ENUM (
  'REQUESTED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'APPROVAL_WITHDRAWN',
  'PUBLISHED',
  'RETIRED',
  'ARCHIVE_ABANDONED',
  'AUTHOR_ERASURE_ABANDONED'
);
CREATE TYPE "AdminAuditCommand" AS ENUM (
  'QUESTION_CREATE',
  'QUESTION_VERSION_CREATE',
  'QUESTION_VERSION_UPDATE',
  'REVIEW_REQUEST',
  'CHANGE_REQUEST',
  'APPROVAL',
  'APPROVAL_WITHDRAWAL',
  'PUBLICATION',
  'RETIREMENT',
  'QUESTION_ARCHIVE',
  'REVIEW_REQUEST_BATCH',
  'IMPORT_APPLY',
  'EXPORT',
  'REPORT_TRIAGE',
  'REPORT_RESOLUTION',
  'REAUTHENTICATION',
  'AUTHOR_ERASURE_ABANDON'
);
CREATE TYPE "AdminAuditTargetType" AS ENUM (
  'QUESTION',
  'QUESTION_VERSION',
  'QUESTION_REPORT',
  'REVIEW_REQUEST_BATCH',
  'IMPORT_REQUEST',
  'EXPORT_REQUEST',
  'ADMIN_SESSION',
  'USER_ERASURE'
);
CREATE TYPE "AdminAuditEnvironment" AS ENUM ('TEST', 'DEVELOPMENT');
CREATE TYPE "QuestionReportReason" AS ENUM (
  'ANSWER_ERROR',
  'EXPLANATION_ERROR',
  'TYPO_OR_GRAMMAR',
  'AMBIGUOUS',
  'LEVEL_OR_TAXONOMY',
  'OTHER'
);
CREATE TYPE "QuestionReportStatus" AS ENUM (
  'OPEN',
  'TRIAGED',
  'RESOLVED',
  'DISMISSED'
);
CREATE TYPE "QuestionReportResolutionOutcome" AS ENUM (
  'RESOLVED',
  'DISMISSED'
);
CREATE TYPE "AuthSessionFamilyStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "AuthSessionIssuerProtocolVersion" AS ENUM (
  'LEGACY',
  'PHASE7_V1'
);
CREATE TYPE "AuthVerificationPurpose" AS ENUM ('PASSWORD_RESET_V1');

-- Remove legacy guards before their reviewed backfill. If any later statement
-- fails, this transaction restores their exact prior definitions.
DROP TRIGGER IF EXISTS "QuestionVersion_validate_change" ON "QuestionVersion";
DROP TRIGGER IF EXISTS "QuestionOption_protect_immutable_version" ON "QuestionOption";
DROP TRIGGER IF EXISTS "QuestionVersionTag_protect_immutable_version" ON "QuestionVersionTag";
DROP TRIGGER IF EXISTS "Question_validate_current_version" ON "Question";
DROP TRIGGER IF EXISTS "QuestionVersion_protect_delete" ON "QuestionVersion";
DROP TRIGGER IF EXISTS "Question_protect_history_delete" ON "Question";
DROP TRIGGER IF EXISTS "Question_validate_active_admin_creator" ON "Question";
DROP TRIGGER IF EXISTS "QuestionVersion_validate_active_admin_creator" ON "QuestionVersion";
DROP TRIGGER IF EXISTS "User_anonymize_question_creator_before_delete" ON "User";

ALTER TABLE "Question"
  ADD COLUMN "rowVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "createdByActorId" UUID,
  ADD COLUMN "createdByRoleSnapshot" "UserRole";

ALTER TABLE "QuestionVersion"
  ADD COLUMN "retirementKind" "RetirementKind",
  ADD COLUMN "contentFingerprint" VARCHAR(64),
  ADD COLUMN "createdByActorId" UUID,
  ADD COLUMN "createdByRoleSnapshot" "UserRole";

ALTER TABLE "QuestionVersionTag"
  ADD COLUMN "normalizedNameSnapshot" TEXT;

ALTER TABLE "User"
  ADD COLUMN "authorityGeneration" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Session"
  ADD COLUMN "sessionFamilyId" UUID,
  ADD COLUMN "authorityGeneration" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "issuerProtocolVersion"
    "AuthSessionIssuerProtocolVersion" NOT NULL DEFAULT 'LEGACY';

ALTER TABLE "Verification"
  ADD COLUMN "purpose" "AuthVerificationPurpose",
  ADD COLUMN "resetUserId" UUID,
  ADD COLUMN "capturedGeneration" INTEGER,
  ADD COLUMN "tokenSelector" VARCHAR(64);

CREATE TABLE "AuthIssuerActivation" (
  "id" SMALLINT NOT NULL DEFAULT 1,
  "legacyIssuerDisabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "AuthIssuerActivation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthIssuerActivation_singleton_check" CHECK ("id" = 1)
);
INSERT INTO "AuthIssuerActivation" ("id") VALUES (1);

CREATE TABLE "AuthSessionFamily" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "status" "AuthSessionFamilyStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "revokedAt" TIMESTAMPTZ(3),
  CONSTRAINT "AuthSessionFamily_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthSessionFamily_userId_id_key" UNIQUE ("userId", "id"),
  CONSTRAINT "AuthSessionFamily_state_check" CHECK (
    ("status" = 'ACTIVE' AND "revokedAt" IS NULL)
    OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL
      AND "revokedAt" >= "createdAt")
  )
);

CREATE TABLE "AuthSessionRotationFence" (
  "id" UUID NOT NULL DEFAULT public.gen_random_uuid(),
  "oldSessionId" UUID NOT NULL,
  "oldTokenDigest" VARCHAR(64) NOT NULL,
  "userId" UUID NOT NULL,
  "oldFamilyId" UUID NOT NULL,
  "replacementFamilyId" UUID NOT NULL,
  "replacementSessionId" UUID NOT NULL,
  "operationId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AuthSessionRotationFence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthSessionRotationFence_oldSessionId_key" UNIQUE ("oldSessionId"),
  CONSTRAINT "AuthSessionRotationFence_oldTokenDigest_key" UNIQUE ("oldTokenDigest"),
  CONSTRAINT "AuthSessionRotationFence_operationId_key" UNIQUE ("operationId"),
  CONSTRAINT "AuthSessionRotationFence_digest_check" CHECK (
    "oldTokenDigest" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "AuthSessionRotationFence_family_check" CHECK (
    "oldFamilyId" = "replacementFamilyId"
  ),
  CONSTRAINT "AuthSessionRotationFence_time_check" CHECK (
    "expiresAt" >= "createdAt"
  )
);

CREATE TABLE "TagApplicability" (
  "tagId" UUID NOT NULL,
  "level" "JlptLevel" NOT NULL,
  "subject" "QuestionSubject" NOT NULL,
  "questionType" "QuestionType" NOT NULL,
  CONSTRAINT "TagApplicability_pkey"
    PRIMARY KEY ("tagId", "level", "subject", "questionType")
);

CREATE TABLE "ContentReview" (
  "id" UUID NOT NULL DEFAULT public.gen_random_uuid(),
  "questionId" UUID NOT NULL,
  "questionVersionId" UUID NOT NULL,
  "action" "ContentReviewAction" NOT NULL,
  "fromState" "QuestionVersionStatus" NOT NULL,
  "toState" "QuestionVersionStatus" NOT NULL,
  "actorKind" "EvidenceActorKind" NOT NULL,
  "actorUserId" UUID,
  "actorId" UUID,
  "actorRole" "EvidenceActorRole" NOT NULL,
  "actorLabel" "AccountActorLabel",
  "actorSystemLabel" "SystemActorLabel",
  "counterpartUserId" UUID,
  "counterpartActorId" UUID,
  "counterpartRole" "UserRole",
  "counterpartLabel" "AccountActorLabel",
  "reason" VARCHAR(100),
  "comment" VARCHAR(1000),
  "operationId" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ContentReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminAuditLog" (
  "id" UUID NOT NULL DEFAULT public.gen_random_uuid(),
  "command" "AdminAuditCommand" NOT NULL,
  "targetType" "AdminAuditTargetType" NOT NULL,
  "targetId" UUID NOT NULL,
  "actorKind" "EvidenceActorKind" NOT NULL,
  "actorUserId" UUID,
  "actorId" UUID,
  "actorRole" "EvidenceActorRole" NOT NULL,
  "actorLabel" "AccountActorLabel",
  "actorSystemLabel" "SystemActorLabel",
  "beforeState" VARCHAR(64),
  "afterState" VARCHAR(64),
  "beforeRowVersion" INTEGER,
  "afterRowVersion" INTEGER,
  "changedFields" JSONB NOT NULL,
  "metadata" JSONB NOT NULL,
  "contentDigest" VARCHAR(64) NOT NULL,
  "operationId" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "environment" "AdminAuditEnvironment" NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestionReport" (
  "id" UUID NOT NULL DEFAULT public.gen_random_uuid(),
  "questionId" UUID NOT NULL,
  "questionVersionId" UUID NOT NULL,
  "reason" "QuestionReportReason" NOT NULL,
  "description" TEXT,
  "descriptionDigest" VARCHAR(64) NOT NULL,
  "status" "QuestionReportStatus" NOT NULL DEFAULT 'OPEN',
  "reporterUserId" UUID,
  "reporterActorId" UUID NOT NULL,
  "reporterRole" "UserRole" NOT NULL,
  "reporterLabel" "AccountActorLabel" NOT NULL,
  "assigneeUserId" UUID,
  "assigneeActorId" UUID,
  "assigneeRole" "UserRole",
  "assigneeLabel" "AccountActorLabel",
  "resolutionOutcome" "QuestionReportResolutionOutcome",
  "resolutionReason" VARCHAR(1000),
  "remediationVersionId" UUID,
  "rowVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "resolvedAt" TIMESTAMPTZ(3),
  CONSTRAINT "QuestionReport_pkey" PRIMARY KEY ("id")
);

-- Retained actor identity and reviewed immutable snapshots.
UPDATE "Question"
SET "createdByActorId" = "createdByUserId",
    "createdByRoleSnapshot" = 'ADMIN'
WHERE "createdByLabelSnapshot" = 'ACTIVE_ADMIN';

UPDATE "QuestionVersion"
SET "createdByActorId" = "createdByUserId",
    "createdByRoleSnapshot" = 'ADMIN'
WHERE "createdByLabelSnapshot" = 'ACTIVE_ADMIN';

UPDATE "QuestionVersionTag" AS assignment
SET "normalizedNameSnapshot" = tag."normalizedName"
FROM "Tag" AS tag
WHERE tag."id" = assignment."tagId";

INSERT INTO "TagApplicability" ("tagId", "level", "subject", "questionType")
SELECT DISTINCT
  assignment."tagId",
  version."level",
  version."subject",
  version."questionType"
FROM "QuestionVersionTag" AS assignment
JOIN "QuestionVersion" AS version
  ON version."id" = assignment."questionVersionId";

-- Every legacy session receives its own ACTIVE family. Reusing the session UUID
-- is deterministic and does not conflate identity across table namespaces.
INSERT INTO "AuthSessionFamily" ("id", "userId", "createdAt")
SELECT "id", "userId", "createdAt"
FROM "Session";

UPDATE "Session"
SET "sessionFamilyId" = "id",
    "authorityGeneration" = 1,
    "issuerProtocolVersion" = 'LEGACY';

-- Better Auth's Phase 6 rolling refresh could extend a legitimate legacy
-- Session beyond 30 days from its original creation time. Normalize that
-- previously valid state before installing the absolute-lifetime constraint;
-- a Session whose cap is already in the past remains expired rather than
-- regaining authority during the upgrade.
UPDATE "Session"
SET "expiresAt" = "createdAt" + INTERVAL '30 days'
WHERE "expiresAt" > "createdAt" + INTERVAL '30 days';

ALTER TABLE "Session"
  ALTER COLUMN "sessionFamilyId" SET NOT NULL,
  ALTER COLUMN "sessionFamilyId" SET DEFAULT public.gen_random_uuid();

-- Exact option comparison and duplicate fingerprint v1 helpers. The explicit
-- Unicode White_Space set avoids database-locale-dependent POSIX classes.
CREATE FUNCTION "phase7_normalize_option_comparison"(value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
  SELECT regexp_replace(
    regexp_replace(
      normalize(value, NFKC),
      U&'^[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+|[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+$',
      '',
      'g'
    ),
    U&'[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+',
    ' ',
    'g'
  );
$function$;

CREATE FUNCTION "phase7_normalize_duplicate_text"(value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
  SELECT translate(
    "phase7_normalize_option_comparison"(value),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz'
  );
$function$;

CREATE FUNCTION "phase7_question_version_fingerprint"(target_version_id UUID)
RETURNS VARCHAR(64)
LANGUAGE plpgsql
STABLE
STRICT
AS $function$
DECLARE
  version_row "QuestionVersion"%ROWTYPE;
  option_array TEXT;
  correct_text TEXT;
  canonical_identity TEXT;
BEGIN
  SELECT * INTO version_row
  FROM "QuestionVersion"
  WHERE "id" = target_version_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    '[' || string_agg(
      to_json("phase7_normalize_duplicate_text"(option."text"))::TEXT,
      ',' ORDER BY "phase7_normalize_duplicate_text"(option."text") COLLATE "C"
    ) || ']'
  INTO option_array
  FROM "QuestionOption" AS option
  WHERE option."questionVersionId" = target_version_id;

  SELECT "phase7_normalize_duplicate_text"(option."text")
  INTO correct_text
  FROM "QuestionOption" AS option
  WHERE option."questionVersionId" = target_version_id
    AND option."id" = version_row."correctOptionId";

  IF option_array IS NULL OR correct_text IS NULL THEN
    RETURN NULL;
  END IF;

  canonical_identity :=
    '{"correctOptionText":' || to_json(correct_text)::TEXT ||
    ',"optionTexts":' || option_array ||
    ',"passage":' || COALESCE(
      to_json("phase7_normalize_duplicate_text"(version_row."passage"))::TEXT,
      'null'
    ) ||
    ',"questionText":' ||
      to_json("phase7_normalize_duplicate_text"(version_row."questionText"))::TEXT ||
    ',"questionType":' || to_json(version_row."questionType"::TEXT)::TEXT ||
    ',"subject":' || to_json(version_row."subject"::TEXT)::TEXT || '}';

  RETURN encode(
    public.digest(
      convert_to(canonical_identity, 'UTF8'),
      'sha256'::TEXT
    ),
    'hex'
  );
END;
$function$;

UPDATE "QuestionVersion"
SET "contentFingerprint" = "phase7_question_version_fingerprint"("id");

DO $backfill_check$
DECLARE
  assignment_digest TEXT;
  applicability_digest TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM "QuestionVersionTag"
    WHERE "normalizedNameSnapshot" IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM "QuestionVersionTag" AS assignment
    JOIN "Tag" AS tag ON tag."id" = assignment."tagId"
    WHERE assignment."labelSnapshot" IS DISTINCT FROM tag."label"
      OR assignment."normalizedNameSnapshot" IS DISTINCT FROM tag."normalizedName"
  ) THEN
    RAISE EXCEPTION 'Reviewed question tag snapshot backfill failed.'
      USING ERRCODE = '23514';
  END IF;

  IF (SELECT COUNT(*) FROM "Question") = 65 THEN
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
      E'\n' ORDER BY
        (applicability."tagId"::TEXT || '|' ||
         applicability."level"::TEXT || '|' ||
         applicability."subject"::TEXT || '|' ||
         applicability."questionType"::TEXT) COLLATE "C"
    ), 'UTF8'), 'sha256'::TEXT), 'hex')
    INTO applicability_digest
    FROM "TagApplicability" AS applicability;

    IF assignment_digest <>
      '4e3f91b5341b90fed7064fc3d810cf5d6cfa581707012e92440c8b041e1130b1'
      OR (SELECT COUNT(*) FROM "TagApplicability") <> 127
      OR applicability_digest <>
      'adeca1ed1c85338c85aa3ec13299d43532f9bf4e0f0515775a29563567f4b078'
      OR EXISTS (
        SELECT 1 FROM "QuestionVersion"
        WHERE "contentFingerprint" IS NULL
          OR "contentFingerprint" !~ '^[0-9a-f]{64}$'
      ) THEN
      RAISE EXCEPTION 'Phase 7 reviewed backfill parity failed.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$backfill_check$;

ALTER TABLE "QuestionVersion"
  ALTER COLUMN "contentFingerprint" SET NOT NULL,
  ALTER COLUMN "contentFingerprint" SET DEFAULT repeat('0', 64);

ALTER TABLE "QuestionVersionTag"
  ALTER COLUMN "normalizedNameSnapshot" SET NOT NULL,
  ALTER COLUMN "normalizedNameSnapshot" SET DEFAULT '';

CREATE FUNCTION "phase7_account_snapshot_valid"(
  live_user_id UUID,
  actor_id UUID,
  actor_role "UserRole",
  actor_label "AccountActorLabel",
  optional_position BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT CASE
    WHEN live_user_id IS NULL AND actor_id IS NULL
      AND actor_role IS NULL AND actor_label IS NULL
      THEN optional_position
    WHEN actor_id IS NULL OR actor_role IS NULL OR actor_label IS NULL
      THEN false
    WHEN actor_role = 'USER' AND actor_label NOT IN ('ACTIVE_USER', 'DELETED_USER')
      THEN false
    WHEN actor_role = 'ADMIN' AND actor_label NOT IN ('ACTIVE_ADMIN', 'DELETED_ADMIN')
      THEN false
    WHEN actor_label IN ('ACTIVE_USER', 'ACTIVE_ADMIN')
      THEN live_user_id IS NOT NULL AND live_user_id = actor_id
    WHEN actor_label IN ('DELETED_USER', 'DELETED_ADMIN')
      THEN live_user_id IS NULL
    ELSE false
  END;
$function$;

CREATE FUNCTION "phase7_evidence_actor_valid"(
  actor_kind "EvidenceActorKind",
  live_user_id UUID,
  actor_id UUID,
  actor_role "EvidenceActorRole",
  actor_label "AccountActorLabel",
  system_label "SystemActorLabel"
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT CASE actor_kind
    WHEN 'ACCOUNT' THEN
      system_label IS NULL
      AND actor_role IN ('USER', 'ADMIN')
      AND "phase7_account_snapshot_valid"(
        live_user_id,
        actor_id,
        actor_role::TEXT::"UserRole",
        actor_label,
        false
      )
    WHEN 'SYSTEM' THEN
      live_user_id IS NULL
      AND actor_id IS NULL
      AND actor_role = 'SYSTEM'
      AND actor_label IS NULL
      AND system_label = 'ACCOUNT_ERASURE'
    ELSE false
  END;
$function$;

CREATE FUNCTION "phase7_jsonb_object_size"(value JSONB)
RETURNS INTEGER
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
  SELECT COUNT(*)::INTEGER FROM jsonb_object_keys(value);
$function$;

CREATE FUNCTION "phase7_changed_fields_valid"(value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
DECLARE
  allowed TEXT[] := ARRAY[
    'LIFECYCLE_STATUS',
    'VERSION_STATUS',
    'CURRENT_PUBLISHED_VERSION_ID',
    'LEVEL',
    'SUBJECT',
    'QUESTION_TYPE',
    'DIFFICULTY',
    'PASSAGE',
    'QUESTION_TEXT',
    'EXPLANATION_KO',
    'EXPLANATION_JA',
    'OPTIONS',
    'CORRECT_OPTION',
    'TAGS',
    'ASSIGNEE',
    'RESOLUTION',
    'REPORT_STATUS',
    'SESSION_ROTATION',
    'IMPORT_ITEMS',
    'EXPORT_SELECTION',
    'AUTHOR_TOMBSTONE'
  ];
  previous_position INTEGER := 0;
  current_position INTEGER;
  field_value TEXT;
BEGIN
  IF jsonb_typeof(value) <> 'array' OR jsonb_array_length(value) > 64 THEN
    RETURN false;
  END IF;

  FOR field_value IN SELECT jsonb_array_elements_text(value)
  LOOP
    current_position := array_position(allowed, field_value);
    IF current_position IS NULL OR current_position <= previous_position THEN
      RETURN false;
    END IF;
    previous_position := current_position;
  END LOOP;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$;

CREATE FUNCTION "phase7_audit_metadata_valid"(value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
DECLARE
  kind TEXT;
  key_count INTEGER;
  item_count NUMERIC;
  question_count NUMERIC;
  version_count NUMERIC;
  abandoned_count NUMERIC;
  retired_count NUMERIC;
BEGIN
  IF jsonb_typeof(value) <> 'object' OR jsonb_typeof(value->'kind') <> 'string' THEN
    RETURN false;
  END IF;
  kind := value->>'kind';
  key_count := "phase7_jsonb_object_size"(value);

  IF kind = 'NONE_V1' THEN
    RETURN key_count = 1;
  ELSIF kind = 'REVIEW_REQUEST_BATCH_V1' THEN
    item_count := (value->>'itemCount')::NUMERIC;
    RETURN key_count = 2 AND jsonb_typeof(value->'itemCount') = 'number'
      AND item_count = trunc(item_count) AND item_count BETWEEN 1 AND 20;
  ELSIF kind = 'IMPORT_APPLY_V1' THEN
    item_count := (value->>'itemCount')::NUMERIC;
    RETURN key_count = 4 AND jsonb_typeof(value->'itemCount') = 'number'
      AND item_count = trunc(item_count) AND item_count BETWEEN 1 AND 100
      AND value->>'validationDigest' ~ '^[0-9a-f]{64}$'
      AND value->>'mappingDigest' ~ '^[0-9a-f]{64}$';
  ELSIF kind = 'EXPORT_V1' THEN
    question_count := (value->>'questionCount')::NUMERIC;
    version_count := (value->>'versionCount')::NUMERIC;
    RETURN key_count = 5
      AND jsonb_typeof(value->'questionCount') = 'number'
      AND jsonb_typeof(value->'versionCount') = 'number'
      AND question_count = trunc(question_count)
      AND version_count = trunc(version_count)
      AND question_count BETWEEN 1 AND 100
      AND version_count >= question_count
      AND version_count <= 9007199254740991
      AND value->>'selectionDigest' ~ '^[0-9a-f]{64}$'
      AND value->>'responseBodyDigest' ~ '^[0-9a-f]{64}$';
  ELSIF kind = 'REAUTHENTICATION_V1' THEN
    RETURN key_count = 2
      AND value->>'rotation' = 'OLD_REVOKED_NEW_ISSUED';
  ELSIF kind = 'QUESTION_ARCHIVE_V1' THEN
    retired_count := (value->>'retiredPublishedCount')::NUMERIC;
    abandoned_count := (value->>'abandonedCandidateCount')::NUMERIC;
    RETURN key_count = 3
      AND jsonb_typeof(value->'retiredPublishedCount') = 'number'
      AND jsonb_typeof(value->'abandonedCandidateCount') = 'number'
      AND retired_count IN (0, 1) AND abandoned_count IN (0, 1);
  ELSIF kind = 'AUTHOR_ERASURE_V1' THEN
    abandoned_count := (value->>'abandonedCount')::NUMERIC;
    RETURN key_count = 3
      AND jsonb_typeof(value->'abandonedCount') = 'number'
      AND abandoned_count = trunc(abandoned_count)
      AND abandoned_count BETWEEN 1 AND 9007199254740991
      AND value->>'subjectActorDigest' ~ '^[0-9a-f]{64}$';
  END IF;

  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$;

CREATE FUNCTION "phase7_audit_row_valid"(
  command_value "AdminAuditCommand",
  target_type_value "AdminAuditTargetType",
  actor_kind_value "EvidenceActorKind",
  actor_role_value "EvidenceActorRole",
  before_state_value TEXT,
  after_state_value TEXT,
  before_version_value INTEGER,
  after_version_value INTEGER,
  changed_fields_value JSONB,
  metadata_value JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $function$
DECLARE
  metadata_kind TEXT := metadata_value->>'kind';
  is_increment BOOLEAN := before_version_value > 0
    AND after_version_value = before_version_value + 1;
BEGIN
  IF actor_kind_value = 'SYSTEM' THEN
    IF command_value <> 'AUTHOR_ERASURE_ABANDON'
      OR actor_role_value <> 'SYSTEM' THEN
      RETURN false;
    END IF;
  ELSIF actor_role_value <> 'ADMIN' THEN
    RETURN false;
  END IF;

  CASE command_value
    WHEN 'QUESTION_CREATE' THEN
      RETURN target_type_value = 'QUESTION'
        AND before_state_value IS NULL AND after_state_value = 'ACTIVE'
        AND before_version_value IS NULL AND after_version_value = 1
        AND changed_fields_value = '["LIFECYCLE_STATUS","LEVEL","SUBJECT","QUESTION_TYPE","DIFFICULTY","PASSAGE","QUESTION_TEXT","EXPLANATION_KO","EXPLANATION_JA","OPTIONS","CORRECT_OPTION","TAGS"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'QUESTION_VERSION_CREATE' THEN
      RETURN target_type_value = 'QUESTION_VERSION'
        AND before_state_value IS NULL AND after_state_value = 'DRAFT'
        AND before_version_value IS NULL AND after_version_value = 1
        AND changed_fields_value = '["VERSION_STATUS","LEVEL","SUBJECT","QUESTION_TYPE","DIFFICULTY","PASSAGE","QUESTION_TEXT","EXPLANATION_KO","EXPLANATION_JA","OPTIONS","CORRECT_OPTION","TAGS"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'QUESTION_VERSION_UPDATE' THEN
      RETURN target_type_value = 'QUESTION_VERSION'
        AND before_state_value = after_state_value
        AND before_state_value IN ('DRAFT', 'CHANGES_REQUESTED')
        AND is_increment AND metadata_kind = 'NONE_V1'
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(changed_fields_value) AS field
          WHERE field NOT IN ('LEVEL','SUBJECT','QUESTION_TYPE','DIFFICULTY',
            'PASSAGE','QUESTION_TEXT','EXPLANATION_KO','EXPLANATION_JA',
            'OPTIONS','CORRECT_OPTION','TAGS')
        );
    WHEN 'REVIEW_REQUEST' THEN
      RETURN target_type_value = 'QUESTION_VERSION'
        AND before_state_value IN ('DRAFT', 'CHANGES_REQUESTED')
        AND after_state_value = 'IN_REVIEW' AND is_increment
        AND changed_fields_value = '["VERSION_STATUS"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'CHANGE_REQUEST' THEN
      RETURN target_type_value = 'QUESTION_VERSION'
        AND before_state_value = 'IN_REVIEW'
        AND after_state_value = 'CHANGES_REQUESTED' AND is_increment
        AND changed_fields_value = '["VERSION_STATUS"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'APPROVAL' THEN
      RETURN target_type_value = 'QUESTION_VERSION'
        AND before_state_value = 'IN_REVIEW' AND after_state_value = 'APPROVED'
        AND is_increment AND changed_fields_value = '["VERSION_STATUS"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'APPROVAL_WITHDRAWAL' THEN
      RETURN target_type_value = 'QUESTION_VERSION'
        AND before_state_value = 'APPROVED'
        AND after_state_value = 'CHANGES_REQUESTED' AND is_increment
        AND changed_fields_value = '["VERSION_STATUS"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'PUBLICATION' THEN
      RETURN target_type_value = 'QUESTION_VERSION'
        AND before_state_value = 'APPROVED' AND after_state_value = 'PUBLISHED'
        AND is_increment
        AND changed_fields_value = '["VERSION_STATUS","CURRENT_PUBLISHED_VERSION_ID"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'RETIREMENT' THEN
      RETURN target_type_value = 'QUESTION_VERSION'
        AND before_state_value = 'PUBLISHED' AND after_state_value = 'RETIRED'
        AND is_increment
        AND changed_fields_value = '["VERSION_STATUS","CURRENT_PUBLISHED_VERSION_ID"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'QUESTION_ARCHIVE' THEN
      RETURN target_type_value = 'QUESTION'
        AND before_state_value = 'ACTIVE' AND after_state_value = 'ARCHIVED'
        AND is_increment AND metadata_kind = 'QUESTION_ARCHIVE_V1'
        AND changed_fields_value IN (
          '["LIFECYCLE_STATUS"]'::JSONB,
          '["LIFECYCLE_STATUS","VERSION_STATUS"]'::JSONB,
          '["LIFECYCLE_STATUS","CURRENT_PUBLISHED_VERSION_ID"]'::JSONB,
          '["LIFECYCLE_STATUS","VERSION_STATUS","CURRENT_PUBLISHED_VERSION_ID"]'::JSONB
        );
    WHEN 'REVIEW_REQUEST_BATCH' THEN
      RETURN target_type_value = 'REVIEW_REQUEST_BATCH'
        AND before_state_value IS NULL AND after_state_value IS NULL
        AND before_version_value IS NULL AND after_version_value IS NULL
        AND changed_fields_value = '["VERSION_STATUS"]'::JSONB
        AND metadata_kind = 'REVIEW_REQUEST_BATCH_V1';
    WHEN 'IMPORT_APPLY' THEN
      RETURN target_type_value = 'IMPORT_REQUEST'
        AND before_state_value IS NULL AND after_state_value IS NULL
        AND before_version_value IS NULL AND after_version_value IS NULL
        AND changed_fields_value = '["IMPORT_ITEMS"]'::JSONB
        AND metadata_kind = 'IMPORT_APPLY_V1';
    WHEN 'EXPORT' THEN
      RETURN target_type_value = 'EXPORT_REQUEST'
        AND before_state_value IS NULL AND after_state_value IS NULL
        AND before_version_value IS NULL AND after_version_value IS NULL
        AND changed_fields_value = '["EXPORT_SELECTION"]'::JSONB
        AND metadata_kind = 'EXPORT_V1';
    WHEN 'REPORT_TRIAGE' THEN
      RETURN target_type_value = 'QUESTION_REPORT'
        AND before_state_value = 'OPEN' AND after_state_value = 'TRIAGED'
        AND is_increment
        AND changed_fields_value = '["ASSIGNEE","REPORT_STATUS"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'REPORT_RESOLUTION' THEN
      RETURN target_type_value = 'QUESTION_REPORT'
        AND before_state_value = 'TRIAGED'
        AND after_state_value IN ('RESOLVED', 'DISMISSED')
        AND is_increment
        AND changed_fields_value = '["RESOLUTION","REPORT_STATUS"]'::JSONB
        AND metadata_kind = 'NONE_V1';
    WHEN 'REAUTHENTICATION' THEN
      RETURN target_type_value = 'ADMIN_SESSION'
        AND before_state_value IN ('SESSION_STALE', 'SESSION_FRESH')
        AND after_state_value = 'SESSION_FRESH'
        AND before_version_value IS NULL AND after_version_value IS NULL
        AND changed_fields_value = '["SESSION_ROTATION"]'::JSONB
        AND metadata_kind = 'REAUTHENTICATION_V1';
    WHEN 'AUTHOR_ERASURE_ABANDON' THEN
      IF target_type_value = 'USER_ERASURE' THEN
        RETURN before_state_value IS NULL AND after_state_value IS NULL
          AND before_version_value IS NULL AND after_version_value IS NULL
          AND changed_fields_value = '["AUTHOR_TOMBSTONE"]'::JSONB
          AND metadata_kind = 'AUTHOR_ERASURE_V1';
      END IF;
      RETURN target_type_value = 'QUESTION_VERSION'
        AND before_state_value IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
        AND after_state_value = 'RETIRED' AND is_increment
        AND changed_fields_value = '["VERSION_STATUS","AUTHOR_TOMBSTONE"]'::JSONB
        AND metadata_kind = 'NONE_V1';
  END CASE;
  RETURN false;
END;
$function$;

-- Existing constraints that encode the Phase 3 three-state lifecycle are
-- replaced with the six-state, full-content foundation.
ALTER TABLE "QuestionVersion"
  DROP CONSTRAINT "QuestionVersion_status_timestamps_check",
  DROP CONSTRAINT "QuestionVersion_reading_passage_check";

ALTER TABLE "Question"
  ADD CONSTRAINT "Question_positive_row_version_check" CHECK ("rowVersion" > 0);

ALTER TABLE "QuestionVersion"
  ALTER COLUMN "correctOptionId" SET DEFAULT
    '00000000-0000-0000-0000-000000000000'::UUID,
  ALTER COLUMN "correctOptionId" SET NOT NULL,
  ADD CONSTRAINT "QuestionVersion_lifecycle_timestamp_check" CHECK (
    ((
      "status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
      AND "publishedAt" IS NULL AND "retiredAt" IS NULL
      AND "retirementKind" IS NULL
    ) OR (
      "status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL
      AND "retiredAt" IS NULL AND "retirementKind" IS NULL
    ) OR (
      "status" = 'RETIRED'
      AND "retirementKind" = 'PUBLISHED_RETIREMENT'
      AND "publishedAt" IS NOT NULL AND "retiredAt" IS NOT NULL
      AND "retiredAt" >= "publishedAt"
    ) OR (
      "status" = 'RETIRED'
      AND "retirementKind" IN (
        'AUTHOR_ERASURE_ABANDONED', 'QUESTION_ARCHIVE_ABANDONED'
      )
      AND "publishedAt" IS NULL AND "retiredAt" IS NOT NULL
    )) IS TRUE
  ),
  ADD CONSTRAINT "QuestionVersion_content_type_check" CHECK (
    (
      "subject" = 'VOCABULARY'
      AND "questionType" IN ('KANJI_READING','ORTHOGRAPHY',
        'CONTEXT_VOCABULARY','PARAPHRASE','WORD_USAGE')
      AND "passage" IS NULL
    ) OR (
      "subject" = 'GRAMMAR'
      AND "questionType" IN ('GRAMMAR_SELECT','SENTENCE_ORDER','TEXT_GRAMMAR')
      AND ("questionType" = 'TEXT_GRAMMAR' OR "passage" IS NULL)
    ) OR (
      "subject" = 'READING' AND "passage" IS NOT NULL
      AND (
        ("level" IN ('N5','N4') AND "questionType" IN ('SHORT_READING','INFO_RETRIEVAL'))
        OR ("level" = 'N3' AND "questionType" IN ('SHORT_READING','MEDIUM_READING','INFO_RETRIEVAL'))
        OR ("level" IN ('N2','N1') AND "questionType" IN ('MEDIUM_READING','LONG_READING','INFO_RETRIEVAL'))
      )
    )
  ),
  ADD CONSTRAINT "QuestionVersion_fingerprint_check" CHECK (
    "contentFingerprint" ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE "QuestionVersionTag"
  ADD CONSTRAINT "QuestionVersionTag_normalized_snapshot_check" CHECK (
    "normalizedNameSnapshot" <> ''
    AND "normalizedNameSnapshot" = btrim("normalizedNameSnapshot")
  );

ALTER TABLE "User"
  ADD CONSTRAINT "User_positive_authority_generation_check"
    CHECK ("authorityGeneration" > 0);

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_positive_authority_generation_check"
    CHECK ("authorityGeneration" > 0),
  ADD CONSTRAINT "Session_absolute_lifetime_check" CHECK (
    "expiresAt" > "createdAt"
    AND "expiresAt" <= "createdAt" + INTERVAL '30 days'
  );

ALTER TABLE "Verification"
  ADD CONSTRAINT "Verification_phase7_reset_arm_check" CHECK (
    ((
      "purpose" IS NULL AND "resetUserId" IS NULL
      AND "capturedGeneration" IS NULL AND "tokenSelector" IS NULL
    ) OR (
      "purpose" IS NOT NULL AND "purpose" = 'PASSWORD_RESET_V1'
      AND "resetUserId" IS NOT NULL
      AND "capturedGeneration" IS NOT NULL AND "capturedGeneration" > 0
      AND "tokenSelector" IS NOT NULL
      AND "tokenSelector" ~ '^[0-9a-f]{64}$'
      AND "identifier" = 'PASSWORD_RESET_V1'
      AND "value" = 'PASSWORD_RESET_V1'
    )) IS TRUE
  );

ALTER TABLE "ContentReview"
  ADD CONSTRAINT "ContentReview_actor_check" CHECK (
    "phase7_evidence_actor_valid"(
      "actorKind", "actorUserId", "actorId", "actorRole",
      "actorLabel", "actorSystemLabel"
    )
  ),
  ADD CONSTRAINT "ContentReview_counterpart_check" CHECK (
    "phase7_account_snapshot_valid"(
      "counterpartUserId", "counterpartActorId", "counterpartRole",
      "counterpartLabel", true
    )
  ),
  ADD CONSTRAINT "ContentReview_text_check" CHECK (
    ("reason" IS NULL OR (
      "reason" = btrim("reason") AND char_length("reason") BETWEEN 1 AND 100
    )) AND ("comment" IS NULL OR (
      "comment" = btrim("comment") AND char_length("comment") BETWEEN 1 AND 1000
    ))
  ),
  ADD CONSTRAINT "ContentReview_action_check" CHECK (
    (
      "action" = 'REQUESTED'
      AND "fromState" IN ('DRAFT','CHANGES_REQUESTED')
      AND "toState" = 'IN_REVIEW'
      AND "actorKind" = 'ACCOUNT' AND "actorRole" = 'ADMIN'
      AND "counterpartActorId" IS NULL AND "reason" IS NULL
    ) OR (
      "action" = 'CHANGES_REQUESTED'
      AND "fromState" = 'IN_REVIEW' AND "toState" = 'CHANGES_REQUESTED'
      AND "actorKind" = 'ACCOUNT' AND "actorRole" = 'ADMIN'
      AND "counterpartActorId" IS NOT NULL AND "counterpartRole" = 'ADMIN'
      AND "actorId" <> "counterpartActorId" AND "reason" IS NOT NULL
    ) OR (
      "action" = 'APPROVED'
      AND "fromState" = 'IN_REVIEW' AND "toState" = 'APPROVED'
      AND "actorKind" = 'ACCOUNT' AND "actorRole" = 'ADMIN'
      AND "counterpartActorId" IS NOT NULL AND "counterpartRole" = 'ADMIN'
      AND "actorId" <> "counterpartActorId" AND "reason" IS NULL
    ) OR (
      "action" = 'APPROVAL_WITHDRAWN'
      AND "fromState" = 'APPROVED' AND "toState" = 'CHANGES_REQUESTED'
      AND "actorKind" = 'ACCOUNT' AND "actorRole" = 'ADMIN'
      AND "counterpartActorId" IS NOT NULL AND "counterpartRole" = 'ADMIN'
      AND "actorId" <> "counterpartActorId" AND "reason" IS NOT NULL
    ) OR (
      "action" = 'PUBLISHED'
      AND "fromState" = 'APPROVED' AND "toState" = 'PUBLISHED'
      AND "actorKind" = 'ACCOUNT' AND "actorRole" = 'ADMIN'
      AND "counterpartActorId" IS NOT NULL AND "counterpartRole" = 'ADMIN'
      AND "reason" IS NULL AND "comment" IS NULL
    ) OR (
      "action" = 'RETIRED'
      AND "fromState" = 'PUBLISHED' AND "toState" = 'RETIRED'
      AND "actorKind" = 'ACCOUNT' AND "actorRole" = 'ADMIN'
      AND "counterpartActorId" IS NULL
      AND "reason" IN ('PUBLISHED_REPLACEMENT','PUBLISHED_RETIREMENT','QUESTION_ARCHIVE')
      AND "comment" IS NULL
    ) OR (
      "action" = 'ARCHIVE_ABANDONED'
      AND "fromState" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
      AND "toState" = 'RETIRED'
      AND "actorKind" = 'ACCOUNT' AND "actorRole" = 'ADMIN'
      AND "counterpartActorId" IS NOT NULL AND "counterpartRole" = 'ADMIN'
      AND "reason" = 'QUESTION_ARCHIVE' AND "comment" IS NULL
    ) OR (
      "action" = 'AUTHOR_ERASURE_ABANDONED'
      AND "fromState" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
      AND "toState" = 'RETIRED'
      AND "actorKind" = 'SYSTEM' AND "actorRole" = 'SYSTEM'
      AND "counterpartActorId" IS NOT NULL AND "counterpartRole" = 'ADMIN'
      AND "reason" = 'AUTHOR_ERASURE' AND "comment" IS NULL
    )
  );

ALTER TABLE "AdminAuditLog"
  ADD CONSTRAINT "AdminAuditLog_actor_check" CHECK (
    "phase7_evidence_actor_valid"(
      "actorKind", "actorUserId", "actorId", "actorRole",
      "actorLabel", "actorSystemLabel"
    )
  ),
  ADD CONSTRAINT "AdminAuditLog_digest_check" CHECK (
    "contentDigest" ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "AdminAuditLog_changed_fields_check" CHECK (
    "phase7_changed_fields_valid"("changedFields")
  ),
  ADD CONSTRAINT "AdminAuditLog_metadata_check" CHECK (
    "phase7_audit_metadata_valid"("metadata")
  ),
  ADD CONSTRAINT "AdminAuditLog_matrix_check" CHECK (
    "phase7_audit_row_valid"(
      "command", "targetType", "actorKind", "actorRole",
      "beforeState", "afterState", "beforeRowVersion", "afterRowVersion",
      "changedFields", "metadata"
    )
  );

ALTER TABLE "QuestionReport"
  ADD CONSTRAINT "QuestionReport_digest_check" CHECK (
    "descriptionDigest" ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "QuestionReport_reporter_check" CHECK (
    "phase7_account_snapshot_valid"(
      "reporterUserId", "reporterActorId", "reporterRole",
      "reporterLabel", false
    )
  ),
  ADD CONSTRAINT "QuestionReport_assignee_check" CHECK (
    "phase7_account_snapshot_valid"(
      "assigneeUserId", "assigneeActorId", "assigneeRole",
      "assigneeLabel", true
    )
    AND ("assigneeRole" IS NULL OR "assigneeRole" = 'ADMIN')
  ),
  ADD CONSTRAINT "QuestionReport_state_check" CHECK (
    ("rowVersion" > 0 AND "createdAt" <= "updatedAt"
    AND (
      "status" = 'OPEN'
      AND "assigneeActorId" IS NULL
      AND "resolutionOutcome" IS NULL AND "resolutionReason" IS NULL
      AND "remediationVersionId" IS NULL AND "resolvedAt" IS NULL
    OR
      "status" = 'TRIAGED'
      AND "assigneeActorId" IS NOT NULL AND "assigneeRole" = 'ADMIN'
      AND "resolutionOutcome" IS NULL AND "resolutionReason" IS NULL
      AND "remediationVersionId" IS NULL AND "resolvedAt" IS NULL
    OR
      "status" = 'RESOLVED'
      AND "assigneeActorId" IS NOT NULL AND "assigneeRole" = 'ADMIN'
      AND "resolutionOutcome" IS NOT NULL
      AND "resolutionOutcome" = 'RESOLVED'
      AND "resolutionReason" IS NOT NULL
      AND "resolutionReason" = btrim("resolutionReason")
      AND char_length("resolutionReason") BETWEEN 1 AND 1000
      AND "resolvedAt" IS NOT NULL
      AND "resolvedAt" BETWEEN "createdAt" AND "updatedAt"
    OR
      "status" = 'DISMISSED'
      AND "assigneeActorId" IS NOT NULL AND "assigneeRole" = 'ADMIN'
      AND "resolutionOutcome" IS NOT NULL
      AND "resolutionOutcome" = 'DISMISSED'
      AND "resolutionReason" IS NOT NULL
      AND "resolutionReason" = btrim("resolutionReason")
      AND char_length("resolutionReason") BETWEEN 1 AND 1000
      AND "remediationVersionId" IS NULL
      AND "resolvedAt" IS NOT NULL
      AND "resolvedAt" BETWEEN "createdAt" AND "updatedAt"
    )
    ) IS TRUE
  );

ALTER TABLE "Question"
  DROP CONSTRAINT "Question_creator_provenance_check",
  ADD CONSTRAINT "Question_creator_snapshot_check" CHECK (
    (
      "createdByLabelSnapshot" = 'SYSTEM_SEED'
      AND "createdByUserId" IS NULL AND "createdByActorId" IS NULL
      AND "createdByRoleSnapshot" IS NULL
    ) OR (
      "createdByLabelSnapshot" = 'ACTIVE_ADMIN'
      AND "createdByUserId" IS NOT NULL
      AND "createdByActorId" = "createdByUserId"
      AND "createdByRoleSnapshot" = 'ADMIN'
    ) OR (
      "createdByLabelSnapshot" = 'DELETED_ADMIN'
      AND "createdByUserId" IS NULL AND "createdByActorId" IS NOT NULL
      AND "createdByRoleSnapshot" = 'ADMIN'
    )
  );

ALTER TABLE "QuestionVersion"
  DROP CONSTRAINT "QuestionVersion_creator_provenance_check",
  ADD CONSTRAINT "QuestionVersion_creator_snapshot_check" CHECK (
    (
      "createdByLabelSnapshot" = 'SYSTEM_SEED'
      AND "createdByUserId" IS NULL AND "createdByActorId" IS NULL
      AND "createdByRoleSnapshot" IS NULL
    ) OR (
      "createdByLabelSnapshot" = 'ACTIVE_ADMIN'
      AND "createdByUserId" IS NOT NULL
      AND "createdByActorId" = "createdByUserId"
      AND "createdByRoleSnapshot" = 'ADMIN'
    ) OR (
      "createdByLabelSnapshot" = 'DELETED_ADMIN'
      AND "createdByUserId" IS NULL AND "createdByActorId" IS NOT NULL
      AND "createdByRoleSnapshot" = 'ADMIN'
    )
  );

-- Deferrable identity constraints support a full-copy version and four-option
-- reorder inside one transaction without ever exposing a partial commit.
ALTER TABLE "QuestionOption"
  DROP CONSTRAINT IF EXISTS "QuestionOption_questionVersionId_label_key",
  DROP CONSTRAINT IF EXISTS "QuestionOption_questionVersionId_ordinal_key";
DROP INDEX IF EXISTS "QuestionOption_questionVersionId_label_key";
DROP INDEX IF EXISTS "QuestionOption_questionVersionId_ordinal_key";
ALTER TABLE "QuestionOption"
  ADD CONSTRAINT "QuestionOption_questionVersionId_label_key"
    UNIQUE ("questionVersionId", "label") DEFERRABLE INITIALLY IMMEDIATE,
  ADD CONSTRAINT "QuestionOption_questionVersionId_ordinal_key"
    UNIQUE ("questionVersionId", "ordinal") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "QuestionVersion"
  DROP CONSTRAINT "QuestionVersion_id_correctOptionId_fkey",
  ADD CONSTRAINT "QuestionVersion_id_correctOptionId_fkey"
    FOREIGN KEY ("id", "correctOptionId")
    REFERENCES "QuestionOption"("questionVersionId", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "Question"
  DROP CONSTRAINT "Question_id_currentPublishedVersionId_fkey",
  ADD CONSTRAINT "Question_id_currentPublishedVersionId_fkey"
    FOREIGN KEY ("id", "currentPublishedVersionId")
    REFERENCES "QuestionVersion"("questionId", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "QuestionVersion"
  DROP CONSTRAINT "QuestionVersion_questionId_fkey",
  ADD CONSTRAINT "QuestionVersion_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "Question"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "QuestionOption"
  DROP CONSTRAINT "QuestionOption_questionVersionId_fkey",
  ADD CONSTRAINT "QuestionOption_questionVersionId_fkey"
    FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "QuestionVersionTag"
  DROP CONSTRAINT "QuestionVersionTag_questionVersionId_fkey",
  DROP CONSTRAINT "QuestionVersionTag_tagId_fkey",
  ADD CONSTRAINT "QuestionVersionTag_questionVersionId_fkey"
    FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "QuestionVersionTag_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "Tag"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "QuestionVersionTag_questionVersionId_normalizedNameSnapshot_key"
    UNIQUE ("questionVersionId", "normalizedNameSnapshot")
    DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "Question"
  DROP CONSTRAINT "Question_createdByUserId_fkey",
  ADD CONSTRAINT "Question_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "QuestionVersion"
  DROP CONSTRAINT "QuestionVersion_createdByUserId_fkey",
  ADD CONSTRAINT "QuestionVersion_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "Session"
  DROP CONSTRAINT "Session_userId_fkey",
  ADD CONSTRAINT "Session_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "Session_userId_sessionFamilyId_fkey"
    FOREIGN KEY ("userId", "sessionFamilyId")
    REFERENCES "AuthSessionFamily"("userId", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "Account"
  DROP CONSTRAINT "Account_userId_fkey",
  ADD CONSTRAINT "Account_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "StudySession"
  DROP CONSTRAINT "StudySession_userId_fkey",
  ADD CONSTRAINT "StudySession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "Bookmark"
  DROP CONSTRAINT "Bookmark_userId_fkey",
  ADD CONSTRAINT "Bookmark_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "WrongNote"
  DROP CONSTRAINT "WrongNote_userId_fkey",
  ADD CONSTRAINT "WrongNote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "IdempotencyRecord"
  DROP CONSTRAINT "IdempotencyRecord_userId_fkey",
  ADD CONSTRAINT "IdempotencyRecord_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "AuthSessionFamily"
  ADD CONSTRAINT "AuthSessionFamily_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "AuthSessionRotationFence"
  ADD CONSTRAINT "AuthSessionRotationFence_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "AuthSessionRotationFence_userId_oldFamilyId_fkey"
    FOREIGN KEY ("userId", "oldFamilyId")
    REFERENCES "AuthSessionFamily"("userId", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "AuthSessionRotationFence_userId_replacementFamilyId_fkey"
    FOREIGN KEY ("userId", "replacementFamilyId")
    REFERENCES "AuthSessionFamily"("userId", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "Verification"
  ADD CONSTRAINT "Verification_resetUserId_fkey"
    FOREIGN KEY ("resetUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "Verification_purpose_resetUserId_key"
    UNIQUE ("purpose", "resetUserId"),
  ADD CONSTRAINT "Verification_tokenSelector_key" UNIQUE ("tokenSelector");

ALTER TABLE "TagApplicability"
  ADD CONSTRAINT "TagApplicability_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "Tag"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "ContentReview"
  ADD CONSTRAINT "ContentReview_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "Question"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "ContentReview_questionId_questionVersionId_fkey"
    FOREIGN KEY ("questionId", "questionVersionId")
    REFERENCES "QuestionVersion"("questionId", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "ContentReview_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT "ContentReview_counterpartUserId_fkey"
    FOREIGN KEY ("counterpartUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "AdminAuditLog"
  ADD CONSTRAINT "AdminAuditLog_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "QuestionReport"
  ADD CONSTRAINT "QuestionReport_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "Question"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "QuestionReport_questionId_questionVersionId_fkey"
    FOREIGN KEY ("questionId", "questionVersionId")
    REFERENCES "QuestionVersion"("questionId", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "QuestionReport_questionId_remediationVersionId_fkey"
    FOREIGN KEY ("questionId", "remediationVersionId")
    REFERENCES "QuestionVersion"("questionId", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "QuestionReport_reporterUserId_fkey"
    FOREIGN KEY ("reporterUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT "QuestionReport_assigneeUserId_fkey"
    FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE UNIQUE INDEX "QuestionVersion_one_open_candidate_per_question_key"
  ON "QuestionVersion"("questionId")
  WHERE "status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED');
CREATE UNIQUE INDEX "QuestionVersion_one_published_per_question_key"
  ON "QuestionVersion"("questionId") WHERE "status" = 'PUBLISHED';
CREATE INDEX "QuestionVersion_questionId_versionNumber_id_idx"
  ON "QuestionVersion"("questionId", "versionNumber" DESC, "id" DESC);
CREATE INDEX "QuestionVersion_contentFingerprint_idx"
  ON "QuestionVersion"("contentFingerprint");
CREATE INDEX "QuestionVersion_questionText_prefix_idx"
  ON "QuestionVersion"(("questionText" COLLATE "C") text_pattern_ops);
CREATE INDEX "TagApplicability_taxonomy_idx"
  ON "TagApplicability"("level", "subject", "questionType", "tagId");
CREATE INDEX "ContentReview_questionVersionId_occurredAt_id_idx"
  ON "ContentReview"("questionVersionId", "occurredAt" DESC, "id" DESC);
CREATE INDEX "ContentReview_operationId_idx" ON "ContentReview"("operationId");
CREATE UNIQUE INDEX "ContentReview_operation_version_key"
  ON "ContentReview"("operationId", "questionVersionId");
CREATE INDEX "AdminAuditLog_occurredAt_id_idx"
  ON "AdminAuditLog"("occurredAt" DESC, "id" DESC);
CREATE INDEX "AdminAuditLog_operationId_idx" ON "AdminAuditLog"("operationId");
CREATE INDEX "AdminAuditLog_targetType_targetId_idx"
  ON "AdminAuditLog"("targetType", "targetId");
CREATE UNIQUE INDEX "AdminAuditLog_operation_entity_target_key"
  ON "AdminAuditLog"("operationId", "targetType", "targetId")
  WHERE "targetType" IN ('QUESTION','QUESTION_VERSION','QUESTION_REPORT');
CREATE UNIQUE INDEX "AdminAuditLog_request_target_operation_key"
  ON "AdminAuditLog"("command", "targetType", "targetId")
  WHERE "targetType" IN ('REVIEW_REQUEST_BATCH','IMPORT_REQUEST',
    'EXPORT_REQUEST','ADMIN_SESSION','USER_ERASURE')
    AND "targetId" = "operationId";
CREATE INDEX "QuestionReport_status_updatedAt_id_idx"
  ON "QuestionReport"("status", "updatedAt" DESC, "id" DESC);
CREATE INDEX "QuestionReport_questionId_status_idx"
  ON "QuestionReport"("questionId", "status");
CREATE INDEX "QuestionReport_reporterActorId_questionVersionId_reason_idx"
  ON "QuestionReport"("reporterActorId", "questionVersionId", "reason");
CREATE UNIQUE INDEX "QuestionReport_open_duplicate_key"
  ON "QuestionReport"("reporterActorId", "questionVersionId", "reason")
  WHERE "status" IN ('OPEN','TRIAGED');
CREATE INDEX "AuthSessionFamily_userId_status_id_idx"
  ON "AuthSessionFamily"("userId", "status", "id");
DROP INDEX IF EXISTS "Session_userId_expiresAt_idx";
CREATE UNIQUE INDEX "Session_userId_sessionFamilyId_id_key"
  ON "Session"("userId", "sessionFamilyId", "id");
CREATE INDEX "Session_userId_sessionFamilyId_expiresAt_idx"
  ON "Session"("userId", "sessionFamilyId", "expiresAt");
CREATE INDEX "Session_userId_issuerProtocolVersion_expiresAt_idx"
  ON "Session"("userId", "issuerProtocolVersion", "expiresAt");
CREATE INDEX "AuthSessionRotationFence_replacementFamilyId_expiresAt_idx"
  ON "AuthSessionRotationFence"("replacementFamilyId", "expiresAt");
CREATE UNIQUE INDEX "Account_one_credential_per_user_key"
  ON "Account"("userId") WHERE "providerId" = 'credential';

CREATE FUNCTION "refresh_phase7_question_version_fingerprint"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  target_id UUID;
  expected_fingerprint VARCHAR(64);
BEGIN
  IF TG_TABLE_NAME = 'QuestionOption' THEN
    target_id := NEW."questionVersionId";
  ELSE
    target_id := NEW."id";
  END IF;
  expected_fingerprint := "phase7_question_version_fingerprint"(target_id);

  IF expected_fingerprint IS NOT NULL THEN
    UPDATE "QuestionVersion"
    SET "contentFingerprint" = expected_fingerprint
    WHERE "id" = target_id
      AND "contentFingerprint" IS DISTINCT FROM expected_fingerprint;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "QuestionVersion_refresh_fingerprint"
AFTER INSERT OR UPDATE OF "level", "subject", "questionType", "passage",
  "questionText", "correctOptionId"
ON "QuestionVersion"
FOR EACH ROW
EXECUTE FUNCTION "refresh_phase7_question_version_fingerprint"();

CREATE TRIGGER "QuestionOption_refresh_fingerprint"
AFTER INSERT OR UPDATE OF "text"
ON "QuestionOption"
FOR EACH ROW
EXECUTE FUNCTION "refresh_phase7_question_version_fingerprint"();

CREATE OR REPLACE FUNCTION "validate_question_version_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  erasure_mode BOOLEAN := "phase7_trusted_execution_active"('ERASURE');
  app_caller BOOLEAN := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  ) = 'nihongo_app';
  fingerprint_only BOOLEAN;
  system_seed_bootstrap BOOLEAN;
  operation_id UUID;
  operation_command "AdminAuditCommand";
  operation_time TIMESTAMPTZ(3);
  admin_archive_mode BOOLEAN := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'QuestionVersion must be inserted as DRAFT.'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."createdByLabelSnapshot" = 'SYSTEM_SEED' THEN
      IF app_caller THEN
        RAISE EXCEPTION 'Application role cannot create SYSTEM_SEED content.'
          USING ERRCODE = '42501';
      END IF;
      IF NEW."createdByUserId" IS NOT NULL
        OR NEW."createdByActorId" IS NOT NULL
        OR NEW."createdByRoleSnapshot" IS NOT NULL THEN
        RAISE EXCEPTION 'SYSTEM_SEED provenance cannot claim an account actor.'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    operation_id := "phase7_current_operation_id"();
    IF NEW."createdByLabelSnapshot" <> 'ACTIVE_ADMIN'
      OR NEW."createdByUserId" IS NULL
      OR NEW."createdByActorId" IS DISTINCT FROM NEW."createdByUserId"
      OR NEW."createdByRoleSnapshot" <> 'ADMIN'
      OR NOT EXISTS (
        SELECT 1
        FROM "Phase7OperationIntent" AS intent
        JOIN "User" AS actor ON actor."id" = intent."actorUserId"
        WHERE intent."operationId" = operation_id
          AND intent."actorUserId" = NEW."createdByUserId"
          AND actor."role" = 'ADMIN'
          AND actor."accountStatus" = 'ACTIVE'
        FOR SHARE OF actor
      ) THEN
      RAISE EXCEPTION 'QuestionVersion creation requires its locked active ADMIN actor.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  fingerprint_only := (
    to_jsonb(NEW) - 'contentFingerprint'
  ) = (
    to_jsonb(OLD) - 'contentFingerprint'
  );
  IF fingerprint_only THEN
    RETURN NEW;
  END IF;

  system_seed_bootstrap :=
    OLD."createdByLabelSnapshot" = 'SYSTEM_SEED'
    AND OLD."status" = 'DRAFT' AND NEW."status" = 'PUBLISHED'
    AND OLD."rowVersion" = 1 AND NEW."rowVersion" = 1
    AND NEW."correctOptionId" IS NOT NULL
    AND (
      OLD."correctOptionId" = '00000000-0000-0000-0000-000000000000'::UUID
      OR OLD."correctOptionId" = NEW."correctOptionId"
    );

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."questionId" IS DISTINCT FROM OLD."questionId"
    OR NEW."versionNumber" IS DISTINCT FROM OLD."versionNumber"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
    OR NEW."createdByActorId" IS DISTINCT FROM OLD."createdByActorId"
    OR NEW."createdByRoleSnapshot" IS DISTINCT FROM OLD."createdByRoleSnapshot"
    OR (
      NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
      AND NOT erasure_mode
    )
    OR (
      NEW."createdByLabelSnapshot" IS DISTINCT FROM OLD."createdByLabelSnapshot"
      AND NOT erasure_mode
    ) THEN
    RAISE EXCEPTION 'QuestionVersion identity/provenance is insert-only.'
      USING ERRCODE = '23514';
  END IF;

  IF erasure_mode THEN
    IF OLD."createdByUserId" IS NOT NULL
      AND "phase7_trusted_execution_target"('ERASURE') = OLD."createdByUserId"
      AND NEW."createdByUserId" IS NULL
      AND OLD."createdByLabelSnapshot" = 'ACTIVE_ADMIN'
      AND NEW."createdByLabelSnapshot" = 'DELETED_ADMIN'
      AND NEW."createdByActorId" = OLD."createdByActorId"
      AND NEW."createdByRoleSnapshot" = OLD."createdByRoleSnapshot"
      AND NEW."rowVersion" = OLD."rowVersion" + 1 THEN
      IF NEW."status" = OLD."status"
        AND NEW."retirementKind" IS NOT DISTINCT FROM OLD."retirementKind"
        AND NEW."retiredAt" IS NOT DISTINCT FROM OLD."retiredAt"
        AND (
          to_jsonb(NEW)
            - 'createdByUserId' - 'createdByLabelSnapshot'
            - 'rowVersion' - 'updatedAt'
        ) = (
          to_jsonb(OLD)
            - 'createdByUserId' - 'createdByLabelSnapshot'
            - 'rowVersion' - 'updatedAt'
        ) THEN
        RETURN NEW;
      END IF;
      IF OLD."status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
        AND NEW."status" = 'RETIRED'
        AND NEW."retirementKind" = 'AUTHOR_ERASURE_ABANDONED'
        AND NEW."retiredAt" IS NOT NULL
        AND NEW."publishedAt" IS NULL
        AND (
          to_jsonb(NEW)
            - 'status' - 'retirementKind' - 'retiredAt'
            - 'createdByUserId' - 'createdByLabelSnapshot'
            - 'rowVersion' - 'updatedAt'
        ) = (
          to_jsonb(OLD)
            - 'status' - 'retirementKind' - 'retiredAt'
            - 'createdByUserId' - 'createdByLabelSnapshot'
            - 'rowVersion' - 'updatedAt'
        ) THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'Erasure QuestionVersion mutation exceeded the tombstone allowlist.'
      USING ERRCODE = '23514';
  END IF;

  IF system_seed_bootstrap THEN
    IF app_caller THEN
      RAISE EXCEPTION 'Application role cannot bootstrap SYSTEM_SEED content.'
        USING ERRCODE = '42501';
    END IF;
    IF (
      to_jsonb(NEW)
        - 'status' - 'publishedAt' - 'updatedAt' - 'contentFingerprint'
        - 'correctOptionId'
    ) <> (
      to_jsonb(OLD)
        - 'status' - 'publishedAt' - 'updatedAt' - 'contentFingerprint'
        - 'correctOptionId'
    ) THEN
      RAISE EXCEPTION 'SYSTEM_SEED bootstrap cannot change content.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  operation_id := "phase7_current_operation_id"();
  SELECT intent."command", intent."occurredAt"
  INTO operation_command, operation_time
  FROM "Phase7OperationIntent" AS intent
  WHERE intent."operationId" = operation_id;
  admin_archive_mode := operation_command = 'QUESTION_ARCHIVE';

  IF NEW."rowVersion" <> OLD."rowVersion" + 1 THEN
    RAISE EXCEPTION 'QuestionVersion rowVersion must increase exactly once.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'PUBLISHED' AND NEW."status" = 'RETIRED' AND (
    operation_command NOT IN ('PUBLICATION', 'RETIREMENT', 'QUESTION_ARCHIVE')
    OR NEW."retirementKind" IS DISTINCT FROM 'PUBLISHED_RETIREMENT'
    OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
    OR NEW."retiredAt" IS DISTINCT FROM operation_time
    OR NEW."updatedAt" IS DISTINCT FROM operation_time
    OR (
      to_jsonb(NEW)
        - 'status' - 'retirementKind' - 'retiredAt'
        - 'rowVersion' - 'updatedAt'
    ) <> (
      to_jsonb(OLD)
        - 'status' - 'retirementKind' - 'retiredAt'
        - 'rowVersion' - 'updatedAt'
    )
  ) THEN
    RAISE EXCEPTION 'Published retirement requires its exact preserved subtype.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
    AND NEW."status" = 'RETIRED'
    AND (
      NOT admin_archive_mode
      OR NEW."retirementKind" IS DISTINCT FROM 'QUESTION_ARCHIVE_ABANDONED'
      OR NEW."retiredAt" IS DISTINCT FROM operation_time
      OR NEW."updatedAt" IS DISTINCT FROM operation_time
      OR NEW."publishedAt" IS NOT NULL
      OR (
        to_jsonb(NEW)
          - 'status' - 'retirementKind' - 'retiredAt'
          - 'rowVersion' - 'updatedAt'
      ) <> (
        to_jsonb(OLD)
          - 'status' - 'retirementKind' - 'retiredAt'
          - 'rowVersion' - 'updatedAt'
      )
    ) THEN
    RAISE EXCEPTION 'Open candidate retirement requires exact QUESTION_ARCHIVE abandonment.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" NOT IN ('DRAFT','CHANGES_REQUESTED')
    AND (
      to_jsonb(NEW)
        - 'status' - 'rowVersion' - 'updatedAt' - 'publishedAt'
        - 'retiredAt' - 'retirementKind' - 'contentFingerprint'
        - 'createdByUserId' - 'createdByLabelSnapshot'
    ) <> (
      to_jsonb(OLD)
        - 'status' - 'rowVersion' - 'updatedAt' - 'publishedAt'
        - 'retiredAt' - 'retirementKind' - 'contentFingerprint'
        - 'createdByUserId' - 'createdByLabelSnapshot'
    ) THEN
    RAISE EXCEPTION 'Reviewed/published QuestionVersion content is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    NEW."status" = OLD."status"
    AND OLD."status" IN ('DRAFT','CHANGES_REQUESTED')
    OR OLD."status" = 'DRAFT' AND NEW."status" = 'IN_REVIEW'
    OR OLD."status" = 'CHANGES_REQUESTED' AND NEW."status" = 'IN_REVIEW'
    OR OLD."status" = 'IN_REVIEW' AND NEW."status" IN ('CHANGES_REQUESTED','APPROVED')
    OR OLD."status" = 'APPROVED' AND NEW."status" IN ('CHANGES_REQUESTED','PUBLISHED')
    OR OLD."status" = 'PUBLISHED' AND NEW."status" = 'RETIRED'
    OR admin_archive_mode
      AND OLD."status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
      AND NEW."status" = 'RETIRED'
    OR erasure_mode AND OLD."status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
      AND NEW."status" = 'RETIRED'
  ) THEN
    RAISE EXCEPTION 'Invalid QuestionVersion status transition.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER "QuestionVersion_validate_change"
BEFORE INSERT OR UPDATE ON "QuestionVersion"
FOR EACH ROW
EXECUTE FUNCTION "validate_question_version_change"();

CREATE FUNCTION "validate_phase7_question_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  erasure_mode BOOLEAN := "phase7_trusted_execution_active"('ERASURE');
  app_caller BOOLEAN := COALESCE(
    NULLIF(current_setting('role', true), 'none'), session_user
  ) = 'nihongo_app';
  system_seed_link BOOLEAN;
  operation_id UUID;
  operation_command "AdminAuditCommand";
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."createdByLabelSnapshot" = 'SYSTEM_SEED' THEN
      IF app_caller THEN
        RAISE EXCEPTION 'Application role cannot create SYSTEM_SEED content.'
          USING ERRCODE = '42501';
      END IF;
      IF NEW."createdByUserId" IS NOT NULL
        OR NEW."createdByActorId" IS NOT NULL
        OR NEW."createdByRoleSnapshot" IS NOT NULL THEN
        RAISE EXCEPTION 'SYSTEM_SEED provenance cannot claim an account actor.'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    operation_id := "phase7_current_operation_id"();
    IF NEW."createdByLabelSnapshot" <> 'ACTIVE_ADMIN'
      OR NEW."createdByUserId" IS NULL
      OR NEW."createdByActorId" IS DISTINCT FROM NEW."createdByUserId"
      OR NEW."createdByRoleSnapshot" <> 'ADMIN'
      OR NOT EXISTS (
        SELECT 1
        FROM "Phase7OperationIntent" AS intent
        JOIN "User" AS actor ON actor."id" = intent."actorUserId"
        WHERE intent."operationId" = operation_id
          AND intent."actorUserId" = NEW."createdByUserId"
          AND actor."role" = 'ADMIN'
          AND actor."accountStatus" = 'ACTIVE'
        FOR SHARE OF actor
      ) THEN
      RAISE EXCEPTION 'Question creation requires its locked active ADMIN actor.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  system_seed_link := OLD."createdByLabelSnapshot" = 'SYSTEM_SEED'
    AND OLD."currentPublishedVersionId" IS NULL
    AND NEW."currentPublishedVersionId" IS NOT NULL
    AND OLD."rowVersion" = 1 AND NEW."rowVersion" = 1
    AND NEW."lifecycleStatus" = 'ACTIVE';

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."createdByActorId" IS DISTINCT FROM OLD."createdByActorId"
    OR NEW."createdByRoleSnapshot" IS DISTINCT FROM OLD."createdByRoleSnapshot"
    OR (NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" AND NOT erasure_mode)
    OR (NEW."createdByLabelSnapshot" IS DISTINCT FROM OLD."createdByLabelSnapshot" AND NOT erasure_mode) THEN
    RAISE EXCEPTION 'Question identity/provenance is insert-only.'
      USING ERRCODE = '23514';
  END IF;

  IF system_seed_link THEN
    IF app_caller THEN
      RAISE EXCEPTION 'Application role cannot link SYSTEM_SEED content.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF erasure_mode
    AND OLD."createdByUserId" IS NOT NULL AND NEW."createdByUserId" IS NULL
    AND "phase7_trusted_execution_target"('ERASURE') = OLD."createdByUserId"
    AND OLD."createdByLabelSnapshot" = 'ACTIVE_ADMIN'
    AND NEW."createdByLabelSnapshot" = 'DELETED_ADMIN'
    AND NEW."rowVersion" = OLD."rowVersion" + 1 THEN
    IF (
      to_jsonb(NEW)
        - 'createdByUserId' - 'createdByLabelSnapshot'
        - 'rowVersion' - 'updatedAt'
    ) = (
      to_jsonb(OLD)
        - 'createdByUserId' - 'createdByLabelSnapshot'
        - 'rowVersion' - 'updatedAt'
    ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Erasure Question mutation exceeded the tombstone allowlist.'
      USING ERRCODE = '23514';
  END IF;

  IF erasure_mode THEN
    IF OLD."createdByActorId" IS DISTINCT FROM
        "phase7_trusted_execution_target"('ERASURE')
      AND NEW."rowVersion" = OLD."rowVersion" + 1
      AND (
        to_jsonb(NEW) - 'rowVersion' - 'updatedAt'
      ) = (
        to_jsonb(OLD) - 'rowVersion' - 'updatedAt'
      )
      AND EXISTS (
        SELECT 1 FROM "QuestionVersion" AS abandoned
        WHERE abandoned."questionId" = OLD."id"
          AND abandoned."createdByActorId" =
            "phase7_trusted_execution_target"('ERASURE')
          AND abandoned."status" = 'RETIRED'
          AND abandoned."retirementKind" = 'AUTHOR_ERASURE_ABANDONED'
          AND abandoned."retiredAt" = NEW."updatedAt"
      ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Erasure Question mutation is unrelated to the deleted author.'
      USING ERRCODE = '23514';
  END IF;

  operation_id := "phase7_current_operation_id"();
  SELECT intent."command" INTO operation_command
  FROM "Phase7OperationIntent" AS intent
  WHERE intent."operationId" = operation_id;

  IF operation_command = 'PUBLICATION'
    AND OLD."currentPublishedVersionId" IS NOT NULL
    AND NEW."currentPublishedVersionId" IS NULL
    AND NEW."rowVersion" = OLD."rowVersion"
    AND (
      to_jsonb(NEW) - 'currentPublishedVersionId' - 'updatedAt'
    ) = (
      to_jsonb(OLD) - 'currentPublishedVersionId' - 'updatedAt'
    ) THEN
    RETURN NEW;
  END IF;

  IF NEW."rowVersion" <> OLD."rowVersion" + 1 THEN
    RAISE EXCEPTION 'Question rowVersion must increase exactly once.'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."lifecycleStatus" = 'ARCHIVED'
    OR NEW."lifecycleStatus" NOT IN (OLD."lifecycleStatus", 'ARCHIVED') THEN
    RAISE EXCEPTION 'Question lifecycle is ACTIVE to ARCHIVED only.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "Question_validate_change"
BEFORE INSERT OR UPDATE ON "Question"
FOR EACH ROW
EXECUTE FUNCTION "validate_phase7_question_change"();

CREATE OR REPLACE FUNCTION "protect_question_version_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'QuestionVersion hard delete is forbidden.'
    USING ERRCODE = '23514';
END;
$function$;

CREATE TRIGGER "QuestionVersion_protect_delete"
BEFORE DELETE ON "QuestionVersion"
FOR EACH ROW
EXECUTE FUNCTION "protect_question_version_delete"();

CREATE OR REPLACE FUNCTION "protect_question_history_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'Question hard delete is forbidden.'
    USING ERRCODE = '23514';
END;
$function$;

CREATE TRIGGER "Question_protect_history_delete"
BEFORE DELETE ON "Question"
FOR EACH ROW
EXECUTE FUNCTION "protect_question_history_delete"();

CREATE OR REPLACE FUNCTION "protect_question_version_children"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  target_version_id UUID;
  target_status "QuestionVersionStatus";
  creator_label "CreatorLabelSnapshot";
  is_pinned BOOLEAN;
BEGIN
  target_version_id := CASE WHEN TG_OP = 'DELETE'
    THEN OLD."questionVersionId" ELSE NEW."questionVersionId" END;

  SELECT version."status", version."createdByLabelSnapshot", EXISTS (
    SELECT 1 FROM "StudySessionQuestion" AS pinned
    WHERE pinned."questionVersionId" = target_version_id
  )
  INTO target_status, creator_label, is_pinned
  FROM "QuestionVersion" AS version
  WHERE version."id" = target_version_id
  FOR UPDATE;

  IF target_status IS NULL OR target_status NOT IN ('DRAFT','CHANGES_REQUESTED')
    OR is_pinned THEN
    RAISE EXCEPTION 'QuestionVersion children require an editable unpinned parent.'
      USING ERRCODE = '23514';
  END IF;

  IF creator_label <> 'SYSTEM_SEED' OR TG_OP <> 'INSERT' THEN
    PERFORM "phase7_current_operation_id"();
  END IF;

  IF TG_TABLE_NAME = 'QuestionOption' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'QuestionOption delete is forbidden.'
        USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND (
      NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."questionVersionId" IS DISTINCT FROM OLD."questionVersionId"
      OR (to_jsonb(NEW) - 'text' - 'ordinal' - 'label') <>
         (to_jsonb(OLD) - 'text' - 'ordinal' - 'label')
    ) THEN
      RAISE EXCEPTION 'QuestionOption identity is immutable.'
        USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' AND (
      SELECT COUNT(*) FROM "QuestionOption"
      WHERE "questionVersionId" = target_version_id
    ) >= 4 THEN
      RAISE EXCEPTION 'QuestionVersion already has four options.'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'QuestionVersionTag identity and snapshots are immutable.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

CREATE TRIGGER "QuestionOption_protect_immutable_version"
BEFORE INSERT OR UPDATE OR DELETE ON "QuestionOption"
FOR EACH ROW
EXECUTE FUNCTION "protect_question_version_children"();

CREATE FUNCTION "lock_phase7_tag_assignment_scope"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Retain one transaction-scoped mutex before any QVT row/parent lock or Tag
  -- rename row lock. Multiple statements in one operation therefore cannot
  -- accumulate Tag locks in caller order; the statement verifier below still
  -- locks the complete live Tag set in UUID order.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nihongo-phase7-tag-assignment-scope-v1', 0)
  );
  RETURN NULL;
END;
$function$;

CREATE TRIGGER "QuestionVersionTag_lock_assignment_scope"
BEFORE INSERT OR DELETE ON "QuestionVersionTag"
FOR EACH STATEMENT
EXECUTE FUNCTION "lock_phase7_tag_assignment_scope"();

CREATE TRIGGER "QuestionVersionTag_protect_immutable_version"
BEFORE INSERT OR UPDATE OR DELETE ON "QuestionVersionTag"
FOR EACH ROW
EXECUTE FUNCTION "protect_question_version_children"();

CREATE FUNCTION "copy_phase7_tag_snapshots"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  tag_row "Tag"%ROWTYPE;
  version_row "QuestionVersion"%ROWTYPE;
BEGIN
  SELECT * INTO tag_row FROM "Tag" WHERE "id" = NEW."tagId";
  SELECT * INTO version_row FROM "QuestionVersion"
    WHERE "id" = NEW."questionVersionId" FOR SHARE;
  IF tag_row."id" IS NULL OR version_row."id" IS NULL THEN
    RAISE EXCEPTION 'QuestionVersionTag target is missing.'
      USING ERRCODE = '23503';
  END IF;
  IF NEW."labelSnapshot" NOT IN ('', tag_row."label")
    OR NEW."normalizedNameSnapshot" NOT IN ('', tag_row."normalizedName") THEN
    RAISE EXCEPTION 'QuestionVersionTag snapshots must exactly copy the live Tag.'
      USING ERRCODE = '23514';
  END IF;
  NEW."labelSnapshot" := tag_row."label";
  NEW."normalizedNameSnapshot" := tag_row."normalizedName";

  IF version_row."createdByLabelSnapshot" = 'SYSTEM_SEED' THEN
    INSERT INTO "TagApplicability" ("tagId", "level", "subject", "questionType")
    VALUES (NEW."tagId", version_row."level", version_row."subject", version_row."questionType")
    ON CONFLICT DO NOTHING;
  ELSIF NOT EXISTS (
    SELECT 1 FROM "TagApplicability"
    WHERE "tagId" = NEW."tagId" AND "level" = version_row."level"
      AND "subject" = version_row."subject"
      AND "questionType" = version_row."questionType"
  ) THEN
    RAISE EXCEPTION 'Tag is not applicable to the QuestionVersion taxonomy.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "QuestionVersionTag_copy_snapshots"
BEFORE INSERT ON "QuestionVersionTag"
FOR EACH ROW
EXECUTE FUNCTION "copy_phase7_tag_snapshots"();

CREATE FUNCTION "validate_phase7_inserted_tag_snapshots"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  locked_tag "Tag"%ROWTYPE;
BEGIN
  -- The row trigger copies values without taking caller-order locks. This
  -- statement trigger acquires the complete Tag set in canonical UUID order,
  -- then compares each inserted snapshot with the locked live row. A concurrent
  -- rename either precedes the copy or makes the whole statement roll back.
  FOR locked_tag IN
    SELECT tag.*
    FROM "Tag" AS tag
    JOIN (
      SELECT DISTINCT inserted."tagId"
      FROM inserted_phase7_tag_rows AS inserted
    ) AS target ON target."tagId" = tag."id"
    ORDER BY tag."id"
    FOR SHARE OF tag
  LOOP
    IF EXISTS (
      SELECT 1
      FROM inserted_phase7_tag_rows AS inserted
      WHERE inserted."tagId" = locked_tag."id"
        AND (
          inserted."labelSnapshot" IS DISTINCT FROM locked_tag."label"
          OR inserted."normalizedNameSnapshot"
            IS DISTINCT FROM locked_tag."normalizedName"
        )
    ) THEN
      RAISE EXCEPTION 'QuestionVersionTag snapshot changed during insert.'
        USING ERRCODE = '40001';
    END IF;
  END LOOP;
  IF (SELECT COUNT(DISTINCT "tagId") FROM inserted_phase7_tag_rows) <>
    (SELECT COUNT(*) FROM "Tag" AS tag JOIN (
      SELECT DISTINCT "tagId" FROM inserted_phase7_tag_rows
    ) AS target ON target."tagId" = tag."id") THEN
    RAISE EXCEPTION 'QuestionVersionTag target disappeared during insert.'
      USING ERRCODE = '23503';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER "QuestionVersionTag_validate_inserted_snapshots"
AFTER INSERT ON "QuestionVersionTag"
REFERENCING NEW TABLE AS inserted_phase7_tag_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "validate_phase7_inserted_tag_snapshots"();

CREATE FUNCTION "protect_phase7_tag_identity"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
BEGIN
  PERFORM "phase7_current_operation_id"();
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Tag identity is insert-only.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "Tag_lock_assignment_scope"
BEFORE UPDATE ON "Tag"
FOR EACH STATEMENT
EXECUTE FUNCTION "lock_phase7_tag_assignment_scope"();

CREATE TRIGGER "Tag_protect_identity"
BEFORE UPDATE ON "Tag"
FOR EACH ROW
EXECUTE FUNCTION "protect_phase7_tag_identity"();

CREATE FUNCTION "protect_phase7_tag_applicability"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  -- The reviewed SYSTEM_SEED QVT snapshot trigger is the sole context-free
  -- bootstrap writer. Direct SQL always enters at trigger depth 1.
  IF TG_OP = 'INSERT' AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'TagApplicability is a reviewed immutable mapping.'
    USING ERRCODE = '42501';
END;
$function$;

CREATE TRIGGER "TagApplicability_protect_write"
BEFORE INSERT OR UPDATE OR DELETE ON "TagApplicability"
FOR EACH ROW
EXECUTE FUNCTION "protect_phase7_tag_applicability"();

CREATE FUNCTION "validate_phase7_question_aggregate"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  target_question_id UUID;
  changed_row JSONB;
  parent_row "Question"%ROWTYPE;
  version_count INTEGER;
  v1_count INTEGER;
  open_count INTEGER;
  published_count INTEGER;
  published_id UUID;
  v1_row "QuestionVersion"%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') NOT IN (
    'read committed', 'serializable'
  ) THEN
    RAISE EXCEPTION 'Question content mutation requires READ COMMITTED or SERIALIZABLE isolation.'
      USING ERRCODE = '25001';
  END IF;
  changed_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  target_question_id := CASE WHEN TG_TABLE_NAME = 'Question'
    THEN (changed_row ->> 'id')::UUID
    ELSE (changed_row ->> 'questionId')::UUID
  END;

  SELECT * INTO parent_row FROM "Question" WHERE "id" = target_question_id;
  IF parent_row."id" IS NULL THEN RETURN NULL; END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE "versionNumber" = 1),
    COUNT(*) FILTER (WHERE "status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')),
    COUNT(*) FILTER (WHERE "status" = 'PUBLISHED'),
    min("id"::TEXT) FILTER (WHERE "status" = 'PUBLISHED')::UUID
  INTO version_count, v1_count, open_count, published_count, published_id
  FROM "QuestionVersion" WHERE "questionId" = target_question_id;

  IF version_count < 1 OR v1_count <> 1 OR EXISTS (
    SELECT 1 FROM generate_series(1, version_count) AS expected(number)
    LEFT JOIN "QuestionVersion" AS version
      ON version."questionId" = target_question_id
      AND version."versionNumber" = expected.number
    WHERE version."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'QuestionVersion numbering must be retained contiguous 1..count.'
      USING ERRCODE = '23514';
  END IF;

  IF published_count > 1
    OR (published_count = 1 AND parent_row."currentPublishedVersionId" IS DISTINCT FROM published_id)
    OR (published_count = 0 AND parent_row."currentPublishedVersionId" IS NOT NULL)
    OR (parent_row."lifecycleStatus" = 'ARCHIVED'
      AND (parent_row."currentPublishedVersionId" IS NOT NULL OR open_count <> 0))
    OR (parent_row."lifecycleStatus" <> 'ACTIVE'
      AND (published_count <> 0 OR open_count <> 0)) THEN
    RAISE EXCEPTION 'Question pointer/lifecycle aggregate invariant failed.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v1_row FROM "QuestionVersion"
  WHERE "questionId" = target_question_id AND "versionNumber" = 1;
  IF v1_row."createdByUserId" IS DISTINCT FROM parent_row."createdByUserId"
    OR v1_row."createdByActorId" IS DISTINCT FROM parent_row."createdByActorId"
    OR v1_row."createdByRoleSnapshot" IS DISTINCT FROM parent_row."createdByRoleSnapshot"
    OR v1_row."createdByLabelSnapshot" IS DISTINCT FROM parent_row."createdByLabelSnapshot" THEN
    RAISE EXCEPTION 'Question and version 1 creator provenance must match.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER "Question_deferred_aggregate"
AFTER INSERT OR UPDATE ON "Question"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_phase7_question_aggregate"();

CREATE CONSTRAINT TRIGGER "QuestionVersion_deferred_question_aggregate"
AFTER INSERT OR UPDATE OR DELETE ON "QuestionVersion"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_phase7_question_aggregate"();

CREATE FUNCTION "validate_phase7_question_version_content"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  target_version_id UUID;
  changed_row JSONB;
  version_row "QuestionVersion"%ROWTYPE;
  option_count INTEGER;
  normalized_option_count INTEGER;
  tag_count INTEGER;
  expected_fingerprint TEXT;
BEGIN
  IF current_setting('transaction_isolation') NOT IN (
    'read committed', 'serializable'
  ) THEN
    RAISE EXCEPTION 'Question content mutation requires READ COMMITTED or SERIALIZABLE isolation.'
      USING ERRCODE = '25001';
  END IF;
  changed_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  target_version_id := CASE WHEN TG_TABLE_NAME = 'QuestionVersion'
    THEN (changed_row ->> 'id')::UUID
    ELSE (changed_row ->> 'questionVersionId')::UUID
  END;
  SELECT * INTO version_row FROM "QuestionVersion" WHERE "id" = target_version_id;
  IF version_row."id" IS NULL THEN RETURN NULL; END IF;

  SELECT COUNT(*), COUNT(DISTINCT "phase7_normalize_option_comparison"("text"))
  INTO option_count, normalized_option_count
  FROM "QuestionOption" WHERE "questionVersionId" = target_version_id;
  SELECT COUNT(*) INTO tag_count
  FROM "QuestionVersionTag" WHERE "questionVersionId" = target_version_id;
  expected_fingerprint := "phase7_question_version_fingerprint"(target_version_id);

  IF option_count <> 4 OR normalized_option_count <> 4
    OR tag_count NOT BETWEEN 1 AND 12
    OR NOT EXISTS (
      SELECT 1 FROM "QuestionOption"
      WHERE "questionVersionId" = target_version_id
        AND "id" = version_row."correctOptionId"
    ) OR EXISTS (
      SELECT 1 FROM "QuestionVersionTag" AS assignment
      WHERE assignment."questionVersionId" = target_version_id
        AND NOT EXISTS (
          SELECT 1 FROM "TagApplicability" AS applicability
          WHERE applicability."tagId" = assignment."tagId"
            AND applicability."level" = version_row."level"
            AND applicability."subject" = version_row."subject"
            AND applicability."questionType" = version_row."questionType"
        )
    ) OR expected_fingerprint IS NULL
      OR version_row."contentFingerprint" IS DISTINCT FROM expected_fingerprint THEN
    RAISE EXCEPTION 'QuestionVersion must commit complete canonical content.'
      USING ERRCODE = '23514';
  END IF;

  -- READ COMMITTED lifecycle-only paths need an explicit per-fingerprint
  -- winner lock. In a SERIALIZABLE content mutation, the indexed predicate is
  -- to PostgreSQL SSI so an invisible concurrent conflict aborts exactly one
  -- transaction instead of being mistaken for an already-visible duplicate.
  IF current_setting('transaction_isolation') = 'read committed' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(version_row."contentFingerprint", 0)
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM "QuestionVersion" AS duplicate
    WHERE duplicate."contentFingerprint" = version_row."contentFingerprint"
      AND duplicate."questionId" <> version_row."questionId"
  ) THEN
    RAISE EXCEPTION 'Cross-question canonical duplicate is forbidden.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER "QuestionVersion_deferred_full_content"
AFTER INSERT OR UPDATE ON "QuestionVersion"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_phase7_question_version_content"();

CREATE CONSTRAINT TRIGGER "QuestionOption_deferred_full_content"
AFTER INSERT OR UPDATE OR DELETE ON "QuestionOption"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_phase7_question_version_content"();

CREATE CONSTRAINT TRIGGER "QuestionVersionTag_deferred_full_content"
AFTER INSERT OR UPDATE OR DELETE ON "QuestionVersionTag"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_phase7_question_version_content"();

CREATE FUNCTION "validate_phase7_system_seed_catalog"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  changed_row JSONB := CASE WHEN TG_OP = 'DELETE'
    THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  assignment_digest TEXT;
  applicability_digest TEXT;
  semantic_digest TEXT;
BEGIN
  IF changed_row ->> 'createdByLabelSnapshot' <> 'SYSTEM_SEED' THEN
    RETURN NULL;
  END IF;

  -- The fixed 65-row digest is the context-free bootstrap authority, not a
  -- permanent ban on later owned versions of a SYSTEM_SEED aggregate. Armed
  -- operations are instead closed by their manifest, delta/evidence matrix,
  -- lifecycle guards, and the same deferred semantic validators.
  IF EXISTS (
    SELECT 1 FROM "Phase7OperationIntent" AS intent
    WHERE intent."backendPid" = pg_backend_pid()
      AND intent."transactionId" = txid_current()
      AND intent."occurredAt" IS NOT NULL
  ) THEN
    RETURN NULL;
  END IF;

  IF (SELECT COUNT(*) FROM "Question") <> 65
    OR (SELECT COUNT(*) FROM "QuestionVersion") <> 65
    OR (SELECT COUNT(*) FROM "QuestionOption") <> 260
    OR (SELECT COUNT(*) FROM "Tag") <> 108
    OR (SELECT COUNT(*) FROM "QuestionVersionTag") <> 130
    OR (SELECT COUNT(*) FROM "TagApplicability") <> 127
    OR (SELECT COUNT(*) FROM "ContentReview") <> 0
    OR (SELECT COUNT(*) FROM "AdminAuditLog") <> 0
    OR (SELECT COUNT(*) FROM "QuestionReport") <> 0
    OR EXISTS (
      SELECT 1
      FROM "Question" AS question
      JOIN "QuestionVersion" AS version
        ON version."questionId" = question."id"
       AND version."id" = question."currentPublishedVersionId"
      WHERE question."lifecycleStatus" <> 'ACTIVE'
        OR question."createdByLabelSnapshot" <> 'SYSTEM_SEED'
        OR question."rowVersion" <> 1
        OR version."versionNumber" <> 1
        OR version."status" <> 'PUBLISHED'
        OR version."createdByLabelSnapshot" <> 'SYSTEM_SEED'
        OR version."rowVersion" <> 1
        OR version."contentFingerprint" IS DISTINCT FROM
          "phase7_question_version_fingerprint"(version."id")
    )
    OR (SELECT COUNT(DISTINCT "contentFingerprint")
        FROM "QuestionVersion") <> 65 THEN
    RAISE EXCEPTION 'SYSTEM_SEED may only commit the canonical 65-question catalog.'
      USING ERRCODE = '23514';
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

  IF assignment_digest <>
      '4e3f91b5341b90fed7064fc3d810cf5d6cfa581707012e92440c8b041e1130b1'
    OR applicability_digest <>
      'adeca1ed1c85338c85aa3ec13299d43532f9bf4e0f0515775a29563567f4b078'
    OR semantic_digest <>
      'a180a0ea8dac51200b533fbe99624036fc19984be9cfbdd0c972c624e764444c' THEN
    RAISE EXCEPTION 'SYSTEM_SEED reviewed mapping digest drifted.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER "Question_deferred_system_seed_catalog"
AFTER INSERT OR UPDATE ON "Question"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_phase7_system_seed_catalog"();

CREATE CONSTRAINT TRIGGER "QuestionVersion_deferred_system_seed_catalog"
AFTER INSERT OR UPDATE ON "QuestionVersion"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_phase7_system_seed_catalog"();

-- Private, transaction-scoped operation authority. Rows are never allowed to
-- survive commit: the SECURITY DEFINER finish function verifies exact domain /
-- review / audit cardinality, then consumes both intent and deltas. A caller-
-- supplied custom GUC therefore cannot authorize a write.
CREATE TABLE "Phase7OperationIntent" (
  "operationId" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "command" "AdminAuditCommand" NOT NULL,
  "actorUserId" UUID,
  "actorSessionId" UUID,
  "actorFamilyId" UUID,
  "capturedAuthorityGeneration" INTEGER,
  "referencedUserIds" UUID[] NOT NULL,
  "targetManifest" JSONB,
  "requiresFresh" BOOLEAN NOT NULL DEFAULT false,
  "environment" "AdminAuditEnvironment" NOT NULL,
  "occurredAt" TIMESTAMPTZ(3),
  "backendPid" INTEGER NOT NULL,
  "transactionId" BIGINT NOT NULL,
  CONSTRAINT "Phase7OperationIntent_pkey" PRIMARY KEY ("operationId"),
  CONSTRAINT "Phase7OperationIntent_backend_transaction_key"
    UNIQUE ("backendPid", "transactionId"),
  CONSTRAINT "Phase7OperationIntent_referenced_users_check" CHECK (
    cardinality("referencedUserIds") >= 0
    AND array_position("referencedUserIds", NULL) IS NULL
  ),
  CONSTRAINT "Phase7OperationIntent_authority_shape_check" CHECK (
    ("actorUserId" IS NULL AND "actorSessionId" IS NULL
      AND "actorFamilyId" IS NULL AND "capturedAuthorityGeneration" IS NULL
      AND "requiresFresh" = false)
    OR
    ("actorUserId" IS NOT NULL AND "actorSessionId" IS NOT NULL
      AND "actorFamilyId" IS NOT NULL
      AND "capturedAuthorityGeneration" IS NOT NULL
      AND "capturedAuthorityGeneration" > 0)
      AND cardinality("referencedUserIds") > 0
      AND "actorUserId" = ANY ("referencedUserIds")
  )
);

CREATE TABLE "Phase7OperationDelta" (
  "operationId" UUID NOT NULL,
  "entityType" TEXT NOT NULL,
  "targetId" UUID NOT NULL,
  "questionId" UUID,
  "mutation" TEXT NOT NULL,
  "fromState" TEXT,
  "toState" TEXT,
  "beforeRowVersion" INTEGER,
  "afterRowVersion" INTEGER,
  "beforeSnapshot" JSONB,
  "afterSnapshot" JSONB,
  CONSTRAINT "Phase7OperationDelta_pkey"
    PRIMARY KEY ("operationId", "entityType", "targetId"),
  CONSTRAINT "Phase7OperationDelta_shape_check" CHECK (
    "entityType" IN ('QUESTION','QUESTION_VERSION','QUESTION_REPORT')
    AND "mutation" IN ('INSERT','UPDATE')
  ),
  CONSTRAINT "Phase7OperationDelta_operationId_fkey"
    FOREIGN KEY ("operationId") REFERENCES "Phase7OperationIntent"("operationId")
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "Phase7TrustedExecution" (
  "id" UUID NOT NULL DEFAULT public.gen_random_uuid(),
  "kind" TEXT NOT NULL,
  "targetUserId" UUID,
  "rememberSession" BOOLEAN,
  "environment" "AdminAuditEnvironment",
  "backendPid" INTEGER NOT NULL,
  "transactionId" BIGINT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "Phase7TrustedExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Phase7TrustedExecution_context_key"
    UNIQUE ("backendPid", "transactionId", "kind"),
  CONSTRAINT "Phase7TrustedExecution_kind_check" CHECK (
    "kind" IN (
      'ISSUE_V1', 'SIGN_OUT', 'ACTIVATE', 'REAUTHENTICATE', 'REFRESH',
      'FENCE_CLEANUP', 'PASSWORD_CHANGE', 'RESET_ISSUE', 'RESET_CONSUME',
      'AUTHORITY_CHANGE', 'ERASURE', 'REPORT_CREATE', 'REPORT_REDACTION'
    )
  )
);

REVOKE ALL ON TABLE "Phase7OperationIntent" FROM PUBLIC;
REVOKE ALL ON TABLE "Phase7OperationDelta" FROM PUBLIC;
REVOKE ALL ON TABLE "Phase7TrustedExecution" FROM PUBLIC;

CREATE FUNCTION "phase7_trusted_execution_active"(kind_value TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM "Phase7TrustedExecution"
    WHERE "kind" = kind_value
      AND "backendPid" = pg_backend_pid()
      AND "transactionId" = txid_current()
  );
$function$;

CREATE FUNCTION "phase7_trusted_execution_remember"()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
  SELECT COALESCE((
    SELECT "rememberSession" FROM "Phase7TrustedExecution"
    WHERE "kind" IN ('ISSUE_V1', 'REAUTHENTICATE', 'REFRESH')
      AND "backendPid" = pg_backend_pid()
      AND "transactionId" = txid_current()
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT 1
  ), false);
$function$;

CREATE FUNCTION "phase7_trusted_erasure_environment"()
RETURNS "AdminAuditEnvironment"
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
  SELECT "environment" FROM "Phase7TrustedExecution"
  WHERE "kind" = 'ERASURE'
    AND "backendPid" = pg_backend_pid()
    AND "transactionId" = txid_current()
  LIMIT 1;
$function$;

CREATE FUNCTION "phase7_trusted_execution_target"(kind_value TEXT)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
  SELECT "targetUserId" FROM "Phase7TrustedExecution"
  WHERE "kind" = kind_value
    AND "backendPid" = pg_backend_pid()
    AND "transactionId" = txid_current()
  LIMIT 1;
$function$;

CREATE FUNCTION "phase7_require_caller_role"(required_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  effective_caller TEXT := current_setting('role', true);
BEGIN
  IF current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN
    RAISE EXCEPTION 'Phase 7 facades require session_replication_role=origin.'
      USING ERRCODE = '42501';
  END IF;
  IF effective_caller IS NULL OR effective_caller = 'none' THEN
    effective_caller := session_user;
  END IF;
  IF effective_caller IS DISTINCT FROM required_role THEN
    RAISE EXCEPTION 'Caller role % is not authorized for this facade.',
      effective_caller USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE FUNCTION "phase7_open_trusted_execution"(
  kind_value TEXT,
  target_user_id UUID,
  remember_session BOOLEAN DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  execution_id UUID;
BEGIN
  INSERT INTO "Phase7TrustedExecution" (
    "kind", "targetUserId", "rememberSession", "backendPid", "transactionId"
  ) VALUES (
    kind_value, target_user_id, remember_session, pg_backend_pid(), txid_current()
  ) RETURNING "id" INTO execution_id;
  RETURN execution_id;
END;
$function$;

CREATE FUNCTION "phase7_close_trusted_execution"(execution_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
BEGIN
  DELETE FROM "Phase7TrustedExecution"
  WHERE "id" = execution_id
    AND "backendPid" = pg_backend_pid()
    AND "transactionId" = txid_current();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trusted execution is absent or belongs to another transaction.'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE FUNCTION "reject_unfinished_phase7_trusted_execution"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Phase7TrustedExecution" WHERE "id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'Trusted execution was not consumed.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER "Phase7TrustedExecution_must_finish"
AFTER INSERT ON "Phase7TrustedExecution"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "reject_unfinished_phase7_trusted_execution"();

REVOKE ALL ON FUNCTION "phase7_open_trusted_execution"(
  TEXT, UUID, BOOLEAN
) FROM PUBLIC;
REVOKE ALL ON FUNCTION "phase7_close_trusted_execution"(UUID) FROM PUBLIC;

CREATE FUNCTION "phase7_begin_admin_operation"(
  command_value "AdminAuditCommand",
  raw_session_token TEXT,
  request_id UUID,
  environment_value "AdminAuditEnvironment",
  referenced_user_ids UUID[]
)
RETURNS TABLE (
  "operationId" UUID,
  "actorUserId" UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  generated_operation_id UUID;
  authority_checked_at TIMESTAMPTZ(3);
  database_name TEXT := current_database();
  actor_user_id UUID;
  family_id UUID;
  session_id UUID;
  captured_generation INTEGER;
  canonical_user_ids UUID[];
  locked_user_count INTEGER;
  requires_fresh BOOLEAN := command_value IN (
    'APPROVAL','APPROVAL_WITHDRAWAL','PUBLICATION','RETIREMENT',
    'QUESTION_ARCHIVE','REVIEW_REQUEST_BATCH','IMPORT_APPLY','EXPORT',
    'REPORT_RESOLUTION'
  );
BEGIN
  IF command_value IN (
    'QUESTION_CREATE', 'QUESTION_VERSION_CREATE',
    'QUESTION_VERSION_UPDATE', 'PUBLICATION', 'IMPORT_APPLY'
  ) THEN
    IF current_setting('transaction_isolation') IS DISTINCT FROM 'serializable' THEN
      RAISE EXCEPTION 'Phase 7 content mutation requires SERIALIZABLE isolation.'
        USING ERRCODE = '25001';
    END IF;
  ELSIF command_value = 'EXPORT' THEN
    IF current_setting('transaction_isolation') IS DISTINCT FROM 'repeatable read' THEN
      RAISE EXCEPTION 'Phase 7 export requires REPEATABLE READ isolation.'
        USING ERRCODE = '25001';
    END IF;
  ELSIF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION 'Phase 7 admin operation requires READ COMMITTED isolation.'
      USING ERRCODE = '25001';
  END IF;

  PERFORM "phase7_require_caller_role"('nihongo_app');
  generated_operation_id := public.gen_random_uuid();
  PERFORM "phase7_require_database_capability"(environment_value);

  SELECT session."userId", session."sessionFamilyId", session."id"
  INTO actor_user_id, family_id, session_id
  FROM "Session" AS session
  WHERE session."token" = raw_session_token;
  IF actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Phase 7 operation requires an existing Session.'
      USING ERRCODE = '42501';
  END IF;

  IF referenced_user_ids IS NULL
    OR cardinality(referenced_user_ids) < 1
    OR command_value <> 'EXPORT'
      AND cardinality(referenced_user_ids) > 512
    OR array_position(referenced_user_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 7 referenced User set is invalid.'
      USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT referenced_user_id ORDER BY referenced_user_id)
  INTO canonical_user_ids
  FROM unnest(referenced_user_ids) AS referenced(referenced_user_id);
  IF cardinality(canonical_user_ids) IS DISTINCT FROM
      cardinality(referenced_user_ids)
    OR NOT actor_user_id = ANY (canonical_user_ids) THEN
    RAISE EXCEPTION 'Phase 7 referenced User set must be unique and include the actor.'
      USING ERRCODE = '22023';
  END IF;

  -- A bounded non-locking pre-read resolves the actor Session. Every live User
  -- referenced by the command is then locked in one canonical UUID order
  -- before the actor family, Session, or any domain aggregate is locked.
  PERFORM actor."id" FROM "User" AS actor
  WHERE actor."id" = ANY (canonical_user_ids)
  ORDER BY actor."id"
  FOR UPDATE;
  GET DIAGNOSTICS locked_user_count = ROW_COUNT;
  IF locked_user_count IS DISTINCT FROM cardinality(canonical_user_ids) THEN
    RAISE EXCEPTION 'A referenced Phase 7 User is unavailable.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM "AuthSessionFamily" AS family
  WHERE family."id" = family_id AND family."userId" = actor_user_id
  ORDER BY family."id"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phase 7 operation Session family is unavailable.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM "Session" AS session
  WHERE session."id" = session_id
    AND session."userId" = actor_user_id
    AND session."sessionFamilyId" = family_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phase 7 operation Session is unavailable.'
      USING ERRCODE = '42501';
  END IF;
  authority_checked_at := clock_timestamp();
  PERFORM 1
  FROM "User" AS actor
  JOIN "AuthSessionFamily" AS family
    ON family."userId" = actor."id" AND family."id" = family_id
  JOIN "Session" AS session
    ON session."userId" = actor."id"
   AND session."sessionFamilyId" = family."id"
   AND session."id" = session_id
  WHERE actor."id" = actor_user_id
    AND actor."role" = 'ADMIN'
    AND actor."accountStatus" = 'ACTIVE'
    AND family."status" = 'ACTIVE'
    AND session."token" = raw_session_token
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorityGeneration" = actor."authorityGeneration"
    AND session."expiresAt" > authority_checked_at
    AND session."createdAt" + INTERVAL '30 days' > authority_checked_at
    AND (NOT requires_fresh
      OR session."createdAt" + INTERVAL '5 minutes' > authority_checked_at)
  ;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phase 7 operation authority is stale or insufficient.'
      USING ERRCODE = '42501';
  END IF;
  SELECT actor."authorityGeneration" INTO captured_generation
  FROM "User" AS actor WHERE actor."id" = actor_user_id;

  INSERT INTO "Phase7OperationIntent" (
    "operationId", "requestId", "command", "actorUserId",
    "actorSessionId", "actorFamilyId", "capturedAuthorityGeneration",
    "referencedUserIds", "requiresFresh", "environment", "occurredAt",
    "backendPid", "transactionId"
  ) VALUES (
    generated_operation_id, request_id, command_value, actor_user_id,
    session_id, family_id, captured_generation, canonical_user_ids,
    requires_fresh, environment_value, NULL, pg_backend_pid(), txid_current()
  );
  RETURN QUERY SELECT generated_operation_id, actor_user_id;
END;
$function$;

CREATE FUNCTION "phase7_arm_admin_operation"(
  operation_id UUID,
  target_manifest JSONB
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  intent "Phase7OperationIntent"%ROWTYPE;
  event_time TIMESTAMPTZ(3);
  target RECORD;
  referenced RECORD;
  referenced_user_id UUID;
  question_row "Question"%ROWTYPE;
  version_row "QuestionVersion"%ROWTYPE;
  report_row "QuestionReport"%ROWTYPE;
  question_count INTEGER;
  version_count INTEGER;
  report_count INTEGER;
  tag_count INTEGER;
  question_ids UUID[] := ARRAY[]::UUID[];
  version_ids UUID[] := ARRAY[]::UUID[];
  derived_user_ids UUID[] := ARRAY[]::UUID[];
  canonical_user_ids UUID[];
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_app');
  SELECT operation_intent.* INTO intent
  FROM "Phase7OperationIntent" AS operation_intent
  WHERE operation_intent."operationId" = operation_id
    AND operation_intent."backendPid" = pg_backend_pid()
    AND operation_intent."transactionId" = txid_current()
    AND operation_intent."actorUserId" IS NOT NULL
    AND operation_intent."occurredAt" IS NULL
    AND operation_intent."targetManifest" IS NULL
  FOR UPDATE;
  IF intent."operationId" IS NULL THEN
    RAISE EXCEPTION 'Phase 7 operation is absent or already armed.'
      USING ERRCODE = '42501';
  END IF;

  IF target_manifest IS NULL OR jsonb_typeof(target_manifest) <> 'object'
    OR NOT target_manifest ?& ARRAY['questions','versions','reports','tags']
    OR target_manifest - ARRAY['questions','versions','reports','tags']::TEXT[]
      <> '{}'::JSONB
    OR jsonb_typeof(target_manifest->'questions') <> 'array'
    OR jsonb_typeof(target_manifest->'versions') <> 'array'
    OR jsonb_typeof(target_manifest->'reports') <> 'array'
    OR jsonb_typeof(target_manifest->'tags') <> 'array'
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        (target_manifest->'questions') || (target_manifest->'versions')
          || (target_manifest->'reports')
      ) AS item(value)
      WHERE jsonb_typeof(item.value) <> 'object'
        OR NOT item.value ?& ARRAY['id','rowVersion','state']
        OR item.value - ARRAY['id','rowVersion','state']::TEXT[] <> '{}'::JSONB
        OR jsonb_typeof(item.value->'id') <> 'string'
        OR jsonb_typeof(item.value->'rowVersion') <> 'number'
        OR jsonb_typeof(item.value->'state') <> 'string'
    ) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(target_manifest->'tags') AS item(value)
      WHERE jsonb_typeof(item.value) <> 'string'
    ) THEN
    RAISE EXCEPTION 'Phase 7 target manifest is not closed and typed.'
      USING ERRCODE = '22023';
  END IF;

  question_count := jsonb_array_length(target_manifest->'questions');
  version_count := jsonb_array_length(target_manifest->'versions');
  report_count := jsonb_array_length(target_manifest->'reports');
  tag_count := jsonb_array_length(target_manifest->'tags');
  IF pg_column_size(target_manifest) > 8 * 1024 * 1024
    OR question_count > 100 OR report_count > 100 OR tag_count > 1200
    OR question_count <> (
      SELECT COUNT(DISTINCT (item.value->>'id')::UUID)
      FROM jsonb_array_elements(target_manifest->'questions') AS item(value)
    ) OR version_count <> (
      SELECT COUNT(DISTINCT (item.value->>'id')::UUID)
      FROM jsonb_array_elements(target_manifest->'versions') AS item(value)
    ) OR report_count <> (
      SELECT COUNT(DISTINCT (item.value->>'id')::UUID)
      FROM jsonb_array_elements(target_manifest->'reports') AS item(value)
    ) OR tag_count <> (
      SELECT COUNT(DISTINCT item.value #>> '{}')
      FROM jsonb_array_elements(target_manifest->'tags') AS item(value)
    ) THEN
    RAISE EXCEPTION 'Phase 7 target manifest is duplicate or out of bounds.'
      USING ERRCODE = '22023';
  END IF;

  CASE intent."command"
    WHEN 'QUESTION_CREATE' THEN
      IF question_count <> 0 OR version_count <> 0 OR report_count <> 0
        OR tag_count NOT BETWEEN 1 AND 12 THEN
        RAISE EXCEPTION 'QUESTION_CREATE target manifest is invalid.'
          USING ERRCODE = '22023';
      END IF;
    WHEN 'QUESTION_VERSION_CREATE' THEN
      IF question_count <> 1 OR version_count <> 0 OR report_count <> 0
        OR tag_count NOT BETWEEN 1 AND 12 THEN
        RAISE EXCEPTION 'QUESTION_VERSION_CREATE target manifest is invalid.'
          USING ERRCODE = '22023';
      END IF;
    WHEN 'QUESTION_VERSION_UPDATE' THEN
      IF question_count <> 1 OR version_count <> 1 OR report_count <> 0 THEN
        RAISE EXCEPTION 'Single-version target manifest is invalid.'
          USING ERRCODE = '22023';
      END IF;
      IF tag_count NOT BETWEEN 1 AND 12 THEN
        RAISE EXCEPTION 'QUESTION_VERSION_UPDATE Tag manifest is invalid.'
          USING ERRCODE = '22023';
      END IF;
    WHEN 'REVIEW_REQUEST', 'CHANGE_REQUEST', 'APPROVAL',
      'APPROVAL_WITHDRAWAL', 'RETIREMENT' THEN
      IF question_count <> 1 OR version_count <> 1 OR report_count <> 0
        OR tag_count <> 0 THEN
        RAISE EXCEPTION 'Single-version target manifest is invalid.'
          USING ERRCODE = '22023';
      END IF;
    WHEN 'PUBLICATION' THEN
      IF question_count <> 1 OR version_count NOT BETWEEN 1 AND 2
        OR report_count <> 0 OR tag_count <> 0 THEN
        RAISE EXCEPTION 'PUBLICATION target manifest is invalid.'
          USING ERRCODE = '22023';
      END IF;
    WHEN 'QUESTION_ARCHIVE' THEN
      IF question_count <> 1 OR version_count NOT BETWEEN 0 AND 2
        OR report_count <> 0 OR tag_count <> 0 THEN
        RAISE EXCEPTION 'QUESTION_ARCHIVE target manifest is invalid.'
          USING ERRCODE = '22023';
      END IF;
    WHEN 'REVIEW_REQUEST_BATCH' THEN
      IF question_count NOT BETWEEN 1 AND 20
        OR version_count NOT BETWEEN 1 AND 20 OR report_count <> 0
        OR tag_count <> 0 THEN
        RAISE EXCEPTION 'REVIEW_REQUEST_BATCH target manifest is invalid.'
          USING ERRCODE = '22023';
      END IF;
    WHEN 'IMPORT_APPLY' THEN
      IF question_count <> 0 OR version_count <> 0 OR report_count <> 0
        OR tag_count NOT BETWEEN 1 AND 1200 THEN
        RAISE EXCEPTION 'IMPORT_APPLY target manifest is invalid.'
          USING ERRCODE = '22023';
      END IF;
    WHEN 'EXPORT' THEN
      IF question_count NOT BETWEEN 1 AND 100
        OR version_count < question_count OR report_count <> 0
        OR tag_count <> 0 THEN
        RAISE EXCEPTION 'EXPORT target manifest is invalid.'
          USING ERRCODE = '22023';
      END IF;
    WHEN 'REPORT_TRIAGE' THEN
      IF question_count <> 1 OR version_count <> 1 OR report_count <> 1
        OR tag_count <> 0 THEN
        RAISE EXCEPTION 'REPORT_TRIAGE target manifest is invalid.'
          USING ERRCODE = '22023';
      END IF;
    WHEN 'REPORT_RESOLUTION' THEN
      IF question_count <> 1 OR version_count NOT BETWEEN 1 AND 2
        OR report_count <> 1 OR tag_count <> 0 THEN
        RAISE EXCEPTION 'REPORT_RESOLUTION target manifest is invalid.'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'This Phase 7 command cannot use the admin arm facade.'
        USING ERRCODE = '42501';
  END CASE;

  -- The Tag/QVT scope mutex precedes every aggregate and Tag row lock when a
  -- command can assign tags. The later statement triggers acquire the same
  -- transaction lock reentrantly, closing Tag-rename reverse lock order.
  IF tag_count > 0 THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('nihongo-phase7-tag-assignment-scope-v1', 0)
    );
  END IF;

  derived_user_ids := ARRAY[intent."actorUserId"]::UUID[];
  FOR target IN
    SELECT (item->>'id')::UUID AS id,
      (item->>'rowVersion')::INTEGER AS row_version,
      item->>'state' AS state
    FROM jsonb_array_elements(target_manifest->'questions') AS item
    ORDER BY (item->>'id')::UUID
  LOOP
    SELECT * INTO question_row FROM "Question"
    WHERE "id" = target.id FOR UPDATE;
    IF question_row."id" IS NULL
      OR question_row."rowVersion" IS DISTINCT FROM target.row_version
      OR question_row."lifecycleStatus"::TEXT IS DISTINCT FROM target.state THEN
      RAISE EXCEPTION 'Phase 7 Question target changed before arm.'
        USING ERRCODE = '40001';
    END IF;
    question_ids := array_append(question_ids, question_row."id");
    IF question_row."createdByUserId" IS NOT NULL THEN
      derived_user_ids := array_append(
        derived_user_ids, question_row."createdByUserId"
      );
    END IF;
  END LOOP;

  FOR target IN
    SELECT (item->>'id')::UUID AS id,
      (item->>'rowVersion')::INTEGER AS row_version,
      item->>'state' AS state
    FROM jsonb_array_elements(target_manifest->'versions') AS item
    ORDER BY (item->>'id')::UUID
  LOOP
    SELECT * INTO version_row FROM "QuestionVersion"
    WHERE "id" = target.id FOR UPDATE;
    IF version_row."id" IS NULL
      OR version_row."rowVersion" IS DISTINCT FROM target.row_version
      OR version_row."status"::TEXT IS DISTINCT FROM target.state
      OR NOT version_row."questionId" = ANY (question_ids) THEN
      RAISE EXCEPTION 'Phase 7 QuestionVersion target changed before arm.'
        USING ERRCODE = '40001';
    END IF;
    version_ids := array_append(version_ids, version_row."id");
    IF version_row."createdByUserId" IS NOT NULL THEN
      derived_user_ids := array_append(
        derived_user_ids, version_row."createdByUserId"
      );
    END IF;
    IF intent."command" IN ('APPROVAL_WITHDRAWAL', 'PUBLICATION')
      AND version_row."status" = 'APPROVED' THEN
      SELECT review."actorUserId" INTO referenced_user_id
      FROM "ContentReview" AS review
      WHERE review."questionVersionId" = version_row."id"
        AND review."action" = 'APPROVED'
      ORDER BY review."occurredAt" DESC, review."id" DESC
      LIMIT 1;
      IF referenced_user_id IS NOT NULL THEN
        derived_user_ids := array_append(derived_user_ids, referenced_user_id);
      END IF;
    END IF;
  END LOOP;

  FOR target IN
    SELECT (item->>'id')::UUID AS id,
      (item->>'rowVersion')::INTEGER AS row_version,
      item->>'state' AS state
    FROM jsonb_array_elements(target_manifest->'reports') AS item
    ORDER BY (item->>'id')::UUID
  LOOP
    SELECT * INTO report_row FROM "QuestionReport"
    WHERE "id" = target.id FOR UPDATE;
    IF report_row."id" IS NULL
      OR report_row."rowVersion" IS DISTINCT FROM target.row_version
      OR report_row."status"::TEXT IS DISTINCT FROM target.state
      OR NOT report_row."questionId" = ANY (question_ids)
      OR NOT report_row."questionVersionId" = ANY (version_ids) THEN
      RAISE EXCEPTION 'Phase 7 QuestionReport target changed before arm.'
        USING ERRCODE = '40001';
    END IF;
    IF report_row."reporterUserId" IS NOT NULL THEN
      derived_user_ids := array_append(
        derived_user_ids, report_row."reporterUserId"
      );
    END IF;
    IF report_row."assigneeUserId" IS NOT NULL THEN
      derived_user_ids := array_append(
        derived_user_ids, report_row."assigneeUserId"
      );
    END IF;
  END LOOP;

  IF intent."command" IN (
    'QUESTION_VERSION_CREATE', 'QUESTION_VERSION_UPDATE', 'REVIEW_REQUEST',
    'CHANGE_REQUEST', 'APPROVAL', 'APPROVAL_WITHDRAWAL', 'PUBLICATION',
    'RETIREMENT', 'QUESTION_ARCHIVE', 'REVIEW_REQUEST_BATCH'
  ) AND EXISTS (
    SELECT 1 FROM "Question" AS question
    WHERE question."id" = ANY (question_ids)
      AND question."lifecycleStatus" <> 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Admin content command requires an ACTIVE Question.'
      USING ERRCODE = '23514';
  END IF;

  IF intent."command" = 'QUESTION_VERSION_CREATE' AND EXISTS (
    SELECT 1
    FROM "QuestionVersion" AS candidate
    WHERE candidate."questionId" = ANY (question_ids)
      AND candidate."status" IN (
        'DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'
      )
  ) THEN
    RAISE EXCEPTION 'QUESTION_VERSION_CREATE requires no open candidate.'
      USING ERRCODE = '23514';
  ELSIF intent."command" = 'QUESTION_VERSION_UPDATE' AND EXISTS (
    SELECT 1 FROM "QuestionVersion" AS version
    WHERE version."id" = ANY (version_ids)
      AND version."status" NOT IN ('DRAFT', 'CHANGES_REQUESTED')
  ) THEN
    RAISE EXCEPTION 'QUESTION_VERSION_UPDATE target is not editable.'
      USING ERRCODE = '23514';
  ELSIF intent."command" = 'REVIEW_REQUEST' AND EXISTS (
    SELECT 1 FROM "QuestionVersion" AS version
    WHERE version."id" = ANY (version_ids)
      AND version."status" NOT IN ('DRAFT', 'CHANGES_REQUESTED')
  ) THEN
    RAISE EXCEPTION 'REVIEW_REQUEST target state is invalid.'
      USING ERRCODE = '23514';
  ELSIF intent."command" IN ('CHANGE_REQUEST', 'APPROVAL') AND EXISTS (
    SELECT 1 FROM "QuestionVersion" AS version
    WHERE version."id" = ANY (version_ids)
      AND version."status" <> 'IN_REVIEW'
  ) THEN
    RAISE EXCEPTION 'Review decision target state is invalid.'
      USING ERRCODE = '23514';
  ELSIF intent."command" = 'APPROVAL_WITHDRAWAL' AND EXISTS (
    SELECT 1 FROM "QuestionVersion" AS version
    WHERE version."id" = ANY (version_ids)
      AND version."status" <> 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'APPROVAL_WITHDRAWAL target state is invalid.'
      USING ERRCODE = '23514';
  ELSIF intent."command" = 'REVIEW_REQUEST_BATCH' AND EXISTS (
    SELECT 1 FROM "QuestionVersion" AS version
    WHERE version."id" = ANY (version_ids)
      AND version."status" NOT IN ('DRAFT', 'CHANGES_REQUESTED')
  ) THEN
    RAISE EXCEPTION 'REVIEW_REQUEST_BATCH target state is invalid.'
      USING ERRCODE = '23514';
  END IF;

  IF intent."command" = 'PUBLICATION' AND (
    (SELECT COUNT(*) FROM "QuestionVersion" AS version
      WHERE version."id" = ANY (version_ids)
        AND version."status" = 'APPROVED') <> 1
    OR (SELECT COUNT(*) FROM "QuestionVersion" AS version
      WHERE version."id" = ANY (version_ids)
        AND version."status" = 'PUBLISHED') <> version_count - 1
    OR EXISTS (
      SELECT 1 FROM "Question" AS question
      WHERE question."id" = ANY (question_ids)
        AND (
          question."currentPublishedVersionId" IS NULL
            AND version_count <> 1
          OR question."currentPublishedVersionId" IS NOT NULL
            AND (
              version_count <> 2
              OR NOT question."currentPublishedVersionId" = ANY (version_ids)
              OR NOT EXISTS (
                SELECT 1 FROM "QuestionVersion" AS current_version
                WHERE current_version."id" =
                    question."currentPublishedVersionId"
                  AND current_version."status" = 'PUBLISHED'
              )
            )
        )
    )
  ) THEN
    RAISE EXCEPTION 'PUBLICATION manifest is not target plus exact current.'
      USING ERRCODE = '23514';
  ELSIF intent."command" = 'RETIREMENT' AND EXISTS (
    SELECT 1 FROM "Question" AS question
    LEFT JOIN "QuestionVersion" AS version
      ON version."id" = question."currentPublishedVersionId"
    WHERE question."id" = ANY (question_ids)
      AND (question."currentPublishedVersionId" IS NULL
        OR NOT question."currentPublishedVersionId" = ANY (version_ids)
        OR version."status" <> 'PUBLISHED')
  ) THEN
    RAISE EXCEPTION 'RETIREMENT target is not the exact current version.'
      USING ERRCODE = '23514';
  ELSIF intent."command" = 'QUESTION_ARCHIVE' AND (
    EXISTS (
      (SELECT question."currentPublishedVersionId" AS id
       FROM "Question" AS question
       WHERE question."id" = ANY (question_ids)
         AND question."currentPublishedVersionId" IS NOT NULL
       UNION
       SELECT candidate."id"
       FROM "QuestionVersion" AS candidate
       WHERE candidate."questionId" = ANY (question_ids)
         AND candidate."status" IN (
           'DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'
         ))
      EXCEPT
      SELECT unnest(version_ids)
    ) OR EXISTS (
      SELECT unnest(version_ids)
      EXCEPT
      (SELECT question."currentPublishedVersionId" AS id
       FROM "Question" AS question
       WHERE question."id" = ANY (question_ids)
         AND question."currentPublishedVersionId" IS NOT NULL
       UNION
       SELECT candidate."id"
       FROM "QuestionVersion" AS candidate
       WHERE candidate."questionId" = ANY (question_ids)
         AND candidate."status" IN (
           'DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'
         ))
    )
  ) THEN
    RAISE EXCEPTION 'QUESTION_ARCHIVE omitted or added an aggregate target.'
      USING ERRCODE = '23514';
  END IF;

  IF intent."command" IN ('REPORT_TRIAGE', 'REPORT_RESOLUTION') AND EXISTS (
    SELECT 1 FROM "QuestionReport" AS report
    WHERE report."id" = ANY (
      SELECT (item.value->>'id')::UUID
      FROM jsonb_array_elements(target_manifest->'reports') AS item(value)
    )
      AND (NOT report."questionId" = ANY (question_ids)
        OR NOT report."questionVersionId" = ANY (version_ids)
        OR intent."command" = 'REPORT_TRIAGE' AND report."status" <> 'OPEN'
        OR intent."command" = 'REPORT_RESOLUTION'
          AND report."status" <> 'TRIAGED')
  ) THEN
    RAISE EXCEPTION 'QuestionReport command manifest is not canonical.'
      USING ERRCODE = '23514';
  END IF;

  IF intent."command" IN ('REVIEW_REQUEST_BATCH', 'EXPORT') AND (
    EXISTS (
      SELECT unnest(question_ids)
      EXCEPT
      SELECT DISTINCT version."questionId"
      FROM "QuestionVersion" AS version
      WHERE version."id" = ANY (version_ids)
    ) OR EXISTS (
      SELECT DISTINCT version."questionId"
      FROM "QuestionVersion" AS version
      WHERE version."id" = ANY (version_ids)
      EXCEPT
      SELECT unnest(question_ids)
    )
  ) THEN
    RAISE EXCEPTION 'Set operation Question/version manifest is not exact.'
      USING ERRCODE = '23514';
  END IF;

  IF intent."command" = 'EXPORT' THEN
    FOR referenced IN
      SELECT DISTINCT live_user.user_id
      FROM (
        SELECT review."actorUserId" AS user_id
        FROM "ContentReview" AS review
        WHERE review."questionVersionId" = ANY (version_ids)
        UNION
        SELECT review."counterpartUserId" AS user_id
        FROM "ContentReview" AS review
        WHERE review."questionVersionId" = ANY (version_ids)
      ) AS live_user
      WHERE live_user.user_id IS NOT NULL
      ORDER BY live_user.user_id
    LOOP
      derived_user_ids := array_append(derived_user_ids, referenced.user_id);
    END LOOP;
  END IF;

  FOR target IN
    SELECT (item #>> '{}')::UUID AS id
    FROM jsonb_array_elements(target_manifest->'tags') AS item
    ORDER BY (item #>> '{}')::UUID
  LOOP
    PERFORM 1 FROM "Tag" WHERE "id" = target.id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Phase 7 Tag target changed before arm.'
        USING ERRCODE = '40001';
    END IF;
  END LOOP;

  SELECT array_agg(DISTINCT user_id ORDER BY user_id)
  INTO canonical_user_ids
  FROM unnest(derived_user_ids) AS users(user_id);
  IF canonical_user_ids IS DISTINCT FROM intent."referencedUserIds" THEN
    RAISE EXCEPTION 'Phase 7 referenced User set is not exact for its targets.'
      USING ERRCODE = '42501';
  END IF;

  -- All canonical targets, their expected state/version, and their exact live
  -- User set are now locked and revalidated. No domain/evidence trigger can
  -- resolve this intent before the one-shot timestamp is stored.
  event_time := CASE WHEN intent."command" = 'EXPORT'
    THEN transaction_timestamp()
    ELSE clock_timestamp()
  END;
  UPDATE "Phase7OperationIntent"
  SET "targetManifest" = target_manifest,
      "occurredAt" = event_time
  WHERE "operationId" = operation_id;
  RETURN event_time;
END;
$function$;

CREATE FUNCTION "phase7_current_operation_id"()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  operation_id UUID;
BEGIN
  SELECT intent."operationId" INTO operation_id
  FROM "Phase7OperationIntent" AS intent
  WHERE intent."backendPid" = pg_backend_pid()
    AND intent."transactionId" = txid_current()
    AND intent."occurredAt" IS NOT NULL;
  IF operation_id IS NULL THEN
    RAISE EXCEPTION 'An armed trusted Phase 7 operation intent is required.'
      USING ERRCODE = '42501';
  END IF;
  RETURN operation_id;
END;
$function$;

CREATE FUNCTION "phase7_operation_references_user"(user_id_value UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
  SELECT COALESCE((
    SELECT user_id_value = ANY (intent."referencedUserIds")
    FROM "Phase7OperationIntent" AS intent
    WHERE intent."backendPid" = pg_backend_pid()
      AND intent."transactionId" = txid_current()
      AND intent."occurredAt" IS NOT NULL
  ), false);
$function$;

CREATE FUNCTION "phase7_operation_target_matches"(
  entity_type_value TEXT,
  target_id_value UUID,
  question_id_value UUID,
  mutation_value TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  intent "Phase7OperationIntent"%ROWTYPE;
  manifest_key TEXT;
BEGIN
  SELECT operation_intent.* INTO intent
  FROM "Phase7OperationIntent" AS operation_intent
  WHERE operation_intent."backendPid" = pg_backend_pid()
    AND operation_intent."transactionId" = txid_current()
    AND operation_intent."occurredAt" IS NOT NULL;
  IF intent."operationId" IS NULL THEN
    RETURN false;
  END IF;
  IF intent."command" = 'AUTHOR_ERASURE_ABANDON' THEN
    RETURN true;
  END IF;
  IF intent."targetManifest" IS NULL THEN
    RETURN false;
  END IF;

  IF mutation_value = 'INSERT' THEN
    IF entity_type_value = 'QUESTION' THEN
      RETURN intent."command" IN ('QUESTION_CREATE', 'IMPORT_APPLY');
    ELSIF entity_type_value = 'QUESTION_VERSION' THEN
      RETURN intent."command" IN ('QUESTION_CREATE', 'IMPORT_APPLY')
        OR intent."command" = 'QUESTION_VERSION_CREATE'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              intent."targetManifest"->'questions'
            ) AS item(value)
            WHERE (item.value->>'id')::UUID = question_id_value
          );
    END IF;
    RETURN false;
  END IF;

  manifest_key := CASE entity_type_value
    WHEN 'QUESTION' THEN 'questions'
    WHEN 'QUESTION_VERSION' THEN 'versions'
    WHEN 'QUESTION_REPORT' THEN 'reports'
    ELSE NULL
  END;
  IF mutation_value <> 'UPDATE' OR manifest_key IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      intent."targetManifest"->manifest_key
    ) AS item(value)
    WHERE (item.value->>'id')::UUID = target_id_value
  );
END;
$function$;

CREATE FUNCTION "phase7_question_version_audit_snapshot"(target_version_id UUID)
RETURNS JSONB
LANGUAGE SQL
STABLE
STRICT
AS $function$
  SELECT jsonb_build_object(
    'level', version."level",
    'subject', version."subject",
    'questionType', version."questionType",
    'difficulty', version."difficulty",
    'passage', version."passage",
    'questionText', version."questionText",
    'explanationKo', version."explanationKo",
    'explanationJa', version."explanationJa",
    'options', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', option."id", 'label', option."label", 'text', option."text",
        'ordinal', option."ordinal"
      ) ORDER BY option."ordinal", option."id")
      FROM "QuestionOption" AS option
      WHERE option."questionVersionId" = version."id"
    ), '[]'::JSONB),
    'correctOptionId', version."correctOptionId",
    'tags', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', assignment."id", 'tagId', assignment."tagId",
        'labelSnapshot', assignment."labelSnapshot",
        'normalizedNameSnapshot', assignment."normalizedNameSnapshot"
      ) ORDER BY assignment."normalizedNameSnapshot", assignment."id")
      FROM "QuestionVersionTag" AS assignment
      WHERE assignment."questionVersionId" = version."id"
    ), '[]'::JSONB)
  )
  FROM "QuestionVersion" AS version
  WHERE version."id" = target_version_id;
$function$;

CREATE FUNCTION "capture_phase7_operation_delta"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  operation_id UUID;
  entity_type TEXT;
  target_id UUID;
  question_id UUID;
  from_state TEXT;
  to_state TEXT;
  before_version INTEGER;
  after_version INTEGER;
  before_snapshot JSONB;
  after_snapshot JSONB;
BEGIN
  IF TG_TABLE_NAME = 'QuestionVersion' THEN
    IF TG_OP = 'INSERT' AND NEW."createdByLabelSnapshot" = 'SYSTEM_SEED' THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND (
      to_jsonb(NEW) - 'contentFingerprint'
    ) = (
      to_jsonb(OLD) - 'contentFingerprint'
    ) THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."createdByLabelSnapshot" = 'SYSTEM_SEED'
      AND OLD."status" = 'DRAFT' AND NEW."status" = 'PUBLISHED'
      AND OLD."rowVersion" = 1 AND NEW."rowVersion" = 1 THEN
      RETURN NEW;
    END IF;
    entity_type := 'QUESTION_VERSION';
    target_id := NEW."id";
    question_id := NEW."questionId";
    from_state := CASE WHEN TG_OP = 'UPDATE' THEN OLD."status"::TEXT END;
    to_state := NEW."status"::TEXT;
    before_version := CASE WHEN TG_OP = 'UPDATE' THEN OLD."rowVersion" END;
    after_version := NEW."rowVersion";
    before_snapshot := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE
      "phase7_question_version_audit_snapshot"(NEW."id")
        || jsonb_build_object(
          'level', OLD."level", 'subject', OLD."subject",
          'questionType', OLD."questionType", 'difficulty', OLD."difficulty",
          'passage', OLD."passage", 'questionText', OLD."questionText",
          'explanationKo', OLD."explanationKo",
          'explanationJa', OLD."explanationJa",
          'correctOptionId', OLD."correctOptionId"
        )
      END;
    after_snapshot := "phase7_question_version_audit_snapshot"(NEW."id");
  ELSIF TG_TABLE_NAME = 'Question' THEN
    IF TG_OP = 'INSERT' AND NEW."createdByLabelSnapshot" = 'SYSTEM_SEED' THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."createdByLabelSnapshot" = 'SYSTEM_SEED'
      AND OLD."currentPublishedVersionId" IS NULL
      AND NEW."currentPublishedVersionId" IS NOT NULL
      AND OLD."rowVersion" = 1 AND NEW."rowVersion" = 1 THEN
      RETURN NEW;
    END IF;
    entity_type := 'QUESTION';
    target_id := NEW."id";
    question_id := NEW."id";
    from_state := CASE WHEN TG_OP = 'UPDATE' THEN OLD."lifecycleStatus"::TEXT END;
    to_state := NEW."lifecycleStatus"::TEXT;
    before_version := CASE WHEN TG_OP = 'UPDATE' THEN OLD."rowVersion" END;
    after_version := NEW."rowVersion";
    before_snapshot := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
    after_snapshot := to_jsonb(NEW);
  ELSE
    IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
    IF "phase7_trusted_execution_active"('REPORT_REDACTION') THEN
      RETURN NEW;
    END IF;
    entity_type := 'QUESTION_REPORT';
    target_id := NEW."id";
    question_id := NEW."questionId";
    from_state := OLD."status"::TEXT;
    to_state := NEW."status"::TEXT;
    before_version := OLD."rowVersion";
    after_version := NEW."rowVersion";
    before_snapshot := to_jsonb(OLD);
    after_snapshot := to_jsonb(NEW);
  END IF;

  operation_id := "phase7_current_operation_id"();
  IF NOT "phase7_operation_target_matches"(
    entity_type, target_id, question_id, TG_OP
  ) THEN
    RAISE EXCEPTION 'Domain mutation target was not locked by the operation manifest.'
      USING ERRCODE = '42501';
  END IF;
  IF entity_type = 'QUESTION'
    AND (to_jsonb(NEW)->>'createdByUserId') IS NOT NULL
    AND NOT "phase7_operation_references_user"(
      (to_jsonb(NEW)->>'createdByUserId')::UUID
    ) THEN
    RAISE EXCEPTION 'Question creator was not prelocked by the operation.'
      USING ERRCODE = '42501';
  ELSIF entity_type = 'QUESTION_VERSION'
    AND (to_jsonb(NEW)->>'createdByUserId') IS NOT NULL
    AND NOT "phase7_operation_references_user"(
      (to_jsonb(NEW)->>'createdByUserId')::UUID
    ) THEN
    RAISE EXCEPTION 'QuestionVersion creator was not prelocked by the operation.'
      USING ERRCODE = '42501';
  ELSIF entity_type = 'QUESTION_REPORT' AND (
    (to_jsonb(NEW)->>'reporterUserId') IS NOT NULL
      AND NOT "phase7_operation_references_user"(
        (to_jsonb(NEW)->>'reporterUserId')::UUID
      )
    OR (to_jsonb(NEW)->>'assigneeUserId') IS NOT NULL
      AND NOT "phase7_operation_references_user"(
        (to_jsonb(NEW)->>'assigneeUserId')::UUID
      )
  ) THEN
    RAISE EXCEPTION 'QuestionReport live actors were not prelocked.'
      USING ERRCODE = '42501';
  END IF;
  INSERT INTO "Phase7OperationDelta" (
    "operationId", "entityType", "targetId", "questionId", "mutation",
    "fromState", "toState", "beforeRowVersion", "afterRowVersion",
    "beforeSnapshot", "afterSnapshot"
  ) VALUES (
    operation_id, entity_type, target_id, question_id, TG_OP,
    from_state, to_state, before_version, after_version,
    before_snapshot, after_snapshot
  )
  ON CONFLICT ("operationId", "entityType", "targetId") DO UPDATE
  SET "questionId" = EXCLUDED."questionId",
      "toState" = EXCLUDED."toState",
      "afterRowVersion" = EXCLUDED."afterRowVersion",
      "afterSnapshot" = EXCLUDED."afterSnapshot";
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "Question_capture_phase7_delta"
AFTER INSERT OR UPDATE ON "Question"
FOR EACH ROW EXECUTE FUNCTION "capture_phase7_operation_delta"();
CREATE TRIGGER "QuestionVersion_capture_phase7_delta"
AFTER INSERT OR UPDATE ON "QuestionVersion"
FOR EACH ROW EXECUTE FUNCTION "capture_phase7_operation_delta"();
CREATE TRIGGER "QuestionReport_capture_phase7_delta"
AFTER INSERT OR UPDATE ON "QuestionReport"
FOR EACH ROW EXECUTE FUNCTION "capture_phase7_operation_delta"();

CREATE FUNCTION "capture_phase7_version_child_delta"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  target_version_id UUID := CASE WHEN TG_OP = 'DELETE'
    THEN OLD."questionVersionId" ELSE NEW."questionVersionId" END;
  version_row "QuestionVersion"%ROWTYPE;
  operation_id UUID;
  snapshot JSONB;
BEGIN
  SELECT * INTO version_row FROM "QuestionVersion"
  WHERE "id" = target_version_id;
  IF version_row."createdByLabelSnapshot" = 'SYSTEM_SEED' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  operation_id := "phase7_current_operation_id"();
  IF NOT "phase7_operation_target_matches"(
    'QUESTION_VERSION', target_version_id, version_row."questionId", 'UPDATE'
  ) AND NOT EXISTS (
    SELECT 1
    FROM "Phase7OperationDelta" AS parent_delta
    WHERE parent_delta."operationId" = operation_id
      AND parent_delta."entityType" = 'QUESTION_VERSION'
      AND parent_delta."targetId" = target_version_id
      AND parent_delta."questionId" = version_row."questionId"
      AND parent_delta."mutation" = 'INSERT'
  ) THEN
    RAISE EXCEPTION 'Version child target was not locked by the operation manifest.'
      USING ERRCODE = '42501';
  END IF;
  snapshot := "phase7_question_version_audit_snapshot"(target_version_id);
  IF TG_WHEN = 'BEFORE' THEN
    INSERT INTO "Phase7OperationDelta" (
      "operationId", "entityType", "targetId", "questionId", "mutation",
      "fromState", "toState", "beforeRowVersion", "afterRowVersion",
      "beforeSnapshot", "afterSnapshot"
    ) VALUES (
      operation_id, 'QUESTION_VERSION', target_version_id,
      version_row."questionId", 'UPDATE', version_row."status"::TEXT,
      version_row."status"::TEXT, version_row."rowVersion",
      version_row."rowVersion", snapshot, snapshot
    ) ON CONFLICT ("operationId", "entityType", "targetId") DO NOTHING;
  ELSE
    UPDATE "Phase7OperationDelta"
    SET "afterSnapshot" = snapshot,
        "toState" = version_row."status"::TEXT,
        "afterRowVersion" = version_row."rowVersion"
    WHERE "operationId" = operation_id
      AND "entityType" = 'QUESTION_VERSION'
      AND "targetId" = target_version_id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

CREATE TRIGGER "QuestionOption_capture_phase7_delta_before"
BEFORE INSERT OR UPDATE OR DELETE ON "QuestionOption"
FOR EACH ROW EXECUTE FUNCTION "capture_phase7_version_child_delta"();
CREATE TRIGGER "QuestionOption_capture_phase7_delta_after"
AFTER INSERT OR UPDATE OR DELETE ON "QuestionOption"
FOR EACH ROW EXECUTE FUNCTION "capture_phase7_version_child_delta"();
CREATE TRIGGER "QuestionVersionTag_capture_phase7_delta_before"
BEFORE INSERT OR UPDATE OR DELETE ON "QuestionVersionTag"
FOR EACH ROW EXECUTE FUNCTION "capture_phase7_version_child_delta"();
CREATE TRIGGER "QuestionVersionTag_capture_phase7_delta_after"
AFTER INSERT OR UPDATE OR DELETE ON "QuestionVersionTag"
FOR EACH ROW EXECUTE FUNCTION "capture_phase7_version_child_delta"();

CREATE FUNCTION "phase7_jcs_string_array"(value JSONB)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
  SELECT '[' || COALESCE(string_agg(to_jsonb(item)::TEXT, ',' ORDER BY ordinal), '') || ']'
  FROM jsonb_array_elements_text(value) WITH ORDINALITY AS element(item, ordinal);
$function$;

CREATE FUNCTION "phase7_jcs_audit_metadata"(value JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
DECLARE
  kind TEXT := value->>'kind';
BEGIN
  CASE kind
    WHEN 'NONE_V1' THEN
      RETURN '{"kind":"NONE_V1"}';
    WHEN 'REVIEW_REQUEST_BATCH_V1' THEN
      RETURN '{"itemCount":' || (value->>'itemCount')
        || ',"kind":"REVIEW_REQUEST_BATCH_V1"}';
    WHEN 'IMPORT_APPLY_V1' THEN
      RETURN '{"itemCount":' || (value->>'itemCount')
        || ',"kind":"IMPORT_APPLY_V1","mappingDigest":'
        || to_jsonb(value->>'mappingDigest')::TEXT
        || ',"validationDigest":'
        || to_jsonb(value->>'validationDigest')::TEXT || '}';
    WHEN 'EXPORT_V1' THEN
      RETURN '{"kind":"EXPORT_V1","questionCount":'
        || (value->>'questionCount') || ',"responseBodyDigest":'
        || to_jsonb(value->>'responseBodyDigest')::TEXT
        || ',"selectionDigest":'
        || to_jsonb(value->>'selectionDigest')::TEXT
        || ',"versionCount":' || (value->>'versionCount') || '}';
    WHEN 'REAUTHENTICATION_V1' THEN
      RETURN '{"kind":"REAUTHENTICATION_V1","rotation":'
        || to_jsonb(value->>'rotation')::TEXT || '}';
    WHEN 'QUESTION_ARCHIVE_V1' THEN
      RETURN '{"abandonedCandidateCount":'
        || (value->>'abandonedCandidateCount')
        || ',"kind":"QUESTION_ARCHIVE_V1","retiredPublishedCount":'
        || (value->>'retiredPublishedCount') || '}';
    WHEN 'AUTHOR_ERASURE_V1' THEN
      RETURN '{"abandonedCount":' || (value->>'abandonedCount')
        || ',"kind":"AUTHOR_ERASURE_V1","subjectActorDigest":'
        || to_jsonb(value->>'subjectActorDigest')::TEXT || '}';
  END CASE;
  RAISE EXCEPTION 'Unsupported audit metadata kind.' USING ERRCODE = '23514';
END;
$function$;

CREATE FUNCTION "phase7_admin_audit_content_digest"(
  operation_id UUID,
  command_value "AdminAuditCommand",
  target_type_value "AdminAuditTargetType",
  target_id_value UUID,
  before_state_value TEXT,
  after_state_value TEXT,
  before_row_version_value INTEGER,
  after_row_version_value INTEGER,
  changed_fields_value JSONB,
  metadata_value JSONB
)
RETURNS VARCHAR(64)
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT encode(public.digest(convert_to(
    '{"afterRowVersion":' || COALESCE(after_row_version_value::TEXT, 'null')
    || ',"afterState":' || COALESCE(to_jsonb(after_state_value)::TEXT, 'null')
    || ',"beforeRowVersion":' || COALESCE(before_row_version_value::TEXT, 'null')
    || ',"beforeState":' || COALESCE(to_jsonb(before_state_value)::TEXT, 'null')
    || ',"changedFields":' || "phase7_jcs_string_array"(changed_fields_value)
    || ',"command":' || to_jsonb(command_value::TEXT)::TEXT
    || ',"metadata":' || "phase7_jcs_audit_metadata"(metadata_value)
    || ',"operationId":' || to_jsonb(operation_id::TEXT)::TEXT
    || ',"targetId":' || to_jsonb(target_id_value::TEXT)::TEXT
    || ',"targetType":' || to_jsonb(target_type_value::TEXT)::TEXT || '}',
    'UTF8'
  ), 'sha256'::TEXT), 'hex');
$function$;

CREATE FUNCTION "validate_phase7_evidence_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  intent "Phase7OperationIntent"%ROWTYPE;
  version_row "QuestionVersion"%ROWTYPE;
  latest_approver "ContentReview"%ROWTYPE;
BEGIN
  SELECT * INTO intent FROM "Phase7OperationIntent"
  WHERE "operationId" = "phase7_current_operation_id"();

  IF NEW."operationId" IS DISTINCT FROM intent."operationId"
    OR NEW."requestId" IS DISTINCT FROM intent."requestId"
    OR NEW."occurredAt" IS DISTINCT FROM intent."occurredAt" THEN
    RAISE EXCEPTION 'Evidence must share trusted operation identity and time.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'AdminAuditLog' THEN
    IF NEW."targetType" IN (
      'REVIEW_REQUEST_BATCH','IMPORT_REQUEST','EXPORT_REQUEST',
      'ADMIN_SESSION','USER_ERASURE'
    ) AND NEW."targetId" IS DISTINCT FROM NEW."operationId" THEN
      RAISE EXCEPTION 'Request-scoped audit targetId must equal operationId.'
        USING ERRCODE = '23514';
    END IF;
    IF (NEW."command" IS DISTINCT FROM intent."command"
      AND NOT (
        intent."command" IN ('REVIEW_REQUEST_BATCH','IMPORT_APPLY')
        AND NEW."command" IN ('REVIEW_REQUEST','QUESTION_CREATE')
      ))
      OR NEW."environment" IS DISTINCT FROM intent."environment" THEN
      RAISE EXCEPTION 'Audit command/environment does not match operation intent.'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."contentDigest" IS DISTINCT FROM
      "phase7_admin_audit_content_digest"(
        NEW."operationId", NEW."command", NEW."targetType", NEW."targetId",
        NEW."beforeState", NEW."afterState", NEW."beforeRowVersion",
        NEW."afterRowVersion", NEW."changedFields", NEW."metadata"
      ) THEN
      RAISE EXCEPTION 'Audit contentDigest does not match its canonical preimage.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF intent."actorUserId" IS NOT NULL THEN
    IF NEW."actorKind" IS DISTINCT FROM 'ACCOUNT'
      OR NEW."actorUserId" IS DISTINCT FROM intent."actorUserId"
      OR NEW."actorId" IS DISTINCT FROM intent."actorUserId"
      OR NEW."actorRole" IS DISTINCT FROM 'ADMIN'
      OR NEW."actorLabel" IS DISTINCT FROM 'ACTIVE_ADMIN'
      OR NOT "phase7_operation_references_user"(NEW."actorUserId") THEN
      RAISE EXCEPTION 'Evidence actor does not match the locked ADMIN.'
        USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM "User" AS actor
    WHERE actor."id" = intent."actorUserId"
      AND actor."role" = 'ADMIN'
      AND actor."accountStatus" = 'ACTIVE'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Evidence actor lost active ADMIN authority.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW."actorKind" IS DISTINCT FROM 'SYSTEM'
    OR NEW."actorUserId" IS NOT NULL OR NEW."actorId" IS NOT NULL
    OR NEW."actorRole" IS DISTINCT FROM 'SYSTEM'
    OR NEW."actorSystemLabel" IS DISTINCT FROM 'ACCOUNT_ERASURE'
    OR intent."command" IS DISTINCT FROM 'AUTHOR_ERASURE_ABANDON' THEN
    RAISE EXCEPTION 'Actorless operation evidence must be owned erasure SYSTEM evidence.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'ContentReview' THEN
    SELECT * INTO version_row FROM "QuestionVersion"
    WHERE "id" = NEW."questionVersionId"
      AND "questionId" = NEW."questionId"
    FOR SHARE;
    IF version_row."id" IS NULL THEN
      RAISE EXCEPTION 'ContentReview target version is missing.'
        USING ERRCODE = '23503';
    END IF;

    IF version_row."createdByUserId" IS NOT NULL
      AND NOT "phase7_operation_references_user"(
        version_row."createdByUserId"
      ) THEN
      RAISE EXCEPTION 'ContentReview author was not prelocked by the operation.'
        USING ERRCODE = '42501';
    END IF;

    IF NEW."counterpartLabel" = 'ACTIVE_ADMIN' THEN
      IF NOT "phase7_operation_references_user"(NEW."counterpartUserId") THEN
        RAISE EXCEPTION 'ContentReview counterpart was not prelocked.'
          USING ERRCODE = '42501';
      END IF;
    ELSIF NEW."counterpartLabel" = 'DELETED_ADMIN' THEN
      IF NEW."counterpartUserId" IS NOT NULL THEN
        RAISE EXCEPTION 'Deleted counterpart cannot retain a live User FK.'
          USING ERRCODE = '23514';
      END IF;
      IF NEW."action" <> 'PUBLISHED' AND (
        NOT "phase7_trusted_execution_active"('ERASURE')
        OR NEW."counterpartActorId" IS DISTINCT FROM
          "phase7_trusted_execution_target"('ERASURE')
      ) THEN
        RAISE EXCEPTION 'New deleted counterpart snapshot requires matching erasure.'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    IF NEW."action" = 'REQUESTED' THEN
      IF NEW."actorId" IS DISTINCT FROM version_row."createdByActorId"
        OR NEW."actorUserId" IS DISTINCT FROM version_row."createdByUserId"
        OR NEW."counterpartActorId" IS NOT NULL THEN
        RAISE EXCEPTION 'Review request must be authored by the version author.'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NEW."action" IN (
      'CHANGES_REQUESTED','APPROVED','APPROVAL_WITHDRAWN','ARCHIVE_ABANDONED',
      'AUTHOR_ERASURE_ABANDONED'
    ) THEN
      IF NEW."counterpartActorId" IS DISTINCT FROM version_row."createdByActorId"
        OR NEW."counterpartUserId" IS DISTINCT FROM version_row."createdByUserId"
        OR NEW."counterpartRole" IS DISTINCT FROM version_row."createdByRoleSnapshot"
        OR NEW."counterpartLabel"::TEXT IS DISTINCT FROM
          version_row."createdByLabelSnapshot"::TEXT THEN
        RAISE EXCEPTION 'ContentReview author counterpart snapshot is not exact.'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NEW."action" = 'PUBLISHED' THEN
      SELECT * INTO latest_approver
      FROM "ContentReview" AS review
      WHERE review."questionVersionId" = NEW."questionVersionId"
        AND review."action" = 'APPROVED'
      ORDER BY review."occurredAt" DESC, review."id" DESC
      LIMIT 1;
      IF latest_approver."id" IS NULL
        OR NEW."counterpartUserId" IS DISTINCT FROM latest_approver."actorUserId"
        OR NEW."counterpartActorId" IS DISTINCT FROM latest_approver."actorId"
        OR NEW."counterpartRole"::TEXT IS DISTINCT FROM latest_approver."actorRole"::TEXT
        OR NEW."counterpartLabel" IS DISTINCT FROM latest_approver."actorLabel" THEN
        RAISE EXCEPTION 'Publication counterpart is not the latest approver.'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NEW."action" = 'RETIRED' AND NEW."counterpartActorId" IS NOT NULL THEN
      RAISE EXCEPTION 'Published retirement cannot name a counterpart.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "ContentReview_validate_insert"
BEFORE INSERT ON "ContentReview"
FOR EACH ROW EXECUTE FUNCTION "validate_phase7_evidence_insert"();
CREATE TRIGGER "AdminAuditLog_validate_insert"
BEFORE INSERT ON "AdminAuditLog"
FOR EACH ROW EXECUTE FUNCTION "validate_phase7_evidence_insert"();

CREATE FUNCTION "protect_phase7_evidence_history"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  erasure_mode BOOLEAN := "phase7_trusted_execution_active"('ERASURE');
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Phase 7 evidence delete is forbidden.'
      USING ERRCODE = '23514';
  END IF;
  IF NOT erasure_mode THEN
    RAISE EXCEPTION 'Phase 7 evidence is append-only.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'ContentReview' AND (
    to_jsonb(NEW)
      - 'actorUserId' - 'actorLabel'
      - 'counterpartUserId' - 'counterpartLabel'
  ) <> (
    to_jsonb(OLD)
      - 'actorUserId' - 'actorLabel'
      - 'counterpartUserId' - 'counterpartLabel'
  ) THEN
    RAISE EXCEPTION 'ContentReview erasure tombstone changed immutable evidence.'
      USING ERRCODE = '23514';
  ELSIF TG_TABLE_NAME = 'AdminAuditLog' AND (
    to_jsonb(NEW) - 'actorUserId' - 'actorLabel'
  ) <> (
    to_jsonb(OLD) - 'actorUserId' - 'actorLabel'
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog erasure tombstone changed immutable evidence.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "ContentReview_protect_history"
BEFORE UPDATE OR DELETE ON "ContentReview"
FOR EACH ROW EXECUTE FUNCTION "protect_phase7_evidence_history"();
CREATE TRIGGER "AdminAuditLog_protect_history"
BEFORE UPDATE OR DELETE ON "AdminAuditLog"
FOR EACH ROW EXECUTE FUNCTION "protect_phase7_evidence_history"();

CREATE FUNCTION "phase7_question_version_changed_fields"(
  before_snapshot JSONB,
  after_snapshot JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
DECLARE
  result JSONB := '[]'::JSONB;
BEGIN
  IF before_snapshot->'level' IS DISTINCT FROM after_snapshot->'level' THEN
    result := result || '["LEVEL"]'::JSONB;
  END IF;
  IF before_snapshot->'subject' IS DISTINCT FROM after_snapshot->'subject' THEN
    result := result || '["SUBJECT"]'::JSONB;
  END IF;
  IF before_snapshot->'questionType' IS DISTINCT FROM after_snapshot->'questionType' THEN
    result := result || '["QUESTION_TYPE"]'::JSONB;
  END IF;
  IF before_snapshot->'difficulty' IS DISTINCT FROM after_snapshot->'difficulty' THEN
    result := result || '["DIFFICULTY"]'::JSONB;
  END IF;
  IF before_snapshot->'passage' IS DISTINCT FROM after_snapshot->'passage' THEN
    result := result || '["PASSAGE"]'::JSONB;
  END IF;
  IF before_snapshot->'questionText' IS DISTINCT FROM after_snapshot->'questionText' THEN
    result := result || '["QUESTION_TEXT"]'::JSONB;
  END IF;
  IF before_snapshot->'explanationKo' IS DISTINCT FROM after_snapshot->'explanationKo' THEN
    result := result || '["EXPLANATION_KO"]'::JSONB;
  END IF;
  IF before_snapshot->'explanationJa' IS DISTINCT FROM after_snapshot->'explanationJa' THEN
    result := result || '["EXPLANATION_JA"]'::JSONB;
  END IF;
  IF before_snapshot->'options' IS DISTINCT FROM after_snapshot->'options' THEN
    result := result || '["OPTIONS"]'::JSONB;
  END IF;
  IF before_snapshot->'correctOptionId' IS DISTINCT FROM after_snapshot->'correctOptionId' THEN
    result := result || '["CORRECT_OPTION"]'::JSONB;
  END IF;
  IF before_snapshot->'tags' IS DISTINCT FROM after_snapshot->'tags' THEN
    result := result || '["TAGS"]'::JSONB;
  END IF;
  RETURN result;
END;
$function$;

CREATE FUNCTION "phase7_verify_operation_manifest"(operation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  intent "Phase7OperationIntent"%ROWTYPE;
  empty_ids UUID[] := ARRAY[]::UUID[];
  manifest_question_ids UUID[];
  manifest_version_ids UUID[];
  manifest_report_ids UUID[];
  manifest_tag_ids UUID[];
  manifest_version_question_ids UUID[];
  question_delta_ids UUID[];
  version_delta_ids UUID[];
  report_delta_ids UUID[];
  version_delta_question_ids UUID[];
  report_delta_question_ids UUID[];
  report_live_version_ids UUID[];
  after_tag_ids UUID[];
BEGIN
  SELECT operation_intent.* INTO intent
  FROM "Phase7OperationIntent" AS operation_intent
  WHERE operation_intent."operationId" = operation_id
    AND operation_intent."backendPid" = pg_backend_pid()
    AND operation_intent."transactionId" = txid_current();
  IF intent."operationId" IS NULL THEN
    RAISE EXCEPTION 'Phase 7 operation manifest is unavailable.'
      USING ERRCODE = '42501';
  END IF;
  IF intent."command" IN ('REAUTHENTICATION', 'AUTHOR_ERASURE_ABANDON') THEN
    IF intent."targetManifest" IS NOT NULL THEN
      RAISE EXCEPTION 'Owned operation cannot carry an admin target manifest.'
        USING ERRCODE = '23514';
    END IF;
    RETURN;
  END IF;
  IF intent."targetManifest" IS NULL THEN
    RAISE EXCEPTION 'Armed Phase 7 operation requires a target manifest.'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY id), empty_ids)
  INTO manifest_question_ids
  FROM (
    SELECT DISTINCT (item.value->>'id')::UUID AS id
    FROM jsonb_array_elements(
      intent."targetManifest"->'questions'
    ) AS item(value)
  ) AS targets;
  SELECT COALESCE(array_agg(id ORDER BY id), empty_ids)
  INTO manifest_version_ids
  FROM (
    SELECT DISTINCT (item.value->>'id')::UUID AS id
    FROM jsonb_array_elements(
      intent."targetManifest"->'versions'
    ) AS item(value)
  ) AS targets;
  SELECT COALESCE(array_agg(id ORDER BY id), empty_ids)
  INTO manifest_report_ids
  FROM (
    SELECT DISTINCT (item.value->>'id')::UUID AS id
    FROM jsonb_array_elements(
      intent."targetManifest"->'reports'
    ) AS item(value)
  ) AS targets;
  SELECT COALESCE(array_agg(id ORDER BY id), empty_ids)
  INTO manifest_tag_ids
  FROM (
    SELECT DISTINCT (item.value #>> '{}')::UUID AS id
    FROM jsonb_array_elements(intent."targetManifest"->'tags') AS item(value)
  ) AS targets;

  SELECT COALESCE(array_agg(id ORDER BY id), empty_ids)
  INTO question_delta_ids
  FROM (
    SELECT DISTINCT delta."targetId" AS id
    FROM "Phase7OperationDelta" AS delta
    WHERE delta."operationId" = operation_id
      AND delta."entityType" = 'QUESTION'
  ) AS targets;
  SELECT COALESCE(array_agg(id ORDER BY id), empty_ids)
  INTO version_delta_ids
  FROM (
    SELECT DISTINCT delta."targetId" AS id
    FROM "Phase7OperationDelta" AS delta
    WHERE delta."operationId" = operation_id
      AND delta."entityType" = 'QUESTION_VERSION'
  ) AS targets;
  SELECT COALESCE(array_agg(id ORDER BY id), empty_ids)
  INTO report_delta_ids
  FROM (
    SELECT DISTINCT delta."targetId" AS id
    FROM "Phase7OperationDelta" AS delta
    WHERE delta."operationId" = operation_id
      AND delta."entityType" = 'QUESTION_REPORT'
  ) AS targets;
  SELECT COALESCE(array_agg(id ORDER BY id), empty_ids)
  INTO version_delta_question_ids
  FROM (
    SELECT DISTINCT delta."questionId" AS id
    FROM "Phase7OperationDelta" AS delta
    WHERE delta."operationId" = operation_id
      AND delta."entityType" = 'QUESTION_VERSION'
      AND delta."questionId" IS NOT NULL
  ) AS targets;
  SELECT COALESCE(array_agg(id ORDER BY id), empty_ids)
  INTO report_delta_question_ids
  FROM (
    SELECT DISTINCT delta."questionId" AS id
    FROM "Phase7OperationDelta" AS delta
    WHERE delta."operationId" = operation_id
      AND delta."entityType" = 'QUESTION_REPORT'
      AND delta."questionId" IS NOT NULL
  ) AS targets;
  SELECT COALESCE(array_agg(id ORDER BY id), empty_ids)
  INTO manifest_version_question_ids
  FROM (
    SELECT DISTINCT version."questionId" AS id
    FROM "QuestionVersion" AS version
    WHERE version."id" = ANY (manifest_version_ids)
  ) AS targets;
  SELECT COALESCE(array_agg(id ORDER BY id), empty_ids)
  INTO report_live_version_ids
  FROM (
    SELECT DISTINCT
      (delta."afterSnapshot"->>'questionVersionId')::UUID AS id
    FROM "Phase7OperationDelta" AS delta
    WHERE delta."operationId" = operation_id
      AND delta."entityType" = 'QUESTION_REPORT'
    UNION
    SELECT DISTINCT
      (delta."afterSnapshot"->>'remediationVersionId')::UUID AS id
    FROM "Phase7OperationDelta" AS delta
    WHERE delta."operationId" = operation_id
      AND delta."entityType" = 'QUESTION_REPORT'
      AND delta."afterSnapshot"->>'remediationVersionId' IS NOT NULL
  ) AS targets;
  SELECT COALESCE(array_agg(id ORDER BY id), empty_ids)
  INTO after_tag_ids
  FROM (
    SELECT DISTINCT (tag.value->>'tagId')::UUID AS id
    FROM "Phase7OperationDelta" AS delta
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(delta."afterSnapshot"->'tags', '[]'::JSONB)
    ) AS tag(value)
    WHERE delta."operationId" = operation_id
      AND delta."entityType" = 'QUESTION_VERSION'
  ) AS targets;

  -- Every UPDATE must prove the exact optimistic precondition captured while
  -- the same target row was locked by arm(). INSERT targets are generated by
  -- the three explicitly enumerated create/import command families below.
  IF EXISTS (
    SELECT 1
    FROM "Phase7OperationDelta" AS delta
    WHERE delta."operationId" = operation_id
      AND delta."mutation" = 'UPDATE'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          intent."targetManifest"->(CASE delta."entityType"
            WHEN 'QUESTION' THEN 'questions'
            WHEN 'QUESTION_VERSION' THEN 'versions'
            WHEN 'QUESTION_REPORT' THEN 'reports'
          END)
        ) AS item(value)
        WHERE (item.value->>'id')::UUID = delta."targetId"
          AND (item.value->>'rowVersion')::INTEGER
            IS NOT DISTINCT FROM delta."beforeRowVersion"
          AND item.value->>'state' IS NOT DISTINCT FROM delta."fromState"
      )
  ) THEN
    RAISE EXCEPTION 'Domain delta does not match its armed target precondition.'
      USING ERRCODE = '23514';
  END IF;

  CASE intent."command"
    WHEN 'QUESTION_CREATE' THEN
      IF question_delta_ids <> version_delta_question_ids
        OR EXISTS (
          SELECT 1 FROM "Phase7OperationDelta" AS delta
          WHERE delta."operationId" = operation_id
            AND delta."mutation" <> 'INSERT'
        ) THEN
        RAISE EXCEPTION 'QUESTION_CREATE generated target set is not exact.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'QUESTION_VERSION_CREATE' THEN
      IF question_delta_ids <> manifest_question_ids
        OR version_delta_question_ids <> manifest_question_ids
        OR EXISTS (
          SELECT 1 FROM "Phase7OperationDelta" AS delta
          WHERE delta."operationId" = operation_id
            AND (delta."entityType" = 'QUESTION'
              AND delta."mutation" <> 'UPDATE'
              OR delta."entityType" = 'QUESTION_VERSION'
              AND delta."mutation" <> 'INSERT')
        ) THEN
        RAISE EXCEPTION 'QUESTION_VERSION_CREATE target set is not exact.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'QUESTION_VERSION_UPDATE', 'REVIEW_REQUEST', 'CHANGE_REQUEST',
      'APPROVAL', 'APPROVAL_WITHDRAWAL' THEN
      IF version_delta_ids <> manifest_version_ids
        OR version_delta_question_ids <> manifest_question_ids THEN
        RAISE EXCEPTION 'Single-version operation target set is not exact.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'PUBLICATION', 'RETIREMENT', 'QUESTION_ARCHIVE' THEN
      IF question_delta_ids <> manifest_question_ids
        OR version_delta_ids <> manifest_version_ids
        OR version_delta_question_ids <> manifest_question_ids THEN
        RAISE EXCEPTION 'Aggregate lifecycle target set is not exact.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'REVIEW_REQUEST_BATCH' THEN
      IF version_delta_ids <> manifest_version_ids
        OR version_delta_question_ids <> manifest_question_ids THEN
        RAISE EXCEPTION 'REVIEW_REQUEST_BATCH target set is not exact.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'IMPORT_APPLY' THEN
      IF question_delta_ids <> version_delta_question_ids
        OR EXISTS (
          SELECT 1 FROM "Phase7OperationDelta" AS delta
          WHERE delta."operationId" = operation_id
            AND delta."mutation" <> 'INSERT'
        ) THEN
        RAISE EXCEPTION 'IMPORT_APPLY generated target set is not exact.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'EXPORT' THEN
      IF manifest_question_ids <> manifest_version_question_ids THEN
        RAISE EXCEPTION 'EXPORT Question/version manifest is not exact.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'REPORT_TRIAGE', 'REPORT_RESOLUTION' THEN
      IF report_delta_ids <> manifest_report_ids
        OR report_delta_question_ids <> manifest_question_ids
        OR report_live_version_ids <> manifest_version_ids THEN
        RAISE EXCEPTION 'QuestionReport operation target set is not exact.'
          USING ERRCODE = '23514';
      END IF;
  END CASE;

  IF intent."command" IN (
    'QUESTION_CREATE', 'QUESTION_VERSION_CREATE',
    'QUESTION_VERSION_UPDATE', 'IMPORT_APPLY'
  ) AND after_tag_ids <> manifest_tag_ids THEN
    RAISE EXCEPTION 'Content mutation Tag set is not exact.'
      USING ERRCODE = '23514';
  END IF;

  IF intent."command" = 'EXPORT' AND EXISTS (
    SELECT 1
    FROM "AdminAuditLog" AS audit
    WHERE audit."operationId" = operation_id
      AND audit."command" = 'EXPORT'
      AND ((audit."metadata"->>'questionCount')::INTEGER
          <> cardinality(manifest_question_ids)
        OR (audit."metadata"->>'versionCount')::INTEGER
          <> cardinality(manifest_version_ids))
  ) THEN
    RAISE EXCEPTION 'EXPORT metadata does not match the locked manifest.'
      USING ERRCODE = '23514';
  END IF;
END;
$function$;

CREATE FUNCTION "phase7_finish_admin_operation"(operation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  intent "Phase7OperationIntent"%ROWTYPE;
  question_delta_count INTEGER;
  version_delta_count INTEGER;
  report_delta_count INTEGER;
  review_count INTEGER;
  audit_count INTEGER;
  matching_audit_count INTEGER;
  expected_archive_fields JSONB;
  archive_retired_count INTEGER;
  archive_abandoned_count INTEGER;
  authority_commit_checked_at TIMESTAMPTZ(3);
BEGIN
  SELECT * INTO intent FROM "Phase7OperationIntent"
  WHERE "operationId" = operation_id
    AND "backendPid" = pg_backend_pid()
    AND "transactionId" = txid_current()
  FOR UPDATE;
  IF intent."operationId" IS NULL THEN
    RAISE EXCEPTION 'Trusted Phase 7 operation is absent.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM "phase7_require_caller_role"(
    CASE intent."command"
      WHEN 'REAUTHENTICATION' THEN 'nihongo_auth_gateway'
      WHEN 'AUTHOR_ERASURE_ABANDON' THEN 'nihongo_erasure_worker'
      ELSE 'nihongo_app'
    END
  );

  SELECT COUNT(*) FILTER (WHERE "entityType" = 'QUESTION'),
    COUNT(*) FILTER (WHERE "entityType" = 'QUESTION_VERSION'),
    COUNT(*) FILTER (WHERE "entityType" = 'QUESTION_REPORT')
  INTO question_delta_count, version_delta_count, report_delta_count
  FROM "Phase7OperationDelta" WHERE "operationId" = operation_id;
  SELECT COUNT(*) INTO review_count FROM "ContentReview"
    WHERE "operationId" = operation_id;
  SELECT COUNT(*) INTO audit_count FROM "AdminAuditLog"
    WHERE "operationId" = operation_id;
  SELECT COUNT(*) INTO matching_audit_count FROM "AdminAuditLog"
    WHERE "operationId" = operation_id AND "command" = intent."command";

  PERFORM "phase7_verify_operation_manifest"(operation_id);

  CASE intent."command"
    WHEN 'QUESTION_CREATE' THEN
      IF question_delta_count <> 1 OR version_delta_count <> 1
        OR report_delta_count <> 0 OR review_count <> 0
        OR audit_count <> 1 OR matching_audit_count <> 1 THEN
        RAISE EXCEPTION 'QUESTION_CREATE evidence cardinality mismatch.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'QUESTION_VERSION_CREATE' THEN
      IF question_delta_count <> 1 OR version_delta_count <> 1
        OR report_delta_count <> 0 OR review_count <> 0
        OR audit_count <> 1 OR matching_audit_count <> 1 THEN
        RAISE EXCEPTION 'QUESTION_VERSION_CREATE evidence cardinality mismatch.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'QUESTION_VERSION_UPDATE' THEN
      IF question_delta_count <> 0 OR version_delta_count <> 1
        OR report_delta_count <> 0 OR review_count <> 0
        OR audit_count <> 1 OR matching_audit_count <> 1 THEN
        RAISE EXCEPTION 'QUESTION_VERSION_UPDATE evidence cardinality mismatch.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'REVIEW_REQUEST', 'CHANGE_REQUEST', 'APPROVAL', 'APPROVAL_WITHDRAWAL' THEN
      IF question_delta_count <> 0 OR version_delta_count <> 1
        OR report_delta_count <> 0 OR review_count <> 1
        OR audit_count <> 1 OR matching_audit_count <> 1 THEN
        RAISE EXCEPTION 'Review operation evidence cardinality mismatch.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'PUBLICATION' THEN
      IF question_delta_count <> 1 OR version_delta_count NOT BETWEEN 1 AND 2
        OR report_delta_count <> 0 OR review_count <> version_delta_count
        OR audit_count <> 1 OR matching_audit_count <> 1 THEN
        RAISE EXCEPTION 'PUBLICATION evidence cardinality mismatch.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'RETIREMENT' THEN
      IF question_delta_count <> 1 OR version_delta_count <> 1
        OR report_delta_count <> 0 OR review_count <> 1
        OR audit_count <> 1 OR matching_audit_count <> 1 THEN
        RAISE EXCEPTION 'RETIREMENT evidence cardinality mismatch.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'QUESTION_ARCHIVE' THEN
      IF question_delta_count <> 1 OR version_delta_count NOT BETWEEN 0 AND 2
        OR report_delta_count <> 0 OR review_count <> version_delta_count
        OR audit_count <> 1 OR matching_audit_count <> 1 THEN
        RAISE EXCEPTION 'QUESTION_ARCHIVE evidence cardinality mismatch.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'REVIEW_REQUEST_BATCH' THEN
      IF question_delta_count <> 0 OR version_delta_count NOT BETWEEN 1 AND 20
        OR report_delta_count <> 0 OR review_count <> version_delta_count
        OR audit_count <> version_delta_count + 1
        OR matching_audit_count <> 1 THEN
        RAISE EXCEPTION 'REVIEW_REQUEST_BATCH evidence cardinality mismatch.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'IMPORT_APPLY' THEN
      IF question_delta_count NOT BETWEEN 1 AND 100
        OR version_delta_count <> question_delta_count
        OR report_delta_count <> 0 OR review_count <> 0
        OR audit_count <> question_delta_count + 1
        OR matching_audit_count <> 1 THEN
        RAISE EXCEPTION 'IMPORT_APPLY evidence cardinality mismatch.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'EXPORT', 'REAUTHENTICATION' THEN
      IF question_delta_count <> 0 OR version_delta_count <> 0
        OR report_delta_count <> 0 OR review_count <> 0
        OR audit_count <> 1 OR matching_audit_count <> 1 THEN
        RAISE EXCEPTION 'Request-only evidence cardinality mismatch.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'REPORT_TRIAGE', 'REPORT_RESOLUTION' THEN
      IF question_delta_count <> 0 OR version_delta_count <> 0
        OR report_delta_count <> 1 OR review_count <> 0
        OR audit_count <> 1 OR matching_audit_count <> 1 THEN
        RAISE EXCEPTION 'QuestionReport evidence cardinality mismatch.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'AUTHOR_ERASURE_ABANDON' THEN
      IF review_count <> (
        SELECT COUNT(*) FROM "Phase7OperationDelta"
        WHERE "operationId" = operation_id AND "entityType" = 'QUESTION_VERSION'
          AND "toState" = 'RETIRED' AND "fromState" <> 'RETIRED'
      ) OR audit_count <> (
        CASE WHEN review_count > 0 THEN review_count + 1 ELSE 0 END
      ) THEN
        RAISE EXCEPTION 'AUTHOR_ERASURE_ABANDON evidence cardinality mismatch.'
          USING ERRCODE = '23514';
      END IF;
  END CASE;

  IF intent."command" = 'QUESTION_VERSION_UPDATE' THEN
    PERFORM 1
    FROM "Phase7OperationDelta" AS delta
    JOIN "QuestionVersion" AS version
      ON version."id" = delta."targetId"
     AND version."questionId" = delta."questionId"
    JOIN "User" AS author
      ON author."id" = version."createdByUserId"
     AND author."id" = version."createdByActorId"
    WHERE delta."operationId" = operation_id
      AND delta."entityType" = 'QUESTION_VERSION'
      AND version."createdByUserId" = intent."actorUserId"
      AND version."createdByRoleSnapshot" = 'ADMIN'
      AND version."createdByLabelSnapshot" = 'ACTIVE_ADMIN'
      AND author."role" = 'ADMIN'
      AND author."accountStatus" = 'ACTIVE'
    FOR SHARE OF version, author;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'QuestionVersion content updates require the locked live author.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF intent."command" = 'PUBLICATION' AND EXISTS (
    SELECT 1
    FROM "Phase7OperationDelta" AS delta
    JOIN "ContentReview" AS review
      ON review."operationId" = delta."operationId"
     AND review."questionVersionId" = delta."targetId"
     AND review."questionId" = delta."questionId"
    WHERE delta."operationId" = operation_id
      AND delta."entityType" = 'QUESTION_VERSION'
      AND (
        delta."fromState" = 'APPROVED' AND delta."toState" = 'PUBLISHED'
        AND (review."action" <> 'PUBLISHED' OR review."reason" IS NOT NULL)
        OR delta."fromState" = 'PUBLISHED' AND delta."toState" = 'RETIRED'
        AND (review."action" <> 'RETIRED'
          OR review."reason" <> 'PUBLISHED_REPLACEMENT')
      )
  ) THEN
    RAISE EXCEPTION 'PUBLICATION review action/reason does not match its version delta.'
      USING ERRCODE = '23514';
  END IF;

  IF intent."command" = 'RETIREMENT' AND EXISTS (
    SELECT 1 FROM "ContentReview" AS review
    WHERE review."operationId" = operation_id
      AND (review."action" <> 'RETIRED'
        OR review."reason" <> 'PUBLISHED_RETIREMENT')
  ) THEN
    RAISE EXCEPTION 'RETIREMENT review reason must be PUBLISHED_RETIREMENT.'
      USING ERRCODE = '23514';
  END IF;

  IF intent."command" = 'QUESTION_ARCHIVE' AND EXISTS (
    SELECT 1
    FROM "Phase7OperationDelta" AS delta
    JOIN "ContentReview" AS review
      ON review."operationId" = delta."operationId"
     AND review."questionVersionId" = delta."targetId"
     AND review."questionId" = delta."questionId"
    WHERE delta."operationId" = operation_id
      AND delta."entityType" = 'QUESTION_VERSION'
      AND (
        delta."fromState" = 'PUBLISHED'
        AND (review."action" <> 'RETIRED'
          OR review."reason" <> 'QUESTION_ARCHIVE')
        OR delta."fromState" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
        AND (review."action" <> 'ARCHIVE_ABANDONED'
          OR review."reason" <> 'QUESTION_ARCHIVE')
      )
  ) THEN
    RAISE EXCEPTION 'QUESTION_ARCHIVE review action/reason does not match its version delta.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Phase7OperationDelta" AS delta
    JOIN "Question" AS question ON question."id" = delta."targetId"
    WHERE delta."operationId" = operation_id
      AND delta."entityType" = 'QUESTION'
      AND (
        question."updatedAt" IS DISTINCT FROM intent."occurredAt"
        OR delta."mutation" = 'INSERT'
          AND question."createdAt" IS DISTINCT FROM intent."occurredAt"
        OR intent."command" = 'QUESTION_ARCHIVE'
          AND question."archivedAt" IS DISTINCT FROM intent."occurredAt"
      )
  ) OR EXISTS (
    SELECT 1
    FROM "Phase7OperationDelta" AS delta
    JOIN "QuestionVersion" AS version ON version."id" = delta."targetId"
    WHERE delta."operationId" = operation_id
      AND delta."entityType" = 'QUESTION_VERSION'
      AND (
        version."updatedAt" IS DISTINCT FROM intent."occurredAt"
        OR delta."mutation" = 'INSERT'
          AND version."createdAt" IS DISTINCT FROM intent."occurredAt"
        OR delta."toState" = 'PUBLISHED' AND delta."fromState" <> 'PUBLISHED'
          AND version."publishedAt" IS DISTINCT FROM intent."occurredAt"
        OR delta."toState" = 'RETIRED' AND delta."fromState" <> 'RETIRED'
          AND version."retiredAt" IS DISTINCT FROM intent."occurredAt"
      )
  ) OR EXISTS (
    SELECT 1
    FROM "Phase7OperationDelta" AS delta
    JOIN "QuestionReport" AS report ON report."id" = delta."targetId"
    WHERE delta."operationId" = operation_id
      AND delta."entityType" = 'QUESTION_REPORT'
      AND (
        report."updatedAt" IS DISTINCT FROM intent."occurredAt"
        OR intent."command" = 'REPORT_RESOLUTION'
          AND report."resolvedAt" IS DISTINCT FROM intent."occurredAt"
      )
  ) THEN
    RAISE EXCEPTION 'Domain timestamps must equal the operation occurredAt.'
      USING ERRCODE = '23514';
  END IF;

  IF intent."command" = 'QUESTION_VERSION_UPDATE' AND EXISTS (
    SELECT 1
    FROM "Phase7OperationDelta" AS delta
    JOIN "AdminAuditLog" AS audit
      ON audit."operationId" = delta."operationId"
     AND audit."targetType" = 'QUESTION_VERSION'
     AND audit."targetId" = delta."targetId"
    WHERE delta."operationId" = operation_id
      AND delta."entityType" = 'QUESTION_VERSION'
      AND audit."changedFields" IS DISTINCT FROM
        "phase7_question_version_changed_fields"(
          delta."beforeSnapshot", delta."afterSnapshot"
        )
  ) THEN
    RAISE EXCEPTION 'QUESTION_VERSION_UPDATE changedFields do not match OLD/NEW content.'
      USING ERRCODE = '23514';
  END IF;

  IF intent."command" IN (
      'REVIEW_REQUEST','CHANGE_REQUEST','APPROVAL','APPROVAL_WITHDRAWAL',
      'PUBLICATION','RETIREMENT','QUESTION_ARCHIVE','REVIEW_REQUEST_BATCH',
      'AUTHOR_ERASURE_ABANDON'
    ) AND EXISTS (
      SELECT 1 FROM "Phase7OperationDelta" AS delta
      WHERE delta."operationId" = operation_id
        AND delta."entityType" = 'QUESTION_VERSION'
        AND delta."beforeSnapshot" IS DISTINCT FROM delta."afterSnapshot"
    ) THEN
    RAISE EXCEPTION 'Lifecycle command smuggled QuestionVersion content changes.'
      USING ERRCODE = '23514';
  END IF;

  IF intent."command" = 'REVIEW_REQUEST_BATCH' AND EXISTS (
    SELECT 1 FROM "AdminAuditLog" AS audit
    WHERE audit."operationId" = operation_id
      AND audit."command" = 'REVIEW_REQUEST_BATCH'
      AND (audit."metadata"->>'itemCount')::INTEGER <> version_delta_count
  ) THEN
    RAISE EXCEPTION 'REVIEW_REQUEST_BATCH metadata count does not match targets.'
      USING ERRCODE = '23514';
  END IF;

  IF intent."command" = 'IMPORT_APPLY' AND EXISTS (
    SELECT 1 FROM "AdminAuditLog" AS audit
    WHERE audit."operationId" = operation_id
      AND audit."command" = 'IMPORT_APPLY'
      AND (audit."metadata"->>'itemCount')::INTEGER <> question_delta_count
  ) THEN
    RAISE EXCEPTION 'IMPORT_APPLY metadata count does not match created Questions.'
      USING ERRCODE = '23514';
  END IF;

  IF intent."command" = 'QUESTION_ARCHIVE' THEN
    SELECT
      COUNT(*) FILTER (WHERE delta."fromState" = 'PUBLISHED'),
      COUNT(*) FILTER (WHERE delta."fromState" IN
        ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED'))
    INTO archive_retired_count, archive_abandoned_count
    FROM "Phase7OperationDelta" AS delta
    WHERE delta."operationId" = operation_id
      AND delta."entityType" = 'QUESTION_VERSION';
    expected_archive_fields := '["LIFECYCLE_STATUS"]'::JSONB;
    IF archive_retired_count + archive_abandoned_count > 0 THEN
      expected_archive_fields := expected_archive_fields
        || '["VERSION_STATUS"]'::JSONB;
    END IF;
    IF archive_retired_count > 0 THEN
      expected_archive_fields := expected_archive_fields
        || '["CURRENT_PUBLISHED_VERSION_ID"]'::JSONB;
    END IF;
    IF EXISTS (
      SELECT 1 FROM "AdminAuditLog" AS audit
      WHERE audit."operationId" = operation_id
        AND audit."command" = 'QUESTION_ARCHIVE'
        AND (
          audit."changedFields" IS DISTINCT FROM expected_archive_fields
          OR (audit."metadata"->>'retiredPublishedCount')::INTEGER
            <> archive_retired_count
          OR (audit."metadata"->>'abandonedCandidateCount')::INTEGER
            <> archive_abandoned_count
        )
    ) THEN
      RAISE EXCEPTION 'QUESTION_ARCHIVE audit does not match captured aggregate changes.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Every entity evidence row must target a captured delta. Request-scoped
  -- rows use operationId and are covered by the exact count matrix above.
  IF EXISTS (
    SELECT 1 FROM "ContentReview" AS review
    WHERE review."operationId" = operation_id
      AND NOT EXISTS (
        SELECT 1 FROM "Phase7OperationDelta" AS delta
        WHERE delta."operationId" = operation_id
          AND delta."entityType" = 'QUESTION_VERSION'
          AND delta."targetId" = review."questionVersionId"
          AND delta."questionId" = review."questionId"
          AND delta."fromState" = review."fromState"::TEXT
          AND delta."toState" = review."toState"::TEXT
      )
  ) OR EXISTS (
    SELECT 1 FROM "AdminAuditLog" AS audit
    WHERE audit."operationId" = operation_id
      AND audit."targetType" IN ('QUESTION','QUESTION_VERSION','QUESTION_REPORT')
      AND NOT EXISTS (
        SELECT 1 FROM "Phase7OperationDelta" AS delta
        WHERE delta."operationId" = operation_id
          AND delta."entityType" = audit."targetType"::TEXT
          AND delta."targetId" = audit."targetId"
          AND delta."fromState" IS NOT DISTINCT FROM audit."beforeState"
          AND delta."toState" IS NOT DISTINCT FROM audit."afterState"
          AND delta."beforeRowVersion" IS NOT DISTINCT FROM audit."beforeRowVersion"
          AND delta."afterRowVersion" IS NOT DISTINCT FROM audit."afterRowVersion"
      )
  ) THEN
    RAISE EXCEPTION 'Evidence row does not match a locked domain delta.'
      USING ERRCODE = '23514';
  END IF;

  -- Commands whose matrix requires one review per changed version must cover
  -- the delta set in both directions. The operation/version unique index makes
  -- this a true bijection rather than a count-only assertion.
  IF intent."command" IN (
      'REVIEW_REQUEST','CHANGE_REQUEST','APPROVAL','APPROVAL_WITHDRAWAL',
      'PUBLICATION','RETIREMENT','QUESTION_ARCHIVE','REVIEW_REQUEST_BATCH'
    ) AND EXISTS (
      SELECT 1 FROM "Phase7OperationDelta" AS delta
      WHERE delta."operationId" = operation_id
        AND delta."entityType" = 'QUESTION_VERSION'
        AND NOT EXISTS (
          SELECT 1 FROM "ContentReview" AS review
          WHERE review."operationId" = operation_id
            AND review."questionVersionId" = delta."targetId"
            AND review."questionId" = delta."questionId"
            AND review."fromState"::TEXT = delta."fromState"
            AND review."toState"::TEXT = delta."toState"
        )
    ) THEN
    RAISE EXCEPTION 'Changed version is missing its exact review evidence.'
      USING ERRCODE = '23514';
  END IF;

  IF intent."command" = 'AUTHOR_ERASURE_ABANDON' AND EXISTS (
    SELECT 1 FROM "Phase7OperationDelta" AS delta
    WHERE delta."operationId" = operation_id
      AND delta."entityType" = 'QUESTION_VERSION'
      AND delta."toState" = 'RETIRED'
      AND delta."fromState" <> 'RETIRED'
      AND NOT EXISTS (
        SELECT 1 FROM "ContentReview" AS review
        WHERE review."operationId" = operation_id
          AND review."questionVersionId" = delta."targetId"
          AND review."questionId" = delta."questionId"
          AND review."fromState"::TEXT = delta."fromState"
          AND review."toState"::TEXT = delta."toState"
      )
  ) THEN
    RAISE EXCEPTION 'Erasure-retired version is missing its exact review evidence.'
      USING ERRCODE = '23514';
  END IF;

  -- Single-question commands may touch several rows, but every captured row
  -- must belong to the same aggregate. Import is a set of exact 1:1 pairs.
  IF intent."command" IN (
      'QUESTION_CREATE','QUESTION_VERSION_CREATE','QUESTION_VERSION_UPDATE',
      'REVIEW_REQUEST','CHANGE_REQUEST','APPROVAL','APPROVAL_WITHDRAWAL',
      'PUBLICATION','RETIREMENT','QUESTION_ARCHIVE'
    ) AND (
      SELECT COUNT(DISTINCT delta."questionId")
      FROM "Phase7OperationDelta" AS delta
      WHERE delta."operationId" = operation_id
        AND delta."questionId" IS NOT NULL
    ) <> 1 THEN
    RAISE EXCEPTION 'Command deltas must belong to one Question aggregate.'
      USING ERRCODE = '23514';
  END IF;

  IF intent."command" = 'IMPORT_APPLY' AND (
    EXISTS (
      SELECT 1 FROM "Phase7OperationDelta" AS question_delta
      WHERE question_delta."operationId" = operation_id
        AND question_delta."entityType" = 'QUESTION'
        AND NOT EXISTS (
          SELECT 1 FROM "Phase7OperationDelta" AS version_delta
          WHERE version_delta."operationId" = operation_id
            AND version_delta."entityType" = 'QUESTION_VERSION'
            AND version_delta."questionId" = question_delta."targetId"
        )
    ) OR EXISTS (
      SELECT 1 FROM "Phase7OperationDelta" AS version_delta
      WHERE version_delta."operationId" = operation_id
        AND version_delta."entityType" = 'QUESTION_VERSION'
        AND NOT EXISTS (
          SELECT 1 FROM "Phase7OperationDelta" AS question_delta
          WHERE question_delta."operationId" = operation_id
            AND question_delta."entityType" = 'QUESTION'
            AND question_delta."targetId" = version_delta."questionId"
        )
    )
  ) THEN
    RAISE EXCEPTION 'IMPORT_APPLY deltas are not exact Question/version pairs.'
      USING ERRCODE = '23514';
  END IF;

  -- Flush every deferred domain verifier before consuming the one-time intent.
  -- The only constraint triggers intentionally left deferred here are the
  -- intent/trusted-execution leak sentinels themselves. This makes the strict
  -- authority recheck below the final validation step of the command.
  SET CONSTRAINTS
    "QuestionOption_questionVersionId_label_key",
    "QuestionOption_questionVersionId_ordinal_key",
    "QuestionVersion_id_correctOptionId_fkey",
    "Question_id_currentPublishedVersionId_fkey",
    "QuestionVersionTag_questionVersionId_normalizedNameSnapshot_key",
    "Question_deferred_aggregate",
    "QuestionVersion_deferred_question_aggregate",
    "QuestionVersion_deferred_full_content",
    "QuestionOption_deferred_full_content",
    "QuestionVersionTag_deferred_full_content",
    "Question_deferred_system_seed_catalog",
    "QuestionVersion_deferred_system_seed_catalog",
    "QuestionReport_deferred_remediation",
    "User_deferred_credential_totality",
    "Account_deferred_credential_totality"
  IMMEDIATE;

  DELETE FROM "Phase7OperationIntent" WHERE "operationId" = operation_id;
  SET CONSTRAINTS "Phase7OperationIntent_must_finish" IMMEDIATE;
  IF intent."actorUserId" IS NOT NULL THEN
    authority_commit_checked_at := clock_timestamp();
    PERFORM 1
    FROM "User" AS actor
    JOIN "AuthSessionFamily" AS family
      ON family."userId" = actor."id"
     AND family."id" = intent."actorFamilyId"
    JOIN "Session" AS session
      ON session."userId" = actor."id"
     AND session."sessionFamilyId" = family."id"
     AND session."id" = intent."actorSessionId"
    WHERE actor."id" = intent."actorUserId"
      AND actor."role" = 'ADMIN'
      AND actor."accountStatus" = 'ACTIVE'
      AND actor."authorityGeneration" = intent."capturedAuthorityGeneration"
      AND family."status" = 'ACTIVE'
      AND session."issuerProtocolVersion" = 'PHASE7_V1'
      AND session."authorityGeneration" = intent."capturedAuthorityGeneration"
      AND session."expiresAt" > authority_commit_checked_at
      AND session."createdAt" + INTERVAL '30 days' > authority_commit_checked_at
      AND (NOT intent."requiresFresh"
        OR session."createdAt" + INTERVAL '5 minutes'
          > authority_commit_checked_at);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Phase 7 authority expired before commit.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
END;
$function$;

CREATE FUNCTION "reject_unfinished_phase7_operation"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Phase7OperationIntent"
    WHERE "operationId" = NEW."operationId"
  ) THEN
    RAISE EXCEPTION 'Phase 7 operation was not verified and consumed.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER "Phase7OperationIntent_must_finish"
AFTER INSERT ON "Phase7OperationIntent"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "reject_unfinished_phase7_operation"();

REVOKE ALL ON FUNCTION "phase7_begin_admin_operation"(
  "AdminAuditCommand", TEXT, UUID, "AdminAuditEnvironment", UUID[]
) FROM PUBLIC;
REVOKE ALL ON FUNCTION "phase7_arm_admin_operation"(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION "phase7_finish_admin_operation"(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION "phase7_current_operation_id"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "phase7_operation_references_user"(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION "phase7_operation_target_matches"(
  TEXT, UUID, UUID, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION "phase7_verify_operation_manifest"(UUID) FROM PUBLIC;

CREATE FUNCTION "phase7_normalize_report_description"(value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
  SELECT regexp_replace(
    normalize(replace(replace(value, E'\r\n', E'\n'), E'\r', E'\n'), NFC),
    U&'^[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+|[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+$',
    '',
    'g'
  );
$function$;

CREATE FUNCTION "phase7_question_report_description_digest"(value TEXT)
RETURNS VARCHAR(64)
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
  SELECT encode(public.digest(
    convert_to('nihongo-question-report-description-v1', 'UTF8')
      || decode('00', 'hex')
      || convert_to("phase7_normalize_report_description"(value), 'UTF8'),
    'sha256'::TEXT
  ), 'hex');
$function$;

CREATE FUNCTION "validate_phase7_question_report_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  reporter "User"%ROWTYPE;
BEGIN
  IF NOT "phase7_trusted_execution_active"('REPORT_CREATE')
    OR "phase7_trusted_execution_target"('REPORT_CREATE')
      IS DISTINCT FROM NEW."reporterUserId" THEN
    RAISE EXCEPTION 'QuestionReport insert requires owned reporter authority.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW."status" <> 'OPEN' OR NEW."rowVersion" <> 1
    OR NEW."description" IS NULL
    OR NEW."description" <> "phase7_normalize_report_description"(NEW."description")
    OR position(E'\r' IN NEW."description") <> 0
    OR char_length(NEW."description") NOT BETWEEN 1 AND 2000
    OR NEW."descriptionDigest" <>
      "phase7_question_report_description_digest"(NEW."description") THEN
    RAISE EXCEPTION 'QuestionReport create contract is invalid.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO reporter FROM "User" WHERE "id" = NEW."reporterUserId" FOR SHARE;
  IF reporter."id" IS NULL OR reporter."id" <> NEW."reporterActorId"
    OR reporter."role" <> NEW."reporterRole"
    OR reporter."accountStatus" <> 'ACTIVE'
    OR NEW."reporterLabel" <> (CASE reporter."role"
      WHEN 'ADMIN' THEN 'ACTIVE_ADMIN'::"AccountActorLabel"
      ELSE 'ACTIVE_USER'::"AccountActorLabel" END) THEN
    RAISE EXCEPTION 'QuestionReport reporter snapshot is invalid.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Question" AS question
    WHERE question."id" = NEW."questionId"
      AND question."lifecycleStatus" = 'ACTIVE'
      AND question."currentPublishedVersionId" = NEW."questionVersionId"
  ) AND NOT EXISTS (
    SELECT 1
    FROM "StudySessionQuestion" AS session_question
    JOIN "StudySession" AS session
      ON session."id" = session_question."studySessionId"
    WHERE session."userId" = NEW."reporterActorId"
      AND session_question."questionId" = NEW."questionId"
      AND session_question."questionVersionId" = NEW."questionVersionId"
  ) AND NOT EXISTS (
    SELECT 1 FROM "WrongNote" AS note
    WHERE note."userId" = NEW."reporterActorId"
      AND note."questionId" = NEW."questionId"
      AND NEW."questionVersionId" IN (
        note."lastWrongQuestionVersionId", note."currentReviewQuestionVersionId"
      )
  ) THEN
    RAISE EXCEPTION 'QuestionReport target is not entitled.'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "QuestionReport_validate_insert"
BEFORE INSERT ON "QuestionReport"
FOR EACH ROW EXECUTE FUNCTION "validate_phase7_question_report_insert"();

CREATE FUNCTION "phase7_create_question_report"(
  raw_session_token TEXT,
  report_id UUID,
  question_id_value UUID,
  question_version_id_value UUID,
  reason_value "QuestionReportReason",
  description_value TEXT
)
RETURNS TABLE ("id" UUID, "rowVersion" INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  authority_checked_at TIMESTAMPTZ(3);
  authority_commit_checked_at TIMESTAMPTZ(3);
  event_time TIMESTAMPTZ(3);
  reporter_id UUID;
  reporter_role "UserRole";
  reporter_generation INTEGER;
  reporter_family_id UUID;
  reporter_session_id UUID;
  execution_id UUID;
  report_row "QuestionReport"%ROWTYPE;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_app');
  PERFORM "phase7_require_database_capability"(NULL);
  SELECT target_session."userId", target_session."sessionFamilyId",
    target_session."id"
  INTO reporter_id, reporter_family_id, reporter_session_id
  FROM "Session" AS target_session
  WHERE target_session."token" = raw_session_token;
  IF reporter_id IS NULL THEN
    RAISE EXCEPTION 'QuestionReport reporter authority is stale.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM "User" AS target_user
  WHERE target_user."id" = reporter_id FOR UPDATE;
  PERFORM 1 FROM "AuthSessionFamily" AS target_family
  WHERE target_family."id" = reporter_family_id
    AND target_family."userId" = reporter_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QuestionReport reporter family is stale.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM "Session" AS target_session
  WHERE target_session."id" = reporter_session_id
    AND target_session."userId" = reporter_id
    AND target_session."sessionFamilyId" = reporter_family_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QuestionReport reporter Session is stale.'
      USING ERRCODE = '42501';
  END IF;
  authority_checked_at := clock_timestamp();
  SELECT target_user."id", target_user."role",
    target_user."authorityGeneration"
  INTO reporter_id, reporter_role, reporter_generation
  FROM "User" AS target_user
  JOIN "Session" AS target_session
    ON target_session."userId" = target_user."id"
  JOIN "AuthSessionFamily" AS target_family
    ON target_family."userId" = target_session."userId"
   AND target_family."id" = target_session."sessionFamilyId"
  WHERE target_session."token" = raw_session_token
    AND target_session."id" = reporter_session_id
    AND target_family."id" = reporter_family_id
    AND target_user."accountStatus" = 'ACTIVE'
    AND target_family."status" = 'ACTIVE'
    AND target_session."issuerProtocolVersion" = 'PHASE7_V1'
    AND target_session."authorityGeneration" = target_user."authorityGeneration"
    AND target_session."expiresAt" > authority_checked_at
    AND target_session."createdAt" + INTERVAL '30 days' > authority_checked_at;
  IF reporter_id IS NULL THEN
    RAISE EXCEPTION 'QuestionReport reporter authority is stale.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM "Question" AS question
  WHERE question."id" = question_id_value
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QuestionReport target Question is missing.'
      USING ERRCODE = '23503';
  END IF;
  PERFORM 1 FROM "QuestionVersion" AS version
  WHERE version."id" = question_version_id_value
    AND version."questionId" = question_id_value
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QuestionReport target version is missing.'
      USING ERRCODE = '23503';
  END IF;
  PERFORM 1
  FROM "StudySessionQuestion" AS session_question
  JOIN "StudySession" AS study_session
    ON study_session."id" = session_question."studySessionId"
  WHERE study_session."userId" = reporter_id
    AND session_question."questionId" = question_id_value
    AND session_question."questionVersionId" = question_version_id_value
  ORDER BY session_question."id"
  FOR SHARE OF session_question, study_session;
  PERFORM 1 FROM "WrongNote" AS note
  WHERE note."userId" = reporter_id
    AND note."questionId" = question_id_value
  ORDER BY note."id" FOR SHARE;

  IF NOT EXISTS (
    SELECT 1 FROM "Question" AS question
    WHERE question."id" = question_id_value
      AND question."lifecycleStatus" = 'ACTIVE'
      AND question."currentPublishedVersionId" = question_version_id_value
  ) AND NOT EXISTS (
    SELECT 1
    FROM "StudySessionQuestion" AS session_question
    JOIN "StudySession" AS study_session
      ON study_session."id" = session_question."studySessionId"
    WHERE study_session."userId" = reporter_id
      AND session_question."questionId" = question_id_value
      AND session_question."questionVersionId" = question_version_id_value
  ) AND NOT EXISTS (
    SELECT 1 FROM "WrongNote" AS note
    WHERE note."userId" = reporter_id
      AND note."questionId" = question_id_value
      AND question_version_id_value IN (
        note."lastWrongQuestionVersionId", note."currentReviewQuestionVersionId"
      )
  ) THEN
    RAISE EXCEPTION 'QuestionReport target is not entitled.'
      USING ERRCODE = '23503';
  END IF;

  event_time := clock_timestamp();
  execution_id := "phase7_open_trusted_execution"(
    'REPORT_CREATE', reporter_id, NULL
  );
  INSERT INTO "QuestionReport" (
    "id", "questionId", "questionVersionId", "reason", "description",
    "descriptionDigest", "status", "reporterUserId", "reporterActorId",
    "reporterRole", "reporterLabel", "rowVersion", "createdAt", "updatedAt"
  ) VALUES (
    report_id, question_id_value, question_version_id_value, reason_value,
    description_value,
    "phase7_question_report_description_digest"(description_value),
    'OPEN', reporter_id, reporter_id, reporter_role,
    CASE reporter_role WHEN 'ADMIN' THEN 'ACTIVE_ADMIN'::"AccountActorLabel"
      ELSE 'ACTIVE_USER'::"AccountActorLabel" END,
    1, event_time, event_time
  ) RETURNING * INTO report_row;
  authority_commit_checked_at := clock_timestamp();
  IF NOT EXISTS (
    SELECT 1
    FROM "User" AS target_user
    JOIN "AuthSessionFamily" AS target_family
      ON target_family."userId" = target_user."id"
     AND target_family."id" = reporter_family_id
    JOIN "Session" AS target_session
      ON target_session."userId" = target_user."id"
     AND target_session."sessionFamilyId" = target_family."id"
     AND target_session."id" = reporter_session_id
    WHERE target_user."id" = reporter_id
      AND target_user."role" = reporter_role
      AND target_user."accountStatus" = 'ACTIVE'
      AND target_user."authorityGeneration" = reporter_generation
      AND target_family."status" = 'ACTIVE'
      AND target_session."token" = raw_session_token
      AND target_session."issuerProtocolVersion" = 'PHASE7_V1'
      AND target_session."authorityGeneration" = reporter_generation
      AND target_session."expiresAt" > authority_commit_checked_at
      AND target_session."createdAt" + INTERVAL '30 days'
        > authority_commit_checked_at
  ) THEN
    RAISE EXCEPTION 'QuestionReport reporter authority expired before commit.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN QUERY SELECT report_row."id", report_row."rowVersion";
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_create_question_report"(
  TEXT, UUID, UUID, UUID, "QuestionReportReason", TEXT
) FROM PUBLIC;

CREATE FUNCTION "protect_phase7_question_report"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  erasure_mode BOOLEAN := "phase7_trusted_execution_active"('ERASURE');
  redaction_mode BOOLEAN :=
    "phase7_trusted_execution_active"('REPORT_REDACTION');
  erasure_target UUID := "phase7_trusted_execution_target"('ERASURE');
  redaction_time TIMESTAMPTZ(3);
  reporter_matches BOOLEAN;
  assignee_matches BOOLEAN;
  operation_id UUID;
  operation_command "AdminAuditCommand";
  operation_actor_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'QuestionReport delete is forbidden.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."questionId" <> OLD."questionId"
    OR NEW."questionVersionId" <> OLD."questionVersionId"
    OR NEW."reason" <> OLD."reason"
    OR NEW."reporterActorId" <> OLD."reporterActorId"
    OR NEW."reporterRole" <> OLD."reporterRole"
    OR NEW."descriptionDigest" <> OLD."descriptionDigest"
    OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'QuestionReport identity/digest is insert-only.'
      USING ERRCODE = '23514';
  END IF;

  IF erasure_mode THEN
    reporter_matches := OLD."reporterActorId" = erasure_target;
    assignee_matches := OLD."assigneeActorId" = erasure_target;
    IF NOT reporter_matches AND NOT assignee_matches THEN
      RAISE EXCEPTION 'QuestionReport erasure target is unrelated.'
        USING ERRCODE = '42501';
    END IF;
    IF NEW."rowVersion" <> OLD."rowVersion" + 1
      OR NEW."updatedAt" <= OLD."updatedAt"
      OR (
        to_jsonb(NEW)
          - 'reporterUserId' - 'reporterLabel' - 'description'
          - 'assigneeUserId' - 'assigneeLabel'
          - 'rowVersion' - 'updatedAt'
      ) <> (
        to_jsonb(OLD)
          - 'reporterUserId' - 'reporterLabel' - 'description'
          - 'assigneeUserId' - 'assigneeLabel'
          - 'rowVersion' - 'updatedAt'
      )
      OR NEW."reporterUserId" IS DISTINCT FROM (
        CASE WHEN reporter_matches THEN NULL ELSE OLD."reporterUserId" END
      )
      OR NEW."reporterLabel" IS DISTINCT FROM (
        CASE WHEN reporter_matches THEN
          CASE OLD."reporterRole"
            WHEN 'ADMIN' THEN 'DELETED_ADMIN'::"AccountActorLabel"
            ELSE 'DELETED_USER'::"AccountActorLabel" END
        ELSE OLD."reporterLabel" END
      )
      OR NEW."description" IS DISTINCT FROM (
        CASE WHEN reporter_matches THEN NULL ELSE OLD."description" END
      )
      OR NEW."assigneeUserId" IS DISTINCT FROM (
        CASE WHEN assignee_matches THEN NULL ELSE OLD."assigneeUserId" END
      )
      OR NEW."assigneeLabel" IS DISTINCT FROM (
        CASE WHEN assignee_matches THEN 'DELETED_ADMIN'::"AccountActorLabel"
          ELSE OLD."assigneeLabel" END
      ) THEN
      RAISE EXCEPTION 'QuestionReport erasure may only tombstone/redact actors.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF redaction_mode THEN
    SELECT execution."createdAt" INTO redaction_time
    FROM "Phase7TrustedExecution" AS execution
    WHERE execution."kind" = 'REPORT_REDACTION'
      AND execution."backendPid" = pg_backend_pid()
      AND execution."transactionId" = txid_current();
    IF redaction_time IS NULL
      OR OLD."status" NOT IN ('RESOLVED', 'DISMISSED')
      OR OLD."resolvedAt" IS NULL
      OR OLD."resolvedAt" > redaction_time - INTERVAL '180 days'
      OR OLD."description" IS NULL
      OR NEW."description" IS NOT NULL
      OR NEW."rowVersion" <> OLD."rowVersion" + 1
      OR NEW."updatedAt" IS DISTINCT FROM redaction_time
      OR (
        to_jsonb(NEW) - 'description' - 'rowVersion' - 'updatedAt'
      ) <> (
        to_jsonb(OLD) - 'description' - 'rowVersion' - 'updatedAt'
      ) THEN
      RAISE EXCEPTION 'QuestionReport redaction is not terminal, mature, and description-only.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  operation_id := "phase7_current_operation_id"();
  SELECT intent."command", intent."actorUserId"
  INTO operation_command, operation_actor_id
  FROM "Phase7OperationIntent" AS intent
  WHERE intent."operationId" = operation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QuestionReport transition requires an owned operation.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW."rowVersion" <> OLD."rowVersion" + 1
    OR NEW."updatedAt" <= OLD."updatedAt" THEN
    RAISE EXCEPTION 'QuestionReport transition rowVersion/time is invalid.'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'OPEN' AND NEW."status" = 'TRIAGED' THEN
    IF operation_command <> 'REPORT_TRIAGE'
      OR operation_actor_id IS NULL
      OR NEW."assigneeUserId" IS DISTINCT FROM operation_actor_id
      OR NEW."assigneeActorId" IS DISTINCT FROM operation_actor_id
      OR NEW."assigneeRole" IS DISTINCT FROM 'ADMIN'
      OR NEW."assigneeLabel" IS DISTINCT FROM 'ACTIVE_ADMIN'
      OR (
      to_jsonb(NEW) - 'status' - 'assigneeUserId' - 'assigneeActorId'
        - 'assigneeRole' - 'assigneeLabel' - 'rowVersion' - 'updatedAt'
    ) <> (
      to_jsonb(OLD) - 'status' - 'assigneeUserId' - 'assigneeActorId'
        - 'assigneeRole' - 'assigneeLabel' - 'rowVersion' - 'updatedAt'
    ) THEN
      RAISE EXCEPTION 'QuestionReport triage changed forbidden fields.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF OLD."status" = 'TRIAGED'
    AND NEW."status" IN ('RESOLVED','DISMISSED') THEN
    IF operation_command <> 'REPORT_RESOLUTION' OR (
      to_jsonb(NEW) - 'status' - 'resolutionOutcome' - 'resolutionReason'
        - 'remediationVersionId' - 'resolvedAt' - 'rowVersion' - 'updatedAt'
    ) <> (
      to_jsonb(OLD) - 'status' - 'resolutionOutcome' - 'resolutionReason'
        - 'remediationVersionId' - 'resolvedAt' - 'rowVersion' - 'updatedAt'
    ) THEN
      RAISE EXCEPTION 'QuestionReport resolution changed forbidden fields.'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid QuestionReport transition.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "QuestionReport_protect_history"
BEFORE UPDATE OR DELETE ON "QuestionReport"
FOR EACH ROW EXECUTE FUNCTION "protect_phase7_question_report"();

CREATE FUNCTION "validate_phase7_question_report_remediation"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  target_number INTEGER;
  remediation "QuestionVersion"%ROWTYPE;
BEGIN
  IF NEW."remediationVersionId" IS NULL THEN RETURN NULL; END IF;
  SELECT "versionNumber" INTO target_number FROM "QuestionVersion"
    WHERE "questionId" = NEW."questionId" AND "id" = NEW."questionVersionId";
  SELECT * INTO remediation FROM "QuestionVersion"
    WHERE "questionId" = NEW."questionId" AND "id" = NEW."remediationVersionId";
  IF NEW."status" <> 'RESOLVED' OR remediation."id" IS NULL
    OR remediation."versionNumber" <= target_number
    OR NOT (
      remediation."status" = 'PUBLISHED'
      OR remediation."status" = 'RETIRED'
        AND remediation."retirementKind" = 'PUBLISHED_RETIREMENT'
        AND remediation."publishedAt" IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'QuestionReport remediation must be later published lineage.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER "QuestionReport_deferred_remediation"
AFTER INSERT OR UPDATE ON "QuestionReport"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_phase7_question_report_remediation"();

ALTER TABLE "Account"
  ADD CONSTRAINT "Account_credential_arm_check" CHECK (
    "providerId" <> 'credential' OR (
      "accountId" = "userId"::TEXT
      AND "password" IS NOT NULL
      AND "accessToken" IS NULL AND "refreshToken" IS NULL
      AND "idToken" IS NULL
      AND "accessTokenExpiresAt" IS NULL
      AND "refreshTokenExpiresAt" IS NULL
      AND "scope" IS NULL
    )
  );

CREATE FUNCTION "protect_phase7_auth_issuer_activation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'AuthIssuerActivation singleton identity is immutable.'
      USING ERRCODE = '23514';
  END IF;
  IF NOT "phase7_trusted_execution_active"('ACTIVATE') THEN
    RAISE EXCEPTION 'Auth issuer activation requires owned authority.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW."id" <> 1 OR OLD."id" <> 1
    OR OLD."legacyIssuerDisabled" IS NOT FALSE
    OR NEW."legacyIssuerDisabled" IS NOT TRUE THEN
    RAISE EXCEPTION 'Auth issuer activation is one-way false to true.'
      USING ERRCODE = '23514';
  END IF;
  NEW."updatedAt" := clock_timestamp();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "AuthIssuerActivation_protect_singleton"
BEFORE INSERT OR UPDATE OR DELETE ON "AuthIssuerActivation"
FOR EACH ROW EXECUTE FUNCTION "protect_phase7_auth_issuer_activation"();

CREATE FUNCTION "guard_phase7_legacy_auth_write"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  legacy_disabled BOOLEAN;
  legacy_login TEXT := CASE
    WHEN current_database() ~ '_test$' THEN 'nihongo_test_legacy_app_login'
    WHEN current_database() ~ '_dev$' THEN 'nihongo_development_legacy_app_login'
    ELSE NULL
  END;
BEGIN
  IF SESSION_USER IS DISTINCT FROM legacy_login THEN
    RETURN NULL;
  END IF;
  -- Serialize every legacy auth write with activation before any row is
  -- locked or inserted. A statement that waited behind activation must re-read
  -- true and fail even if its privilege was checked before the atomic revoke.
  SELECT "legacyIssuerDisabled" INTO legacy_disabled
  FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth issuer activation singleton is missing.'
      USING ERRCODE = '42501';
  END IF;
  IF legacy_disabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Legacy auth write is disabled.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER "User_guard_legacy_auth_write"
BEFORE INSERT OR UPDATE OR DELETE ON "User"
FOR EACH STATEMENT EXECUTE FUNCTION "guard_phase7_legacy_auth_write"();

CREATE TRIGGER "Account_guard_legacy_auth_write"
BEFORE INSERT OR UPDATE OR DELETE ON "Account"
FOR EACH STATEMENT EXECUTE FUNCTION "guard_phase7_legacy_auth_write"();

CREATE TRIGGER "Session_guard_legacy_auth_write"
BEFORE INSERT OR UPDATE OR DELETE ON "Session"
FOR EACH STATEMENT EXECUTE FUNCTION "guard_phase7_legacy_auth_write"();

CREATE TRIGGER "Verification_guard_legacy_auth_write"
BEFORE INSERT OR UPDATE OR DELETE ON "Verification"
FOR EACH STATEMENT EXECUTE FUNCTION "guard_phase7_legacy_auth_write"();

CREATE FUNCTION "protect_phase7_session_family"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  erasure_mode BOOLEAN := "phase7_trusted_execution_active"('ERASURE');
  legacy_nested_revoke BOOLEAN := false;
  trusted_family_write BOOLEAN :=
    "phase7_trusted_execution_active"('ISSUE_V1')
    OR "phase7_trusted_execution_active"('REAUTHENTICATE')
    OR "phase7_trusted_execution_active"('SIGN_OUT')
    OR "phase7_trusted_execution_active"('ACTIVATE')
    OR "phase7_trusted_execution_active"('PASSWORD_CHANGE')
    OR "phase7_trusted_execution_active"('RESET_CONSUME')
    OR "phase7_trusted_execution_active"('AUTHORITY_CHANGE')
    OR "phase7_trusted_execution_active"('FENCE_CLEANUP')
    OR erasure_mode;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT trusted_family_write AND pg_trigger_depth() <= 1 THEN
      RAISE EXCEPTION 'AuthSessionFamily insert requires owned issuance.'
        USING ERRCODE = '42501';
    END IF;
    IF NEW."status" <> 'ACTIVE' OR NEW."revokedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'AuthSessionFamily must begin ACTIVE.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF NOT erasure_mode
      AND NOT "phase7_trusted_execution_active"('FENCE_CLEANUP') THEN
      RAISE EXCEPTION 'AuthSessionFamily delete requires owned cleanup.'
        USING ERRCODE = '23514';
    END IF;
    IF NOT erasure_mode AND (
      OLD."status" <> 'REVOKED'
      OR EXISTS (
        SELECT 1 FROM "Session"
        WHERE "sessionFamilyId" = OLD."id"
      )
      OR EXISTS (
        SELECT 1 FROM "AuthSessionRotationFence"
        WHERE "oldFamilyId" = OLD."id"
          OR "replacementFamilyId" = OLD."id"
      )
    ) THEN
      RAISE EXCEPTION 'Cleanup only removes empty, unfenced REVOKED families.'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NOT trusted_family_write
    AND pg_trigger_depth() > 1 THEN
    SELECT NOT "legacyIssuerDisabled" INTO legacy_nested_revoke
    FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
    legacy_nested_revoke := COALESCE(legacy_nested_revoke, false);
  END IF;
  IF NOT trusted_family_write AND NOT legacy_nested_revoke THEN
    RAISE EXCEPTION 'AuthSessionFamily revoke requires owned authority.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."userId" <> OLD."userId"
    OR NEW."createdAt" <> OLD."createdAt"
    OR OLD."status" <> 'ACTIVE' OR NEW."status" <> 'REVOKED'
    OR OLD."revokedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'AuthSessionFamily is ACTIVE to REVOKED only.'
      USING ERRCODE = '23514';
  END IF;
  NEW."revokedAt" := clock_timestamp();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "AuthSessionFamily_protect_lifecycle"
BEFORE INSERT OR UPDATE OR DELETE ON "AuthSessionFamily"
FOR EACH ROW EXECUTE FUNCTION "protect_phase7_session_family"();

CREATE FUNCTION "validate_phase7_session_write"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  user_row "User"%ROWTYPE;
  family_row "AuthSessionFamily"%ROWTYPE;
  legacy_disabled BOOLEAN;
  trusted_v1 BOOLEAN :=
    "phase7_trusted_execution_active"('ISSUE_V1')
    OR "phase7_trusted_execution_active"('REAUTHENTICATE');
  trusted_refresh BOOLEAN := "phase7_trusted_execution_active"('REFRESH');
  trusted_delete BOOLEAN :=
    "phase7_trusted_execution_active"('SIGN_OUT')
    OR "phase7_trusted_execution_active"('ACTIVATE')
    OR "phase7_trusted_execution_active"('REAUTHENTICATE')
    OR "phase7_trusted_execution_active"('PASSWORD_CHANGE')
    OR "phase7_trusted_execution_active"('RESET_CONSUME')
    OR "phase7_trusted_execution_active"('AUTHORITY_CHANGE')
    OR "phase7_trusted_execution_active"('FENCE_CLEANUP')
    OR "phase7_trusted_execution_active"('ERASURE');
  remember_session BOOLEAN := "phase7_trusted_execution_remember"();
  issued_at TIMESTAMPTZ(3);
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT trusted_delete THEN
      SELECT "legacyIssuerDisabled" INTO legacy_disabled
      FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
      IF NOT FOUND OR legacy_disabled IS DISTINCT FROM false
        OR OLD."issuerProtocolVersion" <> 'LEGACY' THEN
        RAISE EXCEPTION 'Session delete requires owned authority.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT "legacyIssuerDisabled" INTO legacy_disabled
      FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Auth issuer activation singleton is missing.'
        USING ERRCODE = '42501';
    END IF;
    SELECT * INTO user_row FROM "User" WHERE "id" = NEW."userId" FOR UPDATE;
    IF user_row."id" IS NULL OR user_row."accountStatus" <> 'ACTIVE' THEN
      RAISE EXCEPTION 'Session requires an active User.' USING ERRCODE = '42501';
    END IF;

    IF NEW."issuerProtocolVersion" = 'LEGACY' THEN
      IF legacy_disabled IS DISTINCT FROM false
        OR user_row."authorityGeneration" <> 1 THEN
        RAISE EXCEPTION 'Legacy Session issuance is disabled.'
          USING ERRCODE = '42501';
      END IF;
      NEW."authorityGeneration" := 1;
      INSERT INTO "AuthSessionFamily" (
        "id", "userId", "status", "createdAt", "revokedAt"
      ) VALUES (
        NEW."sessionFamilyId", NEW."userId", 'ACTIVE', NEW."createdAt", NULL
      ) ON CONFLICT ("id") DO NOTHING;
    ELSE
      IF NOT trusted_v1 THEN
        RAISE EXCEPTION 'PHASE7_V1 Session requires the owned issuer.'
          USING ERRCODE = '42501';
      END IF;
      issued_at := clock_timestamp();
      NEW."createdAt" := issued_at;
      NEW."updatedAt" := issued_at;
      NEW."expiresAt" := issued_at
        + CASE WHEN remember_session THEN INTERVAL '7 days' ELSE INTERVAL '1 day' END;
      NEW."authorityGeneration" := user_row."authorityGeneration";
    END IF;

    SELECT * INTO family_row FROM "AuthSessionFamily"
      WHERE "id" = NEW."sessionFamilyId" AND "userId" = NEW."userId"
      FOR SHARE;
    IF family_row."id" IS NULL OR family_row."status" <> 'ACTIVE'
      OR NEW."authorityGeneration" <> user_row."authorityGeneration" THEN
      RAISE EXCEPTION 'Session family/generation authority is invalid.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" <> OLD."id" OR NEW."token" <> OLD."token"
    OR NEW."userId" <> OLD."userId"
    OR NEW."sessionFamilyId" <> OLD."sessionFamilyId"
    OR NEW."createdAt" <> OLD."createdAt"
    OR NEW."authorityGeneration" <> OLD."authorityGeneration"
    OR NEW."issuerProtocolVersion" <> OLD."issuerProtocolVersion" THEN
    RAISE EXCEPTION 'Session authority identity is immutable.'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."issuerProtocolVersion" = 'LEGACY' THEN
    -- Keep an old Better Auth node operational during the pre-activation
    -- drain without allowing its rolling refresh to exceed the new absolute
    -- lifetime. The marker lock also closes callers that do not use the
    -- dedicated legacy wrapper or whose statement waited behind activation.
    SELECT "legacyIssuerDisabled" INTO legacy_disabled
    FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
    IF NOT FOUND OR legacy_disabled IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'Legacy Session refresh is disabled.'
        USING ERRCODE = '42501';
    END IF;
    NEW."expiresAt" := LEAST(
      NEW."expiresAt",
      OLD."createdAt" + INTERVAL '30 days'
    );
  ELSE
    IF NOT trusted_refresh OR NOT remember_session THEN
      RAISE EXCEPTION 'V1 Session refresh requires remembered owned context.'
        USING ERRCODE = '42501';
    END IF;
    NEW."updatedAt" := clock_timestamp();
    NEW."expiresAt" := LEAST(
      NEW."updatedAt" + INTERVAL '7 days',
      OLD."createdAt" + INTERVAL '30 days'
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "Session_validate_authority_write"
BEFORE INSERT OR UPDATE OR DELETE ON "Session"
FOR EACH ROW EXECUTE FUNCTION "validate_phase7_session_write"();

CREATE FUNCTION "revoke_empty_phase7_session_family"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Session" WHERE "sessionFamilyId" = OLD."sessionFamilyId"
  ) THEN
    UPDATE "AuthSessionFamily" SET "status" = 'REVOKED'
    WHERE "id" = OLD."sessionFamilyId" AND "status" = 'ACTIVE';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE TRIGGER "Session_revoke_empty_family"
AFTER DELETE ON "Session"
FOR EACH ROW EXECUTE FUNCTION "revoke_empty_phase7_session_family"();

CREATE FUNCTION "validate_phase7_rotation_fence"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT "phase7_trusted_execution_active"('REAUTHENTICATE') THEN
    RAISE EXCEPTION 'Rotation fence requires owned reauthentication.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION "validate_phase7_rotation_fence_replacement"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
BEGIN
  -- Authority is checked synchronously by the BEFORE trigger. This deferred
  -- verifier intentionally depends only on the immutable NEW tuple because
  -- the one-shot REAUTHENTICATE context is consumed before commit.
  PERFORM 1
  FROM "Session" AS replacement
  WHERE replacement."id" = NEW."replacementSessionId"
    AND replacement."userId" = NEW."userId"
    AND replacement."sessionFamilyId" = NEW."replacementFamilyId"
    AND replacement."issuerProtocolVersion" = 'PHASE7_V1'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rotation fence replacement Session is invalid.'
      USING ERRCODE = '23503';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE FUNCTION "protect_phase7_rotation_fence"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'AuthSessionRotationFence is immutable.' USING ERRCODE = '23514';
  END IF;
  IF NOT "phase7_trusted_execution_active"('FENCE_CLEANUP')
    AND NOT "phase7_trusted_execution_active"('ERASURE') THEN
    RAISE EXCEPTION 'Rotation fence delete requires cleanup authority.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT "phase7_trusted_execution_active"('ERASURE')
    AND EXISTS (
      SELECT 1 FROM "Session"
      WHERE "sessionFamilyId" = OLD."replacementFamilyId"
        AND "expiresAt" > clock_timestamp()
    ) THEN
    RAISE EXCEPTION 'Live replacement family still needs its rotation fence.'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE TRIGGER "AuthSessionRotationFence_validate_insert"
BEFORE INSERT ON "AuthSessionRotationFence"
FOR EACH ROW EXECUTE FUNCTION "validate_phase7_rotation_fence"();
CREATE CONSTRAINT TRIGGER "AuthSessionRotationFence_deferred_replacement"
AFTER INSERT ON "AuthSessionRotationFence"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_phase7_rotation_fence_replacement"();
CREATE TRIGGER "AuthSessionRotationFence_protect_history"
BEFORE UPDATE OR DELETE ON "AuthSessionRotationFence"
FOR EACH ROW EXECUTE FUNCTION "protect_phase7_rotation_fence"();

CREATE FUNCTION "protect_phase7_account"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  erasure_mode BOOLEAN := "phase7_trusted_execution_active"('ERASURE');
  password_mode BOOLEAN :=
    "phase7_trusted_execution_active"('PASSWORD_CHANGE')
    OR "phase7_trusted_execution_active"('RESET_CONSUME');
  legacy_disabled BOOLEAN;
  legacy_login TEXT := CASE
    WHEN current_database() ~ '_test$' THEN 'nihongo_test_legacy_app_login'
    WHEN current_database() ~ '_dev$' THEN 'nihongo_development_legacy_app_login'
    ELSE NULL
  END;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."providerId" = 'credential' AND NOT erasure_mode THEN
      RAISE EXCEPTION 'Credential Account delete is erasure-only.'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."accountId" <> OLD."accountId"
    OR NEW."providerId" <> OLD."providerId" OR NEW."userId" <> OLD."userId"
    OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'Account identity is insert-only.' USING ERRCODE = '23514';
  END IF;
  IF OLD."providerId" = 'credential' THEN
    IF NOT password_mode
      AND SESSION_USER = legacy_login THEN
      SELECT "legacyIssuerDisabled" INTO legacy_disabled
      FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
      IF FOUND AND legacy_disabled IS NOT DISTINCT FROM false
        AND (to_jsonb(NEW) - 'password' - 'updatedAt') =
            (to_jsonb(OLD) - 'password' - 'updatedAt') THEN
        -- Preserve the exact Phase 6 password/updatedAt write arm while old
        -- nodes drain. Generation/session invalidation remains the legacy
        -- application's responsibility until atomic V1 activation.
        RETURN NEW;
      END IF;
    END IF;
    IF NOT password_mode THEN
      RAISE EXCEPTION 'Credential Account update requires owned password authority.'
        USING ERRCODE = '42501';
    END IF;
    IF (to_jsonb(NEW) - 'password' - 'updatedAt') <>
       (to_jsonb(OLD) - 'password' - 'updatedAt') THEN
      RAISE EXCEPTION 'Credential Account only permits password updates.'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."password" IS DISTINCT FROM OLD."password" THEN
      UPDATE "User"
      SET "authorityGeneration" = "authorityGeneration" + 1,
          "updatedAt" = clock_timestamp()
      WHERE "id" = OLD."userId";
      UPDATE "AuthSessionFamily" SET "status" = 'REVOKED'
      WHERE "userId" = OLD."userId" AND "status" = 'ACTIVE';
      DELETE FROM "Session" WHERE "userId" = OLD."userId";
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "Account_protect_identity_and_password"
BEFORE UPDATE OR DELETE ON "Account"
FOR EACH ROW EXECUTE FUNCTION "protect_phase7_account"();

CREATE FUNCTION "validate_phase7_user_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  authority_invalidation BOOLEAN :=
    "phase7_trusted_execution_active"('PASSWORD_CHANGE')
    OR "phase7_trusted_execution_active"('RESET_CONSUME')
    OR "phase7_trusted_execution_active"('AUTHORITY_CHANGE');
  erasure_mode BOOLEAN := "phase7_trusted_execution_active"('ERASURE');
BEGIN
  IF NEW."id" <> OLD."id" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'User identity is insert-only.' USING ERRCODE = '23514';
  END IF;
  IF NEW."role" IS DISTINCT FROM OLD."role"
    OR NEW."accountStatus" IS DISTINCT FROM OLD."accountStatus" THEN
    IF NOT authority_invalidation AND NOT erasure_mode THEN
      RAISE EXCEPTION 'User role/status change requires owned authority.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT erasure_mode AND EXISTS (
      SELECT 1 FROM "QuestionVersion"
      WHERE "createdByActorId" = OLD."id"
        AND "status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
    ) THEN
      RAISE EXCEPTION 'Open candidate blocks role/status authority change.'
        USING ERRCODE = '23514';
    END IF;
    NEW."authorityGeneration" := OLD."authorityGeneration" + 1;
    UPDATE "AuthSessionFamily" SET "status" = 'REVOKED'
      WHERE "userId" = OLD."id" AND "status" = 'ACTIVE';
    DELETE FROM "Session" WHERE "userId" = OLD."id";
  ELSIF NEW."authorityGeneration" <> OLD."authorityGeneration"
    AND NOT authority_invalidation AND NOT erasure_mode THEN
    RAISE EXCEPTION 'User authorityGeneration is server-owned.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "User_validate_identity_authority"
BEFORE UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION "validate_phase7_user_change"();

CREATE FUNCTION "phase7_credential_account_exists"(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
STRICT
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM "Account"
    WHERE "userId" = target_user_id AND "providerId" = 'credential'
  );
$function$;

CREATE FUNCTION "validate_phase7_credential_totality"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  target_user_id UUID;
  changed_row JSONB;
  legacy_disabled BOOLEAN;
BEGIN
  changed_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  target_user_id := CASE WHEN TG_TABLE_NAME = 'User'
    THEN (changed_row ->> 'id')::UUID
    ELSE (changed_row ->> 'userId')::UUID
  END;
  SELECT "legacyIssuerDisabled" INTO legacy_disabled
    FROM "AuthIssuerActivation" WHERE "id" = 1;
  IF legacy_disabled AND EXISTS (
    SELECT 1 FROM "User" WHERE "id" = target_user_id
  ) AND NOT "phase7_credential_account_exists"(target_user_id) THEN
    RAISE EXCEPTION 'Activated auth requires exactly one credential Account.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER "User_deferred_credential_totality"
AFTER INSERT OR UPDATE ON "User"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_phase7_credential_totality"();
CREATE CONSTRAINT TRIGGER "Account_deferred_credential_totality"
AFTER INSERT OR UPDATE OR DELETE ON "Account"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_phase7_credential_totality"();

CREATE FUNCTION "validate_phase7_verification_write"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  user_generation INTEGER;
  legacy_disabled BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."purpose" = 'PASSWORD_RESET_V1'
      AND NOT "phase7_trusted_execution_active"('RESET_CONSUME')
      AND NOT "phase7_trusted_execution_active"('RESET_ISSUE')
      AND NOT "phase7_trusted_execution_active"('ERASURE')
      AND NOT "phase7_trusted_execution_active"('ACTIVATE') THEN
      RAISE EXCEPTION 'Password reset intent delete requires owned authority.'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  SELECT "legacyIssuerDisabled" INTO legacy_disabled
  FROM "AuthIssuerActivation" WHERE "id" = 1 FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth issuer activation singleton is missing.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' AND NEW."purpose" = 'PASSWORD_RESET_V1' THEN
    IF NOT "phase7_trusted_execution_active"('RESET_ISSUE') THEN
      RAISE EXCEPTION 'Password reset intent requires owned issuance.'
        USING ERRCODE = '42501';
    END IF;
    SELECT "authorityGeneration" INTO user_generation FROM "User"
      WHERE "id" = NEW."resetUserId" AND "accountStatus" = 'ACTIVE'
      FOR SHARE;
    IF user_generation IS NULL
      OR NEW."capturedGeneration" IS DISTINCT FROM user_generation
      OR NEW."tokenSelector" IS NULL THEN
      RAISE EXCEPTION 'Password reset intent generation is stale.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'INSERT' AND legacy_disabled THEN
    RAISE EXCEPTION 'Legacy Verification issuance is disabled.'
      USING ERRCODE = '42501';
  ELSIF TG_OP = 'UPDATE' AND (
    OLD."purpose" = 'PASSWORD_RESET_V1'
    OR NEW."purpose" = 'PASSWORD_RESET_V1'
  ) THEN
    RAISE EXCEPTION 'Password-reset Verification rows are fully immutable.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "Verification_validate_phase7_write"
BEFORE INSERT OR UPDATE OR DELETE ON "Verification"
FOR EACH ROW EXECUTE FUNCTION "validate_phase7_verification_write"();

-- Persistent, schema-local proof that the TypeScript target guard checked the
-- exact connection endpoint before any Phase 7 destructive facade is enabled.
-- Only the no-login migration role can register or replace this singleton;
-- application roles receive neither table privileges nor registration EXECUTE.
CREATE TABLE "Phase7DatabaseCapability" (
  "id" SMALLINT NOT NULL DEFAULT 1,
  "databaseName" TEXT NOT NULL,
  "serverAddress" INET NOT NULL,
  "serverPort" INTEGER NOT NULL,
  "environment" "AdminAuditEnvironment" NOT NULL,
  "registeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "Phase7DatabaseCapability_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Phase7DatabaseCapability_singleton_check" CHECK ("id" = 1),
  CONSTRAINT "Phase7DatabaseCapability_port_check"
    CHECK ("serverPort" BETWEEN 1 AND 65535)
);

REVOKE ALL ON TABLE "Phase7DatabaseCapability" FROM PUBLIC;

CREATE FUNCTION "phase7_register_database_capability"(
  expected_database TEXT,
  expected_server_address INET,
  expected_server_port INTEGER,
  environment_value "AdminAuditEnvironment"
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  actual_address INET := inet_server_addr();
  actual_port INTEGER := inet_server_port();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_phase7_migration');
  IF expected_database IS NULL OR expected_database <> current_database()
    OR actual_address IS NULL OR expected_server_address IS NULL
    OR expected_server_address IS DISTINCT FROM actual_address
    OR expected_server_port IS DISTINCT FROM actual_port
    OR expected_server_port NOT BETWEEN 1 AND 65535
    OR (environment_value = 'TEST' AND expected_database !~ '_test$')
    OR (environment_value = 'DEVELOPMENT' AND expected_database !~ '_dev$') THEN
    RAISE EXCEPTION 'Phase 7 database capability does not match the safe target.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO "Phase7DatabaseCapability" (
    "id", "databaseName", "serverAddress", "serverPort", "environment",
    "registeredAt"
  ) VALUES (
    1, expected_database, expected_server_address, expected_server_port,
    environment_value, clock_timestamp()
  )
  ON CONFLICT ("id") DO UPDATE SET
    "databaseName" = EXCLUDED."databaseName",
    "serverAddress" = EXCLUDED."serverAddress",
    "serverPort" = EXCLUDED."serverPort",
    "environment" = EXCLUDED."environment",
    "registeredAt" = EXCLUDED."registeredAt";
END;
$function$;

CREATE FUNCTION "phase7_require_database_capability"(
  environment_value "AdminAuditEnvironment" DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  capability "Phase7DatabaseCapability"%ROWTYPE;
  actual_address INET := inet_server_addr();
  actual_port INTEGER := inet_server_port();
BEGIN
  SELECT * INTO capability
  FROM "Phase7DatabaseCapability"
  WHERE "id" = 1;
  IF capability."id" IS NULL
    OR capability."databaseName" <> current_database()
    OR capability."serverAddress" IS DISTINCT FROM actual_address
    OR capability."serverPort" IS DISTINCT FROM actual_port
    OR (environment_value IS NOT NULL
      AND capability."environment" IS DISTINCT FROM environment_value)
    OR (capability."environment" = 'TEST'
      AND capability."databaseName" !~ '_test$')
    OR (capability."environment" = 'DEVELOPMENT'
      AND capability."databaseName" !~ '_dev$') THEN
    RAISE EXCEPTION 'Phase 7 database capability is absent or stale.'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_register_database_capability"(
  TEXT, INET, INTEGER, "AdminAuditEnvironment"
) FROM PUBLIC;
REVOKE ALL ON FUNCTION "phase7_require_database_capability"(
  "AdminAuditEnvironment"
) FROM PUBLIC;

CREATE FUNCTION "phase7_redact_expired_report_descriptions"(
  batch_limit INTEGER,
  environment_value "AdminAuditEnvironment"
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  execution_id UUID;
  event_time TIMESTAMPTZ(3);
  redacted_count INTEGER;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_erasure_worker');
  PERFORM "phase7_require_database_capability"(environment_value);
  IF batch_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Report redaction batch limit is out of bounds.'
      USING ERRCODE = '22023';
  END IF;
  IF (environment_value = 'TEST' AND current_database() !~ '_test$')
    OR (environment_value = 'DEVELOPMENT' AND current_database() !~ '_dev$') THEN
    RAISE EXCEPTION 'Report redaction environment does not match the DB target.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM "AuthIssuerActivation"
  WHERE "id" = 1 AND "legacyIssuerDisabled"
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report redaction requires completed V1 activation.'
      USING ERRCODE = '42501';
  END IF;

  execution_id := "phase7_open_trusted_execution"(
    'REPORT_REDACTION', NULL, NULL
  );
  UPDATE "Phase7TrustedExecution"
  SET "environment" = environment_value
  WHERE "id" = execution_id
  RETURNING "createdAt" INTO event_time;

  WITH candidates AS MATERIALIZED (
    SELECT report."id"
    FROM "QuestionReport" AS report
    WHERE report."status" IN ('RESOLVED', 'DISMISSED')
      AND report."resolvedAt" IS NOT NULL
      AND report."resolvedAt" <= event_time - INTERVAL '180 days'
      AND report."description" IS NOT NULL
    ORDER BY report."id"
    FOR UPDATE SKIP LOCKED
    LIMIT batch_limit
  )
  UPDATE "QuestionReport" AS report
  SET "description" = NULL,
      "rowVersion" = report."rowVersion" + 1,
      "updatedAt" = event_time
  FROM candidates
  WHERE report."id" = candidates."id";
  GET DIAGNOSTICS redacted_count = ROW_COUNT;

  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN redacted_count;
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_redact_expired_report_descriptions"(
  INTEGER, "AdminAuditEnvironment"
) FROM PUBLIC;

CREATE FUNCTION "phase7_change_password"(
  target_user_id UUID,
  expected_password_hash TEXT,
  new_password_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  credential_id UUID;
  execution_id UUID;
  affected_count INTEGER;
  prior_generation INTEGER;
  result_generation INTEGER;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(NULL);
  PERFORM "phase7_require_runtime_ready"();
  IF expected_password_hash IS NULL OR new_password_hash IS NULL
    OR char_length(new_password_hash) NOT BETWEEN 1 AND 4096
    OR new_password_hash = expected_password_hash THEN
    RETURN false;
  END IF;

  SELECT target_user."authorityGeneration" INTO prior_generation
  FROM "User" AS target_user
  WHERE "id" = target_user_id AND "accountStatus" = 'ACTIVE'
  FOR UPDATE;
  IF prior_generation IS NULL THEN RETURN false; END IF;
  PERFORM 1 FROM "Verification"
  WHERE "resetUserId" = target_user_id ORDER BY "id" FOR UPDATE;
  SELECT "id" INTO credential_id FROM "Account"
  WHERE "userId" = target_user_id
    AND "providerId" = 'credential'
    AND "password" IS NOT DISTINCT FROM expected_password_hash
  FOR UPDATE;
  IF credential_id IS NULL THEN RETURN false; END IF;
  PERFORM 1 FROM "AuthSessionFamily"
  WHERE "userId" = target_user_id ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "Session"
  WHERE "userId" = target_user_id ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "AuthSessionRotationFence"
  WHERE "userId" = target_user_id ORDER BY "id" FOR UPDATE;

  execution_id := "phase7_open_trusted_execution"(
    'PASSWORD_CHANGE', target_user_id, NULL
  );
  UPDATE "Account"
  SET "password" = new_password_hash, "updatedAt" = clock_timestamp()
  WHERE "id" = credential_id
    AND "userId" = target_user_id
    AND "providerId" = 'credential'
    AND "password" IS NOT DISTINCT FROM expected_password_hash;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count <> 1 THEN
    RAISE EXCEPTION 'Credential password compare-and-swap failed.'
      USING ERRCODE = '40001';
  END IF;
  SELECT target_user."authorityGeneration" INTO result_generation
  FROM "User" AS target_user WHERE target_user."id" = target_user_id;
  IF result_generation IS DISTINCT FROM prior_generation + 1 THEN
    RAISE EXCEPTION 'Password change authority generation did not advance once.'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "Session" WHERE "userId" = target_user_id)
    OR EXISTS (
      SELECT 1 FROM "AuthSessionFamily"
      WHERE "userId" = target_user_id AND "status" = 'ACTIVE'
    ) THEN
    RAISE EXCEPTION 'Password change did not close all prior authority.'
      USING ERRCODE = '23514';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN true;
END;
$function$;

CREATE FUNCTION "phase7_change_password_v1"(
  raw_session_token TEXT,
  expected_password_hash TEXT,
  new_password_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  target_user_id UUID;
  target_family_id UUID;
  target_session_id UUID;
  checked_at TIMESTAMPTZ(3);
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(NULL);
  PERFORM "phase7_require_runtime_ready"();
  IF raw_session_token IS NULL OR raw_session_token = ''
    OR expected_password_hash IS NULL OR new_password_hash IS NULL
    OR expected_password_hash = new_password_hash THEN
    RETURN false;
  END IF;

  SELECT session."userId", session."sessionFamilyId", session."id"
  INTO target_user_id, target_family_id, target_session_id
  FROM "Session" AS session
  WHERE session."token" = raw_session_token;
  IF target_user_id IS NULL OR target_family_id IS NULL
    OR target_session_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM 1 FROM "User"
  WHERE "id" = target_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM "Verification"
  WHERE "resetUserId" = target_user_id ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "Account"
  WHERE "userId" = target_user_id AND "providerId" = 'credential'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM "AuthSessionFamily"
  WHERE "userId" = target_user_id ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "Session"
  WHERE "userId" = target_user_id ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "AuthSessionRotationFence"
  WHERE "userId" = target_user_id ORDER BY "id" FOR UPDATE;

  checked_at := clock_timestamp();
  PERFORM 1
  FROM "User" AS target_user
  JOIN "Account" AS credential
    ON credential."userId" = target_user."id"
   AND credential."providerId" = 'credential'
   AND credential."accountId" = target_user."id"::TEXT
   AND credential."password" IS NOT DISTINCT FROM expected_password_hash
  JOIN "AuthSessionFamily" AS family
    ON family."id" = target_family_id
   AND family."userId" = target_user."id"
  JOIN "Session" AS session
    ON session."id" = target_session_id
   AND session."userId" = target_user."id"
   AND session."sessionFamilyId" = family."id"
  WHERE target_user."id" = target_user_id
    AND target_user."accountStatus" = 'ACTIVE'
    AND family."status" = 'ACTIVE'
    AND session."token" = raw_session_token
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorityGeneration" = target_user."authorityGeneration"
    AND session."expiresAt" > checked_at
    AND session."createdAt" + INTERVAL '30 days' > checked_at;
  IF NOT FOUND THEN RETURN false; END IF;

  RETURN "phase7_change_password"(
    target_user_id,
    expected_password_hash,
    new_password_hash
  );
END;
$function$;

-- Resolve eligibility and issue the reset intent under one User lock. Only a
-- boolean crosses the gateway boundary: identity and credential fields remain
-- in the database. Missing/non-eligible requests take a bounded selector probe
-- and perform no write; the gateway response floor masks read/write variance.
CREATE FUNCTION "phase7_request_password_reset"(
  normalized_email TEXT,
  verification_id UUID,
  raw_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  selector_value TEXT;
  target_user_id UUID;
  captured_generation INTEGER;
  execution_id UUID;
  event_time TIMESTAMPTZ(3);
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(NULL);
  PERFORM "phase7_require_runtime_ready"();
  PERFORM 1 FROM "AuthIssuerActivation"
  WHERE "id" = 1 AND "legacyIssuerDisabled"
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V1 password reset issuance is not activated.'
      USING ERRCODE = '42501';
  END IF;
  IF normalized_email IS NULL OR normalized_email = ''
    OR normalized_email <> lower(btrim(normalized_email))
    OR verification_id IS NULL OR raw_token IS NULL OR raw_token = '' THEN
    RETURN false;
  END IF;

  selector_value := encode(public.digest(
    convert_to('nihongo-password-reset-v1', 'UTF8')
      || decode('00', 'hex') || convert_to(raw_token, 'UTF8'),
    'sha256'::TEXT
  ), 'hex');

  SELECT target_user."id"
  INTO target_user_id
  FROM "User" AS target_user
  JOIN "Account" AS credential
    ON credential."userId" = target_user."id"
   AND credential."providerId" = 'credential'
   AND credential."accountId" = target_user."id"::TEXT
   AND credential."password" IS NOT NULL
   AND credential."accessToken" IS NULL
   AND credential."refreshToken" IS NULL
   AND credential."idToken" IS NULL
  WHERE target_user."email" = normalized_email
    AND target_user."accountStatus" = 'ACTIVE'
  LIMIT 1;

  IF target_user_id IS NULL THEN
    -- The selector is freshly generated by the server, so this unique-index
    -- probe exercises the same three auth tables without returning a row.
    PERFORM 1
    FROM "Verification" AS verification
    JOIN "User" AS target_user
      ON target_user."id" = verification."resetUserId"
    JOIN "Account" AS credential
      ON credential."userId" = target_user."id"
     AND credential."providerId" = 'credential'
     AND credential."accountId" = target_user."id"::TEXT
     AND credential."password" IS NOT NULL
    WHERE verification."purpose" = 'PASSWORD_RESET_V1'
      AND verification."tokenSelector" = selector_value
    LIMIT 1;
    RETURN false;
  END IF;

  SELECT target_user."authorityGeneration" INTO captured_generation
  FROM "User" AS target_user
  WHERE target_user."id" = target_user_id
    AND target_user."email" = normalized_email
    AND target_user."accountStatus" = 'ACTIVE'
  FOR UPDATE;
  IF captured_generation IS NULL THEN RETURN false; END IF;

  PERFORM 1
  FROM "Verification"
  WHERE "resetUserId" = target_user_id ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "Account"
  WHERE "userId" = target_user_id
    AND "providerId" = 'credential'
    AND "accountId" = target_user_id::TEXT
    AND "password" IS NOT NULL
    AND "accessToken" IS NULL
    AND "refreshToken" IS NULL
    AND "idToken" IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  event_time := clock_timestamp();
  execution_id := "phase7_open_trusted_execution"(
    'RESET_ISSUE', target_user_id, NULL
  );
  DELETE FROM "Verification"
  WHERE "purpose" = 'PASSWORD_RESET_V1'
    AND "resetUserId" = target_user_id;
  INSERT INTO "Verification" (
    "id", "identifier", "value", "expiresAt", "createdAt", "updatedAt",
    "purpose", "resetUserId", "capturedGeneration", "tokenSelector"
  ) VALUES (
    verification_id, 'PASSWORD_RESET_V1', 'PASSWORD_RESET_V1',
    event_time + INTERVAL '1 hour', event_time, event_time,
    'PASSWORD_RESET_V1', target_user_id, captured_generation, selector_value
  );
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN true;
END;
$function$;

CREATE FUNCTION "phase7_consume_password_reset"(
  raw_token TEXT,
  new_password_hash TEXT
)
RETURNS TABLE ("userId" UUID, "authorityGeneration" INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  selector_value TEXT;
  verification_id UUID;
  target_user_id UUID;
  target_generation INTEGER;
  result_generation INTEGER;
  credential_id UUID;
  current_password_hash TEXT;
  execution_id UUID;
  affected_count INTEGER;
  checked_at TIMESTAMPTZ(3);
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(NULL);
  PERFORM "phase7_require_runtime_ready"();
  IF NOT EXISTS (
    SELECT 1 FROM "AuthIssuerActivation"
    WHERE "id" = 1 AND "legacyIssuerDisabled"
  ) THEN
    RAISE EXCEPTION 'V1 password reset consumption is not activated.'
      USING ERRCODE = '42501';
  END IF;
  IF raw_token IS NULL OR raw_token = '' OR new_password_hash IS NULL
    OR char_length(new_password_hash) NOT BETWEEN 1 AND 4096 THEN
    RETURN;
  END IF;
  selector_value := encode(public.digest(
    convert_to('nihongo-password-reset-v1', 'UTF8')
      || decode('00', 'hex') || convert_to(raw_token, 'UTF8'),
    'sha256'::TEXT
  ), 'hex');
  SELECT verification."id", verification."resetUserId"
  INTO verification_id, target_user_id
  FROM "Verification" AS verification
  WHERE verification."purpose" = 'PASSWORD_RESET_V1'
    AND verification."tokenSelector" = selector_value;
  IF verification_id IS NULL OR target_user_id IS NULL THEN RETURN; END IF;

  SELECT target_user."authorityGeneration" INTO target_generation
  FROM "User" AS target_user
  WHERE target_user."id" = target_user_id
    AND target_user."accountStatus" = 'ACTIVE'
  FOR UPDATE;
  IF target_generation IS NULL THEN RETURN; END IF;
  PERFORM 1 FROM "Verification" AS verification
  WHERE verification."id" = verification_id
    AND verification."purpose" = 'PASSWORD_RESET_V1'
    AND verification."resetUserId" = target_user_id
    AND verification."tokenSelector" = selector_value
    AND verification."capturedGeneration" = target_generation
    AND verification."expiresAt" > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT account."id", account."password"
  INTO credential_id, current_password_hash
  FROM "Account" AS account
  WHERE account."userId" = target_user_id
    AND account."providerId" = 'credential'
  FOR UPDATE;
  IF credential_id IS NULL
    OR current_password_hash IS NOT DISTINCT FROM new_password_hash THEN
    RETURN;
  END IF;
  PERFORM 1 FROM "AuthSessionFamily" AS family
  WHERE family."userId" = target_user_id ORDER BY family."id" FOR UPDATE;
  PERFORM 1 FROM "Session" AS session
  WHERE session."userId" = target_user_id ORDER BY session."id" FOR UPDATE;
  PERFORM 1 FROM "AuthSessionRotationFence" AS fence
  WHERE fence."userId" = target_user_id ORDER BY fence."id" FOR UPDATE;
  checked_at := clock_timestamp();
  IF NOT EXISTS (
    SELECT 1 FROM "Verification" AS verification
    WHERE verification."id" = verification_id
      AND verification."tokenSelector" = selector_value
      AND verification."capturedGeneration" = target_generation
      AND verification."expiresAt" > checked_at
  ) THEN RETURN; END IF;

  execution_id := "phase7_open_trusted_execution"(
    'RESET_CONSUME', target_user_id, NULL
  );
  DELETE FROM "Verification"
  WHERE "purpose" = 'PASSWORD_RESET_V1'
    AND "resetUserId" = target_user_id;
  UPDATE "Account" AS account
  SET "password" = new_password_hash, "updatedAt" = checked_at
  WHERE account."id" = credential_id AND account."userId" = target_user_id
    AND account."providerId" = 'credential';
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count <> 1 THEN
    RAISE EXCEPTION 'Password reset credential update failed.'
      USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Session" AS session
    WHERE session."userId" = target_user_id
  )
    OR EXISTS (
      SELECT 1 FROM "AuthSessionFamily" AS family
      WHERE family."userId" = target_user_id AND family."status" = 'ACTIVE'
    ) THEN
    RAISE EXCEPTION 'Password reset did not close all prior authority.'
      USING ERRCODE = '23514';
  END IF;
  SELECT target_user."authorityGeneration" INTO result_generation
  FROM "User" AS target_user WHERE target_user."id" = target_user_id;
  IF result_generation IS DISTINCT FROM target_generation + 1 THEN
    RAISE EXCEPTION 'Password reset authority generation did not advance once.'
      USING ERRCODE = '23514';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN QUERY SELECT target_user_id, result_generation;
END;
$function$;

CREATE FUNCTION "phase7_issue_v1_session"(
  user_id_value UUID,
  captured_generation_value INTEGER,
  captured_role_value "UserRole",
  captured_status_value "UserAccountStatus",
  session_id_value UUID,
  token_value TEXT,
  ip_address_value TEXT,
  user_agent_value TEXT,
  remember_value BOOLEAN
)
RETURNS TABLE (
  "id" UUID,
  "familyId" UUID,
  "createdAt" TIMESTAMPTZ,
  "expiresAt" TIMESTAMPTZ,
  "authorityGeneration" INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  family_id UUID := public.gen_random_uuid();
  execution_id UUID;
  result_row "Session"%ROWTYPE;
  target_user "User"%ROWTYPE;
  issuance_checked_at TIMESTAMPTZ(3);
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(NULL);
  PERFORM "phase7_require_runtime_ready"();
  PERFORM 1 FROM "AuthIssuerActivation" AS activation
  WHERE activation."id" = 1 AND activation."legacyIssuerDisabled" FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V1 Session issuance requires activated authority.'
      USING ERRCODE = '42501';
  END IF;
  IF captured_generation_value <= 0
    OR captured_status_value <> 'ACTIVE'
    OR token_value IS NULL OR token_value = '' THEN
    RAISE EXCEPTION 'V1 Session issuance proof is malformed.'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO target_user
    FROM "User" AS locked_user
    WHERE locked_user."id" = user_id_value
    FOR UPDATE;
  IF target_user."id" IS NULL
    OR target_user."authorityGeneration" IS DISTINCT FROM captured_generation_value
    OR target_user."role" IS DISTINCT FROM captured_role_value
    OR target_user."accountStatus" IS DISTINCT FROM captured_status_value THEN
    RAISE EXCEPTION 'V1 Session issuance proof is stale.' USING ERRCODE = '42501';
  END IF;
  execution_id := "phase7_open_trusted_execution"(
    'ISSUE_V1', user_id_value, remember_value
  );
  INSERT INTO "AuthSessionFamily" ("id", "userId")
  VALUES (family_id, user_id_value);
  INSERT INTO "Session" (
    "id", "expiresAt", "token", "createdAt", "updatedAt", "ipAddress",
    "userAgent", "userId", "sessionFamilyId", "authorityGeneration",
    "issuerProtocolVersion"
  ) VALUES (
    session_id_value, clock_timestamp() + CASE WHEN remember_value
      THEN INTERVAL '7 days' ELSE INTERVAL '1 day' END, token_value,
    clock_timestamp(), clock_timestamp(), ip_address_value, user_agent_value,
    user_id_value, family_id, captured_generation_value, 'PHASE7_V1'
  ) RETURNING * INTO result_row;

  issuance_checked_at := clock_timestamp();
  PERFORM 1
  FROM "User" AS locked_user
  JOIN "AuthSessionFamily" AS family
    ON family."userId" = locked_user."id" AND family."id" = family_id
  JOIN "Session" AS session
    ON session."userId" = locked_user."id"
   AND session."sessionFamilyId" = family."id"
   AND session."id" = result_row."id"
  WHERE locked_user."id" = user_id_value
    AND locked_user."authorityGeneration" = captured_generation_value
    AND locked_user."role" = captured_role_value
    AND locked_user."accountStatus" = captured_status_value
    AND family."status" = 'ACTIVE'
    AND session."token" = token_value
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorityGeneration" = captured_generation_value
    AND session."expiresAt" > issuance_checked_at
    AND session."createdAt" + INTERVAL '30 days' > issuance_checked_at
  FOR UPDATE OF session;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V1 Session lost authority before issuance completed.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN QUERY SELECT result_row."id", result_row."sessionFamilyId",
    result_row."createdAt", result_row."expiresAt",
    result_row."authorityGeneration";
END;
$function$;

CREATE FUNCTION "phase7_confirm_v1_session_issuance"(
  raw_token TEXT,
  expected_session_id UUID,
  expected_user_id UUID,
  captured_generation_value INTEGER,
  captured_role_value "UserRole",
  captured_status_value "UserAccountStatus"
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  target_family_id UUID;
  checked_at TIMESTAMPTZ(3);
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(NULL);
  PERFORM "phase7_require_runtime_ready"();
  IF raw_token IS NULL OR raw_token = ''
    OR expected_session_id IS NULL OR expected_user_id IS NULL
    OR captured_generation_value IS NULL OR captured_generation_value <= 0
    OR captured_role_value IS NULL
    OR captured_status_value IS DISTINCT FROM 'ACTIVE' THEN
    RETURN false;
  END IF;

  SELECT session."sessionFamilyId" INTO target_family_id
  FROM "Session" AS session
  WHERE session."id" = expected_session_id
    AND session."userId" = expected_user_id
    AND session."token" = raw_token;
  IF target_family_id IS NULL THEN RETURN false; END IF;

  PERFORM 1 FROM "User" AS target_user
  WHERE target_user."id" = expected_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM "AuthSessionFamily" AS family
  WHERE family."id" = target_family_id
    AND family."userId" = expected_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM "Session" AS session
  WHERE session."id" = expected_session_id
    AND session."userId" = expected_user_id
    AND session."sessionFamilyId" = target_family_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  checked_at := clock_timestamp();
  RETURN EXISTS (
    SELECT 1
    FROM "User" AS target_user
    JOIN "AuthSessionFamily" AS family
      ON family."userId" = target_user."id"
     AND family."id" = target_family_id
    JOIN "Session" AS session
      ON session."userId" = target_user."id"
     AND session."sessionFamilyId" = family."id"
     AND session."id" = expected_session_id
    WHERE target_user."id" = expected_user_id
      AND target_user."authorityGeneration" = captured_generation_value
      AND target_user."role" = captured_role_value
      AND target_user."accountStatus" = captured_status_value
      AND family."status" = 'ACTIVE'
      AND session."token" = raw_token
      AND session."issuerProtocolVersion" = 'PHASE7_V1'
      AND session."authorityGeneration" = captured_generation_value
      AND session."expiresAt" > checked_at
      AND session."createdAt" + INTERVAL '30 days' > checked_at
  );
END;
$function$;

CREATE FUNCTION "phase7_reauthentication_commit_matches"(
  old_token_digest_value TEXT,
  new_session_id_value UUID,
  new_token_value TEXT,
  operation_id_value UUID,
  request_id_value UUID,
  environment_value "AdminAuditEnvironment",
  captured_generation_value INTEGER,
  captured_role_value "UserRole",
  captured_status_value "UserAccountStatus"
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  checked_at TIMESTAMPTZ(3) := clock_timestamp();
  metadata_value JSONB :=
    '{"kind":"REAUTHENTICATION_V1","rotation":"OLD_REVOKED_NEW_ISSUED"}'::JSONB;
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM "AuthSessionRotationFence" AS fence
    JOIN "Session" AS session
      ON session."id" = fence."replacementSessionId"
     AND session."userId" = fence."userId"
     AND session."sessionFamilyId" = fence."replacementFamilyId"
    JOIN "AuthSessionFamily" AS family
      ON family."userId" = fence."userId"
     AND family."id" = fence."replacementFamilyId"
    JOIN "User" AS target_user ON target_user."id" = fence."userId"
    JOIN "AdminAuditLog" AS audit
      ON audit."operationId" = fence."operationId"
     AND audit."command" = 'REAUTHENTICATION'
     AND audit."targetType" = 'ADMIN_SESSION'
     AND audit."targetId" = fence."operationId"
    WHERE fence."operationId" = operation_id_value
      AND fence."oldTokenDigest" = old_token_digest_value
      AND fence."oldFamilyId" = fence."replacementFamilyId"
      AND fence."replacementSessionId" = new_session_id_value
      AND session."token" = new_token_value
      AND target_user."authorityGeneration" = captured_generation_value
      AND target_user."role" = captured_role_value
      AND target_user."accountStatus" = captured_status_value
      AND family."status" = 'ACTIVE'
      AND session."issuerProtocolVersion" = 'PHASE7_V1'
      AND session."authorityGeneration" = captured_generation_value
      AND session."expiresAt" > checked_at
      AND session."createdAt" + INTERVAL '30 days' > checked_at
      AND audit."requestId" = request_id_value
      AND audit."environment" = environment_value
      AND audit."actorKind" = 'ACCOUNT'
      AND audit."actorUserId" = fence."userId"
      AND audit."actorId" = fence."userId"
      AND audit."actorRole" = 'ADMIN'
      AND audit."actorLabel" = 'ACTIVE_ADMIN'
      AND audit."actorSystemLabel" IS NULL
      AND audit."beforeState" IN ('SESSION_STALE', 'SESSION_FRESH')
      AND audit."afterState" = 'SESSION_FRESH'
      AND audit."beforeRowVersion" IS NULL
      AND audit."afterRowVersion" IS NULL
      AND audit."changedFields" = '["SESSION_ROTATION"]'::JSONB
      AND audit."metadata" = metadata_value
      AND audit."contentDigest" = "phase7_admin_audit_content_digest"(
        operation_id_value, 'REAUTHENTICATION', 'ADMIN_SESSION',
        operation_id_value, audit."beforeState", 'SESSION_FRESH', NULL, NULL,
        '["SESSION_ROTATION"]'::JSONB, metadata_value
      )
  );
END;
$function$;

CREATE FUNCTION "phase7_reauthenticate_v1_session"(
  raw_old_token TEXT,
  captured_generation_value INTEGER,
  captured_role_value "UserRole",
  captured_status_value "UserAccountStatus",
  new_session_id UUID,
  new_token TEXT,
  ip_address_value TEXT,
  user_agent_value TEXT,
  operation_id_value UUID,
  request_id_value UUID,
  environment_value "AdminAuditEnvironment"
)
RETURNS TABLE (
  "id" UUID,
  "familyId" UUID,
  "createdAt" TIMESTAMPTZ,
  "expiresAt" TIMESTAMPTZ,
  "authorityGeneration" INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  old_token_digest TEXT;
  target_user_id UUID;
  target_family_id UUID;
  old_session_id UUID;
  old_created_at TIMESTAMPTZ(3);
  old_expires_at TIMESTAMPTZ(3);
  authority_checked_at TIMESTAMPTZ(3);
  authority_commit_checked_at TIMESTAMPTZ(3);
  before_state TEXT;
  execution_id UUID;
  deleted_session "Session"%ROWTYPE;
  result_row "Session"%ROWTYPE;
  metadata_value JSONB :=
    '{"kind":"REAUTHENTICATION_V1","rotation":"OLD_REVOKED_NEW_ISSUED"}'::JSONB;
  digest_value VARCHAR(64);
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(environment_value);
  PERFORM "phase7_require_runtime_ready"();
  PERFORM 1 FROM "AuthIssuerActivation" AS activation
  WHERE activation."id" = 1 AND activation."legacyIssuerDisabled" FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V1 reauthentication requires activated authority.'
      USING ERRCODE = '42501';
  END IF;
  IF raw_old_token IS NULL OR raw_old_token = ''
    OR new_token IS NULL OR new_token = ''
    OR captured_generation_value <= 0
    OR captured_role_value <> 'ADMIN'
    OR captured_status_value <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Reauthentication proof is malformed.'
      USING ERRCODE = '42501';
  END IF;
  old_token_digest := encode(public.digest(
    convert_to('nihongo-auth-session-rotation-fence-v1', 'UTF8')
      || decode('00', 'hex') || convert_to(raw_old_token, 'UTF8'),
    'sha256'::TEXT
  ), 'hex');

  -- An exact prior operation is authoritative after an unknown commit result.
  IF "phase7_reauthentication_commit_matches"(
    old_token_digest, new_session_id, new_token, operation_id_value,
    request_id_value, environment_value, captured_generation_value,
    captured_role_value, captured_status_value
  ) THEN
    SELECT session.* INTO result_row
    FROM "AuthSessionRotationFence" AS fence
    JOIN "Session" AS session ON session."id" = fence."replacementSessionId"
    WHERE fence."operationId" = operation_id_value;
    RETURN QUERY SELECT result_row."id", result_row."sessionFamilyId",
      result_row."createdAt", result_row."expiresAt",
      result_row."authorityGeneration";
    RETURN;
  END IF;

  SELECT session."userId", session."sessionFamilyId", session."id",
    session."createdAt", session."expiresAt"
  INTO target_user_id, target_family_id, old_session_id,
    old_created_at, old_expires_at
  FROM "Session" AS session
  WHERE session."token" = raw_old_token;
  IF target_user_id IS NULL THEN
    IF "phase7_reauthentication_commit_matches"(
      old_token_digest, new_session_id, new_token, operation_id_value,
      request_id_value, environment_value, captured_generation_value,
      captured_role_value, captured_status_value
    ) THEN
      SELECT session.* INTO result_row
      FROM "AuthSessionRotationFence" AS fence
      JOIN "Session" AS session ON session."id" = fence."replacementSessionId"
      WHERE fence."operationId" = operation_id_value;
      RETURN QUERY SELECT result_row."id", result_row."sessionFamilyId",
        result_row."createdAt", result_row."expiresAt",
        result_row."authorityGeneration";
      RETURN;
    END IF;
    RAISE EXCEPTION 'Reauthentication Session is unavailable.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM "User" AS target_user
  WHERE target_user."id" = target_user_id FOR UPDATE;
  -- A competing retry must release this User lock before it commits; re-read
  -- its exact fence/audit/session proof before attempting any local write.
  IF "phase7_reauthentication_commit_matches"(
    old_token_digest, new_session_id, new_token, operation_id_value,
    request_id_value, environment_value, captured_generation_value,
    captured_role_value, captured_status_value
  ) THEN
    SELECT session.* INTO result_row
    FROM "AuthSessionRotationFence" AS fence
    JOIN "Session" AS session ON session."id" = fence."replacementSessionId"
    WHERE fence."operationId" = operation_id_value;
    RETURN QUERY SELECT result_row."id", result_row."sessionFamilyId",
      result_row."createdAt", result_row."expiresAt",
      result_row."authorityGeneration";
    RETURN;
  END IF;
  PERFORM 1 FROM "Account" AS credential
  WHERE credential."userId" = target_user_id
    AND credential."providerId" = 'credential'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reauthentication credential is unavailable.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM "AuthSessionFamily" AS family
  WHERE family."id" = target_family_id AND family."userId" = target_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reauthentication family is unavailable.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM "Session" AS session
  WHERE session."id" IN (old_session_id, new_session_id)
  ORDER BY session."id" FOR UPDATE;
  authority_checked_at := clock_timestamp();
  PERFORM 1
  FROM "User" AS target_user
  JOIN "AuthSessionFamily" AS family
    ON family."userId" = target_user."id" AND family."id" = target_family_id
  JOIN "Session" AS session
    ON session."userId" = target_user."id"
   AND session."sessionFamilyId" = family."id"
   AND session."id" = old_session_id
  WHERE target_user."id" = target_user_id
    AND target_user."authorityGeneration" = captured_generation_value
    AND target_user."role" = captured_role_value
    AND target_user."accountStatus" = captured_status_value
    AND family."status" = 'ACTIVE'
    AND session."token" = raw_old_token
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorityGeneration" = captured_generation_value
    AND session."expiresAt" > authority_checked_at
    AND session."createdAt" + INTERVAL '30 days' > authority_checked_at
  FOR UPDATE OF session;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reauthentication authority is stale.'
      USING ERRCODE = '42501';
  END IF;
  before_state := CASE
    WHEN old_created_at + INTERVAL '5 minutes' > authority_checked_at
      THEN 'SESSION_FRESH'
    ELSE 'SESSION_STALE'
  END;

  INSERT INTO "Phase7OperationIntent" (
    "operationId", "requestId", "command", "actorUserId",
    "actorSessionId", "actorFamilyId", "capturedAuthorityGeneration",
    "referencedUserIds", "requiresFresh", "environment", "occurredAt",
    "backendPid", "transactionId"
  ) VALUES (
    operation_id_value, request_id_value, 'REAUTHENTICATION', target_user_id,
    new_session_id, target_family_id, captured_generation_value,
    ARRAY[target_user_id]::UUID[], false, environment_value,
    authority_checked_at, pg_backend_pid(), txid_current()
  );
  execution_id := "phase7_open_trusted_execution"(
    'REAUTHENTICATE', target_user_id, false
  );
  INSERT INTO "Session" (
    "id", "expiresAt", "token", "createdAt", "updatedAt", "ipAddress",
    "userAgent", "userId", "sessionFamilyId", "authorityGeneration",
    "issuerProtocolVersion"
  ) VALUES (
    new_session_id, authority_checked_at + INTERVAL '1 day', new_token,
    authority_checked_at, authority_checked_at, ip_address_value,
    user_agent_value, target_user_id, target_family_id,
    captured_generation_value, 'PHASE7_V1'
  ) RETURNING * INTO result_row;

  DELETE FROM "Session" AS session
  WHERE session."id" = old_session_id
    AND session."token" = raw_old_token
    AND session."userId" = target_user_id
    AND session."sessionFamilyId" = target_family_id
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorityGeneration" = captured_generation_value
    AND session."expiresAt" > authority_checked_at
    AND session."createdAt" + INTERVAL '30 days' > authority_checked_at
  RETURNING session.* INTO deleted_session;
  IF deleted_session."id" IS NULL
    OR deleted_session."id" IS DISTINCT FROM old_session_id
    OR deleted_session."userId" IS DISTINCT FROM target_user_id
    OR deleted_session."sessionFamilyId" IS DISTINCT FROM target_family_id THEN
    -- With the User lock held an overlapping exact retry is normally resolved
    -- by the post-lock check above. This final lookup also distinguishes an
    -- authoritative prior commit from a stale/mismatched CAS before rollback.
    IF "phase7_reauthentication_commit_matches"(
      old_token_digest, new_session_id, new_token, operation_id_value,
      request_id_value, environment_value, captured_generation_value,
      captured_role_value, captured_status_value
    ) THEN
      RAISE EXCEPTION 'Authoritative reauthentication appeared after local CAS.'
        USING ERRCODE = '40001';
    END IF;
    RAISE EXCEPTION 'Reauthentication old Session CAS failed.'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO "AuthSessionRotationFence" (
    "oldSessionId", "oldTokenDigest", "userId", "oldFamilyId",
    "replacementFamilyId", "replacementSessionId", "operationId", "expiresAt"
  ) VALUES (
    deleted_session."id", old_token_digest, target_user_id, target_family_id,
    target_family_id, result_row."id", operation_id_value,
    result_row."expiresAt"
  );
  digest_value := "phase7_admin_audit_content_digest"(
    operation_id_value, 'REAUTHENTICATION', 'ADMIN_SESSION',
    operation_id_value, before_state, 'SESSION_FRESH', NULL, NULL,
    '["SESSION_ROTATION"]'::JSONB, metadata_value
  );
  INSERT INTO "AdminAuditLog" (
    "command", "targetType", "targetId", "actorKind", "actorUserId",
    "actorId", "actorRole", "actorLabel", "actorSystemLabel",
    "beforeState", "afterState", "beforeRowVersion", "afterRowVersion",
    "changedFields", "metadata", "contentDigest", "operationId",
    "requestId", "environment", "occurredAt"
  ) VALUES (
    'REAUTHENTICATION', 'ADMIN_SESSION', operation_id_value,
    'ACCOUNT', target_user_id, target_user_id, 'ADMIN', 'ACTIVE_ADMIN', NULL,
    before_state, 'SESSION_FRESH', NULL, NULL,
    '["SESSION_ROTATION"]'::JSONB, metadata_value, digest_value,
    operation_id_value, request_id_value, environment_value,
    authority_checked_at
  );

  authority_commit_checked_at := clock_timestamp();
  IF old_expires_at <= authority_commit_checked_at
    OR old_created_at + INTERVAL '30 days' <= authority_commit_checked_at
    OR NOT EXISTS (
      SELECT 1
      FROM "User" AS target_user
      JOIN "AuthSessionFamily" AS family
        ON family."userId" = target_user."id" AND family."id" = target_family_id
      JOIN "Session" AS session
        ON session."userId" = target_user."id"
       AND session."sessionFamilyId" = family."id"
       AND session."id" = result_row."id"
      WHERE target_user."id" = target_user_id
        AND target_user."authorityGeneration" = captured_generation_value
        AND target_user."role" = 'ADMIN'
        AND target_user."accountStatus" = 'ACTIVE'
        AND family."status" = 'ACTIVE'
        AND session."token" = new_token
        AND session."issuerProtocolVersion" = 'PHASE7_V1'
        AND session."authorityGeneration" = captured_generation_value
        AND session."expiresAt" > authority_commit_checked_at
        AND session."createdAt" + INTERVAL '30 days' > authority_commit_checked_at
    ) THEN
    RAISE EXCEPTION 'Reauthentication authority expired before commit.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  PERFORM "phase7_finish_admin_operation"(operation_id_value);
  RETURN QUERY SELECT result_row."id", result_row."sessionFamilyId",
    result_row."createdAt", result_row."expiresAt",
    result_row."authorityGeneration";
END;
$function$;

CREATE FUNCTION "phase7_owned_sign_out"(raw_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  token_digest TEXT;
  target_user_id UUID;
  target_family_id UUID;
  execution_id UUID;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(NULL);
  PERFORM "phase7_require_runtime_ready"();
  token_digest := encode(public.digest(
    convert_to('nihongo-auth-session-rotation-fence-v1', 'UTF8')
      || decode('00', 'hex') || convert_to(raw_token, 'UTF8'),
    'sha256'::TEXT
  ), 'hex');
  SELECT session."userId", session."sessionFamilyId"
  INTO target_user_id, target_family_id
  FROM "Session" AS session WHERE session."token" = raw_token
  UNION ALL
  SELECT fence."userId", fence."replacementFamilyId"
  FROM "AuthSessionRotationFence" AS fence
  WHERE fence."oldTokenDigest" = token_digest
  LIMIT 1;
  IF target_family_id IS NULL THEN RETURN true; END IF;

  PERFORM 1 FROM "User" WHERE "id" = target_user_id FOR UPDATE;
  PERFORM 1 FROM "AuthSessionFamily"
    WHERE "id" = target_family_id AND "userId" = target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned sign-out family is unavailable.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM "Session"
    WHERE "sessionFamilyId" = target_family_id
    ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "AuthSessionRotationFence"
    WHERE "userId" = target_user_id
      AND "replacementFamilyId" = target_family_id
    ORDER BY "id" FOR UPDATE;
  execution_id := "phase7_open_trusted_execution"(
    'SIGN_OUT', target_user_id, NULL
  );
  UPDATE "AuthSessionFamily" SET "status" = 'REVOKED'
    WHERE "id" = target_family_id AND "status" = 'ACTIVE';
  DELETE FROM "Session" WHERE "sessionFamilyId" = target_family_id;
  IF EXISTS (
    SELECT 1 FROM "Session" WHERE "sessionFamilyId" = target_family_id
  ) OR NOT EXISTS (
    SELECT 1 FROM "AuthSessionFamily"
    WHERE "id" = target_family_id AND "userId" = target_user_id
      AND "status" = 'REVOKED'
  ) THEN
    RAISE EXCEPTION 'Owned sign-out could not clear the Session family.'
      USING ERRCODE = '23514';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN true;
END;
$function$;

CREATE FUNCTION "phase7_refresh_remembered_session"(
  raw_token TEXT,
  captured_generation_value INTEGER,
  captured_role_value "UserRole",
  captured_status_value "UserAccountStatus"
)
RETURNS TABLE (
  "id" UUID,
  "updatedAt" TIMESTAMPTZ,
  "expiresAt" TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  target_user_id UUID;
  target_family_id UUID;
  target_session_id UUID;
  checked_at TIMESTAMPTZ(3);
  commit_checked_at TIMESTAMPTZ(3);
  execution_id UUID;
  result_row "Session"%ROWTYPE;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(NULL);
  PERFORM "phase7_require_runtime_ready"();
  SELECT session."userId", session."sessionFamilyId", session."id"
  INTO target_user_id, target_family_id, target_session_id
  FROM "Session" AS session WHERE session."token" = raw_token;
  IF target_session_id IS NULL THEN RETURN; END IF;
  PERFORM 1 FROM "User" AS target_user
  WHERE target_user."id" = target_user_id FOR UPDATE;
  PERFORM 1 FROM "AuthSessionFamily" AS family
  WHERE family."id" = target_family_id
    AND family."userId" = target_user_id FOR UPDATE;
  PERFORM 1 FROM "Session" AS session
  WHERE session."id" = target_session_id FOR UPDATE;
  checked_at := clock_timestamp();
  PERFORM 1
  FROM "User" AS target_user
  JOIN "AuthSessionFamily" AS family
    ON family."userId" = target_user."id" AND family."id" = target_family_id
  JOIN "Session" AS session
    ON session."userId" = target_user."id"
   AND session."sessionFamilyId" = family."id"
   AND session."id" = target_session_id
  WHERE target_user."id" = target_user_id
    AND target_user."authorityGeneration" = captured_generation_value
    AND target_user."role" = captured_role_value
    AND target_user."accountStatus" = captured_status_value
    AND family."status" = 'ACTIVE'
    AND session."token" = raw_token
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorityGeneration" = captured_generation_value
    AND session."expiresAt" > checked_at
    AND session."createdAt" + INTERVAL '30 days' > checked_at
    AND session."expiresAt" > session."createdAt" + INTERVAL '1 day'
  FOR UPDATE OF session;
  IF NOT FOUND THEN RETURN; END IF;

  execution_id := "phase7_open_trusted_execution"(
    'REFRESH', target_user_id, true
  );
  UPDATE "Session" AS target_session
  SET "expiresAt" = target_session."expiresAt",
      "updatedAt" = target_session."updatedAt"
  WHERE target_session."id" = target_session_id
  RETURNING target_session.* INTO result_row;
  commit_checked_at := clock_timestamp();
  IF result_row."id" IS NULL OR NOT EXISTS (
    SELECT 1
    FROM "User" AS target_user
    JOIN "AuthSessionFamily" AS family
      ON family."userId" = target_user."id" AND family."id" = target_family_id
    JOIN "Session" AS session
      ON session."userId" = target_user."id"
     AND session."sessionFamilyId" = family."id"
     AND session."id" = target_session_id
    WHERE target_user."id" = target_user_id
      AND target_user."authorityGeneration" = captured_generation_value
      AND target_user."role" = captured_role_value
      AND target_user."accountStatus" = captured_status_value
      AND family."status" = 'ACTIVE'
      AND session."token" = raw_token
      AND session."issuerProtocolVersion" = 'PHASE7_V1'
      AND session."authorityGeneration" = captured_generation_value
      AND session."expiresAt" > commit_checked_at
      AND session."createdAt" + INTERVAL '30 days' > commit_checked_at
  ) THEN
    RAISE EXCEPTION 'Remembered Session lost authority before refresh commit.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN QUERY SELECT result_row."id", result_row."updatedAt",
    result_row."expiresAt";
END;
$function$;

-- Runtime rolling refresh never trusts API-host time or a caller-supplied
-- authority snapshot. It resolves the current V1 proof itself and delegates to
-- the locked refresh only after the DB-owned 24-hour update window is due.
CREATE FUNCTION "phase7_refresh_current_remembered_session"(
  raw_token TEXT
)
RETURNS TABLE (
  "id" UUID,
  "updatedAt" TIMESTAMPTZ,
  "expiresAt" TIMESTAMPTZ,
  "refreshed" BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  target_session_id UUID;
  target_updated_at TIMESTAMPTZ(3);
  target_expires_at TIMESTAMPTZ(3);
  captured_generation INTEGER;
  captured_role "UserRole";
  captured_status "UserAccountStatus";
  checked_at TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_runtime_ready"();
  IF raw_token IS NULL OR raw_token = '' THEN RETURN; END IF;

  SELECT session."id", session."updatedAt", session."expiresAt",
    target_user."authorityGeneration", target_user."role",
    target_user."accountStatus"
  INTO target_session_id, target_updated_at, target_expires_at,
    captured_generation, captured_role, captured_status
  FROM "Session" AS session
  JOIN "AuthSessionFamily" AS family
    ON family."id" = session."sessionFamilyId"
   AND family."userId" = session."userId"
  JOIN "User" AS target_user ON target_user."id" = session."userId"
  WHERE session."token" = raw_token
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorityGeneration" = target_user."authorityGeneration"
    AND target_user."accountStatus" = 'ACTIVE'
    AND family."status" = 'ACTIVE'
    AND session."expiresAt" > checked_at
    AND session."createdAt" + INTERVAL '30 days' > checked_at
    AND session."expiresAt" > session."createdAt" + INTERVAL '1 day';
  IF target_session_id IS NULL THEN RETURN; END IF;

  IF target_updated_at + INTERVAL '24 hours' > checked_at THEN
    RETURN QUERY SELECT target_session_id, target_updated_at,
      target_expires_at, false;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT refreshed_session."id", refreshed_session."updatedAt",
    refreshed_session."expiresAt", true
  FROM "phase7_refresh_remembered_session"(
    raw_token,
    captured_generation,
    captured_role,
    captured_status
  ) AS refreshed_session;
END;
$function$;

CREATE FUNCTION "phase7_change_user_authority"(
  raw_actor_token TEXT,
  target_user_id UUID,
  expected_target_generation INTEGER,
  new_role "UserRole",
  new_status "UserAccountStatus",
  environment_value "AdminAuditEnvironment"
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  actor_user_id UUID;
  actor_family_id UUID;
  actor_session_id UUID;
  target_user "User"%ROWTYPE;
  checked_at TIMESTAMPTZ(3);
  commit_checked_at TIMESTAMPTZ(3);
  execution_id UUID;
  result_generation INTEGER;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_database_capability"(environment_value);
  PERFORM "phase7_require_runtime_ready"();
  SELECT session."userId", session."sessionFamilyId", session."id"
  INTO actor_user_id, actor_family_id, actor_session_id
  FROM "Session" AS session WHERE session."token" = raw_actor_token;
  IF actor_user_id IS NULL OR actor_user_id = target_user_id THEN
    RAISE EXCEPTION 'Authority change requires a distinct ADMIN actor.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM "User"
  WHERE "id" IN (actor_user_id, target_user_id)
  ORDER BY "id" FOR UPDATE;
  SELECT * INTO target_user FROM "User" WHERE "id" = target_user_id;
  IF target_user."id" IS NULL
    OR target_user."authorityGeneration" <> expected_target_generation
    OR target_user."accountStatus" = 'DELETED'
    OR ((target_user."role" IS DISTINCT FROM new_role)::INTEGER
      + (target_user."accountStatus" IS DISTINCT FROM new_status)::INTEGER) <> 1
    OR (target_user."accountStatus" IS DISTINCT FROM new_status
      AND NOT (
        (target_user."accountStatus" = 'ACTIVE'
          AND new_status = 'DELETION_PENDING')
        OR (target_user."accountStatus" = 'DELETION_PENDING'
          AND new_status = 'ACTIVE')
      )) THEN
    RAISE EXCEPTION 'Target authority transition is stale or invalid.'
      USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM "Verification"
  WHERE "resetUserId" = target_user_id ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "Account"
  WHERE "userId" = target_user_id ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "AuthSessionFamily"
  WHERE "userId" IN (actor_user_id, target_user_id)
  ORDER BY "userId", "id" FOR UPDATE;
  PERFORM 1 FROM "Session"
  WHERE "userId" IN (actor_user_id, target_user_id)
  ORDER BY "userId", "id" FOR UPDATE;
  PERFORM 1 FROM "AuthSessionRotationFence"
  WHERE "userId" = target_user_id ORDER BY "id" FOR UPDATE;

  checked_at := clock_timestamp();
  PERFORM 1
  FROM "User" AS actor
  JOIN "AuthSessionFamily" AS family
    ON family."userId" = actor."id" AND family."id" = actor_family_id
  JOIN "Session" AS session
    ON session."userId" = actor."id"
   AND session."sessionFamilyId" = family."id"
   AND session."id" = actor_session_id
  WHERE actor."id" = actor_user_id
    AND actor."role" = 'ADMIN' AND actor."accountStatus" = 'ACTIVE'
    AND family."status" = 'ACTIVE'
    AND session."token" = raw_actor_token
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorityGeneration" = actor."authorityGeneration"
    AND session."expiresAt" > checked_at
    AND session."createdAt" + INTERVAL '30 days' > checked_at
    AND session."createdAt" + INTERVAL '5 minutes' > checked_at
  FOR UPDATE OF session;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authority-change actor is stale or not fresh.'
      USING ERRCODE = '42501';
  END IF;

  execution_id := "phase7_open_trusted_execution"(
    'AUTHORITY_CHANGE', target_user_id, NULL
  );
  UPDATE "User"
  SET "role" = new_role, "accountStatus" = new_status,
      "updatedAt" = checked_at
  WHERE "id" = target_user_id
    AND "authorityGeneration" = expected_target_generation
  RETURNING "authorityGeneration" INTO result_generation;
  IF result_generation IS NULL THEN
    RAISE EXCEPTION 'Target authority compare-and-swap failed.'
      USING ERRCODE = '40001';
  END IF;
  commit_checked_at := clock_timestamp();
  IF NOT EXISTS (
    SELECT 1
    FROM "User" AS actor
    JOIN "AuthSessionFamily" AS family
      ON family."userId" = actor."id" AND family."id" = actor_family_id
    JOIN "Session" AS session
      ON session."userId" = actor."id"
     AND session."sessionFamilyId" = family."id"
     AND session."id" = actor_session_id
    WHERE actor."id" = actor_user_id
      AND actor."role" = 'ADMIN' AND actor."accountStatus" = 'ACTIVE'
      AND family."status" = 'ACTIVE'
      AND session."token" = raw_actor_token
      AND session."issuerProtocolVersion" = 'PHASE7_V1'
      AND session."authorityGeneration" = actor."authorityGeneration"
      AND session."expiresAt" > commit_checked_at
      AND session."createdAt" + INTERVAL '30 days' > commit_checked_at
      AND session."createdAt" + INTERVAL '5 minutes' > commit_checked_at
  ) THEN
    RAISE EXCEPTION 'Authority-change actor expired before commit.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN result_generation;
END;
$function$;

CREATE FUNCTION "phase7_cleanup_expired_auth_state"(
  maximum_rows INTEGER,
  environment_value "AdminAuditEnvironment"
)
RETURNS TABLE (
  "sessionsDeleted" INTEGER,
  "fencesDeleted" INTEGER,
  "familiesDeleted" INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  execution_id UUID;
  session_count INTEGER := 0;
  fence_count INTEGER := 0;
  family_count INTEGER := 0;
  captured_at TIMESTAMPTZ(3);
  target_user_ids UUID[];
  target_family_ids UUID[];
  target_session_ids UUID[];
  target_fence_ids UUID[];
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_erasure_worker');
  PERFORM "phase7_require_database_capability"(environment_value);
  IF maximum_rows NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Auth cleanup batch size is invalid.'
      USING ERRCODE = '22023';
  END IF;

  captured_at := clock_timestamp();
  SELECT array_agg(candidate."id" ORDER BY candidate."id")
  INTO target_family_ids
  FROM (
    SELECT family."id"
    FROM "AuthSessionFamily" AS family
    WHERE family."status" = 'REVOKED'
      OR EXISTS (
        SELECT 1 FROM "Session" AS session
        WHERE session."sessionFamilyId" = family."id"
          AND (session."expiresAt" <= captured_at
            OR session."createdAt" + INTERVAL '30 days' <= captured_at)
      )
    ORDER BY family."id"
    LIMIT maximum_rows
  ) AS candidate;
  IF COALESCE(cardinality(target_family_ids), 0) = 0 THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;
  SELECT array_agg(candidate."userId" ORDER BY candidate."userId")
  INTO target_user_ids
  FROM (
    SELECT DISTINCT family."userId"
    FROM "AuthSessionFamily" AS family
    WHERE family."id" = ANY(target_family_ids)
  ) AS candidate;

  PERFORM 1 FROM "User"
  WHERE "id" = ANY(target_user_ids)
  ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "AuthSessionFamily"
  WHERE "id" = ANY(target_family_ids)
  ORDER BY "userId", "id" FOR UPDATE;

  SELECT array_agg(candidate."id" ORDER BY candidate."id")
  INTO target_session_ids
  FROM (
    SELECT session."id"
    FROM "Session" AS session
    WHERE session."sessionFamilyId" = ANY(target_family_ids)
      AND (session."expiresAt" <= captured_at
        OR session."createdAt" + INTERVAL '30 days' <= captured_at)
    ORDER BY session."id"
    LIMIT maximum_rows
  ) AS candidate;
  IF COALESCE(cardinality(target_session_ids), 0) > 0 THEN
    PERFORM 1 FROM "Session"
    WHERE "id" = ANY(target_session_ids)
    ORDER BY "userId", "id" FOR UPDATE;
  END IF;

  SELECT array_agg(candidate."id" ORDER BY candidate."id")
  INTO target_fence_ids
  FROM (
    SELECT fence."id"
    FROM "AuthSessionRotationFence" AS fence
    WHERE fence."replacementFamilyId" = ANY(target_family_ids)
      AND fence."expiresAt" <= captured_at
      AND NOT EXISTS (
        SELECT 1 FROM "Session" AS session
        WHERE session."sessionFamilyId" = fence."replacementFamilyId"
          AND session."expiresAt" > captured_at
          AND session."createdAt" + INTERVAL '30 days' > captured_at
      )
    ORDER BY fence."id"
    LIMIT maximum_rows
  ) AS candidate;
  IF COALESCE(cardinality(target_fence_ids), 0) > 0 THEN
    PERFORM 1 FROM "AuthSessionRotationFence"
    WHERE "id" = ANY(target_fence_ids)
    ORDER BY "userId", "id" FOR UPDATE;
  END IF;

  execution_id := "phase7_open_trusted_execution"(
    'FENCE_CLEANUP', NULL, NULL
  );
  DELETE FROM "Session" AS session
  WHERE session."id" = ANY(target_session_ids)
    AND session."sessionFamilyId" = ANY(target_family_ids)
    AND (session."expiresAt" <= captured_at
      OR session."createdAt" + INTERVAL '30 days' <= captured_at);
  GET DIAGNOSTICS session_count = ROW_COUNT;
  DELETE FROM "AuthSessionRotationFence" AS fence
  WHERE fence."id" = ANY(target_fence_ids)
    AND fence."replacementFamilyId" = ANY(target_family_ids)
    AND fence."expiresAt" <= captured_at
    AND NOT EXISTS (
      SELECT 1 FROM "Session" AS session
      WHERE session."sessionFamilyId" = fence."replacementFamilyId"
        AND session."expiresAt" > captured_at
        AND session."createdAt" + INTERVAL '30 days' > captured_at
    );
  GET DIAGNOSTICS fence_count = ROW_COUNT;
  DELETE FROM "AuthSessionFamily" AS family
  WHERE family."id" = ANY(target_family_ids)
    AND family."status" = 'REVOKED'
    AND NOT EXISTS (
      SELECT 1 FROM "Session" WHERE "sessionFamilyId" = family."id"
    )
    AND NOT EXISTS (
      SELECT 1 FROM "AuthSessionRotationFence"
      WHERE "oldFamilyId" = family."id"
        OR "replacementFamilyId" = family."id"
    );
  GET DIAGNOSTICS family_count = ROW_COUNT;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN QUERY SELECT session_count, fence_count, family_count;
END;
$function$;

-- Database CONNECT is owned by the NOLOGIN migration role, not the object
-- owner. This one-purpose helper is callable only by the object owner while an
-- unforgeable ACTIVATE execution row exists in the same backend/transaction.
CREATE FUNCTION "phase7_revoke_legacy_database_connect"()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  database_name TEXT := current_database();
  database_owner TEXT;
  legacy_login TEXT := CASE
    WHEN current_database() ~ '_test$' THEN 'nihongo_test_legacy_app_login'
    WHEN current_database() ~ '_dev$' THEN 'nihongo_development_legacy_app_login'
    ELSE NULL
  END;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Phase7TrustedExecution"
    WHERE "kind" = 'ACTIVATE'
      AND "backendPid" = pg_backend_pid()
      AND "transactionId" = txid_current()
  ) THEN
    RAISE EXCEPTION 'Legacy CONNECT revoke requires active V1 activation.'
      USING ERRCODE = '42501';
  END IF;
  SELECT owner_role.rolname INTO database_owner
  FROM pg_catalog.pg_database AS database_row
  JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = database_row.datdba
  WHERE database_row.datname = database_name;
  IF database_owner IS DISTINCT FROM CURRENT_USER OR legacy_login IS NULL THEN
    RAISE EXCEPTION 'Legacy CONNECT revoke requires the migration DB owner.'
      USING ERRCODE = '42501';
  END IF;
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I',
    database_name,
    legacy_login
  );
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_revoke_legacy_database_connect"() FROM PUBLIC;

CREATE FUNCTION "phase7_activate_v1_issuer"(
  environment_value "AdminAuditEnvironment"
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  database_name TEXT := current_database();
  execution_id UUID;
  target_schema TEXT;
  type_row RECORD;
  legacy_login TEXT := CASE
    WHEN current_database() ~ '_test$' THEN 'nihongo_test_legacy_app_login'
    WHEN current_database() ~ '_dev$' THEN 'nihongo_development_legacy_app_login'
    ELSE NULL
  END;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_phase7_migration');
  PERFORM "phase7_require_database_capability"(environment_value);
  IF (environment_value = 'TEST' AND database_name !~ '_test$')
    OR (environment_value = 'DEVELOPMENT' AND database_name !~ '_dev$') THEN
    RAISE EXCEPTION 'V1 activation requires an approved DB target.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM "AuthIssuerActivation" WHERE "id" = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth issuer activation singleton is missing.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM "User" ORDER BY "id" FOR UPDATE;
  IF EXISTS (
    SELECT 1
    FROM "User" AS target_user
    LEFT JOIN "Account" AS credential
      ON credential."userId" = target_user."id"
     AND credential."providerId" = 'credential'
    GROUP BY target_user."id"
    HAVING COUNT(credential."id") <> 1
  ) THEN
    RAISE EXCEPTION 'V1 activation requires one credential Account per User.'
      USING ERRCODE = '23514';
  END IF;
  execution_id := "phase7_open_trusted_execution"('ACTIVATE', NULL, NULL);
  UPDATE "AuthSessionFamily" AS family SET "status" = 'REVOKED'
  WHERE family."status" = 'ACTIVE' AND EXISTS (
    SELECT 1 FROM "Session" AS session
    WHERE session."sessionFamilyId" = family."id"
      AND session."issuerProtocolVersion" = 'LEGACY'
  );
  DELETE FROM "Session" WHERE "issuerProtocolVersion" = 'LEGACY';
  DELETE FROM "Verification" WHERE "purpose" IS NULL;
  UPDATE "AuthIssuerActivation"
  SET "legacyIssuerDisabled" = true, "updatedAt" = clock_timestamp()
  WHERE "id" = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth issuer activation did not update the singleton.'
      USING ERRCODE = '42501';
  END IF;
  SELECT namespace.nspname INTO target_schema
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE relation.oid = pg_catalog.to_regclass('"AuthIssuerActivation"');
  IF target_schema IS NULL OR legacy_login IS NULL THEN
    RAISE EXCEPTION 'Legacy compatibility ACL target is unavailable.'
      USING ERRCODE = '42501';
  END IF;
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON TABLE %I."User", %I."Session", %I."Account", %I."Verification", %I."RateLimit", %I."GuestPrincipal", %I."StudySession", %I."StudySessionQuestion", %I."StudyDraft", %I."StudyDraftAnswer", %I."Question", %I."Bookmark", %I."QuestionVersion", %I."QuestionOption", %I."Tag", %I."QuestionVersionTag", %I."StudyAnswer", %I."StudyResult", %I."WrongNote", %I."UserMemo", %I."ReviewSchedule", %I."ReviewEvent", %I."IdempotencyRecord" FROM %I',
    target_schema, target_schema, target_schema, target_schema, target_schema,
    target_schema, target_schema, target_schema, target_schema, target_schema,
    target_schema, target_schema, target_schema, target_schema, target_schema,
    target_schema, target_schema, target_schema, target_schema, target_schema,
    target_schema, target_schema, target_schema, legacy_login
  );
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON TABLE %I."_prisma_migrations" FROM %I',
    target_schema,
    legacy_login
  );
  EXECUTE pg_catalog.format(
    'DROP POLICY IF EXISTS phase7_ledger_legacy_read ON %I."_prisma_migrations"',
    target_schema
  );
  FOR type_row IN
    SELECT type_value.typname
    FROM pg_catalog.pg_type AS type_value
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = type_value.typnamespace
    WHERE namespace.nspname = target_schema
      AND type_value.typtype = 'e'
      AND type_value.typrelid = 0
      AND type_value.typname IN (
        'QuestionLifecycleStatus', 'QuestionVersionStatus', 'JlptLevel',
        'QuestionSubject', 'QuestionType', 'QuestionDifficulty',
        'QuestionSourceType', 'CreatorLabelSnapshot', 'UserRole',
        'UserAccountStatus', 'StudyMode', 'StudySessionStatus',
        'StudySessionFallbackReason', 'WrongNoteStatus',
        'ReviewEventSource', 'IdempotencyPrincipalType',
        'IdempotencyOperation', 'IdempotencyState'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_catalog.pg_type'::regclass
          AND dependency.objid = type_value.oid
          AND dependency.deptype = 'e'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE USAGE ON TYPE %I.%I FROM %I',
      target_schema,
      type_row.typname,
      legacy_login
    );
  END LOOP;
  EXECUTE pg_catalog.format(
    'REVOKE USAGE ON SCHEMA %I FROM %I',
    target_schema,
    legacy_login
  );
  PERFORM "phase7_revoke_legacy_database_connect"();
  PERFORM "phase7_close_trusted_execution"(execution_id);
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_issue_v1_session"(
  UUID, INTEGER, "UserRole", "UserAccountStatus",
  UUID, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC;
REVOKE ALL ON FUNCTION "phase7_confirm_v1_session_issuance"(
  TEXT, UUID, UUID, INTEGER, "UserRole", "UserAccountStatus"
) FROM PUBLIC;
REVOKE ALL ON FUNCTION "phase7_owned_sign_out"(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION "phase7_activate_v1_issuer"(
  "AdminAuditEnvironment"
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "anonymize_question_creator_on_user_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  operation_id UUID := public.gen_random_uuid();
  request_id UUID := public.gen_random_uuid();
  event_time TIMESTAMPTZ(3) := clock_timestamp();
  environment_value "AdminAuditEnvironment";
  abandoned_count INTEGER := 0;
  version_row RECORD;
  subject_digest TEXT;
BEGIN
  IF NOT "phase7_trusted_execution_active"('ERASURE')
    OR "phase7_trusted_execution_target"('ERASURE') IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'User delete requires a matching owned erasure intent.'
      USING ERRCODE = '42501';
  END IF;
  environment_value := "phase7_trusted_erasure_environment"();
  IF environment_value IS NULL THEN
    RAISE EXCEPTION 'Owned erasure environment is missing.'
      USING ERRCODE = '42501';
  END IF;
  INSERT INTO "Phase7OperationIntent" (
    "operationId", "requestId", "command", "actorUserId",
    "referencedUserIds", "environment", "occurredAt", "backendPid",
    "transactionId"
  ) VALUES (
    operation_id, request_id, 'AUTHOR_ERASURE_ABANDON', NULL,
    ARRAY[OLD."id"]::UUID[], environment_value, event_time,
    pg_backend_pid(), txid_current()
  );

  FOR version_row IN
    SELECT version."id", version."questionId", version."status",
      version."rowVersion", version."createdByActorId"
    FROM "QuestionVersion" AS version
    WHERE version."createdByActorId" = OLD."id"
      AND version."status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
    ORDER BY version."questionId", version."id"
    FOR UPDATE
  LOOP
    UPDATE "QuestionVersion"
    SET "status" = 'RETIRED',
        "retirementKind" = 'AUTHOR_ERASURE_ABANDONED',
        "retiredAt" = event_time,
        "updatedAt" = event_time,
        "rowVersion" = version_row."rowVersion" + 1,
        "createdByUserId" = NULL,
        "createdByLabelSnapshot" = 'DELETED_ADMIN'
    WHERE "id" = version_row."id";

    INSERT INTO "ContentReview" (
      "questionId", "questionVersionId", "action", "fromState", "toState",
      "actorKind", "actorUserId", "actorId", "actorRole", "actorLabel",
      "actorSystemLabel", "counterpartUserId", "counterpartActorId",
      "counterpartRole", "counterpartLabel", "reason", "comment",
      "operationId", "requestId", "occurredAt"
    ) VALUES (
      version_row."questionId", version_row."id",
      'AUTHOR_ERASURE_ABANDONED', version_row."status", 'RETIRED',
      'SYSTEM', NULL, NULL, 'SYSTEM', NULL, 'ACCOUNT_ERASURE',
      NULL, OLD."id", 'ADMIN', 'DELETED_ADMIN', 'AUTHOR_ERASURE', NULL,
      operation_id, request_id, event_time
    );

    INSERT INTO "AdminAuditLog" (
      "command", "targetType", "targetId", "actorKind", "actorUserId",
      "actorId", "actorRole", "actorLabel", "actorSystemLabel",
      "beforeState", "afterState", "beforeRowVersion", "afterRowVersion",
      "changedFields", "metadata", "contentDigest", "operationId",
      "requestId", "environment", "occurredAt"
    ) VALUES (
      'AUTHOR_ERASURE_ABANDON', 'QUESTION_VERSION', version_row."id",
      'SYSTEM', NULL, NULL, 'SYSTEM', NULL, 'ACCOUNT_ERASURE',
      version_row."status"::TEXT, 'RETIRED', version_row."rowVersion",
      version_row."rowVersion" + 1,
      '["VERSION_STATUS","AUTHOR_TOMBSTONE"]'::JSONB,
      '{"kind":"NONE_V1"}'::JSONB,
      "phase7_admin_audit_content_digest"(
        operation_id, 'AUTHOR_ERASURE_ABANDON', 'QUESTION_VERSION',
        version_row."id", version_row."status"::TEXT, 'RETIRED',
        version_row."rowVersion", version_row."rowVersion" + 1,
        '["VERSION_STATUS","AUTHOR_TOMBSTONE"]'::JSONB,
        '{"kind":"NONE_V1"}'::JSONB
      ), operation_id, request_id,
      environment_value, event_time
    );
    abandoned_count := abandoned_count + 1;
  END LOOP;

  UPDATE "QuestionVersion"
  SET "createdByUserId" = NULL,
      "createdByLabelSnapshot" = 'DELETED_ADMIN',
      "rowVersion" = "rowVersion" + 1,
      "updatedAt" = event_time
  WHERE "createdByActorId" = OLD."id" AND "createdByUserId" = OLD."id";

  UPDATE "Question"
  SET "createdByUserId" = NULL,
      "createdByLabelSnapshot" = 'DELETED_ADMIN',
      "rowVersion" = "rowVersion" + 1,
      "updatedAt" = event_time
  WHERE "createdByActorId" = OLD."id";

  UPDATE "Question"
  SET "rowVersion" = "rowVersion" + 1, "updatedAt" = event_time
  WHERE "createdByActorId" IS DISTINCT FROM OLD."id"
    AND "id" IN (
      SELECT DISTINCT "questionId" FROM "QuestionVersion"
      WHERE "retirementKind" = 'AUTHOR_ERASURE_ABANDONED'
        AND "retiredAt" = event_time
    );

  UPDATE "ContentReview"
  SET "actorUserId" = CASE WHEN "actorId" = OLD."id" THEN NULL ELSE "actorUserId" END,
      "actorLabel" = CASE WHEN "actorId" = OLD."id" THEN
        CASE "actorRole" WHEN 'ADMIN' THEN 'DELETED_ADMIN'::"AccountActorLabel"
          ELSE 'DELETED_USER'::"AccountActorLabel" END ELSE "actorLabel" END,
      "counterpartUserId" = CASE WHEN "counterpartActorId" = OLD."id"
        THEN NULL ELSE "counterpartUserId" END,
      "counterpartLabel" = CASE WHEN "counterpartActorId" = OLD."id" THEN
        CASE "counterpartRole" WHEN 'ADMIN' THEN 'DELETED_ADMIN'::"AccountActorLabel"
          ELSE 'DELETED_USER'::"AccountActorLabel" END ELSE "counterpartLabel" END
  WHERE "actorId" = OLD."id" OR "counterpartActorId" = OLD."id";

  UPDATE "AdminAuditLog"
  SET "actorUserId" = NULL,
      "actorLabel" = CASE "actorRole"
        WHEN 'ADMIN' THEN 'DELETED_ADMIN'::"AccountActorLabel"
        ELSE 'DELETED_USER'::"AccountActorLabel" END
  WHERE "actorId" = OLD."id";

  UPDATE "QuestionReport"
  SET "reporterUserId" = CASE WHEN "reporterActorId" = OLD."id"
        THEN NULL ELSE "reporterUserId" END,
      "reporterLabel" = CASE WHEN "reporterActorId" = OLD."id" THEN
        CASE "reporterRole" WHEN 'ADMIN' THEN 'DELETED_ADMIN'::"AccountActorLabel"
          ELSE 'DELETED_USER'::"AccountActorLabel" END ELSE "reporterLabel" END,
      "description" = CASE WHEN "reporterActorId" = OLD."id"
        THEN NULL ELSE "description" END,
      "assigneeUserId" = CASE WHEN "assigneeActorId" = OLD."id"
        THEN NULL ELSE "assigneeUserId" END,
      "assigneeLabel" = CASE WHEN "assigneeActorId" = OLD."id"
        THEN 'DELETED_ADMIN'::"AccountActorLabel" ELSE "assigneeLabel" END,
      "rowVersion" = "rowVersion" + 1,
      "updatedAt" = event_time
  WHERE "reporterActorId" = OLD."id" OR "assigneeActorId" = OLD."id";

  IF abandoned_count > 0 THEN
    subject_digest := encode(public.digest(
      convert_to('nihongo-actor-subject-v1', 'UTF8') || decode('00', 'hex')
        || convert_to(lower(OLD."id"::TEXT), 'UTF8'), 'sha256'::TEXT
    ), 'hex');
    INSERT INTO "AdminAuditLog" (
      "command", "targetType", "targetId", "actorKind", "actorUserId",
      "actorId", "actorRole", "actorLabel", "actorSystemLabel",
      "beforeState", "afterState", "beforeRowVersion", "afterRowVersion",
      "changedFields", "metadata", "contentDigest", "operationId",
      "requestId", "environment", "occurredAt"
    ) VALUES (
      'AUTHOR_ERASURE_ABANDON', 'USER_ERASURE', operation_id,
      'SYSTEM', NULL, NULL, 'SYSTEM', NULL, 'ACCOUNT_ERASURE',
      NULL, NULL, NULL, NULL, '["AUTHOR_TOMBSTONE"]'::JSONB,
      jsonb_build_object('kind','AUTHOR_ERASURE_V1',
        'subjectActorDigest',subject_digest,'abandonedCount',abandoned_count),
      "phase7_admin_audit_content_digest"(
        operation_id, 'AUTHOR_ERASURE_ABANDON', 'USER_ERASURE', operation_id,
        NULL, NULL, NULL, NULL, '["AUTHOR_TOMBSTONE"]'::JSONB,
        jsonb_build_object('kind','AUTHOR_ERASURE_V1',
          'subjectActorDigest',subject_digest,'abandonedCount',abandoned_count)
      ), operation_id, request_id, environment_value, event_time
    );
  END IF;

  UPDATE "AuthSessionFamily" SET "status" = 'REVOKED'
    WHERE "userId" = OLD."id" AND "status" = 'ACTIVE';
  DELETE FROM "Session" WHERE "userId" = OLD."id";
  DELETE FROM "AuthSessionRotationFence" WHERE "userId" = OLD."id";
  DELETE FROM "AuthSessionFamily" WHERE "userId" = OLD."id";
  DELETE FROM "Verification" WHERE "resetUserId" = OLD."id";

  PERFORM "phase7_finish_admin_operation"(operation_id);
  RETURN OLD;
END;
$function$;

CREATE TRIGGER "User_anonymize_question_creator_before_delete"
BEFORE DELETE ON "User"
FOR EACH ROW EXECUTE FUNCTION "anonymize_question_creator_on_user_delete"();

CREATE FUNCTION "phase7_erase_user"(
  target_user_id UUID,
  environment_value "AdminAuditEnvironment"
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  execution_id UUID;
  deleted_count INTEGER;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_erasure_worker');
  PERFORM "phase7_require_database_capability"(environment_value);
  IF (environment_value = 'TEST' AND current_database() !~ '_test$')
    OR (environment_value = 'DEVELOPMENT' AND current_database() !~ '_dev$') THEN
    RAISE EXCEPTION 'Erasure environment does not match the approved DB target.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM "AuthIssuerActivation"
  WHERE "id" = 1 AND "legacyIssuerDisabled"
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Erasure requires completed V1 issuer activation.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM "User" AS target
  WHERE target."id" = target_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Canonical final-erasure lock order shared with reset/password/auth paths.
  PERFORM 1 FROM "Verification"
  WHERE "resetUserId" = target_user_id
  ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "Account"
  WHERE "userId" = target_user_id
  ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "AuthSessionFamily"
  WHERE "userId" = target_user_id
  ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "Session"
  WHERE "userId" = target_user_id
  ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "AuthSessionRotationFence"
  WHERE "userId" = target_user_id
  ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "Question"
  WHERE "createdByActorId" = target_user_id
    OR "id" IN (
      SELECT "questionId" FROM "QuestionVersion"
      WHERE "createdByActorId" = target_user_id
    )
  ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "QuestionVersion"
  WHERE "createdByActorId" = target_user_id
  ORDER BY "questionId", "id" FOR UPDATE;
  PERFORM 1 FROM "ContentReview"
  WHERE "actorId" = target_user_id OR "counterpartActorId" = target_user_id
  ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "AdminAuditLog"
  WHERE "actorId" = target_user_id
  ORDER BY "id" FOR UPDATE;
  PERFORM 1 FROM "QuestionReport"
  WHERE "reporterActorId" = target_user_id OR "assigneeActorId" = target_user_id
  ORDER BY "id" FOR UPDATE;

  execution_id := "phase7_open_trusted_execution"(
    'ERASURE', target_user_id, NULL
  );
  UPDATE "Phase7TrustedExecution"
  SET "environment" = environment_value
  WHERE "id" = execution_id;

  DELETE FROM "User" WHERE "id" = target_user_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count <> 1 THEN
    RAISE EXCEPTION 'Owned erasure did not delete exactly one User.'
      USING ERRCODE = '23514';
  END IF;
  PERFORM "phase7_close_trusted_execution"(execution_id);
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_erase_user"(
  UUID, "AdminAuditEnvironment"
) FROM PUBLIC;

-- Bounded runtime projections keep bearer tokens, password hashes, reset
-- selectors, and bulk auth rows out of ordinary table ACLs. The auth gateway
-- may resolve only the one credential or session named by a request; the app
-- receives only the canonical principal projection for one live V1 token.
CREATE FUNCTION "phase7_require_runtime_ready"()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  effective_caller TEXT := current_setting('role', true);
BEGIN
  IF current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN
    RAISE EXCEPTION 'Phase 7 runtime requires session_replication_role=origin.'
      USING ERRCODE = '42501';
  END IF;
  IF effective_caller IS NULL OR effective_caller = 'none' THEN
    effective_caller := session_user;
  END IF;
  IF effective_caller NOT IN ('nihongo_app', 'nihongo_auth_gateway') THEN
    RAISE EXCEPTION 'Caller role % is not a Phase 7 runtime role.',
      effective_caller USING ERRCODE = '42501';
  END IF;
  PERFORM "phase7_require_database_capability"(NULL);
  IF NOT EXISTS (
    SELECT 1 FROM "AuthIssuerActivation"
    WHERE "id" = 1 AND "legacyIssuerDisabled"
  ) THEN
    RAISE EXCEPTION 'Phase 7 V1 issuer activation is incomplete.'
      USING ERRCODE = '42501';
  END IF;
  RETURN true;
END;
$function$;

CREATE FUNCTION "phase7_resolve_v1_principal"(raw_token TEXT)
RETURNS TABLE (
  "userId" UUID,
  "name" TEXT,
  "role" "UserRole",
  "targetLevel" "JlptLevel",
  "sessionId" UUID,
  "createdAt" TIMESTAMPTZ,
  "expiresAt" TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  checked_at TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_app');
  PERFORM "phase7_require_runtime_ready"();
  IF raw_token IS NULL OR raw_token = '' THEN RETURN; END IF;

  RETURN QUERY
  SELECT target_user."id", target_user."name"::TEXT, target_user."role",
    target_user."targetLevel", session."id", session."createdAt",
    session."expiresAt"
  FROM "Session" AS session
  JOIN "AuthSessionFamily" AS family
    ON family."id" = session."sessionFamilyId"
   AND family."userId" = session."userId"
  JOIN "User" AS target_user ON target_user."id" = session."userId"
  WHERE session."token" = raw_token
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorityGeneration" = target_user."authorityGeneration"
    AND target_user."accountStatus" = 'ACTIVE'
    AND family."status" = 'ACTIVE'
    AND session."expiresAt" > checked_at
    AND session."createdAt" + INTERVAL '30 days' > checked_at
  LIMIT 1;
END;
$function$;

CREATE FUNCTION "phase7_resolve_sign_in_credential"(
  normalized_email TEXT
)
RETURNS TABLE (
  "userId" UUID,
  "passwordHash" TEXT,
  "emailVerified" BOOLEAN,
  "authorityGeneration" INTEGER,
  "role" "UserRole",
  "accountStatus" "UserAccountStatus"
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_runtime_ready"();
  IF normalized_email IS NULL OR normalized_email = ''
    OR normalized_email <> lower(btrim(normalized_email)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT target_user."id", credential."password",
    target_user."emailVerified", target_user."authorityGeneration",
    target_user."role", target_user."accountStatus"
  FROM "User" AS target_user
  JOIN "Account" AS credential
    ON credential."userId" = target_user."id"
   AND credential."providerId" = 'credential'
   AND credential."accountId" = target_user."id"::TEXT
   AND credential."password" IS NOT NULL
   AND credential."accessToken" IS NULL
   AND credential."refreshToken" IS NULL
   AND credential."idToken" IS NULL
  WHERE target_user."email" = normalized_email
    AND target_user."accountStatus" = 'ACTIVE'
  LIMIT 1;
END;
$function$;

CREATE FUNCTION "phase7_resolve_session_credential"(raw_token TEXT)
RETURNS TABLE (
  "userId" UUID,
  "passwordHash" TEXT,
  "authorityGeneration" INTEGER,
  "role" "UserRole",
  "accountStatus" "UserAccountStatus"
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  checked_at TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_runtime_ready"();
  IF raw_token IS NULL OR raw_token = '' THEN RETURN; END IF;

  RETURN QUERY
  SELECT target_user."id", credential."password",
    target_user."authorityGeneration", target_user."role",
    target_user."accountStatus"
  FROM "Session" AS session
  JOIN "AuthSessionFamily" AS family
    ON family."id" = session."sessionFamilyId"
   AND family."userId" = session."userId"
  JOIN "User" AS target_user ON target_user."id" = session."userId"
  JOIN "Account" AS credential
    ON credential."userId" = target_user."id"
   AND credential."providerId" = 'credential'
   AND credential."accountId" = target_user."id"::TEXT
   AND credential."password" IS NOT NULL
  WHERE session."token" = raw_token
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorityGeneration" = target_user."authorityGeneration"
    AND target_user."accountStatus" = 'ACTIVE'
    AND family."status" = 'ACTIVE'
    AND session."expiresAt" > checked_at
    AND session."createdAt" + INTERVAL '30 days' > checked_at
  LIMIT 1;
END;
$function$;

CREATE FUNCTION "phase7_resolve_password_reset_credential"(raw_token TEXT)
RETURNS TABLE (
  "userId" UUID,
  "passwordHash" TEXT,
  "authorityGeneration" INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  selector_value TEXT;
  checked_at TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_runtime_ready"();
  IF raw_token IS NULL OR raw_token = '' THEN RETURN; END IF;
  selector_value := encode(public.digest(
    convert_to('nihongo-password-reset-v1', 'UTF8')
      || decode('00', 'hex') || convert_to(raw_token, 'UTF8'),
    'sha256'::TEXT
  ), 'hex');

  RETURN QUERY
  SELECT target_user."id", credential."password",
    target_user."authorityGeneration"
  FROM "Verification" AS verification
  JOIN "User" AS target_user
    ON target_user."id" = verification."resetUserId"
  JOIN "Account" AS credential
    ON credential."userId" = target_user."id"
   AND credential."providerId" = 'credential'
   AND credential."accountId" = target_user."id"::TEXT
   AND credential."password" IS NOT NULL
  WHERE verification."purpose" = 'PASSWORD_RESET_V1'
    AND verification."tokenSelector" = selector_value
    AND verification."capturedGeneration" = target_user."authorityGeneration"
    AND verification."expiresAt" > checked_at
    AND target_user."accountStatus" = 'ACTIVE'
  LIMIT 1;
END;
$function$;

CREATE FUNCTION "phase7_sign_up_credential"(
  user_id_value UUID,
  account_id_value UUID,
  normalized_email TEXT,
  display_name TEXT,
  target_level_value "JlptLevel",
  password_hash TEXT
)
RETURNS TABLE ("userId" UUID, "email" TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  event_time TIMESTAMPTZ(3) := clock_timestamp();
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_runtime_ready"();
  IF user_id_value IS NULL OR account_id_value IS NULL
    OR normalized_email IS NULL
    OR normalized_email <> lower(btrim(normalized_email))
    OR char_length(normalized_email) NOT BETWEEN 3 AND 320
    OR position('@' IN normalized_email) <= 1
    OR display_name IS NULL OR display_name <> btrim(display_name)
    OR char_length(display_name) NOT BETWEEN 1 AND 80
    OR password_hash IS NULL
    OR char_length(password_hash) NOT BETWEEN 1 AND 4096 THEN
    RETURN;
  END IF;

  BEGIN
    INSERT INTO "User" (
      "id", "name", "email", "emailVerified", "image", "role",
      "targetLevel", "accountStatus", "authorityGeneration", "deletedAt",
      "createdAt", "updatedAt"
    ) VALUES (
      user_id_value, display_name, normalized_email, false, NULL, 'USER',
      target_level_value, 'ACTIVE', 1, NULL, event_time, event_time
    );
    INSERT INTO "Account" (
      "id", "accountId", "providerId", "userId", "accessToken",
      "refreshToken", "idToken", "accessTokenExpiresAt",
      "refreshTokenExpiresAt", "scope", "password", "createdAt", "updatedAt"
    ) VALUES (
      account_id_value, user_id_value::TEXT, 'credential', user_id_value,
      NULL, NULL, NULL, NULL, NULL, NULL, password_hash, event_time, event_time
    );
    SET CONSTRAINTS "User_deferred_credential_totality",
      "Account_deferred_credential_totality" IMMEDIATE;
    SET CONSTRAINTS "User_deferred_credential_totality",
      "Account_deferred_credential_totality" DEFERRED;
  EXCEPTION WHEN unique_violation THEN
    -- Duplicate identity/email/account attempts are deliberately indistinguishable
    -- from an unavailable signup result and the subtransaction removes all writes.
    RETURN;
  END;
  RETURN QUERY SELECT user_id_value, normalized_email;
END;
$function$;

CREATE FUNCTION "phase7_resolve_email_verification_subject"(
  normalized_email TEXT
)
RETURNS TABLE (
  "userId" UUID,
  "email" TEXT,
  "name" TEXT,
  "emailVerified" BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_runtime_ready"();
  IF normalized_email IS NULL OR normalized_email = ''
    OR normalized_email <> lower(btrim(normalized_email)) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT target_user."id", target_user."email", target_user."name"::TEXT,
    target_user."emailVerified"
  FROM "User" AS target_user
  WHERE target_user."email" = normalized_email
    AND target_user."accountStatus" = 'ACTIVE'
  LIMIT 1;
END;
$function$;

CREATE FUNCTION "phase7_verify_email"(
  user_id_value UUID,
  normalized_email TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $function$
DECLARE
  target_user "User"%ROWTYPE;
BEGIN
  PERFORM "phase7_require_caller_role"('nihongo_auth_gateway');
  PERFORM "phase7_require_runtime_ready"();
  IF user_id_value IS NULL OR normalized_email IS NULL
    OR normalized_email <> lower(btrim(normalized_email)) THEN
    RETURN false;
  END IF;
  SELECT * INTO target_user FROM "User"
  WHERE "id" = user_id_value AND "email" = normalized_email
    AND "accountStatus" = 'ACTIVE'
  FOR UPDATE;
  IF target_user."id" IS NULL THEN RETURN false; END IF;
  IF NOT target_user."emailVerified" THEN
    UPDATE "User"
    SET "emailVerified" = true, "updatedAt" = clock_timestamp()
    WHERE "id" = user_id_value AND NOT "emailVerified";
  END IF;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION "phase7_require_runtime_ready"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "phase7_resolve_v1_principal"(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION "phase7_resolve_sign_in_credential"(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION "phase7_resolve_session_credential"(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION "phase7_resolve_password_reset_credential"(TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION "phase7_sign_up_credential"(
  UUID, UUID, TEXT, TEXT, "JlptLevel", TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION "phase7_resolve_email_verification_subject"(TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION "phase7_verify_email"(UUID, TEXT) FROM PUBLIC;

-- The exact external role graph was verified before any application DDL.

REVOKE ALL ON FUNCTION "phase7_revoke_legacy_database_connect"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_revoke_legacy_database_connect"()
  TO "nihongo_phase7_owner";

DO $phase7_object_ownership$
DECLARE
  schema_name TEXT := current_setting('app.phase7_target_schema', false);
  object_row RECORD;
BEGIN
  IF schema_name IS NULL OR schema_name = ''
    OR schema_name IN ('pg_catalog', 'pg_temp') THEN
    RAISE EXCEPTION 'Phase 7 target schema capture is missing.'
      USING ERRCODE = '55000';
  END IF;
  -- The approved baseline has no application-owned views, materialized
  -- views, foreign tables, composite relations, procedures, aggregates, or
  -- window routines. Do not silently leave an upgrade-time object outside
  -- the owner/ACL/search-path normalization below: a stale definer routine or
  -- readable projection could otherwise retain raw auth access.
  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = schema_name
      AND relation.relkind NOT IN ('r', 'p', 'S', 'i', 'I')
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend AS dependency
        WHERE dependency.classid = 'pg_class'::regclass
          AND dependency.objid = relation.oid
          AND dependency.deptype = 'e'
      )
  ) THEN
    RAISE EXCEPTION 'Unexpected application relation kind blocks Phase 7 migration.'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = schema_name
      AND procedure.prokind <> 'f'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend AS dependency
        WHERE dependency.classid = 'pg_proc'::regclass
          AND dependency.objid = procedure.oid
          AND dependency.deptype = 'e'
      )
  ) THEN
    RAISE EXCEPTION 'Unexpected application routine kind blocks Phase 7 migration.'
      USING ERRCODE = '42501';
  END IF;
  -- PostgreSQL requires the prospective owner to have CREATE on the
  -- containing schema before an object can be reassigned. This temporary
  -- direct grant is removed after the schema itself is transferred.
  EXECUTE format(
    'GRANT CREATE ON SCHEMA %I TO nihongo_phase7_owner',
    schema_name
  );
  -- Every application object, including Prisma's ledger, is owned by the
  -- dedicated NOLOGIN owner. Exact ledger writers are granted below so
  -- Prisma can finish its post-COMMIT bookkeeping. Skip extension-owned
  -- objects; PostgreSQL forbids detaching them from their extension.
  FOR object_row IN
    SELECT relation.relname
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = schema_name
      AND relation.relkind IN ('r', 'p')
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend AS dependency
        WHERE dependency.classid = 'pg_class'::regclass
          AND dependency.objid = relation.oid
          AND dependency.deptype = 'e'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I OWNER TO nihongo_phase7_owner',
      schema_name,
      object_row.relname
    );
  END LOOP;

  FOR object_row IN
    SELECT relation.relname
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = schema_name
      AND relation.relkind = 'S'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend AS dependency
        WHERE dependency.classid = 'pg_class'::regclass
          AND dependency.objid = relation.oid
          AND dependency.deptype = 'e'
      )
  LOOP
    EXECUTE format(
      'ALTER SEQUENCE %I.%I OWNER TO nihongo_phase7_owner',
      schema_name,
      object_row.relname
    );
  END LOOP;

  FOR object_row IN
    SELECT
      procedure.proname,
      pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
      procedure.prosecdef
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = schema_name
      AND procedure.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend AS dependency
        WHERE dependency.classid = 'pg_proc'::regclass
          AND dependency.objid = procedure.oid
          AND dependency.deptype = 'e'
      )
  LOOP
    IF object_row.prosecdef THEN
      EXECUTE format(
        'ALTER FUNCTION %I.%I(%s) SET search_path TO pg_catalog, %I, pg_temp',
        schema_name,
        object_row.proname,
        object_row.identity_arguments,
        schema_name
      );
    END IF;
    IF object_row.proname = 'phase7_revoke_legacy_database_connect' THEN
      EXECUTE format(
        'ALTER FUNCTION %I.%I(%s) OWNER TO nihongo_phase7_migration',
        schema_name,
        object_row.proname,
        object_row.identity_arguments
      );
    ELSE
      EXECUTE format(
        'ALTER FUNCTION %I.%I(%s) OWNER TO nihongo_phase7_owner',
        schema_name,
        object_row.proname,
        object_row.identity_arguments
      );
    END IF;
  END LOOP;

  FOR object_row IN
    SELECT type_row.typname
    FROM pg_type AS type_row
    JOIN pg_namespace AS namespace ON namespace.oid = type_row.typnamespace
    WHERE namespace.nspname = schema_name
      AND type_row.typtype IN ('d', 'e')
      AND type_row.typrelid = 0
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend AS dependency
        WHERE dependency.classid = 'pg_type'::regclass
          AND dependency.objid = type_row.oid
          AND dependency.deptype = 'e'
      )
  LOOP
    EXECUTE format(
      'ALTER TYPE %I.%I OWNER TO nihongo_phase7_owner',
      schema_name,
      object_row.typname
    );
  END LOOP;

  IF CURRENT_USER <> 'nihongo_phase7_migration'
    OR NOT pg_has_role(
      CURRENT_USER, 'nihongo_phase7_owner', 'SET'
    )
    OR NOT has_database_privilege(
      CURRENT_USER, current_database(), 'CREATE'
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_namespace AS namespace
      JOIN pg_roles AS owner_role ON owner_role.oid = namespace.nspowner
      WHERE namespace.nspname = schema_name
        AND owner_role.rolname = CURRENT_USER
    ) THEN
    RAISE EXCEPTION 'Phase 7 schema ownership handoff prerequisites failed.'
      USING ERRCODE = '42501';
  END IF;
  -- Transfer the schema last so the applying migration role can first move
  -- every object it owns to the dedicated owner.
  EXECUTE format(
    'ALTER SCHEMA %I OWNER TO nihongo_phase7_owner',
    schema_name
  );
END;
$phase7_object_ownership$;

-- The permanent migration -> owner membership is SET-only. Enter the owner
-- explicitly for ACL normalization; no inheritable or ADMIN edge is created.
SET LOCAL ROLE "nihongo_phase7_owner";

DO $phase7_schema_grants$
DECLARE
  schema_name TEXT := current_setting('app.phase7_target_schema', false);
  object_row RECORD;
BEGIN
  IF schema_name IS NULL OR schema_name = ''
    OR schema_name IN ('pg_catalog', 'pg_temp') THEN
    RAISE EXCEPTION 'Phase 7 target schema capture is missing.'
      USING ERRCODE = '55000';
  END IF;

  -- Normalize direct ACLs instead of assuming these globally named roles or
  -- the target schema were pristine before an upgrade. The owner keeps only
  -- its implicit ownership; every service/migration grant is rebuilt below.
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', schema_name);
  FOR object_row IN
    SELECT DISTINCT CASE
      WHEN expanded_acl.grantee = 0 THEN 'PUBLIC'
      ELSE quote_ident(pg_get_userbyid(expanded_acl.grantee))
    END AS grantee_sql
    FROM pg_namespace AS namespace,
      LATERAL aclexplode(COALESCE(
        namespace.nspacl,
        acldefault('n', namespace.nspowner)
      )) AS expanded_acl
    JOIN pg_roles AS grantee_role
      ON grantee_role.oid = expanded_acl.grantee
    WHERE namespace.nspname = schema_name
      AND grantee_role.rolname <> 'nihongo_phase7_owner'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON SCHEMA %I FROM %s',
      schema_name,
      object_row.grantee_sql
    );
  END LOOP;

  FOR object_row IN
    SELECT DISTINCT
      relation.relname,
      CASE
        WHEN expanded_acl.grantee = 0 THEN 'PUBLIC'
        ELSE quote_ident(pg_get_userbyid(expanded_acl.grantee))
      END AS grantee_sql
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(
      relation.relacl,
      acldefault('r', relation.relowner)
    )) AS expanded_acl
    WHERE namespace.nspname = schema_name
      AND relation.relkind IN ('r', 'p')
      AND expanded_acl.grantee <> (
        SELECT oid FROM pg_roles WHERE rolname = 'nihongo_phase7_owner'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend AS dependency
        WHERE dependency.classid = 'pg_class'::regclass
          AND dependency.objid = relation.oid
          AND dependency.deptype = 'e'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM %s',
      schema_name,
      object_row.relname,
      object_row.grantee_sql
    );
  END LOOP;

  -- Table-level REVOKE does not remove historical column ACLs. Clear every
  -- per-column grant (including PUBLIC and former owners) before rebuilding
  -- the role surface so no raw credential/session column bypass survives.
  FOR object_row IN
    SELECT DISTINCT
      relation.relname,
      attribute.attname,
      CASE
        WHEN expanded_acl.grantee = 0 THEN 'PUBLIC'
        ELSE quote_ident(pg_get_userbyid(expanded_acl.grantee))
      END AS grantee_sql
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute AS attribute ON attribute.attrelid = relation.oid
    CROSS JOIN LATERAL aclexplode(attribute.attacl) AS expanded_acl
    WHERE namespace.nspname = schema_name
      AND relation.relkind IN ('r', 'p')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend AS dependency
        WHERE dependency.classid = 'pg_class'::regclass
          AND dependency.objid = relation.oid
          AND dependency.deptype = 'e'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%I) ON TABLE %I.%I FROM %s',
      object_row.attname,
      schema_name,
      object_row.relname,
      object_row.grantee_sql
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute AS attribute ON attribute.attrelid = relation.oid
    CROSS JOIN LATERAL aclexplode(attribute.attacl) AS expanded_acl
    WHERE namespace.nspname = schema_name
      AND relation.relkind IN ('r', 'p')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'Phase 7 column ACL normalization is incomplete.'
      USING ERRCODE = '42501';
  END IF;

  FOR object_row IN
    SELECT DISTINCT
      relation.relname,
      CASE
        WHEN expanded_acl.grantee = 0 THEN 'PUBLIC'
        ELSE quote_ident(pg_get_userbyid(expanded_acl.grantee))
      END AS grantee_sql
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(
      relation.relacl,
      acldefault('s', relation.relowner)
    )) AS expanded_acl
    WHERE namespace.nspname = schema_name
      AND relation.relkind = 'S'
      AND expanded_acl.grantee <> (
        SELECT oid FROM pg_roles WHERE rolname = 'nihongo_phase7_owner'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend AS dependency
        WHERE dependency.classid = 'pg_class'::regclass
          AND dependency.objid = relation.oid
          AND dependency.deptype = 'e'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON SEQUENCE %I.%I FROM %s',
      schema_name,
      object_row.relname,
      object_row.grantee_sql
    );
  END LOOP;

  FOR object_row IN
    SELECT DISTINCT
      type_row.typname,
      CASE
        WHEN expanded_acl.grantee = 0 THEN 'PUBLIC'
        ELSE quote_ident(pg_get_userbyid(expanded_acl.grantee))
      END AS grantee_sql
    FROM pg_type AS type_row
    JOIN pg_namespace AS namespace ON namespace.oid = type_row.typnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(
      type_row.typacl,
      acldefault('T', type_row.typowner)
    )) AS expanded_acl
    WHERE namespace.nspname = schema_name
      AND type_row.typtype IN ('d', 'e')
      AND type_row.typrelid = 0
      AND expanded_acl.grantee <> (
        SELECT oid FROM pg_roles WHERE rolname = 'nihongo_phase7_owner'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend AS dependency
        WHERE dependency.classid = 'pg_type'::regclass
          AND dependency.objid = type_row.oid
          AND dependency.deptype = 'e'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TYPE %I.%I FROM %s',
      schema_name,
      object_row.typname,
      object_row.grantee_sql
    );
  END LOOP;

  FOR object_row IN
    SELECT type_row.typname
    FROM pg_type AS type_row
    JOIN pg_namespace AS namespace ON namespace.oid = type_row.typnamespace
    WHERE namespace.nspname = schema_name
      AND type_row.typtype IN ('d', 'e')
      AND type_row.typrelid = 0
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend AS dependency
        WHERE dependency.classid = 'pg_type'::regclass
          AND dependency.objid = type_row.oid
          AND dependency.deptype = 'e'
      )
  LOOP
    EXECUTE format(
      'GRANT USAGE ON TYPE %I.%I TO nihongo_phase7_migration, nihongo_app, nihongo_auth_gateway, nihongo_erasure_worker',
      schema_name,
      object_row.typname
    );
  END LOOP;

  FOR object_row IN
    SELECT DISTINCT
      procedure.proname,
      pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
      CASE
        WHEN expanded_acl.grantee = 0 THEN 'PUBLIC'
        ELSE quote_ident(pg_get_userbyid(expanded_acl.grantee))
      END AS grantee_sql
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(
      procedure.proacl,
      acldefault('f', procedure.proowner)
    )) AS expanded_acl
    WHERE namespace.nspname = schema_name
      AND procedure.prokind = 'f'
      AND procedure.prosecdef
      AND procedure.proname <> 'phase7_revoke_legacy_database_connect'
      AND expanded_acl.grantee <> (
        SELECT oid FROM pg_roles WHERE rolname = 'nihongo_phase7_owner'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend AS dependency
        WHERE dependency.classid = 'pg_proc'::regclass
          AND dependency.objid = procedure.oid
          AND dependency.deptype = 'e'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON FUNCTION %I.%I(%s) FROM %s',
      schema_name,
      object_row.proname,
      object_row.identity_arguments,
      object_row.grantee_sql
    );
  END LOOP;

  EXECUTE format(
    'GRANT USAGE ON SCHEMA %I TO nihongo_phase7_owner, nihongo_phase7_migration, nihongo_app, nihongo_auth_gateway, nihongo_erasure_worker',
    schema_name
  );
  EXECUTE format(
    'GRANT CREATE ON SCHEMA %I TO nihongo_phase7_migration',
    schema_name
  );
END;
$phase7_schema_grants$;

ALTER TABLE "AuthIssuerActivation" OWNER TO "nihongo_phase7_owner";
ALTER TABLE "AuthSessionFamily" OWNER TO "nihongo_phase7_owner";
ALTER TABLE "AuthSessionRotationFence" OWNER TO "nihongo_phase7_owner";
ALTER TABLE "Phase7TrustedExecution" OWNER TO "nihongo_phase7_owner";
ALTER TABLE "Phase7DatabaseCapability" OWNER TO "nihongo_phase7_owner";
ALTER TABLE "Phase7OperationIntent" OWNER TO "nihongo_phase7_owner";
ALTER TABLE "Phase7OperationDelta" OWNER TO "nihongo_phase7_owner";

GRANT ALL PRIVILEGES ON TABLE
  "AuthIssuerActivation", "AuthSessionFamily", "AuthSessionRotationFence",
  "Phase7TrustedExecution", "Phase7DatabaseCapability",
  "Phase7OperationIntent", "Phase7OperationDelta"
TO "nihongo_phase7_migration";

REVOKE ALL ON TABLE
  "User", "Account", "Session", "Verification", "AuthIssuerActivation",
  "AuthSessionFamily", "AuthSessionRotationFence", "Phase7TrustedExecution",
  "Phase7DatabaseCapability", "Phase7OperationIntent", "Phase7OperationDelta"
FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

GRANT SELECT ON TABLE "_prisma_migrations"
TO "nihongo_app";
GRANT SELECT, INSERT, UPDATE ON TABLE "_prisma_migrations"
TO "nihongo_phase7_migration";

-- A Phase 6 binary compares its immutable 27-entry repository manifest with
-- the visible ledger exactly. Keep that old-node readiness view only for the
-- dedicated legacy LOGIN until activation; technical roles and the canonical
-- migration wrapper see and write the complete ledger.
DO $phase7_migration_ledger_rls$
DECLARE
  schema_name TEXT := current_setting('app.phase7_target_schema', false);
  wrapper_prefix TEXT := CASE
    WHEN current_database() ~ '_test$' THEN 'nihongo_test'
    WHEN current_database() ~ '_dev$' THEN 'nihongo_development'
    ELSE NULL
  END;
  legacy_login TEXT;
  policy_row RECORD;
  approved_names TEXT[] := ARRAY[
    '20260812130000_phase3_operational_baseline',
    '20260814113000_phase3_question_catalog',
    '20260814120000_phase3_question_catalog_integrity',
    '20260814120500_phase3_seed_provenance_guard',
    '20260814121000_phase3_seed_provenance_backfill',
    '20260814122000_phase3_seed_provenance_constraints',
    '20260814123000_phase3_seed_provenance_guard_cleanup',
    '20260814130000_phase3_auth_guest_principal',
    '20260814131000_phase3_auth_integrity',
    '20260814132000_phase3_auth_invariants',
    '20260814140000_phase3_study_sessions',
    '20260814141000_phase3_study_session_fallback_semantics',
    '20260814142000_phase3_study_session_integrity',
    '20260814143000_phase3_study_session_identity_integrity',
    '20260814144000_phase3_study_session_existing_selection_guard',
    '20260815100000_phase3_study_submission_facts',
    '20260815101000_phase3_study_submission_integrity',
    '20260815102000_phase3_wrong_note_latest_wrong_integrity',
    '20260815103000_phase3_submission_retention_history_integrity',
    '20260816130000_phase3_wrong_note_dashboard_read_indexes',
    '20260817130000_phase4_practice_idempotency_operations',
    '20260817131000_phase4_study_draft_core',
    '20260818130000_phase4_study_selection_modes',
    '20260821130000_phase4_bookmarks',
    '20260821150000_phase4_result_retry',
    '20260821151000_phase5_targeted_review_operation',
    '20260821152000_phase5_review_center_foundation'
  ];
  approved_sql TEXT;
BEGIN
  IF schema_name IS NULL OR wrapper_prefix IS NULL THEN
    RAISE EXCEPTION 'Phase 7 ledger RLS target is unavailable.'
      USING ERRCODE = '42501';
  END IF;
  legacy_login := wrapper_prefix || '_legacy_app_login';
  FOR policy_row IN
    SELECT policy.polname
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = schema_name
      AND relation.relname = '_prisma_migrations'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON %I."_prisma_migrations"',
      policy_row.polname,
      schema_name
    );
  END LOOP;
  EXECUTE pg_catalog.format(
    'ALTER TABLE %I."_prisma_migrations" ENABLE ROW LEVEL SECURITY',
    schema_name
  );
  EXECUTE pg_catalog.format(
    'ALTER TABLE %I."_prisma_migrations" NO FORCE ROW LEVEL SECURITY',
    schema_name
  );
  EXECUTE pg_catalog.format(
    'CREATE POLICY phase7_ledger_full_access ON %I."_prisma_migrations" TO nihongo_phase7_migration USING (true) WITH CHECK (true)',
    schema_name
  );
  EXECUTE pg_catalog.format(
    'CREATE POLICY phase7_ledger_app_read ON %I."_prisma_migrations" FOR SELECT TO nihongo_app USING (true)',
    schema_name
  );
  SELECT pg_catalog.string_agg(pg_catalog.quote_literal(approved_name), ',')
  INTO approved_sql
  FROM pg_catalog.unnest(approved_names) AS approved_name;
  EXECUTE pg_catalog.format(
    'CREATE POLICY phase7_ledger_legacy_read ON %I."_prisma_migrations" FOR SELECT TO %I USING (SESSION_USER = %L AND "migration_name" IN (%s))',
    schema_name,
    legacy_login,
    legacy_login,
    approved_sql
  );
END;
$phase7_migration_ledger_rls$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "RateLimit", "GuestPrincipal", "StudySession", "StudySessionQuestion",
  "StudyDraft", "StudyDraftAnswer", "Bookmark", "StudyAnswer",
  "StudyResult", "WrongNote", "UserMemo", "ReviewSchedule",
  "ReviewEvent", "IdempotencyRecord"
TO "nihongo_app";
GRANT SELECT ON TABLE
  "Question", "QuestionVersion", "QuestionOption", "QuestionVersionTag",
  "Tag", "TagApplicability", "ContentReview", "AdminAuditLog",
  "QuestionReport"
TO "nihongo_app";
GRANT INSERT, UPDATE ON TABLE
  "Question", "QuestionVersion", "QuestionOption"
TO "nihongo_app";
GRANT INSERT, DELETE ON TABLE "QuestionVersionTag"
TO "nihongo_app";
GRANT INSERT ON TABLE "ContentReview", "AdminAuditLog"
TO "nihongo_app";
GRANT UPDATE ON TABLE "QuestionReport"
TO "nihongo_app";
GRANT USAGE ON TYPE
  "UserRole", "UserAccountStatus", "JlptLevel", "AdminAuditEnvironment",
  "AuthSessionFamilyStatus", "AuthSessionIssuerProtocolVersion",
  "AuthVerificationPurpose"
TO "nihongo_phase7_migration", "nihongo_app", "nihongo_auth_gateway",
  "nihongo_erasure_worker";

-- Until the V1 issuer marker is atomically activated, one environment-scoped
-- legacy LOGIN keeps the exact Phase 6 table surface so a drained old binary
-- remains healthy. Activation revokes this schema/table/type surface in the
-- same transaction that disables LEGACY issuance.
DO $phase7_legacy_compatibility_acl$
DECLARE
  schema_name TEXT := current_setting('app.phase7_target_schema', false);
  type_row RECORD;
  legacy_login TEXT := CASE
    WHEN current_database() ~ '_test$' THEN 'nihongo_test_legacy_app_login'
    WHEN current_database() ~ '_dev$' THEN 'nihongo_development_legacy_app_login'
    ELSE NULL
  END;
BEGIN
  IF schema_name IS NULL OR legacy_login IS NULL THEN
    RAISE EXCEPTION 'Legacy compatibility ACL target is unavailable.'
      USING ERRCODE = '42501';
  END IF;
  EXECUTE format(
    'GRANT USAGE ON SCHEMA %I TO %I',
    schema_name,
    legacy_login
  );
  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I."User", %I."Session", %I."Account", %I."Verification", %I."RateLimit", %I."GuestPrincipal", %I."StudySession", %I."StudySessionQuestion", %I."StudyDraft", %I."StudyDraftAnswer", %I."Question", %I."Bookmark", %I."QuestionVersion", %I."QuestionOption", %I."Tag", %I."QuestionVersionTag", %I."StudyAnswer", %I."StudyResult", %I."WrongNote", %I."UserMemo", %I."ReviewSchedule", %I."ReviewEvent", %I."IdempotencyRecord" TO %I',
    schema_name, schema_name, schema_name, schema_name, schema_name,
    schema_name, schema_name, schema_name, schema_name, schema_name,
    schema_name, schema_name, schema_name, schema_name, schema_name,
    schema_name, schema_name, schema_name, schema_name, schema_name,
    schema_name, schema_name, schema_name, legacy_login
  );
  EXECUTE format(
    'GRANT SELECT ON TABLE %I."_prisma_migrations" TO %I',
    schema_name,
    legacy_login
  );
  FOR type_row IN
    SELECT type_value.typname
    FROM pg_catalog.pg_type AS type_value
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = type_value.typnamespace
    WHERE namespace.nspname = schema_name
      AND type_value.typtype = 'e'
      AND type_value.typrelid = 0
      AND type_value.typname IN (
        'QuestionLifecycleStatus', 'QuestionVersionStatus', 'JlptLevel',
        'QuestionSubject', 'QuestionType', 'QuestionDifficulty',
        'QuestionSourceType', 'CreatorLabelSnapshot', 'UserRole',
        'UserAccountStatus', 'StudyMode', 'StudySessionStatus',
        'StudySessionFallbackReason', 'WrongNoteStatus',
        'ReviewEventSource', 'IdempotencyPrincipalType',
        'IdempotencyOperation', 'IdempotencyState'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_catalog.pg_type'::regclass
          AND dependency.objid = type_value.oid
          AND dependency.deptype = 'e'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT USAGE ON TYPE %I.%I TO %I',
      schema_name,
      type_row.typname,
      legacy_login
    );
  END LOOP;
END;
$phase7_legacy_compatibility_acl$;

ALTER FUNCTION "phase7_trusted_execution_active"(TEXT)
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "reject_unfinished_phase7_trusted_execution"()
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "reject_unfinished_phase7_operation"()
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "validate_question_version_change"()
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "validate_phase7_question_change"()
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "protect_question_version_children"()
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "protect_phase7_tag_identity"()
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "protect_phase7_question_report"()
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "validate_phase7_system_seed_catalog"()
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "validate_phase7_rotation_fence_replacement"()
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "validate_phase7_question_report_remediation"()
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_trusted_execution_remember"()
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_trusted_erasure_environment"()
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_trusted_execution_target"(TEXT)
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_require_caller_role"(TEXT)
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_open_trusted_execution"(TEXT, UUID, BOOLEAN)
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_close_trusted_execution"(UUID)
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_begin_admin_operation"(
  "AdminAuditCommand", TEXT, UUID, "AdminAuditEnvironment", UUID[]
) OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_arm_admin_operation"(UUID, JSONB)
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_current_operation_id"()
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_operation_references_user"(UUID)
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_operation_target_matches"(TEXT, UUID, UUID, TEXT)
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_verify_operation_manifest"(UUID)
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_finish_admin_operation"(UUID)
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_create_question_report"(
  TEXT, UUID, UUID, UUID, "QuestionReportReason", TEXT
) OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_register_database_capability"(
  TEXT, INET, INTEGER, "AdminAuditEnvironment"
) OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_require_database_capability"(
  "AdminAuditEnvironment"
) OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_redact_expired_report_descriptions"(
  INTEGER, "AdminAuditEnvironment"
) OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_change_password"(UUID, TEXT, TEXT)
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_request_password_reset"(TEXT, UUID, TEXT)
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_consume_password_reset"(TEXT, TEXT)
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_issue_v1_session"(
  UUID, INTEGER, "UserRole", "UserAccountStatus",
  UUID, TEXT, TEXT, TEXT, BOOLEAN
) OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_confirm_v1_session_issuance"(
  TEXT, UUID, UUID, INTEGER, "UserRole", "UserAccountStatus"
) OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_reauthentication_commit_matches"(
  TEXT, UUID, TEXT, UUID, UUID, "AdminAuditEnvironment", INTEGER,
  "UserRole", "UserAccountStatus"
) OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_reauthenticate_v1_session"(
  TEXT, INTEGER, "UserRole", "UserAccountStatus", UUID, TEXT, TEXT, TEXT,
  UUID, UUID, "AdminAuditEnvironment"
) OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_owned_sign_out"(TEXT)
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_refresh_remembered_session"(
  TEXT, INTEGER, "UserRole", "UserAccountStatus"
) OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_refresh_current_remembered_session"(TEXT)
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_change_user_authority"(
  TEXT, UUID, INTEGER, "UserRole", "UserAccountStatus",
  "AdminAuditEnvironment"
) OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_cleanup_expired_auth_state"(
  INTEGER, "AdminAuditEnvironment"
) OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_activate_v1_issuer"("AdminAuditEnvironment")
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "anonymize_question_creator_on_user_delete"()
  OWNER TO "nihongo_phase7_owner";
ALTER FUNCTION "phase7_erase_user"(UUID, "AdminAuditEnvironment")
  OWNER TO "nihongo_phase7_owner";

REVOKE ALL ON FUNCTION "phase7_trusted_execution_active"(TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "reject_unfinished_phase7_trusted_execution"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "reject_unfinished_phase7_operation"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "validate_phase7_rotation_fence_replacement"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "validate_phase7_question_report_remediation"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "validate_phase7_system_seed_catalog"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_trusted_execution_remember"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_trusted_erasure_environment"()
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_trusted_execution_target"(TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_require_caller_role"(TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_open_trusted_execution"(TEXT, UUID, BOOLEAN)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_close_trusted_execution"(UUID)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_require_database_capability"(
  "AdminAuditEnvironment"
) FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_redact_expired_report_descriptions"(
  INTEGER, "AdminAuditEnvironment"
) FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_operation_target_matches"(
  TEXT, UUID, UUID, TEXT
) FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_verify_operation_manifest"(UUID)
  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";

REVOKE ALL ON FUNCTION "phase7_begin_admin_operation"(
  "AdminAuditCommand", TEXT, UUID, "AdminAuditEnvironment", UUID[]
) FROM PUBLIC, "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_arm_admin_operation"(UUID, JSONB)
  FROM PUBLIC, "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_finish_admin_operation"(UUID)
  FROM PUBLIC, "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_create_question_report"(
  TEXT, UUID, UUID, UUID, "QuestionReportReason", TEXT
) FROM PUBLIC, "nihongo_auth_gateway", "nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_begin_admin_operation"(
  "AdminAuditCommand", TEXT, UUID, "AdminAuditEnvironment", UUID[]
) TO "nihongo_app";
GRANT EXECUTE ON FUNCTION "phase7_arm_admin_operation"(UUID, JSONB)
  TO "nihongo_app";
GRANT EXECUTE ON FUNCTION "phase7_finish_admin_operation"(UUID)
  TO "nihongo_app";
GRANT EXECUTE ON FUNCTION "phase7_create_question_report"(
  TEXT, UUID, UUID, UUID, "QuestionReportReason", TEXT
) TO "nihongo_app";
GRANT EXECUTE ON FUNCTION "phase7_require_runtime_ready"(),
  "phase7_resolve_v1_principal"(TEXT)
TO "nihongo_app";

REVOKE ALL ON FUNCTION "phase7_register_database_capability"(
  TEXT, INET, INTEGER, "AdminAuditEnvironment"
) FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
GRANT EXECUTE ON FUNCTION "phase7_register_database_capability"(
  TEXT, INET, INTEGER, "AdminAuditEnvironment"
) TO "nihongo_phase7_migration";
GRANT EXECUTE ON FUNCTION "phase7_activate_v1_issuer"(
  "AdminAuditEnvironment"
) TO "nihongo_phase7_migration";

REVOKE ALL ON FUNCTION "phase7_change_password"(UUID, TEXT, TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_change_password_v1"(TEXT, TEXT, TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_request_password_reset"(TEXT, UUID, TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_consume_password_reset"(TEXT, TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_confirm_v1_session_issuance"(
  TEXT, UUID, UUID, INTEGER, "UserRole", "UserAccountStatus"
) FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_reauthenticate_v1_session"(
  TEXT, INTEGER, "UserRole", "UserAccountStatus", UUID, TEXT, TEXT, TEXT,
  UUID, UUID, "AdminAuditEnvironment"
) FROM PUBLIC, "nihongo_app", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_reauthentication_commit_matches"(
  TEXT, UUID, TEXT, UUID, UUID, "AdminAuditEnvironment", INTEGER,
  "UserRole", "UserAccountStatus"
) FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_refresh_remembered_session"(
  TEXT, INTEGER, "UserRole", "UserAccountStatus"
) FROM PUBLIC, "nihongo_app", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_refresh_current_remembered_session"(TEXT)
  FROM PUBLIC, "nihongo_app", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_change_user_authority"(
  TEXT, UUID, INTEGER, "UserRole", "UserAccountStatus",
  "AdminAuditEnvironment"
) FROM PUBLIC, "nihongo_app", "nihongo_erasure_worker";
REVOKE ALL ON FUNCTION "phase7_cleanup_expired_auth_state"(
  INTEGER, "AdminAuditEnvironment"
) FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway";

GRANT EXECUTE ON FUNCTION "phase7_change_password_v1"(TEXT, TEXT, TEXT),
  "phase7_request_password_reset"(TEXT, UUID, TEXT),
  "phase7_consume_password_reset"(TEXT, TEXT),
  "phase7_issue_v1_session"(
    UUID, INTEGER, "UserRole", "UserAccountStatus",
    UUID, TEXT, TEXT, TEXT, BOOLEAN
  ),
  "phase7_confirm_v1_session_issuance"(
    TEXT, UUID, UUID, INTEGER, "UserRole", "UserAccountStatus"
  ),
  "phase7_reauthenticate_v1_session"(
    TEXT, INTEGER, "UserRole", "UserAccountStatus", UUID, TEXT, TEXT, TEXT,
    UUID, UUID, "AdminAuditEnvironment"
  ),
  "phase7_owned_sign_out"(TEXT),
  "phase7_refresh_remembered_session"(
    TEXT, INTEGER, "UserRole", "UserAccountStatus"
  ),
  "phase7_refresh_current_remembered_session"(TEXT),
  "phase7_change_user_authority"(
    TEXT, UUID, INTEGER, "UserRole", "UserAccountStatus",
    "AdminAuditEnvironment"
  ),
  "phase7_require_runtime_ready"(),
  "phase7_resolve_sign_in_credential"(TEXT),
  "phase7_resolve_session_credential"(TEXT),
  "phase7_resolve_password_reset_credential"(TEXT),
  "phase7_sign_up_credential"(
    UUID, UUID, TEXT, TEXT, "JlptLevel", TEXT
  ),
  "phase7_resolve_email_verification_subject"(TEXT),
  "phase7_verify_email"(UUID, TEXT)
TO "nihongo_auth_gateway";

GRANT EXECUTE ON FUNCTION "phase7_cleanup_expired_auth_state"(
  INTEGER, "AdminAuditEnvironment"
), "phase7_erase_user"(UUID, "AdminAuditEnvironment"),
  "phase7_redact_expired_report_descriptions"(
    INTEGER, "AdminAuditEnvironment"
  )
TO "nihongo_erasure_worker";

-- Database ownership remains with the NOLOGIN migration role. Re-enter that
-- role explicitly before normalizing the cluster-wide database ACL.
SET LOCAL ROLE "nihongo_phase7_migration";

-- Database CONNECT is the environment boundary for the cluster-global group
-- roles. PUBLIC and cross-environment wrappers cannot connect and SET ROLE
-- into another technical database; only exact wrappers for this DB retain one
-- direct CONNECT ACL. Runtime attestation rejects every other direct ACL.
DO $phase7_database_connect_acl$
DECLARE
  database_name TEXT := current_database();
  database_owner TEXT;
  wrapper_prefix TEXT;
  wrapper_name TEXT;
  acl_row RECORD;
BEGIN
  SELECT owner_role.rolname INTO database_owner
  FROM pg_database AS database_row
  JOIN pg_roles AS owner_role ON owner_role.oid = database_row.datdba
  WHERE database_row.datname = database_name;
  IF database_owner IS DISTINCT FROM CURRENT_USER THEN
    RAISE EXCEPTION 'Phase 7 migration principal must own the target database.'
      USING ERRCODE = '42501';
  END IF;
  wrapper_prefix := CASE
    WHEN database_name ~ '_test$' THEN 'nihongo_test'
    WHEN database_name ~ '_dev$' THEN 'nihongo_development'
    ELSE NULL
  END;
  IF wrapper_prefix IS NULL THEN
    RAISE EXCEPTION 'Phase 7 requires a TEST or DEVELOPMENT database.'
      USING ERRCODE = '42501';
  END IF;

  EXECUTE pg_catalog.format(
    'REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC',
    database_name
  );
  FOR acl_row IN
    SELECT DISTINCT role_row.rolname
    FROM pg_database AS database_row
    CROSS JOIN LATERAL aclexplode(COALESCE(
      database_row.datacl,
      acldefault('d', database_row.datdba)
    )) AS acl_entry
    JOIN pg_roles AS role_row ON role_row.oid = acl_entry.grantee
    WHERE database_row.datname = database_name
      AND role_row.rolname <> database_owner
      AND role_row.rolname NOT IN (
        wrapper_prefix || '_phase7_migration_login',
        wrapper_prefix || '_app_login',
        wrapper_prefix || '_auth_gateway_login',
        wrapper_prefix || '_erasure_worker_login',
        wrapper_prefix || '_legacy_app_login'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I',
      database_name,
      acl_row.rolname
    );
  END LOOP;

  FOREACH wrapper_name IN ARRAY ARRAY[
    wrapper_prefix || '_phase7_migration_login',
    wrapper_prefix || '_app_login',
    wrapper_prefix || '_auth_gateway_login',
    wrapper_prefix || '_erasure_worker_login',
    wrapper_prefix || '_legacy_app_login'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = wrapper_name) THEN
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I',
        database_name,
        wrapper_name
      );
      EXECUTE pg_catalog.format(
        'GRANT CONNECT ON DATABASE %I TO %I',
        database_name,
        wrapper_name
      );
    END IF;
  END LOOP;
END;
$phase7_database_connect_acl$;

-- Do not RESET ROLE: SET LOCAL ends at COMMIT and the canonical wrapper's
-- startup migration role remains available for Prisma's ledger finalization.

DO $phase7_final_membership$
DECLARE
  unsafe_membership RECORD;
BEGIN
  SELECT member_role.rolname AS member_name,
    granted_role.rolname AS granted_name
  INTO unsafe_membership
  FROM pg_auth_members AS membership
  JOIN pg_roles AS member_role ON member_role.oid = membership.member
  JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
  WHERE (
    member_role.rolname IN (
      'nihongo_phase7_owner', 'nihongo_phase7_migration', 'nihongo_app',
      'nihongo_auth_gateway', 'nihongo_erasure_worker'
    )
    OR granted_role.rolname IN (
      'nihongo_phase7_owner', 'nihongo_phase7_migration', 'nihongo_app',
      'nihongo_auth_gateway', 'nihongo_erasure_worker'
    )
  ) AND NOT (
    member_role.rolname = 'nihongo_phase7_migration'
      AND granted_role.rolname = 'nihongo_phase7_owner'
      AND NOT membership.admin_option
      AND NOT membership.inherit_option
      AND membership.set_option
    OR EXISTS (
      SELECT 1
      FROM (VALUES
        ('nihongo_test_phase7_migration_login', 'nihongo_phase7_migration'),
        ('nihongo_test_app_login', 'nihongo_app'),
        ('nihongo_test_auth_gateway_login', 'nihongo_auth_gateway'),
        ('nihongo_test_erasure_worker_login', 'nihongo_erasure_worker'),
        ('nihongo_development_phase7_migration_login', 'nihongo_phase7_migration'),
        ('nihongo_development_app_login', 'nihongo_app'),
        ('nihongo_development_auth_gateway_login', 'nihongo_auth_gateway'),
        ('nihongo_development_erasure_worker_login', 'nihongo_erasure_worker')
      ) AS wrapper_map(member_name, granted_name)
      WHERE wrapper_map.member_name = member_role.rolname
        AND wrapper_map.granted_name = granted_role.rolname
        AND NOT membership.admin_option
        AND NOT membership.inherit_option
        AND membership.set_option
    )
  )
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Final Phase 7 membership is unsafe: % -> %.',
      unsafe_membership.member_name, unsafe_membership.granted_name
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members AS membership
    JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
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
    RAISE EXCEPTION 'Final Phase 7 wrapper graph is unsafe.'
      USING ERRCODE = '42501';
  END IF;
END;
$phase7_final_membership$;

SELECT pg_temp.phase7_assert_no_external_dependencies(
  pg_catalog.current_setting('app.phase7_target_schema', false)::NAME
);

DO $phase7_final_schema_shape$
DECLARE
  actual_digest TEXT := pg_temp.phase7_schema_shape_digest(
    pg_catalog.current_setting('app.phase7_target_schema', false)::NAME
  );
  expected_digest CONSTANT TEXT :=
    '09a071d20545f6868cb9838631180ee98e62c91cff3a42a683c55b0563686b91';
BEGIN
  IF actual_digest <> expected_digest THEN
    RAISE EXCEPTION 'Final Phase 7 canonical schema shape drifted: %.',
      actual_digest USING ERRCODE = '55000';
  END IF;
END;
$phase7_final_schema_shape$;

COMMIT;
