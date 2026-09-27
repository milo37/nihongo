import type { PrismaClient } from '../generated/prisma/client.js'
import { getPostgresSchema } from './databaseOptions.js'

type Phase7RuntimeRole = 'nihongo_app' | 'nihongo_auth_gateway'

interface RuntimeRoleEvidence {
  currentDatabase: string
  currentDatabaseExpectedWrapperConnectAclCount: number
  currentDatabaseUnexpectedAclCount: number
  currentRole: string
  currentSchema: string
  directGrants: string[]
  groupBypassRls: boolean
  groupCanLogin: boolean
  groupCanControlReplicationRole: boolean
  groupCreateDb: boolean
  groupCreateRole: boolean
  groupDirectGrants: string[]
  groupInherit: boolean
  groupSensitiveColumnAclCount: number
  groupSensitiveTableAclCount: number
  groupReplication: boolean
  groupSuperuser: boolean
  databaseOwner: string
  serverAddress: string | null
  serverPort: number | null
  schemaOwner: string
  sessionReplicationRole: string
  sessionUser: string
  sessionUserBypassRls: boolean
  sessionUserCanLogin: boolean
  sessionUserCanControlReplicationRole: boolean
  sessionUserColumnAclCount: number
  sessionUserCreateDb: boolean
  sessionUserCreateRole: boolean
  sessionUserCurrentDatabaseConnectAclCount: number
  sessionUserInherit: boolean
  sessionUserMembershipAdminOption: boolean
  sessionUserMembershipInheritOption: boolean
  sessionUserMembershipSetOption: boolean
  sessionUserOtherDirectAclCount: number
  sessionUserReplication: boolean
  sessionUserSuperuser: boolean
  sessionUserCanSetRole: boolean
  timeZone: string
}

interface RuntimeRoleEndpoint {
  client: Pick<PrismaClient, '$queryRawUnsafe'>
  connectionString: string
  expectedRole: Phase7RuntimeRole
}

const ATTESTATION_QUERY = `
  SELECT
    current_database() AS "currentDatabase",
    database_acl_shape."currentDatabaseExpectedWrapperConnectAclCount" AS "currentDatabaseExpectedWrapperConnectAclCount",
    database_acl_shape."currentDatabaseUnexpectedAclCount" AS "currentDatabaseUnexpectedAclCount",
    current_user AS "currentRole",
    current_schema() AS "currentSchema",
    inet_server_addr()::text AS "serverAddress",
    inet_server_port() AS "serverPort",
    current_setting('TimeZone') AS "timeZone",
    current_setting('session_replication_role') AS "sessionReplicationRole",
    session_user AS "sessionUser",
    database_owner.rolname AS "databaseOwner",
    schema_owner.rolname AS "schemaOwner",
    session_role.rolcanlogin AS "sessionUserCanLogin",
    (has_parameter_privilege(
       session_user, 'session_replication_role', 'SET'
     ) OR has_parameter_privilege(
       session_user, 'session_replication_role', 'ALTER SYSTEM'
     )) AS "sessionUserCanControlReplicationRole",
    wrapper_acl."sessionUserColumnAclCount" AS "sessionUserColumnAclCount",
    session_role.rolsuper AS "sessionUserSuperuser",
    session_role.rolcreatedb AS "sessionUserCreateDb",
    session_role.rolcreaterole AS "sessionUserCreateRole",
    session_role.rolreplication AS "sessionUserReplication",
    session_role.rolbypassrls AS "sessionUserBypassRls",
    session_role.rolinherit AS "sessionUserInherit",
    target_membership.admin_option AS "sessionUserMembershipAdminOption",
    target_membership.inherit_option AS "sessionUserMembershipInheritOption",
    target_membership.set_option AS "sessionUserMembershipSetOption",
    group_role.rolcanlogin AS "groupCanLogin",
    (has_parameter_privilege(
       current_user, 'session_replication_role', 'SET'
     ) OR has_parameter_privilege(
       current_user, 'session_replication_role', 'ALTER SYSTEM'
     )) AS "groupCanControlReplicationRole",
    group_role.rolsuper AS "groupSuperuser",
    group_role.rolcreatedb AS "groupCreateDb",
    group_role.rolcreaterole AS "groupCreateRole",
    group_role.rolreplication AS "groupReplication",
    group_role.rolbypassrls AS "groupBypassRls",
    group_role.rolinherit AS "groupInherit",
    group_acl."groupSensitiveColumnAclCount" AS "groupSensitiveColumnAclCount",
    group_acl."groupSensitiveTableAclCount" AS "groupSensitiveTableAclCount",
    wrapper_acl."sessionUserCurrentDatabaseConnectAclCount" AS "sessionUserCurrentDatabaseConnectAclCount",
    wrapper_acl."sessionUserOtherDirectAclCount" AS "sessionUserOtherDirectAclCount",
    pg_has_role(session_user, current_user, 'SET') AS "sessionUserCanSetRole",
    COALESCE((
      SELECT array_agg(granted_role.rolname ORDER BY granted_role.rolname)
      FROM pg_auth_members AS membership
      JOIN pg_roles AS member_role ON member_role.oid = membership.member
      JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
      WHERE member_role.rolname = session_user
    ), ARRAY[]::name[])::text[] AS "directGrants",
    COALESCE((
      SELECT array_agg(granted_role.rolname ORDER BY granted_role.rolname)
      FROM pg_auth_members AS membership
      JOIN pg_roles AS member_role ON member_role.oid = membership.member
      JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
      WHERE member_role.rolname = current_user
    ), ARRAY[]::name[])::text[] AS "groupDirectGrants"
  FROM pg_roles AS session_role
  CROSS JOIN pg_roles AS group_role
  JOIN pg_auth_members AS target_membership
    ON target_membership.member = session_role.oid
   AND target_membership.roleid = group_role.oid
  JOIN pg_database AS target_database
    ON target_database.datname = current_database()
  JOIN pg_roles AS database_owner
    ON database_owner.oid = target_database.datdba
  JOIN pg_namespace AS target_schema
    ON target_schema.nspname = current_schema()
  JOIN pg_roles AS schema_owner
    ON schema_owner.oid = target_schema.nspowner
  CROSS JOIN LATERAL (
    SELECT
      (SELECT count(*)::int FROM pg_attribute AS column_acl
       CROSS JOIN LATERAL aclexplode(column_acl.attacl) AS entry
       WHERE entry.grantee = session_role.oid) AS "sessionUserColumnAclCount",
      (SELECT count(*)::int FROM pg_database AS database_acl
       CROSS JOIN LATERAL aclexplode(COALESCE(database_acl.datacl, acldefault('d', database_acl.datdba))) AS entry
       WHERE database_acl.datname = current_database()
         AND entry.grantee = session_role.oid
         AND entry.privilege_type = 'CONNECT'
         AND NOT entry.is_grantable) AS "sessionUserCurrentDatabaseConnectAclCount",
      (
      (SELECT count(*) FROM pg_database AS database_acl
       CROSS JOIN LATERAL aclexplode(COALESCE(database_acl.datacl, acldefault('d', database_acl.datdba))) AS entry
       WHERE entry.grantee = session_role.oid
         AND NOT (
           database_acl.datname = current_database()
           AND entry.privilege_type = 'CONNECT'
           AND NOT entry.is_grantable
         ))
      + (SELECT count(*) FROM pg_namespace AS schema_acl
         CROSS JOIN LATERAL aclexplode(COALESCE(schema_acl.nspacl, acldefault('n', schema_acl.nspowner))) AS entry
         WHERE entry.grantee = session_role.oid)
      + (SELECT count(*) FROM pg_class AS relation_acl
         CROSS JOIN LATERAL aclexplode(COALESCE(relation_acl.relacl, acldefault(CASE WHEN relation_acl.relkind = 'S' THEN 's'::"char" ELSE 'r'::"char" END, relation_acl.relowner))) AS entry
         WHERE entry.grantee = session_role.oid)
      + (SELECT count(*) FROM pg_proc AS function_acl
         CROSS JOIN LATERAL aclexplode(COALESCE(function_acl.proacl, acldefault('f', function_acl.proowner))) AS entry
         WHERE entry.grantee = session_role.oid)
      + (SELECT count(*) FROM pg_type AS type_acl
         CROSS JOIN LATERAL aclexplode(COALESCE(type_acl.typacl, acldefault('T', type_acl.typowner))) AS entry
         WHERE entry.grantee = session_role.oid)
      + (SELECT count(*) FROM pg_default_acl AS default_acl
         CROSS JOIN LATERAL aclexplode(default_acl.defaclacl) AS entry
         WHERE entry.grantee = session_role.oid)
    )::int AS "sessionUserOtherDirectAclCount"
  ) AS wrapper_acl
  CROSS JOIN LATERAL (
    SELECT
      (SELECT count(*)::int
       FROM pg_class AS sensitive_relation
       JOIN pg_namespace AS sensitive_namespace
         ON sensitive_namespace.oid = sensitive_relation.relnamespace
       JOIN pg_attribute AS sensitive_column
         ON sensitive_column.attrelid = sensitive_relation.oid
       WHERE sensitive_namespace.nspname = current_schema()
         AND sensitive_relation.relname = ANY(ARRAY[
           'User', 'Account', 'Session', 'AuthSessionFamily',
           'AuthSessionRotationFence',
           'Phase7ReauthenticationIntent',
           'Phase7AuthorityRevocationEvidence'
         ]::name[])
         AND sensitive_column.attnum > 0
         AND NOT sensitive_column.attisdropped
         AND has_column_privilege(
           current_user,
           sensitive_relation.oid,
           sensitive_column.attnum,
           'SELECT,INSERT,UPDATE,REFERENCES'
         )) AS "groupSensitiveColumnAclCount",
      (SELECT count(*)::int
       FROM pg_class AS sensitive_relation
       JOIN pg_namespace AS sensitive_namespace
         ON sensitive_namespace.oid = sensitive_relation.relnamespace
       WHERE sensitive_namespace.nspname = current_schema()
         AND sensitive_relation.relname = ANY(ARRAY[
           'User', 'Account', 'Session', 'AuthSessionFamily',
           'AuthSessionRotationFence',
           'Phase7ReauthenticationIntent',
           'Phase7AuthorityRevocationEvidence'
         ]::name[])
         AND has_table_privilege(
           current_user,
           sensitive_relation.oid,
           'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
         )) AS "groupSensitiveTableAclCount"
  ) AS group_acl
  CROSS JOIN LATERAL (
    SELECT
      count(*) FILTER (
        WHERE acl_role.rolname = ANY (ARRAY[
          CASE WHEN current_database() ~ '_test$'
            THEN 'nihongo_test_phase7_migration_login'
            ELSE 'nihongo_development_phase7_migration_login' END,
          CASE WHEN current_database() ~ '_test$'
            THEN 'nihongo_test_app_login'
            ELSE 'nihongo_development_app_login' END,
          CASE WHEN current_database() ~ '_test$'
            THEN 'nihongo_test_auth_gateway_login'
            ELSE 'nihongo_development_auth_gateway_login' END,
          CASE WHEN current_database() ~ '_test$'
            THEN 'nihongo_test_erasure_worker_login'
            ELSE 'nihongo_development_erasure_worker_login' END
        ]::name[])
          AND entry.privilege_type = 'CONNECT'
          AND NOT entry.is_grantable
      )::int AS "currentDatabaseExpectedWrapperConnectAclCount",
      count(*) FILTER (
        WHERE entry.is_grantable
          OR entry.grantee = 0
          OR (
            entry.grantee <> target_database.datdba
            AND NOT (
              acl_role.rolname = ANY (ARRAY[
                CASE WHEN current_database() ~ '_test$'
                  THEN 'nihongo_test_phase7_migration_login'
                  ELSE 'nihongo_development_phase7_migration_login' END,
                CASE WHEN current_database() ~ '_test$'
                  THEN 'nihongo_test_app_login'
                  ELSE 'nihongo_development_app_login' END,
                CASE WHEN current_database() ~ '_test$'
                  THEN 'nihongo_test_auth_gateway_login'
                  ELSE 'nihongo_development_auth_gateway_login' END,
                CASE WHEN current_database() ~ '_test$'
                  THEN 'nihongo_test_erasure_worker_login'
                  ELSE 'nihongo_development_erasure_worker_login' END
              ]::name[])
              AND entry.privilege_type = 'CONNECT'
              AND NOT entry.is_grantable
            )
          )
          OR (
            entry.grantee = target_database.datdba
            AND entry.privilege_type NOT IN ('CONNECT', 'CREATE', 'TEMPORARY')
          )
      )::int AS "currentDatabaseUnexpectedAclCount"
    FROM pg_database AS database_acl
    CROSS JOIN LATERAL aclexplode(COALESCE(
      database_acl.datacl,
      acldefault('d', database_acl.datdba)
    )) AS entry
    LEFT JOIN pg_roles AS acl_role ON acl_role.oid = entry.grantee
    WHERE database_acl.datname = current_database()
  ) AS database_acl_shape
  WHERE session_role.rolname = session_user
    AND group_role.rolname = current_user`

const getConfiguredLoginRole = (connectionString: string): string => {
  const encodedUsername = new URL(connectionString).username
  if (!encodedUsername) {
    throw new Error('Phase 7 runtime DB wrapper login is missing.')
  }

  try {
    return decodeURIComponent(encodedUsername)
  } catch {
    throw new Error('Phase 7 runtime DB wrapper login is malformed.')
  }
}

const getConfiguredDatabase = (connectionString: string): string => {
  const pathname = new URL(connectionString).pathname
  if (!pathname.startsWith('/') || pathname.length <= 1) {
    throw new Error('Phase 7 runtime DB name is missing.')
  }
  try {
    return decodeURIComponent(pathname.slice(1))
  } catch {
    throw new Error('Phase 7 runtime DB name is malformed.')
  }
}

const arraysEqual = (
  left: readonly string[],
  right: readonly string[]
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

const expectedWrapperRole = (
  database: string,
  runtimeRole: Phase7RuntimeRole
): string | null => {
  const environmentPrefix = database.endsWith('_test')
    ? 'nihongo_test'
    : database.endsWith('_dev')
      ? 'nihongo_development'
      : null
  if (!environmentPrefix) return null
  const roleSuffix =
    runtimeRole === 'nihongo_app' ? 'app_login' : 'auth_gateway_login'
  return `${environmentPrefix}_${roleSuffix}`
}

const assertEndpoint = (
  evidence: RuntimeRoleEvidence,
  endpoint: Omit<RuntimeRoleEndpoint, 'client'>
): void => {
  const configuredLogin = getConfiguredLoginRole(endpoint.connectionString)
  const configuredDatabase = getConfiguredDatabase(endpoint.connectionString)
  const configuredSchema = getPostgresSchema(endpoint.connectionString)
  const requiredLogin = expectedWrapperRole(
    configuredDatabase,
    endpoint.expectedRole
  )
  const isExact =
    requiredLogin !== null &&
    configuredLogin === requiredLogin &&
    configuredSchema !== undefined &&
    evidence.currentDatabase === configuredDatabase &&
    evidence.currentSchema === configuredSchema &&
    evidence.currentRole === endpoint.expectedRole &&
    evidence.sessionUser === configuredLogin &&
    evidence.sessionUser !== endpoint.expectedRole &&
    evidence.timeZone === 'UTC' &&
    evidence.sessionUserCanLogin &&
    evidence.sessionUserCanSetRole &&
    !evidence.sessionUserSuperuser &&
    !evidence.sessionUserCreateDb &&
    !evidence.sessionUserCreateRole &&
    !evidence.sessionUserReplication &&
    !evidence.sessionUserBypassRls &&
    !evidence.sessionUserCanControlReplicationRole &&
    !evidence.sessionUserInherit &&
    !evidence.sessionUserMembershipAdminOption &&
    !evidence.sessionUserMembershipInheritOption &&
    evidence.sessionUserMembershipSetOption &&
    evidence.currentDatabaseExpectedWrapperConnectAclCount === 4 &&
    evidence.currentDatabaseUnexpectedAclCount === 0 &&
    evidence.sessionUserCurrentDatabaseConnectAclCount === 1 &&
    evidence.sessionUserColumnAclCount === 0 &&
    evidence.sessionUserOtherDirectAclCount === 0 &&
    !evidence.groupCanLogin &&
    !evidence.groupCanControlReplicationRole &&
    !evidence.groupSuperuser &&
    !evidence.groupCreateDb &&
    !evidence.groupCreateRole &&
    !evidence.groupReplication &&
    !evidence.groupBypassRls &&
    !evidence.groupInherit &&
    evidence.groupSensitiveColumnAclCount === 0 &&
    evidence.groupSensitiveTableAclCount === 0 &&
    evidence.databaseOwner === 'nihongo_phase7_migration' &&
    evidence.schemaOwner === 'nihongo_phase7_owner' &&
    evidence.sessionReplicationRole === 'origin' &&
    arraysEqual(evidence.directGrants, [endpoint.expectedRole]) &&
    evidence.groupDirectGrants.length === 0

  if (!isExact) {
    throw new Error('Phase 7 runtime DB role attestation failed.')
  }
}

export const assertPhase7RuntimeRoleEvidence = (
  application: RuntimeRoleEvidence,
  authGateway: RuntimeRoleEvidence,
  endpoints: {
    application: Omit<RuntimeRoleEndpoint, 'client'>
    authGateway: Omit<RuntimeRoleEndpoint, 'client'>
  }
): void => {
  assertEndpoint(application, endpoints.application)
  assertEndpoint(authGateway, endpoints.authGateway)

  const sameTarget =
    application.serverAddress !== null &&
    application.serverPort !== null &&
    application.currentDatabase === authGateway.currentDatabase &&
    application.currentSchema === authGateway.currentSchema &&
    application.serverAddress === authGateway.serverAddress &&
    application.serverPort === authGateway.serverPort &&
    application.sessionUser !== authGateway.sessionUser

  if (!sameTarget) {
    throw new Error(
      'Phase 7 runtime DB endpoints do not share one safe target.'
    )
  }
}

export const attestPhase7RuntimeRoles = async ({
  application,
  authGateway
}: {
  application: RuntimeRoleEndpoint
  authGateway: RuntimeRoleEndpoint
}): Promise<void> => {
  const [applicationRows, authGatewayRows] = await Promise.all([
    application.client.$queryRawUnsafe<RuntimeRoleEvidence[]>(
      ATTESTATION_QUERY
    ),
    authGateway.client.$queryRawUnsafe<RuntimeRoleEvidence[]>(ATTESTATION_QUERY)
  ])
  if (applicationRows.length !== 1 || authGatewayRows.length !== 1) {
    throw new Error('Phase 7 runtime DB role evidence is unavailable.')
  }

  assertPhase7RuntimeRoleEvidence(applicationRows[0]!, authGatewayRows[0]!, {
    application: {
      connectionString: application.connectionString,
      expectedRole: application.expectedRole
    },
    authGateway: {
      connectionString: authGateway.connectionString,
      expectedRole: authGateway.expectedRole
    }
  })
}

export type { RuntimeRoleEvidence }
