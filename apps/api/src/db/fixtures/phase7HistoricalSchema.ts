import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import type { ExpectStatic } from 'vitest'
import type { SeedQuestionCatalogResult } from '../../../prisma/seedQuestionCatalog.js'
import {
  buildQuestionAggregateSeed,
  type QuestionAggregateSeed
} from '../../../prisma/seed-data/buildQuestionSeed.js'
import { toStableSeedUuid } from '../../../prisma/seed-data/id.js'
import { n5Questions } from '../../../prisma/seed-data/questions/n5.js'
import { buildPhase6CanonicalSeeds } from './phase6CanonicalSeeds.js'
import {
  loadExpectedMigrationManifest,
  selectExpectedMigrationManifest
} from '../readiness.js'
import type { AppliedMigration } from '../readiness.js'

export const apiRoot = fileURLToPath(new URL('../../../', import.meta.url))
export const sourceMigrationsDirectory = join(apiRoot, 'prisma', 'migrations')
const prismaBinary = join(apiRoot, 'node_modules', '.bin', 'prisma')
const execFileAsync = promisify(execFile)

export const PHASE7_MIGRATIONS = [
  '20260827100000_phase7_admin_cms_enums',
  '20260827101000_phase7_admin_cms_foundation',
  '20260909120000_phase7_archive_empty_manifest_verifier',
  '20260916120000_phase7_reauthentication_foundation'
] as const
export interface IsolatedUpgradeSchema {
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

export const CANONICAL_MIGRATION_LOGIN = 'nihongo_test_phase7_migration_login'
const CANONICAL_APP_LOGIN = 'nihongo_test_app_login'
const CANONICAL_AUTH_GATEWAY_LOGIN = 'nihongo_test_auth_gateway_login'
const CANONICAL_ERASURE_WORKER_LOGIN = 'nihongo_test_erasure_worker_login'
export const LEGACY_APP_LOGIN = 'nihongo_test_legacy_app_login'
export const MIGRATION_ROLE = 'nihongo_phase7_migration'
export const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u

export const quoteIdentifier = (value: string): string => {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error('Unsafe Phase 7 canonical migration identifier.')
  }
  return `"${value}"`
}

export const withUpgradeSchema = (
  rawUrl: string,
  schemaName: string
): string => {
  const url = new URL(rawUrl)
  url.searchParams.set('schema', schemaName)
  url.searchParams.delete('options')
  return url.toString()
}

export const createPhase7HistoricalSchemaFixture = ({
  adminDatabaseUrl,
  legacyDatabaseUrl,
  migrationDatabaseUrl,
  expect
}: {
  readonly adminDatabaseUrl: string
  readonly legacyDatabaseUrl: string
  readonly migrationDatabaseUrl: string
  readonly expect: ExpectStatic
}) => {
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

  const readHistoricalMigrationProfile = () => {
    const historicalManifest = loadExpectedMigrationManifest(
      sourceMigrationsDirectory
    ).filter(
      ({ name }) => name <= '20260916120000_phase7_reauthentication_foundation'
    )
    const phase6Manifest = selectExpectedMigrationManifest(
      historicalManifest,
      'pre-phase7'
    )
    const historicalMigrationNames = historicalManifest.map(({ name }) => name)
    const phase6MigrationNames = phase6Manifest.map(({ name }) => name)
    expect(historicalMigrationNames).toHaveLength(31)
    expect(phase6MigrationNames).toHaveLength(27)
    expect(historicalMigrationNames.at(-1)).toBe(
      '20260916120000_phase7_reauthentication_foundation'
    )
    expect(phase6MigrationNames.at(-1)).toBe(
      '20260821152000_phase5_review_center_foundation'
    )
    expect(historicalMigrationNames.slice(27)).toEqual(PHASE7_MIGRATIONS)
    expect(
      createHash('sha256')
        .update(
          historicalManifest
            .map(({ name, checksum }) => `${name}|${checksum}`)
            .join('\n')
        )
        .digest('hex')
    ).toBe('bfc8de4352d180aec62e200f8b270b14e559484afb940d22615a4978ae47f487')
    expect(
      createHash('sha256')
        .update(
          phase6Manifest
            .map(({ name, checksum }) => `${name}|${checksum}`)
            .join('\n')
        )
        .digest('hex')
    ).toBe('a73db05d6895a4381c6a7ffb2752ea830eace3c9da43f76ed1fd3ce23d6f11ac')

    return {
      historicalManifest,
      historicalMigrationNames,
      phase6Manifest,
      phase6MigrationNames
    }
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
      const databaseName = decodeURIComponent(
        serverDatabaseUrl.pathname.slice(1)
      )
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
      $1, $2, 1, 'DRAFT', $3, $4, $5, $6, $7, $8, $9, $10, $11,
      'ORIGINAL', 1, NULL, 'SYSTEM_SEED', $12, $12
    )`,
      [
        seed.versionId,
        seed.questionId,
        seed.level,
        seed.subject,
        seed.questionType,
        seed.passage,
        seed.questionText,
        seed.correctOptionId,
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
      [
        seed.correctOptionId,
        new Date('2026-01-01T00:00:00.000Z'),
        seed.versionId
      ]
    )
    await client.query(
      `UPDATE "Question"
     SET "currentPublishedVersionId" = $1, "updatedAt" = $2
     WHERE "id" = $3`,
      [seed.versionId, new Date('2026-01-01T00:00:00.000Z'), seed.questionId]
    )
  }

  const seedCatalog = async (
    client: Client,
    seeds: readonly QuestionAggregateSeed[]
  ): Promise<SeedQuestionCatalogResult> => {
    const tags = new Map(
      seeds.flatMap(({ tags: questionTags }) =>
        questionTags.map((tag) => [tag.id, tag] as const)
      )
    )
    const timestamp = new Date('2026-01-01T00:00:00.000Z')

    await client.query('BEGIN')
    try {
      // The version precedes its options; Phase6 starts this FK as IMMEDIATE.
      await client.query(
        'SET CONSTRAINTS "QuestionVersion_id_correctOptionId_fkey" DEFERRED'
      )
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
  const seedPhase6Catalog = (
    client: Client
  ): Promise<SeedQuestionCatalogResult> =>
    seedCatalog(client, buildPhase6CanonicalSeeds())

  const seedReviewedRevision2Catalog = (
    client: Client
  ): Promise<SeedQuestionCatalogResult> => {
    // JLP-34 revision2 is the sole reviewed change in this historical cohort.
    const reviewed = n5Questions.find(({ id }) => id === 'n5-vocabulary-02')
    if (!reviewed) throw new Error('Reviewed revision2 seed is unavailable.')
    const revision2 = buildQuestionAggregateSeed(reviewed, toStableSeedUuid)
    if (revision2.versionId !== '9ca3de63-e0b6-45e4-85c7-0603b11e0ebc') {
      throw new Error('Reviewed revision2 seed identity drifted.')
    }
    return seedCatalog(
      client,
      buildPhase6CanonicalSeeds().map((seed) =>
        seed.legacyId === revision2.legacyId ? revision2 : seed
      )
    )
  }
  return {
    copyMigration,
    createIsolatedUpgradeSchema,
    deploy,
    dispose,
    readHistoricalMigrationProfile,
    readLedger,
    readNonCanonicalTargetOwnerCount,
    seedPhase6Catalog,
    seedReviewedRevision2Catalog,
    transferPhase6TargetOwnership
  }
}
