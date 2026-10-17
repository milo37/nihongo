import { randomUUID } from 'node:crypto'
import { apiFailureSchema } from '@nihongo/contracts/common/error'
import { getQuestionResponseSchema } from '@nihongo/contracts/question/get-question'
import { listQuestionsResponseSchema } from '@nihongo/contracts/question/list-questions'
import { spacedTagQuestionListCase } from '@nihongo/contracts/testing/question-read-conformance'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
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
import { createPrismaQuestionRepository } from './questionRepository.js'
import { createQuestionService } from './questionService.js'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const isPhase10CurrentSource =
  process.env.PHASE10_CURRENT_SOURCE_INTEGRATION === '1'
const fixtureDatabaseUrl = process.env.PHASE10_FIXTURE_DATABASE_URL
if (isPhase10CurrentSource && !fixtureDatabaseUrl) {
  throw new Error('Phase 10 question catalog requires a fixture database.')
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
  isPhase10CurrentSource
    ? { migrationProfile: 'current', startupRole: 'nihongo_app' }
    : {}
)
const fixtureDatabase = fixtureDatabaseUrl
  ? createDatabaseRuntime(fixtureDatabaseUrl)
  : database
const questionReader = createQuestionService(
  createPrismaQuestionRepository(database.client)
)
const applicationRateLimiter = createApplicationRateLimiter({
  client: database.client,
  keySecret: environment.GUEST_COOKIE_SECRET
})
const app = createApiApp({
  checkReadiness: database.checkReadiness,
  logger: createJsonLogger('silent'),
  questionReader,
  questionReadSecurity: {
    environment,
    rateLimiter: applicationRateLimiter
  }
})

const QUESTION_RATE_LIMIT_PREFIXES = [
  'application:question-list-read:',
  'application:question-detail-read:'
] as const

const resetQuestionRateLimits = async (): Promise<void> => {
  await database.client.rateLimit.deleteMany({
    where: {
      OR: QUESTION_RATE_LIMIT_PREFIXES.map((prefix) => ({
        key: { startsWith: prefix }
      }))
    }
  })
}

const FORBIDDEN_KEYS = new Set([
  'correctOptionId',
  'isCorrect',
  'explanationKo',
  'explanationJa',
  'status',
  'sourceType',
  'createdByUserId',
  'rowVersion'
])

const collectKeys = (value: unknown, keys: Set<string>): void => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys))
    return
  }

  if (typeof value !== 'object' || value === null) {
    return
  }

  for (const [key, nested] of Object.entries(value)) {
    keys.add(key)
    collectKeys(nested, keys)
  }
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

  it('real Hono list/detail이 canonical public DTO와 header를 반환한다', async () => {
    const seed = buildAllQuestionSeeds()[0]

    if (!seed) {
      throw new Error('Question seed fixture가 필요합니다.')
    }

    const [listResponse, detailResponse] = await Promise.all([
      app.request('/api/v1/questions?level=N5&subject=VOCABULARY&pageSize=2'),
      app.request('/api/v1/questions/' + seed.questionId)
    ])
    const list = listQuestionsResponseSchema.parse(await listResponse.json())
    const detail = getQuestionResponseSchema.parse(await detailResponse.json())
    const keys = new Set<string>()
    collectKeys({ list, detail }, keys)

    expect(listResponse.status).toBe(200)
    expect(detailResponse.status).toBe(200)
    expect(listResponse.headers.get('Cache-Control')).toBe('private, no-store')
    expect(detailResponse.headers.get('Cache-Control')).toBe(
      'private, no-store'
    )
    expect(list.total).toBe(5)
    expect(detail.id).toBe(seed.questionId)
    expect(detail.questionVersionId).toBe(seed.versionId)
    expect(detail.options.map(({ id }) => id)).toEqual(
      seed.options.map(({ id }) => id)
    )

    for (const forbiddenKey of FORBIDDEN_KEYS) {
      expect(keys.has(forbiddenKey)).toBe(false)
    }

    const rateLimitRows = await database.client.rateLimit.findMany({
      where: {
        OR: QUESTION_RATE_LIMIT_PREFIXES.map((prefix) => ({
          key: { startsWith: prefix }
        }))
      },
      select: { count: true, key: true }
    })
    expect(rateLimitRows).toHaveLength(2)
    expect(
      rateLimitRows.map(({ key }) =>
        QUESTION_RATE_LIMIT_PREFIXES.find((prefix) => key.startsWith(prefix))
      )
    ).toEqual(expect.arrayContaining([...QUESTION_RATE_LIMIT_PREFIXES]))
    expect(rateLimitRows.every(({ count }) => count === 1)).toBe(true)
  })

  it.each([
    ['list', 'question-list-read'],
    ['detail', 'question-detail-read']
  ] as const)(
    'question %s 제한은 검증보다 먼저 count하고 60초 경계에서 원자적으로 reset한다',
    async (_label, operation) => {
      const seed = buildAllQuestionSeeds()[0]
      if (!seed) {
        throw new Error('Question seed fixture가 필요합니다.')
      }

      const isList = operation === 'question-list-read'
      const rateLimitPrefix = QUESTION_RATE_LIMIT_PREFIXES[isList ? 0 : 1]
      const otherRateLimitPrefix = QUESTION_RATE_LIMIT_PREFIXES[isList ? 1 : 0]
      const deniedPath = isList
        ? '/api/v1/questions?page=0'
        : '/api/v1/questions/not-a-uuid'
      const allowedPath = isList
        ? '/api/v1/questions'
        : '/api/v1/questions/' + seed.questionId
      let now = 1_000
      const rateLimiter = createApplicationRateLimiter({
        client: database.client,
        keySecret: environment.GUEST_COOKIE_SECRET,
        now: () => now
      })
      const getQuestion = vi.fn(questionReader.getQuestion)
      const listQuestions = vi.fn(questionReader.listQuestions)
      const rateLimitedApp = createApiApp({
        checkReadiness: async () => undefined,
        logger: createJsonLogger('silent'),
        questionReader: { getQuestion, listQuestions },
        questionReadSecurity: { environment, rateLimiter }
      })
      const limitInput = {
        clientIp: 'unresolved',
        max: 120,
        operation,
        windowMs: 60_000
      } as const

      for (let index = 0; index < limitInput.max; index += 1) {
        await rateLimiter.consume(limitInput)
      }

      const beforeDenial = await database.client.rateLimit.findFirstOrThrow({
        where: { key: { startsWith: rateLimitPrefix } },
        select: { count: true, lastRequest: true }
      })
      now = 12_345

      const denied = await rateLimitedApp.request(deniedPath)
      const denial = apiFailureSchema.parse(await denied.json())
      const afterDenial = await database.client.rateLimit.findFirstOrThrow({
        where: { key: { startsWith: rateLimitPrefix } },
        select: { count: true, lastRequest: true }
      })
      const expectedRetryAfterSeconds = Math.max(
        1,
        Math.ceil(
          Number(
            beforeDenial.lastRequest + BigInt(limitInput.windowMs) - BigInt(now)
          ) / 1_000
        )
      )

      expect(beforeDenial.count).toBe(limitInput.max)
      expect(denied.status).toBe(429)
      expect(denied.headers.get('Retry-After')).toBe(
        String(expectedRetryAfterSeconds)
      )
      expect(denial).toMatchObject({ code: 'RATE_LIMITED', retryable: true })
      expect(listQuestions).not.toHaveBeenCalled()
      expect(getQuestion).not.toHaveBeenCalled()
      expect(afterDenial.count).toBe(beforeDenial.count + 1)
      expect(afterDenial.lastRequest).toBe(beforeDenial.lastRequest)
      await expect(
        database.client.rateLimit.count({
          where: { key: { startsWith: otherRateLimitPrefix } }
        })
      ).resolves.toBe(0)

      now = Number(beforeDenial.lastRequest) + limitInput.windowMs
      const allowed = await rateLimitedApp.request(allowedPath)
      const resetRow = await database.client.rateLimit.findFirstOrThrow({
        where: { key: { startsWith: rateLimitPrefix } },
        select: { count: true, lastRequest: true }
      })

      expect(allowed.status).toBe(200)
      expect(listQuestions).toHaveBeenCalledTimes(isList ? 1 : 0)
      expect(getQuestion).toHaveBeenCalledTimes(isList ? 0 : 1)
      expect(resetRow).toEqual({ count: 1, lastRequest: BigInt(now) })
    }
  )

  it('type·tag filter와 out-of-range pagination을 적용한다', async () => {
    const [byTypeResponse, byTagResponse, emptyPageResponse] =
      await Promise.all([
        app.request('/api/v1/questions?type=KANJI_READING&pageSize=100'),
        app.request(
          '/api/v1/questions?tag=' +
            encodeURIComponent(String(spacedTagQuestionListCase.query.tag)) +
            '&pageSize=100'
        ),
        app.request('/api/v1/questions?page=999&pageSize=20')
      ])
    const byType = listQuestionsResponseSchema.parse(
      await byTypeResponse.json()
    )
    const byTag = listQuestionsResponseSchema.parse(await byTagResponse.json())
    const emptyPage = listQuestionsResponseSchema.parse(
      await emptyPageResponse.json()
    )

    expect(byType.items.length).toBeGreaterThan(0)
    expect(
      byType.items.every(({ questionType }) => questionType === 'KANJI_READING')
    ).toBe(true)
    expect(byTag.total).toBe(spacedTagQuestionListCase.expectedTotal)
    expect(byTag.items.map(({ id }) => id)).toEqual(
      spacedTagQuestionListCase.expectedQuestionIds
    )
    expect(
      byTag.items.every(({ tags }) =>
        tags.some(({ label }) => label === '한자 읽기')
      )
    ).toBe(true)
    expect(emptyPage.items).toEqual([])
    expect(emptyPage.total).toBe(65)
  })

  it('invalid ID는 422, 없는 문제는 404로 숨긴다', async () => {
    const [invalid, missing] = await Promise.all([
      app.request('/api/v1/questions/not-a-uuid'),
      app.request('/api/v1/questions/' + randomUUID())
    ])

    expect(invalid.status).toBe(422)
    expect(missing.status).toBe(404)
  })

  it(
    isPhase10CurrentSource
      ? 'application role은 published version 직접 변경을 막고 option/tag immutability를 유지한다'
      : 'published version과 option/tag snapshot 수정을 DB에서 거부한다',
    async () => {
      const seed = buildAllQuestionSeeds()[0]

      if (!seed) {
        throw new Error('Question seed fixture가 필요합니다.')
      }

      if (isPhase10CurrentSource) {
        await expectRawDatabaseError({
          expectedMessage:
            'An armed trusted Phase 7 operation intent is required.',
          operation: async () =>
            await database.client.$executeRaw`
              UPDATE "QuestionVersion"
              SET "questionText" = '변조된 질문'
              WHERE "id" = ${seed.versionId}::uuid
            `,
          sqlState: '42501'
        })
        await expectRawDatabaseError({
          expectedMessage:
            'QuestionVersion children require an editable unpinned parent.',
          operation: async () =>
            await database.client.$executeRaw`
              UPDATE "QuestionOption"
              SET "text" = '변조된 보기'
              WHERE "id" = ${seed.options[0]!.id}::uuid
            `,
          sqlState: '23514'
        })
        await expectRawDatabaseError({
          expectedMessage:
            'QuestionVersion children require an editable unpinned parent.',
          operation: async () =>
            await database.client.$executeRaw`
              DELETE FROM "QuestionVersionTag"
              WHERE "id" = ${seed.tags[0]!.versionTagId}::uuid
            `,
          sqlState: '23514'
        })
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

    if (isPhase10CurrentSource) {
      await expectRawDatabaseError({
        expectedMessage:
          'QuestionVersion children require an editable unpinned parent.',
        operation: async () =>
          await fixtureDatabase.client.$transaction(async (transaction) => {
            await transaction.$executeRaw`
              UPDATE "QuestionOption"
              SET "questionVersionId" = ${targetSeed.versionId}::uuid
              WHERE "id" = ${movableOption.id}::uuid
            `
          }),
        sqlState: '23514'
      })
      await expectRawDatabaseError({
        expectedMessage:
          'QuestionVersion children require an editable unpinned parent.',
        operation: async () =>
          await fixtureDatabase.client.$transaction(async (transaction) => {
            await transaction.$executeRaw`
              UPDATE "QuestionVersionTag"
              SET "questionVersionId" = ${targetSeed.versionId}::uuid
              WHERE "id" = ${seed.tags[0]!.versionTagId}::uuid
            `
          }),
        sqlState: '23514'
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
    isPhase10CurrentSource
      ? 'Phase 7 application role은 catalog aggregate를 hard delete할 수 없다'
      : '참조되지 않은 draft aggregate를 cascade 삭제할 수 있다',
    async () => {
      if (isPhase10CurrentSource) {
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
            tagId,
            labelSnapshot: '임시 태그'
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
    if (isPhase10CurrentSource) {
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
            await transaction.$executeRawUnsafe(
              'ALTER TABLE "QuestionVersion" DISABLE TRIGGER "QuestionVersion_validate_change"'
            )
            await transaction.$executeRawUnsafe(
              'ALTER TABLE "QuestionVersion" DISABLE TRIGGER "QuestionVersion_capture_phase7_delta"'
            )
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
    if (isPhase10CurrentSource) {
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
            await transaction.$executeRawUnsafe(
              'ALTER TABLE "QuestionOption" DISABLE TRIGGER "QuestionOption_protect_immutable_version"'
            )
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
    if (isPhase10CurrentSource) {
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
            await transaction.$executeRawUnsafe(
              'ALTER TABLE "QuestionVersion" DISABLE TRIGGER "QuestionVersion_validate_change"'
            )
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
    if (isPhase10CurrentSource) {
      const seed = buildAllQuestionSeeds()[0]
      if (!seed) {
        throw new Error('Published question tag fixture가 필요합니다.')
      }
      await expectRawDatabaseError({
        expectedMessage:
          'QuestionVersion must commit complete canonical content.',
        operation: async () =>
          await fixtureDatabase.client.$transaction(async (transaction) => {
            await transaction.$executeRawUnsafe(
              'ALTER TABLE "QuestionVersionTag" DISABLE TRIGGER "QuestionVersionTag_protect_immutable_version"'
            )
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

  it('direct lifecycle mutation은 Phase 7 admin command 경계를 우회하지 못한다', async () => {
    const seed = buildAllQuestionSeeds()[0]
    if (!seed) {
      throw new Error('Question seed fixture가 필요합니다.')
    }

    if (isPhase10CurrentSource) {
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
          'An armed trusted Phase 7 operation intent is required.',
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
        sqlState: '42501'
      })
      const archivedAt = new Date(retiredAt.getTime() + 1)
      await expectRawDatabaseError({
        expectedMessage:
          'An armed trusted Phase 7 operation intent is required.',
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
        sqlState: '42501'
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
    const response = await app.request('/api/v1/questions/' + seed.questionId)
    expect(response.status).toBe(200)
  })

  it('권한 없는 v2 pointer transaction은 전부 rollback하고 v1 snapshot을 보존한다', async () => {
    const seed = buildAllQuestionSeeds()[0]

    if (!seed) {
      throw new Error('Question seed fixture가 필요합니다.')
    }

    const versionCountBefore = await database.client.questionVersion.count({
      where: { questionId: seed.questionId }
    })

    if (isPhase10CurrentSource) {
      const [questionBefore, v1Before] = await Promise.all([
        database.client.question.findUniqueOrThrow({
          where: { id: seed.questionId }
        }),
        database.client.questionVersion.findUniqueOrThrow({
          where: { id: seed.versionId },
          include: {
            options: { orderBy: { ordinal: 'asc' } },
            tags: { orderBy: [{ labelSnapshot: 'asc' }, { tagId: 'asc' }] }
          }
        })
      ])
      const v2Id = randomUUID()
      await expectRawDatabaseError({
        expectedMessage: 'Application role cannot create SYSTEM_SEED content.',
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
        sqlState: '42501'
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
            tags: { orderBy: [{ labelSnapshot: 'asc' }, { tagId: 'asc' }] }
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
            tagId: tag.tagId,
            labelSnapshot: tag.labelSnapshot
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
