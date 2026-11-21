import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { getDailyQuestionResponseSchema } from '@nihongo/contracts/question/get-daily-question'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildAllQuestionSeeds,
  seedQuestionCatalog,
  verifyExistingQuestionSeed
} from '../../prisma/seedQuestionCatalog.js'
import { createApiApp } from '../app/createApp.js'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { Prisma } from '../generated/prisma/client.js'
import { createApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createJsonLogger } from '../observability/logger.js'
import {
  DAILY_SHEET_MAX_CHARACTERS,
  createDailyQuestionService,
  createPrismaDailyQuestionRepository,
  dailySheetLength,
  dailySheetLengthSql,
  toDayNumber
} from './dailyQuestion.js'
import {
  RUSH_WORD_ROWS_SQL,
  applyRushWordLoad,
  parseRushWordList,
  planRushWordLoad,
  type RushWordRow
} from '../content/rushWordList.js'
import { createPrismaQuestionRepository } from './questionRepository.js'
import {
  createPrismaRushKanjiPairsRepository,
  createRushKanjiPairsReader
} from './rushKanjiPairs.js'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const isCurrentSourceIntegration =
  process.env.API_INTEGRATION_CURRENT_SOURCE === '1'
const fixtureDatabaseUrl = process.env.API_INTEGRATION_FIXTURE_DATABASE_URL
if (isCurrentSourceIntegration && !fixtureDatabaseUrl) {
  throw new Error('Question catalog requires a fixture database.')
}
if (fixtureDatabaseUrl) {
  assertSafeTestDatabase({
    nodeEnvironment: environment.NODE_ENV,
    databaseUrl: fixtureDatabaseUrl,
    productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
  })
}

const database = createDatabaseRuntime(
  environment.DATABASE_URL,
  isCurrentSourceIntegration
    ? { migrationProfile: 'current', startupRole: 'nihongo_app' }
    : {}
)
const readingPassageMigrationFile = new URL(
  '../../prisma/migrations/20261127090000_reading_passage/migration.sql',
  import.meta.url
)
const fixtureDatabase = fixtureDatabaseUrl
  ? createDatabaseRuntime(fixtureDatabaseUrl)
  : database
const questionRepository = createPrismaQuestionRepository(database.client)
const rushWordListFile = fileURLToPath(
  new URL('../../../../content/rush/kanji-words.v1.json', import.meta.url)
)
const applicationRateLimiter = createApplicationRateLimiter({
  client: database.client,
  keySecret: environment.GUEST_COOKIE_SECRET
})
const dailyQuestionRepository = createPrismaDailyQuestionRepository(
  database.client
)
const app = createApiApp({
  checkReadiness: database.checkReadiness,
  logger: createJsonLogger('silent'),
  dailyQuestionReader: createDailyQuestionService(dailyQuestionRepository),
  questionReadSecurity: {
    environment,
    rateLimiter: applicationRateLimiter
  }
})

const DAILY_QUESTION_RATE_LIMIT_PREFIX = 'application:daily-question-read:'

const resetQuestionRateLimits = async (): Promise<void> => {
  await database.client.rateLimit.deleteMany({
    where: {
      key: { startsWith: DAILY_QUESTION_RATE_LIMIT_PREFIX }
    }
  })
}

interface RawDatabaseErrorIdentity {
  readonly message: string
  readonly sqlState: string
}

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const readRawDatabaseErrorIdentity = (
  error: unknown
): RawDatabaseErrorIdentity | undefined => {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2010' ||
    !isUnknownRecord(error.meta)
  ) {
    return undefined
  }
  const identities: RawDatabaseErrorIdentity[] = []
  if (
    typeof error.meta.code === 'string' &&
    typeof error.meta.message === 'string'
  ) {
    identities.push({ message: error.meta.message, sqlState: error.meta.code })
  }
  const driverAdapterError = error.meta.driverAdapterError
  if (isUnknownRecord(driverAdapterError)) {
    const cause = driverAdapterError.cause
    if (
      isUnknownRecord(cause) &&
      typeof cause.originalCode === 'string' &&
      typeof cause.originalMessage === 'string'
    ) {
      identities.push({
        message: cause.originalMessage,
        sqlState: cause.originalCode
      })
    }
  }
  const [identity, ...rest] = identities
  if (
    !identity ||
    rest.some(
      (candidate) =>
        candidate.sqlState !== identity.sqlState ||
        candidate.message !== identity.message
    )
  ) {
    return undefined
  }
  return {
    message:
      identity.message
        .split('\n', 1)[0]
        ?.replace(/^ERROR:\s*/u, '')
        .trim() ?? '',
    sqlState: identity.sqlState
  }
}

const expectRawDatabaseError = async ({
  expectedMessage,
  operation,
  sqlState
}: {
  readonly expectedMessage: string
  readonly operation: () => Promise<unknown>
  readonly sqlState: string
}): Promise<void> => {
  let caughtError: unknown
  try {
    await operation()
  } catch (error: unknown) {
    caughtError = error
  }
  expect(caughtError).toMatchObject({ code: 'P2010' })
  expect(readRawDatabaseErrorIdentity(caughtError)).toEqual({
    message: expectedMessage,
    sqlState
  })
}

beforeEach(resetQuestionRateLimits)
afterEach(resetQuestionRateLimits)

afterAll(async () => {
  await resetQuestionRateLimits()
  if (fixtureDatabase !== database) {
    await fixtureDatabase.disconnect()
  }
  await database.disconnect()
})

describe('question catalog PostgreSQL integration', () => {
  it('65개 자체 제작 seed를 재실행해도 published data를 변경하지 않는다', async () => {
    await expect(seedQuestionCatalog(database.client)).resolves.toEqual({
      insertedCount: 0,
      verifiedCount: 65
    })

    const [questionCount, versions, optionCount, versionTagCount] =
      await Promise.all([
        database.client.question.count(),
        database.client.questionVersion.findMany({
          where: { status: 'PUBLISHED', versionNumber: 1 },
          select: {
            _count: { select: { options: true, tags: true } }
          }
        }),
        database.client.questionOption.count(),
        database.client.questionVersionTag.count()
      ])

    expect({
      questionCount,
      versionCount: versions.length,
      optionCount,
      versionTagCount
    }).toEqual({
      questionCount: 65,
      versionCount: 65,
      optionCount: 260,
      versionTagCount: 130
    })
    expect(
      versions.every(({ _count }) => _count.options === 4 && _count.tags >= 1)
    ).toBe(true)
  })

  it('오늘의 한 문제는 날짜마다 md5 순서로 돌고 독해·다른 급수·원고지를 넘는 문제는 고르지 않는다 (JLP-815, #1087)', async () => {
    const levelQuestions = buildAllQuestionSeeds().filter(
      ({ level, subject }) => level === 'N5' && subject !== 'READING'
    )
    const candidates = levelQuestions
      .filter(
        ({ questionText }) =>
          dailySheetLength(questionText) <= DAILY_SHEET_MAX_CHARACTERS
      )
      .map(({ questionId }) => questionId)
      .toSorted((left, right) => {
        const leftHash = createHash('md5').update(left).digest('hex')
        const rightHash = createHash('md5').update(right).digest('hex')
        return leftHash === rightHash
          ? left.localeCompare(right)
          : leftHash.localeCompare(rightHash)
      })
    expect(candidates.length).toBeGreaterThan(1)
    // The seed has N5 questions longer than the sheet; they never come up.
    expect(candidates.length).toBeLessThan(levelQuestions.length)

    const day = toDayNumber('2026-11-10')
    const picked: string[] = []
    for (let offset = 0; offset < candidates.length; offset += 1) {
      const record = await dailyQuestionRepository.findDaily('N5', day + offset)
      expect(record?.level).toBe('N5')
      expect(record?.subject).not.toBe('READING')
      picked.push(record!.id)
    }
    expect(picked).toEqual(
      candidates.map(
        (_, offset) => candidates[(day + offset) % candidates.length]
      )
    )
    // One full turn shows every candidate once.
    expect(new Set(picked).size).toBe(candidates.length)
    await expect(
      dailyQuestionRepository.findDaily('N5', day)
    ).resolves.toMatchObject({ id: picked[0] })

    const response = await app.request('/api/v1/daily-question?level=N5')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toMatch(
      /^public, max-age=\d+$/
    )
    const body = getDailyQuestionResponseSchema.parse(await response.json())
    expect(candidates).toContain(body.question.id)
    expect(body.question.options.map(({ id }) => id)).toContain(
      body.question.correctOptionId
    )
  })

  it('러시 한자 쌍은 운영자가 넣은 RushKanjiWord로 만들고 앱은 읽기만 한다 (#1043)', async () => {
    const levels = ['N5', 'N4', 'N3', 'N2', 'N1'] as const
    // Migrations create the table empty; only the operator load fills it.
    expect(
      await createPrismaRushKanjiPairsRepository(database.client).listPairs(
        levels
      )
    ).toEqual([])
    if (isCurrentSourceIntegration) {
      await expect(
        database.client.$executeRaw`
          INSERT INTO "RushKanjiWord" ("sourceKey", "level", "word",
            "reading", "wrong")
          VALUES ('app-write', 'N5', '駅', 'えき',
            ARRAY['いき', 'えぎ', 'えく'])
        `
      ).rejects.toThrow(/permission denied/u)
    }

    // The repository file, loaded the way the operator command loads it, in
    // a transaction that rolls back.
    const list = parseRushWordList(await readFile(rushWordListFile))
    const rollback = new Error('rush word load rolled back')
    await expect(
      fixtureDatabase.client.$transaction(
        async (transaction) => {
          const rows = () =>
            transaction.$queryRawUnsafe<RushWordRow[]>(RUSH_WORD_ROWS_SQL)
          const plan = planRushWordLoad(list, await rows())
          expect(plan.steps).toHaveLength(list.words.length)
          await applyRushWordLoad(
            async (sql, values) =>
              await transaction.$executeRawUnsafe(sql, ...values),
            plan
          )
          expect(planRushWordLoad(list, await rows())).toEqual({
            steps: [],
            unchanged: list.words.length
          })

          const repository = createPrismaRushKanjiPairsRepository(transaction)
          const byWord = new Map(
            list.words.map((word) => [`${word.level}:${word.word}`, word])
          )
          const records = await repository.listPairs(levels)
          expect(records).toHaveLength(list.words.length)
          for (const record of records) {
            const word = byWord.get(`${record.level}:${record.word}`)
            expect(record).toEqual({
              id: expect.stringMatching(/^[0-9a-f-]{36}$/u),
              level: word?.level,
              word: word?.word,
              answer: word?.reading,
              wrong: word?.wrong
            })
          }
          // Each level has its own words; none is filled from another level.
          const reader = createRushKanjiPairsReader(repository)
          for (const level of levels) {
            const response = await reader.read(level)
            expect(response.pairs.length).toBe(
              list.words.filter((word) => word.level === level).length
            )
            for (const pair of response.pairs) {
              expect(byWord.get(`${level}:${pair.word}`)?.reading).toBe(
                pair.answer
              )
            }
          }
          throw rollback
        },
        { timeout: 60_000 }
      )
    ).rejects.toBe(rollback)

    // The table refuses a conjugated word and a repeated wrong reading.
    for (const [word, wrong, constraint] of [
      ['聞きました', ['きく', 'ぎく', 'きぐ'], 'RushKanjiWord_word_check'],
      ['聞く', ['ぎく', 'ぎく', 'きぐ'], 'RushKanjiWord_wrong_check']
    ] as const) {
      await expect(
        fixtureDatabase.client.$executeRaw`
          INSERT INTO "RushKanjiWord" ("sourceKey", "level", "word",
            "reading", "wrong")
          VALUES ('check-probe', 'N5', ${word}, 'きく', ${[...wrong]}::text[])
        `
      ).rejects.toThrow(constraint)
    }
    expect(
      await createPrismaRushKanjiPairsRepository(database.client).listPairs(
        levels
      )
    ).toEqual([])
  })

  it('독해 지문은 지문 표에 한 번만 두고, migration 옮기기 앞뒤 수가 같다 (#986)', async () => {
    // The probe changes the table as the fixture owner, in a rolled-back
    // transaction; only the current-source run has that connection.
    if (!isCurrentSourceIntegration) return
    await expect(
      database.client.$executeRaw`
        INSERT INTO "ReadingPassage" ("level", "subject", "text", "textMd5")
        VALUES ('N5', 'READING', 'app-write', md5('app-write'))
      `
    ).rejects.toThrow(/permission denied/u)
    const migration = await readFile(readingPassageMigrationFile, 'utf8')
    const backfill = migration
      .slice(
        migration.indexOf('-- backfill:start'),
        migration.indexOf('-- backfill:end')
      )
      .split(/;\n/u)
      .filter((sql) => sql.replace(/^--.*$/gmu, '').trim() !== '')
    type Counts = {
      withPassage: number
      linked: number
      texts: number
      passages: number
      broken: number
    }
    const counts = async (
      transaction: Prisma.TransactionClient
    ): Promise<Counts> => {
      const [row] = await transaction.$queryRaw<Counts[]>`
        SELECT
          count(*) FILTER (WHERE "passage" IS NOT NULL)::integer
            AS "withPassage",
          count(*) FILTER (WHERE "passageId" IS NOT NULL)::integer AS "linked",
          count(DISTINCT ("level", "subject", "passage")) FILTER (
            WHERE "passage" IS NOT NULL
          )::integer AS "texts",
          (SELECT count(*)::integer FROM "ReadingPassage") AS "passages",
          count(*) FILTER (
            WHERE ("passage" IS NULL) <> ("passageId" IS NULL)
              OR ("passageId" IS NULL) <> ("passageOrder" IS NULL)
          )::integer AS "broken"
        FROM "QuestionVersion"
      `
      return row!
    }

    const createProbe = async (transaction: Prisma.TransactionClient) => {
      // Two imported questions on one passage; the import lists the larger
      // id first, so the place follows the import, not the id.
      const [first, second] = [randomUUID(), randomUUID()].sort().reverse() as [
        string,
        string
      ]
      const text = `#986 지문 ${randomUUID()}`
      for (const id of [first, second]) {
        await transaction.question.create({
          data: { id, createdByLabelSnapshot: 'SYSTEM_SEED' }
        })
      }
      await transaction.$executeRaw`
        INSERT INTO "QuestionImportResult" (
          "importId", "actorUserId", "requestDigest", "response"
        ) VALUES (
          ${randomUUID()}::uuid, ${randomUUID()}::uuid, ${'0'.repeat(64)},
          ${JSON.stringify({
            response: { items: [{ questionId: first }, { questionId: second }] }
          })}::jsonb
        )
      `
      const createVersion = (
        questionId: string,
        versionNumber: number,
        passage: string
      ) =>
        transaction.questionVersion.create({
          data: {
            id: randomUUID(),
            questionId,
            versionNumber,
            createdByLabelSnapshot: 'SYSTEM_SEED',
            level: 'N3',
            subject: 'READING',
            questionType: 'SHORT_READING',
            passage,
            questionText: `#986 ${questionId} ${versionNumber}`,
            explanationKo: '같은 지문 묶음',
            difficulty: 'EASY'
          },
          select: { id: true, passageId: true, passageOrder: true }
        })
      return { first, second, text, createVersion }
    }
    const rollback = new Error('reading passage probe rolled back')

    // 1) The migration's own backfill SQL on versions without a link, as
    // before the migration: every passage version is linked, one row per
    // text, in import order. Table changes come first, before any row
    // write queues the deferred content checks.
    await expect(
      fixtureDatabase.client.$transaction(
        async (transaction) => {
          const seeded = await counts(transaction)
          expect(seeded.withPassage).toBeGreaterThan(0)
          expect(seeded).toMatchObject({
            linked: seeded.withPassage,
            passages: seeded.texts,
            broken: 0
          })
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "QuestionVersion" DISABLE TRIGGER "QuestionVersion_link_passage"'
          )
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "QuestionVersion" DROP CONSTRAINT "QuestionVersion_passage_link_check"'
          )
          await transaction.$executeRawUnsafe(
            'UPDATE "QuestionVersion" SET "passageId" = NULL, "passageOrder" = NULL'
          )
          await transaction.$executeRawUnsafe('DELETE FROM "ReadingPassage"')
          const { first, second, text, createVersion } =
            await createProbe(transaction)
          const secondVersion = await createVersion(second, 1, text)
          const firstVersion = await createVersion(first, 1, text)
          const before = await counts(transaction)
          expect(before).toMatchObject({
            withPassage: seeded.withPassage + 2,
            texts: seeded.texts + 1,
            linked: 0,
            passages: 0
          })

          for (const sql of backfill) {
            await transaction.$executeRawUnsafe(sql)
          }
          expect(await counts(transaction)).toEqual({
            ...before,
            linked: before.withPassage,
            passages: before.texts,
            broken: 0
          })
          const placed = await transaction.questionVersion.findMany({
            where: { id: { in: [firstVersion.id, secondVersion.id] } },
            select: { id: true, passageId: true, passageOrder: true }
          })
          expect(
            Object.fromEntries(placed.map((row) => [row.id, row.passageOrder]))
          ).toEqual({ [firstVersion.id]: 1, [secondVersion.id]: 2 })
          expect(new Set(placed.map((row) => row.passageId)).size).toBe(1)
          throw rollback
        },
        { timeout: 60_000 }
      )
    ).rejects.toBe(rollback)

    // 2) After the migration the trigger links every write: a question new
    // to a passage takes the next place, a new version keeps its question's
    // place, a caller cannot move the link, and a changed text links to its
    // own row while the old row keeps its text.
    await expect(
      fixtureDatabase.client.$transaction(
        async (transaction) => {
          const { first, second, text, createVersion } =
            await createProbe(transaction)
          const secondV1 = await createVersion(second, 1, text)
          const firstV1 = await createVersion(first, 1, text)
          expect(secondV1.passageOrder).toBe(1)
          expect(firstV1).toMatchObject({
            passageId: secondV1.passageId,
            passageOrder: 2
          })
          // A new draft of a published question keeps that question's
          // place under its passage.
          const [published] = await transaction.$queryRaw<
            Array<{
              questionId: string
              versionNumber: number
              level: 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
              subject: 'READING' | 'GRAMMAR'
              questionType: 'SHORT_READING'
              passage: string
              passageId: string
              passageOrder: number
            }>
          >`
            SELECT version."questionId", version."versionNumber",
              version."level", version."subject", version."questionType",
              version."passage", version."passageId",
              version."passageOrder"::integer AS "passageOrder"
            FROM "QuestionVersion" AS version
            JOIN "Question" AS question
              ON question."currentPublishedVersionId" = version."id"
            WHERE version."passage" IS NOT NULL
            ORDER BY version."id"
            LIMIT 1
          `
          const draft = await transaction.questionVersion.create({
            data: {
              id: randomUUID(),
              questionId: published!.questionId,
              versionNumber: published!.versionNumber + 1,
              createdByLabelSnapshot: 'SYSTEM_SEED',
              level: published!.level,
              subject: published!.subject,
              questionType: published!.questionType,
              passage: published!.passage,
              questionText: '#986 새 버전',
              explanationKo: '같은 자리',
              difficulty: 'EASY'
            },
            select: { id: true, passageId: true, passageOrder: true }
          })
          expect(draft).toMatchObject({
            passageId: published!.passageId,
            passageOrder: published!.passageOrder
          })
          expect(
            await transaction.questionVersion.update({
              where: { id: draft.id },
              data: { passageId: null, passageOrder: 9 },
              select: { passageId: true, passageOrder: true }
            })
          ).toEqual({
            passageId: published!.passageId,
            passageOrder: published!.passageOrder
          })
          const edited = await transaction.questionVersion.update({
            where: { id: draft.id },
            data: { passage: `${published!.passage} 고침` },
            select: { passageId: true, passageOrder: true }
          })
          expect(edited.passageId).not.toBe(published!.passageId)
          expect(edited.passageOrder).toBe(1)
          expect(
            await transaction.readingPassage.findUniqueOrThrow({
              where: { id: published!.passageId },
              select: { text: true }
            })
          ).toEqual({ text: published!.passage })
          expect((await counts(transaction)).broken).toBe(0)
          throw rollback
        },
        { timeout: 60_000 }
      )
    ).rejects.toBe(rollback)
  })

  it('오늘의 한 문제 원고지 글자 수는 SQL과 웹 카드가 같게 센다 (#1087)', async () => {
    const texts = [
      'あ'.repeat(36),
      'あ'.repeat(37),
      `${'あ'.repeat(18)} ${'い'.repeat(18)}`,
      `わたし\u3000は\tがくせい\nです。\u00a0\ufeff`,
      `${'𠮷'.repeat(35)}野`,
      `${'𠮷'.repeat(37)}`
    ]
    for (const text of texts) {
      const rows = await database.client.$queryRaw<{ length: number }[]>(
        Prisma.sql`SELECT ${dailySheetLengthSql(Prisma.sql`${text}::text`)}::int AS length`
      )
      expect(rows[0]?.length, JSON.stringify(text)).toBe(dailySheetLength(text))
    }
    expect(texts.map(dailySheetLength)).toEqual([36, 37, 36, 11, 36, 37])
  })

  it(
    isCurrentSourceIntegration
      ? 'published seed version과 option/tag snapshot이 그대로 남아 있다'
      : 'published version과 option/tag snapshot 수정을 DB에서 거부한다',
    async () => {
      const seed = buildAllQuestionSeeds()[0]

      if (!seed) {
        throw new Error('Question seed fixture가 필요합니다.')
      }

      if (isCurrentSourceIntegration) {
        // Published content immutability is an admin command rule in the API
        // since #504 P4 (adminQuestionCommandRepository integration test).
        await expect(
          verifyExistingQuestionSeed(database.client, seed)
        ).resolves.toBeUndefined()
        return
      }

      await expect(
        database.client.questionVersion.update({
          where: { id: seed.versionId },
          data: { questionText: '변조된 질문' }
        })
      ).rejects.toThrow()
      await expect(
        database.client.questionOption.update({
          where: { id: seed.options[0]!.id },
          data: { text: '변조된 보기' }
        })
      ).rejects.toThrow()
      await expect(
        database.client.questionVersionTag.delete({
          where: { id: seed.tags[0]!.versionTagId }
        })
      ).rejects.toThrow()
    }
  )

  it('published option과 tag를 draft version으로 옮길 수 없다', async () => {
    const seed = buildAllQuestionSeeds()[0]
    const targetSeed = buildAllQuestionSeeds()[1]

    if (!seed || !targetSeed) {
      throw new Error('Question seed pair fixture가 필요합니다.')
    }

    const movableOption = seed.options.find(
      ({ id }) => id !== seed.correctOptionId
    )

    if (!movableOption) {
      throw new Error('정답이 아닌 option fixture가 필요합니다.')
    }

    if (isCurrentSourceIntegration) {
      // The editable-parent rule moved to the API (#504 P4); the option label
      // key still refuses this raw move. The raw tag move has no DB guard left.
      await expectRawDatabaseError({
        expectedMessage:
          'duplicate key value violates unique constraint "QuestionOption_questionVersionId_label_key"',
        operation: async () =>
          await fixtureDatabase.client.$transaction(async (transaction) => {
            await transaction.$executeRaw`
              UPDATE "QuestionOption"
              SET "questionVersionId" = ${targetSeed.versionId}::uuid
              WHERE "id" = ${movableOption.id}::uuid
            `
          }),
        sqlState: '23505'
      })
      await expect(
        Promise.all([
          verifyExistingQuestionSeed(database.client, seed),
          verifyExistingQuestionSeed(database.client, targetSeed)
        ])
      ).resolves.toEqual([undefined, undefined])
      return
    }

    await expect(
      database.client.$transaction(async (transaction) => {
        const questionId = randomUUID()
        const versionId = randomUUID()

        await transaction.question.create({
          data: { id: questionId, createdByLabelSnapshot: 'SYSTEM_SEED' }
        })
        await transaction.questionVersion.create({
          data: {
            id: versionId,
            questionId,
            versionNumber: 1,
            createdByLabelSnapshot: 'SYSTEM_SEED',
            level: 'N5',
            subject: 'VOCABULARY',
            questionType: 'KANJI_READING',
            questionText: '이동 대상 draft 문제',
            explanationKo: 'published child 이동을 차단합니다.',
            difficulty: 'EASY'
          }
        })
        await transaction.questionOption.update({
          where: { id: movableOption.id },
          data: { questionVersionId: versionId }
        })
      })
    ).rejects.toThrow()

    await expect(
      database.client.$transaction(async (transaction) => {
        const questionId = randomUUID()
        const versionId = randomUUID()

        await transaction.question.create({
          data: { id: questionId, createdByLabelSnapshot: 'SYSTEM_SEED' }
        })
        await transaction.questionVersion.create({
          data: {
            id: versionId,
            questionId,
            versionNumber: 1,
            createdByLabelSnapshot: 'SYSTEM_SEED',
            level: 'N5',
            subject: 'VOCABULARY',
            questionType: 'KANJI_READING',
            questionText: '이동 대상 draft 문제',
            explanationKo: 'published tag 이동을 차단합니다.',
            difficulty: 'EASY'
          }
        })
        await transaction.questionVersionTag.update({
          where: { id: seed.tags[0]!.versionTagId },
          data: { questionVersionId: versionId }
        })
      })
    ).rejects.toThrow()
  })

  it(
    isCurrentSourceIntegration
      ? 'Application role은 catalog aggregate를 hard delete할 수 없다'
      : '참조되지 않은 draft aggregate를 cascade 삭제할 수 있다',
    async () => {
      if (isCurrentSourceIntegration) {
        const seed = buildAllQuestionSeeds()[0]
        const tag = seed?.tags[0]
        if (!seed || !tag) {
          throw new Error('Question seed aggregate fixture가 필요합니다.')
        }
        const countsBefore = await Promise.all([
          database.client.question.count(),
          database.client.questionVersion.count(),
          database.client.tag.count()
        ])

        await expectRawDatabaseError({
          expectedMessage: 'permission denied for table Question',
          operation: async () =>
            await database.client.$executeRaw`
              DELETE FROM "Question"
              WHERE "id" = ${seed.questionId}::uuid
            `,
          sqlState: '42501'
        })
        await expectRawDatabaseError({
          expectedMessage: 'permission denied for table Tag',
          operation: async () =>
            await database.client.$executeRaw`
              DELETE FROM "Tag"
              WHERE "id" = ${tag.id}::uuid
            `,
          sqlState: '42501'
        })

        await expect(
          Promise.all([
            database.client.question.count(),
            database.client.questionVersion.count(),
            database.client.tag.count()
          ])
        ).resolves.toEqual(countsBefore)
        await expect(
          verifyExistingQuestionSeed(database.client, seed)
        ).resolves.toBeUndefined()
        return
      }

      await database.client.$transaction(async (transaction) => {
        const questionId = randomUUID()
        const versionId = randomUUID()
        const optionId = randomUUID()
        const tagId = randomUUID()

        await transaction.question.create({
          data: { id: questionId, createdByLabelSnapshot: 'SYSTEM_SEED' }
        })
        await transaction.questionVersion.create({
          data: {
            id: versionId,
            questionId,
            versionNumber: 1,
            createdByLabelSnapshot: 'SYSTEM_SEED',
            level: 'N5',
            subject: 'VOCABULARY',
            questionType: 'KANJI_READING',
            questionText: '삭제 가능한 draft 문제',
            explanationKo: '미게시 aggregate는 삭제할 수 있습니다.',
            difficulty: 'EASY'
          }
        })
        await transaction.questionOption.create({
          data: {
            id: optionId,
            questionVersionId: versionId,
            label: '1',
            ordinal: 1,
            text: '임시 보기'
          }
        })
        await transaction.questionVersion.update({
          where: { id: versionId },
          data: { correctOptionId: optionId }
        })
        await transaction.tag.create({
          data: { id: tagId, label: '임시 태그', normalizedName: tagId }
        })
        await transaction.questionVersionTag.create({
          data: {
            id: randomUUID(),
            questionVersionId: versionId,
            tagId
          }
        })

        await transaction.question.delete({ where: { id: questionId } })
        expect(
          await transaction.questionVersion.findUnique({
            where: { id: versionId }
          })
        ).toBeNull()
        await transaction.tag.delete({ where: { id: tagId } })
      })
    }
  )

  it('다른 version option을 correctOptionId로 연결하지 못한다', async () => {
    if (isCurrentSourceIntegration) {
      const [firstSeed, secondSeed] = buildAllQuestionSeeds()
      const foreignOption = secondSeed?.options[0]
      if (!firstSeed || !secondSeed || !foreignOption) {
        throw new Error('Question seed pair option fixture가 필요합니다.')
      }
      await expectRawDatabaseError({
        expectedMessage:
          'insert or update on table "QuestionVersion" violates foreign key constraint "QuestionVersion_id_correctOptionId_fkey"',
        operation: async () =>
          await fixtureDatabase.client.$transaction(async (transaction) => {
            await transaction.$executeRaw`
              UPDATE "QuestionVersion"
              SET "correctOptionId" = ${foreignOption.id}::uuid
              WHERE "id" = ${firstSeed.versionId}::uuid
            `
            await transaction.$executeRawUnsafe(
              'SET CONSTRAINTS "QuestionVersion_id_correctOptionId_fkey" IMMEDIATE'
            )
          }),
        sqlState: '23503'
      })
      await expect(
        Promise.all([
          verifyExistingQuestionSeed(database.client, firstSeed),
          verifyExistingQuestionSeed(database.client, secondSeed)
        ])
      ).resolves.toEqual([undefined, undefined])
      return
    }

    await expect(
      database.client.$transaction(async (transaction) => {
        const firstQuestionId = randomUUID()
        const secondQuestionId = randomUUID()
        const firstVersionId = randomUUID()
        const secondVersionId = randomUUID()
        const foreignOptionId = randomUUID()

        await transaction.question.createMany({
          data: [
            {
              id: firstQuestionId,
              createdByLabelSnapshot: 'SYSTEM_SEED'
            },
            {
              id: secondQuestionId,
              createdByLabelSnapshot: 'SYSTEM_SEED'
            }
          ]
        })
        await transaction.questionVersion.createMany({
          data: [
            {
              id: firstVersionId,
              questionId: firstQuestionId,
              versionNumber: 1,
              createdByLabelSnapshot: 'SYSTEM_SEED',
              level: 'N5',
              subject: 'VOCABULARY',
              questionType: 'KANJI_READING',
              questionText: '첫 번째 문제',
              explanationKo: '첫 번째 해설',
              difficulty: 'EASY'
            },
            {
              id: secondVersionId,
              questionId: secondQuestionId,
              versionNumber: 1,
              createdByLabelSnapshot: 'SYSTEM_SEED',
              level: 'N5',
              subject: 'VOCABULARY',
              questionType: 'KANJI_READING',
              questionText: '두 번째 문제',
              explanationKo: '두 번째 해설',
              difficulty: 'EASY'
            }
          ]
        })
        await transaction.questionOption.create({
          data: {
            id: foreignOptionId,
            questionVersionId: secondVersionId,
            label: '1',
            ordinal: 1,
            text: '다른 버전의 보기'
          }
        })
        await transaction.questionVersion.update({
          where: { id: firstVersionId },
          data: { correctOptionId: foreignOptionId }
        })
      })
    ).rejects.toThrow()
  })

  it('보기 3개인 version은 publish할 수 없다', async () => {
    if (isCurrentSourceIntegration) {
      const seed = buildAllQuestionSeeds()[0]
      const removableOption = seed?.options.find(
        ({ id }) => id !== seed.correctOptionId
      )
      if (!seed || !removableOption) {
        throw new Error('Published question non-correct option이 필요합니다.')
      }
      await expectRawDatabaseError({
        expectedMessage:
          'QuestionVersion must commit complete canonical content.',
        operation: async () =>
          await fixtureDatabase.client.$transaction(async (transaction) => {
            await transaction.$executeRaw`
              DELETE FROM "QuestionOption"
              WHERE "id" = ${removableOption.id}::uuid
            `
            await transaction.$executeRawUnsafe(
              'SET CONSTRAINTS "QuestionOption_deferred_full_content" IMMEDIATE'
            )
          }),
        sqlState: '23514'
      })
      await expect(
        verifyExistingQuestionSeed(database.client, seed)
      ).resolves.toBeUndefined()
      return
    }

    await expect(
      database.client.$transaction(async (transaction) => {
        const questionId = randomUUID()
        const versionId = randomUUID()
        const options = [1, 2, 3].map((ordinal) => ({
          id: randomUUID(),
          questionVersionId: versionId,
          label: String(ordinal),
          ordinal,
          text: '보기 ' + String(ordinal)
        }))

        await transaction.question.create({
          data: { id: questionId, createdByLabelSnapshot: 'SYSTEM_SEED' }
        })
        await transaction.questionVersion.create({
          data: {
            id: versionId,
            questionId,
            versionNumber: 1,
            createdByLabelSnapshot: 'SYSTEM_SEED',
            level: 'N5',
            subject: 'VOCABULARY',
            questionType: 'KANJI_READING',
            questionText: '게시할 수 없는 문제',
            explanationKo: '게시할 수 없는 해설',
            difficulty: 'EASY'
          }
        })
        await transaction.questionOption.createMany({ data: options })
        await transaction.questionVersion.update({
          where: { id: versionId },
          data: {
            correctOptionId: options[0]!.id,
            status: 'PUBLISHED',
            publishedAt: new Date()
          }
        })
      })
    ).rejects.toThrow()
  })

  it('독해 passage가 없으면 DB가 거부한다', async () => {
    if (isCurrentSourceIntegration) {
      const seed = buildAllQuestionSeeds().find(
        ({ subject }) => subject === 'VOCABULARY'
      )
      if (!seed) {
        throw new Error('Vocabulary seed fixture가 필요합니다.')
      }
      await expectRawDatabaseError({
        expectedMessage:
          'new row for relation "QuestionVersion" violates check constraint "QuestionVersion_content_type_check"',
        operation: async () =>
          await fixtureDatabase.client.$transaction(async (transaction) => {
            await transaction.$executeRaw`
              UPDATE "QuestionVersion"
              SET
                "subject" = 'READING',
                "questionType" = 'SHORT_READING',
                "passage" = NULL
              WHERE "id" = ${seed.versionId}::uuid
            `
          }),
        sqlState: '23514'
      })
      await expect(
        verifyExistingQuestionSeed(database.client, seed)
      ).resolves.toBeUndefined()
      return
    }

    await expect(
      database.client.$transaction(async (transaction) => {
        const questionId = randomUUID()

        await transaction.question.create({
          data: { id: questionId, createdByLabelSnapshot: 'SYSTEM_SEED' }
        })
        await transaction.questionVersion.create({
          data: {
            id: randomUUID(),
            questionId,
            versionNumber: 1,
            createdByLabelSnapshot: 'SYSTEM_SEED',
            level: 'N5',
            subject: 'READING',
            questionType: 'SHORT_READING',
            passage: null,
            questionText: '지문이 없는 독해 문제',
            explanationKo: '독해 지문은 필수입니다.',
            difficulty: 'EASY'
          }
        })
      })
    ).rejects.toThrow()
  })

  it('보기 4개여도 tag가 없으면 publish할 수 없다', async () => {
    if (isCurrentSourceIntegration) {
      const seed = buildAllQuestionSeeds()[0]
      if (!seed) {
        throw new Error('Published question tag fixture가 필요합니다.')
      }
      await expectRawDatabaseError({
        expectedMessage:
          'QuestionVersion must commit complete canonical content.',
        operation: async () =>
          await fixtureDatabase.client.$transaction(async (transaction) => {
            await transaction.$executeRaw`
              DELETE FROM "QuestionVersionTag"
              WHERE "questionVersionId" = ${seed.versionId}::uuid
            `
            await transaction.$executeRawUnsafe(
              'SET CONSTRAINTS "QuestionVersionTag_deferred_full_content" IMMEDIATE'
            )
          }),
        sqlState: '23514'
      })
      await expect(
        verifyExistingQuestionSeed(database.client, seed)
      ).resolves.toBeUndefined()
      return
    }

    await expect(
      database.client.$transaction(async (transaction) => {
        const questionId = randomUUID()
        const versionId = randomUUID()
        const options = [1, 2, 3, 4].map((ordinal) => ({
          id: randomUUID(),
          questionVersionId: versionId,
          label: String(ordinal),
          ordinal,
          text: '보기 ' + String(ordinal)
        }))

        await transaction.question.create({
          data: { id: questionId, createdByLabelSnapshot: 'SYSTEM_SEED' }
        })
        await transaction.questionVersion.create({
          data: {
            id: versionId,
            questionId,
            versionNumber: 1,
            createdByLabelSnapshot: 'SYSTEM_SEED',
            level: 'N5',
            subject: 'VOCABULARY',
            questionType: 'KANJI_READING',
            questionText: '태그가 없는 문제',
            explanationKo: '태그가 없어 게시할 수 없습니다.',
            difficulty: 'EASY'
          }
        })
        await transaction.questionOption.createMany({ data: options })
        await transaction.questionVersion.update({
          where: { id: versionId },
          data: {
            correctOptionId: options[0]!.id,
            status: 'PUBLISHED',
            publishedAt: new Date()
          }
        })
      })
    ).rejects.toThrow()
  })

  it('direct lifecycle mutation은 admin command 경계를 우회하지 못한다', async () => {
    const seed = buildAllQuestionSeeds()[0]
    if (!seed) {
      throw new Error('Question seed fixture가 필요합니다.')
    }

    if (isCurrentSourceIntegration) {
      // The armed-intent trigger is gone (#504 P4); the lifecycle check and the
      // deferred aggregate invariant still refuse these raw writes.
      const versionBefore =
        await database.client.questionVersion.findUniqueOrThrow({
          where: { id: seed.versionId },
          select: {
            retiredAt: true,
            rowVersion: true,
            status: true,
            updatedAt: true
          }
        })
      const questionBefore = await database.client.question.findUniqueOrThrow({
        where: { id: seed.questionId },
        select: {
          archivedAt: true,
          currentPublishedVersionId: true,
          lifecycleStatus: true,
          rowVersion: true,
          updatedAt: true
        }
      })
      const retiredAt = new Date()
      await expectRawDatabaseError({
        expectedMessage:
          'new row for relation "QuestionVersion" violates check constraint "QuestionVersion_lifecycle_timestamp_check"',
        operation: async () =>
          await database.client.$executeRaw`
            UPDATE "QuestionVersion"
            SET
              "status" = 'RETIRED',
              "retiredAt" = ${retiredAt},
              "rowVersion" = "rowVersion" + 1,
              "updatedAt" = ${retiredAt}
            WHERE "id" = ${seed.versionId}::uuid
          `,
        sqlState: '23514'
      })
      const archivedAt = new Date(retiredAt.getTime() + 1)
      await expectRawDatabaseError({
        expectedMessage:
          'Question pointer/lifecycle aggregate invariant failed.',
        operation: async () =>
          await database.client.$executeRaw`
            UPDATE "Question"
            SET
              "lifecycleStatus" = 'ARCHIVED',
              "archivedAt" = ${archivedAt},
              "currentPublishedVersionId" = NULL,
              "rowVersion" = "rowVersion" + 1,
              "updatedAt" = ${archivedAt}
            WHERE "id" = ${seed.questionId}::uuid
          `,
        sqlState: '23514'
      })
      await expect(
        database.client.questionVersion.findUniqueOrThrow({
          where: { id: seed.versionId },
          select: {
            retiredAt: true,
            rowVersion: true,
            status: true,
            updatedAt: true
          }
        })
      ).resolves.toEqual(versionBefore)
      await expect(
        database.client.question.findUniqueOrThrow({
          where: { id: seed.questionId },
          select: {
            archivedAt: true,
            currentPublishedVersionId: true,
            lifecycleStatus: true,
            rowVersion: true,
            updatedAt: true
          }
        })
      ).resolves.toEqual(questionBefore)
    } else {
      const outcomes = await Promise.allSettled([
        database.client.questionVersion.update({
          where: { id: seed.versionId },
          data: { status: 'RETIRED', retiredAt: new Date() }
        }),
        database.client.question.update({
          where: { id: seed.questionId },
          data: { lifecycleStatus: 'ARCHIVED', archivedAt: new Date() }
        })
      ])
      expect(outcomes.every(({ status }) => status === 'rejected')).toBe(true)
    }

    await expect(
      verifyExistingQuestionSeed(database.client, seed)
    ).resolves.toBeUndefined()
    await expect(
      questionRepository.findPublishedById(seed.questionId)
    ).resolves.not.toBeNull()
  })

  it('권한 없는 v2 pointer transaction은 전부 rollback하고 v1 snapshot을 보존한다', async () => {
    const seed = buildAllQuestionSeeds()[0]

    if (!seed) {
      throw new Error('Question seed fixture가 필요합니다.')
    }

    const versionCountBefore = await database.client.questionVersion.count({
      where: { questionId: seed.questionId }
    })

    if (isCurrentSourceIntegration) {
      const [questionBefore, v1Before] = await Promise.all([
        database.client.question.findUniqueOrThrow({
          where: { id: seed.questionId }
        }),
        database.client.questionVersion.findUniqueOrThrow({
          where: { id: seed.versionId },
          include: {
            options: { orderBy: { ordinal: 'asc' } },
            tags: { orderBy: [{ tag: { label: 'asc' } }, { tagId: 'asc' }] }
          }
        })
      ])
      const v2Id = randomUUID()
      await expectRawDatabaseError({
        // The SYSTEM_SEED author rule moved to the API (#504 P4); this raw
        // insert omits updatedAt, so the NOT NULL column still refuses it.
        expectedMessage:
          'null value in column "updatedAt" of relation "QuestionVersion" violates not-null constraint',
        operation: async () =>
          await database.client.$executeRaw`
            INSERT INTO "QuestionVersion" (
              "id",
              "questionId",
              "versionNumber",
              "level",
              "subject",
              "questionType",
              "passage",
              "questionText",
              "explanationKo",
              "explanationJa",
              "difficulty",
              "sourceType",
              "createdByLabelSnapshot"
            ) VALUES (
              ${v2Id}::uuid,
              ${seed.questionId}::uuid,
              2,
              ${v1Before.level}::"JlptLevel",
              ${v1Before.subject}::"QuestionSubject",
              ${v1Before.questionType}::"QuestionType",
              ${v1Before.passage},
              ${`${v1Before.questionText} (v2)`},
              ${v1Before.explanationKo},
              ${v1Before.explanationJa},
              ${v1Before.difficulty}::"QuestionDifficulty",
              ${v1Before.sourceType}::"QuestionSourceType",
              'SYSTEM_SEED'
            )
          `,
        sqlState: '23502'
      })
      await expect(
        database.client.questionVersion.count({
          where: { questionId: seed.questionId }
        })
      ).resolves.toBe(versionCountBefore)
      await expect(
        database.client.question.findUniqueOrThrow({
          where: { id: seed.questionId }
        })
      ).resolves.toEqual(questionBefore)
      await expect(
        database.client.questionVersion.findUniqueOrThrow({
          where: { id: seed.versionId },
          include: {
            options: { orderBy: { ordinal: 'asc' } },
            tags: { orderBy: [{ tag: { label: 'asc' } }, { tagId: 'asc' }] }
          }
        })
      ).resolves.toEqual(v1Before)
      await expect(
        verifyExistingQuestionSeed(database.client, seed)
      ).resolves.toBeUndefined()
      return
    }

    await expect(
      database.client.$transaction(async (transaction) => {
        const v1Before = await transaction.questionVersion.findUniqueOrThrow({
          where: { id: seed.versionId },
          include: {
            options: { orderBy: { ordinal: 'asc' } },
            tags: true
          }
        })
        const v2Id = randomUUID()
        const v2Options = v1Before.options.map((option) => ({
          id: randomUUID(),
          questionVersionId: v2Id,
          label: option.label,
          ordinal: option.ordinal,
          text: option.text
        }))

        await transaction.questionVersion.create({
          data: {
            id: v2Id,
            questionId: seed.questionId,
            versionNumber: 2,
            createdByLabelSnapshot: 'SYSTEM_SEED',
            level: v1Before.level,
            subject: v1Before.subject,
            questionType: v1Before.questionType,
            passage: v1Before.passage,
            questionText: v1Before.questionText + ' (v2)',
            explanationKo: v1Before.explanationKo,
            explanationJa: v1Before.explanationJa,
            difficulty: v1Before.difficulty,
            sourceType: 'ORIGINAL'
          }
        })
        await transaction.questionOption.createMany({ data: v2Options })
        await transaction.questionVersionTag.createMany({
          data: v1Before.tags.map((tag) => ({
            id: randomUUID(),
            questionVersionId: v2Id,
            tagId: tag.tagId
          }))
        })
      })
    ).rejects.toThrow()

    const restored = await database.client.question.findUniqueOrThrow({
      where: { id: seed.questionId }
    })
    expect(restored.lifecycleStatus).toBe('ACTIVE')
    expect(restored.currentPublishedVersionId).toBe(seed.versionId)
    await expect(
      database.client.questionVersion.count({
        where: { questionId: seed.questionId }
      })
    ).resolves.toBe(versionCountBefore)
    await expect(
      verifyExistingQuestionSeed(database.client, seed)
    ).resolves.toBeUndefined()
  })
})
