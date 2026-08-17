import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
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
const slice4Migrations = [
  '20260815100000_phase3_study_submission_facts',
  '20260815101000_phase3_study_submission_integrity',
  '20260815102000_phase3_wrong_note_latest_wrong_integrity',
  '20260815103000_phase3_submission_retention_history_integrity'
] as const
const slice5Migrations = [
  '20260816130000_phase3_wrong_note_dashboard_read_indexes'
] as const
const approvedPriorMigrationSha256 = {
  '20260812130000_phase3_operational_baseline':
    '1f87c37afd796fd68b0af03e9ed46e67a54ad3718207da66989c3b09cc036351',
  '20260814113000_phase3_question_catalog':
    '843b172300782f4cb06891b9058c3ba945ac9d10aa0c0073b9bc5c49badcbbe1',
  '20260814120000_phase3_question_catalog_integrity':
    'fbf91a5d8f9fa86182e5cfe827cc37a1341a571f640dca433d44a950c804b831',
  '20260814120500_phase3_seed_provenance_guard':
    'eda2ff366b7cc5f4c6e0a8d76535873f4ff0261f8d89084d7ca31c94da95cb00',
  '20260814121000_phase3_seed_provenance_backfill':
    '87eaff26c97f9d9c6a542d515048b6f7843af82ecf8956a51a0ec55834856210',
  '20260814122000_phase3_seed_provenance_constraints':
    '061f7631625a221da7b706e8f059dc79e5e721beca48ae51a81a7ae5966d3af2',
  '20260814123000_phase3_seed_provenance_guard_cleanup':
    'd39e9e94225feadb71a46366edce3e56656b15e86231819b85da4a0cca9b80da',
  '20260814130000_phase3_auth_guest_principal':
    '96375b88348e5f3c75da295fa608816b32fc818369b96fbbfc6007a96b1439fc',
  '20260814131000_phase3_auth_integrity':
    'ccf9a201104f5371ad61e150fdb37ed9fa033834edb293081f4743ba05648de7',
  '20260814132000_phase3_auth_invariants':
    'ede39c4c6a0e4bbf9f6487fa0149bb35705eb3dc6b20678c6777179e5f0a5dd1',
  '20260814140000_phase3_study_sessions':
    '6697f4a7b9253357cfa6281c3ccccde4b463d7f189a3c4d8c3912405a410a463',
  '20260814141000_phase3_study_session_fallback_semantics':
    '5e9e8cfafe17403f2009a5e3db042fec485fce0ce2b8b71afbbecefadb16c405',
  '20260814142000_phase3_study_session_integrity':
    '15e65ece09afdc142a63ab25ba3b6e88a48c7d8b58c7626ccbe6f5d2aab32629',
  '20260814143000_phase3_study_session_identity_integrity':
    'a96aec5f2845bc0ca6ecbc0f658da4a4967fe835578af7a1c77c3e328181773b',
  '20260814144000_phase3_study_session_existing_selection_guard':
    '07662a88c6f31893c25a288c16d172f8cee635e8acc186b4c6a1c5d7088fc336'
} as const
const migrationNames = readdirSync(sourceMigrationsDirectory, {
  withFileTypes: true
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted()
const priorMigrationNames = migrationNames.filter(
  (name) =>
    !slice4Migrations.includes(name as (typeof slice4Migrations)[number]) &&
    !slice5Migrations.includes(name as (typeof slice5Migrations)[number])
)

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

interface IsolatedMigrationSchema {
  readonly adminClient: Client
  readonly configPath: string
  readonly databaseUrl: string
  readonly migrationsPath: string
  readonly quotedSchemaName: string
  readonly schemaName: string
  readonly temporaryDirectory: string
}

const createIsolatedMigrationSchema =
  async (): Promise<IsolatedMigrationSchema> => {
    const schemaName = `slice4_upgrade_${randomUUID().replaceAll('-', '')}`
    const quotedSchemaName = `"${schemaName}"`
    const temporaryDirectory = mkdtempSync(join(apiRoot, '.migration-slice4-'))
    const migrationsPath = join(temporaryDirectory, 'migrations')
    const schemaPath = join(temporaryDirectory, 'schema.prisma')
    const configPath = join(temporaryDirectory, 'prisma.config.ts')
    const databaseUrl = new URL(environment.DATABASE_URL)
    databaseUrl.searchParams.set('schema', schemaName)
    const adminClient = new Client({
      connectionString: environment.DATABASE_URL
    })

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

    await adminClient.connect()
    await adminClient.query(`CREATE SCHEMA ${quotedSchemaName}`)

    return {
      adminClient,
      configPath,
      databaseUrl: databaseUrl.toString(),
      migrationsPath,
      quotedSchemaName,
      schemaName,
      temporaryDirectory
    }
  }

const copyMigration = (migrationName: string, destination: string): void => {
  cpSync(
    join(sourceMigrationsDirectory, migrationName),
    join(destination, migrationName),
    { recursive: true }
  )
}

const deploy = async ({
  configPath,
  databaseUrl
}: IsolatedMigrationSchema): Promise<void> => {
  await execFileAsync(
    prismaBinary,
    ['migrate', 'deploy', '--config', configPath],
    {
      cwd: apiRoot,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PRISMA_TEST_DATABASE_URL: databaseUrl
      },
      timeout: 30_000
    }
  )
}

const dispose = async ({
  adminClient,
  quotedSchemaName,
  temporaryDirectory
}: IsolatedMigrationSchema): Promise<void> => {
  try {
    await adminClient.query(`DROP SCHEMA IF EXISTS ${quotedSchemaName} CASCADE`)
  } finally {
    await adminClient.end()
    rmSync(temporaryDirectory, { force: true, recursive: true })
  }
}

const readLedger = async (
  context: IsolatedMigrationSchema
): Promise<AppliedMigration[]> => {
  const result = await context.adminClient.query<AppliedMigration>(
    `SELECT
      migration_name AS "migrationName",
      checksum,
      finished_at AS "finishedAt",
      rolled_back_at AS "rolledBackAt",
      logs
     FROM ${context.quotedSchemaName}."_prisma_migrations"`
  )
  return result.rows
}

describe('Slice 4 migration upgrade', () => {
  it('깨끗한 15 migration schema를 16~20번째 schema로 forward deploy한다', async () => {
    const context = await createIsolatedMigrationSchema()

    try {
      expect(priorMigrationNames).toHaveLength(15)
      expect(migrationNames).toHaveLength(20)
      expect(priorMigrationNames).toEqual(
        Object.keys(approvedPriorMigrationSha256).toSorted()
      )
      for (const migrationName of priorMigrationNames) {
        const migrationSql = readFileSync(
          join(sourceMigrationsDirectory, migrationName, 'migration.sql')
        )
        expect(createHash('sha256').update(migrationSql).digest('hex')).toBe(
          approvedPriorMigrationSha256[
            migrationName as keyof typeof approvedPriorMigrationSha256
          ]
        )
      }

      for (const migrationName of priorMigrationNames) {
        copyMigration(migrationName, context.migrationsPath)
      }
      await deploy(context)
      expect(await readLedger(context)).toHaveLength(15)

      for (const migrationName of slice4Migrations) {
        copyMigration(migrationName, context.migrationsPath)
      }
      await deploy(context)
      expect(await readLedger(context)).toHaveLength(19)

      for (const migrationName of slice5Migrations) {
        copyMigration(migrationName, context.migrationsPath)
      }
      await deploy(context)

      const ledger = await readLedger(context)
      const expected = loadExpectedMigrationManifest(sourceMigrationsDirectory)
      expect(() => assertMigrationCompatibility(expected, ledger)).not.toThrow()

      const catalog = await context.adminClient.query<{
        idempotencyTable: string | null
        resultTable: string | null
      }>(
        `SELECT
          to_regclass($1)::text AS "idempotencyTable",
          to_regclass($2)::text AS "resultTable"`,
        [
          `${context.schemaName}."IdempotencyRecord"`,
          `${context.schemaName}."StudyResult"`
        ]
      )
      expect(catalog.rows[0]?.idempotencyTable).not.toBeNull()
      expect(catalog.rows[0]?.resultTable).not.toBeNull()

      await context.adminClient.query(
        `SET search_path TO ${context.quotedSchemaName}`
      )
      await context.adminClient.query(
        'ALTER TABLE "IdempotencyRecord" DISABLE TRIGGER "IdempotencyRecord_validate_change"'
      )
      try {
        await expect(
          context.adminClient.query(
            `INSERT INTO "IdempotencyRecord" (
              "id", "principalType", "userId", "operation",
              "idempotencyKey", "studySessionId", "requestHash", "state",
              "responseStatus", "responseBody", "createdAt", "completedAt",
              "expiresAt"
            ) VALUES (
              $1, 'USER', $2, 'STUDY_SUBMIT', $3, $4, repeat('a', 64),
              'SUCCEEDED', NULL, $5::jsonb, $6::timestamptz,
              $6::timestamptz, $6::timestamptz + INTERVAL '24 hours'
            )`,
            [
              randomUUID(),
              randomUUID(),
              randomUUID(),
              randomUUID(),
              JSON.stringify({ sessionId: randomUUID() }),
              new Date()
            ]
          )
        ).rejects.toMatchObject({ code: '23514' })
      } finally {
        await context.adminClient.query(
          'ALTER TABLE "IdempotencyRecord" ENABLE TRIGGER "IdempotencyRecord_validate_change"'
        )
      }

      const wrongNoteValues = [
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID()
      ]
      await expect(
        context.adminClient.query(
          `INSERT INTO "WrongNote" (
            "id", "userId", "questionId", "lastWrongQuestionVersionId",
            "currentReviewQuestionVersionId", "wrongCount", "correctStreak",
            "status", "lastWrongAt", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, $4, $5, 1, 0, 'NEW', $6, $6, $6
          )`,
          [...wrongNoteValues, new Date()]
        )
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'WrongNote_slice4_current_review_check'
      })
      await expect(
        context.adminClient.query(
          `INSERT INTO "WrongNote" (
            "id", "userId", "questionId", "lastWrongQuestionVersionId",
            "currentReviewQuestionVersionId", "wrongCount", "correctStreak",
            "status", "lastWrongAt", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, $4, NULL, 1, 0, 'NEW', $5, $6, $5
          )`,
          [
            randomUUID(),
            randomUUID(),
            randomUUID(),
            randomUUID(),
            new Date('2026-08-15T00:00:00.000Z'),
            new Date('2026-08-15T00:00:01.000Z')
          ]
        )
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'WrongNote_created_updated_check'
      })

      const guestId = randomUUID()
      await context.adminClient.query(
        `INSERT INTO "GuestPrincipal" (
          "id", "tokenDigest", "expiresAt", "createdAt", "lastSeenAt"
        ) VALUES (
          $1, repeat('b', 64), $2::timestamptz + INTERVAL '1 day', $2, $2
        )`,
        [guestId, new Date()]
      )
      await expect(
        context.adminClient.query(
          `UPDATE "GuestPrincipal"
           SET "expiresAt" = "lastSeenAt" + INTERVAL '7 days 1 millisecond'
           WHERE "id" = $1`,
          [guestId]
        )
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'GuestPrincipal_valid_expiry'
      })
      await expect(
        context.adminClient.query(
          `UPDATE "GuestPrincipal"
           SET "lastSeenAt" = "lastSeenAt" - INTERVAL '1 millisecond'
           WHERE "id" = $1`,
          [guestId]
        )
      ).rejects.toMatchObject({
        code: '23514',
        message: 'GuestPrincipal renewal timestamps must be monotonic.'
      })
      await expect(
        context.adminClient.query(
          `UPDATE "GuestPrincipal"
           SET "createdAt" = "createdAt" - INTERVAL '1 millisecond'
           WHERE "id" = $1`,
          [guestId]
        )
      ).rejects.toMatchObject({
        code: '23514',
        message: 'GuestPrincipal identity is immutable.'
      })
    } finally {
      await dispose(context)
    }
  }, 40_000)

  it('18까지 유효했던 bounded-renewal 위반 row는 19 preflight에서 rollback한다', async () => {
    const context = await createIsolatedMigrationSchema()
    const retentionMigration = slice4Migrations[3]
    const createdAt = new Date('2026-08-15T00:00:00.000Z')

    try {
      for (const migrationName of migrationNames.filter(
        (name) =>
          name !== retentionMigration &&
          !slice5Migrations.includes(name as (typeof slice5Migrations)[number])
      )) {
        copyMigration(migrationName, context.migrationsPath)
      }
      await deploy(context)
      expect(await readLedger(context)).toHaveLength(18)
      await context.adminClient.query(
        `SET search_path TO ${context.quotedSchemaName}`
      )
      await context.adminClient.query(
        `INSERT INTO "GuestPrincipal" (
          "id", "tokenDigest", "expiresAt", "createdAt", "lastSeenAt"
        ) VALUES (
          $1, repeat('c', 64), $2::timestamptz + INTERVAL '2 days',
          $2, $2::timestamptz - INTERVAL '1 millisecond'
        )`,
        [randomUUID(), createdAt]
      )

      const migrationSql = readFileSync(
        join(sourceMigrationsDirectory, retentionMigration, 'migration.sql'),
        'utf8'
      )
      await expect(
        context.adminClient.query(migrationSql)
      ).rejects.toMatchObject({
        code: '23514',
        message:
          'Existing GuestPrincipal expiry is invalid for bounded renewal.'
      })
      await context.adminClient.query('ROLLBACK')
      expect(await readLedger(context)).toHaveLength(18)
    } finally {
      await context.adminClient.query('ROLLBACK').catch(() => undefined)
      await dispose(context)
    }
  }, 40_000)

  it('facts 없는 legacy SUBMITTED row가 있으면 16번째 migration을 23514로 중단한다', async () => {
    const context = await createIsolatedMigrationSchema()
    const userId = randomUUID()
    const sessionId = randomUUID()
    const startedAt = new Date('2026-08-15T00:00:00.000Z')

    try {
      for (const migrationName of priorMigrationNames) {
        copyMigration(migrationName, context.migrationsPath)
      }
      await deploy(context)
      await context.adminClient.query(
        `SET search_path TO ${context.quotedSchemaName}`
      )
      await context.adminClient.query(
        `ALTER TABLE "StudySession"
         DISABLE TRIGGER "StudySession_validate_selection_complete"`
      )
      await context.adminClient.query(
        `INSERT INTO "User" (
          "id", "name", "email", "emailVerified", "role",
          "accountStatus", "createdAt", "updatedAt"
        ) VALUES ($1, 'Legacy submitted user', $2, true, 'USER',
          'ACTIVE', $3, $3)`,
        [userId, `slice4-legacy-${randomUUID()}@example.test`, startedAt]
      )
      await context.adminClient.query(
        `INSERT INTO "StudySession" (
          "id", "userId", "level", "subject", "mode", "status",
          "requestedCount", "actualCount", "usedFallback", "startedAt",
          "expiresAt", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, 'N5', 'VOCABULARY', 'RANDOM', 'IN_PROGRESS',
          1, 1, false, $3, $4, $3, $3
        )`,
        [sessionId, userId, startedAt, new Date('2026-08-16T00:00:00.000Z')]
      )
      await context.adminClient.query(
        `UPDATE "StudySession"
         SET "status" = 'SUBMITTED',
             "submittedAt" = $2,
             "durationSec" = 1,
             "submissionHash" = repeat('a', 64),
             "updatedAt" = $2
         WHERE "id" = $1`,
        [sessionId, new Date('2026-08-15T00:01:00.000Z')]
      )
      await context.adminClient.query(
        `ALTER TABLE "StudySession"
         ENABLE TRIGGER "StudySession_validate_selection_complete"`
      )

      const migrationSql = readFileSync(
        join(sourceMigrationsDirectory, slice4Migrations[0], 'migration.sql'),
        'utf8'
      )
      await expect(
        context.adminClient.query(migrationSql)
      ).rejects.toMatchObject({ code: '23514' })
      await context.adminClient.query('ROLLBACK')

      const absent = await context.adminClient.query<{
        tableName: string | null
      }>(`SELECT to_regclass($1)::text AS "tableName"`, [
        `${context.schemaName}."StudyAnswer"`
      ])
      expect(absent.rows[0]?.tableName).toBeNull()
      expect(await readLedger(context)).toHaveLength(15)
    } finally {
      await context.adminClient.query('ROLLBACK').catch(() => undefined)
      await dispose(context)
    }
  }, 40_000)
})

describe('Slice 5 migration upgrade', () => {
  it('dirty historical tag preflight는 migration 전체를 rollback하고 clean deploy 뒤 CHECK를 강제한다', async () => {
    const context = await createIsolatedMigrationSchema()
    const questionId = randomUUID()
    const versionId = randomUUID()
    const dirtyVersionTagId = randomUUID()
    const tagId = randomUUID()

    try {
      for (const migrationName of migrationNames.filter(
        (name) =>
          !slice5Migrations.includes(name as (typeof slice5Migrations)[number])
      )) {
        copyMigration(migrationName, context.migrationsPath)
      }
      await deploy(context)
      expect(await readLedger(context)).toHaveLength(19)
      await context.adminClient.query(
        `SET search_path TO ${context.quotedSchemaName}`
      )
      await context.adminClient.query(
        `INSERT INTO "Question" (
          "id", "createdByLabelSnapshot", "createdAt", "updatedAt"
        ) VALUES ($1, 'SYSTEM_SEED', now(), now())`,
        [questionId]
      )
      await context.adminClient.query(
        `INSERT INTO "QuestionVersion" (
          "id", "questionId", "versionNumber", "level", "subject",
          "questionType", "questionText", "explanationKo", "difficulty",
          "createdByLabelSnapshot", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, 1, 'N5', 'VOCABULARY', 'KANJI_READING',
          'Slice 5 dirty migration fixture', 'migration fixture', 'EASY',
          'SYSTEM_SEED', now(), now()
        )`,
        [versionId, questionId]
      )
      await context.adminClient.query(
        `INSERT INTO "Tag" (
          "id", "label", "normalizedName", "createdAt", "updatedAt"
        ) VALUES ($1, 'Tag', $2, now(), now())`,
        [tagId, `slice5-migration-${randomUUID()}`]
      )
      await context.adminClient.query(
        `INSERT INTO "QuestionVersionTag" (
          "id", "questionVersionId", "tagId", "labelSnapshot"
        ) VALUES ($1, $2, $3, ' Tag ')`,
        [dirtyVersionTagId, versionId, tagId]
      )

      const migrationSql = readFileSync(
        join(sourceMigrationsDirectory, slice5Migrations[0], 'migration.sql'),
        'utf8'
      )
      await expect(
        context.adminClient.query(migrationSql)
      ).rejects.toMatchObject({
        code: '23514',
        message:
          'QuestionVersionTag labelSnapshot must use canonical ASCII-space edges.'
      })
      await context.adminClient.query('ROLLBACK')

      expect(await readLedger(context)).toHaveLength(19)
      const dirtyRow = await context.adminClient.query<{
        labelSnapshot: string
      }>(
        `SELECT "labelSnapshot"
         FROM "QuestionVersionTag"
         WHERE "id" = $1`,
        [dirtyVersionTagId]
      )
      expect(dirtyRow.rows).toEqual([{ labelSnapshot: ' Tag ' }])

      const rolledBackObjects = await context.adminClient.query<{
        constraintCount: number
        indexCount: number
      }>(
        `SELECT
          (
            SELECT COUNT(*)::int
            FROM pg_constraint AS constraint_record
            JOIN pg_class AS relation
              ON relation.oid = constraint_record.conrelid
            JOIN pg_namespace AS namespace
              ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = $1
              AND constraint_record.conname =
                'QuestionVersionTag_label_snapshot_trimmed_check'
          ) AS "constraintCount",
          (
            SELECT COUNT(*)::int
            FROM pg_indexes
            WHERE schemaname = $1
              AND indexname IN (
                'StudySession_userId_submittedAt_id_dashboard_idx',
                'WrongNote_userId_wrongCount_lastWrongAt_id_idx'
              )
          ) AS "indexCount"`,
        [context.schemaName]
      )
      expect(rolledBackObjects.rows).toEqual([
        { constraintCount: 0, indexCount: 0 }
      ])

      await context.adminClient.query(
        `UPDATE "QuestionVersionTag"
         SET "labelSnapshot" = 'Tag'
         WHERE "id" = $1`,
        [dirtyVersionTagId]
      )
      copyMigration(slice5Migrations[0], context.migrationsPath)
      await deploy(context)

      expect(await readLedger(context)).toHaveLength(20)
      const futureTagId = randomUUID()
      await context.adminClient.query(
        `INSERT INTO "Tag" (
          "id", "label", "normalizedName", "createdAt", "updatedAt"
        ) VALUES ($1, 'Future tag', $2, now(), now())`,
        [futureTagId, `slice5-migration-${randomUUID()}`]
      )
      await expect(
        context.adminClient.query(
          `INSERT INTO "QuestionVersionTag" (
            "id", "questionVersionId", "tagId", "labelSnapshot"
          ) VALUES ($1, $2, $3, ' Future tag ')`,
          [randomUUID(), versionId, futureTagId]
        )
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'QuestionVersionTag_label_snapshot_trimmed_check'
      })
    } finally {
      await context.adminClient.query('ROLLBACK').catch(() => undefined)
      await dispose(context)
    }
  }, 40_000)
})
