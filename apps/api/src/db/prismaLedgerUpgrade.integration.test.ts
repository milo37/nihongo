import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { assertSafeTestDatabase } from './databaseTargetGuard.js'
import {
  assertMigrationCompatibility,
  loadExpectedMigrationManifest,
  type AppliedMigration
} from './readiness.js'

const execFileAsync = promisify(execFile)
const apiRoot = fileURLToPath(new URL('../../', import.meta.url))
const sourceMigrationsDirectory = join(apiRoot, 'prisma', 'migrations')
const prismaBinary = join(apiRoot, 'node_modules', '.bin', 'prisma')

const LEGACY_MIGRATIONS = [
  '20260812130000_phase3_operational_baseline',
  '20260814113000_phase3_question_catalog',
  '20260814120000_phase3_question_catalog_integrity',
  '20260814121000_phase3_seed_provenance_backfill'
] as const

const FORWARD_MIGRATIONS = [
  '20260814120500_phase3_seed_provenance_guard',
  '20260814122000_phase3_seed_provenance_constraints',
  '20260814123000_phase3_seed_provenance_guard_cleanup',
  '20260814130000_phase3_auth_guest_principal',
  '20260814131000_phase3_auth_integrity',
  '20260814132000_phase3_auth_invariants',
  '20260814140000_phase3_study_sessions',
  '20260814141000_phase3_study_session_fallback_semantics',
  '20260814142000_phase3_study_session_integrity',
  '20260814143000_phase3_study_session_identity_integrity',
  '20260814144000_phase3_study_session_existing_selection_guard'
] as const

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const copyMigration = (name: string, destination: string): void => {
  cpSync(join(sourceMigrationsDirectory, name), join(destination, name), {
    recursive: true
  })
}

describe('Prisma migration ledger upgrade', () => {
  it('1210 적용 DB에 out-of-order guard·contract·auth를 forward deploy한다', async () => {
    const schemaName = `slice1_ledger_${randomUUID().replaceAll('-', '')}`
    const quotedSchemaName = `"${schemaName}"`
    const temporaryDirectory = mkdtempSync(join(apiRoot, '.migration-ledger-'))
    const temporaryMigrations = join(temporaryDirectory, 'migrations')
    const temporarySchema = join(temporaryDirectory, 'schema.prisma')
    const temporaryConfig = join(temporaryDirectory, 'prisma.config.ts')
    const databaseUrl = new URL(environment.DATABASE_URL)
    databaseUrl.searchParams.set('schema', schemaName)
    const adminClient = new Client({
      connectionString: environment.DATABASE_URL
    })
    let isConnected = false

    mkdirSync(temporaryMigrations)
    copyFileSync(
      join(sourceMigrationsDirectory, 'migration_lock.toml'),
      join(temporaryMigrations, 'migration_lock.toml')
    )
    copyFileSync(join(apiRoot, 'prisma', 'schema.prisma'), temporarySchema)
    writeFileSync(
      temporaryConfig,
      `import { defineConfig } from 'prisma/config'\n\n` +
        `export default defineConfig({\n` +
        `  schema: ${JSON.stringify(temporarySchema)},\n` +
        `  migrations: { path: ${JSON.stringify(temporaryMigrations)} },\n` +
        `  datasource: { url: process.env.PRISMA_TEST_DATABASE_URL }\n` +
        `})\n`
    )

    const deploy = async (): Promise<void> => {
      await execFileAsync(
        prismaBinary,
        ['migrate', 'deploy', '--config', temporaryConfig],
        {
          cwd: apiRoot,
          env: {
            ...process.env,
            NODE_ENV: 'test',
            PRISMA_TEST_DATABASE_URL: databaseUrl.toString()
          },
          timeout: 30_000
        }
      )
    }

    try {
      await adminClient.connect()
      isConnected = true
      await adminClient.query(`CREATE SCHEMA ${quotedSchemaName}`)

      for (const migration of LEGACY_MIGRATIONS) {
        copyMigration(migration, temporaryMigrations)
      }
      await deploy()

      const legacyLedger = await adminClient.query<{
        migrationName: string
      }>(
        `SELECT migration_name AS "migrationName"
         FROM ${quotedSchemaName}."_prisma_migrations"
         WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
      )
      expect(
        new Set(legacyLedger.rows.map(({ migrationName }) => migrationName))
      ).toEqual(new Set(LEGACY_MIGRATIONS))

      for (const migration of FORWARD_MIGRATIONS) {
        copyMigration(migration, temporaryMigrations)
      }
      await deploy()

      const ledger = await adminClient.query<
        AppliedMigration & {
          startedAt: Date
        }
      >(
        `SELECT
          migration_name AS "migrationName",
          checksum,
          finished_at AS "finishedAt",
          rolled_back_at AS "rolledBackAt",
          logs,
          started_at AS "startedAt"
         FROM ${quotedSchemaName}."_prisma_migrations"
         ORDER BY started_at`
      )
      const expected = loadExpectedMigrationManifest(sourceMigrationsDirectory)

      expect(() =>
        assertMigrationCompatibility(expected, ledger.rows)
      ).not.toThrow()

      const backfill = ledger.rows.find(
        ({ migrationName }) =>
          migrationName === '20260814121000_phase3_seed_provenance_backfill'
      )
      const lateGuard = ledger.rows.find(
        ({ migrationName }) =>
          migrationName === '20260814120500_phase3_seed_provenance_guard'
      )

      expect(backfill).toBeDefined()
      expect(lateGuard).toBeDefined()
      expect(lateGuard!.startedAt.getTime()).toBeGreaterThan(
        backfill!.startedAt.getTime()
      )

      const triggers = await adminClient.query<{
        enabled: string
        name: string
      }>(
        `SELECT trigger.tgenabled AS enabled, trigger.tgname AS name
         FROM pg_trigger AS trigger
         JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
         JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = $1
           AND relation.relname = 'QuestionVersion'
           AND trigger.tgname LIKE 'QuestionVersion_validate%'
           AND NOT trigger.tgisinternal
         ORDER BY trigger.tgname`,
        [schemaName]
      )
      expect(triggers.rows).toEqual([
        {
          enabled: 'O',
          name: 'QuestionVersion_validate_active_admin_creator'
        },
        { enabled: 'O', name: 'QuestionVersion_validate_change' }
      ])

      const indexes = await adminClient.query<{ name: string }>(
        `SELECT indexname AS name
         FROM pg_indexes
         WHERE schemaname = $1
           AND indexname IN (
             'Session_userId_expiresAt_idx',
             'Verification_identifier_expiresAt_idx'
           )
         ORDER BY indexname`,
        [schemaName]
      )
      expect(indexes.rows).toEqual([
        { name: 'Session_userId_expiresAt_idx' },
        { name: 'Verification_identifier_expiresAt_idx' }
      ])

      await adminClient.query(`SET search_path TO ${quotedSchemaName}`)
      const userId = randomUUID()
      await adminClient.query(
        `INSERT INTO "User" (
          "id", "name", "email", "emailVerified", "role",
          "accountStatus", "createdAt", "updatedAt"
        ) VALUES ($1, '일반 사용자', $2, true, 'USER', 'ACTIVE', now(), now())`,
        [userId, `ledger-${randomUUID()}@example.test`]
      )
      await expect(
        adminClient.query(
          `INSERT INTO "Question" (
            "id", "lifecycleStatus", "createdByUserId",
            "createdByLabelSnapshot", "createdAt", "updatedAt"
          ) VALUES ($1, 'ACTIVE', $2, 'ACTIVE_ADMIN', now(), now())`,
          [randomUUID(), userId]
        )
      ).rejects.toMatchObject({ code: '23514' })
      await expect(
        adminClient.query(
          `INSERT INTO "User" (
            "id", "name", "email", "emailVerified", "role",
            "accountStatus", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, true, 'USER', 'ACTIVE', now(), now())`,
          [randomUUID(), '가'.repeat(81), `ledger-${randomUUID()}@example.test`]
        )
      ).rejects.toMatchObject({ code: '22001' })
    } finally {
      if (isConnected) {
        try {
          await adminClient.query(
            `DROP SCHEMA IF EXISTS ${quotedSchemaName} CASCADE`
          )
        } finally {
          await adminClient.end()
        }
      }
      rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  }, 30_000)
})
