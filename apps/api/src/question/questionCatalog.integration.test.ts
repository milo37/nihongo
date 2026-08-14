import { randomUUID } from 'node:crypto'
import { getQuestionResponseSchema } from '@nihongo/contracts/question/get-question'
import { listQuestionsResponseSchema } from '@nihongo/contracts/question/list-questions'
import { spacedTagQuestionListCase } from '@nihongo/contracts/testing/question-read-conformance'
import { afterAll, describe, expect, it } from 'vitest'
import {
  buildAllQuestionSeeds,
  seedQuestionCatalog,
  verifyExistingQuestionSeed
} from '../../prisma/seedQuestionCatalog.js'
import { createApiApp } from '../app/createApp.js'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { createJsonLogger } from '../observability/logger.js'
import { createPrismaQuestionRepository } from './questionRepository.js'
import { createQuestionService } from './questionService.js'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createDatabaseRuntime(environment.DATABASE_URL)
const app = createApiApp({
  checkReadiness: database.checkReadiness,
  logger: createJsonLogger('silent'),
  questionReader: createQuestionService(
    createPrismaQuestionRepository(database.client)
  )
})

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

afterAll(async () => {
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
  })

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

  it('published version과 option/tag snapshot 수정을 DB에서 거부한다', async () => {
    const seed = buildAllQuestionSeeds()[0]

    if (!seed) {
      throw new Error('Question seed fixture가 필요합니다.')
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
  })

  it('published option과 tag를 draft version으로 옮길 수 없다', async () => {
    const seed = buildAllQuestionSeeds()[0]

    if (!seed) {
      throw new Error('Question seed fixture가 필요합니다.')
    }

    const movableOption = seed.options.find(
      ({ id }) => id !== seed.correctOptionId
    )

    if (!movableOption) {
      throw new Error('정답이 아닌 option fixture가 필요합니다.')
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

  it('참조되지 않은 draft aggregate를 cascade 삭제할 수 있다', async () => {
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
  })

  it('다른 version option을 correctOptionId로 연결하지 못한다', async () => {
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

  it('child mutation과 publish를 version row lock으로 직렬화한다', async () => {
    const questionId = randomUUID()
    const versionId = randomUUID()
    const tagId = randomUUID()
    const options = [1, 2, 3, 4].map((ordinal) => ({
      id: randomUUID(),
      questionVersionId: versionId,
      label: String(ordinal),
      ordinal,
      text: '보기 ' + String(ordinal)
    }))

    await database.client.$transaction(async (transaction) => {
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
          questionText: '동시 게시 검증 문제',
          explanationKo: 'child mutation과 publish를 직렬화합니다.',
          difficulty: 'EASY'
        }
      })
      await transaction.questionOption.createMany({ data: options })
      await transaction.questionVersion.update({
        where: { id: versionId },
        data: { correctOptionId: options[0]!.id }
      })
      await transaction.tag.create({
        data: { id: tagId, label: '동시성 태그', normalizedName: tagId }
      })
      await transaction.questionVersionTag.create({
        data: {
          id: randomUUID(),
          questionVersionId: versionId,
          tagId,
          labelSnapshot: '동시성 태그'
        }
      })
    })

    let markChildLocked: (() => void) | undefined
    const childLocked = new Promise<void>((resolve) => {
      markChildLocked = resolve
    })
    let releaseChild: (() => void) | undefined
    const childRelease = new Promise<void>((resolve) => {
      releaseChild = resolve
    })
    const childMutation = database.client.$transaction(async (transaction) => {
      await transaction.questionOption.delete({
        where: { id: options[1]!.id }
      })
      markChildLocked?.()
      await childRelease
    })

    await childLocked
    let publishSettled = false
    const publishAttempt = database.client.questionVersion
      .update({
        where: { id: versionId },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date()
        }
      })
      .then(
        () => ({ succeeded: true as const }),
        (error: unknown) => ({ succeeded: false as const, error })
      )
      .finally(() => {
        publishSettled = true
      })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(publishSettled).toBe(false)
    releaseChild?.()
    await childMutation

    const publishResult = await publishAttempt
    expect(publishResult.succeeded).toBe(false)
    if (!publishResult.succeeded) {
      expect(publishResult.error).toBeInstanceOf(Error)
    }

    await database.client.question.delete({ where: { id: questionId } })
    await database.client.tag.delete({ where: { id: tagId } })
  })

  it('v2 pointer 전환과 archive 후에도 v1 snapshot을 보존한다', async () => {
    const seed = buildAllQuestionSeeds()[0]

    if (!seed) {
      throw new Error('Question seed fixture가 필요합니다.')
    }

    const rollbackMarker = new Error('ROLLBACK_VERSION_TEST')

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
        await transaction.questionVersion.update({
          where: { id: v2Id },
          data: {
            correctOptionId: v2Options[0]!.id,
            status: 'PUBLISHED',
            publishedAt: new Date()
          }
        })
        await transaction.question.update({
          where: { id: seed.questionId },
          data: { currentPublishedVersionId: v2Id }
        })
        await transaction.questionVersion.update({
          where: { id: seed.versionId },
          data: { status: 'RETIRED', retiredAt: new Date() }
        })

        const v1AfterPointerSwitch =
          await transaction.questionVersion.findUniqueOrThrow({
            where: { id: seed.versionId },
            include: { options: { orderBy: { ordinal: 'asc' } } }
          })

        expect(v1AfterPointerSwitch.questionText).toBe(v1Before.questionText)
        expect(v1AfterPointerSwitch.options).toEqual(v1Before.options)

        await transaction.question.update({
          where: { id: seed.questionId },
          data: { currentPublishedVersionId: null }
        })
        await transaction.questionVersion.update({
          where: { id: v2Id },
          data: { status: 'RETIRED', retiredAt: new Date() }
        })
        await transaction.question.update({
          where: { id: seed.questionId },
          data: {
            lifecycleStatus: 'ARCHIVED',
            archivedAt: new Date()
          }
        })

        await expect(
          verifyExistingQuestionSeed(transaction, seed)
        ).resolves.toBeUndefined()

        const transactionApp = createApiApp({
          checkReadiness: async () => undefined,
          logger: createJsonLogger('silent'),
          questionReader: createQuestionService(
            createPrismaQuestionRepository(transaction)
          )
        })
        const archivedResponse = await transactionApp.request(
          '/api/v1/questions/' + seed.questionId
        )

        expect(archivedResponse.status).toBe(404)
        throw rollbackMarker
      })
    ).rejects.toBe(rollbackMarker)

    const restored = await database.client.question.findUniqueOrThrow({
      where: { id: seed.questionId }
    })
    expect(restored.lifecycleStatus).toBe('ACTIVE')
    expect(restored.currentPublishedVersionId).toBe(seed.versionId)
  })
})
