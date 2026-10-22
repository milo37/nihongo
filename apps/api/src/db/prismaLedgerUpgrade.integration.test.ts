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
  '20260821152000_phase5_review_center_foundation',
  '20260827100000_phase7_admin_cms_enums',
  '20260827101000_phase7_admin_cms_foundation',
  '20260909120000_phase7_archive_empty_manifest_verifier',
  '20260916120000_phase7_reauthentication_foundation'
] as const

const isPhase10CurrentSource =
  process.env.PHASE10_CURRENT_SOURCE_INTEGRATION === '1'
const requireEnvironmentValue = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Prisma ledger upgrade integration requires ${name}.`)
  }
  return value
}
const environment = isPhase10CurrentSource
  ? undefined
  : parseApiEnvironment(process.env)
const migrationDatabaseUrl = isPhase10CurrentSource
  ? requireEnvironmentValue('PHASE7_MIGRATION_DATABASE_URL')
  : environment!.DATABASE_URL
assertSafeTestDatabase({
  nodeEnvironment: process.env.NODE_ENV,
  databaseUrl: migrationDatabaseUrl,
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
    const databaseUrl = new URL(migrationDatabaseUrl)
    databaseUrl.searchParams.set('schema', schemaName)
    const adminClient = new Client({
      connectionString: migrationDatabaseUrl
    })
    let isConnected = false
    let databaseName: string | undefined
    let originalLegacyDirectConnect: boolean | undefined
    let operationError: unknown
    let operationFailed = false

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
          timeout: 60_000
        }
      )
    }

    try {
      await adminClient.connect()
      isConnected = true
      if (isPhase10CurrentSource) {
        const database = await adminClient.query<{ databaseName: string }>(
          `SELECT current_database() AS "databaseName"`
        )
        databaseName = database.rows[0]?.databaseName
        if (!databaseName || !/^[a-z0-9_]+_test$/u.test(databaseName)) {
          throw new Error(
            'Prisma ledger upgrade integration received an unsafe database.'
          )
        }
        const directConnect = await adminClient.query<{ granted: boolean }>(
          `SELECT EXISTS (
             SELECT 1
             FROM pg_database AS database_record
             CROSS JOIN LATERAL aclexplode(
               COALESCE(
                 database_record.datacl,
                 acldefault('d', database_record.datdba)
               )
             ) AS privilege_record
             JOIN pg_roles AS granted_role
               ON granted_role.oid = privilege_record.grantee
             WHERE database_record.datname = current_database()
               AND granted_role.rolname = 'nihongo_test_legacy_app_login'
               AND privilege_record.privilege_type = 'CONNECT'
               AND NOT privilege_record.is_grantable
           ) AS granted`
        )
        originalLegacyDirectConnect = directConnect.rows[0]?.granted ?? false
        if (!originalLegacyDirectConnect) {
          await adminClient.query(
            `GRANT CONNECT ON DATABASE "${databaseName}" TO "nihongo_test_legacy_app_login"`
          )
        }
      }
      await adminClient.query(
        isPhase10CurrentSource
          ? `CREATE SCHEMA ${quotedSchemaName} AUTHORIZATION "nihongo_phase7_migration"`
          : `CREATE SCHEMA ${quotedSchemaName}`
      )

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
           AND trigger.tgname IN (
             'QuestionVersion_validate_active_admin_creator',
             'QuestionVersion_validate_change'
           )
           AND NOT trigger.tgisinternal
         ORDER BY trigger.tgname`,
        [schemaName]
      )
      expect(triggers.rows).toEqual([
        { enabled: 'O', name: 'QuestionVersion_validate_change' }
      ])

      const indexes = await adminClient.query<{
        definition: string
        name: string
      }>(
        `SELECT indexname AS name, indexdef AS definition
         FROM pg_indexes
         WHERE schemaname = $1
           AND indexname IN (
             'Bookmark_questionId_id_idx',
             'Bookmark_userId_createdAt_id_idx',
             'Bookmark_userId_createdAt_questionId_idx',
             'Bookmark_userId_questionId_key',
             'Session_userId_issuerProtocolVersion_expiresAt_idx',
             'Session_userId_sessionFamilyId_expiresAt_idx',
             'Session_userId_sessionFamilyId_id_key',
             'StudySession_guest_level_subject_submittedAt_id_weakness_idx',
             'StudySession_userId_submittedAt_id_dashboard_idx',
             'StudySession_userId_level_subject_submittedAt_id_weakness_idx',
             'Verification_identifier_expiresAt_idx',
             'WrongNote_userId_status_id_questionId_daily_idx',
             'WrongNote_user_status_lastWrongAt_wrongCount_questionId_idx',
             'WrongNote_userId_wrongCount_lastWrongAt_id_idx'
           )
         ORDER BY indexname`,
        [schemaName]
      )
      expect(indexes.rows.map(({ name }) => name)).toEqual([
        'Bookmark_questionId_id_idx',
        'Bookmark_userId_createdAt_id_idx',
        'Bookmark_userId_createdAt_questionId_idx',
        'Bookmark_userId_questionId_key',
        'Session_userId_issuerProtocolVersion_expiresAt_idx',
        'Session_userId_sessionFamilyId_expiresAt_idx',
        'Session_userId_sessionFamilyId_id_key',
        'StudySession_guest_level_subject_submittedAt_id_weakness_idx',
        'StudySession_userId_level_subject_submittedAt_id_weakness_idx',
        'StudySession_userId_submittedAt_id_dashboard_idx',
        'Verification_identifier_expiresAt_idx',
        'WrongNote_userId_status_id_questionId_daily_idx',
        'WrongNote_userId_wrongCount_lastWrongAt_id_idx',
        'WrongNote_user_status_lastWrongAt_wrongCount_questionId_idx'
      ])
      const dashboardIndex = indexes.rows.find(
        ({ name }) =>
          name === 'StudySession_userId_submittedAt_id_dashboard_idx'
      )
      expect(dashboardIndex?.definition).toContain(
        '("userId", "submittedAt" DESC, id)'
      )
      expect(dashboardIndex?.definition).toContain(
        'WHERE (("userId" IS NOT NULL)'
      )
      expect(dashboardIndex?.definition).toMatch(
        /\(status = 'SUBMITTED'::(?:[a-z0-9_]+\.)?"StudySessionStatus"\)/u
      )
      expect(dashboardIndex?.definition).toContain(
        '("submittedAt" IS NOT NULL)'
      )
      expect(dashboardIndex?.definition).not.toMatch(/\bmode\b/u)
      const mostWrongIndex = indexes.rows.find(
        ({ name }) => name === 'WrongNote_userId_wrongCount_lastWrongAt_id_idx'
      )
      expect(mostWrongIndex?.definition).toContain(
        '("userId", "wrongCount" DESC, "lastWrongAt" DESC, id)'
      )
      const indexDefinitionByName = new Map(
        indexes.rows.map(({ definition, name }) => [name, definition])
      )
      expect(
        indexDefinitionByName.get(
          'StudySession_userId_level_subject_submittedAt_id_weakness_idx'
        )
      ).toContain('("userId", level, subject, "submittedAt" DESC, id)')
      expect(
        indexDefinitionByName.get(
          'StudySession_userId_level_subject_submittedAt_id_weakness_idx'
        )
      ).toMatch(
        /WHERE \(\("userId" IS NOT NULL\).*\(status = 'SUBMITTED'::(?:[a-z0-9_]+\.)?"StudySessionStatus"\).*\("submittedAt" IS NOT NULL\)/u
      )
      expect(
        indexDefinitionByName.get(
          'StudySession_guest_level_subject_submittedAt_id_weakness_idx'
        )
      ).toContain(
        '("guestPrincipalId", level, subject, "submittedAt" DESC, id)'
      )
      expect(
        indexDefinitionByName.get(
          'StudySession_guest_level_subject_submittedAt_id_weakness_idx'
        )
      ).toMatch(
        /WHERE \(\("guestPrincipalId" IS NOT NULL\).*\(status = 'SUBMITTED'::(?:[a-z0-9_]+\.)?"StudySessionStatus"\).*\("submittedAt" IS NOT NULL\)/u
      )
      expect(
        indexDefinitionByName.get(
          'WrongNote_user_status_lastWrongAt_wrongCount_questionId_idx'
        )
      ).toContain(
        '("userId", status, "lastWrongAt" DESC, "wrongCount" DESC, "questionId")'
      )
      expect(
        indexDefinitionByName.get(
          'WrongNote_userId_status_id_questionId_daily_idx'
        )
      ).toContain('("userId", status, id, "questionId")')
      expect(
        indexDefinitionByName.get('Bookmark_userId_questionId_key')
      ).toContain('("userId", "questionId")')
      expect(
        indexDefinitionByName.get('Bookmark_userId_createdAt_id_idx')
      ).toContain('("userId", "createdAt" DESC, id)')
      expect(
        indexDefinitionByName.get('Bookmark_userId_createdAt_questionId_idx')
      ).toContain('("userId", "createdAt" DESC, "questionId")')
      expect(indexDefinitionByName.get('Bookmark_questionId_id_idx')).toContain(
        '("questionId", id)'
      )

      const labelSnapshotConstraint = await adminClient.query<{
        definition: string
      }>(
        `SELECT pg_get_constraintdef(constraint_record.oid) AS definition
         FROM pg_constraint AS constraint_record
         JOIN pg_class AS relation
           ON relation.oid = constraint_record.conrelid
         JOIN pg_namespace AS namespace
           ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = $1
           AND relation.relname = 'QuestionVersionTag'
           AND constraint_record.conname =
             'QuestionVersionTag_label_snapshot_trimmed_check'`,
        [schemaName]
      )
      expect(labelSnapshotConstraint.rows).toEqual([
        { definition: 'CHECK (("labelSnapshot" = btrim("labelSnapshot")))' }
      ])

      await adminClient.query(`SET search_path TO ${quotedSchemaName}`)
      if (isPhase10CurrentSource) {
        await adminClient.query(`SET ROLE "nihongo_phase7_owner"`)
      }
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
      ).rejects.toMatchObject({
        code: '42501',
        message: 'An armed trusted Phase 7 operation intent is required.'
      })
      await expect(
        adminClient.query(
          `INSERT INTO "User" (
            "id", "name", "email", "emailVerified", "role",
            "accountStatus", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, true, 'USER', 'ACTIVE', now(), now())`,
          [randomUUID(), '가'.repeat(81), `ledger-${randomUUID()}@example.test`]
        )
      ).rejects.toMatchObject({
        code: '22001',
        message: 'value too long for type character varying(80)'
      })
    } catch (error: unknown) {
      operationError = error
      operationFailed = true
    }

    const cleanupErrors: unknown[] = []
    if (isConnected) {
      try {
        await adminClient.query('ROLLBACK').catch(() => undefined)
        if (isPhase10CurrentSource) {
          await adminClient.query(`SET ROLE "nihongo_phase7_migration"`)
          const owner = await adminClient.query<{ ownerName: string }>(
            `SELECT pg_get_userbyid(namespace.nspowner) AS "ownerName"
               FROM pg_namespace AS namespace
               WHERE namespace.nspname = $1`,
            [schemaName]
          )
          if (owner.rows[0]?.ownerName === 'nihongo_phase7_owner') {
            await adminClient.query(`SET ROLE "nihongo_phase7_owner"`)
          }
        }
        await adminClient.query(
          `DROP SCHEMA IF EXISTS ${quotedSchemaName} CASCADE`
        )
      } catch (error: unknown) {
        cleanupErrors.push(error)
      }
      if (isPhase10CurrentSource) {
        try {
          await adminClient.query(`SET ROLE "nihongo_phase7_migration"`)
          if (databaseName && originalLegacyDirectConnect !== undefined) {
            await adminClient.query(
              originalLegacyDirectConnect
                ? `GRANT CONNECT ON DATABASE "${databaseName}" TO "nihongo_test_legacy_app_login"`
                : `REVOKE CONNECT ON DATABASE "${databaseName}" FROM "nihongo_test_legacy_app_login"`
            )
          }
        } catch (error: unknown) {
          cleanupErrors.push(error)
        }
      }
      try {
        await adminClient.end()
      } catch (error: unknown) {
        cleanupErrors.push(error)
      }
    }
    rmSync(temporaryDirectory, { force: true, recursive: true })
    if (operationFailed && cleanupErrors.length > 0) {
      throw new AggregateError(
        [operationError, ...cleanupErrors],
        'Prisma ledger upgrade operation and cleanup failed.'
      )
    }
    if (operationFailed) throw operationError
    if (cleanupErrors.length === 1) throw cleanupErrors[0]
    if (cleanupErrors.length > 1) {
      throw new AggregateError(
        cleanupErrors,
        'Prisma ledger upgrade cleanup failed.'
      )
    }
  }, 180_000)
})
