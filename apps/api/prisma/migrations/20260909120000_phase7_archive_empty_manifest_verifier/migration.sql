-- Phase 7 Slice 4F: archive empty-manifest verifier forward remediation.
-- The prior 29 migrations remain immutable. This migration replaces only the
-- operation-manifest verifier so QUESTION_ARCHIVE can prove its canonical
-- Question-only delta when neither a current nor open version exists.

BEGIN;

-- Prisma selects one isolated application schema before this transaction.
-- Capture it, then perform every authority and shadow check pg_catalog-first.
SELECT pg_catalog.set_config(
  'app.phase7_target_schema',
  pg_catalog.current_schema(),
  true
);
SELECT pg_catalog.set_config(
  'search_path',
  'pg_catalog, pg_temp',
  true
);

-- Refuse to create a default-PUBLIC routine if the exact internal verifier is
-- missing or its security catalog has drifted.
DO $phase7_archive_verifier_preflight$
DECLARE
  target_schema pg_catalog.NAME := pg_catalog.current_setting(
    'app.phase7_target_schema',
    false
  )::pg_catalog.NAME;
  expected_wrapper pg_catalog.TEXT := CASE
    WHEN pg_catalog.current_database() ~ '_test$'
      THEN 'nihongo_test_phase7_migration_login'
    WHEN pg_catalog.current_database() ~ '_dev$'
      THEN 'nihongo_development_phase7_migration_login'
    ELSE NULL
  END;
  verifier_oid pg_catalog.OID;
BEGIN
  IF expected_wrapper IS NULL
    OR SESSION_USER <> expected_wrapper
    OR CURRENT_USER <> 'nihongo_phase7_migration'
    OR pg_catalog.current_setting('role', true)
      <> 'nihongo_phase7_migration'
    OR pg_catalog.current_setting('session_replication_role') <> 'origin' THEN
    RAISE EXCEPTION
      'Phase 7 archive verifier migration principal is not canonical.'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('nihongo_phase7_owner'::pg_catalog.TEXT, false::pg_catalog.BOOL),
      ('nihongo_phase7_migration'::pg_catalog.TEXT, false::pg_catalog.BOOL),
      (expected_wrapper, true::pg_catalog.BOOL)
    ) AS required(role_name, can_login)
    LEFT JOIN pg_catalog.pg_roles AS role_record
      ON role_record.rolname = required.role_name
    WHERE role_record.rolname IS NULL
      OR role_record.rolcanlogin IS DISTINCT FROM required.can_login
      OR role_record.rolinherit
      OR role_record.rolsuper
      OR role_record.rolcreatedb
      OR role_record.rolcreaterole
      OR role_record.rolreplication
      OR role_record.rolbypassrls
  ) THEN
    RAISE EXCEPTION
      'Phase 7 archive verifier migration roles are not canonical.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_database AS database_record
    JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.oid = database_record.datdba
    WHERE database_record.datname = pg_catalog.current_database()
      AND owner_role.rolname = 'nihongo_phase7_migration'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespace
    JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.oid = namespace.nspowner
    WHERE namespace.nspname = target_schema
      AND owner_role.rolname = 'nihongo_phase7_owner'
  ) THEN
    RAISE EXCEPTION
      'Phase 7 archive verifier database or schema owner is not canonical.'
      USING ERRCODE = '42501';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS member_role
      ON member_role.oid = membership.member
    JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = membership.roleid
    WHERE member_role.rolname = 'nihongo_phase7_migration'
      AND granted_role.rolname = 'nihongo_phase7_owner'
      AND NOT membership.admin_option
      AND NOT membership.inherit_option
      AND membership.set_option
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS member_role
      ON member_role.oid = membership.member
    JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = membership.roleid
    WHERE member_role.rolname = expected_wrapper
      AND granted_role.rolname = 'nihongo_phase7_migration'
      AND NOT membership.admin_option
      AND NOT membership.inherit_option
      AND membership.set_option
  ) <> 1 THEN
    RAISE EXCEPTION
      'Phase 7 archive verifier SET-only role graph is not canonical.'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS member_role
      ON member_role.oid = membership.member
    JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = membership.roleid
    WHERE member_role.rolname IN (
      'nihongo_test_phase7_migration_login', 'nihongo_test_app_login',
      'nihongo_test_auth_gateway_login', 'nihongo_test_erasure_worker_login',
      'nihongo_test_legacy_app_login',
      'nihongo_development_phase7_migration_login',
      'nihongo_development_app_login',
      'nihongo_development_auth_gateway_login',
      'nihongo_development_erasure_worker_login',
      'nihongo_development_legacy_app_login'
    ) AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('nihongo_test_phase7_migration_login', 'nihongo_phase7_migration'),
        ('nihongo_test_app_login', 'nihongo_app'),
        ('nihongo_test_auth_gateway_login', 'nihongo_auth_gateway'),
        ('nihongo_test_erasure_worker_login', 'nihongo_erasure_worker'),
        ('nihongo_development_phase7_migration_login',
          'nihongo_phase7_migration'),
        ('nihongo_development_app_login', 'nihongo_app'),
        ('nihongo_development_auth_gateway_login', 'nihongo_auth_gateway'),
        ('nihongo_development_erasure_worker_login',
          'nihongo_erasure_worker')
      ) AS allowed(member_name, granted_name)
      WHERE allowed.member_name = member_role.rolname
        AND allowed.granted_name = granted_role.rolname
        AND NOT membership.admin_option
        AND NOT membership.inherit_option
        AND membership.set_option
    )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS member_role
      ON member_role.oid = membership.member
    JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = membership.roleid
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
          ('nihongo_development_phase7_migration_login',
            'nihongo_phase7_migration'),
          ('nihongo_development_app_login', 'nihongo_app'),
          ('nihongo_development_auth_gateway_login', 'nihongo_auth_gateway'),
          ('nihongo_development_erasure_worker_login',
            'nihongo_erasure_worker')
        ) AS allowed(member_name, granted_name)
        WHERE allowed.member_name = member_role.rolname
          AND allowed.granted_name = granted_role.rolname
          AND NOT membership.admin_option
          AND NOT membership.inherit_option
          AND membership.set_option
      )
    )
  ) THEN
    RAISE EXCEPTION
      'Phase 7 archive verifier membership graph is not canonical.'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
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
    RAISE EXCEPTION
      'Phase 7 LOGIN wrappers cannot be granted to another role.'
      USING ERRCODE = '42501';
  END IF;
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
        SELECT 1
        FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid =
            'pg_catalog.pg_class'::pg_catalog.regclass
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
        SELECT 1
        FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid =
            'pg_catalog.pg_type'::pg_catalog.regclass
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
        SELECT 1
        FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid =
            'pg_catalog.pg_proc'::pg_catalog.regclass
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
    RAISE EXCEPTION
      'Phase 7 archive verifier target schema has a pg_catalog shadow.'
      USING ERRCODE = '42501';
  END IF;
  SELECT procedure_record.oid
  INTO verifier_oid
  FROM pg_catalog.pg_proc AS procedure_record
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure_record.pronamespace
  JOIN pg_catalog.pg_roles AS owner_role
    ON owner_role.oid = procedure_record.proowner
  JOIN pg_catalog.pg_language AS language
    ON language.oid = procedure_record.prolang
  WHERE namespace.nspname = target_schema
    AND procedure_record.proname = 'phase7_verify_operation_manifest'
    AND procedure_record.pronargs = 1
    AND procedure_record.proargtypes = '2950'::pg_catalog.oidvector
    AND procedure_record.prorettype = 'pg_catalog.void'::pg_catalog.regtype
    AND procedure_record.prokind = 'f'
    AND NOT procedure_record.proretset
    AND procedure_record.provariadic = 0
    AND procedure_record.pronargdefaults = 0
    AND procedure_record.proargdefaults IS NULL
    AND language.lanname = 'plpgsql'
    AND owner_role.rolname = 'nihongo_phase7_owner'
    AND procedure_record.prosecdef
    AND NOT procedure_record.proleakproof
    AND procedure_record.proconfig IS NOT DISTINCT FROM ARRAY[
      'search_path=pg_catalog, ' || target_schema || ', pg_temp'
    ]::pg_catalog.TEXT[];
  IF verifier_oid IS NULL
    OR pg_catalog.has_function_privilege(
      'nihongo_phase7_migration', verifier_oid, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'nihongo_app', verifier_oid, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'nihongo_auth_gateway', verifier_oid, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'nihongo_erasure_worker', verifier_oid, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'nihongo_phase7_owner', verifier_oid, 'EXECUTE'
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(
          (SELECT procedure_record.proacl
           FROM pg_catalog.pg_proc AS procedure_record
           WHERE procedure_record.oid = verifier_oid),
          pg_catalog.acldefault(
            'f',
            (SELECT procedure_record.proowner
             FROM pg_catalog.pg_proc AS procedure_record
             WHERE procedure_record.oid = verifier_oid)
          )
        )
      ) AS privilege
      WHERE privilege.grantee <> (
        SELECT role_record.oid
        FROM pg_catalog.pg_roles AS role_record
        WHERE role_record.rolname = 'nihongo_phase7_owner'
      )
    ) THEN
    RAISE EXCEPTION
      'Phase 7 operation manifest verifier catalog is not exact.'
      USING ERRCODE = '42501';
  END IF;
END;
$phase7_archive_verifier_preflight$;

-- Only after the pg_catalog-only preflight may the exact existing target
-- routine be selected for replacement.
SELECT pg_catalog.set_config(
  'search_path',
  pg_catalog.quote_ident(
    pg_catalog.current_setting('app.phase7_target_schema', false)
  ) ||
    ', pg_catalog, pg_temp',
  true
);

-- The migration role has SET-only membership in the NOLOGIN owner. Replacing
-- an owner-owned routine requires entering that role without widening ACLs.
SET LOCAL ROLE "nihongo_phase7_owner";

CREATE OR REPLACE FUNCTION "phase7_verify_operation_manifest"(operation_id UUID)
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
    WHEN 'PUBLICATION', 'RETIREMENT' THEN
      IF question_delta_ids <> manifest_question_ids
        OR version_delta_ids <> manifest_version_ids
        OR version_delta_question_ids <> manifest_question_ids THEN
        RAISE EXCEPTION 'Aggregate lifecycle target set is not exact.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'QUESTION_ARCHIVE' THEN
      IF question_delta_ids <> manifest_question_ids
        OR version_delta_ids <> manifest_version_ids
        OR version_delta_question_ids <> (CASE
          WHEN cardinality(manifest_version_ids) = 0 THEN empty_ids
          ELSE manifest_question_ids
        END) THEN
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

-- CREATE OR REPLACE preserves ownership and ACL, while this owner-only
-- normalization makes the fixed path explicit even when a migration client
-- started with only the isolated schema in its search_path.
DO $phase7_archive_verifier_search_path$
DECLARE
  target_schema NAME := pg_catalog.current_setting(
    'app.phase7_target_schema',
    false
  )::NAME;
BEGIN
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %I.phase7_verify_operation_manifest(UUID) SET search_path TO pg_catalog, %I, pg_temp',
    target_schema,
    target_schema
  );
END;
$phase7_archive_verifier_search_path$;

-- Do not RESET ROLE: return explicitly to the canonical migration role so
-- Prisma can finalize its append-only ledger row after this transaction.
SET LOCAL ROLE "nihongo_phase7_migration";

COMMIT;
