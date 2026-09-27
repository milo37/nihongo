import { randomUUID } from 'node:crypto'
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

const baseDatabaseUrl =
  process.env.PHASE7_API_INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
if (!baseDatabaseUrl) {
  throw new Error('Phase 7 API integration requires a test PostgreSQL URL.')
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
  environment: NodeJS.ProcessEnv
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
          if (spawnError) return reject(spawnError)
          if (code === 0) return resolve()
          reject(
            new Error(
              `${ownedCommand.label} failed (${signal ?? `exit ${code ?? 'unknown'}`}).`
            )
          )
        },
        (error: unknown) => reject(error)
      )
    })
  })

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

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void cleanup()
      .then(() => process.exit(signal === 'SIGINT' ? 130 : 143))
      .catch(() => process.exit(1))
  })
}

const registerCapabilityAndActivate = async (): Promise<void> => {
  const migrationClient = new Client({
    connectionString: migrationDatabaseUrl.toString()
  })
  await migrationClient.connect()
  try {
    await migrationClient.query(`SET search_path TO ${quoteSchema(schemaName)}`)
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
    await migrationClient.query(
      `SELECT "phase7_register_database_capability"(
         $1, $2::inet, $3, 'TEST'
       )`,
      [target.databaseName, target.serverAddress, target.serverPort]
    )
    await migrationClient.query(`SELECT "phase7_activate_v1_issuer"('TEST')`)
  } finally {
    await migrationClient.end()
  }
}

const run = async (): Promise<void> => {
  await adminClient.connect()
  adminConnected = true
  await acquireProvisioningLock()
  await verifySchemaAbsent()
  databaseSnapshot = await readDatabaseSnapshot()
  await attestBootstrap()
  await provisionRoles()
  await ensurePgcrypto()
  await applyMigrationDatabaseBoundary()
  await adminClient.query(
    `CREATE SCHEMA ${quoteSchema(schemaName)}
     AUTHORIZATION "nihongo_phase7_migration"`
  )
  schemaCreated = true

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

  await runCommand('pnpm', ['run', 'build:contracts'], sharedEnvironment)
  await runCommand('pnpm', ['run', 'build:domain'], sharedEnvironment)
  await runCommand(
    'pnpm',
    ['--filter', '@nihongo/api', 'run', 'db:generate'],
    sharedEnvironment
  )
  await runCommand(
    'pnpm',
    ['--filter', '@nihongo/api', 'run', 'db:migrate:phase7'],
    sharedEnvironment
  )
  await registerCapabilityAndActivate()
  await runCommand(
    'pnpm',
    [
      '--filter',
      '@nihongo/api',
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.integration.config.ts',
      'src/app/phase7ApiGate.integration.test.ts'
    ],
    sharedEnvironment
  )
  await runCommand(
    'pnpm',
    [
      '--filter',
      '@nihongo/api',
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.integration.config.ts',
      'src/admin/adminQuestionRepository.integration.test.ts'
    ],
    sharedEnvironment
  )
  await runCommand(
    'pnpm',
    ['--filter', '@nihongo/api', 'run', 'db:seed:test'],
    sharedEnvironment
  )
  await runCommand(
    'pnpm',
    [
      '--filter',
      '@nihongo/api',
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.integration.config.ts',
      'src/admin/adminQuestionCommandRepository.integration.test.ts'
    ],
    sharedEnvironment
  )
}

void run()
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
            cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
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
