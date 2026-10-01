import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { Client } from 'pg'
import {
  assertSafeAdminCmsDatabase,
  assertSafeTestDatabase
} from '../db/databaseTargetGuard.js'
import {
  retireOwnedProcess,
  shouldDetachOwnedProcess,
  stopOwnedProcesses
} from './ownedProcessGroup.js'
import { getPhase10ApiIntegrationPathsByOwner } from './phase10ApiIntegrationManifest.js'
import { runPhase10ManifestVitestFile } from './phase10ApiIntegrationExecution.js'

const SCHEMA_PATTERN = /^phase7_[a-f0-9]{32}_test$/
const DATABASE_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/
const PHASE7_GROUP_ROLES = [
  'nihongo_phase7_owner',
  'nihongo_phase7_migration',
  'nihongo_app',
  'nihongo_auth_gateway',
  'nihongo_erasure_worker'
] as const
const PHASE7_WRAPPER_ROLES = [
  {
    name: 'nihongo_test_phase7_migration_login',
    grantedRole: 'nihongo_phase7_migration'
  },
  { name: 'nihongo_test_app_login', grantedRole: 'nihongo_app' },
  {
    name: 'nihongo_test_auth_gateway_login',
    grantedRole: 'nihongo_auth_gateway'
  },
  {
    name: 'nihongo_test_erasure_worker_login',
    grantedRole: 'nihongo_erasure_worker'
  },
  {
    name: 'nihongo_development_phase7_migration_login',
    grantedRole: 'nihongo_phase7_migration'
  },
  { name: 'nihongo_development_app_login', grantedRole: 'nihongo_app' },
  {
    name: 'nihongo_development_auth_gateway_login',
    grantedRole: 'nihongo_auth_gateway'
  },
  {
    name: 'nihongo_development_erasure_worker_login',
    grantedRole: 'nihongo_erasure_worker'
  }
] as const
const PHASE7_LEGACY_ROLES = [
  'nihongo_test_legacy_app_login',
  'nihongo_development_legacy_app_login'
] as const
const TEST_MIGRATION_LOGIN = 'nihongo_test_phase7_migration_login'
const TEST_APPLICATION_LOGIN = 'nihongo_test_app_login'
const TEST_AUTH_GATEWAY_LOGIN = 'nihongo_test_auth_gateway_login'
const TEST_LEGACY_LOGIN = 'nihongo_test_legacy_app_login'
const DEVELOPMENT_APPLICATION_LOGIN = 'nihongo_development_app_login'
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..'
)

dotenv.config({
  path: path.join(repositoryRoot, 'apps/api/.env.test'),
  override: true,
  quiet: true
})

const baseDatabaseUrl =
  process.env.PHASE7_INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL

if (!baseDatabaseUrl) {
  throw new Error('Phase 7 DB integration requires a test PostgreSQL URL.')
}

const syntheticProductionDatabaseUrl = new URL(baseDatabaseUrl)
syntheticProductionDatabaseUrl.pathname =
  '/nihongo_phase7_production_guard_sentinel'
syntheticProductionDatabaseUrl.searchParams.delete('schema')

assertSafeTestDatabase({
  nodeEnvironment: 'test',
  databaseUrl: baseDatabaseUrl,
  productionDatabaseUrl: syntheticProductionDatabaseUrl.toString()
})
assertSafeAdminCmsDatabase({
  adminCmsMode: 'technical',
  nodeEnvironment: 'test',
  databaseUrl: baseDatabaseUrl,
  productionDatabaseUrl: syntheticProductionDatabaseUrl.toString()
})

const schemaName = `phase7_${randomUUID().replaceAll('-', '')}_test`
if (!SCHEMA_PATTERN.test(schemaName)) {
  throw new Error('Generated Phase 7 integration schema is unsafe.')
}

const adminDatabaseUrl = new URL(baseDatabaseUrl)
adminDatabaseUrl.searchParams.delete('schema')
adminDatabaseUrl.searchParams.delete('options')
const targetDatabaseUrl = new URL(adminDatabaseUrl)
targetDatabaseUrl.searchParams.set('schema', schemaName)
const databaseName = decodeURIComponent(adminDatabaseUrl.pathname.slice(1))
if (!DATABASE_IDENTIFIER_PATTERN.test(databaseName)) {
  throw new Error('Phase 7 integration database name is unsafe.')
}
const wrapperPasswords = new Map<string, string>(
  [...PHASE7_WRAPPER_ROLES, ...PHASE7_LEGACY_ROLES].map((role) => [
    typeof role === 'string' ? role : role.name,
    randomUUID().replaceAll('-', '')
  ])
)

const buildWrapperDatabaseUrl = (role: string): URL => {
  const password = wrapperPasswords.get(role)
  if (!password || !DATABASE_IDENTIFIER_PATTERN.test(role)) {
    throw new Error('Phase 7 wrapper credential fixture is unavailable.')
  }
  const url = new URL(targetDatabaseUrl)
  url.username = role
  url.password = password
  return url
}

const migrationDatabaseUrl = buildWrapperDatabaseUrl(TEST_MIGRATION_LOGIN)
migrationDatabaseUrl.searchParams.set(
  'options',
  '-c role=nihongo_phase7_migration'
)
const applicationDatabaseUrl = buildWrapperDatabaseUrl(TEST_APPLICATION_LOGIN)
const authGatewayDatabaseUrl = buildWrapperDatabaseUrl(TEST_AUTH_GATEWAY_LOGIN)
const legacyDatabaseUrl = buildWrapperDatabaseUrl(TEST_LEGACY_LOGIN)
const developmentApplicationDatabaseUrl = buildWrapperDatabaseUrl(
  DEVELOPMENT_APPLICATION_LOGIN
)

const quoteSchema = (value: string): string => {
  if (!SCHEMA_PATTERN.test(value)) {
    throw new Error('Refusing to quote an unexpected Phase 7 schema name.')
  }
  return `"${value}"`
}

const quoteIdentifier = (value: string): string => {
  if (!DATABASE_IDENTIFIER_PATTERN.test(value)) {
    throw new Error('Refusing to quote an unsafe Phase 7 identifier.')
  }
  return `"${value}"`
}

const formatCommand = (command: string, args: readonly string[]): string =>
  [command, ...args].join(' ')

const commandProcesses: Array<{ child: ChildProcess; label: string }> = []

// Prisma cannot preserve COLLATE C in this index or express a database-owned
// enum default without compiling that default into legacy INSERT statements.
// The live defaults are attested independently before this exact no-op SQL is
// accepted, so a missing or changed database default cannot hide here.
const EXPECTED_PRISMA_REPRESENTATION_DIFF = [
  '-- DropIndex',
  'DROP INDEX "QuestionVersion_questionText_prefix_idx";',
  '',
  '-- AlterTable',
  'ALTER TABLE "Question" ALTER COLUMN "rowVersion" SET DEFAULT 1;',
  '',
  '-- AlterTable',
  'ALTER TABLE "QuestionVersionTag" ALTER COLUMN "normalizedNameSnapshot" SET DEFAULT \'\'::text;',
  '',
  '-- AlterTable',
  'ALTER TABLE "Session" ALTER COLUMN "authorityGeneration" SET DEFAULT 1,',
  'ALTER COLUMN "issuerProtocolVersion" SET DEFAULT \'LEGACY\'::"AuthSessionIssuerProtocolVersion",',
  'ALTER COLUMN "authorizationState" SET DEFAULT \'ACTIVE\'::"AuthSessionAuthorizationState";',
  '',
  '-- AlterTable',
  'ALTER TABLE "User" ALTER COLUMN "authorityGeneration" SET DEFAULT 1;',
  '',
  '-- CreateIndex',
  'CREATE INDEX "QuestionVersion_questionText_prefix_idx" ON "QuestionVersion"("questionText" text_pattern_ops);'
].join('\n')

interface Phase7DatabaseDefault {
  readonly columnName: string
  readonly defaultExpression: string
  readonly tableName: string
}

class Phase7DatabaseDefaultAttestationError extends Error {
  public constructor(
    actual: readonly Phase7DatabaseDefault[],
    expected: readonly Phase7DatabaseDefault[]
  ) {
    super(
      'Phase 7 database default attestation failed. ' +
        JSON.stringify({ actual, expected })
    )
    this.name = 'Phase7DatabaseDefaultAttestationError'
  }
}

const EXPECTED_PHASE7_DATABASE_DEFAULTS: readonly Phase7DatabaseDefault[] = [
  {
    columnName: 'rowVersion',
    defaultExpression: '1',
    tableName: 'Question'
  },
  {
    columnName: 'normalizedNameSnapshot',
    defaultExpression: "''::text",
    tableName: 'QuestionVersionTag'
  },
  {
    columnName: 'authorityGeneration',
    defaultExpression: '1',
    tableName: 'Session'
  },
  {
    columnName: 'authorizationState',
    defaultExpression: '\'ACTIVE\'::"AuthSessionAuthorizationState"',
    tableName: 'Session'
  },
  {
    columnName: 'issuerProtocolVersion',
    defaultExpression: '\'LEGACY\'::"AuthSessionIssuerProtocolVersion"',
    tableName: 'Session'
  },
  {
    columnName: 'authorityGeneration',
    defaultExpression: '1',
    tableName: 'User'
  }
]

const runCommand = async (
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> =>
  await new Promise<void>((resolve, reject) => {
    let spawnError: Error | undefined
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      detached: shouldDetachOwnedProcess,
      env: environment,
      stdio: 'inherit'
    })
    const ownedCommand = { child, label: formatCommand(command, args) }
    commandProcesses.push(ownedCommand)
    child.once('error', (error) => {
      spawnError = error
    })
    child.once('close', (code, signal) => {
      void retireOwnedProcess(commandProcesses, ownedCommand).then(
        () => {
          if (spawnError) {
            reject(spawnError)
            return
          }
          if (code === 0) {
            resolve()
            return
          }
          reject(
            new Error(
              `${formatCommand(command, args)} failed (` +
                `${signal ?? `exit ${code ?? 'unknown'}`}).`
            )
          )
        },
        (error: unknown) => reject(error)
      )
    })
  })

const runCommandCapture = async (
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env
): Promise<string> =>
  await new Promise<string>((resolve, reject) => {
    let spawnError: Error | undefined
    let stdout = ''
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      detached: shouldDetachOwnedProcess,
      env: environment,
      stdio: ['inherit', 'pipe', 'inherit']
    })
    const ownedCommand = { child, label: formatCommand(command, args) }
    commandProcesses.push(ownedCommand)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.once('error', (error) => {
      spawnError = error
    })
    child.once('close', (code, signal) => {
      void retireOwnedProcess(commandProcesses, ownedCommand).then(
        () => {
          if (spawnError) {
            reject(spawnError)
            return
          }
          if (code === 0) {
            resolve(stdout)
            return
          }
          reject(
            new Error(
              `${formatCommand(command, args)} failed (` +
                `${signal ?? `exit ${code ?? 'unknown'}`}).`
            )
          )
        },
        (error: unknown) => reject(error)
      )
    })
  })

const runCommandExpectFailure = async (
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv
): Promise<void> =>
  await new Promise<void>((resolve, reject) => {
    let spawnError: Error | undefined
    let stderr = ''
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      detached: shouldDetachOwnedProcess,
      env: environment,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    const ownedCommand = { child, label: formatCommand(command, args) }
    commandProcesses.push(ownedCommand)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      spawnError = error
    })
    child.once('close', (code, signal) => {
      void retireOwnedProcess(commandProcesses, ownedCommand).then(
        () => {
          if (spawnError) {
            reject(spawnError)
            return
          }
          if (code !== 0) {
            process.stdout.write(
              `${JSON.stringify({
                event: 'phase7.db.integration.expected_command_rejection',
                command: formatCommand(command, args),
                signal,
                stderrTail: stderr.trim().slice(-512)
              })}\n`
            )
            resolve()
            return
          }
          reject(
            new Error(`${formatCommand(command, args)} unexpectedly succeeded.`)
          )
        },
        (error: unknown) => reject(error)
      )
    })
  })

const normalizePrismaDiff = (value: string): string =>
  value.replaceAll('\r\n', '\n').trim()

const assertExpectedPrismaRepresentationDiff = (value: string): void => {
  const normalized = normalizePrismaDiff(value)
  if (normalized !== EXPECTED_PRISMA_REPRESENTATION_DIFF) {
    throw new Error(
      'Phase 7 Prisma drift exceeded the exact representation allowlist.\n' +
        normalized
    )
  }
  process.stdout.write(
    `${JSON.stringify({
      event: 'phase7.db.integration.prisma_representation_diff_allowlisted',
      enumDefaults: ['ACTIVE', 'LEGACY'],
      indexName: 'QuestionVersion_questionText_prefix_idx'
    })}\n`
  )
}

const adminClient = new Client({
  connectionString: adminDatabaseUrl.toString()
})

const assertPhase7DatabaseDefaults = async (): Promise<void> => {
  const result = await adminClient.query<Phase7DatabaseDefault>(
    `SELECT relation.relname AS "tableName",
            attribute.attname AS "columnName",
            pg_get_expr(default_value.adbin, default_value.adrelid)
              AS "defaultExpression"
       FROM pg_catalog.pg_attrdef AS default_value
       JOIN pg_catalog.pg_attribute AS attribute
         ON attribute.attrelid = default_value.adrelid
        AND attribute.attnum = default_value.adnum
       JOIN pg_catalog.pg_class AS relation
         ON relation.oid = default_value.adrelid
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = $1
        AND (relation.relname, attribute.attname) IN (
          VALUES
            ('Question', 'rowVersion'),
            ('QuestionVersionTag', 'normalizedNameSnapshot'),
            ('Session', 'authorityGeneration'),
            ('Session', 'authorizationState'),
            ('Session', 'issuerProtocolVersion'),
            ('User', 'authorityGeneration')
        )
      ORDER BY relation.relname, attribute.attname`,
    [schemaName]
  )
  const quotedSchemaQualifier = `"${schemaName}".`
  const unquotedSchemaQualifier = `${schemaName}.`
  const actual = result.rows.map(
    ({ columnName, defaultExpression, tableName }) => ({
      columnName,
      defaultExpression: defaultExpression
        .replaceAll(quotedSchemaQualifier, '')
        .replaceAll(unquotedSchemaQualifier, ''),
      tableName
    })
  )
  if (
    JSON.stringify(actual) !== JSON.stringify(EXPECTED_PHASE7_DATABASE_DEFAULTS)
  ) {
    throw new Phase7DatabaseDefaultAttestationError(
      actual,
      EXPECTED_PHASE7_DATABASE_DEFAULTS
    )
  }
}

const assertPhase7DatabaseDefaultDriftRejected = async (
  mutationSql: string
): Promise<void> => {
  await adminClient.query('BEGIN')
  try {
    await adminClient.query(mutationSql)
    let rejected = false
    try {
      await assertPhase7DatabaseDefaults()
    } catch (error: unknown) {
      if (error instanceof Phase7DatabaseDefaultAttestationError) {
        rejected = true
      } else {
        throw error
      }
    }
    if (!rejected) {
      throw new Error('Phase 7 database default drift was not rejected.')
    }
  } finally {
    await adminClient.query('ROLLBACK')
  }
}

interface DatabaseAclEntry {
  readonly grantee: string
  readonly grantor: string
  readonly isGrantable: boolean
  readonly ordinal: number
  readonly privilegeType: 'CONNECT' | 'CREATE' | 'TEMPORARY'
}

interface DatabaseStateSnapshot {
  readonly acl: readonly DatabaseAclEntry[]
  readonly allowConnections: boolean
  readonly connectionLimit: number
  readonly databaseRoleSettings: unknown
  readonly isTemplate: boolean
  readonly ownerName: string
  readonly ownerOid: string
  readonly rawAcl: readonly string[] | null
}

interface PgcryptoStateSnapshot {
  readonly dependencies: unknown
  readonly exists: boolean
  readonly extensionOid: string | null
  readonly extensionVersion: string | null
  readonly ownerName: string | null
  readonly schemaName: string | null
}

let adminConnected = false
let cleanupPromise: Promise<void> | undefined
let schemaCreated = false
let databaseAclChanged = false
let databaseOwnerChanged = false
let globalRoleProvisioningLockAcquired = false
let pgcryptoCreatedByHarness = false
const createdGroupRoles = new Set<string>()
const createdWrapperRoles = new Set<string>()
let databaseStateSnapshot: DatabaseStateSnapshot | undefined
let pgcryptoStateSnapshot: PgcryptoStateSnapshot | undefined

const verifySchemaAbsent = async (): Promise<void> => {
  const result = await adminClient.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM pg_namespace WHERE nspname = $1',
    [schemaName]
  )
  if (result.rows[0]?.count !== '0') {
    throw new Error('Phase 7 integration schema cleanup verification failed.')
  }
}

const readDatabaseAcl = async (): Promise<DatabaseAclEntry[]> => {
  const result = await adminClient.query<DatabaseAclEntry>(
    `SELECT COALESCE(grantee_role.rolname, 'PUBLIC') AS grantee,
       grantor_role.rolname AS grantor,
       acl_entry.privilege_type AS "privilegeType",
       acl_entry.is_grantable AS "isGrantable",
       acl_item.ordinality::int AS ordinal
     FROM pg_database AS database_record
     CROSS JOIN LATERAL unnest(COALESCE(
       database_record.datacl,
       acldefault('d', database_record.datdba)
     )) WITH ORDINALITY AS acl_item(value, ordinality)
     CROSS JOIN LATERAL aclexplode(ARRAY[acl_item.value]) AS acl_entry
     LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_entry.grantee
     JOIN pg_roles AS grantor_role ON grantor_role.oid = acl_entry.grantor
     WHERE database_record.datname = $1
     ORDER BY acl_item.ordinality, acl_entry.privilege_type,
       acl_entry.is_grantable`,
    [databaseName]
  )
  return result.rows
}

const readDatabaseState = async (): Promise<DatabaseStateSnapshot> => {
  const result = await adminClient.query<{
    allowConnections: boolean
    connectionLimit: number
    databaseRoleSettings: unknown
    isTemplate: boolean
    ownerName: string
    ownerOid: string
    rawAcl: string[] | null
  }>(
    `SELECT owner_role.rolname AS "ownerName",
       database_record.datdba::text AS "ownerOid",
       database_record.datacl::text[] AS "rawAcl",
       database_record.datallowconn AS "allowConnections",
       database_record.datconnlimit AS "connectionLimit",
       database_record.datistemplate AS "isTemplate",
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'roleOid', setting.setrole::text,
           'roleName', setting_role.rolname,
           'config', setting.setconfig
         ) ORDER BY setting.setrole)
         FROM pg_db_role_setting AS setting
         LEFT JOIN pg_roles AS setting_role
           ON setting_role.oid = setting.setrole
         WHERE setting.setdatabase = database_record.oid
       ), '[]'::jsonb) AS "databaseRoleSettings"
     FROM pg_database AS database_record
     JOIN pg_roles AS owner_role ON owner_role.oid = database_record.datdba
     WHERE database_record.datname = $1`,
    [databaseName]
  )
  const row = result.rows[0]
  if (!row) throw new Error('Phase 7 target database state is unavailable.')
  return { ...row, acl: await readDatabaseAcl() }
}

const readPgcryptoState = async (): Promise<PgcryptoStateSnapshot> => {
  const result = await adminClient.query<{
    dependencies: unknown
    extensionOid: string | null
    extensionVersion: string | null
    ownerName: string | null
    schemaName: string | null
  }>(
    `SELECT extension_record.oid::text AS "extensionOid",
       extension_record.extversion AS "extensionVersion",
       owner_role.rolname AS "ownerName", namespace.nspname AS "schemaName",
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'classId', dependency.classid::regclass::text,
           'objectId', dependency.objid::text,
           'objectSubId', dependency.objsubid,
           'referencedClassId', dependency.refclassid::regclass::text,
           'referencedObjectId', dependency.refobjid::text,
           'referencedObjectSubId', dependency.refobjsubid,
           'dependencyType', dependency.deptype
         ) ORDER BY dependency.classid, dependency.objid,
           dependency.objsubid, dependency.refclassid,
           dependency.refobjid, dependency.refobjsubid, dependency.deptype)
         FROM pg_depend AS dependency
         WHERE dependency.objid = extension_record.oid
            OR dependency.refobjid = extension_record.oid
       ), '[]'::jsonb) AS dependencies
     FROM pg_extension AS extension_record
     JOIN pg_roles AS owner_role ON owner_role.oid = extension_record.extowner
     JOIN pg_namespace AS namespace
       ON namespace.oid = extension_record.extnamespace
     WHERE extension_record.extname = 'pgcrypto'`
  )
  const row = result.rows[0]
  return row
    ? { ...row, exists: true }
    : {
        dependencies: [],
        exists: false,
        extensionOid: null,
        extensionVersion: null,
        ownerName: null,
        schemaName: null
      }
}

const quoteCatalogRole = (value: string): string =>
  value === 'PUBLIC' ? value : `"${value.replaceAll('"', '""')}"`

const restoreDatabaseAcl = async (failAfterGrant?: number): Promise<void> => {
  if (!databaseStateSnapshot) return
  const currentAcl = await readDatabaseAcl()
  const grantees = new Set(
    [...databaseStateSnapshot.acl, ...currentAcl].map(({ grantee }) => grantee)
  )
  for (const grantee of grantees) {
    await adminClient.query(
      `REVOKE ALL PRIVILEGES ON DATABASE ${quoteIdentifier(databaseName)}
      FROM ${quoteCatalogRole(grantee)}`
    )
  }
  await adminClient.query(
    `SET LOCAL ROLE ${quoteCatalogRole(databaseStateSnapshot.ownerName)}`
  )
  if (failAfterGrant === 0) {
    await adminClient.query(`SELECT 1 / 0`)
  }
  let replayedGrantCount = 0
  for (const entry of databaseStateSnapshot.acl) {
    await adminClient.query(
      `GRANT ${entry.privilegeType} ON DATABASE ${quoteIdentifier(databaseName)}
       TO ${quoteCatalogRole(entry.grantee)}${entry.isGrantable ? ' WITH GRANT OPTION' : ''}`
    )
    replayedGrantCount += 1
    if (replayedGrantCount === failAfterGrant) {
      await adminClient.query(`SELECT 1 / 0`)
    }
  }
}

// PostgreSQL exposes a NULL datacl as acldefault(owner). Supported GRANT/
// REVOKE DDL can materialize that same authorization graph but cannot collapse
// it back to NULL, so restoration is defined by the expanded grant multiset.
const canonicalDatabaseAcl = (entries: readonly DatabaseAclEntry[]): string =>
  JSON.stringify(
    [
      ...new Set(
        entries.map(({ grantee, grantor, isGrantable, privilegeType }) =>
          JSON.stringify({ grantee, grantor, isGrantable, privilegeType })
        )
      )
    ].toSorted((left, right) => left.localeCompare(right))
  )

const assertDatabaseStateRestored = async (): Promise<void> => {
  if (!databaseStateSnapshot) {
    throw new Error('Phase 7 database snapshot is unavailable.')
  }
  const snapshot = databaseStateSnapshot
  const current = await readDatabaseState()
  if (
    current.ownerOid !== snapshot.ownerOid ||
    current.ownerName !== snapshot.ownerName ||
    current.allowConnections !== snapshot.allowConnections ||
    current.connectionLimit !== snapshot.connectionLimit ||
    current.isTemplate !== snapshot.isTemplate ||
    JSON.stringify(current.databaseRoleSettings) !==
      JSON.stringify(snapshot.databaseRoleSettings) ||
    canonicalDatabaseAcl(current.acl) !== canonicalDatabaseAcl(snapshot.acl)
  ) {
    throw new Error(
      'Phase 7 database owner/effective ACL cleanup did not restore the snapshot.'
    )
  }
}

const assertPgcryptoStateRestored = async (): Promise<void> => {
  if (!pgcryptoStateSnapshot) {
    throw new Error('Phase 7 pgcrypto snapshot is unavailable.')
  }
  const current = await readPgcryptoState()
  if (JSON.stringify(current) !== JSON.stringify(pgcryptoStateSnapshot)) {
    throw new Error('Phase 7 pgcrypto cleanup did not restore exact state.')
  }
}

const acquireGlobalRoleProvisioningLock = async (): Promise<void> => {
  const lock = await adminClient.query<{ acquired: boolean }>(
    `SELECT pg_try_advisory_lock(hashtextextended(
       'phase7-db-integration-global-role-provisioning', 0
     )) AS acquired`
  )
  globalRoleProvisioningLockAcquired = lock.rows[0]?.acquired === true
  if (!globalRoleProvisioningLockAcquired) {
    throw new Error('Another Phase 7 DB integration role run is active.')
  }
}

const attestBootstrapDatabase = async (): Promise<void> => {
  if (!databaseStateSnapshot) {
    throw new Error('Phase 7 database snapshot is unavailable.')
  }
  const snapshot = databaseStateSnapshot
  const result = await adminClient.query<{
    canSetOwner: boolean
    canCreateDatabase: boolean
    canCreateRole: boolean
    currentUser: string
    isSuperuser: boolean
    sessionUser: string
  }>(
    `SELECT current_user AS "currentUser", session_user AS "sessionUser",
       pg_has_role(
         current_user, $1::name, 'SET'
       ) AS "canSetOwner",
       role_record.rolsuper AS "isSuperuser",
       role_record.rolcreatedb AS "canCreateDatabase",
       role_record.rolcreaterole AS "canCreateRole"
     FROM pg_roles AS role_record WHERE role_record.rolname = current_user`,
    [snapshot.ownerName]
  )
  const row = result.rows[0]
  if (
    !row ||
    row.currentUser !== row.sessionUser ||
    !row.isSuperuser ||
    !row.canCreateDatabase ||
    !row.canCreateRole ||
    !row.canSetOwner ||
    !snapshot.allowConnections ||
    snapshot.isTemplate ||
    snapshot.acl.some(({ grantor }) => grantor !== snapshot.ownerName) ||
    PHASE7_GROUP_ROLES.includes(
      snapshot.ownerName as (typeof PHASE7_GROUP_ROLES)[number]
    )
  ) {
    throw new Error('Phase 7 integration bootstrap database is not attested.')
  }
}

const ensurePgcrypto = async (): Promise<void> => {
  pgcryptoStateSnapshot ??= await readPgcryptoState()
  if (pgcryptoStateSnapshot.exists) {
    if (pgcryptoStateSnapshot.schemaName !== 'public') {
      throw new Error('Existing pgcrypto extension is outside public schema.')
    }
    return
  }
  await adminClient.query(`CREATE EXTENSION pgcrypto WITH SCHEMA public`)
  pgcryptoCreatedByHarness = true
  const installed = await readPgcryptoState()
  if (!installed.exists || installed.schemaName !== 'public') {
    throw new Error('Phase 7 pgcrypto preinstall attestation failed.')
  }
}

const transitionDatabaseOwnerToMigration = async (): Promise<void> => {
  databaseOwnerChanged = true
  await adminClient.query(
    `ALTER DATABASE ${quoteIdentifier(databaseName)}
     OWNER TO "nihongo_phase7_migration"`
  )
  const current = await readDatabaseState()
  if (current.ownerName !== 'nihongo_phase7_migration') {
    throw new Error('Phase 7 database owner transition failed.')
  }
}

const applyPhase7DatabaseAcl = async (
  trackPersistentMutation = false
): Promise<void> => {
  if (trackPersistentMutation) databaseAclChanged = true
  const priorDatabaseGrantees = new Set(
    (await readDatabaseAcl()).map(({ grantee }) => grantee)
  )
  for (const grantee of priorDatabaseGrantees) {
    await adminClient.query(
      `REVOKE ALL PRIVILEGES ON DATABASE ${quoteIdentifier(databaseName)}
       FROM ${quoteCatalogRole(grantee)}`
    )
  }
  await adminClient.query(
    `GRANT CREATE, TEMPORARY ON DATABASE ${quoteIdentifier(databaseName)} TO
       "nihongo_phase7_migration"`
  )
  await adminClient.query(
    `GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO
       "nihongo_test_phase7_migration_login",
       "nihongo_test_app_login",
       "nihongo_test_auth_gateway_login",
       "nihongo_test_erasure_worker_login",
       "nihongo_test_legacy_app_login"`
  )
}

const attestPhase7DatabaseAcl = async (): Promise<void> => {
  const result = await adminClient.query<{
    aclEntryCount: number
    migrationPrivilegeAclCount: number
    wrapperConnectAclCount: number
  }>(
    `SELECT (
       SELECT COUNT(*)::int
       FROM pg_database AS database_record
       CROSS JOIN LATERAL aclexplode(COALESCE(
         database_record.datacl,
         acldefault('d', database_record.datdba)
       )) AS acl_entry
       WHERE database_record.datname = current_database()
     ) AS "aclEntryCount",
     (
       SELECT COUNT(*)::int
       FROM pg_database AS database_record
       CROSS JOIN LATERAL aclexplode(database_record.datacl) AS acl_entry
       JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_entry.grantee
       WHERE database_record.datname = current_database()
         AND grantee_role.rolname = 'nihongo_phase7_migration'
         AND acl_entry.privilege_type IN ('CREATE', 'TEMPORARY')
         AND NOT acl_entry.is_grantable
     ) AS "migrationPrivilegeAclCount",
     (
       SELECT COUNT(*)::int
       FROM pg_database AS database_record
       CROSS JOIN LATERAL aclexplode(database_record.datacl) AS acl_entry
       JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_entry.grantee
       WHERE database_record.datname = current_database()
         AND grantee_role.rolname = ANY($1::name[])
         AND acl_entry.privilege_type = 'CONNECT'
         AND NOT acl_entry.is_grantable
     ) AS "wrapperConnectAclCount"`,
    [
      [
        TEST_MIGRATION_LOGIN,
        TEST_APPLICATION_LOGIN,
        TEST_AUTH_GATEWAY_LOGIN,
        'nihongo_test_erasure_worker_login',
        TEST_LEGACY_LOGIN
      ]
    ]
  )
  const row = result.rows[0]
  if (
    !row ||
    row.aclEntryCount !== 7 ||
    row.migrationPrivilegeAclCount !== 2 ||
    row.wrapperConnectAclCount !== 5
  ) {
    throw new Error('Phase 7 migration database ACL attestation failed.')
  }
}

const exerciseDatabaseAclRestore = async (
  failAfterGrant?: number
): Promise<void> => {
  if (!databaseStateSnapshot) {
    throw new Error('Phase 7 database snapshot is unavailable.')
  }
  await applyPhase7DatabaseAcl()
  await adminClient.query(
    `ALTER DATABASE ${quoteIdentifier(databaseName)}
     OWNER TO "nihongo_phase7_migration"`
  )
  await adminClient.query(
    `ALTER DATABASE ${quoteIdentifier(databaseName)} OWNER TO
     ${quoteCatalogRole(databaseStateSnapshot.ownerName)}`
  )
  await restoreDatabaseAcl(failAfterGrant)
}

const verifyTransactionalDatabaseRestoreFixtures = async (): Promise<void> => {
  if (!databaseStateSnapshot) {
    throw new Error('Phase 7 database snapshot is unavailable.')
  }

  await adminClient.query('BEGIN')
  try {
    await exerciseDatabaseAclRestore()
    await assertDatabaseStateRestored()
    await adminClient.query('ROLLBACK')
  } catch (error: unknown) {
    await adminClient.query('ROLLBACK')
    throw error
  }
  await assertDatabaseStateRestored()
  process.stdout.write(
    `${JSON.stringify({
      event: 'phase7.db.integration.database_acl_roundtrip_verified',
      rawAclEntryCount: databaseStateSnapshot.rawAcl?.length ?? null
    })}\n`
  )

  const grantCount = databaseStateSnapshot.acl.length
  const faultPoints =
    grantCount === 0 ? [0] : [...new Set([1, Math.ceil(grantCount / 2)])]
  for (const faultPoint of faultPoints) {
    await adminClient.query('BEGIN')
    let faultCode: unknown
    try {
      await exerciseDatabaseAclRestore(faultPoint)
    } catch (error: unknown) {
      faultCode = (error as { code?: unknown }).code
    }
    if (faultCode !== '22012') {
      await adminClient.query('ROLLBACK')
      throw new Error('Phase 7 database ACL fault injection did not fire.')
    }
    await adminClient.query('ROLLBACK')
    await assertDatabaseStateRestored()
  }
}

const restoreDatabaseOwnerAndAcl = async (): Promise<void> => {
  if (
    !databaseStateSnapshot ||
    (!databaseAclChanged && !databaseOwnerChanged)
  ) {
    return
  }
  await adminClient.query('BEGIN')
  try {
    if (databaseOwnerChanged) {
      await adminClient.query(
        `ALTER DATABASE ${quoteIdentifier(databaseName)} OWNER TO
         ${quoteCatalogRole(databaseStateSnapshot.ownerName)}`
      )
    }
    await restoreDatabaseAcl()
    await assertDatabaseStateRestored()
    await adminClient.query('COMMIT')
    databaseAclChanged = false
    databaseOwnerChanged = false
  } catch (error: unknown) {
    await adminClient.query('ROLLBACK')
    throw error
  }
}

const restorePgcrypto = async (): Promise<void> => {
  if (!pgcryptoStateSnapshot) return
  if (pgcryptoCreatedByHarness) {
    const extension = await readPgcryptoState()
    if (!extension.exists || !extension.extensionOid) {
      throw new Error('Harness-owned pgcrypto extension disappeared early.')
    }
    const externalDependencies = await adminClient.query<{ count: number }>(
      `WITH extension_members AS (
         SELECT dependency.classid, dependency.objid, dependency.objsubid
         FROM pg_depend AS dependency
         WHERE dependency.refclassid = 'pg_extension'::regclass
           AND dependency.refobjid = $1::oid
           AND dependency.deptype = 'e'
       )
       SELECT COUNT(*)::int AS count
       FROM pg_depend AS dependency
       JOIN extension_members AS member
         ON member.classid = dependency.refclassid
        AND member.objid = dependency.refobjid
        AND member.objsubid = dependency.refobjsubid
       WHERE NOT EXISTS (
         SELECT 1 FROM pg_depend AS owned_object
         WHERE owned_object.classid = dependency.classid
           AND owned_object.objid = dependency.objid
           AND owned_object.refclassid = 'pg_extension'::regclass
           AND owned_object.refobjid = $1::oid
           AND owned_object.deptype = 'e'
       )`,
      [extension.extensionOid]
    )
    if (externalDependencies.rows[0]?.count !== 0) {
      throw new Error(
        'Harness-owned pgcrypto has unexpected external dependencies.'
      )
    }
    await adminClient.query(`DROP EXTENSION pgcrypto RESTRICT`)
    pgcryptoCreatedByHarness = false
  }
  await assertPgcryptoStateRestored()
}

const provisionGlobalRoles = async (): Promise<void> => {
  const wrapperNames = [
    ...PHASE7_WRAPPER_ROLES.map(({ name }) => name),
    ...PHASE7_LEGACY_ROLES
  ]
  const collisions = await adminClient.query<{ name: string }>(
    `SELECT rolname AS name FROM pg_roles
     WHERE rolname = ANY($1::text[]) ORDER BY rolname`,
    [wrapperNames]
  )
  if (collisions.rowCount !== 0) {
    throw new Error(
      `Phase 7 integration wrapper role collision: ${collisions.rows
        .map(({ name }) => name)
        .join(', ')}`
    )
  }

  const existingGroups = await adminClient.query<{
    canBypassRls: boolean
    canCreateDatabase: boolean
    canCreateRole: boolean
    canLogin: boolean
    inherits: boolean
    isReplication: boolean
    isSuperuser: boolean
    name: string
  }>(
    `SELECT rolname AS name, rolcanlogin AS "canLogin",
       rolinherit AS inherits, rolsuper AS "isSuperuser",
       rolcreatedb AS "canCreateDatabase", rolcreaterole AS "canCreateRole",
       rolreplication AS "isReplication", rolbypassrls AS "canBypassRls"
     FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname`,
    [[...PHASE7_GROUP_ROLES]]
  )
  if (
    existingGroups.rowCount !== 0 &&
    existingGroups.rowCount !== PHASE7_GROUP_ROLES.length
  ) {
    throw new Error('Phase 7 reusable NOLOGIN role bootstrap is partial.')
  }
  for (const role of existingGroups.rows) {
    if (
      role.canLogin ||
      role.inherits ||
      role.isSuperuser ||
      role.canCreateDatabase ||
      role.canCreateRole ||
      role.isReplication ||
      role.canBypassRls
    ) {
      throw new Error(`Phase 7 reusable role is unsafe: ${role.name}`)
    }
  }

  if (existingGroups.rowCount === 0) {
    for (const role of PHASE7_GROUP_ROLES) {
      await adminClient.query(
        `CREATE ROLE ${quoteIdentifier(role)}
         NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
         NOREPLICATION NOBYPASSRLS`
      )
      createdGroupRoles.add(role)
    }
    await adminClient.query(
      `GRANT "nihongo_phase7_owner" TO "nihongo_phase7_migration"
       WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`
    )
  } else {
    const protectedMemberships = await adminClient.query<{
      adminOption: boolean
      grantedName: string
      inheritOption: boolean
      memberName: string
      setOption: boolean
    }>(
      `SELECT member_role.rolname AS "memberName",
         granted_role.rolname AS "grantedName",
         membership.admin_option AS "adminOption",
         membership.inherit_option AS "inheritOption",
         membership.set_option AS "setOption"
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member_role ON member_role.oid = membership.member
       JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
       WHERE member_role.rolname = ANY($1::text[])
          OR granted_role.rolname = ANY($1::text[])
       ORDER BY member_role.rolname, granted_role.rolname`,
      [[...PHASE7_GROUP_ROLES]]
    )
    if (
      protectedMemberships.rows.length !== 1 ||
      protectedMemberships.rows[0]?.memberName !== 'nihongo_phase7_migration' ||
      protectedMemberships.rows[0]?.grantedName !== 'nihongo_phase7_owner' ||
      protectedMemberships.rows[0]?.adminOption !== false ||
      protectedMemberships.rows[0]?.inheritOption !== false ||
      protectedMemberships.rows[0]?.setOption !== true
    ) {
      throw new Error('Phase 7 reusable NOLOGIN role graph is not exact.')
    }
  }

  for (const { grantedRole, name } of PHASE7_WRAPPER_ROLES) {
    const password = wrapperPasswords.get(name)
    if (!password || !/^[a-f0-9]{32}$/u.test(password)) {
      throw new Error('Phase 7 wrapper password fixture is unsafe.')
    }
    await adminClient.query(
      `CREATE ROLE ${quoteIdentifier(name)}
       LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
       NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`
    )
    createdWrapperRoles.add(name)
    await adminClient.query(
      `GRANT ${quoteIdentifier(grantedRole)} TO ${quoteIdentifier(name)}
       WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`
    )
  }
  for (const name of PHASE7_LEGACY_ROLES) {
    const password = wrapperPasswords.get(name)
    if (!password || !/^[a-f0-9]{32}$/u.test(password)) {
      throw new Error('Phase 7 legacy password fixture is unsafe.')
    }
    await adminClient.query(
      `CREATE ROLE ${quoteIdentifier(name)}
       LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
       NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`
    )
    createdWrapperRoles.add(name)
  }
}

const cleanup = (): Promise<void> => {
  cleanupPromise ??= (async () => {
    let firstCleanupError: unknown
    const recordCleanupError = (error: unknown): void => {
      firstCleanupError ??= error
    }
    try {
      await stopOwnedProcesses(commandProcesses, {
        onForceKill: ({ label }) => {
          process.stderr.write(
            `[${label}] graceful stop timed out; sending SIGKILL.\n`
          )
        }
      })
    } catch (error: unknown) {
      recordCleanupError(error)
    } finally {
      commandProcesses.length = 0
    }

    try {
      if (adminConnected) {
        try {
          await restoreDatabaseOwnerAndAcl()
        } catch (error: unknown) {
          recordCleanupError(error)
        }

        try {
          if (schemaCreated) {
            await adminClient.query(
              `DROP SCHEMA IF EXISTS ${quoteSchema(schemaName)} CASCADE`
            )
            schemaCreated = false
          }
          await verifySchemaAbsent()
          process.stdout.write(
            `${JSON.stringify({
              event: 'phase7.db.integration.schema_removed',
              schemaName
            })}\n`
          )
        } catch (error: unknown) {
          recordCleanupError(error)
        }

        try {
          await restorePgcrypto()
        } catch (error: unknown) {
          recordCleanupError(error)
        }

        if (!databaseOwnerChanged) {
          try {
            for (const {
              grantedRole,
              name
            } of PHASE7_WRAPPER_ROLES.toReversed()) {
              if (!createdWrapperRoles.has(name)) continue
              await adminClient.query(
                `REVOKE ${quoteIdentifier(grantedRole)} FROM ${quoteIdentifier(name)}`
              )
              await adminClient.query(`DROP ROLE ${quoteIdentifier(name)}`)
              createdWrapperRoles.delete(name)
            }
            for (const name of PHASE7_LEGACY_ROLES.toReversed()) {
              if (!createdWrapperRoles.has(name)) continue
              await adminClient.query(`DROP ROLE ${quoteIdentifier(name)}`)
              createdWrapperRoles.delete(name)
            }
            if (createdGroupRoles.has('nihongo_phase7_migration')) {
              await adminClient.query(
                `REVOKE "nihongo_phase7_owner" FROM "nihongo_phase7_migration"`
              )
            }
            for (const name of [
              'nihongo_erasure_worker',
              'nihongo_auth_gateway',
              'nihongo_app',
              'nihongo_phase7_migration',
              'nihongo_phase7_owner'
            ]) {
              if (!createdGroupRoles.has(name)) continue
              await adminClient.query(`DROP ROLE ${quoteIdentifier(name)}`)
              createdGroupRoles.delete(name)
            }
          } catch (error: unknown) {
            recordCleanupError(error)
          }
        }

        try {
          await assertDatabaseStateRestored()
          await verifySchemaAbsent()
          await assertPgcryptoStateRestored()
        } catch (error: unknown) {
          recordCleanupError(error)
        }
      }
    } finally {
      if (adminConnected && globalRoleProvisioningLockAcquired) {
        try {
          await adminClient.query(
            `SELECT pg_advisory_unlock(hashtextextended(
               'phase7-db-integration-global-role-provisioning', 0
             ))`
          )
          globalRoleProvisioningLockAcquired = false
        } catch (error: unknown) {
          recordCleanupError(error)
        }
      }
      if (adminConnected) {
        try {
          await adminClient.end()
        } catch (error: unknown) {
          recordCleanupError(error)
        }
        adminConnected = false
      }
    }

    if (firstCleanupError) throw firstCleanupError
  })()
  return cleanupPromise
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void cleanup()
      .then(() => process.exit(signal === 'SIGINT' ? 130 : 143))
      .catch(() => process.exit(1))
  })
}

const run = async (): Promise<void> => {
  await adminClient.connect()
  adminConnected = true
  await acquireGlobalRoleProvisioningLock()
  await verifySchemaAbsent()
  databaseStateSnapshot = await readDatabaseState()
  pgcryptoStateSnapshot = await readPgcryptoState()
  await attestBootstrapDatabase()
  await provisionGlobalRoles()
  await verifyTransactionalDatabaseRestoreFixtures()
  await ensurePgcrypto()
  await transitionDatabaseOwnerToMigration()
  // ALTER DATABASE OWNER can rewrite owner-derived ACL entries. Apply the
  // canonical wrapper grants only after the final migration owner is active.
  await applyPhase7DatabaseAcl(true)
  await attestPhase7DatabaseAcl()
  await adminClient.query(
    `CREATE SCHEMA ${quoteSchema(schemaName)}
     AUTHORIZATION "nihongo_phase7_migration"`
  )
  schemaCreated = true
  process.stdout.write(
    `${JSON.stringify({
      event: 'phase7.db.integration.schema_created',
      schemaName
    })}\n`
  )

  const sharedEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    ADMIN_CMS_MODE: 'technical',
    AUTH_GATEWAY_DATABASE_URL: authGatewayDatabaseUrl.toString(),
    DATABASE_URL: applicationDatabaseUrl.toString(),
    NODE_ENV: 'test',
    PHASE7_ADMIN_DATABASE_URL: targetDatabaseUrl.toString(),
    PHASE7_DEVELOPMENT_APP_DATABASE_URL:
      developmentApplicationDatabaseUrl.toString(),
    PHASE7_LEGACY_DATABASE_URL: legacyDatabaseUrl.toString(),
    PHASE7_MIGRATION_DATABASE_URL: migrationDatabaseUrl.toString(),
    PRODUCTION_DATABASE_URL: syntheticProductionDatabaseUrl.toString()
  }
  const migrationEnvironment: NodeJS.ProcessEnv = { ...sharedEnvironment }
  const integrationEnvironment: NodeJS.ProcessEnv = {
    ...sharedEnvironment,
    // vitest.integration.config.ts intentionally maps this value to
    // DATABASE_URL. Integration imports therefore exercise the exact app
    // wrapper while PHASE7_ADMIN_DATABASE_URL remains the DDL/test harness URL.
    PRISMA_TEST_DATABASE_URL: applicationDatabaseUrl.toString()
  }
  const driftEnvironment: NodeJS.ProcessEnv = {
    ...migrationEnvironment,
    // Prisma's information-schema introspection hides columns that the
    // least-privilege migration role cannot read. Drift comparison is
    // read-only, so use the already-attested test harness connection.
    PRISMA_TEST_DATABASE_URL: targetDatabaseUrl.toString()
  }
  const seedEnvironment: NodeJS.ProcessEnv = {
    ...migrationEnvironment,
    SEED_TARGET: 'test'
  }

  await runCommand('pnpm', ['run', 'build:contracts'])
  await runCommand('pnpm', ['run', 'build:domain'])
  await runCommand('pnpm', ['--filter', '@nihongo/api', 'run', 'db:generate'])
  await runCommand(
    'pnpm',
    [
      '--filter',
      '@nihongo/api',
      'exec',
      'vitest',
      'run',
      'src/db/phase7AdminCmsMigration.test.ts',
      'src/db/phase7ReauthenticationMigration.test.ts'
    ],
    migrationEnvironment
  )
  try {
    await runCommand(
      'pnpm',
      ['--filter', '@nihongo/api', 'run', 'db:migrate:phase7'],
      migrationEnvironment
    )
  } catch (error: unknown) {
    const failedMigration = await adminClient.query<{
      logs: string | null
      migrationName: string
    }>(
      `SELECT migration_name AS "migrationName", logs
       FROM ${quoteSchema(schemaName)}."_prisma_migrations"
       WHERE finished_at IS NULL AND rolled_back_at IS NULL
       ORDER BY started_at DESC LIMIT 1`
    )
    const row = failedMigration.rows[0]
    if (row) {
      let replayDetail = ''
      if (
        row.migrationName === '20260827100000_phase7_admin_cms_enums' ||
        row.migrationName === '20260827101000_phase7_admin_cms_foundation' ||
        row.migrationName ===
          '20260909120000_phase7_archive_empty_manifest_verifier' ||
        row.migrationName ===
          '20260916120000_phase7_reauthentication_foundation'
      ) {
        const diagnosticClient = new Client({
          connectionString: migrationDatabaseUrl.toString()
        })
        await diagnosticClient.connect()
        try {
          await diagnosticClient.query(
            `SET search_path TO ${quoteSchema(schemaName)}`
          )
          const migrationSql = readFileSync(
            path.join(
              repositoryRoot,
              'apps/api/prisma/migrations',
              row.migrationName,
              'migration.sql'
            ),
            'utf8'
          )
          await diagnosticClient.query(migrationSql)
          replayDetail = ' Manual wrapper replay unexpectedly succeeded.'
        } catch (replayError: unknown) {
          const databaseError = replayError as {
            code?: unknown
            message?: unknown
            position?: unknown
            where?: unknown
          }
          replayDetail =
            ' Manual wrapper replay: ' +
            JSON.stringify({
              code: databaseError.code,
              message: databaseError.message,
              position: databaseError.position,
              where: databaseError.where
            })
        } finally {
          await diagnosticClient.end()
        }
      }
      throw new Error(
        `Phase 7 migration ${row.migrationName} failed: ` +
          (row.logs?.trim().slice(-4000) ?? 'migration log unavailable') +
          replayDetail,
        { cause: error }
      )
    }
    throw error
  }
  await runCommand(
    'pnpm',
    ['--filter', '@nihongo/api', 'run', 'db:migrate:deploy'],
    migrationEnvironment
  )
  await assertPhase7DatabaseDefaultDriftRejected(
    `ALTER TABLE ${quoteSchema(schemaName)}."Session"
       ALTER COLUMN "issuerProtocolVersion" SET DEFAULT 'PHASE7_V1'`
  )
  await assertPhase7DatabaseDefaultDriftRejected(
    `ALTER TABLE ${quoteSchema(schemaName)}."Session"
       ALTER COLUMN "authorizationState" DROP DEFAULT`
  )
  await assertPhase7DatabaseDefaults()
  process.stdout.write(
    `${JSON.stringify({
      event: 'phase7.db.integration.database_defaults_attested',
      defaultCount: EXPECTED_PHASE7_DATABASE_DEFAULTS.length,
      driftRejections: 2
    })}\n`
  )
  const prismaDiff = await runCommandCapture(
    'pnpm',
    [
      '--filter',
      '@nihongo/api',
      'exec',
      'prisma',
      'migrate',
      'diff',
      '--config',
      'prisma.test.config.ts',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--script'
    ],
    driftEnvironment
  )
  assertExpectedPrismaRepresentationDiff(prismaDiff)

  const readQuestionCount = async (): Promise<string> => {
    const result = await adminClient.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM ${quoteSchema(schemaName)}."Question"`
    )
    return result.rows[0]?.count ?? 'missing'
  }
  const assertSeedWriteCount = async (expected: string): Promise<void> => {
    const actual = await readQuestionCount()
    if (actual !== expected) {
      throw new Error(
        `Phase 7 seed write-count check expected ${expected}, received ${actual}.`
      )
    }
  }
  const seedCommand = [
    '--filter',
    '@nihongo/api',
    'run',
    'db:seed:test'
  ] as const
  const withoutMigrationUrl: NodeJS.ProcessEnv = { ...seedEnvironment }
  delete withoutMigrationUrl.PHASE7_MIGRATION_DATABASE_URL
  const appUrlAsMigration: NodeJS.ProcessEnv = {
    ...seedEnvironment,
    PHASE7_MIGRATION_DATABASE_URL: applicationDatabaseUrl.toString()
  }
  const duplicateOptionsUrl = new URL(migrationDatabaseUrl)
  duplicateOptionsUrl.searchParams.append(
    'options',
    '-c role=nihongo_phase7_migration'
  )
  const duplicateMigrationOptions: NodeJS.ProcessEnv = {
    ...seedEnvironment,
    PHASE7_MIGRATION_DATABASE_URL: duplicateOptionsUrl.toString()
  }

  await assertSeedWriteCount('0')
  for (const rejectedEnvironment of [
    withoutMigrationUrl,
    appUrlAsMigration,
    duplicateMigrationOptions
  ]) {
    await runCommandExpectFailure('pnpm', seedCommand, rejectedEnvironment)
    await assertSeedWriteCount('0')
  }

  const seedFailureFunction = 'phase7_seed_forced_failure'
  const seedFailureTrigger = 'phase7_seed_forced_failure_trigger'
  await adminClient.query(
    `CREATE FUNCTION ${quoteSchema(schemaName)}.${quoteIdentifier(seedFailureFunction)}()
     RETURNS trigger LANGUAGE plpgsql
     AS $function$
     BEGIN
       RAISE EXCEPTION 'forced Phase 7 seed rollback';
     END;
     $function$`
  )
  await adminClient.query(
    `CREATE TRIGGER ${quoteIdentifier(seedFailureTrigger)}
     BEFORE INSERT ON ${quoteSchema(schemaName)}."Question"
     FOR EACH ROW EXECUTE FUNCTION
     ${quoteSchema(schemaName)}.${quoteIdentifier(seedFailureFunction)}()`
  )
  try {
    await runCommandExpectFailure('pnpm', seedCommand, seedEnvironment)
    await assertSeedWriteCount('0')
  } finally {
    await adminClient.query(
      `DROP TRIGGER ${quoteIdentifier(seedFailureTrigger)}
       ON ${quoteSchema(schemaName)}."Question"`
    )
    await adminClient.query(
      `DROP FUNCTION ${quoteSchema(schemaName)}.${quoteIdentifier(seedFailureFunction)}()`
    )
  }

  await runCommand('pnpm', seedCommand, seedEnvironment)
  await assertSeedWriteCount('65')

  const migrationCatalogClient = new Client({
    connectionString: migrationDatabaseUrl.toString()
  })
  await migrationCatalogClient.connect()
  try {
    for (const statement of [
      `SELECT "id" FROM ${quoteSchema(schemaName)}."Question" LIMIT 1`,
      `UPDATE ${quoteSchema(schemaName)}."Question"
       SET "updatedAt" = "updatedAt" WHERE false`
    ]) {
      let errorCode: unknown
      try {
        await migrationCatalogClient.query(statement)
      } catch (error: unknown) {
        errorCode = (error as { code?: unknown }).code
      }
      if (errorCode !== '42501') {
        throw new Error(
          'Phase 7 migration role retained raw catalog table authority.'
        )
      }
    }
  } finally {
    await migrationCatalogClient.end()
  }
  await runCommand('pnpm', seedCommand, seedEnvironment)
  await assertSeedWriteCount('65')

  for (const testFile of getPhase10ApiIntegrationPathsByOwner('phase7-db')) {
    await runPhase10ManifestVitestFile({
      runCommand,
      testFile,
      environment: integrationEnvironment
    })
  }
}

void run()
  .then(async () => {
    await cleanup()
  })
  .catch(async (error: unknown) => {
    try {
      await cleanup()
    } catch (cleanupError: unknown) {
      process.stderr.write(
        `${JSON.stringify({
          event: 'phase7.db.integration.cleanup_failed',
          errorName:
            cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
          schemaName
        })}\n`
      )
    }
    process.stderr.write(
      `${JSON.stringify({
        event: 'phase7.db.integration.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : 'Unknown failure',
        schemaName
      })}\n`
    )
    process.exitCode = 1
  })
