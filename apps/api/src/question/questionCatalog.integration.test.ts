import { createHash, randomUUID } from 'node:crypto'
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
  createDailyQuestionService,
  createPrismaDailyQuestionRepository,
  toDayNumber
} from './dailyQuestion.js'
import { createPrismaQuestionRepository } from './questionRepository.js'

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
const fixtureDatabase = fixtureDatabaseUrl
  ? createDatabaseRuntime(fixtureDatabaseUrl)
  : database
const questionRepository = createPrismaQuestionRepository(database.client)
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

  it('오늘의 한 문제는 날짜마다 md5 순서로 돌고 독해·다른 급수는 고르지 않는다 (JLP-815)', async () => {
    const candidates = buildAllQuestionSeeds()
      .filter(({ level, subject }) => level === 'N5' && subject !== 'READING')
      .map(({ questionId }) => questionId)
      .toSorted((left, right) => {
        const leftHash = createHash('md5').update(left).digest('hex')
        const rightHash = createHash('md5').update(right).digest('hex')
        return leftHash === rightHash
          ? left.localeCompare(right)
          : leftHash.localeCompare(rightHash)
      })
    expect(candidates.length).toBeGreaterThan(1)

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
