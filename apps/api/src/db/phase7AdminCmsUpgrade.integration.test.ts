import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { canonicalDuplicateIdentity } from '@nihongo/domain/content/validators/v1/duplicates'
import type { PersistedQuestionSemanticV1 } from '@nihongo/domain/content/validators/v1/types'
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { describe, expect, it } from 'vitest'
import {
  buildAllQuestionSeeds,
  type SeedQuestionCatalogResult
} from '../../prisma/seedQuestionCatalog.js'
import type { QuestionAggregateSeed } from '../../prisma/seed-data/buildQuestionSeed.js'
import { parseApiEnvironment } from '../config/env.js'
import { assertSafeAdminCmsDatabase } from './databaseTargetGuard.js'
import {
  assertMigrationCompatibility,
  loadExpectedMigrationManifest,
  selectExpectedMigrationManifest,
  type AppliedMigration
} from './readiness.js'

const execFileAsync = promisify(execFile)
const apiRoot = fileURLToPath(new URL('../../', import.meta.url))
const sourceMigrationsDirectory = join(apiRoot, 'prisma', 'migrations')
const prismaBinary = join(apiRoot, 'node_modules', '.bin', 'prisma')
const PHASE7_MIGRATIONS = [
  '20260827100000_phase7_admin_cms_enums',
  '20260827101000_phase7_admin_cms_foundation'
] as const
const PHASE6_SEMANTIC_DIGEST =
  'a180a0ea8dac51200b533fbe99624036fc19984be9cfbdd0c972c624e764444c'
const repositoryMigrationNames = readdirSync(sourceMigrationsDirectory, {
  withFileTypes: true
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted()
const phase6MigrationNames = repositoryMigrationNames.filter(
  (name) =>
    !PHASE7_MIGRATIONS.includes(name as (typeof PHASE7_MIGRATIONS)[number])
)

const environment = parseApiEnvironment(process.env)
assertSafeAdminCmsDatabase({
  adminCmsMode: environment.ADMIN_CMS_MODE,
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})
const adminDatabaseUrl = process.env.PHASE7_ADMIN_DATABASE_URL
if (!adminDatabaseUrl) {
  throw new Error('Phase 7 upgrade admin database URL is required.')
}
const migrationDatabaseUrl = process.env.PHASE7_MIGRATION_DATABASE_URL
if (!migrationDatabaseUrl) {
  throw new Error('Phase 7 migration wrapper database URL is required.')
}

const createExpectedFingerprint = (seed: QuestionAggregateSeed): string => {
  const correctOption = seed.options.find(
    ({ id }) => id === seed.correctOptionId
  )
  const [first, second, third, fourth] = seed.options
  if (!correctOption || !first || !second || !third || !fourth) {
    throw new Error(`Seed correct option is unavailable: ${seed.legacyId}`)
  }
  const semantic = {
    level: seed.level,
    subject: seed.subject,
    questionType: seed.questionType,
    difficulty: seed.difficulty,
    passage: seed.passage,
    questionText: seed.questionText,
    options: [
      { key: first.label, text: first.text },
      { key: second.label, text: second.text },
      { key: third.label, text: third.text },
      { key: fourth.label, text: fourth.text }
    ],
    correctOptionKey: correctOption.label,
    explanationKo: seed.explanationKo,
    explanationJa: seed.explanationJa,
    tagKeys: seed.tags.map(({ normalizedName }) => normalizedName)
  } satisfies PersistedQuestionSemanticV1
  return createHash('sha256')
    .update(canonicalDuplicateIdentity(semantic), 'utf8')
    .digest('hex')
}

interface IsolatedUpgradeSchema {
  readonly adminClient: Client
  readonly configPath: string
  readonly databaseAcl: unknown
  readonly databaseName: string
  readonly databaseOwnerOid: string
  readonly databaseUrl: string
  readonly legacyOwnerDatabaseUrl: string
  readonly migrationsPath: string
  readonly quotedSchemaName: string
  readonly schemaName: string
  readonly serverClient: Client
  readonly temporaryDirectory: string
}

const CANONICAL_MIGRATION_LOGIN = 'nihongo_test_phase7_migration_login'
const CANONICAL_APP_LOGIN = 'nihongo_test_app_login'
const CANONICAL_AUTH_GATEWAY_LOGIN = 'nihongo_test_auth_gateway_login'
const CANONICAL_ERASURE_WORKER_LOGIN = 'nihongo_test_erasure_worker_login'
const LEGACY_APP_LOGIN = 'nihongo_test_legacy_app_login'
const MIGRATION_ROLE = 'nihongo_phase7_migration'
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u

const quoteIdentifier = (value: string): string => {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error('Unsafe Phase 7 canonical migration identifier.')
  }
  return `"${value}"`
}

const legacyDatabaseUrl = process.env.PHASE7_LEGACY_DATABASE_URL
if (!legacyDatabaseUrl) {
  throw new Error('Phase 7 legacy compatibility database URL is required.')
}
const legacyCredentials = new URL(legacyDatabaseUrl)
if (decodeURIComponent(legacyCredentials.username) !== LEGACY_APP_LOGIN) {
  throw new Error('Phase 7 legacy compatibility login is not canonical.')
}
const migrationCredentials = new URL(migrationDatabaseUrl)
if (
  decodeURIComponent(migrationCredentials.username) !==
  CANONICAL_MIGRATION_LOGIN
) {
  throw new Error('Phase 7 migration wrapper login is not canonical.')
}

const copyMigration = (name: string, destination: string): void => {
  cpSync(join(sourceMigrationsDirectory, name), join(destination, name), {
    recursive: true
  })
}

const createIsolatedUpgradeSchema =
  async (): Promise<IsolatedUpgradeSchema> => {
    const suffix = randomUUID().replaceAll('-', '')
    const schemaName = `phase7_upgrade_${suffix}_test`
    const quotedSchemaName = quoteIdentifier(schemaName)
    const temporaryDirectory = mkdtempSync(join(apiRoot, '.phase7-upgrade-'))
    const migrationsPath = join(temporaryDirectory, 'migrations')
    const schemaPath = join(temporaryDirectory, 'schema.prisma')
    const configPath = join(temporaryDirectory, 'prisma.config.ts')
    const serverDatabaseUrl = new URL(adminDatabaseUrl)
    serverDatabaseUrl.searchParams.delete('schema')
    serverDatabaseUrl.searchParams.delete('options')
    const serverClient = new Client({
      connectionString: serverDatabaseUrl.toString()
    })
    const adminClient = new Client({
      connectionString: serverDatabaseUrl.toString()
    })
    const legacyOwnerDatabaseUrl = new URL(serverDatabaseUrl)
    legacyOwnerDatabaseUrl.searchParams.set('schema', schemaName)
    const databaseUrl = new URL(migrationCredentials)
    databaseUrl.searchParams.set('schema', schemaName)
    databaseUrl.searchParams.set('options', `-c role=${MIGRATION_ROLE}`)
    const databaseName = decodeURIComponent(serverDatabaseUrl.pathname.slice(1))
    if (
      !databaseName.endsWith('_test') ||
      decodeURIComponent(databaseUrl.pathname.slice(1)) !== databaseName
    ) {
      throw new Error('Phase 7 upgrade URLs must share one approved test DB.')
    }

    mkdirSync(migrationsPath)
    copyFileSync(
      join(sourceMigrationsDirectory, 'migration_lock.toml'),
      join(migrationsPath, 'migration_lock.toml')
    )
    copyFileSync(join(apiRoot, 'prisma', 'schema.prisma'), schemaPath)
    writeFileSync(
      configPath,
      `import { defineConfig } from 'prisma/config'\n\n` +
        `export default defineConfig({\n` +
        `  schema: ${JSON.stringify(schemaPath)},\n` +
        `  migrations: { path: ${JSON.stringify(migrationsPath)} },\n` +
        `  datasource: { url: process.env.PRISMA_TEST_DATABASE_URL }\n` +
        `})\n`
    )

    try {
      await serverClient.connect()
      const provisionedRoles = await serverClient.query<{
        canBypassRls: boolean
        canCreateDatabase: boolean
        canCreateRole: boolean
        canLogin: boolean
        inherits: boolean
        isReplication: boolean
        isSuperuser: boolean
        membershipCount: number
        name: string
      }>(
        `SELECT role_record.rolname AS name,
           role_record.rolcanlogin AS "canLogin",
           role_record.rolinherit AS inherits,
           role_record.rolsuper AS "isSuperuser",
           role_record.rolcreatedb AS "canCreateDatabase",
           role_record.rolcreaterole AS "canCreateRole",
           role_record.rolreplication AS "isReplication",
           role_record.rolbypassrls AS "canBypassRls",
           (SELECT COUNT(*)::int FROM pg_auth_members AS membership
            WHERE membership.member = role_record.oid) AS "membershipCount"
         FROM pg_roles AS role_record
         WHERE role_record.rolname = ANY($1::text[]) ORDER BY role_record.rolname`,
        [
          [
            CANONICAL_MIGRATION_LOGIN,
            CANONICAL_APP_LOGIN,
            CANONICAL_AUTH_GATEWAY_LOGIN,
            CANONICAL_ERASURE_WORKER_LOGIN,
            LEGACY_APP_LOGIN
          ]
        ]
      )
      expect(provisionedRoles.rows).toEqual(
        [
          CANONICAL_APP_LOGIN,
          CANONICAL_AUTH_GATEWAY_LOGIN,
          CANONICAL_ERASURE_WORKER_LOGIN,
          LEGACY_APP_LOGIN,
          CANONICAL_MIGRATION_LOGIN
        ].map((name) => ({
          canBypassRls: false,
          canCreateDatabase: false,
          canCreateRole: false,
          canLogin: true,
          inherits: false,
          isReplication: false,
          isSuperuser: false,
          membershipCount: name === LEGACY_APP_LOGIN ? 0 : 1,
          name
        }))
      )
      expect(
        (
          await serverClient.query<{
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
             ORDER BY member_role.rolname`,
            [
              [
                CANONICAL_MIGRATION_LOGIN,
                CANONICAL_APP_LOGIN,
                CANONICAL_AUTH_GATEWAY_LOGIN,
                CANONICAL_ERASURE_WORKER_LOGIN
              ]
            ]
          )
        ).rows
      ).toEqual([
        {
          adminOption: false,
          grantedName: 'nihongo_app',
          inheritOption: false,
          memberName: CANONICAL_APP_LOGIN,
          setOption: true
        },
        {
          adminOption: false,
          grantedName: 'nihongo_auth_gateway',
          inheritOption: false,
          memberName: CANONICAL_AUTH_GATEWAY_LOGIN,
          setOption: true
        },
        {
          adminOption: false,
          grantedName: 'nihongo_erasure_worker',
          inheritOption: false,
          memberName: CANONICAL_ERASURE_WORKER_LOGIN,
          setOption: true
        },
        {
          adminOption: false,
          grantedName: MIGRATION_ROLE,
          inheritOption: false,
          memberName: CANONICAL_MIGRATION_LOGIN,
          setOption: true
        }
      ])
      const databaseState = await serverClient.query<{
        databaseAcl: unknown
        databaseOwner: string
        databaseOwnerOid: string
      }>(
        `SELECT COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'grantee', acl_entry.grantee::text,
             'grantor', acl_entry.grantor::text,
             'privilege', acl_entry.privilege_type,
             'isGrantable', acl_entry.is_grantable
           ) ORDER BY acl_entry.grantee, acl_entry.grantor,
             acl_entry.privilege_type, acl_entry.is_grantable)
           FROM pg_catalog.aclexplode(COALESCE(
             database_record.datacl,
             pg_catalog.acldefault('d', database_record.datdba)
           )) AS acl_entry
         ), '[]'::jsonb) AS "databaseAcl",
           database_record.datdba::text AS "databaseOwnerOid",
           owner_role.rolname AS "databaseOwner"
         FROM pg_catalog.pg_database AS database_record
         JOIN pg_catalog.pg_roles AS owner_role
           ON owner_role.oid = database_record.datdba
         WHERE database_record.datname = current_database()`
      )
      const databaseStateRow = databaseState.rows[0]
      if (
        !databaseStateRow ||
        databaseStateRow.databaseOwner !== MIGRATION_ROLE
      ) {
        throw new Error(
          'Phase 7 upgrade DB owner is not externally provisioned.'
        )
      }
      await adminClient.connect()
      expect(
        (
          await adminClient.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count
             FROM pg_catalog.pg_namespace WHERE nspname = $1`,
            [schemaName]
          )
        ).rows
      ).toEqual([{ count: 0 }])
      await adminClient.query(
        `CREATE SCHEMA ${quotedSchemaName}
         AUTHORIZATION ${quoteIdentifier(MIGRATION_ROLE)}`
      )
      return {
        adminClient,
        configPath,
        databaseAcl: databaseStateRow.databaseAcl,
        databaseName,
        databaseOwnerOid: databaseStateRow.databaseOwnerOid,
        databaseUrl: databaseUrl.toString(),
        legacyOwnerDatabaseUrl: legacyOwnerDatabaseUrl.toString(),
        migrationsPath,
        quotedSchemaName,
        schemaName,
        serverClient,
        temporaryDirectory
      }
    } catch (error: unknown) {
      await adminClient.end().catch(() => undefined)
      await serverClient.end().catch(() => undefined)
      rmSync(temporaryDirectory, { force: true, recursive: true })
      throw error
    }
  }

const deploy = async (
  context: IsolatedUpgradeSchema,
  databaseUrl = context.databaseUrl
): Promise<void> => {
  try {
    await execFileAsync(
      prismaBinary,
      ['migrate', 'deploy', '--config', context.configPath],
      {
        cwd: apiRoot,
        env: {
          ...process.env,
          ADMIN_CMS_MODE: 'technical',
          NODE_ENV: 'test',
          PRISMA_TEST_DATABASE_URL: databaseUrl
        },
        timeout: 60_000
      }
    )
  } catch (error: unknown) {
    const failedMigration = await context.serverClient
      .query<{ logs: string | null; migrationName: string }>(
        `SELECT migration_name AS "migrationName", logs
         FROM ${context.quotedSchemaName}."_prisma_migrations"
         WHERE finished_at IS NULL AND rolled_back_at IS NULL
         ORDER BY started_at DESC LIMIT 1`
      )
      .catch(() => undefined)
    if (failedMigration?.rows[0]) {
      const failedRow = failedMigration.rows[0]
      process.stdout.write(
        `${JSON.stringify({
          event: 'phase7.db.upgrade.migration_failed',
          ...failedRow
        })}\n`
      )
      if (
        PHASE7_MIGRATIONS.some(
          (migrationName) => migrationName === failedRow.migrationName
        )
      ) {
        const diagnosticClient = new Client({ connectionString: databaseUrl })
        try {
          await diagnosticClient.connect()
          await diagnosticClient.query(
            `SET search_path TO ${context.quotedSchemaName}`
          )
          const diagnosticState = await diagnosticClient.query<{
            currentSchema: string | null
            currentUser: string
            databaseAcl: unknown
            databaseOwner: string
            schemaOwner: string
            sessionUser: string
          }>(
            `SELECT current_schema() AS "currentSchema",
               current_user AS "currentUser", session_user AS "sessionUser",
               database_owner.rolname AS "databaseOwner",
               schema_owner.rolname AS "schemaOwner",
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                   'grantee', COALESCE(grantee_role.rolname, 'PUBLIC'),
                   'privilege', acl_entry.privilege_type,
                   'isGrantable', acl_entry.is_grantable
                 ) ORDER BY COALESCE(grantee_role.rolname, 'PUBLIC'),
                   acl_entry.privilege_type, acl_entry.is_grantable)
                 FROM pg_catalog.pg_database AS acl_database
                 CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
                   acl_database.datacl,
                   pg_catalog.acldefault('d', acl_database.datdba)
                 )) AS acl_entry
                 LEFT JOIN pg_catalog.pg_roles AS grantee_role
                   ON grantee_role.oid = acl_entry.grantee
                 WHERE acl_database.datname = current_database()
               ), '[]'::jsonb) AS "databaseAcl"
             FROM pg_catalog.pg_database AS database_record
             JOIN pg_catalog.pg_roles AS database_owner
               ON database_owner.oid = database_record.datdba
             JOIN pg_catalog.pg_namespace AS namespace
               ON namespace.nspname = current_schema()
             JOIN pg_catalog.pg_roles AS schema_owner
               ON schema_owner.oid = namespace.nspowner
             WHERE database_record.datname = current_database()`
          )
          process.stdout.write(
            `${JSON.stringify({
              event: 'phase7.db.upgrade.migration_replay_context',
              migrationName: failedRow.migrationName,
              state: diagnosticState.rows[0] ?? null
            })}\n`
          )
          await diagnosticClient.query(
            readFileSync(
              join(
                context.migrationsPath,
                failedRow.migrationName,
                'migration.sql'
              ),
              'utf8'
            )
          )
        } catch (diagnosticError: unknown) {
          const detail = diagnosticError as {
            code?: string
            message?: string
            position?: string
            where?: string
          }
          process.stdout.write(
            `${JSON.stringify({
              code: detail.code,
              event: 'phase7.db.upgrade.migration_replay_failed',
              message: detail.message,
              migrationName: failedRow.migrationName,
              position: detail.position,
              where: detail.where
            })}\n`
          )
        } finally {
          await diagnosticClient.query('ROLLBACK').catch(() => undefined)
          await diagnosticClient.end().catch(() => undefined)
        }
      }
    }
    throw error
  }
}

const readNonCanonicalTargetOwnerCount = async (
  context: IsolatedUpgradeSchema
): Promise<number> => {
  const result = await context.adminClient.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM (
       SELECT object_row.oid
       FROM pg_catalog.pg_class AS object_row
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = object_row.relnamespace
       JOIN pg_catalog.pg_roles AS owner_role
         ON owner_role.oid = object_row.relowner
       WHERE namespace.nspname = $1
         AND owner_role.rolname <> $2
         AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_depend AS dependency
           WHERE dependency.classid =
               'pg_catalog.pg_class'::pg_catalog.regclass
             AND dependency.objid = object_row.oid
             AND dependency.deptype = 'e'
         )
       UNION ALL
       SELECT object_row.oid
       FROM pg_catalog.pg_proc AS object_row
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = object_row.pronamespace
       JOIN pg_catalog.pg_roles AS owner_role
         ON owner_role.oid = object_row.proowner
       WHERE namespace.nspname = $1
         AND owner_role.rolname <> $2
         AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_depend AS dependency
           WHERE dependency.classid =
               'pg_catalog.pg_proc'::pg_catalog.regclass
             AND dependency.objid = object_row.oid
             AND dependency.deptype = 'e'
         )
       UNION ALL
       SELECT object_row.oid
       FROM pg_catalog.pg_type AS object_row
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = object_row.typnamespace
       JOIN pg_catalog.pg_roles AS owner_role
         ON owner_role.oid = object_row.typowner
       WHERE namespace.nspname = $1
         AND owner_role.rolname <> $2
         AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_depend AS dependency
           WHERE dependency.classid =
               'pg_catalog.pg_type'::pg_catalog.regclass
             AND dependency.objid = object_row.oid
             AND dependency.deptype = 'e'
         )
     ) AS noncanonical`,
    [context.schemaName, MIGRATION_ROLE]
  )
  return result.rows[0]?.count ?? -1
}

const transferPhase6TargetOwnership = async (
  context: IsolatedUpgradeSchema
): Promise<void> => {
  await context.adminClient.query(
    `DO $phase7_external_owner_transfer$
     DECLARE
       target_schema NAME := '${context.schemaName}'::NAME;
       object_row RECORD;
     BEGIN
       FOR object_row IN
         SELECT relation.relname, relation.relkind
         FROM pg_catalog.pg_class AS relation
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = relation.relnamespace
         JOIN pg_catalog.pg_roles AS owner_role
           ON owner_role.oid = relation.relowner
         WHERE namespace.nspname = target_schema
           AND owner_role.rolname <> 'nihongo_phase7_migration'
           AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
           AND NOT EXISTS (
             SELECT 1 FROM pg_catalog.pg_depend AS dependency
             WHERE dependency.classid =
                 'pg_catalog.pg_class'::pg_catalog.regclass
               AND dependency.objid = relation.oid
               AND dependency.deptype = 'e'
           )
         ORDER BY CASE relation.relkind
           WHEN 'r' THEN 1 WHEN 'p' THEN 1 WHEN 'v' THEN 2
           WHEN 'm' THEN 2 WHEN 'f' THEN 2 ELSE 3 END,
           relation.relname
       LOOP
         EXECUTE CASE object_row.relkind
           WHEN 'S' THEN pg_catalog.format(
             'ALTER SEQUENCE %I.%I OWNER TO nihongo_phase7_migration',
             target_schema, object_row.relname
           )
           WHEN 'v' THEN pg_catalog.format(
             'ALTER VIEW %I.%I OWNER TO nihongo_phase7_migration',
             target_schema, object_row.relname
           )
           WHEN 'm' THEN pg_catalog.format(
             'ALTER MATERIALIZED VIEW %I.%I OWNER TO nihongo_phase7_migration',
             target_schema, object_row.relname
           )
           WHEN 'f' THEN pg_catalog.format(
             'ALTER FOREIGN TABLE %I.%I OWNER TO nihongo_phase7_migration',
             target_schema, object_row.relname
           )
           ELSE pg_catalog.format(
             'ALTER TABLE %I.%I OWNER TO nihongo_phase7_migration',
             target_schema, object_row.relname
           )
         END;
       END LOOP;

       FOR object_row IN
         SELECT routine.proname, routine.prokind,
           pg_catalog.pg_get_function_identity_arguments(routine.oid)
             AS identity_arguments
         FROM pg_catalog.pg_proc AS routine
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = routine.pronamespace
         JOIN pg_catalog.pg_roles AS owner_role
           ON owner_role.oid = routine.proowner
         WHERE namespace.nspname = target_schema
           AND owner_role.rolname <> 'nihongo_phase7_migration'
           AND NOT EXISTS (
             SELECT 1 FROM pg_catalog.pg_depend AS dependency
             WHERE dependency.classid =
                 'pg_catalog.pg_proc'::pg_catalog.regclass
               AND dependency.objid = routine.oid
               AND dependency.deptype = 'e'
           )
         ORDER BY routine.oid
       LOOP
         EXECUTE pg_catalog.format(
           'ALTER %s %I.%I(%s) OWNER TO nihongo_phase7_migration',
           CASE object_row.prokind
             WHEN 'p' THEN 'PROCEDURE'
             WHEN 'a' THEN 'AGGREGATE'
             ELSE 'FUNCTION'
           END,
           target_schema, object_row.proname,
           object_row.identity_arguments
         );
       END LOOP;

       FOR object_row IN
         SELECT type_row.typname
         FROM pg_catalog.pg_type AS type_row
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = type_row.typnamespace
         JOIN pg_catalog.pg_roles AS owner_role
           ON owner_role.oid = type_row.typowner
         WHERE namespace.nspname = target_schema
           AND owner_role.rolname <> 'nihongo_phase7_migration'
           AND type_row.typrelid = 0
           AND type_row.typelem = 0
           AND type_row.typtype IN ('d', 'e', 'r', 'm')
           AND NOT EXISTS (
             SELECT 1 FROM pg_catalog.pg_depend AS dependency
             WHERE dependency.classid =
                 'pg_catalog.pg_type'::pg_catalog.regclass
               AND dependency.objid = type_row.oid
               AND dependency.deptype = 'e'
           )
         ORDER BY type_row.oid
       LOOP
         EXECUTE pg_catalog.format(
           'ALTER TYPE %I.%I OWNER TO nihongo_phase7_migration',
           target_schema, object_row.typname
         );
       END LOOP;
     END;
     $phase7_external_owner_transfer$`
  )
  expect(await readNonCanonicalTargetOwnerCount(context)).toBe(0)
}

const exercisePhase6LegacyCompatibility = async (
  context: IsolatedUpgradeSchema
): Promise<{
  client: Client
  outOfCapCreatedAt: Date
  outOfCapSessionId: string
  userId: string
}> => {
  await context.serverClient.query(
    `GRANT CONNECT ON DATABASE ${quoteIdentifier(context.databaseName)}
     TO ${quoteIdentifier(LEGACY_APP_LOGIN)}`
  )
  await context.adminClient.query(
    `GRANT USAGE ON SCHEMA ${context.quotedSchemaName}
     TO ${quoteIdentifier(LEGACY_APP_LOGIN)}`
  )
  await context.adminClient.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES
     IN SCHEMA ${context.quotedSchemaName}
     TO ${quoteIdentifier(LEGACY_APP_LOGIN)}`
  )
  await context.adminClient.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES
     IN SCHEMA ${context.quotedSchemaName}
     TO ${quoteIdentifier(LEGACY_APP_LOGIN)}`
  )
  const legacyEnumTypes = await context.adminClient.query<{ typeName: string }>(
    `SELECT type_value.typname AS "typeName"
     FROM pg_catalog.pg_type AS type_value
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = type_value.typnamespace
     WHERE namespace.nspname = $1
       AND type_value.typtype = 'e'
       AND type_value.typrelid = 0
     ORDER BY type_value.typname COLLATE "C"`,
    [context.schemaName]
  )
  for (const { typeName } of legacyEnumTypes.rows) {
    await context.adminClient.query(
      `GRANT USAGE ON TYPE ${context.quotedSchemaName}.${quoteIdentifier(typeName)}
       TO ${quoteIdentifier(LEGACY_APP_LOGIN)}`
    )
  }

  const legacyUrl = new URL(context.databaseUrl)
  legacyUrl.username = LEGACY_APP_LOGIN
  legacyUrl.password = decodeURIComponent(legacyCredentials.password)
  legacyUrl.searchParams.delete('schema')
  legacyUrl.searchParams.delete('options')
  const legacyClient = new Client({
    connectionString: legacyUrl.toString(),
    options: `-c search_path=${context.schemaName} -c TimeZone=UTC`
  })
  await legacyClient.connect()
  try {
    expect(
      (
        await legacyClient.query<{ migrationCount: number }>(
          `SELECT COUNT(*)::int AS "migrationCount"
           FROM "_prisma_migrations"
           WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
        )
      ).rows
    ).toEqual([{ migrationCount: 27 }])
    const question = await legacyClient.query<{ id: string }>(
      `SELECT "id" FROM "Question" ORDER BY "id" LIMIT 1`
    )
    const questionId = question.rows[0]?.id
    if (!questionId) {
      throw new Error('Phase 6 legacy learner question is unavailable.')
    }
    const userId = randomUUID()
    const sessionId = randomUUID()
    const sessionToken = `phase6-legacy-session-${randomUUID()}`
    const outOfCapSessionId = randomUUID()
    const outOfCapCreatedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    const outOfCapSessionToken = `phase6-out-of-cap-${randomUUID()}`
    await legacyClient.query('BEGIN')
    try {
      await legacyClient.query(
        `INSERT INTO "User" (
          "id", "name", "email", "emailVerified", "role", "targetLevel",
          "createdAt", "updatedAt"
        ) VALUES (
          $1, 'Phase 6 legacy learner', $2, true, 'USER', 'N5',
          clock_timestamp(), clock_timestamp()
        )`,
        [userId, `phase6-legacy-${randomUUID()}@example.test`]
      )
      await legacyClient.query(
        `INSERT INTO "Account" (
          "id", "accountId", "providerId", "userId", "password",
          "createdAt", "updatedAt"
        ) VALUES (
          $1, $2::uuid::text, 'credential', $2,
          'phase6-legacy-password-hash', clock_timestamp(), clock_timestamp()
        )`,
        [randomUUID(), userId]
      )
      await legacyClient.query(
        `UPDATE "User" SET "targetLevel" = 'N4', "updatedAt" = clock_timestamp()
         WHERE "id" = $1`,
        [userId]
      )
      await legacyClient.query(
        `INSERT INTO "Bookmark" ("id", "userId", "questionId", "createdAt")
         VALUES ($1, $2, $3, clock_timestamp())`,
        [randomUUID(), userId, questionId]
      )
      await legacyClient.query(
        `DELETE FROM "Bookmark" WHERE "userId" = $1 AND "questionId" = $2`,
        [userId, questionId]
      )
      await legacyClient.query(
        `INSERT INTO "Session" (
          "id", "expiresAt", "token", "createdAt", "updatedAt", "userId"
        ) VALUES (
          $1, clock_timestamp() + INTERVAL '1 day', $2,
          clock_timestamp(), clock_timestamp(), $3
        )`,
        [sessionId, sessionToken, userId]
      )
      expect(
        (
          await legacyClient.query<{ id: string }>(
            `DELETE FROM "Session" WHERE "token" = $1 RETURNING "id"`,
            [sessionToken]
          )
        ).rows
      ).toEqual([{ id: sessionId }])
      await legacyClient.query(
        `INSERT INTO "Session" (
          "id", "expiresAt", "token", "createdAt", "updatedAt", "userId"
        ) VALUES (
          $1, $2::timestamptz + INTERVAL '45 days', $3, $2, $2, $4
        )`,
        [outOfCapSessionId, outOfCapCreatedAt, outOfCapSessionToken, userId]
      )
      await legacyClient.query('COMMIT')
    } catch (error: unknown) {
      await legacyClient.query('ROLLBACK')
      throw error
    }
    return {
      client: legacyClient,
      outOfCapCreatedAt,
      outOfCapSessionId,
      userId
    }
  } catch (error: unknown) {
    await legacyClient.end().catch(() => undefined)
    throw error
  }
}

const dispose = async (
  context: IsolatedUpgradeSchema,
  additionalRoles: readonly string[] = []
): Promise<void> => {
  try {
    await context.adminClient.query(
      `DROP SCHEMA IF EXISTS ${context.quotedSchemaName} CASCADE`
    )
    expect(
      (
        await context.adminClient.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count
           FROM pg_catalog.pg_namespace WHERE nspname = $1`,
          [context.schemaName]
        )
      ).rows
    ).toEqual([{ count: 0 }])
    for (const roleName of additionalRoles) {
      await context.serverClient.query(
        `DROP ROLE IF EXISTS ${quoteIdentifier(roleName)}`
      )
    }
    expect(
      (
        await context.serverClient.query<{
          databaseAcl: unknown
          databaseOwnerOid: string
        }>(
          `SELECT COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'grantee', acl_entry.grantee::text,
               'grantor', acl_entry.grantor::text,
               'privilege', acl_entry.privilege_type,
               'isGrantable', acl_entry.is_grantable
             ) ORDER BY acl_entry.grantee, acl_entry.grantor,
               acl_entry.privilege_type, acl_entry.is_grantable)
             FROM pg_catalog.aclexplode(COALESCE(
               database_record.datacl,
               pg_catalog.acldefault('d', database_record.datdba)
             )) AS acl_entry
           ), '[]'::jsonb) AS "databaseAcl",
             database_record.datdba::text AS "databaseOwnerOid"
           FROM pg_catalog.pg_database AS database_record
           WHERE database_record.datname = $1`,
          [context.databaseName]
        )
      ).rows
    ).toEqual([
      {
        databaseAcl: context.databaseAcl,
        databaseOwnerOid: context.databaseOwnerOid
      }
    ])
  } finally {
    await context.adminClient.end().catch(() => undefined)
    await context.serverClient.end().catch(() => undefined)
    rmSync(context.temporaryDirectory, { force: true, recursive: true })
  }
}

const readLedger = async (
  context: IsolatedUpgradeSchema
): Promise<AppliedMigration[]> => {
  const result = await context.adminClient.query<AppliedMigration>(
    `SELECT migration_name AS "migrationName", checksum,
       finished_at AS "finishedAt", rolled_back_at AS "rolledBackAt", logs
     FROM ${context.quotedSchemaName}."_prisma_migrations"
     ORDER BY started_at`
  )
  return result.rows
}

const applyMigrationOnCurrentBackend = async ({
  client,
  migrationName,
  migrationSql
}: {
  client: Client
  migrationName: string
  migrationSql: string
}): Promise<void> => {
  const migrationId = randomUUID()
  const checksum = createHash('sha256')
    .update(migrationSql, 'utf8')
    .digest('hex')
  await client.query(
    `INSERT INTO "_prisma_migrations" (
       id, checksum, migration_name, started_at, applied_steps_count
     ) VALUES ($1, $2, $3, clock_timestamp(), 0)`,
    [migrationId, checksum, migrationName]
  )
  await client.query(migrationSql)
  const finalized = await client.query<{ id: string }>(
    `UPDATE "_prisma_migrations"
     SET finished_at = clock_timestamp(), applied_steps_count = 1
     WHERE id = $1 AND finished_at IS NULL AND rolled_back_at IS NULL
     RETURNING id`,
    [migrationId]
  )
  expect(finalized.rows).toEqual([{ id: migrationId }])
}

const verifyCanonicalMigrationLedgerAccess = async (
  context: IsolatedUpgradeSchema,
  expectedCount: number
): Promise<void> => {
  const canonicalUrl = new URL(context.databaseUrl)
  canonicalUrl.searchParams.delete('schema')
  canonicalUrl.searchParams.delete('options')
  const canonicalClient = new Client({
    connectionString: canonicalUrl.toString(),
    options:
      `-c search_path=${context.schemaName} -c TimeZone=UTC ` +
      `-c role=${MIGRATION_ROLE}`
  })
  await canonicalClient.connect()
  try {
    const backendBefore = await canonicalClient.query<{
      currentRole: string
      pid: number
      sessionUser: string
    }>(
      `SELECT pg_backend_pid() AS pid, current_user AS "currentRole",
         session_user AS "sessionUser"`
    )
    expect(backendBefore.rows).toEqual([
      {
        currentRole: MIGRATION_ROLE,
        pid: expect.any(Number),
        sessionUser: CANONICAL_MIGRATION_LOGIN
      }
    ])
    expect(
      (
        await canonicalClient.query<{
          canDelete: boolean
          canInsert: boolean
          canSelect: boolean
          canUpdate: boolean
          currentRole: string
          migrationCount: number
          sessionUser: string
        }>(
          `SELECT session_user AS "sessionUser", current_user AS "currentRole",
             has_table_privilege(
               current_user, format('%I.%I', current_schema(),
               '_prisma_migrations'), 'SELECT'
             ) AS "canSelect",
             has_table_privilege(
               current_user, format('%I.%I', current_schema(),
               '_prisma_migrations'), 'INSERT'
             ) AS "canInsert",
             has_table_privilege(
               current_user, format('%I.%I', current_schema(),
               '_prisma_migrations'), 'UPDATE'
             ) AS "canUpdate",
             has_table_privilege(
               current_user, format('%I.%I', current_schema(),
               '_prisma_migrations'), 'DELETE'
             ) AS "canDelete",
             (SELECT COUNT(*)::int FROM "_prisma_migrations"
              WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)
                AS "migrationCount"`
        )
      ).rows
    ).toEqual([
      {
        canDelete: false,
        canInsert: true,
        canSelect: true,
        canUpdate: true,
        currentRole: MIGRATION_ROLE,
        migrationCount: expectedCount,
        sessionUser: CANONICAL_MIGRATION_LOGIN
      }
    ])
    await canonicalClient.query('BEGIN')
    try {
      expect(
        (
          await canonicalClient.query<{ migrationName: string }>(
            `UPDATE "_prisma_migrations"
             SET logs = logs
             WHERE migration_name = (
               SELECT migration_name FROM "_prisma_migrations"
               WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
               ORDER BY started_at DESC LIMIT 1
             )
             RETURNING migration_name AS "migrationName"`
          )
        ).rows
      ).toHaveLength(1)
      await canonicalClient.query('COMMIT')
    } catch (error: unknown) {
      await canonicalClient.query('ROLLBACK')
      throw error
    }
    await canonicalClient.query('BEGIN')
    try {
      expect(
        (
          await canonicalClient.query<{ migrationCount: number }>(
            `SELECT COUNT(*)::int AS "migrationCount"
           FROM "_prisma_migrations"
           WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
          )
        ).rows
      ).toEqual([{ migrationCount: expectedCount }])
      await canonicalClient.query('COMMIT')
    } catch (error: unknown) {
      await canonicalClient.query('ROLLBACK')
      throw error
    }
    const backendAfter = await canonicalClient.query<{
      currentRole: string
      pid: number
      sessionUser: string
    }>(
      `SELECT pg_backend_pid() AS pid, current_user AS "currentRole",
         session_user AS "sessionUser"`
    )
    expect(backendAfter.rows).toEqual(backendBefore.rows)

    const reconnectedClient = new Client({
      connectionString: canonicalUrl.toString(),
      options:
        `-c search_path=${context.schemaName} -c TimeZone=UTC ` +
        `-c role=${MIGRATION_ROLE}`
    })
    await reconnectedClient.connect()
    try {
      const reconnected = await reconnectedClient.query<{
        currentRole: string
        migrationCount: number
        pid: number
        sessionUser: string
      }>(
        `SELECT pg_backend_pid() AS pid, current_user AS "currentRole",
           session_user AS "sessionUser",
           (SELECT COUNT(*)::int FROM "_prisma_migrations"
            WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)
             AS "migrationCount"`
      )
      expect(reconnected.rows).toEqual([
        {
          currentRole: MIGRATION_ROLE,
          migrationCount: expectedCount,
          pid: expect.any(Number),
          sessionUser: CANONICAL_MIGRATION_LOGIN
        }
      ])
      expect(reconnected.rows[0]?.pid).not.toBe(backendBefore.rows[0]?.pid)
    } finally {
      await reconnectedClient.end()
    }
  } finally {
    await canonicalClient.end()
  }
}

const expectTempSearchPathMigrationRejected = async ({
  context,
  expectedLedgerCount,
  migrationSql
}: {
  context: IsolatedUpgradeSchema
  expectedLedgerCount: number
  migrationSql: string
}): Promise<void> => {
  const canonicalUrl = new URL(context.databaseUrl)
  canonicalUrl.searchParams.delete('schema')
  canonicalUrl.searchParams.delete('options')
  const canonicalClient = new Client({
    connectionString: canonicalUrl.toString(),
    options:
      `-c search_path=${context.schemaName} -c TimeZone=UTC ` +
      `-c role=${MIGRATION_ROLE}`
  })
  await canonicalClient.connect()
  try {
    await canonicalClient.query(
      `CREATE TEMP TABLE phase7_search_path_probe (id integer)`
    )
    expect(
      (
        await canonicalClient.query<{
          isActualTempNamespace: boolean
          tempSchema: string
        }>(
          `SELECT namespace.nspname AS "tempSchema",
             namespace.oid = pg_my_temp_schema()
               AND namespace.nspname ~ '^pg_temp_[0-9]+$'
               AS "isActualTempNamespace"
           FROM pg_namespace AS namespace
           WHERE namespace.oid = pg_my_temp_schema()`
        )
      ).rows
    ).toEqual([
      {
        isActualTempNamespace: true,
        tempSchema: expect.stringMatching(/^pg_temp_[0-9]+$/u)
      }
    ])
    await canonicalClient.query(`SET search_path TO pg_temp, public`)
    let errorCode: unknown
    try {
      await canonicalClient.query(migrationSql)
    } catch (error: unknown) {
      errorCode = (error as { code?: unknown }).code
    }
    expect(['42501', '55000']).toContain(errorCode)
    await canonicalClient.query('ROLLBACK')
    await canonicalClient.query(
      `SET search_path TO ${context.quotedSchemaName}`
    )
    expect(await readLedger(context)).toHaveLength(expectedLedgerCount)
  } finally {
    await canonicalClient.query('ROLLBACK').catch(() => undefined)
    await canonicalClient.end()
  }
}

const expectExternalTargetDependencyRejected = async ({
  client: migrationClient,
  context,
  expectedLedgerCount,
  migrationSql
}: {
  client: Client
  context: IsolatedUpgradeSchema
  expectedLedgerCount: number
  migrationSql: string
}): Promise<void> => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 20)
  const externalSchema = `phase7_external_${suffix}`
  const triggerFunction = `phase7_external_trigger_${suffix}`
  const scalarFunction = `phase7_external_scalar_${suffix}`

  const expectRejected = async (): Promise<void> => {
    await expect(migrationClient.query(migrationSql)).rejects.toMatchObject({
      code: '42501'
    })
    await migrationClient.query('ROLLBACK')
    expect(await readLedger(context)).toHaveLength(expectedLedgerCount)
  }

  await context.adminClient.query(
    `CREATE SCHEMA ${quoteIdentifier(externalSchema)}`
  )
  try {
    await context.adminClient.query(
      `CREATE TABLE ${quoteIdentifier(externalSchema)}.probe (id integer)`
    )
    await context.adminClient.query(
      `CREATE FUNCTION ${context.quotedSchemaName}.${quoteIdentifier(triggerFunction)}()
       RETURNS trigger LANGUAGE plpgsql
       SET search_path = pg_catalog
       AS $function$ BEGIN RETURN NEW; END; $function$`
    )
    await context.adminClient.query(
      `ALTER FUNCTION ${context.quotedSchemaName}.${quoteIdentifier(triggerFunction)}()
       OWNER TO ${quoteIdentifier(MIGRATION_ROLE)}`
    )
    try {
      await context.adminClient.query(
        `CREATE TRIGGER ${quoteIdentifier(`phase7_external_${suffix}`)}
         BEFORE INSERT ON ${quoteIdentifier(externalSchema)}.probe
         FOR EACH ROW EXECUTE FUNCTION
         ${context.quotedSchemaName}.${quoteIdentifier(triggerFunction)}()`
      )
      await expectRejected()
    } finally {
      await context.adminClient.query(
        `DROP SCHEMA ${quoteIdentifier(externalSchema)} CASCADE`
      )
      await context.adminClient.query(
        `DROP FUNCTION ${context.quotedSchemaName}.${quoteIdentifier(triggerFunction)}()`
      )
    }

    await context.adminClient.query(
      `CREATE SCHEMA ${quoteIdentifier(externalSchema)}`
    )
    await context.adminClient.query(
      `CREATE FUNCTION ${context.quotedSchemaName}.${quoteIdentifier(scalarFunction)}()
       RETURNS integer LANGUAGE sql IMMUTABLE
       SET search_path = pg_catalog
       AS $function$ SELECT 1 $function$`
    )
    await context.adminClient.query(
      `ALTER FUNCTION ${context.quotedSchemaName}.${quoteIdentifier(scalarFunction)}()
       OWNER TO ${quoteIdentifier(MIGRATION_ROLE)}`
    )
    try {
      await context.adminClient.query(
        `CREATE VIEW ${quoteIdentifier(externalSchema)}.probe_view AS
         SELECT ${context.quotedSchemaName}.${quoteIdentifier(scalarFunction)}()
           AS value`
      )
      await expectRejected()
    } finally {
      await context.adminClient.query(
        `DROP SCHEMA ${quoteIdentifier(externalSchema)} CASCADE`
      )
      await context.adminClient.query(
        `DROP FUNCTION ${context.quotedSchemaName}.${quoteIdentifier(scalarFunction)}()`
      )
    }
  } finally {
    await context.adminClient
      .query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(externalSchema)} CASCADE`)
      .catch(() => undefined)
    await context.adminClient
      .query(
        `DROP FUNCTION IF EXISTS ${context.quotedSchemaName}.${quoteIdentifier(triggerFunction)}()`
      )
      .catch(() => undefined)
    await context.adminClient
      .query(
        `DROP FUNCTION IF EXISTS ${context.quotedSchemaName}.${quoteIdentifier(scalarFunction)}()`
      )
      .catch(() => undefined)
  }
}

const expectEventTriggerBoundaryRejected = async ({
  client: migrationClient,
  context,
  expectedLedgerCount,
  migrationSql
}: {
  client: Client
  context: IsolatedUpgradeSchema
  expectedLedgerCount: number
  migrationSql: string
}): Promise<void> => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 20)
  const eventTriggerName = `phase7_event_${suffix}`
  const eventFunctionName = `phase7_event_fn_${suffix}`
  const sentinelSequence = `phase7_event_seq_${suffix}`

  await context.adminClient.query(
    `CREATE SEQUENCE ${context.quotedSchemaName}.${quoteIdentifier(sentinelSequence)}`
  )
  await context.adminClient.query(
    `CREATE FUNCTION ${context.quotedSchemaName}.${quoteIdentifier(eventFunctionName)}()
     RETURNS event_trigger LANGUAGE plpgsql
     SET search_path = pg_catalog
     AS $function$
     BEGIN
       IF TG_TAG = 'CREATE FUNCTION' THEN
         PERFORM pg_catalog.nextval(
           '${context.schemaName}.${sentinelSequence}'::pg_catalog.regclass
         );
       END IF;
     END;
     $function$`
  )
  try {
    await context.adminClient.query(
      `CREATE EVENT TRIGGER ${quoteIdentifier(eventTriggerName)}
       ON ddl_command_end EXECUTE FUNCTION
       ${context.quotedSchemaName}.${quoteIdentifier(eventFunctionName)}()`
    )
    try {
      await expect(migrationClient.query(migrationSql)).rejects.toMatchObject({
        code: '42501'
      })
      await migrationClient.query('ROLLBACK')
      expect(await readLedger(context)).toHaveLength(expectedLedgerCount)
      expect(
        (
          await context.adminClient.query<{
            isCalled: boolean
            lastValue: string
          }>(
            `SELECT last_value::text AS "lastValue", is_called AS "isCalled"
             FROM ${context.quotedSchemaName}.${quoteIdentifier(sentinelSequence)}`
          )
        ).rows
      ).toEqual([{ isCalled: false, lastValue: '1' }])
    } finally {
      await context.adminClient.query(
        `DROP EVENT TRIGGER ${quoteIdentifier(eventTriggerName)}`
      )
    }
  } finally {
    await context.adminClient
      .query(
        `DROP FUNCTION IF EXISTS ${context.quotedSchemaName}.${quoteIdentifier(eventFunctionName)}()`
      )
      .catch(() => undefined)
    await context.adminClient
      .query(
        `DROP SEQUENCE IF EXISTS ${context.quotedSchemaName}.${quoteIdentifier(sentinelSequence)}`
      )
      .catch(() => undefined)
  }
}

const expectPublicReplicationParameterGrantAbsent = async (
  context: IsolatedUpgradeSchema
): Promise<void> => {
  expect(
    (
      await context.serverClient.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM pg_catalog.pg_parameter_acl AS parameter_acl
         CROSS JOIN LATERAL pg_catalog.aclexplode(parameter_acl.paracl)
           AS acl_entry
         WHERE parameter_acl.parname = 'session_replication_role'
           AND acl_entry.grantee = 0
           AND acl_entry.privilege_type = 'SET'`
      )
    ).rows
  ).toEqual([{ count: 0 }])
}

const readDirectUserForeignKeyActions = async (
  client: Client
): Promise<
  Array<{
    constraintName: string
    deleteAction: string
    tableName: string
    updateAction: string
  }>
> => {
  const constraints = await client.query<{
    constraintName: string
    deleteAction: string
    tableName: string
    updateAction: string
  }>(
    `SELECT constraint_record.conname AS "constraintName",
       child.relname AS "tableName",
       constraint_record.confdeltype::text AS "deleteAction",
       constraint_record.confupdtype::text AS "updateAction"
     FROM pg_constraint AS constraint_record
     JOIN pg_class AS child ON child.oid = constraint_record.conrelid
     JOIN pg_namespace AS namespace ON namespace.oid = child.relnamespace
     JOIN pg_class AS parent ON parent.oid = constraint_record.confrelid
     WHERE namespace.nspname = current_schema()
       AND parent.relname = 'User'
       AND constraint_record.conname = ANY($1::text[])
     ORDER BY child.relname`,
    [
      [
        'StudySession_userId_fkey',
        'Bookmark_userId_fkey',
        'WrongNote_userId_fkey',
        'IdempotencyRecord_userId_fkey'
      ]
    ]
  )
  return constraints.rows
}

const insertPhase6Question = async (
  client: Client,
  seed: QuestionAggregateSeed
): Promise<void> => {
  await client.query(
    `INSERT INTO "Question" (
      "id", "lifecycleStatus", "currentPublishedVersionId",
      "createdByUserId", "createdByLabelSnapshot", "createdAt", "updatedAt"
    ) VALUES ($1, 'ACTIVE', NULL, NULL, 'SYSTEM_SEED', $2, $2)`,
    [seed.questionId, new Date('2026-01-01T00:00:00.000Z')]
  )
  await client.query(
    `INSERT INTO "QuestionVersion" (
      "id", "questionId", "versionNumber", "status", "level", "subject",
      "questionType", "passage", "questionText", "correctOptionId",
      "explanationKo", "explanationJa", "difficulty", "sourceType",
      "rowVersion", "createdByUserId", "createdByLabelSnapshot",
      "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, 1, 'DRAFT', $3, $4, $5, $6, $7, NULL, $8, $9, $10,
      'ORIGINAL', 1, NULL, 'SYSTEM_SEED', $11, $11
    )`,
    [
      seed.versionId,
      seed.questionId,
      seed.level,
      seed.subject,
      seed.questionType,
      seed.passage,
      seed.questionText,
      seed.explanationKo,
      seed.explanationJa,
      seed.difficulty,
      new Date('2026-01-01T00:00:00.000Z')
    ]
  )
  for (const option of seed.options) {
    await client.query(
      `INSERT INTO "QuestionOption" (
        "id", "questionVersionId", "label", "text", "ordinal"
      ) VALUES ($1, $2, $3, $4, $5)`,
      [option.id, seed.versionId, option.label, option.text, option.ordinal]
    )
  }
  for (const tag of seed.tags) {
    await client.query(
      `INSERT INTO "QuestionVersionTag" (
        "id", "questionVersionId", "tagId", "labelSnapshot"
      ) VALUES ($1, $2, $3, $4)`,
      [tag.versionTagId, seed.versionId, tag.id, tag.label]
    )
  }
  await client.query(
    `UPDATE "QuestionVersion"
     SET "correctOptionId" = $1, "status" = 'PUBLISHED',
         "publishedAt" = $2, "updatedAt" = $2
     WHERE "id" = $3`,
    [seed.correctOptionId, new Date('2026-01-01T00:00:00.000Z'), seed.versionId]
  )
  await client.query(
    `UPDATE "Question"
     SET "currentPublishedVersionId" = $1, "updatedAt" = $2
     WHERE "id" = $3`,
    [seed.versionId, new Date('2026-01-01T00:00:00.000Z'), seed.questionId]
  )
}

const seedPhase6Catalog = async (
  client: Client
): Promise<SeedQuestionCatalogResult> => {
  const seeds = buildAllQuestionSeeds()
  const tags = new Map(
    seeds.flatMap(({ tags: questionTags }) =>
      questionTags.map((tag) => [tag.id, tag] as const)
    )
  )
  const timestamp = new Date('2026-01-01T00:00:00.000Z')

  await client.query('BEGIN')
  try {
    for (const tag of [...tags.values()].toSorted((left, right) =>
      left.id.localeCompare(right.id)
    )) {
      await client.query(
        `INSERT INTO "Tag" (
          "id", "label", "normalizedName", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $4)`,
        [tag.id, tag.label, tag.normalizedName, timestamp]
      )
    }
    for (const seed of seeds) {
      await insertPhase6Question(client, seed)
    }
    await client.query('COMMIT')
  } catch (error: unknown) {
    await client.query('ROLLBACK')
    throw error
  }

  return { insertedCount: seeds.length, verifiedCount: 0 }
}

const readPhase6ProjectionDigest = async (client: Client): Promise<string> => {
  const questions = await client.query(
    `SELECT "id", "lifecycleStatus"::text, "currentPublishedVersionId",
       "createdByUserId", "createdByLabelSnapshot"::text,
       "createdAt", "updatedAt", "archivedAt"
     FROM "Question" ORDER BY "id"`
  )
  const versions = await client.query(
    `SELECT "id", "questionId", "versionNumber", "status"::text,
       "level"::text, "subject"::text, "questionType"::text, "passage",
       "questionText", "correctOptionId", "explanationKo", "explanationJa",
       "difficulty"::text, "sourceType"::text, "rowVersion",
       "createdByUserId", "createdByLabelSnapshot"::text,
       "createdAt", "updatedAt", "publishedAt", "retiredAt"
     FROM "QuestionVersion" ORDER BY "id"`
  )
  const options = await client.query(
    `SELECT "id", "questionVersionId", "label", "text", "ordinal"
     FROM "QuestionOption" ORDER BY "id"`
  )
  const tags = await client.query(
    `SELECT "id", "label", "normalizedName", "createdAt", "updatedAt"
     FROM "Tag" ORDER BY "id"`
  )
  const assignments = await client.query(
    `SELECT "id", "questionVersionId", "tagId", "labelSnapshot"
     FROM "QuestionVersionTag" ORDER BY "id"`
  )
  return createHash('sha256')
    .update(
      JSON.stringify({
        assignments: assignments.rows,
        options: options.rows,
        questions: questions.rows,
        tags: tags.rows,
        versions: versions.rows
      })
    )
    .digest('hex')
}

const readPhase6SemanticDigest = async (client: Client): Promise<string> => {
  const result = await client.query<{ digest: string }>(
    `SELECT encode(public.digest(convert_to(jsonb_build_object(
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
    )::text, 'UTF8'), 'sha256'), 'hex') AS digest`
  )
  const digest = result.rows[0]?.digest
  if (!digest) throw new Error('Phase 6 semantic digest is unavailable.')
  return digest
}

describe('Phase 7 Slice 1 Phase 6 forward upgrade', () => {
  it('canonical non-super migration wrapper로 fresh 29개를 deploy하고 ledger를 finalize한다', async () => {
    const context = await createIsolatedUpgradeSchema()
    try {
      // The preceding activation coverage intentionally removes the legacy
      // wrapper's cluster-global CONNECT grant. A pristine pre-Phase-7 deploy
      // requires the canonical seven-entry migration ACL, so this isolated
      // fixture restores that one entry and removes it again during cleanup.
      await context.serverClient.query(
        `GRANT CONNECT ON DATABASE ${quoteIdentifier(context.databaseName)}
         TO ${quoteIdentifier(LEGACY_APP_LOGIN)}`
      )
      for (const migrationName of repositoryMigrationNames) {
        copyMigration(migrationName, context.migrationsPath)
      }
      await deploy(context)
      const ledger = await readLedger(context)
      expect(ledger).toHaveLength(29)
      expect(
        ledger.every(
          ({ finishedAt, logs, rolledBackAt }) =>
            finishedAt !== null && logs === null && rolledBackAt === null
        )
      ).toBe(true)
      expect(
        ledger
          .slice(-2)
          .every(
            ({ finishedAt, rolledBackAt }) =>
              finishedAt !== null && rolledBackAt === null
          )
      ).toBe(true)
      expect(() =>
        assertMigrationCompatibility(
          loadExpectedMigrationManifest(sourceMigrationsDirectory),
          ledger
        )
      ).not.toThrow()
      await verifyCanonicalMigrationLedgerAccess(context, 29)
      expect(
        (
          await context.adminClient.query<{
            databaseOwner: string
            ledgerOwner: string
            schemaOwner: string
          }>(
            `SELECT database_owner.rolname AS "databaseOwner",
               schema_owner.rolname AS "schemaOwner",
               ledger_owner.rolname AS "ledgerOwner"
             FROM pg_database AS database_record
             JOIN pg_roles AS database_owner
               ON database_owner.oid = database_record.datdba
             JOIN pg_namespace AS namespace
               ON namespace.nspname = $1
             JOIN pg_roles AS schema_owner
               ON schema_owner.oid = namespace.nspowner
             JOIN pg_class AS ledger
               ON ledger.relnamespace = namespace.oid
              AND ledger.relname = '_prisma_migrations'
             JOIN pg_roles AS ledger_owner ON ledger_owner.oid = ledger.relowner
             WHERE database_record.datname = current_database()`,
            [context.schemaName]
          )
        ).rows
      ).toEqual([
        {
          databaseOwner: MIGRATION_ROLE,
          ledgerOwner: 'nihongo_phase7_owner',
          schemaOwner: 'nihongo_phase7_owner'
        }
      ])
    } finally {
      await context.serverClient
        .query(
          `REVOKE CONNECT ON DATABASE ${quoteIdentifier(context.databaseName)}
           FROM ${quoteIdentifier(LEGACY_APP_LOGIN)}`
        )
        .catch(() => undefined)
      await dispose(context)
    }
  }, 180_000)

  it('canonical non-super wrapper로 65문항 upgrade를 27→29 byte/row parity로 배포한다', async () => {
    const context = await createIsolatedUpgradeSchema()
    const columnAclRogueRole = `phase7_column_acl_${randomUUID().replaceAll('-', '')}`
    let columnAclRogueCreated = false
    let phase6Legacy:
      | Awaited<ReturnType<typeof exercisePhase6LegacyCompatibility>>
      | undefined
    let sequentialMigrationClient: Client | undefined
    let sequentialMigrationBackend:
      | Array<{ currentRole: string; pid: number; sessionUser: string }>
      | undefined
    try {
      expect(repositoryMigrationNames).toHaveLength(29)
      expect(phase6MigrationNames).toHaveLength(27)
      expect(repositoryMigrationNames.slice(-2)).toEqual(PHASE7_MIGRATIONS)

      for (const migrationName of phase6MigrationNames) {
        copyMigration(migrationName, context.migrationsPath)
      }
      await deploy(context, context.legacyOwnerDatabaseUrl)
      expect(await readLedger(context)).toHaveLength(27)
      await context.adminClient.query(
        `SET search_path TO ${context.quotedSchemaName}`
      )
      await expect(seedPhase6Catalog(context.adminClient)).resolves.toEqual({
        insertedCount: 65,
        verifiedCount: 0
      })
      phase6Legacy = await exercisePhase6LegacyCompatibility(context)
      const beforeDigest = await readPhase6ProjectionDigest(context.adminClient)
      const semanticDigest = await readPhase6SemanticDigest(context.adminClient)
      expect(semanticDigest).toBe(PHASE6_SEMANTIC_DIGEST)
      process.stdout.write(
        `${JSON.stringify({
          event: 'phase7.db.upgrade.phase6_semantic_digest',
          digest: semanticDigest
        })}\n`
      )

      const enumSql = readFileSync(
        join(sourceMigrationsDirectory, PHASE7_MIGRATIONS[0], 'migration.sql'),
        'utf8'
      )
      const dirtyShapeUrl = new URL(context.databaseUrl)
      dirtyShapeUrl.searchParams.delete('schema')
      dirtyShapeUrl.searchParams.delete('options')
      const dirtyShapeClient = new Client({
        connectionString: dirtyShapeUrl.toString(),
        options:
          `-c search_path=${context.schemaName} -c TimeZone=UTC ` +
          `-c role=${MIGRATION_ROLE}`
      })
      await dirtyShapeClient.connect()
      try {
        expect(await readNonCanonicalTargetOwnerCount(context)).toBeGreaterThan(
          0
        )
        await expect(dirtyShapeClient.query(enumSql)).rejects.toMatchObject({
          code: '42501'
        })
        await dirtyShapeClient.query('ROLLBACK')
        expect(await readLedger(context)).toHaveLength(27)
        expect(
          (
            await context.adminClient.query<{ labels: string[] }>(
              `SELECT array_agg(enum_row.enumlabel
                 ORDER BY enum_row.enumsortorder)::text[] AS labels
               FROM pg_catalog.pg_type AS type_record
               JOIN pg_catalog.pg_namespace AS namespace
                 ON namespace.oid = type_record.typnamespace
               JOIN pg_catalog.pg_enum AS enum_row
                 ON enum_row.enumtypid = type_record.oid
               WHERE namespace.nspname = current_schema()
                 AND type_record.typname = 'QuestionVersionStatus'`
            )
          ).rows
        ).toEqual([{ labels: ['DRAFT', 'PUBLISHED', 'RETIRED'] }])

        await transferPhase6TargetOwnership(context)

        const expectEnumPrewriteRejected = async (
          expectedCodes: readonly string[] = ['42501']
        ): Promise<void> => {
          let errorCode: unknown
          try {
            await dirtyShapeClient.query(enumSql)
          } catch (error: unknown) {
            errorCode = (error as { code?: unknown }).code
          }
          expect(expectedCodes).toContain(errorCode)
          await dirtyShapeClient.query('ROLLBACK')
          expect(await readLedger(context)).toHaveLength(27)
          expect(
            (
              await context.adminClient.query<{ labels: string[] }>(
                `SELECT array_agg(enum_row.enumlabel
                   ORDER BY enum_row.enumsortorder)::text[] AS labels
                 FROM pg_catalog.pg_type AS type_record
                 JOIN pg_catalog.pg_namespace AS namespace
                   ON namespace.oid = type_record.typnamespace
                 JOIN pg_catalog.pg_enum AS enum_row
                   ON enum_row.enumtypid = type_record.oid
                 WHERE namespace.nspname = current_schema()
                   AND type_record.typname = 'QuestionVersionStatus'`
              )
            ).rows
          ).toEqual([{ labels: ['DRAFT', 'PUBLISHED', 'RETIRED'] }])
        }

        const inboundWrapperRogue = `phase7_inbound_${randomUUID().replaceAll('-', '')}`
        await context.serverClient.query(
          `CREATE ROLE ${quoteIdentifier(inboundWrapperRogue)}
           LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
           NOREPLICATION NOBYPASSRLS`
        )
        try {
          await context.serverClient.query(
            `GRANT ${quoteIdentifier(CANONICAL_MIGRATION_LOGIN)}
             TO ${quoteIdentifier(inboundWrapperRogue)}
             WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`
          )
          await expectEnumPrewriteRejected()
        } finally {
          await context.serverClient.query(
            `REVOKE ${quoteIdentifier(CANONICAL_MIGRATION_LOGIN)}
             FROM ${quoteIdentifier(inboundWrapperRogue)}`
          )
          await context.serverClient.query(
            `DROP ROLE ${quoteIdentifier(inboundWrapperRogue)}`
          )
        }

        await context.serverClient.query(
          `GRANT "nihongo_auth_gateway"
           TO "nihongo_development_app_login"
           WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`
        )
        try {
          await expectEnumPrewriteRejected()
        } finally {
          await context.serverClient.query(
            `REVOKE "nihongo_auth_gateway"
             FROM "nihongo_development_app_login"`
          )
        }

        await context.serverClient.query(
          `ALTER ROLE ${quoteIdentifier(CANONICAL_MIGRATION_LOGIN)}
           SET session_replication_role = replica`
        )
        try {
          const replicaClient = new Client({
            connectionString: dirtyShapeUrl.toString(),
            options:
              `-c search_path=${context.schemaName} -c TimeZone=UTC ` +
              `-c role=${MIGRATION_ROLE}`
          })
          await replicaClient.connect()
          try {
            let replicaErrorCode: unknown
            try {
              await replicaClient.query(enumSql)
            } catch (error: unknown) {
              replicaErrorCode = (error as { code?: unknown }).code
            }
            expect(replicaErrorCode).toBe('42501')
            await replicaClient.query('ROLLBACK')
          } finally {
            await replicaClient.end()
          }
          expect(await readLedger(context)).toHaveLength(27)
        } finally {
          await context.serverClient.query(
            `ALTER ROLE ${quoteIdentifier(CANONICAL_MIGRATION_LOGIN)}
             RESET session_replication_role`
          )
        }

        await expectPublicReplicationParameterGrantAbsent(context)
        await context.serverClient.query(
          `GRANT SET ON PARAMETER session_replication_role TO PUBLIC`
        )
        try {
          await expectEnumPrewriteRejected()
        } finally {
          await context.serverClient.query(
            `REVOKE SET ON PARAMETER session_replication_role FROM PUBLIC`
          )
          await expectPublicReplicationParameterGrantAbsent(context)
        }

        await expectExternalTargetDependencyRejected({
          client: dirtyShapeClient,
          context,
          expectedLedgerCount: 27,
          migrationSql: enumSql
        })

        await expectEventTriggerBoundaryRejected({
          client: dirtyShapeClient,
          context,
          expectedLedgerCount: 27,
          migrationSql: enumSql
        })

        const inheritedTableName = `phase7_inherit_${randomUUID().replaceAll('-', '')}`
        await context.adminClient.query(
          `CREATE TABLE ${quoteIdentifier(inheritedTableName)} ()
           INHERITS ("User")`
        )
        try {
          await expectEnumPrewriteRejected()
        } finally {
          await context.adminClient.query(
            `DROP TABLE ${quoteIdentifier(inheritedTableName)}`
          )
        }

        const publicationName = `phase7_pub_${randomUUID().replaceAll('-', '')}`
        await context.adminClient.query(
          `CREATE PUBLICATION ${quoteIdentifier(publicationName)}
           FOR TABLE "User"`
        )
        try {
          await expectEnumPrewriteRejected()
        } finally {
          await context.adminClient.query(
            `DROP PUBLICATION ${quoteIdentifier(publicationName)}`
          )
        }

        const internalTrigger = await context.adminClient.query<{
          name: string
          tableName: string
        }>(
          `SELECT trigger_row.tgname AS name,
             relation.relname AS "tableName"
           FROM pg_catalog.pg_trigger AS trigger_row
           JOIN pg_catalog.pg_class AS relation
             ON relation.oid = trigger_row.tgrelid
           JOIN pg_catalog.pg_namespace AS namespace
             ON namespace.oid = relation.relnamespace
           WHERE namespace.nspname = current_schema()
             AND trigger_row.tgisinternal
             AND trigger_row.tgconstraint <> 0
             AND trigger_row.tgenabled = 'O'
           ORDER BY relation.relname, trigger_row.tgname LIMIT 1`
        )
        const internalTriggerRow = internalTrigger.rows[0]
        if (!internalTriggerRow) {
          throw new Error('Phase 6 internal FK trigger fixture is unavailable.')
        }
        await context.adminClient.query(
          `ALTER TABLE ${quoteIdentifier(internalTriggerRow.tableName)}
           DISABLE TRIGGER ${quoteIdentifier(internalTriggerRow.name)}`
        )
        try {
          await expectEnumPrewriteRejected()
        } finally {
          await context.adminClient.query(
            `ALTER TABLE ${quoteIdentifier(internalTriggerRow.tableName)}
             ENABLE TRIGGER ${quoteIdentifier(internalTriggerRow.name)}`
          )
        }

        await context.adminClient.query(
          `ALTER TABLE "User" ADD COLUMN "phase7UnexpectedShape" text`
        )
        let dirtyShapeCode: unknown
        try {
          await dirtyShapeClient.query(enumSql)
        } catch (error: unknown) {
          dirtyShapeCode = (error as { code?: unknown }).code
        }
        expect(['42501', '55000']).toContain(dirtyShapeCode)
        await dirtyShapeClient.query('ROLLBACK')
      } finally {
        await dirtyShapeClient.query('ROLLBACK').catch(() => undefined)
        await dirtyShapeClient.end()
      }
      expect(await readLedger(context)).toHaveLength(27)
      expect(
        (
          await context.adminClient.query<{ labels: string[] }>(
            `SELECT array_agg(enum_row.enumlabel ORDER BY enum_row.enumsortorder)::text[]
               AS labels
             FROM pg_type AS type_record
             JOIN pg_namespace AS namespace
               ON namespace.oid = type_record.typnamespace
             JOIN pg_enum AS enum_row ON enum_row.enumtypid = type_record.oid
             WHERE namespace.nspname = current_schema()
               AND type_record.typname = 'QuestionVersionStatus'`
          )
        ).rows
      ).toEqual([{ labels: ['DRAFT', 'PUBLISHED', 'RETIRED'] }])
      await context.adminClient.query(
        `ALTER TABLE "User" DROP COLUMN "phase7UnexpectedShape"`
      )
      await expectTempSearchPathMigrationRejected({
        context,
        expectedLedgerCount: 27,
        migrationSql: enumSql
      })
      expect(
        (
          await context.adminClient.query<{ labels: string[] }>(
            `SELECT array_agg(enum_row.enumlabel ORDER BY enum_row.enumsortorder)::text[]
               AS labels
             FROM pg_type AS type_record
             JOIN pg_namespace AS namespace
               ON namespace.oid = type_record.typnamespace
             JOIN pg_enum AS enum_row ON enum_row.enumtypid = type_record.oid
             WHERE namespace.nspname = current_schema()
               AND type_record.typname = 'QuestionVersionStatus'`
          )
        ).rows
      ).toEqual([{ labels: ['DRAFT', 'PUBLISHED', 'RETIRED'] }])

      copyMigration(PHASE7_MIGRATIONS[0], context.migrationsPath)
      const sequentialMigrationUrl = new URL(context.databaseUrl)
      sequentialMigrationUrl.searchParams.delete('schema')
      sequentialMigrationUrl.searchParams.delete('options')
      const connectedSequentialMigrationClient = new Client({
        connectionString: sequentialMigrationUrl.toString(),
        options:
          `-c search_path=${context.schemaName} -c TimeZone=UTC ` +
          `-c role=${MIGRATION_ROLE}`
      })
      sequentialMigrationClient = connectedSequentialMigrationClient
      await connectedSequentialMigrationClient.connect()
      sequentialMigrationBackend = (
        await connectedSequentialMigrationClient.query<{
          currentRole: string
          pid: number
          sessionUser: string
        }>(
          `SELECT pg_backend_pid() AS pid, current_user AS "currentRole",
             session_user AS "sessionUser"`
        )
      ).rows
      expect(sequentialMigrationBackend).toEqual([
        {
          currentRole: MIGRATION_ROLE,
          pid: expect.any(Number),
          sessionUser: CANONICAL_MIGRATION_LOGIN
        }
      ])
      await applyMigrationOnCurrentBackend({
        client: connectedSequentialMigrationClient,
        migrationName: PHASE7_MIGRATIONS[0],
        migrationSql: enumSql
      })
      const enumLedger = await readLedger(context)
      expect(enumLedger).toHaveLength(28)
      expect(enumLedger.at(-1)).toMatchObject({
        finishedAt: expect.any(Date),
        migrationName: PHASE7_MIGRATIONS[0],
        rolledBackAt: null
      })
      expect(
        (
          await context.adminClient.query<{ labels: string[] }>(
            `SELECT array_agg(enum_row.enumlabel ORDER BY enum_row.enumsortorder)::text[]
               AS labels
             FROM pg_type AS type_record
             JOIN pg_namespace AS namespace
               ON namespace.oid = type_record.typnamespace
             JOIN pg_enum AS enum_row ON enum_row.enumtypid = type_record.oid
             WHERE namespace.nspname = current_schema()
               AND type_record.typname = 'QuestionVersionStatus'`
          )
        ).rows
      ).toEqual([
        {
          labels: [
            'DRAFT',
            'IN_REVIEW',
            'CHANGES_REQUESTED',
            'APPROVED',
            'PUBLISHED',
            'RETIRED'
          ]
        }
      ])

      const foundationSql = readFileSync(
        join(sourceMigrationsDirectory, PHASE7_MIGRATIONS[1], 'migration.sql'),
        'utf8'
      )
      await expectTempSearchPathMigrationRejected({
        context,
        expectedLedgerCount: 28,
        migrationSql: foundationSql
      })
      expect(
        (
          await context.adminClient.query<{
            contentReview: string | null
            operationIntent: string | null
          }>(
            `SELECT to_regclass('"ContentReview"')::text AS "contentReview",
               to_regclass('"Phase7OperationIntent"')::text
                 AS "operationIntent"`
          )
        ).rows
      ).toEqual([{ contentReview: null, operationIntent: null }])

      const expectFoundationPreflightRollback = async (
        expectedCode: '42501' | '55000' = '42501'
      ): Promise<void> => {
        await expect(
          connectedSequentialMigrationClient.query(foundationSql)
        ).rejects.toMatchObject({ code: expectedCode })
        await connectedSequentialMigrationClient.query('ROLLBACK')
        expect(await readLedger(context)).toHaveLength(28)
        expect(
          (
            await context.adminClient.query<{
              contentReview: string | null
              operationIntent: string | null
            }>(
              `SELECT to_regclass('"ContentReview"')::text
                   AS "contentReview",
                 to_regclass('"Phase7OperationIntent"')::text
                   AS "operationIntent"`
            )
          ).rows
        ).toEqual([{ contentReview: null, operationIntent: null }])
      }

      await context.serverClient.query(
        `GRANT "nihongo_auth_gateway"
         TO "nihongo_development_app_login"
         WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`
      )
      try {
        await expectFoundationPreflightRollback()
      } finally {
        await context.serverClient.query(
          `REVOKE "nihongo_auth_gateway"
           FROM "nihongo_development_app_login"`
        )
      }

      await expectPublicReplicationParameterGrantAbsent(context)
      await context.serverClient.query(
        `GRANT SET ON PARAMETER session_replication_role TO PUBLIC`
      )
      try {
        await expectFoundationPreflightRollback()
      } finally {
        await context.serverClient.query(
          `REVOKE SET ON PARAMETER session_replication_role FROM PUBLIC`
        )
        await expectPublicReplicationParameterGrantAbsent(context)
      }

      await expectExternalTargetDependencyRejected({
        client: connectedSequentialMigrationClient,
        context,
        expectedLedgerCount: 28,
        migrationSql: foundationSql
      })
      await expectEventTriggerBoundaryRejected({
        client: connectedSequentialMigrationClient,
        context,
        expectedLedgerCount: 28,
        migrationSql: foundationSql
      })

      await context.adminClient.query(
        `CREATE VIEW "Phase7RogueAuthView" AS
           SELECT "id", "email" FROM "User"`
      )
      await context.adminClient.query(
        `GRANT SELECT ON "Phase7RogueAuthView" TO PUBLIC, "nihongo_app"`
      )
      await expectFoundationPreflightRollback()
      await context.adminClient.query(`DROP VIEW "Phase7RogueAuthView"`)
      expect(
        (
          await context.adminClient.query<{ objectName: string | null }>(
            `SELECT to_regclass('"Phase7RogueAuthView"')::text
               AS "objectName"`
          )
        ).rows
      ).toEqual([{ objectName: null }])

      await context.adminClient.query(
        `CREATE MATERIALIZED VIEW "Phase7RogueAuthMaterializedView" AS
           SELECT "id", "email" FROM "User" WITH NO DATA`
      )
      await context.adminClient.query(
        `GRANT SELECT ON "Phase7RogueAuthMaterializedView"
         TO PUBLIC, "nihongo_app"`
      )
      await expectFoundationPreflightRollback()
      await context.adminClient.query(
        `DROP MATERIALIZED VIEW "Phase7RogueAuthMaterializedView"`
      )
      expect(
        (
          await context.adminClient.query<{ objectName: string | null }>(
            `SELECT to_regclass('"Phase7RogueAuthMaterializedView"')::text
               AS "objectName"`
          )
        ).rows
      ).toEqual([{ objectName: null }])

      await context.adminClient.query(
        `CREATE PROCEDURE "phase7_rogue_auth_procedure"()
         LANGUAGE plpgsql SECURITY DEFINER
         SET search_path = pg_catalog
         AS $$ BEGIN NULL; END; $$`
      )
      await context.adminClient.query(
        `GRANT EXECUTE ON PROCEDURE "phase7_rogue_auth_procedure"()
         TO PUBLIC, "nihongo_app"`
      )
      await expectFoundationPreflightRollback()
      await context.adminClient.query(
        `DROP PROCEDURE "phase7_rogue_auth_procedure"()`
      )
      expect(
        (
          await context.adminClient.query<{ objectName: string | null }>(
            `SELECT to_regprocedure('"phase7_rogue_auth_procedure"()')::text
               AS "objectName"`
          )
        ).rows
      ).toEqual([{ objectName: null }])

      await context.adminClient.query(
        `CREATE TRIGGER "Phase7RogueStudySessionTrigger"
         BEFORE UPDATE ON "StudySession" FOR EACH ROW
         EXECUTE FUNCTION "protect_study_session_created_at"()`
      )
      await expectFoundationPreflightRollback('55000')
      await context.adminClient.query(
        `DROP TRIGGER "Phase7RogueStudySessionTrigger" ON "StudySession"`
      )
      expect(
        (
          await context.adminClient.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM pg_trigger AS trigger_record
             JOIN pg_class AS relation
               ON relation.oid = trigger_record.tgrelid
             JOIN pg_namespace AS namespace
               ON namespace.oid = relation.relnamespace
             WHERE namespace.nspname = current_schema()
               AND trigger_record.tgname = 'Phase7RogueStudySessionTrigger'`
          )
        ).rows
      ).toEqual([{ count: 0 }])

      await context.adminClient.query(
        `CREATE RULE "Phase7RogueUserRule" AS
         ON UPDATE TO "User" DO ALSO NOTHING`
      )
      await expectFoundationPreflightRollback('55000')
      await context.adminClient.query(
        `DROP RULE "Phase7RogueUserRule" ON "User"`
      )
      expect(
        (
          await context.adminClient.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM pg_rewrite AS rewrite
             JOIN pg_class AS relation ON relation.oid = rewrite.ev_class
             JOIN pg_namespace AS namespace
               ON namespace.oid = relation.relnamespace
             WHERE namespace.nspname = current_schema()
               AND rewrite.rulename = 'Phase7RogueUserRule'`
          )
        ).rows
      ).toEqual([{ count: 0 }])

      if (!IDENTIFIER_PATTERN.test(columnAclRogueRole)) {
        throw new Error('Phase 7 column ACL rogue role is unsafe.')
      }
      await context.serverClient.query(
        `CREATE ROLE ${quoteIdentifier(columnAclRogueRole)}
         NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
         NOREPLICATION NOBYPASSRLS`
      )
      columnAclRogueCreated = true
      const columnAclPrincipals = [
        'PUBLIC',
        'nihongo_app',
        'nihongo_auth_gateway',
        'nihongo_erasure_worker',
        CANONICAL_MIGRATION_LOGIN,
        LEGACY_APP_LOGIN,
        columnAclRogueRole
      ]
        .map((roleName) =>
          roleName === 'PUBLIC' ? roleName : quoteIdentifier(roleName)
        )
        .join(', ')
      const columnAclTargets = [
        ['User', 'email'],
        ['Account', 'password'],
        ['Session', 'token'],
        ['Verification', 'value']
      ] as const
      try {
        for (const [tableName, columnName] of columnAclTargets) {
          await context.adminClient.query(
            `GRANT SELECT (${quoteIdentifier(columnName)}),
               UPDATE (${quoteIdentifier(columnName)})
             ON TABLE ${quoteIdentifier(tableName)} TO ${columnAclPrincipals}`
          )
        }
        await context.adminClient.query(
          `ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY`
        )
        await context.adminClient.query(
          `CREATE POLICY phase7_rogue_ledger_policy
           ON "_prisma_migrations" USING (true) WITH CHECK (true)`
        )
        await expectFoundationPreflightRollback('55000')
      } finally {
        await context.adminClient
          .query(
            `DROP POLICY IF EXISTS phase7_rogue_ledger_policy
             ON "_prisma_migrations"`
          )
          .catch(() => undefined)
        await context.adminClient
          .query(`ALTER TABLE "_prisma_migrations" DISABLE ROW LEVEL SECURITY`)
          .catch(() => undefined)
        for (const [tableName, columnName] of columnAclTargets) {
          await context.adminClient
            .query(
              `REVOKE SELECT (${quoteIdentifier(columnName)}),
                 UPDATE (${quoteIdentifier(columnName)})
               ON TABLE ${quoteIdentifier(tableName)}
               FROM ${columnAclPrincipals}`
            )
            .catch(() => undefined)
        }
      }
      expect(
        (
          await context.adminClient.query<{
            columnAclCount: number
            policyCount: number
            rowSecurity: boolean
          }>(
            `SELECT ledger.relrowsecurity AS "rowSecurity",
               (SELECT COUNT(*)::int FROM pg_catalog.pg_policy AS policy
                WHERE policy.polrelid = ledger.oid) AS "policyCount",
               (SELECT COUNT(*)::int
                FROM pg_catalog.pg_attribute AS attribute_record
                JOIN pg_catalog.pg_class AS auth_table
                  ON auth_table.oid = attribute_record.attrelid
                JOIN pg_catalog.pg_namespace AS auth_namespace
                  ON auth_namespace.oid = auth_table.relnamespace
                WHERE auth_namespace.nspname = current_schema()
                  AND auth_table.relname = ANY($1::text[])
                  AND attribute_record.attnum > 0
                  AND attribute_record.attacl IS NOT NULL
                  AND cardinality(attribute_record.attacl) > 0)
                 AS "columnAclCount"
             FROM pg_catalog.pg_class AS ledger
             JOIN pg_catalog.pg_namespace AS namespace
               ON namespace.oid = ledger.relnamespace
             WHERE namespace.nspname = current_schema()
               AND ledger.relname = '_prisma_migrations'`,
            [['User', 'Account', 'Session', 'Verification']]
          )
        ).rows
      ).toEqual([{ columnAclCount: 0, policyCount: 0, rowSecurity: false }])
      for (const protectedWrapper of [
        CANONICAL_MIGRATION_LOGIN,
        LEGACY_APP_LOGIN
      ]) {
        const inboundRogueRole = `phase7_inbound_${randomUUID().replaceAll('-', '')}`
        if (!IDENTIFIER_PATTERN.test(inboundRogueRole)) {
          throw new Error('Inbound wrapper membership fixture is unsafe.')
        }
        await context.serverClient.query(
          `CREATE ROLE ${quoteIdentifier(inboundRogueRole)}
           LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
           NOREPLICATION NOBYPASSRLS`
        )
        try {
          await context.serverClient.query(
            `GRANT ${quoteIdentifier(protectedWrapper)}
             TO ${quoteIdentifier(inboundRogueRole)}
             WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`
          )
          await expect(
            connectedSequentialMigrationClient.query(foundationSql)
          ).rejects.toMatchObject({ code: '42501' })
          await connectedSequentialMigrationClient.query('ROLLBACK')
          expect(await readLedger(context)).toHaveLength(28)
          expect(
            (
              await context.adminClient.query<{
                contentReview: string | null
              }>(
                `SELECT to_regclass('"ContentReview"')::text
                   AS "contentReview"`
              )
            ).rows
          ).toEqual([{ contentReview: null }])
        } finally {
          await context.adminClient.query('ROLLBACK').catch(() => undefined)
          await context.serverClient
            .query(
              `REVOKE ${quoteIdentifier(protectedWrapper)}
               FROM ${quoteIdentifier(inboundRogueRole)}`
            )
            .catch(() => undefined)
          await context.serverClient
            .query(`DROP ROLE IF EXISTS ${quoteIdentifier(inboundRogueRole)}`)
            .catch(() => undefined)
        }
      }
      const arbitraryCreatorRole = `phase7_creator_${randomUUID().replaceAll('-', '')}`
      const arbitraryCreatorPassword = randomUUID().replaceAll('-', '')
      if (
        !IDENTIFIER_PATTERN.test(arbitraryCreatorRole) ||
        !/^[a-f0-9]{32}$/u.test(arbitraryCreatorPassword)
      ) {
        throw new Error('Arbitrary CREATEROLE fixture is unsafe.')
      }
      await context.serverClient.query(
        `CREATE ROLE ${quoteIdentifier(arbitraryCreatorRole)}
         LOGIN NOINHERIT NOSUPERUSER NOCREATEDB CREATEROLE
         NOREPLICATION NOBYPASSRLS PASSWORD '${arbitraryCreatorPassword}'`
      )
      const arbitraryUrl = new URL(context.databaseUrl)
      arbitraryUrl.username = arbitraryCreatorRole
      arbitraryUrl.password = arbitraryCreatorPassword
      arbitraryUrl.searchParams.delete('schema')
      arbitraryUrl.searchParams.delete('options')
      const arbitraryClient = new Client({
        connectionString: arbitraryUrl.toString(),
        options:
          `-c search_path=${context.schemaName} -c TimeZone=UTC ` +
          `-c role=${MIGRATION_ROLE}`
      })
      try {
        await context.serverClient.query(
          `GRANT ${quoteIdentifier(MIGRATION_ROLE)}
           TO ${quoteIdentifier(arbitraryCreatorRole)}
           WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`
        )
        await context.serverClient.query(
          `GRANT CONNECT ON DATABASE ${quoteIdentifier(context.databaseName)}
           TO ${quoteIdentifier(arbitraryCreatorRole)}`
        )
        await arbitraryClient.connect()
        await expect(
          arbitraryClient.query(foundationSql)
        ).rejects.toMatchObject({ code: '42501' })
        await arbitraryClient.query('ROLLBACK')
        expect(await readLedger(context)).toHaveLength(28)
        expect(
          (
            await context.adminClient.query<{
              contentReview: string | null
              operationIntent: string | null
            }>(
              `SELECT to_regclass('"ContentReview"')::text AS "contentReview",
                 to_regclass('"Phase7OperationIntent"')::text
                   AS "operationIntent"`
            )
          ).rows
        ).toEqual([{ contentReview: null, operationIntent: null }])
      } finally {
        await arbitraryClient.end().catch(() => undefined)
        await context.serverClient
          .query(
            `REVOKE CONNECT ON DATABASE ${quoteIdentifier(context.databaseName)}
             FROM ${quoteIdentifier(arbitraryCreatorRole)}`
          )
          .catch(() => undefined)
        await context.serverClient
          .query(
            `REVOKE ${quoteIdentifier(MIGRATION_ROLE)}
             FROM ${quoteIdentifier(arbitraryCreatorRole)}`
          )
          .catch(() => undefined)
        await context.serverClient
          .query(`DROP ROLE IF EXISTS ${quoteIdentifier(arbitraryCreatorRole)}`)
          .catch(() => undefined)
      }

      const rogueRoleName = `phase7_rogue_${randomUUID().replaceAll('-', '')}`
      if (!/^phase7_rogue_[a-f0-9]{32}$/u.test(rogueRoleName)) {
        throw new Error('Rogue membership fixture role is unsafe.')
      }
      await context.adminClient.query(`CREATE ROLE "${rogueRoleName}" NOLOGIN`)
      try {
        await context.adminClient.query(
          `GRANT "nihongo_app" TO "${rogueRoleName}"`
        )
        await expect(
          connectedSequentialMigrationClient.query(foundationSql)
        ).rejects.toMatchObject({ code: '42501' })
        await connectedSequentialMigrationClient.query('ROLLBACK')
        expect(await readLedger(context)).toHaveLength(28)
        expect(
          (
            await context.adminClient.query<{ contentReview: string | null }>(
              `SELECT to_regclass('"ContentReview"')::text AS "contentReview"`
            )
          ).rows
        ).toEqual([{ contentReview: null }])
      } finally {
        await context.adminClient.query('ROLLBACK').catch(() => undefined)
        await context.adminClient
          .query(`REVOKE "nihongo_app" FROM "${rogueRoleName}"`)
          .catch(() => undefined)
        await context.adminClient
          .query(`DROP ROLE IF EXISTS "${rogueRoleName}"`)
          .catch(() => undefined)
      }

      const firstTag = buildAllQuestionSeeds()[0]?.tags[0]
      if (!firstTag) {
        throw new Error('Phase 7 upgrade drift fixture is unavailable.')
      }
      await context.adminClient.query(
        `UPDATE "Tag"
         SET "normalizedName" = "normalizedName" || '-upgrade-drift'
         WHERE "id" = $1`,
        [firstTag.id]
      )

      await expect(
        connectedSequentialMigrationClient.query(foundationSql)
      ).rejects.toMatchObject({ code: '23514' })
      await connectedSequentialMigrationClient.query('ROLLBACK')
      expect(await readLedger(context)).toHaveLength(28)
      expect(
        (
          await context.adminClient.query<{
            contentReviewTable: string | null
            fingerprintColumn: string | null
          }>(
            `SELECT
              to_regclass('"ContentReview"')::text AS "contentReviewTable",
              (
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'QuestionVersion'
                  AND column_name = 'contentFingerprint'
              ) AS "fingerprintColumn"`
          )
        ).rows
      ).toEqual([{ contentReviewTable: null, fingerprintColumn: null }])

      await context.adminClient.query(
        `UPDATE "Tag" SET "normalizedName" = $1 WHERE "id" = $2`,
        [firstTag.normalizedName, firstTag.id]
      )
      expect(await readPhase6ProjectionDigest(context.adminClient)).toBe(
        beforeDigest
      )

      copyMigration(PHASE7_MIGRATIONS[1], context.migrationsPath)
      await applyMigrationOnCurrentBackend({
        client: connectedSequentialMigrationClient,
        migrationName: PHASE7_MIGRATIONS[1],
        migrationSql: foundationSql
      })
      await connectedSequentialMigrationClient.query('BEGIN')
      try {
        expect(
          (
            await connectedSequentialMigrationClient.query<{
              migrationCount: number
            }>(
              `SELECT COUNT(*)::int AS "migrationCount"
               FROM "_prisma_migrations"
               WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
            )
          ).rows
        ).toEqual([{ migrationCount: 29 }])
        await connectedSequentialMigrationClient.query('COMMIT')
      } catch (error: unknown) {
        await connectedSequentialMigrationClient.query('ROLLBACK')
        throw error
      }
      expect(
        (
          await connectedSequentialMigrationClient.query<{
            currentRole: string
            pid: number
            sessionUser: string
          }>(
            `SELECT pg_backend_pid() AS pid, current_user AS "currentRole",
               session_user AS "sessionUser"`
          )
        ).rows
      ).toEqual(sequentialMigrationBackend)
      const finalLedger = await readLedger(context)
      expect(finalLedger).toHaveLength(29)
      expect(
        finalLedger
          .slice(-2)
          .every(
            ({ finishedAt, rolledBackAt }) =>
              finishedAt !== null && rolledBackAt === null
          )
      ).toBe(true)
      expect(() =>
        assertMigrationCompatibility(
          loadExpectedMigrationManifest(sourceMigrationsDirectory),
          finalLedger
        )
      ).not.toThrow()
      await verifyCanonicalMigrationLedgerAccess(context, 29)
      expect(
        await readDirectUserForeignKeyActions(context.adminClient)
      ).toEqual([
        {
          constraintName: 'Bookmark_userId_fkey',
          deleteAction: 'c',
          tableName: 'Bookmark',
          updateAction: 'a'
        },
        {
          constraintName: 'IdempotencyRecord_userId_fkey',
          deleteAction: 'c',
          tableName: 'IdempotencyRecord',
          updateAction: 'a'
        },
        {
          constraintName: 'StudySession_userId_fkey',
          deleteAction: 'c',
          tableName: 'StudySession',
          updateAction: 'a'
        },
        {
          constraintName: 'WrongNote_userId_fkey',
          deleteAction: 'c',
          tableName: 'WrongNote',
          updateAction: 'a'
        }
      ])
      expect(
        (
          await context.adminClient.query<{
            command: string
            name: string
            roles: string[]
          }>(
            `SELECT policyname AS name, cmd AS command, roles::text[] AS roles
             FROM pg_policies
             WHERE schemaname = current_schema()
               AND tablename = '_prisma_migrations'
             ORDER BY policyname`
          )
        ).rows
      ).toEqual([
        {
          command: 'SELECT',
          name: 'phase7_ledger_app_read',
          roles: ['nihongo_app']
        },
        {
          command: 'ALL',
          name: 'phase7_ledger_full_access',
          roles: ['nihongo_phase7_migration']
        },
        {
          command: 'SELECT',
          name: 'phase7_ledger_legacy_read',
          roles: [LEGACY_APP_LOGIN]
        }
      ])
      expect(
        (
          await context.adminClient.query<{
            columnAclCount: number
            forceRowSecurity: boolean
            rowSecurity: boolean
          }>(
            `SELECT ledger.relrowsecurity AS "rowSecurity",
               ledger.relforcerowsecurity AS "forceRowSecurity",
               (SELECT COUNT(*)::int
                FROM pg_attribute AS attribute_record
                JOIN pg_class AS auth_table
                  ON auth_table.oid = attribute_record.attrelid
                JOIN pg_namespace AS auth_namespace
                  ON auth_namespace.oid = auth_table.relnamespace
                WHERE auth_namespace.nspname = current_schema()
                  AND auth_table.relname = ANY($1::text[])
                  AND attribute_record.attnum > 0
                  AND attribute_record.attacl IS NOT NULL
                  AND cardinality(attribute_record.attacl) > 0)
                 AS "columnAclCount"
             FROM pg_class AS ledger
             JOIN pg_namespace AS namespace ON namespace.oid = ledger.relnamespace
             WHERE namespace.nspname = current_schema()
               AND ledger.relname = '_prisma_migrations'`,
            [['User', 'Account', 'Session', 'Verification']]
          )
        ).rows
      ).toEqual([
        { columnAclCount: 0, forceRowSecurity: false, rowSecurity: true }
      ])
      for (const deniedRole of [
        'nihongo_app',
        'nihongo_auth_gateway',
        'nihongo_erasure_worker',
        CANONICAL_MIGRATION_LOGIN,
        columnAclRogueRole
      ]) {
        await context.adminClient.query('BEGIN')
        try {
          await context.adminClient.query(
            `SET LOCAL ROLE ${quoteIdentifier(deniedRole)}`
          )
          await expect(
            context.adminClient.query(
              `SELECT "email" FROM ${context.quotedSchemaName}."User" LIMIT 1`
            )
          ).rejects.toMatchObject({ code: '42501' })
        } finally {
          await context.adminClient.query('ROLLBACK')
        }
        await context.adminClient.query('BEGIN')
        try {
          await context.adminClient.query(
            `SET LOCAL ROLE ${quoteIdentifier(deniedRole)}`
          )
          await expect(
            context.adminClient.query(
              `UPDATE ${context.quotedSchemaName}."User"
               SET "email" = "email" WHERE false`
            )
          ).rejects.toMatchObject({ code: '42501' })
        } finally {
          await context.adminClient.query('ROLLBACK')
        }
      }
      const legacyLedger = await phase6Legacy.client.query<AppliedMigration>(
        `SELECT migration_name AS "migrationName", checksum,
           finished_at AS "finishedAt", rolled_back_at AS "rolledBackAt", logs
         FROM "_prisma_migrations"
         ORDER BY started_at`
      )
      expect(legacyLedger.rows).toHaveLength(27)
      expect(() =>
        assertMigrationCompatibility(
          selectExpectedMigrationManifest(
            loadExpectedMigrationManifest(sourceMigrationsDirectory),
            'pre-phase7'
          ),
          legacyLedger.rows
        )
      ).not.toThrow()
      const absoluteLegacyExpiry = new Date(
        phase6Legacy.outOfCapCreatedAt.getTime() + 30 * 24 * 60 * 60 * 1000
      )
      expect(
        (
          await phase6Legacy.client.query<{
            createdAt: Date
            expiresAt: Date
            issuerProtocolVersion: string
          }>(
            `SELECT "createdAt", "expiresAt",
               "issuerProtocolVersion"::text AS "issuerProtocolVersion"
             FROM "Session" WHERE "id" = $1`,
            [phase6Legacy.outOfCapSessionId]
          )
        ).rows
      ).toEqual([
        {
          createdAt: phase6Legacy.outOfCapCreatedAt,
          expiresAt: absoluteLegacyExpiry,
          issuerProtocolVersion: 'LEGACY'
        }
      ])
      expect(
        (
          await phase6Legacy.client.query<{ expiresAt: Date }>(
            `UPDATE "Session"
             SET "expiresAt" = "createdAt" + INTERVAL '60 days',
                 "updatedAt" = clock_timestamp()
             WHERE "id" = $1 RETURNING "expiresAt"`,
            [phase6Legacy.outOfCapSessionId]
          )
        ).rows
      ).toEqual([{ expiresAt: absoluteLegacyExpiry }])
      await context.serverClient.query(
        `DROP ROLE ${quoteIdentifier(columnAclRogueRole)}`
      )
      columnAclRogueCreated = false
      const legacySessionId = randomUUID()
      const legacySessionToken = `phase7-upgraded-legacy-${randomUUID()}`
      await phase6Legacy.client.query(
        `INSERT INTO "Session" (
          "id", "expiresAt", "token", "createdAt", "updatedAt", "userId"
        ) VALUES (
          $1, clock_timestamp() + INTERVAL '1 day', $2,
          clock_timestamp(), clock_timestamp(), $3
        )`,
        [legacySessionId, legacySessionToken, phase6Legacy.userId]
      )
      expect(
        (
          await phase6Legacy.client.query<{ id: string }>(
            `DELETE FROM "Session" WHERE "token" = $1 RETURNING "id"`,
            [legacySessionToken]
          )
        ).rows
      ).toEqual([{ id: legacySessionId }])
      const retainedBookmarkId = randomUUID()
      const rejectedUserId = randomUUID()
      const retainedQuestionId = buildAllQuestionSeeds()[0]?.questionId
      if (!retainedQuestionId) {
        throw new Error('Phase 7 FK update fixture question is unavailable.')
      }
      await phase6Legacy.client.query('BEGIN')
      try {
        await phase6Legacy.client.query(
          `INSERT INTO "Bookmark" ("id", "userId", "questionId", "createdAt")
           VALUES ($1, $2, $3, clock_timestamp())`,
          [retainedBookmarkId, phase6Legacy.userId, retainedQuestionId]
        )
        await phase6Legacy.client.query('SAVEPOINT phase7_user_id_update')
        let userUpdateErrorCode: unknown
        try {
          await phase6Legacy.client.query(
            `UPDATE "User" SET "id" = $1 WHERE "id" = $2`,
            [rejectedUserId, phase6Legacy.userId]
          )
        } catch (error: unknown) {
          userUpdateErrorCode = (error as { code?: unknown }).code
        }
        expect(['23503', '23514']).toContain(userUpdateErrorCode)
        await phase6Legacy.client.query(
          'ROLLBACK TO SAVEPOINT phase7_user_id_update'
        )
        expect(
          (
            await phase6Legacy.client.query<{
              bookmarkUserId: string
              rejectedUserCount: number
              retainedUserCount: number
            }>(
              `SELECT bookmark."userId" AS "bookmarkUserId",
                 (SELECT COUNT(*)::int FROM "User" WHERE "id" = $2)
                   AS "retainedUserCount",
                 (SELECT COUNT(*)::int FROM "User" WHERE "id" = $3)
                   AS "rejectedUserCount"
               FROM "Bookmark" AS bookmark WHERE bookmark."id" = $1`,
              [retainedBookmarkId, phase6Legacy.userId, rejectedUserId]
            )
          ).rows
        ).toEqual([
          {
            bookmarkUserId: phase6Legacy.userId,
            rejectedUserCount: 0,
            retainedUserCount: 1
          }
        ])
        await phase6Legacy.client.query('ROLLBACK')
      } catch (error: unknown) {
        await phase6Legacy.client.query('ROLLBACK')
        throw error
      }
      expect(await readPhase6ProjectionDigest(context.adminClient)).toBe(
        beforeDigest
      )

      const parity = await context.adminClient.query<{
        applicabilityCount: number
        auditCount: number
        fingerprintMismatchCount: number
        optionCount: number
        questionCount: number
        reportCount: number
        reviewCount: number
        snapshotMismatchCount: number
        tagCount: number
        versionCount: number
        versionTagCount: number
      }>(
        `SELECT
          (SELECT COUNT(*)::int FROM "Question") AS "questionCount",
          (SELECT COUNT(*)::int FROM "QuestionVersion") AS "versionCount",
          (SELECT COUNT(*)::int FROM "QuestionOption") AS "optionCount",
          (SELECT COUNT(*)::int FROM "Tag") AS "tagCount",
          (SELECT COUNT(*)::int FROM "QuestionVersionTag") AS "versionTagCount",
          (SELECT COUNT(*)::int FROM "TagApplicability") AS "applicabilityCount",
          (SELECT COUNT(*)::int FROM "ContentReview") AS "reviewCount",
          (SELECT COUNT(*)::int FROM "AdminAuditLog") AS "auditCount",
          (SELECT COUNT(*)::int FROM "QuestionReport") AS "reportCount",
          (SELECT COUNT(*)::int FROM "QuestionVersion"
            WHERE "contentFingerprint" IS DISTINCT FROM
              "phase7_question_version_fingerprint"("id"))
            AS "fingerprintMismatchCount",
          (SELECT COUNT(*)::int
            FROM "QuestionVersionTag" AS assignment
            JOIN "Tag" AS tag ON tag."id" = assignment."tagId"
            WHERE assignment."labelSnapshot" <> tag."label"
               OR assignment."normalizedNameSnapshot" <> tag."normalizedName")
            AS "snapshotMismatchCount"`
      )
      expect(parity.rows).toEqual([
        {
          applicabilityCount: 127,
          auditCount: 0,
          fingerprintMismatchCount: 0,
          optionCount: 260,
          questionCount: 65,
          reportCount: 0,
          reviewCount: 0,
          snapshotMismatchCount: 0,
          tagCount: 108,
          versionCount: 65,
          versionTagCount: 130
        }
      ])
      const expectedFingerprints = buildAllQuestionSeeds()
        .map((seed) => ({
          contentFingerprint: createExpectedFingerprint(seed),
          id: seed.versionId
        }))
        .toSorted((left, right) => left.id.localeCompare(right.id))
      expect(
        (
          await context.adminClient.query<{
            contentFingerprint: string
            id: string
          }>(
            `SELECT "id", "contentFingerprint"
             FROM "QuestionVersion" ORDER BY "id"`
          )
        ).rows
      ).toEqual(expectedFingerprints)
      expect(
        (
          await context.adminClient.query<{ digest: string }>(
            `SELECT encode(public.digest(convert_to(string_agg(
               "id"::text || '|' || "contentFingerprint", E'\\n'
               ORDER BY "id"::text COLLATE "C"
             ), 'UTF8'), 'sha256'), 'hex') AS digest
             FROM "QuestionVersion"`
          )
        ).rows
      ).toEqual([
        {
          digest: createHash('sha256')
            .update(
              expectedFingerprints
                .map(
                  ({ contentFingerprint, id }) => `${id}|${contentFingerprint}`
                )
                .join('\n'),
              'utf8'
            )
            .digest('hex')
        }
      ])
    } finally {
      await sequentialMigrationClient?.end().catch(() => undefined)
      await phase6Legacy?.client.end().catch(() => undefined)
      await context.adminClient.query('ROLLBACK').catch(() => undefined)
      await context.serverClient
        .query(
          `REVOKE CONNECT ON DATABASE ${quoteIdentifier(context.databaseName)}
           FROM ${quoteIdentifier(LEGACY_APP_LOGIN)}`
        )
        .catch(() => undefined)
      await dispose(context, columnAclRogueCreated ? [columnAclRogueRole] : [])
    }
  }, 180_000)
})
