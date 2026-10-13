import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from '../db/databaseOptions.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { Prisma } from '../generated/prisma/client.js'
import type { ExistingStudyOwner } from './studySessionRepository.js'
import { createPrismaStudyDraftRepository } from './studyDraftRepository.js'
import { createPrismaStudyResultRetryRepository } from './studyResultRetryRepository.js'
import { createStudyResultRetryService } from './studyResultRetryService.js'
import { createPrismaStudySessionRepository } from './studySessionRepository.js'
import { createPrismaStudySubmissionRepository } from './studySubmissionRepository.js'
import { createStudySubmissionService } from './studySubmissionService.js'

const DAY_MS = 24 * 60 * 60 * 1_000
const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const isPhase10CurrentSource =
  process.env.PHASE10_CURRENT_SOURCE_INTEGRATION === '1'
const fixtureDatabaseUrl = process.env.PHASE10_FIXTURE_DATABASE_URL
const erasureWorkerDatabaseUrl = process.env.PHASE7_API_ERASURE_DATABASE_URL
if (
  isPhase10CurrentSource &&
  (!fixtureDatabaseUrl || !erasureWorkerDatabaseUrl)
) {
  throw new Error(
    'Phase 10 result retry requires fixture and erasure databases.'
  )
}
for (const databaseUrl of [fixtureDatabaseUrl, erasureWorkerDatabaseUrl]) {
  if (databaseUrl) {
    assertSafeTestDatabase({
      nodeEnvironment: environment.NODE_ENV,
      databaseUrl,
      productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
    })
  }
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
const erasureWorkerClient = erasureWorkerDatabaseUrl
  ? new Client({
      connectionString: erasureWorkerDatabaseUrl,
      options: createPostgresStartupOptions(
        getPostgresSchema(erasureWorkerDatabaseUrl)
      )
    })
  : undefined
const sessionRepository = createPrismaStudySessionRepository(database.client)
const submissionRepository = createPrismaStudySubmissionRepository(
  database.client
)
const retryRepository = createPrismaStudyResultRetryRepository(database.client)
const draftRepository = createPrismaStudyDraftRepository(database.client)
const guestPrincipalService = createGuestPrincipalService({
  client: database.client,
  secret: environment.GUEST_COOKIE_SECRET
})
const createdUserIds = new Set<string>()
const createdGuestIds = new Set<string>()

interface AnswerMaterial {
  readonly correctOptionId: string
  readonly studySessionQuestionId: string
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
    identities.push({
      message: error.meta.message,
      sqlState: error.meta.code
    })
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

const createUser = async (label: string): Promise<string> => {
  const userId = randomUUID()
  await fixtureDatabase.client.$transaction(async (fixture) => {
    await fixture.user.create({
      data: {
        id: userId,
        name: `Slice 5 ${label}`,
        email: `slice5-${label}-${randomUUID()}@example.test`,
        emailVerified: true
      }
    })
    await fixture.account.create({
      data: {
        accountId: userId,
        password: 'phase10-fixture-password-hash',
        providerId: 'credential',
        userId
      }
    })
  })
  createdUserIds.add(userId)
  return userId
}

const eraseUser = async (userId: string): Promise<void> => {
  if (erasureWorkerClient) {
    await erasureWorkerClient.query(`SELECT "phase7_erase_user"($1, 'TEST')`, [
      userId
    ])
  } else {
    await fixtureDatabase.client.user.delete({ where: { id: userId } })
  }
  createdUserIds.delete(userId)
}

const createGuestOwner = async (): Promise<
  Extract<ExistingStudyOwner, { kind: 'GUEST' }>
> => {
  const resolved = await guestPrincipalService.create()
  if (!resolved.cookieValue) {
    throw new Error('Slice 5 guest cookie fixture가 필요합니다.')
  }
  createdGuestIds.add(resolved.id)
  const inspected = guestPrincipalService.inspectCookie(resolved.cookieValue)
  if (inspected.kind !== 'VERIFIED') {
    throw new Error('Slice 5 verified guest fixture가 필요합니다.')
  }
  return {
    kind: 'GUEST',
    guestPrincipalId: inspected.id,
    tokenDigest: inspected.tokenDigest
  }
}

const loadAnswerMaterial = async (
  sessionId: string
): Promise<readonly AnswerMaterial[]> => {
  const items = await database.client.studySessionQuestion.findMany({
    where: { studySessionId: sessionId },
    orderBy: [{ ordinal: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      questionVersion: { select: { correctOptionId: true } }
    }
  })
  return items.map((item) => {
    if (!item.questionVersion.correctOptionId) {
      throw new Error('Slice 5 published answer material이 필요합니다.')
    }
    return {
      correctOptionId: item.questionVersion.correctOptionId,
      studySessionQuestionId: item.id
    }
  })
}

const createSubmittedSource = async (
  owner: ExistingStudyOwner,
  wrongOrdinals: ReadonlySet<number>,
  startedAt = new Date()
) => {
  const created = await sessionRepository.createRandom({
    owner,
    level: 'N5',
    subject: 'VOCABULARY',
    requestedCount: Math.max(1, wrongOrdinals.size + 1),
    practiceContractVersion: 1,
    startedAt,
    expiresAt: new Date(startedAt.getTime() + DAY_MS)
  })
  const material = await loadAnswerMaterial(created.session.id)
  const submitted = await createStudySubmissionService(
    submissionRepository,
    () => new Date(startedAt.getTime() + 1_000)
  ).submit(
    created.session.id,
    randomUUID(),
    {
      answers: material.map((item, index) => ({
        studySessionQuestionId: item.studySessionQuestionId,
        selectedOptionId: wrongOrdinals.has(index + 1)
          ? null
          : item.correctOptionId,
        elapsedSec: index + 1
      })),
      durationSec: material.length * 10
    },
    owner,
    1
  )
  return { created, material, submitted }
}

beforeAll(async () => {
  await database.checkReadiness()
  if (erasureWorkerClient) {
    await erasureWorkerClient.connect()
    await erasureWorkerClient.query(`SET ROLE "nihongo_erasure_worker"`)
  }
})

afterAll(async () => {
  if (createdUserIds.size > 0) {
    for (const userId of [...createdUserIds]) await eraseUser(userId)
  }
  if (createdGuestIds.size > 0) {
    await database.client.guestPrincipal.deleteMany({
      where: { id: { in: [...createdGuestIds] } }
    })
  }
  if (erasureWorkerClient) {
    await erasureWorkerClient.end()
  }
  if (fixtureDatabase !== database) {
    await fixtureDatabase.disconnect()
  }
  await database.disconnect()
})

describe('study result retry integration', () => {
  it('USER source의 incorrect historical pin만 v2 draft로 만들고 submit event를 보존한다', async () => {
    const userId = await createUser('user-flow')
    const owner = { kind: 'USER' as const, userId }
    const startedAt = new Date('2026-08-21T05:00:00.000Z')
    const source = await createSubmittedSource(
      owner,
      new Set([1, 3]),
      startedAt
    )
    const sourceIncorrectPins = source.submitted.response.items
      .filter(({ isCorrect }) => !isCorrect)
      .map(({ question }) => question.questionVersionId)
    const retryAt = new Date(startedAt.getTime() + 2_000)
    const created = await createStudyResultRetryService(
      retryRepository,
      () => retryAt
    ).create(source.created.session.id, randomUUID(), owner)

    expect(created.replayed).toBe(false)
    expect(created.response).toMatchObject({
      session: {
        mode: 'WRONG_NOTE',
        practiceContractVersion: 2,
        requestedCount: 2,
        actualCount: 2,
        usedFallback: false,
        fallbackReason: null
      }
    })
    expect(
      created.response.questions.map(
        ({ question }) => question.questionVersionId
      )
    ).toEqual(sourceIncorrectPins)
    await expect(
      database.client.studySession.findUniqueOrThrow({
        where: { id: created.response.session.id },
        select: { retryOfStudySessionId: true }
      })
    ).resolves.toEqual({ retryOfStudySessionId: source.created.session.id })
    await expect(
      database.client.studyDraft.findUniqueOrThrow({
        where: { studySessionId: created.response.session.id },
        select: {
          revision: true,
          savedAt: true,
          answers: { select: { selectedOptionId: true } }
        }
      })
    ).resolves.toMatchObject({
      revision: 0,
      savedAt: null,
      answers: [{ selectedOptionId: null }, { selectedOptionId: null }]
    })
    expect(
      await database.client.wrongNote.count({
        where: { userId, currentReviewQuestionVersionId: { not: null } }
      })
    ).toBe(0)

    const retryRecord =
      await database.client.idempotencyRecord.findFirstOrThrow({
        where: {
          operation: 'STUDY_RETRY_CREATE',
          studySessionId: created.response.session.id
        },
        select: { id: true, responseBody: true }
      })
    await fixtureDatabase.client.$executeRawUnsafe(
      'ALTER TABLE "IdempotencyRecord" ' +
        'DISABLE TRIGGER "IdempotencyRecord_validate_change"'
    )
    try {
      for (const responseExpression of [
        `jsonb_set(
          "responseBody" #- '{session,fallbackReason}',
          '{session,extra}', 'null'::jsonb, true
        )`,
        `jsonb_set(
          "responseBody", '{session,usedFallback}', '"false"'::jsonb, true
        )`,
        `jsonb_set(
          "responseBody", '{session,practiceContractVersion}',
          '"2"'::jsonb, true
        )`
      ]) {
        await expectRawDatabaseError({
          expectedMessage:
            'Committed retry idempotency state does not match its target session.',
          operation: async () =>
            await fixtureDatabase.client.$executeRawUnsafe(
              `UPDATE "IdempotencyRecord"
             SET "responseBody" = ${responseExpression}
             WHERE "id" = $1::uuid`,
              retryRecord.id
            ),
          sqlState: '23514'
        })
      }
    } finally {
      await fixtureDatabase.client.$executeRawUnsafe(
        'ALTER TABLE "IdempotencyRecord" ' +
          'ENABLE TRIGGER "IdempotencyRecord_validate_change"'
      )
    }
    expect(
      await database.client.idempotencyRecord.findUniqueOrThrow({
        where: { id: retryRecord.id },
        select: { responseBody: true }
      })
    ).toEqual({ responseBody: retryRecord.responseBody })

    const submittedAt = new Date(retryAt.getTime() + 1_000)
    await createStudySubmissionService(
      submissionRepository,
      () => submittedAt
    ).submit(
      created.response.session.id,
      randomUUID(),
      {
        answers: created.response.questions.map(({ sessionQuestionId }) => ({
          studySessionQuestionId: sessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 0
        })),
        durationSec: 2,
        expectedDraftRevision: 0
      },
      owner,
      2
    )
    const events = await database.client.reviewEvent.findMany({
      where: { studySessionId: created.response.session.id },
      orderBy: { questionVersionId: 'asc' },
      select: { questionVersionId: true, source: true }
    })
    expect(events).toHaveLength(2)
    expect(
      events.every(
        ({ source: eventSource }) => eventSource === 'WRONG_NOTE_REVIEW'
      )
    ).toBe(true)
    expect(
      events.map(({ questionVersionId }) => questionVersionId).toSorted()
    ).toEqual(sourceIncorrectPins.toSorted())
    expect(
      await database.client.wrongNote.count({
        where: { userId, currentReviewQuestionVersionId: { not: null } }
      })
    ).toBe(0)
  })

  it('동시 same-key winner는 target 하나이고 terminal 뒤에도 historical response를 replay한다', async () => {
    const userId = await createUser('response-loss')
    const owner = { kind: 'USER' as const, userId }
    const source = await createSubmittedSource(owner, new Set([1]))
    const idempotencyKey = randomUUID()
    const observedAt = new Date()
    const retryService = createStudyResultRetryService(
      retryRepository,
      () => observedAt
    )
    const outcomes = await Promise.all([
      retryService.create(source.created.session.id, idempotencyKey, owner),
      retryService.create(source.created.session.id, idempotencyKey, owner)
    ])
    expect(outcomes.map(({ replayed }) => replayed).toSorted()).toEqual([
      false,
      true
    ])
    expect(outcomes[0]?.response).toEqual(outcomes[1]?.response)
    const targetId = outcomes[0]?.response.session.id
    if (!targetId) throw new Error('Slice 5 retry target fixture가 필요합니다.')
    expect(
      await database.client.studySession.count({
        where: { retryOfStudySessionId: source.created.session.id }
      })
    ).toBe(1)

    await expect(
      draftRepository.cancelOwned(
        targetId,
        owner,
        new Date(observedAt.getTime() + 1_000)
      )
    ).resolves.toEqual({ kind: 'CANCELLED' })
    await expect(
      retryService.create(source.created.session.id, idempotencyKey, owner)
    ).resolves.toEqual({ replayed: true, response: outcomes[0]?.response })
  })

  it('guest는 RANDOM target만 만들고 foreign owner는 같은 404로 닫는다', async () => {
    const guestOwner = await createGuestOwner()
    const source = await createSubmittedSource(guestOwner, new Set([1]))
    const created = await createStudyResultRetryService(
      retryRepository,
      () => new Date()
    ).create(source.created.session.id, randomUUID(), guestOwner)
    expect(created.response.session).toMatchObject({
      mode: 'RANDOM',
      practiceContractVersion: 2,
      requestedCount: 1,
      actualCount: 1
    })

    const foreignUserId = await createUser('foreign')
    await expect(
      createStudyResultRetryService(retryRepository).create(
        source.created.session.id,
        randomUUID(),
        { kind: 'USER', userId: foreignUserId }
      )
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      message: '재출제할 학습 결과를 찾을 수 없습니다.',
      retryable: false
    })
  })

  it('correct-only는 404이고 archived 오답은 partial actualCount로 제외한다', async () => {
    const userId = await createUser('availability')
    const owner = { kind: 'USER' as const, userId }
    const correctOnly = await createSubmittedSource(owner, new Set())
    await expect(
      createStudyResultRetryService(retryRepository).create(
        correctOnly.created.session.id,
        randomUUID(),
        owner
      )
    ).rejects.toMatchObject({
      code: 'NO_ELIGIBLE_QUESTIONS',
      message: '다시 풀 수 있는 오답 문제가 없습니다.',
      retryable: false
    })

    const allWrong = await createSubmittedSource(owner, new Set([1, 2]))
    const archivedQuestionId = allWrong.submitted.response.items[0]?.question.id
    if (!archivedQuestionId) {
      throw new Error('Slice 5 archived source question fixture가 필요합니다.')
    }
    const original = await database.client.question.findUniqueOrThrow({
      where: { id: archivedQuestionId },
      select: {
        archivedAt: true,
        currentPublishedVersionId: true,
        lifecycleStatus: true,
        rowVersion: true,
        updatedAt: true
      }
    })
    if (isPhase10CurrentSource) {
      const archiveTime = new Date()
      await expectRawDatabaseError({
        expectedMessage:
          'An armed trusted Phase 7 operation intent is required.',
        operation: async () =>
          await database.client.$executeRaw`
            UPDATE "Question"
            SET
              "lifecycleStatus" = 'ARCHIVED',
              "archivedAt" = ${archiveTime},
              "currentPublishedVersionId" = NULL,
              "rowVersion" = "rowVersion" + 1,
              "updatedAt" = ${archiveTime}
            WHERE "id" = ${archivedQuestionId}::uuid
          `,
        sqlState: '42501'
      })
      await expect(
        database.client.question.findUniqueOrThrow({
          where: { id: archivedQuestionId },
          select: {
            archivedAt: true,
            currentPublishedVersionId: true,
            lifecycleStatus: true,
            rowVersion: true,
            updatedAt: true
          }
        })
      ).resolves.toEqual(original)
      const retry = await createStudyResultRetryService(
        retryRepository,
        () => new Date()
      ).create(allWrong.created.session.id, randomUUID(), owner)
      expect(retry.response.session).toMatchObject({
        requestedCount: 2,
        actualCount: 2
      })
      expect(
        retry.response.questions.some(
          ({ question }) => question.id === archivedQuestionId
        )
      ).toBe(true)
      return
    }
    try {
      await database.client.question.update({
        where: { id: archivedQuestionId },
        data: {
          lifecycleStatus: 'ARCHIVED',
          archivedAt: new Date(),
          currentPublishedVersionId: null
        }
      })
      const retry = await createStudyResultRetryService(
        retryRepository,
        () => new Date()
      ).create(allWrong.created.session.id, randomUUID(), owner)
      expect(retry.response.session).toMatchObject({
        requestedCount: 2,
        actualCount: 1
      })
      expect(retry.response.questions[0]?.question.id).not.toBe(
        archivedQuestionId
      )
    } finally {
      await database.client.question.update({
        where: { id: archivedQuestionId },
        data: {
          archivedAt: original.archivedAt,
          currentPublishedVersionId: original.currentPublishedVersionId,
          lifecycleStatus: original.lifecycleStatus,
          rowVersion: original.rowVersion,
          updatedAt: original.updatedAt
        }
      })
    }
  })

  it(
    isPhase10CurrentSource
      ? 'direct retirement 거부 뒤에도 retry와 ReviewEvent가 historical pin을 보존한다'
      : 'source v1을 retire하고 v2를 publish해도 retry와 ReviewEvent는 v1 pin을 보존한다',
    async () => {
      const userId = await createUser('historical-pin')
      const owner = { kind: 'USER' as const, userId }
      if (isPhase10CurrentSource) {
        const startedAt = new Date()
        const source = await createSubmittedSource(
          owner,
          new Set([1]),
          startedAt
        )
        const sourceItem = source.submitted.response.items.find(
          ({ isCorrect }) => !isCorrect
        )
        if (!sourceItem) {
          throw new Error('Phase 10 historical pin source가 필요합니다.')
        }
        const sourceVersionId = sourceItem.question.questionVersionId
        const sourceQuestionId = sourceItem.question.id
        const [versionBefore, questionBefore] = await Promise.all([
          database.client.questionVersion.findUniqueOrThrow({
            where: { id: sourceVersionId }
          }),
          database.client.question.findUniqueOrThrow({
            where: { id: sourceQuestionId },
            select: { currentPublishedVersionId: true }
          })
        ])
        const retirementTime = new Date(startedAt.getTime() + 2_000)
        await expectRawDatabaseError({
          expectedMessage:
            'An armed trusted Phase 7 operation intent is required.',
          operation: async () =>
            await database.client.$executeRaw`
            UPDATE "QuestionVersion"
            SET
              "status" = 'RETIRED',
              "retirementKind" = 'PUBLISHED_RETIREMENT',
              "retiredAt" = ${retirementTime},
              "rowVersion" = "rowVersion" + 1,
              "updatedAt" = ${retirementTime}
            WHERE "id" = ${sourceVersionId}::uuid
          `,
          sqlState: '42501'
        })
        await expect(
          database.client.questionVersion.findUniqueOrThrow({
            where: { id: sourceVersionId }
          })
        ).resolves.toEqual(versionBefore)
        await expect(
          database.client.question.findUniqueOrThrow({
            where: { id: sourceQuestionId },
            select: { currentPublishedVersionId: true }
          })
        ).resolves.toEqual(questionBefore)

        const retried = await createStudyResultRetryService(
          retryRepository,
          () => new Date(startedAt.getTime() + 3_000)
        ).create(source.created.session.id, randomUUID(), owner)
        expect(retried.response.questions).toHaveLength(1)
        expect(retried.response.questions[0]?.question.questionVersionId).toBe(
          sourceVersionId
        )
        await createStudySubmissionService(
          submissionRepository,
          () => new Date(startedAt.getTime() + 4_000)
        ).submit(
          retried.response.session.id,
          randomUUID(),
          {
            answers: retried.response.questions.map(
              ({ sessionQuestionId }) => ({
                studySessionQuestionId: sessionQuestionId,
                selectedOptionId: null,
                elapsedSec: 0
              })
            ),
            durationSec: 0,
            expectedDraftRevision: 0
          },
          owner,
          2
        )
        await expect(
          database.client.reviewEvent.findFirstOrThrow({
            where: { studySessionId: retried.response.session.id },
            select: { questionVersionId: true, source: true }
          })
        ).resolves.toEqual({
          questionVersionId: sourceVersionId,
          source: 'WRONG_NOTE_REVIEW'
        })
        return
      }
      const questionId = randomUUID()
      const versionOneId = randomUUID()
      const versionTwoId = randomUUID()
      const versionOneOptionIds = Array.from({ length: 4 }, () => randomUUID())
      const versionTwoOptionIds = Array.from({ length: 4 }, () => randomUUID())
      const versionOneCorrectOptionId = versionOneOptionIds[0]
      const versionTwoCorrectOptionId = versionTwoOptionIds[0]
      const tagId = randomUUID()
      const startedAt = new Date('2026-08-21T09:00:00.000Z')

      if (!versionOneCorrectOptionId || !versionTwoCorrectOptionId) {
        throw new Error('Slice 5 historical options가 필요합니다.')
      }

      await database.client.$transaction(async (transaction) => {
        await transaction.question.create({
          data: { id: questionId, createdByLabelSnapshot: 'SYSTEM_SEED' }
        })
        await transaction.tag.create({
          data: {
            id: tagId,
            label: 'Slice 5 historical pin',
            normalizedName: `slice5-historical-${questionId}`
          }
        })
        await transaction.questionVersion.create({
          data: {
            id: versionOneId,
            questionId,
            versionNumber: 1,
            level: 'N1',
            subject: 'READING',
            questionType: 'SHORT_READING',
            passage: 'Slice 5 historical pin v1 passage.',
            questionText: 'Slice 5 historical pin v1 question.',
            explanationKo: '재출제 historical pin을 검증하는 원본 설명입니다.',
            difficulty: 'HARD',
            createdByLabelSnapshot: 'SYSTEM_SEED',
            createdAt: startedAt,
            updatedAt: startedAt
          }
        })
        await transaction.questionOption.createMany({
          data: versionOneOptionIds.map((id, index) => ({
            id,
            questionVersionId: versionOneId,
            label: String(index + 1),
            text: `Slice 5 v1 option ${index + 1}`,
            ordinal: index + 1
          }))
        })
        await transaction.questionVersionTag.create({
          data: {
            questionVersionId: versionOneId,
            tagId,
            labelSnapshot: 'Slice 5 historical pin'
          }
        })
        await transaction.questionVersion.update({
          where: { id: versionOneId },
          data: {
            correctOptionId: versionOneCorrectOptionId,
            status: 'PUBLISHED',
            publishedAt: startedAt
          }
        })
        await transaction.question.update({
          where: { id: questionId },
          data: { currentPublishedVersionId: versionOneId }
        })
      })

      const sourceSessionQuestionId = randomUUID()
      const sourceSession = await database.client.$transaction(
        async (transaction) => {
          const session = await transaction.studySession.create({
            data: {
              userId,
              level: 'N1',
              subject: 'READING',
              mode: 'RANDOM',
              requestedCount: 1,
              actualCount: 1,
              usedFallback: false,
              practiceContractVersion: 1,
              startedAt,
              expiresAt: new Date(startedAt.getTime() + DAY_MS)
            },
            select: { id: true }
          })
          await transaction.studySessionQuestion.create({
            data: {
              id: sourceSessionQuestionId,
              studySessionId: session.id,
              questionId,
              questionVersionId: versionOneId,
              ordinal: 1,
              createdAt: startedAt
            }
          })
          return session
        }
      )
      await createStudySubmissionService(
        submissionRepository,
        () => new Date(startedAt.getTime() + 1_000)
      ).submit(
        sourceSession.id,
        randomUUID(),
        {
          answers: [
            {
              studySessionQuestionId: sourceSessionQuestionId,
              selectedOptionId: null,
              elapsedSec: 1
            }
          ],
          durationSec: 1
        },
        owner,
        1
      )

      const publishedAt = new Date(startedAt.getTime() + 2_000)
      await database.client.$transaction(async (transaction) => {
        await transaction.questionVersion.create({
          data: {
            id: versionTwoId,
            questionId,
            versionNumber: 2,
            level: 'N1',
            subject: 'READING',
            questionType: 'SHORT_READING',
            passage: 'Slice 5 historical pin v2 passage.',
            questionText: 'Slice 5 historical pin v2 question.',
            explanationKo: '새 current version과 historical pin을 구분합니다.',
            difficulty: 'HARD',
            createdByLabelSnapshot: 'SYSTEM_SEED',
            createdAt: publishedAt,
            updatedAt: publishedAt
          }
        })
        await transaction.questionOption.createMany({
          data: versionTwoOptionIds.map((id, index) => ({
            id,
            questionVersionId: versionTwoId,
            label: String(index + 1),
            text: `Slice 5 v2 option ${index + 1}`,
            ordinal: index + 1
          }))
        })
        await transaction.questionVersionTag.create({
          data: {
            questionVersionId: versionTwoId,
            tagId,
            labelSnapshot: 'Slice 5 historical pin'
          }
        })
        await transaction.questionVersion.update({
          where: { id: versionTwoId },
          data: {
            correctOptionId: versionTwoCorrectOptionId,
            status: 'PUBLISHED',
            publishedAt
          }
        })
        await transaction.question.update({
          where: { id: questionId },
          data: { currentPublishedVersionId: versionTwoId }
        })
        await transaction.questionVersion.update({
          where: { id: versionOneId },
          data: { status: 'RETIRED', retiredAt: publishedAt }
        })
      })

      const retried = await createStudyResultRetryService(
        retryRepository,
        () => new Date(startedAt.getTime() + 3_000)
      ).create(sourceSession.id, randomUUID(), owner)
      expect(retried.response.questions[0]?.question.questionVersionId).toBe(
        versionOneId
      )
      expect(
        await database.client.question.findUniqueOrThrow({
          where: { id: questionId },
          select: { currentPublishedVersionId: true }
        })
      ).toEqual({ currentPublishedVersionId: versionTwoId })

      await createStudySubmissionService(
        submissionRepository,
        () => new Date(startedAt.getTime() + 4_000)
      ).submit(
        retried.response.session.id,
        randomUUID(),
        {
          answers: retried.response.questions.map(({ sessionQuestionId }) => ({
            studySessionQuestionId: sessionQuestionId,
            selectedOptionId: null,
            elapsedSec: 0
          })),
          durationSec: 0,
          expectedDraftRevision: 0
        },
        owner,
        2
      )
      await expect(
        database.client.reviewEvent.findFirstOrThrow({
          where: { studySessionId: retried.response.session.id },
          select: { questionVersionId: true, source: true }
        })
      ).resolves.toEqual({
        questionVersionId: versionOneId,
        source: 'WRONG_NOTE_REVIEW'
      })
    }
  )
})
