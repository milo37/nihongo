import { sanitizeSeedLine } from '../../prisma/seedDiagnostics.js'
import {
  copyFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { Client } from 'pg'
import {
  assertSafeAdminCmsDatabase,
  assertSafeTestDatabase
} from '../db/databaseTargetGuard.js'
import { assertPhase7ApiDatabaseBoundaryPreflight } from './phase7ApiDatabaseBoundary.js'
import {
  retireOwnedProcess,
  shouldDetachOwnedProcess,
  stopOwnedProcesses
} from './ownedProcessGroup.js'
import { getPhase10ApiIntegrationEntriesByOwner } from './phase10ApiIntegrationManifest.js'
import {
  createPhase7SsoTestEnvironment,
  phase7SsoAccountLifecycleTestFile,
  runPhase10ManifestVitestFile
} from './phase10ApiIntegrationExecution.js'

const SCHEMA_PATTERN = /^phase7_[a-f0-9]{32}_test$/
const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/
const GROUP_ROLES = [
  'nihongo_phase7_owner',
  'nihongo_phase7_migration',
  'nihongo_app',
  'nihongo_auth_gateway',
  'nihongo_erasure_worker'
] as const
const WRAPPER_ROLES = [
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
const LEGACY_ROLES = [
  'nihongo_test_legacy_app_login',
  'nihongo_development_legacy_app_login'
] as const
const TEST_MIGRATION_LOGIN = 'nihongo_test_phase7_migration_login'
const TEST_APPLICATION_LOGIN = 'nihongo_test_app_login'
const TEST_AUTH_GATEWAY_LOGIN = 'nihongo_test_auth_gateway_login'
const TEST_ERASURE_LOGIN = 'nihongo_test_erasure_worker_login'
const TEST_LEGACY_LOGIN = 'nihongo_test_legacy_app_login'
const repositoryRoot = nodePath.resolve(
  nodePath.dirname(fileURLToPath(import.meta.url)),
  '../../../..'
)

dotenv.config({
  path: nodePath.join(repositoryRoot, 'apps/api/.env.test'),
  override: true,
  quiet: true
})

const apiIntegrationCase = process.env.PHASE7_API_INTEGRATION_CASE
if (
  apiIntegrationCase !== undefined &&
  apiIntegrationCase !== 'sso-browser-google' &&
  apiIntegrationCase !== 'sso-account-lifecycle'
) {
  throw new Error(
    'Phase 7 API integration case is outside the fixed allowlist.'
  )
}

const baseDatabaseUrl =
  process.env.PHASE7_API_INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
if (!baseDatabaseUrl) {
  throw new Error('Phase 7 API integration requires a test PostgreSQL URL.')
}

if (apiIntegrationCase === 'sso-browser-google') {
  try {
    new URL(baseDatabaseUrl)
  } catch {
    throw new Error('SSO browser TEST database URL is invalid.')
  }
}

const syntheticProductionDatabaseUrl = new URL(baseDatabaseUrl)
syntheticProductionDatabaseUrl.pathname =
  '/nihongo_phase7_api_production_guard_sentinel'
syntheticProductionDatabaseUrl.search = ''

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
  throw new Error('Generated Phase 7 API schema is unsafe.')
}

const adminDatabaseUrl = new URL(baseDatabaseUrl)
adminDatabaseUrl.search = ''
const databaseName = decodeURIComponent(adminDatabaseUrl.pathname.slice(1))
if (!IDENTIFIER_PATTERN.test(databaseName)) {
  throw new Error('Phase 7 API database name is unsafe.')
}
const targetDatabaseUrl = new URL(adminDatabaseUrl)
targetDatabaseUrl.searchParams.set('schema', schemaName)

const wrapperPasswords = new Map<string, string>(
  [...WRAPPER_ROLES.map(({ name }) => name), ...LEGACY_ROLES].map((name) => [
    name,
    randomUUID().replaceAll('-', '')
  ])
)

const buildWrapperDatabaseUrl = (role: string): URL => {
  const password = wrapperPasswords.get(role)
  if (!password || !IDENTIFIER_PATTERN.test(role)) {
    throw new Error('Phase 7 API wrapper credential is unavailable.')
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
const erasureWorkerDatabaseUrl = buildWrapperDatabaseUrl(TEST_ERASURE_LOGIN)

const quoteIdentifier = (value: string): string => {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error('Refusing to quote an unsafe Phase 7 API identifier.')
  }
  return `"${value}"`
}

const quoteSchema = (value: string): string => {
  if (!SCHEMA_PATTERN.test(value)) {
    throw new Error('Refusing to quote an unsafe Phase 7 API schema.')
  }
  return `"${value}"`
}

const quoteRole = (value: string): string =>
  value === 'PUBLIC' ? value : `"${value.replaceAll('"', '""')}"`

interface DatabaseAclEntry {
  readonly grantee: string
  readonly grantor: string
  readonly isGrantable: boolean
  readonly privilegeType: 'CONNECT' | 'CREATE' | 'TEMPORARY'
}

interface DatabaseSnapshot {
  readonly acl: readonly DatabaseAclEntry[]
  readonly ownerName: string
  readonly ownerOid: string
}

interface PgcryptoSnapshot {
  readonly exists: boolean
  readonly ownerName: string | null
  readonly schemaName: string | null
  readonly version: string | null
}

export interface Phase7IsolatedDatabaseHarness {
  readonly adminDatabaseUrl: string
  readonly applicationDatabaseUrl: string
  readonly authGatewayDatabaseUrl: string
  readonly erasureWorkerDatabaseUrl: string
  readonly migrationDatabaseUrl: string
  readonly schemaName: string
  readonly sharedEnvironment: NodeJS.ProcessEnv
}

interface PreparePhase7IsolatedDatabaseOptions {
  readonly abortSignal?: AbortSignal
  readonly seedRuns?: number
  readonly issuerActivationOwner?: 'runner' | 'fixture'
  readonly artifactsPrepared?: boolean
}

const adminClient = new Client({
  connectionString: adminDatabaseUrl.toString()
})
const commandProcesses: Array<{ child: ChildProcess; label: string }> = []
const createdGroupRoles = new Set<string>()
const createdWrapperRoles = new Set<string>()
let adminConnected = false
let cleanupPromise: Promise<void> | undefined
let databaseChanged = false
let databaseSnapshot: DatabaseSnapshot | undefined
let pgcryptoCreated = false
let pgcryptoSnapshot: PgcryptoSnapshot | undefined
let provisioningLockAcquired = false
let schemaCreated = false
let databasePrepared = false

const readDatabaseAcl = async (): Promise<DatabaseAclEntry[]> =>
  (
    await adminClient.query<DatabaseAclEntry>(
      `SELECT COALESCE(grantee_role.rolname, 'PUBLIC') AS grantee,
         grantor_role.rolname AS grantor,
         acl_entry.privilege_type AS "privilegeType",
         acl_entry.is_grantable AS "isGrantable"
       FROM pg_database AS database_record
       CROSS JOIN LATERAL aclexplode(COALESCE(
         database_record.datacl,
         acldefault('d', database_record.datdba)
       )) AS acl_entry
       LEFT JOIN pg_roles AS grantee_role
         ON grantee_role.oid = acl_entry.grantee
       JOIN pg_roles AS grantor_role ON grantor_role.oid = acl_entry.grantor
       WHERE database_record.datname = $1
       ORDER BY grantee, grantor, "privilegeType", "isGrantable"`,
      [databaseName]
    )
  ).rows

const readDatabaseSnapshot = async (): Promise<DatabaseSnapshot> => {
  const owner = await adminClient.query<{
    ownerName: string
    ownerOid: string
  }>(
    `SELECT owner_role.rolname AS "ownerName",
       database_record.datdba::text AS "ownerOid"
     FROM pg_database AS database_record
     JOIN pg_roles AS owner_role ON owner_role.oid = database_record.datdba
     WHERE database_record.datname = $1`,
    [databaseName]
  )
  const row = owner.rows[0]
  if (!row) throw new Error('Phase 7 API database owner is unavailable.')
  return { ...row, acl: await readDatabaseAcl() }
}

const readPgcrypto = async (): Promise<PgcryptoSnapshot> => {
  const result = await adminClient.query<{
    ownerName: string
    schemaName: string
    version: string
  }>(
    `SELECT owner_role.rolname AS "ownerName",
       namespace.nspname AS "schemaName", extension.extversion AS version
     FROM pg_extension AS extension
     JOIN pg_roles AS owner_role ON owner_role.oid = extension.extowner
     JOIN pg_namespace AS namespace ON namespace.oid = extension.extnamespace
     WHERE extension.extname = 'pgcrypto'`
  )
  const row = result.rows[0]
  return row
    ? { ...row, exists: true }
    : { exists: false, ownerName: null, schemaName: null, version: null }
}

const canonicalAcl = (entries: readonly DatabaseAclEntry[]): string =>
  JSON.stringify(
    entries
      .map(({ grantee, grantor, isGrantable, privilegeType }) => ({
        grantee,
        grantor,
        isGrantable,
        privilegeType
      }))
      .toSorted((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      )
  )

const verifySchemaAbsent = async (): Promise<void> => {
  const result = await adminClient.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM pg_namespace WHERE nspname = $1`,
    [schemaName]
  )
  if (result.rows[0]?.count !== 0) {
    throw new Error('Phase 7 API schema cleanup verification failed.')
  }
}

const restoreDatabase = async (): Promise<void> => {
  if (!databaseChanged || !databaseSnapshot) return
  const currentAcl = await readDatabaseAcl()
  await adminClient.query('BEGIN')
  try {
    await adminClient.query(
      `ALTER DATABASE ${quoteIdentifier(databaseName)} OWNER TO
       ${quoteRole(databaseSnapshot.ownerName)}`
    )
    const grantees = new Set(
      [...databaseSnapshot.acl, ...currentAcl].map(({ grantee }) => grantee)
    )
    for (const grantee of grantees) {
      await adminClient.query(
        `REVOKE ALL PRIVILEGES ON DATABASE ${quoteIdentifier(databaseName)}
         FROM ${quoteRole(grantee)}`
      )
    }
    await adminClient.query(
      `SET LOCAL ROLE ${quoteRole(databaseSnapshot.ownerName)}`
    )
    for (const entry of databaseSnapshot.acl) {
      await adminClient.query(
        `GRANT ${entry.privilegeType} ON DATABASE ${quoteIdentifier(databaseName)}
         TO ${quoteRole(entry.grantee)}${entry.isGrantable ? ' WITH GRANT OPTION' : ''}`
      )
    }
    await adminClient.query('COMMIT')
    databaseChanged = false
  } catch (error: unknown) {
    await adminClient.query('ROLLBACK')
    throw error
  }
}

const assertDatabaseRestored = async (): Promise<void> => {
  if (!databaseSnapshot) {
    throw new Error('Phase 7 API database snapshot is unavailable.')
  }
  const current = await readDatabaseSnapshot()
  if (
    current.ownerOid !== databaseSnapshot.ownerOid ||
    current.ownerName !== databaseSnapshot.ownerName ||
    canonicalAcl(current.acl) !== canonicalAcl(databaseSnapshot.acl)
  ) {
    throw new Error('Phase 7 API database owner/ACL cleanup was not exact.')
  }
}

const ensurePgcrypto = async (): Promise<void> => {
  pgcryptoSnapshot = await readPgcrypto()
  if (pgcryptoSnapshot.exists) {
    if (pgcryptoSnapshot.schemaName !== 'public') {
      throw new Error('Existing pgcrypto extension is outside public.')
    }
    return
  }
  await adminClient.query('CREATE EXTENSION pgcrypto WITH SCHEMA public')
  pgcryptoCreated = true
}

const restorePgcrypto = async (): Promise<void> => {
  if (pgcryptoCreated) {
    await adminClient.query('DROP EXTENSION pgcrypto RESTRICT')
    pgcryptoCreated = false
  }
  if (
    JSON.stringify(await readPgcrypto()) !== JSON.stringify(pgcryptoSnapshot)
  ) {
    throw new Error('Phase 7 API pgcrypto cleanup was not exact.')
  }
}

const acquireProvisioningLock = async (): Promise<void> => {
  const result = await adminClient.query<{ acquired: boolean }>(
    `SELECT pg_try_advisory_lock(hashtextextended(
       'phase7-db-integration-global-role-provisioning', 0
     )) AS acquired`
  )
  provisioningLockAcquired = result.rows[0]?.acquired === true
  if (!provisioningLockAcquired) {
    throw new Error('Another Phase 7 database gate is active.')
  }
}

const attestBootstrap = async (): Promise<void> => {
  if (!databaseSnapshot) {
    throw new Error('Phase 7 API database snapshot is unavailable.')
  }
  const result = await adminClient.query<{
    canSetOwner: boolean
    canCreateDatabase: boolean
    canCreateRole: boolean
    currentUser: string
    isSuperuser: boolean
    sessionUser: string
  }>(
    `SELECT current_user AS "currentUser", session_user AS "sessionUser",
       pg_has_role(current_user, $1::name, 'SET') AS "canSetOwner",
       role.rolsuper AS "isSuperuser",
       role.rolcreatedb AS "canCreateDatabase",
       role.rolcreaterole AS "canCreateRole"
     FROM pg_roles AS role WHERE role.rolname = current_user`,
    [databaseSnapshot.ownerName]
  )
  assertPhase7ApiDatabaseBoundaryPreflight({
    bootstrap: result.rows[0],
    snapshot: databaseSnapshot
  })
}

const provisionRoles = async (): Promise<void> => {
  const wrapperNames = [
    ...WRAPPER_ROLES.map(({ name }) => name),
    ...LEGACY_ROLES
  ]
  const wrapperCollisions = await adminClient.query<{ name: string }>(
    `SELECT rolname AS name FROM pg_roles
     WHERE rolname = ANY($1::text[]) ORDER BY rolname`,
    [wrapperNames]
  )
  if (wrapperCollisions.rowCount !== 0) {
    throw new Error('Phase 7 API canonical wrapper role collision.')
  }

  const groups = await adminClient.query<{
    canLogin: boolean
    inherits: boolean
    name: string
    unsafe: boolean
  }>(
    `SELECT rolname AS name, rolcanlogin AS "canLogin",
       rolinherit AS inherits,
       (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication
        OR rolbypassrls) AS unsafe
     FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname`,
    [[...GROUP_ROLES]]
  )
  if (groups.rowCount !== 0 && groups.rowCount !== GROUP_ROLES.length) {
    throw new Error('Phase 7 API reusable role bootstrap is partial.')
  }
  for (const group of groups.rows) {
    if (group.canLogin || group.inherits || group.unsafe) {
      throw new Error(`Phase 7 API reusable role is unsafe: ${group.name}`)
    }
  }
  if (groups.rowCount === 0) {
    for (const role of GROUP_ROLES) {
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
  }

  for (const { grantedRole, name } of WRAPPER_ROLES) {
    const password = wrapperPasswords.get(name)
    if (!password || !/^[a-f0-9]{32}$/u.test(password)) {
      throw new Error('Phase 7 API wrapper password is unsafe.')
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
  for (const name of LEGACY_ROLES) {
    const password = wrapperPasswords.get(name)
    if (!password || !/^[a-f0-9]{32}$/u.test(password)) {
      throw new Error('Phase 7 API legacy wrapper password is unsafe.')
    }
    await adminClient.query(
      `CREATE ROLE ${quoteIdentifier(name)}
       LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
       NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`
    )
    createdWrapperRoles.add(name)
  }
}

const applyMigrationDatabaseBoundary = async (): Promise<void> => {
  if (!databaseSnapshot) {
    throw new Error('Phase 7 API database snapshot is unavailable.')
  }
  databaseChanged = true
  await adminClient.query(
    `ALTER DATABASE ${quoteIdentifier(databaseName)}
     OWNER TO "nihongo_phase7_migration"`
  )
  const priorGrantees = new Set(
    (await readDatabaseAcl()).map(({ grantee }) => grantee)
  )
  for (const grantee of priorGrantees) {
    await adminClient.query(
      `REVOKE ALL PRIVILEGES ON DATABASE ${quoteIdentifier(databaseName)}
       FROM ${quoteRole(grantee)}`
    )
  }
  await adminClient.query(
    `GRANT CREATE, TEMPORARY ON DATABASE ${quoteIdentifier(databaseName)}
     TO "nihongo_phase7_migration"`
  )
  await adminClient.query(
    `GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO
       "${TEST_MIGRATION_LOGIN}", "${TEST_APPLICATION_LOGIN}",
       "${TEST_AUTH_GATEWAY_LOGIN}", "${TEST_ERASURE_LOGIN}",
       "${TEST_LEGACY_LOGIN}"`
  )
}

const formatCommand = (command: string, args: readonly string[]): string =>
  [command, ...args].join(' ')

const runCommand = async (
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  abortSignal?: AbortSignal
): Promise<void> => {
  abortSignal?.throwIfAborted()
  let spawnError: Error | undefined
  const isSeed =
    apiIntegrationCase !== 'sso-browser-google' &&
    command === 'pnpm' &&
    args.join(' ') === '--filter @nihongo/api run db:seed:test'
  let seedStage = 'SEED_GENERATE'
  let seedDiagnosticId = 'UNKNOWN_REDACTED'
  if (isSeed)
    process.stdout.write(
      JSON.stringify({ seedDiagnostic: 1, stage: seedStage }) + '\n'
    )
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    detached: shouldDetachOwnedProcess,
    env: environment,
    stdio:
      apiIntegrationCase === 'sso-browser-google'
        ? 'ignore'
        : isSeed
          ? ['inherit', 'pipe', 'pipe']
          : 'inherit'
  })
  if (isSeed) {
    for (const stream of [child.stdout, child.stderr]) {
      let buffer = ''
      let dropping = false
      stream?.on('data', (chunk: Buffer) => {
        for (const char of chunk.toString('utf8')) {
          if (char === '\n') {
            const safe = dropping ? null : sanitizeSeedLine(buffer)
            if (safe) {
              const parsed = JSON.parse(safe) as {
                stage: string
                diagnosticId?: string
              }
              seedStage = parsed.stage
              if (
                parsed.diagnosticId &&
                seedDiagnosticId === 'UNKNOWN_REDACTED'
              )
                seedDiagnosticId = parsed.diagnosticId
              process.stdout.write(safe + '\n')
            }
            buffer = ''
            dropping = false
          } else if (!dropping) {
            if (buffer.length >= 512) {
              buffer = ''
              dropping = true
            } else buffer += char
          }
        }
      })
    }
  }
  const ownedCommand = { child, label: formatCommand(command, args) }
  commandProcesses.push(ownedCommand)
  let handleAbort: (() => void) | undefined
  const childOutcome = new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
  }>((resolve) => {
    child.once('error', (error) => {
      spawnError = error
    })
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  const abortOutcome = new Promise<{ aborted: true }>((resolve) => {
    if (!abortSignal) return
    handleAbort = () => resolve({ aborted: true })
    abortSignal.addEventListener('abort', handleAbort, { once: true })
    if (abortSignal.aborted) handleAbort()
  })
  try {
    const outcome = await Promise.race([childOutcome, abortOutcome])
    await retireOwnedProcess(commandProcesses, ownedCommand)
    abortSignal?.throwIfAborted()
    if (spawnError) throw spawnError
    if ('aborted' in outcome) {
      throw new Error('Phase 7 command aborted without an abort reason.')
    }
    if (outcome.code === 0) return
    if (isSeed)
      process.stdout.write(
        JSON.stringify({
          seedDiagnostic: 1,
          stage: seedStage,
          exit: outcome.code,
          signal: outcome.signal,
          diagnosticId: seedDiagnosticId
        }) + '\n'
      )
    throw new Error(
      `${ownedCommand.label} failed (` +
        `${outcome.signal ?? `exit ${outcome.code ?? 'unknown'}`}).`
    )
  } finally {
    if (abortSignal && handleAbort) {
      abortSignal.removeEventListener('abort', handleAbort)
    }
  }
}

const cleanup = (): Promise<void> => {
  cleanupPromise ??= (async () => {
    let firstError: unknown
    const record = (error: unknown): void => {
      firstError ??= error
    }
    try {
      await stopOwnedProcesses(commandProcesses)
    } catch (error: unknown) {
      record(error)
    }
    commandProcesses.length = 0

    if (adminConnected) {
      try {
        await restoreDatabase()
      } catch (error: unknown) {
        record(error)
      }
      try {
        if (schemaCreated) {
          await adminClient.query(
            `DROP SCHEMA IF EXISTS ${quoteSchema(schemaName)} CASCADE`
          )
          schemaCreated = false
        }
        await verifySchemaAbsent()
      } catch (error: unknown) {
        record(error)
      }
      try {
        await restorePgcrypto()
      } catch (error: unknown) {
        record(error)
      }
      try {
        for (const { grantedRole, name } of WRAPPER_ROLES.toReversed()) {
          if (!createdWrapperRoles.has(name)) continue
          await adminClient.query(
            `REVOKE ${quoteIdentifier(grantedRole)} FROM ${quoteIdentifier(name)}`
          )
          await adminClient.query(`DROP ROLE ${quoteIdentifier(name)}`)
          createdWrapperRoles.delete(name)
        }
        for (const name of LEGACY_ROLES.toReversed()) {
          if (!createdWrapperRoles.has(name)) continue
          await adminClient.query(`DROP ROLE ${quoteIdentifier(name)}`)
          createdWrapperRoles.delete(name)
        }
        if (createdGroupRoles.has('nihongo_phase7_migration')) {
          await adminClient.query(
            `REVOKE "nihongo_phase7_owner" FROM "nihongo_phase7_migration"`
          )
        }
        for (const role of GROUP_ROLES.toReversed()) {
          if (!createdGroupRoles.has(role)) continue
          await adminClient.query(`DROP ROLE ${quoteIdentifier(role)}`)
          createdGroupRoles.delete(role)
        }
        await assertDatabaseRestored()
        await verifySchemaAbsent()
      } catch (error: unknown) {
        record(error)
      }
    }

    if (adminConnected && provisioningLockAcquired) {
      try {
        await adminClient.query(
          `SELECT pg_advisory_unlock(hashtextextended(
             'phase7-db-integration-global-role-provisioning', 0
           ))`
        )
        provisioningLockAcquired = false
      } catch (error: unknown) {
        record(error)
      }
    }
    if (adminConnected) {
      try {
        await adminClient.end()
      } catch (error: unknown) {
        record(error)
      }
      adminConnected = false
    }
    if (firstError) throw firstError
  })()
  return cleanupPromise
}

export const cleanupPhase7IsolatedDatabase = async (): Promise<void> => {
  await cleanup()
}

export const registerCapabilityAndActivate = async (
  abortSignal?: AbortSignal,
  issuerActivationOwner: 'runner' | 'fixture' = 'runner'
): Promise<void> => {
  abortSignal?.throwIfAborted()
  const migrationClient = new Client({
    connectionString: migrationDatabaseUrl.toString()
  })
  await migrationClient.connect()
  try {
    abortSignal?.throwIfAborted()
    await migrationClient.query(`SET search_path TO ${quoteSchema(schemaName)}`)
    abortSignal?.throwIfAborted()
    const endpoint = await migrationClient.query<{
      databaseName: string
      serverAddress: string
      serverPort: number
    }>(
      `SELECT current_database() AS "databaseName",
         inet_server_addr()::text AS "serverAddress",
         inet_server_port() AS "serverPort"`
    )
    const target = endpoint.rows[0]
    if (!target) {
      throw new Error('Phase 7 API endpoint identity is unavailable.')
    }
    abortSignal?.throwIfAborted()
    await migrationClient.query(
      `SELECT "phase7_register_database_capability"(
         $1, $2::inet, $3, 'TEST'
       )`,
      [target.databaseName, target.serverAddress, target.serverPort]
    )
    abortSignal?.throwIfAborted()
    // Lifecycle's existing SSO fixture owns the one-way activation in connect().
    if (issuerActivationOwner === 'runner') {
      await migrationClient.query(`SELECT "phase7_activate_v1_issuer"('TEST')`)
    }
    abortSignal?.throwIfAborted()
  } finally {
    await migrationClient.end()
  }
}

export const preparePhase7IntegrationArtifacts = async ({
  abortSignal,
  environment = process.env,
  prepared = false,
  run = runCommand
}: {
  abortSignal?: AbortSignal
  environment?: NodeJS.ProcessEnv
  prepared?: boolean
  run?: typeof runCommand
} = {}): Promise<void> => {
  abortSignal?.throwIfAborted()
  if (prepared) return
  for (const args of [
    ['--filter', '@nihongo/contracts', 'run', 'build'],
    ['--filter', '@nihongo/domain', 'run', 'build'],
    ['--filter', '@nihongo/api', 'run', 'db:generate']
  ]) {
    abortSignal?.throwIfAborted()
    await run('pnpm', args, environment, abortSignal)
  }
  abortSignal?.throwIfAborted()
}

export const preparePhase7IsolatedDatabase = async ({
  abortSignal,
  seedRuns = 0,
  issuerActivationOwner = 'runner',
  artifactsPrepared = false
}: PreparePhase7IsolatedDatabaseOptions = {}): Promise<Phase7IsolatedDatabaseHarness> => {
  if (databasePrepared) {
    throw new Error('Phase 7 isolated database harness is already prepared.')
  }
  if (!Number.isInteger(seedRuns) || seedRuns < 0 || seedRuns > 2) {
    throw new Error('Phase 7 isolated database seed run count is invalid.')
  }

  abortSignal?.throwIfAborted()
  await adminClient.connect()
  adminConnected = true
  abortSignal?.throwIfAborted()
  await acquireProvisioningLock()
  abortSignal?.throwIfAborted()
  await verifySchemaAbsent()
  abortSignal?.throwIfAborted()
  databaseSnapshot = await readDatabaseSnapshot()
  abortSignal?.throwIfAborted()
  await attestBootstrap()
  abortSignal?.throwIfAborted()
  await provisionRoles()
  abortSignal?.throwIfAborted()
  await ensurePgcrypto()
  abortSignal?.throwIfAborted()
  await applyMigrationDatabaseBoundary()
  abortSignal?.throwIfAborted()
  await adminClient.query(
    `CREATE SCHEMA ${quoteSchema(schemaName)}
     AUTHORIZATION "nihongo_phase7_migration"`
  )
  schemaCreated = true
  abortSignal?.throwIfAborted()

  const sharedEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    ADMIN_CMS_MODE: 'technical',
    AUTH_GATEWAY_DATABASE_URL: authGatewayDatabaseUrl.toString(),
    DATABASE_URL: applicationDatabaseUrl.toString(),
    PHASE7_API_ERASURE_DATABASE_URL: erasureWorkerDatabaseUrl.toString(),
    NODE_ENV: 'test',
    PHASE7_API_ADMIN_DATABASE_URL: targetDatabaseUrl.toString(),
    PHASE7_API_MIGRATION_DATABASE_URL: migrationDatabaseUrl.toString(),
    PHASE7_MIGRATION_DATABASE_URL: migrationDatabaseUrl.toString(),
    PRISMA_TEST_DATABASE_URL: applicationDatabaseUrl.toString(),
    PRODUCTION_DATABASE_URL: syntheticProductionDatabaseUrl.toString()
  }

  await preparePhase7IntegrationArtifacts({
    ...(abortSignal === undefined ? {} : { abortSignal }),
    environment: sharedEnvironment,
    prepared: artifactsPrepared
  })
  const canonicalMigrationsPath = nodePath.join(
    repositoryRoot,
    'apps/api/prisma/migrations'
  )
  const lastBootstrapMigration =
    '20261009092000_phase7_n4_n2_revision2_digest_fix'
  const migrationNames = readdirSync(canonicalMigrationsPath, {
    withFileTypes: true
  })
    .filter(
      (entry) => entry.isDirectory() && entry.name <= lastBootstrapMigration
    )
    .map((entry) => entry.name)
    .sort()
  if (
    migrationNames.length !== 37 ||
    migrationNames.at(-1) !== lastBootstrapMigration
  ) {
    throw new Error(
      'Phase 7 canonical content migration prefix is inconsistent.'
    )
  }
  const bootstrapMigrationsPath = mkdtempSync(
    nodePath.join(tmpdir(), 'nihongo-phase7-content-')
  )
  try {
    copyFileSync(
      nodePath.join(canonicalMigrationsPath, 'migration_lock.toml'),
      nodePath.join(bootstrapMigrationsPath, 'migration_lock.toml')
    )
    for (const name of migrationNames) {
      cpSync(
        nodePath.join(canonicalMigrationsPath, name),
        nodePath.join(bootstrapMigrationsPath, name),
        { recursive: true }
      )
    }
    await runCommand(
      'pnpm',
      ['--filter', '@nihongo/api', 'run', 'db:migrate:deploy'],
      {
        ...sharedEnvironment,
        PHASE7_TEST_MIGRATIONS_PATH: bootstrapMigrationsPath
      },
      abortSignal
    )
    await registerCapabilityAndActivate(abortSignal, issuerActivationOwner)

    for (let runIndex = 0; runIndex < seedRuns; runIndex += 1) {
      await runCommand(
        'pnpm',
        ['--filter', '@nihongo/api', 'run', 'db:seed:test'],
        sharedEnvironment,
        abortSignal
      )
    }
    // Seed-free callers retain the prefix until their explicit seed step.
    if (seedRuns > 0) {
      await runCommand(
        'pnpm',
        ['--filter', '@nihongo/api', 'run', 'db:migrate:deploy'],
        {
          ...sharedEnvironment,
          PHASE7_TEST_MIGRATIONS_PATH: canonicalMigrationsPath
        },
        abortSignal
      )
    }
  } finally {
    rmSync(bootstrapMigrationsPath, { recursive: true, force: true })
  }

  abortSignal?.throwIfAborted()
  databasePrepared = true
  return {
    adminDatabaseUrl: targetDatabaseUrl.toString(),
    applicationDatabaseUrl: applicationDatabaseUrl.toString(),
    authGatewayDatabaseUrl: authGatewayDatabaseUrl.toString(),
    erasureWorkerDatabaseUrl: erasureWorkerDatabaseUrl.toString(),
    migrationDatabaseUrl: migrationDatabaseUrl.toString(),
    schemaName,
    sharedEnvironment
  }
}

const run = async (): Promise<void> => {
  const { sharedEnvironment } = await preparePhase7IsolatedDatabase()
  const phase7ApiEntries = getPhase10ApiIntegrationEntriesByOwner('phase7-api')
  const [repositoryEntry, apiGateEntry, commandRepositoryEntry] =
    phase7ApiEntries
  if (
    phase7ApiEntries.length !== 3 ||
    !apiGateEntry ||
    !repositoryEntry ||
    !commandRepositoryEntry ||
    apiGateEntry.shard !== 'phase7-api-post-seed' ||
    apiGateEntry.seedPolicy !== 'canonical-once' ||
    repositoryEntry.shard !== 'phase7-api-pre-seed' ||
    repositoryEntry.seedPolicy !== 'none' ||
    commandRepositoryEntry.shard !== 'phase7-api-post-seed' ||
    commandRepositoryEntry.seedPolicy !== 'canonical-once'
  ) {
    throw new Error('Phase 7 API integration manifest is incomplete.')
  }
  await runPhase10ManifestVitestFile({
    runCommand,
    testFile: repositoryEntry.path,
    environment: sharedEnvironment
  })
  await runCommand(
    'pnpm',
    ['--filter', '@nihongo/api', 'run', 'db:seed:test'],
    sharedEnvironment
  )
  // Batch7 installs current only from the unchanged canonical65 bootstrap.
  // Historical prepare(seedRuns:0) callers keep their prefix37 profile.
  await runCommand(
    'pnpm',
    ['--filter', '@nihongo/api', 'run', 'db:migrate:deploy'],
    {
      ...sharedEnvironment,
      PHASE7_TEST_MIGRATIONS_PATH: nodePath.join(
        repositoryRoot,
        'apps/api/prisma/migrations'
      )
    }
  )
  await runPhase10ManifestVitestFile({
    runCommand,
    testFile: apiGateEntry.path,
    environment: sharedEnvironment
  })
  await runPhase10ManifestVitestFile({
    runCommand,
    testFile: commandRepositoryEntry.path,
    environment: sharedEnvironment
  })
}

const runSsoAccountLifecycle = async (): Promise<void> => {
  const harness = await preparePhase7IsolatedDatabase({
    seedRuns: 1,
    issuerActivationOwner: 'fixture'
  })
  await runCommand(
    'pnpm',
    ['--filter', '@nihongo/api', 'run', 'db:migrate:deploy'],
    {
      ...harness.sharedEnvironment,
      PHASE7_TEST_MIGRATIONS_PATH: nodePath.join(
        repositoryRoot,
        'apps/api/prisma/migrations'
      )
    }
  )
  const migrationsPath = nodePath.join(
    repositoryRoot,
    'apps/api/prisma/migrations'
  )
  const names = readdirSync(migrationsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const applied = await adminClient.query<{
    migration_name: string
    checksum: string
  }>(
    `SELECT migration_name, checksum FROM ${quoteSchema(schemaName)}."_prisma_migrations"
     WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`
  )
  if (
    names.length !== 50 ||
    names.at(-1) !== '20261028150000_sso_provider_cleanup_fencing' ||
    applied.rows.length !== names.length ||
    applied.rows.some(
      (row, index) =>
        row.migration_name !== names[index] ||
        row.checksum !==
          createHash('sha256')
            .update(
              readFileSync(
                nodePath.join(
                  migrationsPath,
                  row.migration_name,
                  'migration.sql'
                )
              )
            )
            .digest('hex')
    )
  )
    throw new Error(
      'First Google ADMIN bootstrap canonical50 migration history mismatch.'
    )
  process.stdout.write(
    JSON.stringify({
      event: 'phase7.api.sso_first_admin_bootstrap.migrations_verified',
      canonicalCount: 50,
      checksumMatch: true,
      reentry: true
    }) + '\n'
  )
  const environment = createPhase7SsoTestEnvironment({
    ...harness.sharedEnvironment,
    PHASE7_ADMIN_DATABASE_URL: harness.adminDatabaseUrl
  })
  const count = await runPhase10ManifestVitestFile({
    runCommand,
    testFile: phase7SsoAccountLifecycleTestFile,
    environment,
    preserveSanitizedReport: true
  })
  const orphanResult = await adminClient.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM (
      SELECT f."userId" FROM ${quoteSchema(schemaName)}."SsoAccountFreshProof" f
      LEFT JOIN ${quoteSchema(schemaName)}."User" u ON u.id=f."userId" WHERE u.id IS NULL
      UNION ALL
      SELECT f."userId" FROM ${quoteSchema(schemaName)}."SsoAccountFreshTransaction" f
      LEFT JOIN ${quoteSchema(schemaName)}."User" u ON u.id=f."userId" WHERE u.id IS NULL
      UNION ALL
      SELECT f."userId" FROM ${quoteSchema(schemaName)}."SsoAccountErasureRequest" f
      LEFT JOIN ${quoteSchema(schemaName)}."User" u ON u.id=f."userId" WHERE f."userId" IS NOT NULL AND u.id IS NULL
    ) orphan_rows`
  )
  if (count !== 6 || orphanResult.rows[0]?.count !== 0)
    throw new Error('SSO account lifecycle exact6/orphan verification failed.')
  process.stdout.write(
    JSON.stringify({
      event: 'phase7.api.sso_account_lifecycle.tests_verified',
      selected: 6,
      passed: count,
      orphanCount: 0
    }) + '\n'
  )
}

const readSsoBrowserLoopbackInputs = (source: NodeJS.ProcessEnv) => {
  const host = source.PHASE7_SSO_BROWSER_API_HOST
  const portText = source.PHASE7_SSO_BROWSER_API_PORT
  const webOrigin = source.PHASE7_SSO_BROWSER_WEB_ORIGIN
  if (
    host !== '127.0.0.1' ||
    !portText ||
    !/^[1-9][0-9]{0,4}$/u.test(portText) ||
    Number(portText) > 65_535 ||
    Number(portText) === 5173 ||
    !webOrigin
  ) {
    throw new Error('SSO browser requires explicit owned loopback inputs.')
  }
  let web: URL
  try {
    web = new URL(webOrigin)
  } catch {
    throw new Error('SSO browser web origin is invalid.')
  }
  if (
    web.protocol !== 'http:' ||
    web.hostname !== host ||
    web.origin !== webOrigin ||
    web.port === '5173'
  ) {
    throw new Error('SSO browser web origin must be an owned loopback origin.')
  }
  return {
    host,
    port: Number(portText),
    webOrigin,
    apiOrigin: `http://${host}:${portText}`
  }
}

const runSsoBrowserGoogle = async (): Promise<void> => {
  const { host, port, webOrigin, apiOrigin } = readSsoBrowserLoopbackInputs(
    process.env
  )
  const [
    { createServer },
    { getRequestListener },
    { parseApiEnvironment },
    { createPhase7SsoBrowserApiFixture }
  ] = await Promise.all([
    import('node:http'),
    import('@hono/node-server'),
    import('../config/env.js'),
    import('./phase7BrowserFixture.js')
  ])
  const controller = new AbortController()
  const shutdownReason = new Error('SSO browser shutdown requested.')
  let server: import('node:http').Server | undefined
  let fixture:
    | Awaited<ReturnType<typeof createPhase7SsoBrowserApiFixture>>
    | undefined
  let stop: (() => void) | undefined
  let firstFailure: unknown
  let closePromise: Promise<void> | undefined
  let ownedSessionExpiryArmed = false
  let ownedSessionExpiryReconciled = false
  const onSignal = () => {
    controller.abort(shutdownReason)
    stop?.()
  }
  const onFailure = () => {
    firstFailure ??= new Error('SSO browser dependency failed.')
    controller.abort(firstFailure)
    stop?.()
  }
  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      if (ownedSessionExpiryArmed && !ownedSessionExpiryReconciled) onFailure()
      let firstCleanupFailure: unknown
      const record = (error: unknown) => {
        firstCleanupFailure ??= error
      }
      const ownedServer = server
      if (ownedServer) {
        try {
          await new Promise<void>((resolve, reject) => {
            ownedServer.close((error) => {
              if (
                error &&
                (!('code' in error) || error.code !== 'ERR_SERVER_NOT_RUNNING')
              )
                reject(error)
              else resolve()
            })
            ownedServer.closeAllConnections()
          })
        } catch (error: unknown) {
          record(error)
        }
      }
      try {
        await fixture?.disconnect()
      } catch (error: unknown) {
        record(error)
      }
      if (ownedSessionExpiryArmed && !ownedSessionExpiryReconciled) onFailure()
      try {
        await cleanupPhase7IsolatedDatabase()
      } catch (error: unknown) {
        record(error)
      }
      if (firstCleanupFailure) throw firstCleanupFailure
    })()
    return closePromise
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, onSignal)
  adminClient.on('error', onFailure)
  try {
    const harness = await preparePhase7IsolatedDatabase({
      seedRuns: 0,
      abortSignal: controller.signal
    })
    // The full migration chain requires the canonical prefix content bootstrap.
    await runCommand(
      'pnpm',
      ['--filter', '@nihongo/api', 'run', 'db:seed:test'],
      harness.sharedEnvironment,
      controller.signal
    )
    await runCommand(
      'pnpm',
      ['--filter', '@nihongo/api', 'run', 'db:migrate:deploy'],
      {
        ...harness.sharedEnvironment,
        PHASE7_TEST_MIGRATIONS_PATH: nodePath.join(
          repositoryRoot,
          'apps/api/prisma/migrations'
        )
      },
      controller.signal
    )
    const environment = parseApiEnvironment({
      NODE_ENV: 'test',
      DEPLOYMENT_ENVIRONMENT: 'TEST',
      RELEASE_ID: '0'.repeat(40),
      ADMIN_CMS_MODE: 'disabled',
      HOST: host,
      PORT: String(port),
      DATABASE_URL: harness.applicationDatabaseUrl,
      AUTH_GATEWAY_DATABASE_URL: harness.authGatewayDatabaseUrl,
      TRUSTED_ORIGINS: webOrigin,
      BETTER_AUTH_URL: apiOrigin,
      BETTER_AUTH_SECRET: 'phase7-sso-browser-auth-test-only-secret-v1',
      GUEST_COOKIE_SECRET: 'phase7-sso-browser-guest-test-only-secret-v1',
      LOG_LEVEL: 'silent'
    })
    controller.signal.throwIfAborted()
    fixture = await createPhase7SsoBrowserApiFixture({
      databaseUrl: harness.applicationDatabaseUrl,
      authGatewayDatabaseUrl: harness.authGatewayDatabaseUrl,
      adminDatabaseUrl: harness.adminDatabaseUrl,
      environment,
      isolateSignIns: true
    })
    await fixture.checkReadiness()
    controller.signal.throwIfAborted()
    const stopped = new Promise<void>((resolve) => {
      stop = resolve
    })
    const app = fixture.app
    const armOwnedSessionExpiry = fixture.armOwnedSessionExpiry
    let ownedSessionExpiryAttempted = false
    let ownedSessionExpiryOperation: Promise<void> | undefined
    const reconcileOwnedSessionExpiry = fixture.reconcileOwnedSessionExpiry
    let expiryPhase:
      | 'NOT_ARMED'
      | 'WAIT_FIRST_PROTECTED'
      | 'FIRST_PROTECTED_IN_FLIGHT'
      | 'FIRST_401_CONFIRMED'
      | 'RECONCILING'
      | 'RECONCILED' = 'NOT_ARMED'
    let protectedIngressCountBeforeFirst401 = 0
    let reconciliationAttempted = false
    let signInEnteredCount = 0
    let signInCompleted2xxCount = 0
    const failExpiryDependency = (): never => {
      onFailure()
      throw new Error('SSO browser dependency failed.')
    }
    const expectedReconciliation = {
      baselineOwnedUserAccountCaptured: true,
      baselineOwnedSessionFamilyCaptured: true,
      saveAnswerABeforeBookmarkB: true,
      saveBookmarkUserDelta: 0,
      saveBookmarkAccountDelta: 0,
      saveBookmarkBookmarkDelta: 0,
      ownedSessionExpiryArmedOnce: 1,
      oldL0Expired: true,
      oldF0Active: true,
      login2SameInternalUserU: true,
      login2UserDeltaFromSaveBookmark: 0,
      login2AccountDeltaFromSaveBookmark: 0,
      login2BookmarkDeltaFromSaveBookmark: 0,
      login2SessionDeltaFromSaveBookmark: 1,
      login2FamilyDeltaFromSaveBookmark: 1,
      samePracticeRetained: true,
      answerARetained: true,
      bookmarkBRetained: true
    } as const
    const listener = getRequestListener(
      async (...args: Parameters<typeof app.fetch>) => {
        const [request] = args
        const pathname = new URL(request.url).pathname
        const isBookmarkList =
          request.method === 'GET' && pathname === '/api/v1/bookmarks'
        if (firstFailure) failExpiryDependency()
        let claimsFirstProtected = false
        if (
          request.method !== 'OPTIONS' &&
          pathname.startsWith('/api/v1/') &&
          (expiryPhase === 'WAIT_FIRST_PROTECTED' ||
            expiryPhase === 'FIRST_PROTECTED_IN_FLIGHT')
        ) {
          protectedIngressCountBeforeFirst401 += 1
          if (
            expiryPhase !== 'WAIT_FIRST_PROTECTED' ||
            protectedIngressCountBeforeFirst401 !== 1 ||
            !isBookmarkList
          ) {
            failExpiryDependency()
          }
          expiryPhase = 'FIRST_PROTECTED_IN_FLIGHT'
          claimsFirstProtected = true
        }
        const claimsReconciliation =
          isBookmarkList &&
          signInEnteredCount === 2 &&
          signInCompleted2xxCount === 2 &&
          (expiryPhase === 'FIRST_401_CONFIRMED' ||
            expiryPhase === 'RECONCILING')
        if (claimsReconciliation && reconciliationAttempted) {
          failExpiryDependency()
        }
        if (
          request.method !== 'POST' ||
          pathname !== '/api/auth/sign-in/social'
        ) {
          const response = await app.fetch(...args)
          if (claimsFirstProtected) {
            try {
              if (response.status !== 401) failExpiryDependency()
              const body: unknown = await response.clone().json()
              if (
                !body ||
                typeof body !== 'object' ||
                !('code' in body) ||
                body.code !== 'AUTH_SESSION_EXPIRED' ||
                protectedIngressCountBeforeFirst401 !== 1 ||
                firstFailure
              ) {
                failExpiryDependency()
              }
              expiryPhase = 'FIRST_401_CONFIRMED'
              process.stdout.write(
                `${JSON.stringify({
                  event:
                    'phase7.api.sso_browser.session_expiry.first_protected',
                  kind: 'BOOKMARK_LIST',
                  firstProtectedIngressAfterArm: true,
                  countBeforeFirst401: protectedIngressCountBeforeFirst401,
                  firstStatus: 401,
                  firstCode: 'AUTH_SESSION_EXPIRED'
                })}\n`
              )
            } catch {
              failExpiryDependency()
            }
          }
          if (claimsReconciliation && response.status === 200) {
            if (reconciliationAttempted) failExpiryDependency()
            reconciliationAttempted = true
            expiryPhase = 'RECONCILING'
            try {
              const receipt = await reconcileOwnedSessionExpiry()
              const finalReceipt = {
                baselineOwnedUserAccountCaptured:
                  receipt.baselineOwnedUserAccountCaptured,
                baselineOwnedSessionFamilyCaptured:
                  receipt.baselineOwnedSessionFamilyCaptured,
                saveAnswerABeforeBookmarkB: receipt.saveAnswerABeforeBookmarkB,
                saveBookmarkUserDelta: receipt.saveBookmarkUserDelta,
                saveBookmarkAccountDelta: receipt.saveBookmarkAccountDelta,
                saveBookmarkBookmarkDelta: receipt.saveBookmarkBookmarkDelta,
                ownedSessionExpiryArmedOnce:
                  receipt.ownedSessionExpiryArmedOnce,
                oldL0Expired: receipt.oldL0Expired,
                oldF0Active: receipt.oldF0Active,
                login2SameInternalUserU: receipt.login2SameInternalUserU,
                login2UserDeltaFromSaveBookmark:
                  receipt.login2UserDeltaFromSaveBookmark,
                login2AccountDeltaFromSaveBookmark:
                  receipt.login2AccountDeltaFromSaveBookmark,
                login2BookmarkDeltaFromSaveBookmark:
                  receipt.login2BookmarkDeltaFromSaveBookmark,
                login2SessionDeltaFromSaveBookmark:
                  receipt.login2SessionDeltaFromSaveBookmark,
                login2FamilyDeltaFromSaveBookmark:
                  receipt.login2FamilyDeltaFromSaveBookmark,
                samePracticeRetained: receipt.samePracticeRetained,
                answerARetained: receipt.answerARetained,
                bookmarkBRetained: receipt.bookmarkBRetained
              }
              if (
                firstFailure ||
                Object.keys(receipt).length !== 18 ||
                Object.entries(expectedReconciliation).some(
                  ([key, expected]) =>
                    finalReceipt[key as keyof typeof expectedReconciliation] !==
                    expected
                )
              ) {
                failExpiryDependency()
              }
              process.stdout.write(
                `${JSON.stringify({
                  event: 'phase7.api.sso_browser.session_expiry.reconciled',
                  ...finalReceipt
                })}\n`
              )
              ownedSessionExpiryReconciled = true
              expiryPhase = 'RECONCILED'
            } catch {
              failExpiryDependency()
            }
          }
          if (
            request.method === 'PUT' &&
            /^\/api\/v1\/bookmarks\/[^/]+$/.test(
              new URL(request.url).pathname
            ) &&
            response.status === 201
          ) {
            if (!ownedSessionExpiryAttempted) {
              ownedSessionExpiryAttempted = true
              ownedSessionExpiryOperation = (async () => {
                try {
                  const receipt = await armOwnedSessionExpiry()
                  if (
                    receipt.armed !== true ||
                    receipt.expired !== true ||
                    receipt.sessionCount !== 1
                  ) {
                    throw new Error('SSO browser dependency failed.')
                  }
                  if (firstFailure) failExpiryDependency()
                  ownedSessionExpiryArmed = true
                  expiryPhase = 'WAIT_FIRST_PROTECTED'
                } catch {
                  onFailure()
                  throw new Error('SSO browser dependency failed.')
                }
                try {
                  process.stdout.write(
                    `${JSON.stringify({
                      event: 'phase7.api.sso_browser.session_expiry.armed',
                      armed: true,
                      expired: true,
                      sessionCount: 1
                    })}\n`
                  )
                } catch {
                  // Diagnostics must not change the request outcome.
                }
              })()
            }
            await ownedSessionExpiryOperation
          }
          return response
        }
        signInEnteredCount += 1
        try {
          process.stdout.write(
            `${JSON.stringify({
              event: 'phase7.api.sso_browser.start.entered',
              method: 'POST',
              path: '/api/auth/sign-in/social'
            })}\n`
          )
        } catch {
          // Diagnostics must not change the request outcome.
        }
        let response: Response
        try {
          response = await app.fetch(...args)
        } catch (error: unknown) {
          try {
            process.stdout.write(
              `${JSON.stringify({
                event: 'phase7.api.sso_browser.start.fetch_failed',
                method: 'POST',
                path: '/api/auth/sign-in/social'
              })}\n`
            )
          } catch {
            // Preserve the original fetch error even if diagnostics fail.
          }
          throw error
        }
        const status = response.status
        const statusClass =
          status >= 200 && status < 300
            ? '2xx'
            : status >= 400 && status < 500
              ? '4xx'
              : status >= 500 && status < 600
                ? '5xx'
                : undefined
        if (statusClass === '2xx') signInCompleted2xxCount += 1
        try {
          process.stdout.write(
            `${JSON.stringify({
              event: statusClass
                ? 'phase7.api.sso_browser.start.completed'
                : 'phase7.api.sso_browser.start.status_failed',
              method: 'POST',
              path: '/api/auth/sign-in/social',
              ...(statusClass ? { statusClass } : {})
            })}\n`
          )
        } catch {
          // Diagnostics must not replace the original response.
        }
        return response
      },
      {
        hostname: host,
        errorHandler: () => {
          onFailure()
          return new Response('SSO browser request failed.', { status: 500 })
        }
      }
    )
    server = createServer((incoming, outgoing) => {
      void listener(incoming, outgoing).catch(() => {
        onFailure()
        outgoing.destroy()
      })
    })
    server.on('error', onFailure)
    server.once('close', () => {
      if (!controller.signal.aborted) onFailure()
    })
    const ownedServer = server
    await new Promise<void>((resolve, reject) => {
      ownedServer.once('error', reject)
      ownedServer.listen(port, host, () => {
        ownedServer.removeListener('error', reject)
        resolve()
      })
    })
    controller.signal.throwIfAborted()
    const address = server.address()
    if (
      !address ||
      typeof address === 'string' ||
      address.address !== host ||
      address.port !== port
    ) {
      throw new Error('SSO browser listener did not bind the owned endpoint.')
    }
    process.stdout.write(
      `${JSON.stringify({ event: 'phase7.api.sso_browser.ready', apiOrigin })}\n`
    )
    await stopped
    if (firstFailure) throw firstFailure
  } catch (error: unknown) {
    if (error !== shutdownReason) firstFailure ??= error
  } finally {
    try {
      await close()
    } catch (error: unknown) {
      firstFailure ??= error
    }
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.removeListener(signal, onSignal)
    }
    adminClient.removeListener('error', onFailure)
  }
  if (firstFailure) throw firstFailure
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === nodePath.resolve(process.argv[1])

if (isDirectExecution && apiIntegrationCase === 'sso-browser-google') {
  void runSsoBrowserGoogle().catch(() => {
    process.stderr.write(
      `${JSON.stringify({ event: 'phase7.api.sso_browser.failed' })}\n`
    )
    process.exitCode = 1
  })
} else if (isDirectExecution) {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void cleanup()
        .then(() => process.exit(signal === 'SIGINT' ? 130 : 143))
        .catch(() => process.exit(1))
    })
  }

  void (
    apiIntegrationCase === 'sso-account-lifecycle'
      ? runSsoAccountLifecycle()
      : run()
  )
    .then(async () => {
      await cleanup()
      process.stdout.write(
        `${JSON.stringify({
          event: 'phase7.api.integration.passed',
          schemaRemoved: true
        })}\n`
      )
    })
    .catch(async (error: unknown) => {
      try {
        await cleanup()
      } catch (cleanupError: unknown) {
        process.stderr.write(
          `${JSON.stringify({
            event: 'phase7.api.integration.cleanup_failed',
            errorName:
              cleanupError instanceof Error
                ? cleanupError.name
                : 'UnknownError',
            schemaName
          })}\n`
        )
      }
      process.stderr.write(
        `${JSON.stringify({
          event: 'phase7.api.integration.failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : 'Unknown failure',
          schemaName
        })}\n`
      )
      process.exitCode = 1
    })
}
