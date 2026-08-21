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
import { createPrismaStudySessionRepository } from '../study/studySessionRepository.js'
import { createPrismaStudySubmissionRepository } from '../study/studySubmissionRepository.js'
import { createStudySubmissionService } from '../study/studySubmissionService.js'
import { createDatabaseRuntime } from './database.js'
import { assertSafeTestDatabase } from './databaseTargetGuard.js'
import {
  assertMigrationCompatibility,
  loadExpectedMigrationManifest,
  type AppliedMigration
} from './readiness.js'

const execFileAsync = promisify(execFile)
const DAY_MS = 24 * 60 * 60 * 1_000
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
const phase4Slice1Migrations = [
  '20260817130000_phase4_practice_idempotency_operations',
  '20260817131000_phase4_study_draft_core'
] as const
const phase4Slice3Migrations = [
  '20260818130000_phase4_study_selection_modes'
] as const
const phase4Slice4Migrations = ['20260821130000_phase4_bookmarks'] as const
const phase4Slice5Migrations = ['20260821150000_phase4_result_retry'] as const
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
    !slice5Migrations.includes(name as (typeof slice5Migrations)[number]) &&
    !phase4Slice1Migrations.includes(
      name as (typeof phase4Slice1Migrations)[number]
    ) &&
    !phase4Slice3Migrations.includes(
      name as (typeof phase4Slice3Migrations)[number]
    ) &&
    !phase4Slice4Migrations.includes(
      name as (typeof phase4Slice4Migrations)[number]
    ) &&
    !phase4Slice5Migrations.includes(
      name as (typeof phase4Slice5Migrations)[number]
    )
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

const deployThroughPhase4Slice1 = async (
  context: IsolatedMigrationSchema
): Promise<void> => {
  for (const migrationName of migrationNames.filter(
    (name) =>
      !phase4Slice3Migrations.includes(
        name as (typeof phase4Slice3Migrations)[number]
      ) &&
      !phase4Slice4Migrations.includes(
        name as (typeof phase4Slice4Migrations)[number]
      ) &&
      !phase4Slice5Migrations.includes(
        name as (typeof phase4Slice5Migrations)[number]
      )
  )) {
    copyMigration(migrationName, context.migrationsPath)
  }
  await deploy(context)
  expect(await readLedger(context)).toHaveLength(22)
  await context.adminClient.query(
    `SET search_path TO ${context.quotedSchemaName}`
  )
}

const deployThroughPhase4Slice4 = async (
  context: IsolatedMigrationSchema
): Promise<void> => {
  for (const migrationName of migrationNames.filter(
    (name) =>
      !phase4Slice5Migrations.includes(
        name as (typeof phase4Slice5Migrations)[number]
      )
  )) {
    copyMigration(migrationName, context.migrationsPath)
  }
  await deploy(context)
  expect(await readLedger(context)).toHaveLength(24)
  await context.adminClient.query(
    `SET search_path TO ${context.quotedSchemaName}`
  )
}

interface LegacySubmissionFixture {
  readonly noteId: string
  readonly questionId: string
  readonly sessionId: string
  readonly versionId: string
}

const createLegacySubmissionFixture = async (
  context: IsolatedMigrationSchema,
  input: {
    readonly mode: 'DAILY_REVIEW' | 'RANDOM'
    readonly occurredAt: Date
    readonly source: 'STUDY_SUBMIT'
    readonly startedAt: Date
  }
): Promise<LegacySubmissionFixture> => {
  const ids = Array.from({ length: 12 }, () => randomUUID())
  const [
    userId,
    questionId,
    versionId,
    sessionId,
    itemId,
    recordId,
    answerId,
    noteId,
    scheduleId,
    eventId,
    resultId,
    idempotencyKey
  ] = ids

  if (
    !userId ||
    !questionId ||
    !versionId ||
    !sessionId ||
    !itemId ||
    !recordId ||
    !answerId ||
    !noteId ||
    !scheduleId ||
    !eventId ||
    !resultId ||
    !idempotencyKey
  ) {
    throw new Error('Slice 3 legacy submission UUID fixture가 필요합니다.')
  }

  await context.adminClient.query('BEGIN')
  try {
    await context.adminClient.query(
      `INSERT INTO "User" (
        "id", "name", "email", "emailVerified", "role",
        "accountStatus", "createdAt", "updatedAt"
      ) VALUES ($1, 'Slice 3 migration preflight', $2, true, 'USER',
        'ACTIVE', $3, $3)`,
      [userId, `slice3-migration-${randomUUID()}@example.test`, input.startedAt]
    )
    await context.adminClient.query(
      `INSERT INTO "Question" (
        "id", "createdByLabelSnapshot", "createdAt", "updatedAt"
      ) VALUES ($1, 'SYSTEM_SEED', $2, $2)`,
      [questionId, input.startedAt]
    )
    await context.adminClient.query(
      `INSERT INTO "QuestionVersion" (
        "id", "questionId", "versionNumber", "level", "subject",
        "questionType", "questionText", "explanationKo", "difficulty",
        "createdByLabelSnapshot", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, 1, 'N5', 'VOCABULARY', 'KANJI_READING',
        'Slice 3 migration preflight question', 'migration preflight', 'EASY',
        'SYSTEM_SEED', $3, $3
      )`,
      [versionId, questionId, input.startedAt]
    )
    await context.adminClient.query(
      `INSERT INTO "StudySession" (
        "id", "userId", "level", "subject", "mode", "status",
        "requestedCount", "actualCount", "usedFallback", "startedAt",
        "expiresAt", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, 'N5', 'VOCABULARY', $3, 'IN_PROGRESS',
        1, 1, false, $4, $4::timestamptz + INTERVAL '1 day', $4, $4
      )`,
      [sessionId, userId, input.mode, input.startedAt]
    )
    await context.adminClient.query(
      `INSERT INTO "StudySessionQuestion" (
        "id", "studySessionId", "questionId", "questionVersionId",
        "ordinal", "createdAt"
      ) VALUES ($1, $2, $3, $4, 1, $5)`,
      [itemId, sessionId, questionId, versionId, input.startedAt]
    )
    await context.adminClient.query(
      `INSERT INTO "IdempotencyRecord" (
        "id", "principalType", "userId", "operation", "idempotencyKey",
        "studySessionId", "requestHash", "state", "createdAt"
      ) VALUES (
        $1, 'USER', $2, 'STUDY_SUBMIT', $3, $4, repeat('a', 64),
        'PROCESSING', $5
      )`,
      [recordId, userId, idempotencyKey, sessionId, input.startedAt]
    )
    await context.adminClient.query(
      `INSERT INTO "StudyAnswer" (
        "id", "studySessionQuestionId", "questionVersionId",
        "selectedOptionId", "isCorrect", "elapsedSec", "gradingVersion",
        "answeredAt", "gradedAt"
      ) VALUES (
        $1, $2, $3, NULL, false, 10, 'server-grading-v1', $4, $4
      )`,
      [answerId, itemId, versionId, input.occurredAt]
    )
    await context.adminClient.query(
      `INSERT INTO "WrongNote" (
        "id", "userId", "questionId", "lastWrongQuestionVersionId",
        "currentReviewQuestionVersionId", "wrongCount", "correctStreak",
        "status", "lastWrongAt", "lastReviewedAt", "createdAt",
        "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, NULL, 1, 0, 'NEW', $5, NULL, $5, $5
      )`,
      [noteId, userId, questionId, versionId, input.occurredAt]
    )
    await context.adminClient.query(
      `INSERT INTO "ReviewSchedule" (
        "id", "wrongNoteId", "nextReviewAt", "intervalDays",
        "algorithmVersion", "updatedAt"
      ) VALUES ($1, $2, $3::timestamptz + INTERVAL '1 day', 1, 1, $3)`,
      [scheduleId, noteId, input.occurredAt]
    )
    await context.adminClient.query(
      `INSERT INTO "ReviewEvent" (
        "id", "wrongNoteId", "userId", "questionId", "questionVersionId",
        "source", "studySessionId", "studyAnswerId", "selectedOptionId",
        "isCorrect", "previousStatus", "nextStatus",
        "previousCorrectStreak", "nextCorrectStreak",
        "previousWrongCount", "wrongCountAfter", "algorithmVersion",
        "occurredAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, NULL, false,
        NULL, 'NEW', NULL, 0, NULL, 1, 1, $9
      )`,
      [
        eventId,
        noteId,
        userId,
        questionId,
        versionId,
        input.source,
        sessionId,
        answerId,
        input.occurredAt
      ]
    )
    await context.adminClient.query(
      `INSERT INTO "StudyResult" (
        "id", "studySessionId", "totalCount", "correctCount",
        "incorrectCount", "correctRateBasisPoints", "durationSec",
        "gradingVersion", "createdAt"
      ) VALUES (
        $1, $2, 1, 0, 1, 0, 10, 'server-grading-v1', $3
      )`,
      [resultId, sessionId, input.occurredAt]
    )
    await context.adminClient.query(
      `UPDATE "StudySession"
       SET "status" = 'SUBMITTED', "submittedAt" = $2,
           "durationSec" = 10, "submissionHash" = repeat('a', 64),
           "updatedAt" = $2
       WHERE "id" = $1`,
      [sessionId, input.occurredAt]
    )
    await context.adminClient.query(
      `UPDATE "IdempotencyRecord"
       SET "state" = 'SUCCEEDED', "responseStatus" = 201,
           "responseBody" = jsonb_build_object('sessionId', $2::text),
           "completedAt" = $3,
           "expiresAt" = $3::timestamptz + INTERVAL '24 hours'
       WHERE "id" = $1`,
      [recordId, sessionId, input.occurredAt]
    )
    await context.adminClient.query('SET CONSTRAINTS ALL IMMEDIATE')
    await context.adminClient.query('COMMIT')
  } catch (error: unknown) {
    await context.adminClient.query('ROLLBACK')
    throw error
  }

  return { noteId, questionId, sessionId, versionId }
}

describe('Phase 3 submission through Phase 4 Slice 5 migration upgrade', () => {
  it('깨끗한 15 migration schema를 16~25번째 schema로 forward deploy한다', async () => {
    const context = await createIsolatedMigrationSchema()

    try {
      expect(priorMigrationNames).toHaveLength(15)
      expect(migrationNames).toHaveLength(25)
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
      expect(await readLedger(context)).toHaveLength(20)

      copyMigration(phase4Slice1Migrations[0], context.migrationsPath)
      await deploy(context)
      expect(await readLedger(context)).toHaveLength(21)

      copyMigration(phase4Slice1Migrations[1], context.migrationsPath)
      await deploy(context)
      expect(await readLedger(context)).toHaveLength(22)

      copyMigration(phase4Slice3Migrations[0], context.migrationsPath)
      await deploy(context)
      expect(await readLedger(context)).toHaveLength(23)

      copyMigration(phase4Slice4Migrations[0], context.migrationsPath)
      await deploy(context)
      expect(await readLedger(context)).toHaveLength(24)

      copyMigration(phase4Slice5Migrations[0], context.migrationsPath)
      await deploy(context)
      expect(await readLedger(context)).toHaveLength(25)

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
        message: 'WrongNote current review pointer must start null.'
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
          !slice5Migrations.includes(
            name as (typeof slice5Migrations)[number]
          ) &&
          !phase4Slice1Migrations.includes(
            name as (typeof phase4Slice1Migrations)[number]
          ) &&
          !phase4Slice3Migrations.includes(
            name as (typeof phase4Slice3Migrations)[number]
          ) &&
          !phase4Slice4Migrations.includes(
            name as (typeof phase4Slice4Migrations)[number]
          ) &&
          !phase4Slice5Migrations.includes(
            name as (typeof phase4Slice5Migrations)[number]
          )
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

describe('Phase 4 Slice 1 migration upgrade', () => {
  it('populated v1 rows를 version 1/no-draft로 보존하고 omitted-column default를 고정한다', async () => {
    const context = await createIsolatedMigrationSchema()
    const userId = randomUUID()
    const sessionId = randomUUID()
    const idempotencyId = randomUUID()
    const startedAt = new Date('2026-08-17T00:00:00.000Z')

    try {
      for (const migrationName of [
        ...priorMigrationNames,
        ...slice4Migrations,
        ...slice5Migrations
      ]) {
        copyMigration(migrationName, context.migrationsPath)
      }
      await deploy(context)
      expect(await readLedger(context)).toHaveLength(20)
      await context.adminClient.query(
        `SET search_path TO ${context.quotedSchemaName}`
      )
      await context.adminClient.query(
        `INSERT INTO "User" (
          "id", "name", "email", "emailVerified", "role",
          "accountStatus", "createdAt", "updatedAt"
        ) VALUES ($1, 'Phase 4 legacy user', $2, true, 'USER',
          'ACTIVE', $3, $3)`,
        [userId, `phase4-legacy-${randomUUID()}@example.test`, startedAt]
      )
      await context.adminClient.query(
        `ALTER TABLE "StudySession"
         DISABLE TRIGGER "StudySession_validate_selection_complete"`
      )
      await context.adminClient.query(
        `INSERT INTO "StudySession" (
          "id", "userId", "level", "subject", "mode", "status",
          "requestedCount", "actualCount", "usedFallback", "startedAt",
          "expiresAt", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, 'N5', 'VOCABULARY', 'RANDOM', 'IN_PROGRESS',
          1, 1, false, $3, $3::timestamptz + INTERVAL '1 day', $3, $3
        )`,
        [sessionId, userId, startedAt]
      )
      await context.adminClient.query(
        `ALTER TABLE "StudySession"
         ENABLE TRIGGER "StudySession_validate_selection_complete"`
      )
      await context.adminClient.query(
        `ALTER TABLE "IdempotencyRecord"
         DISABLE TRIGGER "IdempotencyRecord_validate_change"`
      )
      await context.adminClient.query(
        `ALTER TABLE "IdempotencyRecord"
         DISABLE TRIGGER "IdempotencyRecord_validate_committed_state"`
      )
      await context.adminClient.query(
        `INSERT INTO "IdempotencyRecord" (
          "id", "principalType", "userId", "operation", "idempotencyKey",
          "studySessionId", "requestHash", "state", "createdAt"
        ) VALUES (
          $1, 'USER', $2, 'STUDY_SUBMIT', $3, $4, repeat('a', 64),
          'PROCESSING', $5
        )`,
        [idempotencyId, userId, randomUUID(), sessionId, startedAt]
      )
      await context.adminClient.query(
        `ALTER TABLE "IdempotencyRecord"
         ENABLE TRIGGER "IdempotencyRecord_validate_change"`
      )
      await context.adminClient.query(
        `ALTER TABLE "IdempotencyRecord"
         ENABLE TRIGGER "IdempotencyRecord_validate_committed_state"`
      )

      copyMigration(phase4Slice1Migrations[0], context.migrationsPath)
      await deploy(context)
      expect(await readLedger(context)).toHaveLength(21)
      copyMigration(phase4Slice1Migrations[1], context.migrationsPath)
      await deploy(context)
      expect(await readLedger(context)).toHaveLength(22)

      const preserved = await context.adminClient.query<{
        contractVersion: number
        draftCount: number
        practiceContractVersion: number
      }>(
        `SELECT
          session."practiceContractVersion" AS "practiceContractVersion",
          record."contractVersion" AS "contractVersion",
          (SELECT COUNT(*)::int FROM "StudyDraft") AS "draftCount"
         FROM "StudySession" AS session
         JOIN "IdempotencyRecord" AS record
           ON record."studySessionId" = session."id"
         WHERE session."id" = $1 AND record."id" = $2`,
        [sessionId, idempotencyId]
      )
      expect(preserved.rows).toEqual([
        { practiceContractVersion: 1, contractVersion: 1, draftCount: 0 }
      ])

      const defaults = await context.adminClient.query<{
        columnDefault: string
        columnName: string
      }>(
        `SELECT
          column_name AS "columnName",
          column_default AS "columnDefault"
         FROM information_schema.columns
         WHERE table_schema = $1
           AND (
             (table_name = 'StudySession' AND column_name = 'practiceContractVersion')
             OR (table_name = 'IdempotencyRecord' AND column_name = 'contractVersion')
           )
         ORDER BY table_name`,
        [context.schemaName]
      )
      expect(defaults.rows).toEqual([
        { columnName: 'contractVersion', columnDefault: '1' },
        { columnName: 'practiceContractVersion', columnDefault: '1' }
      ])

      copyMigration(phase4Slice3Migrations[0], context.migrationsPath)
      await deploy(context)
      expect(await readLedger(context)).toHaveLength(23)

      copyMigration(phase4Slice4Migrations[0], context.migrationsPath)
      await deploy(context)
      expect(await readLedger(context)).toHaveLength(24)

      copyMigration(phase4Slice5Migrations[0], context.migrationsPath)
      await deploy(context)
      expect(await readLedger(context)).toHaveLength(25)

      const oldBinarySessionId = randomUUID()
      const oldBinarySessionQuestionId = randomUUID()
      const oldBinaryQuestionId = randomUUID()
      const oldBinaryQuestionVersionId = randomUUID()
      const oldBinaryOptionIds = Array.from({ length: 4 }, () => randomUUID())
      const oldBinaryTagId = randomUUID()
      const oldBinaryStartedAt = new Date()
      const oldBinaryIdempotencyKey = randomUUID()

      await context.adminClient.query('BEGIN')
      try {
        await context.adminClient.query(
          `INSERT INTO "Question" (
            "id", "createdByLabelSnapshot", "createdAt", "updatedAt"
          ) VALUES ($1, 'SYSTEM_SEED', $2, $2)`,
          [oldBinaryQuestionId, oldBinaryStartedAt]
        )
        await context.adminClient.query(
          `INSERT INTO "QuestionVersion" (
            "id", "questionId", "versionNumber", "level", "subject",
            "questionType", "questionText", "explanationKo", "difficulty",
            "createdByLabelSnapshot", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, 1, 'N5', 'VOCABULARY', 'KANJI_READING',
            'Phase 4 old binary compatibility question',
            '구 binary v1 제출 호환성 검증', 'EASY', 'SYSTEM_SEED', $3, $3
          )`,
          [oldBinaryQuestionVersionId, oldBinaryQuestionId, oldBinaryStartedAt]
        )
        for (const [index, optionId] of oldBinaryOptionIds.entries()) {
          await context.adminClient.query(
            `INSERT INTO "QuestionOption" (
              "id", "questionVersionId", "label", "text", "ordinal"
            ) VALUES ($1, $2, $3, $4, $5)`,
            [
              optionId,
              oldBinaryQuestionVersionId,
              String(index + 1),
              `보기 ${index + 1}`,
              index + 1
            ]
          )
        }
        await context.adminClient.query(
          `INSERT INTO "Tag" (
            "id", "label", "normalizedName", "createdAt", "updatedAt"
          ) VALUES ($1, '호환성', $2, $3, $3)`,
          [
            oldBinaryTagId,
            `phase4-old-binary-${randomUUID()}`,
            oldBinaryStartedAt
          ]
        )
        await context.adminClient.query(
          `INSERT INTO "QuestionVersionTag" (
            "id", "questionVersionId", "tagId", "labelSnapshot"
          ) VALUES ($1, $2, $3, '호환성')`,
          [randomUUID(), oldBinaryQuestionVersionId, oldBinaryTagId]
        )
        await context.adminClient.query(
          `UPDATE "QuestionVersion"
           SET "correctOptionId" = $1, "status" = 'PUBLISHED',
               "publishedAt" = $2, "updatedAt" = $2
           WHERE "id" = $3`,
          [
            oldBinaryOptionIds[0],
            oldBinaryStartedAt,
            oldBinaryQuestionVersionId
          ]
        )
        await context.adminClient.query(
          `UPDATE "Question"
           SET "currentPublishedVersionId" = $1, "updatedAt" = $2
           WHERE "id" = $3`,
          [oldBinaryQuestionVersionId, oldBinaryStartedAt, oldBinaryQuestionId]
        )
        await context.adminClient.query(
          `INSERT INTO "StudySession" (
            "id", "userId", "level", "subject", "mode", "status",
            "requestedCount", "actualCount", "usedFallback", "startedAt",
            "expiresAt", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, 'N5', 'VOCABULARY', 'RANDOM', 'IN_PROGRESS',
            1, 1, false, $3, $3::timestamptz + INTERVAL '1 day', $3, $3
          )`,
          [oldBinarySessionId, userId, oldBinaryStartedAt]
        )
        await context.adminClient.query(
          `INSERT INTO "StudySessionQuestion" (
            "id", "studySessionId", "questionId", "questionVersionId",
            "ordinal", "createdAt"
          ) VALUES ($1, $2, $3, $4, 1, $5)`,
          [
            oldBinarySessionQuestionId,
            oldBinarySessionId,
            oldBinaryQuestionId,
            oldBinaryQuestionVersionId,
            oldBinaryStartedAt
          ]
        )
        await context.adminClient.query('COMMIT')
      } catch (error: unknown) {
        await context.adminClient.query('ROLLBACK')
        throw error
      }

      const oldBinaryRuntime = createDatabaseRuntime(context.databaseUrl)
      try {
        await oldBinaryRuntime.checkReadiness()
        const oldBinarySubmissionService = createStudySubmissionService(
          createPrismaStudySubmissionRepository(oldBinaryRuntime.client),
          () => new Date(oldBinaryStartedAt.getTime() + 1_000)
        )
        const oldBinaryBody = {
          answers: [
            {
              studySessionQuestionId: oldBinarySessionQuestionId,
              selectedOptionId: oldBinaryOptionIds[0] ?? null,
              elapsedSec: 2
            }
          ],
          durationSec: 2
        }
        const first = await oldBinarySubmissionService.submit(
          oldBinarySessionId,
          oldBinaryIdempotencyKey,
          oldBinaryBody,
          { kind: 'USER', userId }
        )
        expect(first).toMatchObject({ replayed: false })
        const replay = await oldBinarySubmissionService.submit(
          oldBinarySessionId,
          oldBinaryIdempotencyKey,
          oldBinaryBody,
          { kind: 'USER', userId }
        )
        expect(replay).toMatchObject({
          replayed: true,
          response: first.response
        })
      } finally {
        await oldBinaryRuntime.disconnect()
      }
      expect(
        (
          await context.adminClient.query<{
            contractVersion: number
            practiceContractVersion: number
          }>(
            `SELECT
              session."practiceContractVersion" AS "practiceContractVersion",
              record."contractVersion" AS "contractVersion"
             FROM "StudySession" AS session
             JOIN "IdempotencyRecord" AS record
               ON record."studySessionId" = session."id"
             WHERE session."id" = $1
               AND record."operation" = 'STUDY_SUBMIT'`,
            [oldBinarySessionId]
          )
        ).rows
      ).toEqual([{ practiceContractVersion: 1, contractVersion: 1 }])

      const indexes = await context.adminClient.query<{
        indexDefinition: string
        indexName: string
      }>(
        `SELECT
          indexname AS "indexName",
          regexp_replace(indexdef, '\\s+', ' ', 'g') AS "indexDefinition"
         FROM pg_indexes
         WHERE schemaname = $1
           AND indexname = ANY($2::text[])
         ORDER BY indexname`,
        [
          context.schemaName,
          [
            'StudySessionQuestion_studySessionId_id_key',
            'StudySession_userId_startedAt_id_resumable_idx',
            'StudySession_guestPrincipalId_startedAt_id_resumable_idx',
            'StudyDraft_savedAt_studySessionId_idx',
            'StudyDraftAnswer_studySessionQuestionId_questionVersionId_idx',
            'StudyDraftAnswer_questionVersionId_selectedOptionId_idx',
            'IdempotencyRecord_operation_expiresAt_id_idx',
            'IdempotencyRecord_studySessionId_submit_succeeded_key'
          ]
        ]
      )
      expect(indexes.rows.map(({ indexName }) => indexName)).toEqual([
        'IdempotencyRecord_operation_expiresAt_id_idx',
        'IdempotencyRecord_studySessionId_submit_succeeded_key',
        'StudyDraftAnswer_questionVersionId_selectedOptionId_idx',
        'StudyDraftAnswer_studySessionQuestionId_questionVersionId_idx',
        'StudyDraft_savedAt_studySessionId_idx',
        'StudySessionQuestion_studySessionId_id_key',
        'StudySession_guestPrincipalId_startedAt_id_resumable_idx',
        'StudySession_userId_startedAt_id_resumable_idx'
      ])
      const indexDefinitions = new Map(
        indexes.rows.map(({ indexName, indexDefinition }) => [
          indexName,
          indexDefinition
        ])
      )
      expect(
        indexDefinitions.get('StudySession_userId_startedAt_id_resumable_idx')
      ).toMatch(
        /\("userId", "startedAt" DESC, id\) INCLUDE \("expiresAt"\).*"userId" IS NOT NULL.*status.*IN_PROGRESS/u
      )
      expect(
        indexDefinitions.get('StudyDraft_savedAt_studySessionId_idx')
      ).toMatch(/\("savedAt" DESC NULLS LAST, "studySessionId"\)/u)
      expect(
        indexDefinitions.get(
          'StudyDraftAnswer_questionVersionId_selectedOptionId_idx'
        )
      ).toMatch(
        /\("questionVersionId", "selectedOptionId"\).*"selectedOptionId" IS NOT NULL/u
      )
      expect(
        indexDefinitions.get('IdempotencyRecord_operation_expiresAt_id_idx')
      ).toMatch(
        /\(operation, "expiresAt", id\).*state.*SUCCEEDED.*"expiresAt" IS NOT NULL/u
      )
      expect(
        indexDefinitions.get(
          'IdempotencyRecord_studySessionId_submit_succeeded_key'
        )
      ).toMatch(/UNIQUE INDEX.*\("studySessionId"\).*operation.*STUDY_SUBMIT/u)

      const aggregateTriggers = await context.adminClient.query<{
        initiallyDeferred: boolean
        isDeferrable: boolean
        triggerName: string
      }>(
        `SELECT
          trigger.tgname AS "triggerName",
          trigger.tgdeferrable AS "isDeferrable",
          trigger.tginitdeferred AS "initiallyDeferred"
         FROM pg_trigger AS trigger
         JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
         JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = $1
           AND trigger.tgname = ANY($2::text[])
         ORDER BY trigger.tgname`,
        [
          context.schemaName,
          [
            'StudySession_validate_draft_aggregate',
            'StudySessionQuestion_validate_draft_aggregate',
            'StudyDraft_validate_aggregate',
            'StudyDraftAnswer_validate_aggregate'
          ]
        ]
      )
      expect(aggregateTriggers.rows).toHaveLength(4)
      expect(aggregateTriggers.rows).toEqual(
        aggregateTriggers.rows.map((row) => ({
          ...row,
          isDeferrable: true,
          initiallyDeferred: true
        }))
      )

      const foreignKeys = await context.adminClient.query<{
        constraintName: string
        deleteAction: string
        isDeferrable: boolean
        updateAction: string
      }>(
        `SELECT
          constraint_entry.conname AS "constraintName",
          constraint_entry.condeferrable AS "isDeferrable",
          constraint_entry.confdeltype::text AS "deleteAction",
          constraint_entry.confupdtype::text AS "updateAction"
         FROM pg_constraint AS constraint_entry
         JOIN pg_class AS relation ON relation.oid = constraint_entry.conrelid
         JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = $1
           AND constraint_entry.conname = ANY($2::text[])
         ORDER BY constraint_entry.conname`,
        [
          context.schemaName,
          [
            'StudyDraft_studySessionId_fkey',
            'StudyDraftAnswer_studySessionId_fkey',
            'StudyDraftAnswer_studySessionId_studySessionQuestionId_fkey',
            'StudyDraftAnswer_studySessionQuestionId_questionVersionId_fkey',
            'StudyDraftAnswer_questionVersionId_selectedOptionId_fkey'
          ]
        ]
      )
      expect(foreignKeys.rows).toEqual([
        {
          constraintName:
            'StudyDraftAnswer_questionVersionId_selectedOptionId_fkey',
          isDeferrable: false,
          deleteAction: 'r',
          updateAction: 'c'
        },
        {
          constraintName: 'StudyDraftAnswer_studySessionId_fkey',
          isDeferrable: false,
          deleteAction: 'c',
          updateAction: 'c'
        },
        {
          constraintName:
            'StudyDraftAnswer_studySessionId_studySessionQuestionId_fkey',
          isDeferrable: false,
          deleteAction: 'c',
          updateAction: 'c'
        },
        {
          constraintName:
            'StudyDraftAnswer_studySessionQuestionId_questionVersionId_fkey',
          isDeferrable: false,
          deleteAction: 'c',
          updateAction: 'c'
        },
        {
          constraintName: 'StudyDraft_studySessionId_fkey',
          isDeferrable: false,
          deleteAction: 'c',
          updateAction: 'c'
        }
      ])
    } finally {
      await dispose(context)
    }
  }, 40_000)

  it('enum-only 뒤 reserved retry row가 있으면 dependent migration 전체를 rollback한다', async () => {
    const context = await createIsolatedMigrationSchema()

    try {
      for (const migrationName of [
        ...priorMigrationNames,
        ...slice4Migrations,
        ...slice5Migrations,
        phase4Slice1Migrations[0]
      ]) {
        copyMigration(migrationName, context.migrationsPath)
      }
      await deploy(context)
      expect(await readLedger(context)).toHaveLength(21)
      await context.adminClient.query(
        `SET search_path TO ${context.quotedSchemaName}`
      )
      await context.adminClient.query(
        `ALTER TABLE "IdempotencyRecord"
         DISABLE TRIGGER "IdempotencyRecord_validate_change"`
      )
      await context.adminClient.query(
        `ALTER TABLE "IdempotencyRecord"
         DISABLE TRIGGER "IdempotencyRecord_validate_committed_state"`
      )
      const now = new Date()
      const userId = randomUUID()
      const sessionId = randomUUID()
      await context.adminClient.query(
        `INSERT INTO "User" (
          "id", "name", "email", "emailVerified", "role",
          "accountStatus", "createdAt", "updatedAt"
        ) VALUES ($1, 'Reserved op user', $2, true, 'USER', 'ACTIVE', $3, $3)`,
        [userId, `phase4-reserved-${randomUUID()}@example.test`, now]
      )
      await context.adminClient.query(
        `ALTER TABLE "StudySession"
         DISABLE TRIGGER "StudySession_validate_selection_complete"`
      )
      await context.adminClient.query(
        `INSERT INTO "StudySession" (
          "id", "userId", "level", "subject", "mode", "status",
          "requestedCount", "actualCount", "usedFallback", "startedAt",
          "expiresAt", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, 'N5', 'VOCABULARY', 'RANDOM', 'IN_PROGRESS',
          1, 1, false, $3, $3::timestamptz + INTERVAL '1 day', $3, $3
        )`,
        [sessionId, userId, now]
      )
      await context.adminClient.query(
        `ALTER TABLE "StudySession"
         ENABLE TRIGGER "StudySession_validate_selection_complete"`
      )
      await context.adminClient.query(
        `INSERT INTO "IdempotencyRecord" (
          "id", "principalType", "userId", "operation", "idempotencyKey",
          "studySessionId", "requestHash", "state", "createdAt"
        ) VALUES (
          $1, 'USER', $2, 'STUDY_RETRY_CREATE', $3, $4,
          repeat('b', 64), 'PROCESSING', $5
        )`,
        [randomUUID(), userId, randomUUID(), sessionId, now]
      )
      await context.adminClient.query(
        `ALTER TABLE "IdempotencyRecord"
         ENABLE TRIGGER "IdempotencyRecord_validate_change"`
      )
      await context.adminClient.query(
        `ALTER TABLE "IdempotencyRecord"
         ENABLE TRIGGER "IdempotencyRecord_validate_committed_state"`
      )

      const migrationSql = readFileSync(
        join(
          sourceMigrationsDirectory,
          phase4Slice1Migrations[1],
          'migration.sql'
        ),
        'utf8'
      )
      await expect(
        context.adminClient.query(migrationSql)
      ).rejects.toMatchObject({
        code: '23514',
        message:
          'Reserved Phase 4 idempotency operations must have zero rows before Slice 1.'
      })
      await context.adminClient.query('ROLLBACK')
      const absent = await context.adminClient.query<{
        draftTable: string | null
        versionColumnCount: number
      }>(
        `SELECT
          to_regclass($1)::text AS "draftTable",
          (
            SELECT COUNT(*)::int
            FROM information_schema.columns
            WHERE table_schema = $2
              AND table_name = 'StudySession'
              AND column_name = 'practiceContractVersion'
          ) AS "versionColumnCount"`,
        [`${context.schemaName}."StudyDraft"`, context.schemaName]
      )
      expect(absent.rows).toEqual([{ draftTable: null, versionColumnCount: 0 }])
      expect(await readLedger(context)).toHaveLength(21)
    } finally {
      await context.adminClient.query('ROLLBACK').catch(() => undefined)
      await dispose(context)
    }
  }, 40_000)
})

describe('Phase 4 Slice 3 migration preflight', () => {
  it('dirty current review pointer를 발견하면 migration 전체를 rollback한다', async () => {
    const context = await createIsolatedMigrationSchema()
    const startedAt = new Date('2026-08-18T00:59:50.000Z')
    const occurredAt = new Date('2026-08-18T01:00:00.000Z')

    try {
      await deployThroughPhase4Slice1(context)
      const fixture = await createLegacySubmissionFixture(context, {
        mode: 'RANDOM',
        occurredAt,
        source: 'STUDY_SUBMIT',
        startedAt
      })
      await context.adminClient.query(
        `ALTER TABLE "WrongNote"
         DROP CONSTRAINT "WrongNote_slice4_current_review_check"`
      )
      await context.adminClient.query(
        `UPDATE "WrongNote"
         SET "currentReviewQuestionVersionId" = $2
         WHERE "id" = $1`,
        [fixture.noteId, fixture.versionId]
      )
      await context.adminClient.query(
        `ALTER TABLE "WrongNote"
         ADD CONSTRAINT "WrongNote_slice4_current_review_check"
         CHECK ("currentReviewQuestionVersionId" IS NULL) NOT VALID`
      )

      const migrationSql = readFileSync(
        join(
          sourceMigrationsDirectory,
          phase4Slice3Migrations[0],
          'migration.sql'
        ),
        'utf8'
      )
      await expect(
        context.adminClient.query(migrationSql)
      ).rejects.toMatchObject({
        code: '23514',
        message:
          'Slice 3 requires every existing current review pointer to be null.'
      })
      await context.adminClient.query('ROLLBACK')

      expect(await readLedger(context)).toHaveLength(22)
      const rolledBack = await context.adminClient.query<{
        constraintCount: number
        pointerCount: number
        selectionIndexCount: number
        wrongNoteFunction: string
      }>(
        `SELECT
          (
            SELECT COUNT(*)::int
            FROM "WrongNote"
            WHERE "id" = $1
              AND "currentReviewQuestionVersionId" = $2
          ) AS "pointerCount",
          (
            SELECT COUNT(*)::int
            FROM pg_constraint
            WHERE conrelid = '"WrongNote"'::regclass
              AND conname = 'WrongNote_slice4_current_review_check'
          ) AS "constraintCount",
          (
            SELECT COUNT(*)::int
            FROM pg_indexes
            WHERE schemaname = $3
              AND indexname =
                'StudySession_userId_level_subject_submittedAt_id_weakness_idx'
          ) AS "selectionIndexCount",
          pg_get_functiondef(
            'validate_wrong_note_change()'::regprocedure
          ) AS "wrongNoteFunction"`,
        [fixture.noteId, fixture.versionId, context.schemaName]
      )
      expect(rolledBack.rows[0]).toMatchObject({
        pointerCount: 1,
        constraintCount: 1,
        selectionIndexCount: 0
      })
      expect(rolledBack.rows[0]?.wrongNoteFunction).not.toContain(
        'WrongNote current review pointer cannot return to null.'
      )
    } finally {
      await context.adminClient.query('ROLLBACK').catch(() => undefined)
      await dispose(context)
    }
  }, 40_000)

  it('legacy DAILY_REVIEW + STUDY_SUBMIT evidence를 발견하면 원자 rollback한다', async () => {
    const context = await createIsolatedMigrationSchema()
    const startedAt = new Date('2026-08-18T02:00:00.000Z')
    const occurredAt = new Date('2026-08-18T02:00:10.000Z')

    try {
      await deployThroughPhase4Slice1(context)
      const fixture = await createLegacySubmissionFixture(context, {
        mode: 'DAILY_REVIEW',
        occurredAt,
        source: 'STUDY_SUBMIT',
        startedAt
      })

      const migrationSql = readFileSync(
        join(
          sourceMigrationsDirectory,
          phase4Slice3Migrations[0],
          'migration.sql'
        ),
        'utf8'
      )
      await expect(
        context.adminClient.query(migrationSql)
      ).rejects.toMatchObject({
        code: '23514',
        message:
          'Slice 3 requires every existing ReviewEvent source to match its mode.'
      })
      await context.adminClient.query('ROLLBACK')

      expect(await readLedger(context)).toHaveLength(22)
      const rolledBack = await context.adminClient.query<{
        selectionIndexCount: number
        sessionCount: number
        eventFunction: string
      }>(
        `SELECT
          (SELECT COUNT(*)::int FROM "StudySession" WHERE "id" = $1)
            AS "sessionCount",
          (
            SELECT COUNT(*)::int
            FROM pg_indexes
            WHERE schemaname = $2
              AND indexname =
                'StudySession_userId_level_subject_submittedAt_id_weakness_idx'
          ) AS "selectionIndexCount",
          pg_get_functiondef(
            'validate_review_event_change()'::regprocedure
          ) AS "eventFunction"`,
        [fixture.sessionId, context.schemaName]
      )
      expect(rolledBack.rows[0]).toMatchObject({
        sessionCount: 1,
        selectionIndexCount: 0
      })
      expect(rolledBack.rows[0]?.eventFunction).not.toContain(
        "evidence_mode NOT IN ('RANDOM', 'WEAKNESS', 'BOOKMARK')"
      )
    } finally {
      await context.adminClient.query('ROLLBACK').catch(() => undefined)
      await dispose(context)
    }
  }, 40_000)
})

describe('Phase 4 Slice 5 result retry migration', () => {
  it('reserved row preflight를 원자 rollback하고 clean deploy catalog를 고정한다', async () => {
    const context = await createIsolatedMigrationSchema()
    const now = new Date('2026-08-21T08:00:00.000Z')
    const userId = randomUUID()
    const legacySessionId = randomUUID()
    const retryRecordId = randomUUID()

    try {
      await deployThroughPhase4Slice4(context)
      await context.adminClient.query(
        `INSERT INTO "User" (
          "id", "name", "email", "emailVerified", "role",
          "accountStatus", "createdAt", "updatedAt"
        ) VALUES ($1, 'Slice 5 migration user', $2, true, 'USER',
          'ACTIVE', $3, $3)`,
        [userId, `slice5-migration-${randomUUID()}@example.test`, now]
      )
      await context.adminClient.query(
        `ALTER TABLE "StudySession"
         DISABLE TRIGGER "StudySession_validate_selection_complete"`
      )
      await context.adminClient.query(
        `INSERT INTO "StudySession" (
          "id", "userId", "level", "subject", "mode", "status",
          "requestedCount", "actualCount", "usedFallback", "startedAt",
          "expiresAt", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, 'N5', 'VOCABULARY', 'RANDOM', 'IN_PROGRESS',
          1, 1, false, $3, $3::timestamptz + INTERVAL '1 day', $3, $3
        )`,
        [legacySessionId, userId, now]
      )
      await context.adminClient.query(
        `ALTER TABLE "StudySession"
         ENABLE TRIGGER "StudySession_validate_selection_complete"`
      )
      await context.adminClient.query(
        `ALTER TABLE "IdempotencyRecord"
         DISABLE TRIGGER "IdempotencyRecord_validate_change"`
      )
      await context.adminClient.query(
        `ALTER TABLE "IdempotencyRecord"
         DISABLE TRIGGER "IdempotencyRecord_validate_committed_state"`
      )
      await context.adminClient.query(
        `INSERT INTO "IdempotencyRecord" (
          "id", "principalType", "userId", "operation", "idempotencyKey",
          "studySessionId", "requestHash", "contractVersion", "state",
          "createdAt"
        ) VALUES (
          $1, 'USER', $2, 'STUDY_RETRY_CREATE', $3, $4,
          repeat('c', 64), 2, 'PROCESSING', $5
        )`,
        [retryRecordId, userId, randomUUID(), legacySessionId, now]
      )
      await context.adminClient.query(
        `ALTER TABLE "IdempotencyRecord"
         ENABLE TRIGGER "IdempotencyRecord_validate_change"`
      )
      await context.adminClient.query(
        `ALTER TABLE "IdempotencyRecord"
         ENABLE TRIGGER "IdempotencyRecord_validate_committed_state"`
      )

      const migrationSql = readFileSync(
        join(
          sourceMigrationsDirectory,
          phase4Slice5Migrations[0],
          'migration.sql'
        ),
        'utf8'
      )
      await expect(
        context.adminClient.query(migrationSql)
      ).rejects.toMatchObject({
        code: '23514',
        message:
          'Slice 5 requires every reserved retry idempotency operation to have zero rows.'
      })
      await context.adminClient.query('ROLLBACK')
      expect(await readLedger(context)).toHaveLength(24)
      expect(
        (
          await context.adminClient.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count
             FROM information_schema.columns
             WHERE table_schema = $1
               AND table_name = 'StudySession'
               AND column_name = 'retryOfStudySessionId'`,
            [context.schemaName]
          )
        ).rows
      ).toEqual([{ count: 0 }])

      await context.adminClient.query(
        `ALTER TABLE "IdempotencyRecord"
         DISABLE TRIGGER "IdempotencyRecord_validate_change"`
      )
      await context.adminClient.query(
        `DELETE FROM "IdempotencyRecord" WHERE "id" = $1`,
        [retryRecordId]
      )
      await context.adminClient.query(
        `ALTER TABLE "IdempotencyRecord"
         ENABLE TRIGGER "IdempotencyRecord_validate_change"`
      )
      copyMigration(phase4Slice5Migrations[0], context.migrationsPath)
      await deploy(context)
      expect(await readLedger(context)).toHaveLength(25)

      const foreignKeys = await context.adminClient.query<{
        constraintName: string
        deleteAction: string
        initiallyDeferred: boolean
        isDeferrable: boolean
        updateAction: string
      }>(
        `SELECT
          constraint_entry.conname AS "constraintName",
          constraint_entry.condeferrable AS "isDeferrable",
          constraint_entry.condeferred AS "initiallyDeferred",
          constraint_entry.confdeltype::text AS "deleteAction",
          constraint_entry.confupdtype::text AS "updateAction"
         FROM pg_constraint AS constraint_entry
         JOIN pg_class AS relation ON relation.oid = constraint_entry.conrelid
         JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = $1
           AND constraint_entry.conname = ANY($2::text[])
         ORDER BY constraint_entry.conname`,
        [
          context.schemaName,
          [
            'StudySession_retryOfStudySessionId_fkey',
            'StudySession_retryOfStudySessionId_guestPrincipalId_fkey',
            'StudySession_retryOfStudySessionId_userId_fkey'
          ]
        ]
      )
      expect(foreignKeys.rows).toEqual(
        foreignKeys.rows.map((row) => ({
          ...row,
          deleteAction: 'a',
          initiallyDeferred: true,
          isDeferrable: true,
          updateAction: 'c'
        }))
      )
      expect(foreignKeys.rows).toHaveLength(3)

      const trigger = await context.adminClient.query<{
        initiallyDeferred: boolean
        isDeferrable: boolean
      }>(
        `SELECT
          trigger.tgdeferrable AS "isDeferrable",
          trigger.tginitdeferred AS "initiallyDeferred"
         FROM pg_trigger AS trigger
         JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
         JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = $1
           AND trigger.tgname = 'StudySession_validate_retry_relation'`,
        [context.schemaName]
      )
      expect(trigger.rows).toEqual([
        { initiallyDeferred: true, isDeferrable: true }
      ])

      const indexes = await context.adminClient.query<{
        indexDefinition: string
        indexName: string
      }>(
        `SELECT
          indexname AS "indexName",
          regexp_replace(indexdef, '\\s+', ' ', 'g') AS "indexDefinition"
         FROM pg_indexes
         WHERE schemaname = $1
           AND indexname = ANY($2::text[])
         ORDER BY indexname`,
        [
          context.schemaName,
          [
            'StudySession_retryOfStudySessionId_id_idx',
            'StudySession_retry_guest_source_idx',
            'StudySession_retry_user_source_idx'
          ]
        ]
      )
      expect(indexes.rows.map(({ indexName }) => indexName)).toEqual([
        'StudySession_retryOfStudySessionId_id_idx',
        'StudySession_retry_guest_source_idx',
        'StudySession_retry_user_source_idx'
      ])
      const indexDefinitions = new Map(
        indexes.rows.map(({ indexDefinition, indexName }) => [
          indexName,
          indexDefinition
        ])
      )
      expect(
        indexDefinitions.get('StudySession_retryOfStudySessionId_id_idx')
      ).toMatch(/\("retryOfStudySessionId", id\)/u)
      expect(
        indexDefinitions.get('StudySession_retry_user_source_idx')
      ).toMatch(
        /\("retryOfStudySessionId", "userId"\).*"retryOfStudySessionId" IS NOT NULL.*"userId" IS NOT NULL/u
      )
      expect(
        indexDefinitions.get('StudySession_retry_guest_source_idx')
      ).toMatch(
        /\("retryOfStudySessionId", "guestPrincipalId"\).*"retryOfStudySessionId" IS NOT NULL.*"guestPrincipalId" IS NOT NULL/u
      )

      const definitions = await context.adminClient.query<{
        idempotencyFunction: string
        reviewEventFunction: string
        retryFunction: string
      }>(
        `SELECT
          pg_get_functiondef(
            'validate_idempotency_record_committed_state()'::regprocedure
          ) AS "idempotencyFunction",
          pg_get_functiondef(
            'validate_review_event_change()'::regprocedure
          ) AS "reviewEventFunction",
          pg_get_functiondef(
            'validate_study_retry_relation()'::regprocedure
          ) AS "retryFunction"`
      )
      expect(definitions.rows[0]?.idempotencyFunction).toContain(
        "'STUDY_RETRY_CREATE'"
      )
      expect(definitions.rows[0]?.idempotencyFunction).toContain(
        'expected_retry_session'
      )
      expect(definitions.rows[0]?.reviewEventFunction).toContain(
        'evidence_retry_source_id'
      )
      expect(definitions.rows[0]?.retryFunction).toContain(
        'WITH RECURSIVE retry_ancestry AS'
      )

      const postMigrationLegacySessionId = randomUUID()
      await context.adminClient.query(
        `ALTER TABLE "StudySession"
         DISABLE TRIGGER "StudySession_validate_selection_complete"`
      )
      await context.adminClient.query(
        `INSERT INTO "StudySession" (
          "id", "userId", "level", "subject", "mode", "status",
          "requestedCount", "actualCount", "usedFallback", "startedAt",
          "expiresAt", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, 'N5', 'VOCABULARY', 'RANDOM', 'IN_PROGRESS',
          1, 1, false, $3, $3::timestamptz + INTERVAL '1 day', $3, $3
        )`,
        [postMigrationLegacySessionId, userId, now]
      )
      await context.adminClient.query(
        `ALTER TABLE "StudySession"
         ENABLE TRIGGER "StudySession_validate_selection_complete"`
      )
      expect(
        (
          await context.adminClient.query<{
            retryOfStudySessionId: string | null
          }>(
            `SELECT "retryOfStudySessionId"
             FROM "StudySession"
             WHERE "id" = $1`,
            [postMigrationLegacySessionId]
          )
        ).rows
      ).toEqual([{ retryOfStudySessionId: null }])
    } finally {
      await context.adminClient.query('ROLLBACK').catch(() => undefined)
      await dispose(context)
    }
  }, 40_000)

  it('deferred retry relation은 multi-row cycle을 거부한다', async () => {
    const context = await createIsolatedMigrationSchema()
    const now = new Date('2026-08-21T09:00:00.000Z')
    try {
      for (const migrationName of migrationNames) {
        copyMigration(migrationName, context.migrationsPath)
      }
      await deploy(context)
      await context.adminClient.query(
        `SET search_path TO ${context.quotedSchemaName}`
      )
      const userId = randomUUID()
      const sessionA = randomUUID()
      const sessionB = randomUUID()
      await context.adminClient.query(
        `INSERT INTO "User" (
          "id", "name", "email", "emailVerified", "role",
          "accountStatus", "createdAt", "updatedAt"
        ) VALUES ($1, 'Slice 5 cycle user', $2, true, 'USER',
          'ACTIVE', $3, $3)`,
        [userId, `slice5-cycle-${randomUUID()}@example.test`, now]
      )
      for (const triggerName of [
        'StudySession_validate_selection_complete',
        'StudySession_validate_submission_snapshot',
        'StudySession_validate_draft_aggregate'
      ]) {
        await context.adminClient.query(
          `ALTER TABLE "StudySession" DISABLE TRIGGER "${triggerName}"`
        )
      }
      await context.adminClient.query(
        `ALTER TABLE "StudyResult"
         DISABLE TRIGGER "StudyResult_validate_submission_snapshot"`
      )
      await context.adminClient.query('BEGIN')
      await context.adminClient.query(
        `INSERT INTO "StudySession" (
          "id", "userId", "retryOfStudySessionId", "level", "subject",
          "mode", "status", "requestedCount", "actualCount", "usedFallback",
          "practiceContractVersion", "startedAt", "expiresAt", "createdAt",
          "updatedAt"
        ) VALUES
          ($1, $3, $2, 'N5', 'VOCABULARY', 'WRONG_NOTE', 'IN_PROGRESS',
            1, 1, false, 2, $4, $4::timestamptz + INTERVAL '1 day', $4, $4),
          ($2, $3, $1, 'N5', 'VOCABULARY', 'WRONG_NOTE', 'IN_PROGRESS',
            1, 1, false, 2, $4, $4::timestamptz + INTERVAL '1 day', $4, $4)`,
        [sessionA, sessionB, userId, now]
      )
      for (const sessionId of [sessionA, sessionB]) {
        await context.adminClient.query(
          `INSERT INTO "StudyResult" (
            "id", "studySessionId", "totalCount", "correctCount",
            "incorrectCount", "correctRateBasisPoints", "durationSec",
            "gradingVersion", "createdAt"
          ) VALUES ($1, $2, 1, 0, 1, 0, 0, 'server-grading-v1', $3)`,
          [randomUUID(), sessionId, now]
        )
      }
      await context.adminClient.query(
        `UPDATE "StudySession"
         SET "status" = 'SUBMITTED', "submittedAt" = $2,
             "durationSec" = 0, "submissionHash" = repeat('d', 64),
             "updatedAt" = $2
         WHERE "id" = ANY($1::uuid[])`,
        [[sessionA, sessionB], now]
      )
      await expect(context.adminClient.query('COMMIT')).rejects.toMatchObject({
        code: '23514',
        message: 'Retry StudySession relation cannot contain a cycle.'
      })
      await context.adminClient.query('ROLLBACK')
    } finally {
      await context.adminClient.query('ROLLBACK').catch(() => undefined)
      await dispose(context)
    }
  }, 40_000)

  it('deferred retry relation은 다른 owner와 준비되지 않은 source를 거부한다', async () => {
    const context = await createIsolatedMigrationSchema()
    const now = new Date('2026-08-21T10:00:00.000Z')
    try {
      for (const migrationName of migrationNames) {
        copyMigration(migrationName, context.migrationsPath)
      }
      await deploy(context)
      await context.adminClient.query(
        `SET search_path TO ${context.quotedSchemaName}`
      )
      const ownerUserId = randomUUID()
      const foreignUserId = randomUUID()
      await context.adminClient.query(
        `INSERT INTO "User" (
          "id", "name", "email", "emailVerified", "role",
          "accountStatus", "createdAt", "updatedAt"
        ) VALUES
          ($1, 'Slice 5 relation owner', $3, true, 'USER',
            'ACTIVE', $5, $5),
          ($2, 'Slice 5 relation foreign', $4, true, 'USER',
            'ACTIVE', $5, $5)`,
        [
          ownerUserId,
          foreignUserId,
          `slice5-relation-owner-${randomUUID()}@example.test`,
          `slice5-relation-foreign-${randomUUID()}@example.test`,
          now
        ]
      )
      for (const triggerName of [
        'StudySession_validate_selection_complete',
        'StudySession_validate_submission_snapshot',
        'StudySession_validate_draft_aggregate'
      ]) {
        await context.adminClient.query(
          `ALTER TABLE "StudySession" DISABLE TRIGGER "${triggerName}"`
        )
      }
      await context.adminClient.query(
        `ALTER TABLE "StudyResult"
         DISABLE TRIGGER "StudyResult_validate_submission_snapshot"`
      )

      const submittedWithResultId = randomUUID()
      const inProgressSourceId = randomUUID()
      const submittedWithoutResultId = randomUUID()
      await context.adminClient.query('BEGIN')
      await context.adminClient.query(
        `INSERT INTO "StudySession" (
          "id", "userId", "level", "subject", "mode", "status",
          "requestedCount", "actualCount", "usedFallback",
          "practiceContractVersion", "startedAt", "expiresAt",
          "createdAt", "updatedAt"
        ) VALUES
          ($1, $4, 'N5', 'VOCABULARY', 'RANDOM', 'IN_PROGRESS',
            1, 1, false, 2, $5, $5::timestamptz + INTERVAL '1 day',
            $5, $5),
          ($2, $4, 'N5', 'VOCABULARY', 'RANDOM', 'IN_PROGRESS',
            1, 1, false, 2, $5, $5::timestamptz + INTERVAL '1 day',
            $5, $5),
          ($3, $4, 'N5', 'VOCABULARY', 'RANDOM', 'IN_PROGRESS',
            1, 1, false, 2, $5, $5::timestamptz + INTERVAL '1 day',
            $5, $5)`,
        [
          submittedWithResultId,
          inProgressSourceId,
          submittedWithoutResultId,
          ownerUserId,
          now
        ]
      )
      await context.adminClient.query(
        `INSERT INTO "StudyResult" (
          "id", "studySessionId", "totalCount", "correctCount",
          "incorrectCount", "correctRateBasisPoints", "durationSec",
          "gradingVersion", "createdAt"
        ) VALUES ($1, $2, 1, 0, 1, 0, 0, 'server-grading-v1', $3)`,
        [randomUUID(), submittedWithResultId, now]
      )
      await context.adminClient.query(
        `UPDATE "StudySession"
         SET "status" = 'SUBMITTED',
             "submittedAt" = $2::timestamptz + INTERVAL '1 hour',
             "durationSec" = 0,
             "submissionHash" = CASE
               WHEN "id" = $3 THEN repeat('a', 64)
               ELSE repeat('b', 64)
             END,
             "updatedAt" = $2::timestamptz + INTERVAL '1 hour'
         WHERE "id" = ANY($1::uuid[])`,
        [
          [submittedWithResultId, submittedWithoutResultId],
          now,
          submittedWithResultId
        ]
      )
      await context.adminClient.query('COMMIT')

      const insertRetryTarget = async (
        targetId: string,
        sourceId: string,
        userId: string
      ): Promise<void> => {
        await context.adminClient.query(
          `INSERT INTO "StudySession" (
            "id", "userId", "retryOfStudySessionId", "level", "subject",
            "mode", "status", "requestedCount", "actualCount",
            "usedFallback", "practiceContractVersion", "startedAt",
            "expiresAt", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, 'N5', 'VOCABULARY', 'WRONG_NOTE', 'IN_PROGRESS',
            1, 1, false, 2, $4, $4::timestamptz + INTERVAL '1 day', $4, $4
          )`,
          [targetId, userId, sourceId, now]
        )
      }

      const foreignTargetId = randomUUID()
      await context.adminClient.query('BEGIN')
      await insertRetryTarget(
        foreignTargetId,
        submittedWithResultId,
        foreignUserId
      )
      await expect(
        context.adminClient.query(
          'SET CONSTRAINTS "StudySession_retryOfStudySessionId_userId_fkey" IMMEDIATE'
        )
      ).rejects.toMatchObject({ code: '23503' })
      await context.adminClient.query('ROLLBACK')

      for (const sourceId of [inProgressSourceId, submittedWithoutResultId]) {
        const targetId = randomUUID()
        await context.adminClient.query('BEGIN')
        await insertRetryTarget(targetId, sourceId, ownerUserId)
        await expect(context.adminClient.query('COMMIT')).rejects.toMatchObject(
          {
            code: '23514',
            message:
              'Retry StudySession must reference one submitted result owned by the same actor.'
          }
        )
        await context.adminClient.query('ROLLBACK')
      }

      expect(
        await context.adminClient.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count
           FROM "StudySession"
           WHERE "retryOfStudySessionId" IS NOT NULL`
        )
      ).toMatchObject({ rows: [{ count: 0 }] })
    } finally {
      await context.adminClient.query('ROLLBACK').catch(() => undefined)
      await dispose(context)
    }
  }, 40_000)
})

describe('Phase 4 Slice 3 historical review pins', () => {
  it('v1 session A와 v2 session B를 역순 제출해도 event pin과 v2 pointer를 보존한다', async () => {
    const context = await createIsolatedMigrationSchema()

    try {
      for (const migrationName of migrationNames) {
        copyMigration(migrationName, context.migrationsPath)
      }
      await deploy(context)
      expect(await readLedger(context)).toHaveLength(25)

      const runtime = createDatabaseRuntime(context.databaseUrl)
      try {
        await runtime.checkReadiness()
        const client = runtime.client
        const sessionRepository = createPrismaStudySessionRepository(client)
        const submissionRepository =
          createPrismaStudySubmissionRepository(client)
        const userId = randomUUID()
        const questionId = randomUUID()
        const versionOneId = randomUUID()
        const versionTwoId = randomUUID()
        const tagId = randomUUID()
        const versionOneOptionIds = Array.from({ length: 4 }, () =>
          randomUUID()
        )
        const versionTwoOptionIds = Array.from({ length: 4 }, () =>
          randomUUID()
        )
        const versionOneCorrectOptionId = versionOneOptionIds[0]
        const versionTwoCorrectOptionId = versionTwoOptionIds[0]
        const baseTime = new Date('2026-08-18T03:00:00.000Z').getTime()

        if (!versionOneCorrectOptionId || !versionTwoCorrectOptionId) {
          throw new Error('Slice 3 historical pin options are required.')
        }

        await client.$transaction(async (transaction) => {
          await transaction.user.create({
            data: {
              id: userId,
              name: 'Slice 3 historical pin user',
              email: `slice3-history-${randomUUID()}@example.test`,
              emailVerified: true,
              createdAt: new Date(baseTime),
              updatedAt: new Date(baseTime)
            }
          })
          await transaction.question.create({
            data: {
              id: questionId,
              createdByLabelSnapshot: 'SYSTEM_SEED',
              createdAt: new Date(baseTime),
              updatedAt: new Date(baseTime)
            }
          })
          await transaction.questionVersion.create({
            data: {
              id: versionOneId,
              questionId,
              versionNumber: 1,
              level: 'N5',
              subject: 'VOCABULARY',
              questionType: 'KANJI_READING',
              questionText: 'Slice 3 historical pin fixture v1',
              explanationKo: '버전별 핀을 검증하는 원본 더미 설명입니다.',
              difficulty: 'EASY',
              createdByLabelSnapshot: 'SYSTEM_SEED',
              createdAt: new Date(baseTime),
              updatedAt: new Date(baseTime)
            }
          })
          await transaction.questionOption.createMany({
            data: versionOneOptionIds.map((id, index) => ({
              id,
              questionVersionId: versionOneId,
              label: String(index + 1),
              text: `Slice 3 v1 option ${index + 1}`,
              ordinal: index + 1
            }))
          })
          await transaction.tag.create({
            data: {
              id: tagId,
              label: 'Slice 3 historical pin',
              normalizedName: `slice3-historical-pin-${randomUUID()}`,
              createdAt: new Date(baseTime),
              updatedAt: new Date(baseTime)
            }
          })
          await transaction.questionVersionTag.create({
            data: {
              questionVersionId: versionOneId,
              tagId,
              labelSnapshot: 'Slice 3 historical pin'
            }
          })
          await transaction.questionVersion.update({
            where: { id: versionOneId },
            data: {
              correctOptionId: versionOneCorrectOptionId,
              status: 'PUBLISHED',
              publishedAt: new Date(baseTime)
            }
          })
          await transaction.question.update({
            where: { id: questionId },
            data: { currentPublishedVersionId: versionOneId }
          })
        })

        const owner = { kind: 'USER' as const, userId }
        const createPinnedHistory = async (startedAt: Date): Promise<void> => {
          const studySessionQuestionId = randomUUID()
          const session = await client.$transaction(async (transaction) => {
            const created = await transaction.studySession.create({
              data: {
                userId,
                level: 'N5',
                subject: 'VOCABULARY',
                mode: 'RANDOM',
                requestedCount: 1,
                actualCount: 1,
                usedFallback: false,
                startedAt,
                expiresAt: new Date(startedAt.getTime() + DAY_MS)
              },
              select: { id: true }
            })
            await transaction.studySessionQuestion.create({
              data: {
                id: studySessionQuestionId,
                studySessionId: created.id,
                questionId,
                questionVersionId: versionOneId,
                ordinal: 1,
                createdAt: startedAt
              }
            })
            return created
          })
          await createStudySubmissionService(
            submissionRepository,
            () => new Date(startedAt.getTime() + 100)
          ).submit(
            session.id,
            randomUUID(),
            {
              answers: [
                {
                  studySessionQuestionId,
                  selectedOptionId: null,
                  elapsedSec: 1
                }
              ],
              durationSec: 1
            },
            owner
          )
        }

        for (let index = 0; index < 3; index += 1) {
          await createPinnedHistory(new Date(baseTime + index * 1_000))
        }

        const sessionAStartedAt = new Date(baseTime + 10_000)
        const sessionA = (
          await sessionRepository.create({
            level: 'N5',
            subject: 'VOCABULARY',
            mode: 'WRONG_NOTE',
            owner,
            requestedCount: 1,
            practiceContractVersion: 2,
            startedAt: sessionAStartedAt,
            expiresAt: new Date(sessionAStartedAt.getTime() + DAY_MS)
          })
        ).session
        expect(sessionA.questions[0]?.question.questionVersionId).toBe(
          versionOneId
        )
        await expect(
          client.wrongNote.findUniqueOrThrow({
            where: { userId_questionId: { userId, questionId } },
            select: { currentReviewQuestionVersionId: true }
          })
        ).resolves.toEqual({ currentReviewQuestionVersionId: versionOneId })

        const versionTwoPublishedAt = new Date(baseTime + 20_000)
        await client.$transaction(async (transaction) => {
          await transaction.questionVersion.create({
            data: {
              id: versionTwoId,
              questionId,
              versionNumber: 2,
              level: 'N5',
              subject: 'VOCABULARY',
              questionType: 'KANJI_READING',
              questionText: 'Slice 3 historical pin fixture v2',
              explanationKo: '새 버전 포인터를 검증하는 원본 더미 설명입니다.',
              difficulty: 'EASY',
              createdByLabelSnapshot: 'SYSTEM_SEED',
              createdAt: versionTwoPublishedAt,
              updatedAt: versionTwoPublishedAt
            }
          })
          await transaction.questionOption.createMany({
            data: versionTwoOptionIds.map((id, index) => ({
              id,
              questionVersionId: versionTwoId,
              label: String(index + 1),
              text: `Slice 3 v2 option ${index + 1}`,
              ordinal: index + 1
            }))
          })
          await transaction.questionVersionTag.create({
            data: {
              questionVersionId: versionTwoId,
              tagId,
              labelSnapshot: 'Slice 3 historical pin'
            }
          })
          await transaction.questionVersion.update({
            where: { id: versionTwoId },
            data: {
              correctOptionId: versionTwoCorrectOptionId,
              status: 'PUBLISHED',
              publishedAt: versionTwoPublishedAt
            }
          })
          await transaction.question.update({
            where: { id: questionId },
            data: { currentPublishedVersionId: versionTwoId }
          })
          await transaction.questionVersion.update({
            where: { id: versionOneId },
            data: {
              status: 'RETIRED',
              retiredAt: versionTwoPublishedAt
            }
          })
        })

        const sessionBStartedAt = new Date(baseTime + 30_000)
        const sessionB = (
          await sessionRepository.create({
            level: 'N5',
            subject: 'VOCABULARY',
            mode: 'WRONG_NOTE',
            owner,
            requestedCount: 1,
            practiceContractVersion: 2,
            startedAt: sessionBStartedAt,
            expiresAt: new Date(sessionBStartedAt.getTime() + DAY_MS)
          })
        ).session
        expect(sessionB.questions[0]?.question.questionVersionId).toBe(
          versionTwoId
        )
        await expect(
          client.wrongNote.findUniqueOrThrow({
            where: { userId_questionId: { userId, questionId } },
            select: { currentReviewQuestionVersionId: true }
          })
        ).resolves.toEqual({ currentReviewQuestionVersionId: versionTwoId })

        const submitReviewSession = async (
          sessionId: string,
          submittedAt: Date
        ): Promise<void> => {
          const question = await client.studySessionQuestion.findFirstOrThrow({
            where: { studySessionId: sessionId },
            select: { id: true }
          })
          await createStudySubmissionService(
            submissionRepository,
            () => new Date(submittedAt)
          ).submit(
            sessionId,
            randomUUID(),
            {
              answers: [
                {
                  studySessionQuestionId: question.id,
                  selectedOptionId: null,
                  elapsedSec: 0
                }
              ],
              durationSec: 0,
              expectedDraftRevision: 0
            },
            owner,
            2
          )
        }

        await submitReviewSession(sessionB.id, new Date(baseTime + 30_100))
        await submitReviewSession(sessionA.id, new Date(baseTime + 30_200))

        await expect(
          client.reviewEvent.findMany({
            where: { studySessionId: { in: [sessionA.id, sessionB.id] } },
            orderBy: { occurredAt: 'asc' },
            select: {
              source: true,
              studySessionId: true,
              questionVersionId: true
            }
          })
        ).resolves.toEqual([
          {
            source: 'WRONG_NOTE_REVIEW',
            studySessionId: sessionB.id,
            questionVersionId: versionTwoId
          },
          {
            source: 'WRONG_NOTE_REVIEW',
            studySessionId: sessionA.id,
            questionVersionId: versionOneId
          }
        ])
        await expect(
          client.wrongNote.findUniqueOrThrow({
            where: { userId_questionId: { userId, questionId } },
            select: {
              currentReviewQuestionVersionId: true,
              lastWrongQuestionVersionId: true
            }
          })
        ).resolves.toEqual({
          currentReviewQuestionVersionId: versionTwoId,
          lastWrongQuestionVersionId: versionOneId
        })
      } finally {
        await runtime.disconnect()
      }
    } finally {
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
          !slice5Migrations.includes(
            name as (typeof slice5Migrations)[number]
          ) &&
          !phase4Slice1Migrations.includes(
            name as (typeof phase4Slice1Migrations)[number]
          ) &&
          !phase4Slice3Migrations.includes(
            name as (typeof phase4Slice3Migrations)[number]
          ) &&
          !phase4Slice4Migrations.includes(
            name as (typeof phase4Slice4Migrations)[number]
          ) &&
          !phase4Slice5Migrations.includes(
            name as (typeof phase4Slice5Migrations)[number]
          )
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
