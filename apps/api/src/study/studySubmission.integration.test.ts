import { randomUUID } from 'node:crypto'
import { submitStudySessionV2ResponseSchema } from '@nihongo/contracts/study/submit-study-session'
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
import { createPrismaWrongNoteTargetedReviewRepository } from '../wrong-note/wrongNoteTargetedReviewRepository.js'
import { createWrongNoteTargetedReviewService } from '../wrong-note/wrongNoteTargetedReviewService.js'
import {
  createPrismaStudySessionRepository,
  type ExistingStudyOwner,
  type StudySessionRecord
} from './studySessionRepository.js'
import {
  createGuestResultImportService,
  createPrismaGuestResultImportRepository
} from './guestResultImport.js'
import { createPrismaStudyDraftRepository } from './studyDraftRepository.js'
import { createPrismaStudySubmissionRepository } from './studySubmissionRepository.js'
import { createStudySubmissionService } from './studySubmissionService.js'
import {
  createPrismaStudyGoalRepository,
  createStudyGoalService
} from '../member/studyGoal.js'
import { eraseTestUser } from '../../test/fixtures/db/accountErasure.js'

const DAY_MS = 24 * 60 * 60 * 1_000

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const isCurrentSourceIntegration =
  process.env.API_INTEGRATION_CURRENT_SOURCE === '1'
const fixtureDatabaseUrl = process.env.API_INTEGRATION_FIXTURE_DATABASE_URL
const appFixtureDatabaseUrl = process.env.TEST_APP_FIXTURE_DATABASE_URL
if (
  isCurrentSourceIntegration &&
  (!fixtureDatabaseUrl || !appFixtureDatabaseUrl)
) {
  throw new Error('Study submission requires fixture and erasure databases.')
}
for (const databaseUrl of [fixtureDatabaseUrl, appFixtureDatabaseUrl]) {
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
  isCurrentSourceIntegration
    ? { migrationProfile: 'current', startupRole: 'nihongo_app' }
    : {}
)
const fixtureDatabase = fixtureDatabaseUrl
  ? createDatabaseRuntime(fixtureDatabaseUrl)
  : database
const erasureWorkerClient = appFixtureDatabaseUrl
  ? new Client({
      connectionString: appFixtureDatabaseUrl,
      options: createPostgresStartupOptions(
        getPostgresSchema(appFixtureDatabaseUrl)
      )
    })
  : undefined
const sessionRepository = createPrismaStudySessionRepository(database.client)
const submissionRepository = createPrismaStudySubmissionRepository(
  database.client
)
const guestPrincipalService = createGuestPrincipalService({
  client: database.client,
  secret: environment.GUEST_COOKIE_SECRET
})
const createdUserIds = new Set<string>()
const createdGuestIds = new Set<string>()

interface AnswerMaterial {
  correctOptionId: string
  studySessionQuestionId: string
}

interface PinnedQuestionMaterial {
  correctOptionId: string
  questionId: string
  questionVersionId: string
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

const createUser = async (): Promise<string> => {
  const userId = randomUUID()
  await fixtureDatabase.client.$transaction(async (fixture) => {
    await fixture.user.create({
      data: {
        id: userId,
        name: 'Slice 4 submission user',
        email: `slice4-submit-${randomUUID()}@example.test`,
        emailVerified: true
      }
    })
    await fixture.account.create({
      data: {
        accountId: userId,
        password: 'test-fixture-password-hash',
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
    await eraseTestUser(database.client, userId)
  } else {
    await fixtureDatabase.client.user.delete({ where: { id: userId } })
  }
  createdUserIds.delete(userId)
}

const createSession = async (
  owner: ExistingStudyOwner,
  requestedCount: number,
  startedAt: Date
): Promise<StudySessionRecord> => {
  const created = await sessionRepository.createRandom({
    level: 'N5',
    subject: 'VOCABULARY',
    owner,
    requestedCount,
    startedAt,
    expiresAt: new Date(startedAt.getTime() + DAY_MS)
  })
  return created.session
}

const loadPinnedQuestion = async (): Promise<PinnedQuestionMaterial> => {
  const question = await database.client.question.findFirst({
    where: {
      lifecycleStatus: 'ACTIVE',
      currentPublishedVersion: {
        is: { level: 'N5', subject: 'VOCABULARY', status: 'PUBLISHED' }
      }
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      currentPublishedVersion: {
        select: { id: true, correctOptionId: true }
      }
    }
  })
  if (!question?.currentPublishedVersion?.correctOptionId) {
    throw new Error('Pinned submission question fixture is required.')
  }
  return {
    questionId: question.id,
    questionVersionId: question.currentPublishedVersion.id,
    correctOptionId: question.currentPublishedVersion.correctOptionId
  }
}

const loadPinnedQuestions = async (
  maximum: number
): Promise<PinnedQuestionMaterial[]> => {
  const questions = await database.client.question.findMany({
    where: {
      lifecycleStatus: 'ACTIVE',
      currentPublishedVersion: {
        is: { level: 'N5', subject: 'VOCABULARY', status: 'PUBLISHED' }
      }
    },
    orderBy: { id: 'asc' },
    take: maximum,
    select: {
      id: true,
      currentPublishedVersion: {
        select: { id: true, correctOptionId: true }
      }
    }
  })
  return questions.map((question) => {
    if (!question.currentPublishedVersion?.correctOptionId) {
      throw new Error('Pinned submission question fixture is required.')
    }
    return {
      questionId: question.id,
      questionVersionId: question.currentPublishedVersion.id,
      correctOptionId: question.currentPublishedVersion.correctOptionId
    }
  })
}

const createPinnedSession = async (
  owner: ExistingStudyOwner,
  pinned: PinnedQuestionMaterial,
  startedAt: Date
): Promise<{ id: string; material: AnswerMaterial }> => {
  const studySessionQuestionId = randomUUID()
  const id = await database.client.$transaction(async (transaction) => {
    const session = await transaction.studySession.create({
      data: {
        ...(owner.kind === 'USER'
          ? { userId: owner.userId }
          : { guestPrincipalId: owner.guestPrincipalId }),
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        practiceContractVersion: 2,
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
        studySessionId: session.id,
        questionId: pinned.questionId,
        questionVersionId: pinned.questionVersionId,
        ordinal: 1,
        createdAt: startedAt
      }
    })
    await transaction.studyDraft.create({
      data: {
        studySessionId: session.id,
        revision: 0,
        currentOrdinal: 1,
        createdAt: startedAt,
        updatedAt: startedAt,
        answers: {
          create: {
            studySessionQuestionId,
            questionVersionId: pinned.questionVersionId,
            selectedOptionId: null,
            elapsedSec: 0,
            updatedAt: startedAt
          }
        }
      }
    })
    return session.id
  })
  return {
    id,
    material: {
      correctOptionId: pinned.correctOptionId,
      studySessionQuestionId
    }
  }
}

const loadAnswerMaterial = async (
  sessionId: string
): Promise<readonly AnswerMaterial[]> => {
  const questions = await database.client.studySessionQuestion.findMany({
    where: { studySessionId: sessionId },
    orderBy: { ordinal: 'asc' },
    select: {
      id: true,
      questionVersion: { select: { correctOptionId: true } }
    }
  })
  return questions.map((question) => {
    if (!question.questionVersion.correctOptionId) {
      throw new Error('Published question fixture has no correct option.')
    }
    return {
      studySessionQuestionId: question.id,
      correctOptionId: question.questionVersion.correctOptionId
    }
  })
}

const createBody = (
  material: readonly AnswerMaterial[],
  selected: (item: AnswerMaterial, index: number) => string | null
) => ({
  answers: material.map((item, index) => ({
    studySessionQuestionId: item.studySessionQuestionId,
    selectedOptionId: selected(item, index),
    elapsedSec: index + 1
  })),
  durationSec: material.length * 10
})

const prepareBody = async (
  sessionId: string,
  owner: ExistingStudyOwner,
  body: ReturnType<typeof createBody>,
  observedAt: Date
) => {
  // Guests keep no draft and submit with revision 0 (#737).
  if (owner.kind === 'GUEST') {
    return { ...body, expectedDraftRevision: 0 }
  }
  const saved = await createPrismaStudyDraftRepository(
    database.client
  ).saveAtomic({
    sessionId,
    idempotencyKey: randomUUID(),
    owner,
    observedAt,
    body: { expectedRevision: 0, currentOrdinal: 1, answers: body.answers }
  })
  return { ...body, expectedDraftRevision: saved.response.revision }
}

const countSessionAnswers = async (sessionId: string): Promise<number> =>
  await database.client.studyAnswer.count({
    where: { studySessionQuestion: { studySessionId: sessionId } }
  })

beforeAll(async () => {
  await database.checkReadiness()
  if (erasureWorkerClient) {
    await erasureWorkerClient.connect()
    await erasureWorkerClient.query(`SET ROLE "nihongo_app"`)
  }
})

afterAll(async () => {
  if (createdUserIds.size > 0) {
    if (erasureWorkerClient) {
      for (const userId of [...createdUserIds]) await eraseUser(userId)
    } else {
      await fixtureDatabase.client.user.deleteMany({
        where: { id: { in: [...createdUserIds] } }
      })
    }
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

describe('Study submission PostgreSQL transaction', () => {
  it('USER first submit/replay/conflict/result와 historical wrong-note event를 원자적으로 처리한다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const startedAt = new Date()
    const session = await createSession(owner, 2, startedAt)
    const material = await loadAnswerMaterial(session.id)
    const observedAt = new Date(startedAt.getTime() + 1_000)
    const service = createStudySubmissionService(
      submissionRepository,
      () => new Date(observedAt)
    )
    const body = await prepareBody(
      session.id,
      owner,
      createBody(material, (item, index) =>
        index === 0 ? item.correctOptionId : null
      ),
      startedAt
    )
    const idempotencyKey = randomUUID()

    const first = await service.submit(session.id, idempotencyKey, body, owner)
    const response = submitStudySessionV2ResponseSchema.parse(first.response)

    expect(first.replayed).toBe(false)
    expect(response).toMatchObject({
      sessionId: session.id,
      totalCount: 2,
      correctCount: 1,
      incorrectCount: 1,
      correctRate: 50,
      durationSec: 20,
      stampEarned: false
    })
    expect(
      response.items.map(({ wrongNoteStatus }) => wrongNoteStatus)
    ).toEqual([null, 'NEW'])
    expect(await countSessionAnswers(session.id)).toBe(2)
    expect(
      await database.client.studyResult.count({
        where: { studySessionId: session.id }
      })
    ).toBe(1)
    expect(
      await database.client.reviewEvent.count({
        where: { studySessionId: session.id }
      })
    ).toBe(1)
    expect(await database.client.wrongNote.count({ where: { userId } })).toBe(1)

    const replay = await service.submit(
      session.id,
      idempotencyKey,
      { ...body, answers: [...body.answers].reverse() },
      owner
    )
    expect(replay).toMatchObject({ replayed: true, response: first.response })
    expect(await countSessionAnswers(session.id)).toBe(2)
    expect(
      await database.client.reviewEvent.count({
        where: { studySessionId: session.id }
      })
    ).toBe(1)

    await expect(
      service.submit(
        session.id,
        idempotencyKey,
        { ...body, durationSec: body.durationSec + 1 },
        owner
      )
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
    await expect(
      service.submit(session.id, randomUUID(), body, owner)
    ).rejects.toMatchObject({
      code: 'SESSION_ALREADY_SUBMITTED',
      location: `/api/v1/study-sessions/${session.id}/result`
    })
    await expect(service.getResult(session.id, owner)).resolves.toEqual({
      ...first.response,
      stampEarned: undefined
    })

    const secondSession = await createSession(owner, 5, startedAt)
    const secondMaterial = await loadAnswerMaterial(secondSession.id)
    const secondBody = await prepareBody(
      secondSession.id,
      owner,
      createBody(secondMaterial, ({ correctOptionId }) => correctOptionId),
      startedAt
    )
    const second = await service.submit(
      secondSession.id,
      randomUUID(),
      secondBody,
      owner
    )
    const existingReviewItems = second.response.items.filter(
      ({ wrongNoteStatus }) => wrongNoteStatus !== null
    )

    expect(existingReviewItems).toHaveLength(1)
    expect(existingReviewItems[0]?.wrongNoteStatus).toBe('REVIEWING')
    expect(
      await database.client.reviewEvent.count({
        where: { studySessionId: secondSession.id }
      })
    ).toBe(1)
    await expect(service.getResult(session.id, owner)).resolves.toEqual({
      ...first.response,
      stampEarned: undefined
    })
  })

  it('#1094 하루 목표에 닿는 세트에서만 도장 1개를 적립하고 재시도는 같은 답을 돌려준다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const studyGoals = createStudyGoalService(
      createPrismaStudyGoalRepository(database.client)
    )
    const startedAt = new Date()
    const service = createStudySubmissionService(
      submissionRepository,
      () => new Date(startedAt.getTime() + 1_000)
    )
    const submitFive = async (idempotencyKey = randomUUID()) => {
      const session = await createSession(owner, 5, startedAt)
      const material = await loadAnswerMaterial(session.id)
      const body = await prepareBody(
        session.id,
        owner,
        createBody(material, ({ correctOptionId }) => correctOptionId),
        startedAt
      )
      const submitted = await service.submit(
        session.id,
        idempotencyKey,
        body,
        owner
      )
      return { body, idempotencyKey, session, submitted }
    }

    // No daily goal yet: answers count, no stamp.
    expect((await submitFive()).submitted.response.stampEarned).toBe(false)
    expect(await studyGoals.read(userId)).toMatchObject({
      todayAnsweredCount: 5,
      monthStampDates: []
    })

    // Goal 20: 10 answers so far, then two sets at once reach 20 together;
    // the Serializable submission retries, so exactly one of them earns the
    // one stamp (#1110 QA).
    await studyGoals.update(userId, { targetLevel: 'N5', dailyGoal: 20 })
    expect((await submitFive()).submitted.response.stampEarned).toBe(false)
    const together = await Promise.all([submitFive(), submitFive()])
    expect(
      together.map(({ submitted }) => submitted.response.stampEarned).sort()
    ).toEqual([false, true])
    const earning = together.find(
      ({ submitted }) => submitted.response.stampEarned
    )!
    const replay = await service.submit(
      earning.session.id,
      earning.idempotencyKey,
      earning.body,
      owner
    )
    expect(replay).toMatchObject({
      replayed: true,
      response: { stampEarned: true }
    })
    await expect(
      service.getResult(earning.session.id, owner)
    ).resolves.not.toHaveProperty('stampEarned')

    // Later sets the same day, even after lowering the goal: no second stamp.
    expect((await submitFive()).submitted.response.stampEarned).toBe(false)
    await studyGoals.update(userId, { targetLevel: 'N5', dailyGoal: 10 })
    expect((await submitFive()).submitted.response.stampEarned).toBe(false)
    expect(await studyGoals.read(userId)).toMatchObject({
      todayAnsweredCount: 30
    })
    const rows = await database.client.$queryRaw<
      Array<{
        earnedOn: string
        reason: string
        goalAtEarn: number | null
        amount: number
      }>
    >`
      SELECT "earnedOn"::text AS "earnedOn", "reason", "goalAtEarn",
        "amount"::int AS "amount"
      FROM "StampLedger" WHERE "userId" = ${userId}::uuid
    `
    expect(rows).toEqual([
      {
        earnedOn: expect.any(String),
        reason: 'DAILY_GOAL',
        goalAtEarn: 20,
        amount: 1
      }
    ])
    // This month's stamp board shows that one day.
    expect((await studyGoals.read(userId))?.monthStampDates).toEqual([
      rows[0]?.earnedOn
    ])

    if (isCurrentSourceIntegration) {
      // nihongo_app only adds and reads ledger rows.
      for (const statement of [
        database.client.$executeRaw`
          UPDATE "StampLedger" SET "goalAtEarn" = 30
          WHERE "userId" = ${userId}::uuid
        `,
        database.client.$executeRaw`
          DELETE FROM "StampLedger" WHERE "userId" = ${userId}::uuid
        `
      ])
        await expect(statement).rejects.toMatchObject({
          message: expect.stringMatching(/permission denied/u)
        })
    }
    // One adding row per member, day and reason; a DAILY_GOAL row adds 1.
    await expect(
      database.client.$executeRaw`
        INSERT INTO "StampLedger"
          ("id", "userId", "earnedOn", "reason", "goalAtEarn")
        SELECT ${randomUUID()}::uuid, "userId", "earnedOn", "reason", 20
        FROM "StampLedger" WHERE "userId" = ${userId}::uuid
      `
    ).rejects.toMatchObject({
      message: expect.stringMatching(
        /StampLedger_userId_earnedOn_reason_earn_key/u
      )
    })
    for (const amount of [0, -1, 2])
      await expect(
        database.client.$executeRaw`
          INSERT INTO "StampLedger"
            ("id", "userId", "earnedOn", "reason", "goalAtEarn", "amount")
          SELECT ${randomUUID()}::uuid, "userId", "earnedOn", "reason", 20,
            ${amount}
          FROM "StampLedger" WHERE "userId" = ${userId}::uuid
        `
      ).rejects.toMatchObject({
        message: expect.stringMatching(/StampLedger_amount_check/u)
      })
    // Rows that use stamps (amount < 0) may repeat on a day.
    await expect(
      database.client.$executeRaw`
        INSERT INTO "StampLedger"
          ("id", "userId", "earnedOn", "reason", "amount")
        SELECT gen_random_uuid(), "userId", "earnedOn", 'SPEND_TEST', -1
        FROM "StampLedger", generate_series(1, 2)
        WHERE "userId" = ${userId}::uuid AND "reason" = 'DAILY_GOAL'
      `
    ).resolves.toBe(2)
  })

  it('WEAKNESS·BOOKMARK·WRONG_NOTE·DAILY_REVIEW를 owner facts로 선택하고 mode별 event source를 보존한다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const pinned = await loadPinnedQuestion()
    const baseTime = Date.now()

    for (let index = 0; index < 3; index += 1) {
      const startedAt = new Date(baseTime + index * 1_000)
      const historical = await createPinnedSession(owner, pinned, startedAt)
      await createStudySubmissionService(
        submissionRepository,
        () => new Date(startedAt.getTime() + 100)
      ).submit(
        historical.id,
        randomUUID(),
        await prepareBody(
          historical.id,
          owner,
          createBody([historical.material], () => null),
          startedAt
        ),
        owner
      )
    }

    const noteBeforeSelection =
      await database.client.wrongNote.findUniqueOrThrow({
        where: {
          userId_questionId: { userId, questionId: pinned.questionId }
        },
        select: {
          currentReviewQuestionVersionId: true,
          updatedAt: true,
          wrongCount: true
        }
      })
    expect(noteBeforeSelection).toMatchObject({
      currentReviewQuestionVersionId: null,
      wrongCount: 3
    })

    const createModeSession = async (
      mode: 'WEAKNESS' | 'BOOKMARK' | 'WRONG_NOTE' | 'DAILY_REVIEW',
      offsetMilliseconds: number
    ): Promise<StudySessionRecord> => {
      const startedAt = new Date(baseTime + offsetMilliseconds)
      const created = await sessionRepository.create({
        level: 'N5',
        subject: 'VOCABULARY',
        mode,
        owner,
        requestedCount: 1,
        practiceContractVersion: 2,
        startedAt,
        expiresAt: new Date(startedAt.getTime() + DAY_MS)
      })
      expect(created.session.questions).toHaveLength(1)
      expect(created.session.questions[0]?.question.id).toBe(pinned.questionId)
      return created.session
    }

    const weakness = await createModeSession('WEAKNESS', 10_000)
    const weaknessAnswer = await loadAnswerMaterial(weakness.id)
    await createStudySubmissionService(
      submissionRepository,
      () => new Date(baseTime + 10_100)
    ).submit(
      weakness.id,
      randomUUID(),
      {
        answers: weaknessAnswer.map(({ studySessionQuestionId }) => ({
          studySessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 0
        })),
        durationSec: 0,
        expectedDraftRevision: 0
      },
      owner
    )

    await database.client.bookmark.create({
      data: {
        userId,
        questionId: pinned.questionId,
        createdAt: new Date(baseTime + 15_000)
      }
    })
    const bookmark = await createModeSession('BOOKMARK', 15_000)
    const bookmarkAnswer = await loadAnswerMaterial(bookmark.id)
    await createStudySubmissionService(
      submissionRepository,
      () => new Date(baseTime + 15_100)
    ).submit(
      bookmark.id,
      randomUUID(),
      {
        answers: bookmarkAnswer.map(({ studySessionQuestionId }) => ({
          studySessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 0
        })),
        durationSec: 0,
        expectedDraftRevision: 0
      },
      owner
    )

    const beforePointerUpdate =
      await database.client.wrongNote.findUniqueOrThrow({
        where: {
          userId_questionId: { userId, questionId: pinned.questionId }
        },
        select: { updatedAt: true }
      })

    const wrongNote = await createModeSession('WRONG_NOTE', 20_000)
    const pointerAfterWrongNote =
      await database.client.wrongNote.findUniqueOrThrow({
        where: {
          userId_questionId: { userId, questionId: pinned.questionId }
        },
        select: { currentReviewQuestionVersionId: true, updatedAt: true }
      })
    expect(pointerAfterWrongNote).toEqual({
      currentReviewQuestionVersionId: pinned.questionVersionId,
      updatedAt: beforePointerUpdate.updatedAt
    })
    const wrongNoteAnswer = await loadAnswerMaterial(wrongNote.id)
    await createStudySubmissionService(
      submissionRepository,
      () => new Date(baseTime + 20_100)
    ).submit(
      wrongNote.id,
      randomUUID(),
      {
        answers: wrongNoteAnswer.map(({ studySessionQuestionId }) => ({
          studySessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 0
        })),
        durationSec: 0,
        expectedDraftRevision: 0
      },
      owner
    )

    const daily = await createModeSession('DAILY_REVIEW', DAY_MS + 30_000)
    const dailyAnswer = await loadAnswerMaterial(daily.id)
    await createStudySubmissionService(
      submissionRepository,
      () => new Date(baseTime + DAY_MS + 30_100)
    ).submit(
      daily.id,
      randomUUID(),
      {
        answers: dailyAnswer.map(({ studySessionQuestionId }) => ({
          studySessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 0
        })),
        durationSec: 0,
        expectedDraftRevision: 0
      },
      owner
    )

    const targetedAt = new Date(baseTime + DAY_MS + 40_000)
    const targetedCreateKey = randomUUID()
    const targeted = await createWrongNoteTargetedReviewService(
      createPrismaWrongNoteTargetedReviewRepository(database.client, {
        delay: async () => undefined,
        jitterMilliseconds: () => 0
      }),
      () => targetedAt
    ).createTargetedReviewSession(userId, pinned.questionId, targetedCreateKey)
    expect(targeted.replayed).toBe(false)
    expect(targeted.response.questions[0]?.question).toMatchObject({
      id: pinned.questionId,
      questionVersionId: pinned.questionVersionId
    })
    expect(
      await database.client.reviewEvent.count({
        where: { studySessionId: targeted.response.session.id }
      })
    ).toBe(0)
    const targetedAnswer = await loadAnswerMaterial(
      targeted.response.session.id
    )
    const targetedSubmitKey = randomUUID()
    const targetedSubmitBody = {
      answers: targetedAnswer.map(({ studySessionQuestionId }) => ({
        studySessionQuestionId,
        selectedOptionId: null,
        elapsedSec: 0
      })),
      durationSec: 0,
      expectedDraftRevision: 0
    }
    const targetedSubmitService = createStudySubmissionService(
      submissionRepository,
      () => new Date(targetedAt.getTime() + 100)
    )
    const targetedSubmission = await targetedSubmitService.submit(
      targeted.response.session.id,
      targetedSubmitKey,
      targetedSubmitBody,
      owner
    )
    expect(targetedSubmission.replayed).toBe(false)
    await expect(
      targetedSubmitService.submit(
        targeted.response.session.id,
        targetedSubmitKey,
        targetedSubmitBody,
        owner
      )
    ).resolves.toMatchObject({
      replayed: true,
      response: targetedSubmission.response
    })
    await expect(
      createWrongNoteTargetedReviewService(
        createPrismaWrongNoteTargetedReviewRepository(database.client),
        () => new Date(targetedAt.getTime() + 200)
      ).createTargetedReviewSession(
        userId,
        pinned.questionId,
        targetedCreateKey
      )
    ).resolves.toEqual({ replayed: true, response: targeted.response })

    const events = await database.client.reviewEvent.findMany({
      where: {
        studySessionId: {
          in: [
            weakness.id,
            bookmark.id,
            wrongNote.id,
            daily.id,
            targeted.response.session.id
          ]
        }
      },
      orderBy: { occurredAt: 'asc' },
      select: { source: true, studySessionId: true, questionVersionId: true }
    })
    expect(events).toEqual([
      {
        source: 'STUDY_SUBMIT',
        studySessionId: weakness.id,
        questionVersionId: pinned.questionVersionId
      },
      {
        source: 'STUDY_SUBMIT',
        studySessionId: bookmark.id,
        questionVersionId: pinned.questionVersionId
      },
      {
        source: 'WRONG_NOTE_REVIEW',
        studySessionId: wrongNote.id,
        questionVersionId: pinned.questionVersionId
      },
      {
        source: 'WRONG_NOTE_REVIEW',
        studySessionId: daily.id,
        questionVersionId: pinned.questionVersionId
      },
      {
        source: 'WRONG_NOTE_REVIEW',
        studySessionId: targeted.response.session.id,
        questionVersionId: pinned.questionVersionId
      }
    ])
    expect(
      await database.client.wrongNote.findUniqueOrThrow({
        where: {
          userId_questionId: { userId, questionId: pinned.questionId }
        },
        select: { currentReviewQuestionVersionId: true }
      })
    ).toEqual({ currentReviewQuestionVersionId: pinned.questionVersionId })
  })

  const submitPinned = async (
    owner: ExistingStudyOwner,
    pinned: PinnedQuestionMaterial,
    startedAt: Date
  ): Promise<string> => {
    const history = await createPinnedSession(owner, pinned, startedAt)
    await createStudySubmissionService(
      submissionRepository,
      () => new Date(startedAt.getTime() + 100)
    ).submit(
      history.id,
      randomUUID(),
      await prepareBody(
        history.id,
        owner,
        createBody([history.material], () => null),
        startedAt
      ),
      owner
    )
    return history.id
  }

  const startRandomSet = async (
    owner: ExistingStudyOwner,
    requestedCount: number,
    startedAt: Date
  ): Promise<string[]> => {
    const created = await createPrismaStudySessionRepository(database.client, {
      random: () => 0
    }).create({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      owner,
      requestedCount,
      practiceContractVersion: 2,
      startedAt,
      expiresAt: new Date(startedAt.getTime() + DAY_MS)
    })
    return created.session.questions.map(({ question }) => question.id)
  }

  it('RANDOM은 안 본 문제 먼저, 다음은 제출해서 본 지 오래된 순으로 낸다 (#1242)', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const pinnedQuestions = await loadPinnedQuestions(20)
    if (pinnedQuestions.length < 5) {
      throw new Error('#1242 출제 순서에는 published 문제 5개가 필요합니다.')
    }
    const baseTime = Date.now()
    // Four submitted sets, the first 40 days ago: no 7-day window and no
    // last-three limit any more.
    const seen = pinnedQuestions.slice(0, 4)
    for (const [index, pinned] of seen.entries()) {
      await submitPinned(
        owner,
        pinned,
        new Date(baseTime - [40, 20, 2, 1][index]! * DAY_MS)
      )
    }
    // A set left unsubmitted does not count as seen.
    const unsubmitted = pinnedQuestions[4]!
    await createPinnedSession(owner, unsubmitted, new Date(baseTime - DAY_MS))

    const selectedIds = await startRandomSet(
      owner,
      pinnedQuestions.length,
      new Date(baseTime + 10_000)
    )
    const seenIds = seen.map(({ questionId }) => questionId)
    expect(new Set(selectedIds).size).toBe(pinnedQuestions.length)
    expect(selectedIds.slice(-seenIds.length)).toEqual(seenIds)
    expect(selectedIds.slice(0, -seenIds.length)).toContain(
      unsubmitted.questionId
    )
  })

  it('로그인 때 가져온 게스트 세트도 회원이 본 문제로 이어진다 (#1242)', async () => {
    const resolved = await guestPrincipalService.create()
    const rawCookie = resolved.cookieValue
    if (!rawCookie) throw new Error('Guest cookie fixture is required.')
    createdGuestIds.add(resolved.id)
    const inspected = guestPrincipalService.inspectCookie(rawCookie)
    if (inspected.kind !== 'VERIFIED') {
      throw new Error('Verified guest credential is required.')
    }
    const guestOwner = {
      kind: 'GUEST' as const,
      guestPrincipalId: inspected.id,
      tokenDigest: inspected.tokenDigest
    }
    const pinnedQuestions = await loadPinnedQuestions(20)
    const [guestSeen] = pinnedQuestions
    if (!guestSeen || pinnedQuestions.length < 2) {
      throw new Error(
        '#1242 게스트 이어짐에는 published 문제 2개가 필요합니다.'
      )
    }
    // Every time comes after the guest was made, so the guest is found.
    const baseTime = Date.now() + 1_000
    const importedSessionId = await submitPinned(
      guestOwner,
      guestSeen,
      new Date(baseTime)
    )
    // The guest already gets it last.
    expect(
      (
        await startRandomSet(
          guestOwner,
          pinnedQuestions.length,
          new Date(baseTime + 5_000)
        )
      ).at(-1)
    ).toBe(guestSeen.questionId)

    const userId = await createUser()
    await expect(
      createGuestResultImportService(
        createPrismaGuestResultImportRepository(database.client)
      ).importLast({
        guest: { id: inspected.id, tokenDigest: inspected.tokenDigest },
        observedAt: new Date(baseTime + 8_000),
        userId
      })
    ).resolves.toMatchObject({ importedSessionId })

    const selectedIds = await startRandomSet(
      { kind: 'USER', userId },
      pinnedQuestions.length,
      new Date(baseTime + 10_000)
    )
    expect(selectedIds.at(-1)).toBe(guestSeen.questionId)
  })

  it('existing guest WEAKNESS는 같은 guest의 stable-question history만 사용한다', async () => {
    const resolved = await guestPrincipalService.create()
    const rawCookie = resolved.cookieValue
    if (!rawCookie) {
      throw new Error('Guest cookie fixture is required.')
    }
    createdGuestIds.add(resolved.id)
    const inspected = guestPrincipalService.inspectCookie(rawCookie)
    if (inspected.kind !== 'VERIFIED') {
      throw new Error('Verified guest credential is required.')
    }
    const owner = {
      kind: 'GUEST' as const,
      guestPrincipalId: inspected.id,
      tokenDigest: inspected.tokenDigest
    }
    const pinned = await loadPinnedQuestion()
    const baseTime = Date.now()

    // The service no longer lets guests start WEAKNESS (#737); this pins the
    // repository's owner scoping. History sits on earlier days so the guest
    // daily session limit does not refuse the final start.
    for (let index = 0; index < 3; index += 1) {
      const startedAt = new Date(baseTime - (3 - index) * DAY_MS)
      const history = await createPinnedSession(owner, pinned, startedAt)
      await createStudySubmissionService(
        submissionRepository,
        () => new Date(startedAt.getTime() + 100)
      ).submit(
        history.id,
        randomUUID(),
        await prepareBody(
          history.id,
          owner,
          createBody([history.material], () => null),
          startedAt
        ),
        owner
      )
    }

    const startedAt = new Date(baseTime + 10_000)
    const created = await sessionRepository.create({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'WEAKNESS',
      owner,
      requestedCount: 5,
      practiceContractVersion: 2,
      startedAt,
      expiresAt: new Date(startedAt.getTime() + DAY_MS)
    })

    expect(created.issuedGuestCredential).toBeNull()
    expect(created.session).toMatchObject({
      mode: 'WEAKNESS',
      requestedCount: 5,
      actualCount: 1,
      usedFallback: false
    })
    expect(created.session.questions[0]?.question.id).toBe(pinned.questionId)
    expect(
      await database.client.reviewEvent.count({
        where: {
          studySession: { guestPrincipalId: owner.guestPrincipalId }
        }
      })
    ).toBe(0)
  })

  it('foreign USER submit/result는 존재를 숨기고 submission write를 만들지 않는다', async () => {
    const ownerUserId = await createUser()
    const foreignUserId = await createUser()
    const owner = { kind: 'USER' as const, userId: ownerUserId }
    const foreignOwner = { kind: 'USER' as const, userId: foreignUserId }
    const startedAt = new Date()
    const session = await createSession(owner, 1, startedAt)
    const material = await loadAnswerMaterial(session.id)
    const body = {
      ...createBody(material, ({ correctOptionId }) => correctOptionId),
      expectedDraftRevision: 0
    }
    const service = createStudySubmissionService(
      submissionRepository,
      () => new Date(startedAt.getTime() + 1_000)
    )

    await expect(
      service.submit(session.id, randomUUID(), body, foreignOwner)
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    await expect(
      service.getResult(session.id, foreignOwner)
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    expect(await countSessionAnswers(session.id)).toBe(0)
    expect(
      await database.client.studyResult.count({
        where: { studySessionId: session.id }
      })
    ).toBe(0)
    expect(
      await database.client.idempotencyRecord.count({
        where: { studySessionId: session.id, operation: 'STUDY_SUBMIT' }
      })
    ).toBe(0)
    expect(
      await database.client.studySession.findUniqueOrThrow({
        where: { id: session.id },
        select: { status: true }
      })
    ).toEqual({ status: 'IN_PROGRESS' })
  })

  it('injected clock이 이르더라도 submittedAt을 session.startedAt 이상으로 고정한다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const startedAt = new Date()
    const session = await createSession(owner, 1, startedAt)
    const material = await loadAnswerMaterial(session.id)
    const service = createStudySubmissionService(
      submissionRepository,
      () => new Date(startedAt.getTime() - 1)
    )

    const submitted = await service.submit(
      session.id,
      randomUUID(),
      await prepareBody(
        session.id,
        owner,
        createBody(material, ({ correctOptionId }) => correctOptionId),
        startedAt
      ),
      owner
    )
    const stored = await database.client.studySession.findUniqueOrThrow({
      where: { id: session.id },
      select: { submittedAt: true, startedAt: true }
    })

    expect(stored.submittedAt).not.toBeNull()
    expect(stored.submittedAt?.getTime()).toBeGreaterThanOrEqual(
      stored.startedAt.getTime()
    )
    expect(new Date(submitted.response.submittedAt).getTime()).toBe(
      stored.submittedAt?.getTime()
    )
  })

  it('missing/foreign session answer와 foreign version option은 채점 오류로 rollback한다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const startedAt = new Date()
    const session = await createSession(owner, 2, startedAt)
    const foreignSession = await createSession(owner, 1, startedAt)
    const material = await loadAnswerMaterial(session.id)
    const foreignMaterial = await loadAnswerMaterial(foreignSession.id)
    const targetVersionIds = (
      await database.client.studySessionQuestion.findMany({
        where: { studySessionId: session.id },
        select: { questionVersionId: true }
      })
    ).map(({ questionVersionId }) => questionVersionId)
    const foreignOption = await database.client.questionOption.findFirst({
      where: { questionVersionId: { notIn: targetVersionIds } },
      orderBy: { id: 'asc' },
      select: { id: true }
    })
    const foreignAnswer = foreignMaterial[0]
    if (!foreignAnswer || !foreignOption) {
      throw new Error('Foreign session answer/option fixture is required.')
    }
    const validBody = await prepareBody(
      session.id,
      owner,
      createBody(material, ({ correctOptionId }) => correctOptionId),
      startedAt
    )
    const service = createStudySubmissionService(
      submissionRepository,
      () => new Date(startedAt.getTime() + 1_000)
    )

    await expect(
      service.submit(
        session.id,
        randomUUID(),
        { ...validBody, answers: validBody.answers.slice(0, 1) },
        owner
      )
    ).rejects.toMatchObject({ code: 'ANSWER_NOT_IN_SESSION' })
    await expect(
      service.submit(
        session.id,
        randomUUID(),
        {
          ...validBody,
          answers: validBody.answers.map((answer, index) =>
            index === 0
              ? {
                  ...answer,
                  studySessionQuestionId: foreignAnswer.studySessionQuestionId
                }
              : answer
          )
        },
        owner
      )
    ).rejects.toMatchObject({ code: 'ANSWER_NOT_IN_SESSION' })
    await expect(
      service.submit(
        session.id,
        randomUUID(),
        {
          ...validBody,
          answers: validBody.answers.map((answer, index) =>
            index === 0
              ? { ...answer, selectedOptionId: foreignOption.id }
              : answer
          )
        },
        owner
      )
    ).rejects.toMatchObject({ code: 'OPTION_NOT_IN_VERSION' })
    expect(await countSessionAnswers(session.id)).toBe(0)
    expect(
      await database.client.studyResult.count({
        where: { studySessionId: session.id }
      })
    ).toBe(0)
    expect(
      await database.client.idempotencyRecord.count({
        where: { studySessionId: session.id, operation: 'STUDY_SUBMIT' }
      })
    ).toBe(0)
    expect(
      await database.client.studySession.findUniqueOrThrow({
        where: { id: session.id },
        select: { status: true }
      })
    ).toEqual({ status: 'IN_PROGRESS' })
  })

  it(
    isCurrentSourceIntegration
      ? '비인가 Question archive를 DB가 거부하고 pinned version으로 채점·조회한다'
      : 'Question pointer 제거와 archive 뒤에도 pinned version으로 채점·조회한다',
    async () => {
      const userId = await createUser()
      const owner = { kind: 'USER' as const, userId }
      const startedAt = new Date()
      const pinned = await loadPinnedQuestion()
      const session = await createPinnedSession(owner, pinned, startedAt)
      const originalQuestion = await database.client.question.findUniqueOrThrow(
        {
          where: { id: pinned.questionId },
          select: {
            archivedAt: true,
            currentPublishedVersionId: true,
            lifecycleStatus: true,
            rowVersion: true,
            updatedAt: true
          }
        }
      )
      if (isCurrentSourceIntegration) {
        const archiveTime = new Date(startedAt.getTime() + 500)
        await expectRawDatabaseError({
          // The armed-intent trigger is gone (#504 P4); the deferred aggregate
          // invariant still refuses an archive that only clears the pointer.
          expectedMessage:
            'Question pointer/lifecycle aggregate invariant failed.',
          operation: async () =>
            await database.client.$executeRaw`
            UPDATE "Question"
            SET
              "lifecycleStatus" = 'ARCHIVED',
              "archivedAt" = ${archiveTime},
              "currentPublishedVersionId" = NULL,
              "rowVersion" = "rowVersion" + 1,
              "updatedAt" = ${archiveTime}
            WHERE "id" = ${pinned.questionId}::uuid
          `,
          sqlState: '23514'
        })
        await expect(
          database.client.question.findUniqueOrThrow({
            where: { id: pinned.questionId },
            select: {
              archivedAt: true,
              currentPublishedVersionId: true,
              lifecycleStatus: true,
              rowVersion: true,
              updatedAt: true
            }
          })
        ).resolves.toEqual(originalQuestion)
      } else {
        await database.client.question.update({
          where: { id: pinned.questionId },
          data: {
            lifecycleStatus: 'ARCHIVED',
            archivedAt: new Date(startedAt.getTime() + 500),
            currentPublishedVersionId: null
          }
        })
      }

      try {
        const service = createStudySubmissionService(
          submissionRepository,
          () => new Date(startedAt.getTime() + 1_000)
        )
        const body = await prepareBody(
          session.id,
          owner,
          createBody(
            [session.material],
            ({ correctOptionId }) => correctOptionId
          ),
          startedAt
        )
        const submitted = await service.submit(
          session.id,
          randomUUID(),
          body,
          owner
        )

        expect(submitted.response).toMatchObject({
          sessionId: session.id,
          correctCount: 1,
          incorrectCount: 0
        })
        expect(submitted.response.items[0]?.question).toMatchObject({
          id: pinned.questionId,
          questionVersionId: pinned.questionVersionId,
          correctOptionId: pinned.correctOptionId
        })
        await expect(service.getResult(session.id, owner)).resolves.toEqual({
          ...submitted.response,
          stampEarned: undefined
        })
      } finally {
        if (!isCurrentSourceIntegration) {
          await database.client.question.update({
            where: { id: pinned.questionId },
            data: originalQuestion
          })
        }
      }
    }
  )

  it('guest submit은 proof를 7일 연장하고 replay에서 DB timestamp를 다시 쓰지 않는다', async () => {
    const resolved = await guestPrincipalService.create()
    const rawCookie = resolved.cookieValue
    if (!rawCookie) {
      throw new Error('Guest cookie fixture is required.')
    }
    createdGuestIds.add(resolved.id)
    const inspected = guestPrincipalService.inspectCookie(rawCookie)
    if (inspected.kind !== 'VERIFIED') {
      throw new Error('Verified guest credential is required.')
    }
    const owner = {
      kind: 'GUEST' as const,
      guestPrincipalId: inspected.id,
      tokenDigest: inspected.tokenDigest
    }
    const startedAt = new Date()
    const session = await createSession(owner, 1, startedAt)
    const material = await loadAnswerMaterial(session.id)
    const observedAt = new Date(startedAt.getTime() + 2_000)
    const service = createStudySubmissionService(
      submissionRepository,
      () => new Date(observedAt)
    )
    const body = await prepareBody(
      session.id,
      owner,
      createBody(material, () => null),
      startedAt
    )
    const idempotencyKey = randomUUID()

    const first = await service.submit(session.id, idempotencyKey, body, owner)
    const afterFirst = await database.client.guestPrincipal.findUniqueOrThrow({
      where: { id: owner.guestPrincipalId },
      select: { lastSeenAt: true, expiresAt: true }
    })

    expect(first.replayed).toBe(false)
    expect(first.response.items[0]?.wrongNoteStatus).toBeNull()
    expect(afterFirst.lastSeenAt).toEqual(observedAt)
    expect(
      afterFirst.expiresAt.getTime() - afterFirst.lastSeenAt.getTime()
    ).toBe(7 * DAY_MS)
    expect(
      await database.client.reviewEvent.count({
        where: { studySessionId: session.id }
      })
    ).toBe(0)

    const replay = await service.submit(session.id, idempotencyKey, body, owner)
    const afterReplay = await database.client.guestPrincipal.findUniqueOrThrow({
      where: { id: owner.guestPrincipalId },
      select: { lastSeenAt: true, expiresAt: true }
    })

    expect(replay.replayed).toBe(true)
    expect(replay.guestProofExpiresAt).toEqual(afterFirst.expiresAt)
    expect(afterReplay).toEqual(afterFirst)
  })

  it('guest finalize 실패는 proof renewal과 submission aggregate를 모두 rollback한다', async () => {
    const resolved = await guestPrincipalService.create()
    const rawCookie = resolved.cookieValue
    if (!rawCookie) {
      throw new Error('Guest cookie fixture is required.')
    }
    createdGuestIds.add(resolved.id)
    const inspected = guestPrincipalService.inspectCookie(rawCookie)
    if (inspected.kind !== 'VERIFIED') {
      throw new Error('Verified guest credential is required.')
    }
    const owner = {
      kind: 'GUEST' as const,
      guestPrincipalId: inspected.id,
      tokenDigest: inspected.tokenDigest
    }
    const startedAt = new Date()
    const session = await createSession(owner, 1, startedAt)
    const material = await loadAnswerMaterial(session.id)
    const beforeProof = await database.client.guestPrincipal.findUniqueOrThrow({
      where: { id: owner.guestPrincipalId },
      select: { lastSeenAt: true, expiresAt: true }
    })
    const observedAt = new Date(startedAt.getTime() + 3_000)
    const failure = new Error('forced guest finalize failure')
    const repository = createPrismaStudySubmissionRepository(database.client, {
      beforeFinalize: async () => Promise.reject(failure)
    })
    const service = createStudySubmissionService(
      repository,
      () => new Date(observedAt)
    )

    await expect(
      service.submit(
        session.id,
        randomUUID(),
        await prepareBody(
          session.id,
          owner,
          createBody(material, () => null),
          startedAt
        ),
        owner
      )
    ).rejects.toBe(failure)
    await expect(
      database.client.guestPrincipal.findUniqueOrThrow({
        where: { id: owner.guestPrincipalId },
        select: { lastSeenAt: true, expiresAt: true }
      })
    ).resolves.toEqual(beforeProof)
    expect(await countSessionAnswers(session.id)).toBe(0)
    expect(
      await database.client.studyResult.count({
        where: { studySessionId: session.id }
      })
    ).toBe(0)
    expect(
      await database.client.idempotencyRecord.count({
        where: { studySessionId: session.id, operation: 'STUDY_SUBMIT' }
      })
    ).toBe(0)
    expect(
      await database.client.studySession.findUniqueOrThrow({
        where: { id: session.id },
        select: { status: true }
      })
    ).toEqual({ status: 'IN_PROGRESS' })
  })

  it('finalize 직전 실패는 reservation과 모든 aggregate write를 rollback하고 같은 key 재시도를 허용한다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const startedAt = new Date()
    const session = await createSession(owner, 1, startedAt)
    const material = await loadAnswerMaterial(session.id)
    const body = await prepareBody(
      session.id,
      owner,
      createBody(material, () => null),
      startedAt
    )
    const idempotencyKey = randomUUID()
    const observedAt = new Date(startedAt.getTime() + 3_000)
    const failure = new Error('forced before finalize')
    const failingRepository = createPrismaStudySubmissionRepository(
      database.client,
      { beforeFinalize: async () => Promise.reject(failure) }
    )
    const failingService = createStudySubmissionService(
      failingRepository,
      () => new Date(observedAt)
    )

    await expect(
      failingService.submit(session.id, idempotencyKey, body, owner)
    ).rejects.toBe(failure)
    expect(await countSessionAnswers(session.id)).toBe(0)
    expect(
      await database.client.studyResult.count({
        where: { studySessionId: session.id }
      })
    ).toBe(0)
    expect(
      await database.client.idempotencyRecord.count({
        where: { studySessionId: session.id, operation: 'STUDY_SUBMIT' }
      })
    ).toBe(0)
    expect(
      await database.client.studySession.findUniqueOrThrow({
        where: { id: session.id },
        select: { status: true }
      })
    ).toEqual({ status: 'IN_PROGRESS' })

    const recovered = await createStudySubmissionService(
      submissionRepository,
      () => new Date(observedAt)
    ).submit(session.id, idempotencyKey, body, owner)
    expect(recovered.replayed).toBe(false)
    expect(await countSessionAnswers(session.id)).toBe(1)
  })

  it('same-key winner rollback 뒤 waiter가 fresh 최초 제출로 성공한다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const startedAt = new Date()
    const session = await createSession(owner, 1, startedAt)
    const material = await loadAnswerMaterial(session.id)
    const body = await prepareBody(
      session.id,
      owner,
      createBody(material, ({ correctOptionId }) => correctOptionId),
      startedAt
    )
    const observedAt = new Date(startedAt.getTime() + 4_000)
    const failure = new Error('forced same-key winner rollback')
    let releaseWinner = (): void => undefined
    let signalWinnerReserved = (): void => undefined
    let signalLoserMiss = (): void => undefined
    const winnerMayProceed = new Promise<void>((resolve) => {
      releaseWinner = resolve
    })
    const winnerReserved = new Promise<void>((resolve) => {
      signalWinnerReserved = resolve
    })
    const loserMissedExisting = new Promise<void>((resolve) => {
      signalLoserMiss = resolve
    })
    const winnerRepository = createPrismaStudySubmissionRepository(
      database.client,
      {
        afterReservation: async () => {
          signalWinnerReserved()
          await winnerMayProceed
        },
        beforeFinalize: async () => Promise.reject(failure)
      }
    )
    const loserRepository = createPrismaStudySubmissionRepository(
      database.client,
      { afterExistingMiss: async () => signalLoserMiss() }
    )
    const winnerService = createStudySubmissionService(
      winnerRepository,
      () => new Date(observedAt)
    )
    const loserService = createStudySubmissionService(
      loserRepository,
      () => new Date(observedAt)
    )
    const idempotencyKey = randomUUID()

    const winner = winnerService.submit(session.id, idempotencyKey, body, owner)
    await winnerReserved
    const waiter = loserService.submit(session.id, idempotencyKey, body, owner)
    await loserMissedExisting
    releaseWinner()

    await expect(winner).rejects.toBe(failure)
    await expect(waiter).resolves.toMatchObject({ replayed: false })
    expect(await countSessionAnswers(session.id)).toBe(1)
    expect(
      await database.client.studyResult.count({
        where: { studySessionId: session.id }
      })
    ).toBe(1)
    expect(
      await database.client.idempotencyRecord.count({
        where: { studySessionId: session.id, operation: 'STUDY_SUBMIT' }
      })
    ).toBe(1)
  })

  it('저장본과 달라도 보낸 답 그대로 채점하고 draft를 지운다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const startedAt = new Date()
    const session = await createSession(owner, 2, startedAt)
    const material = await loadAnswerMaterial(session.id)
    // The saved draft has every answer correct (revision 1).
    await prepareBody(
      session.id,
      owner,
      createBody(material, ({ correctOptionId }) => correctOptionId),
      startedAt
    )
    // The submit leaves every answer empty and names a stale revision.
    const sent = {
      ...createBody(material, () => null),
      expectedDraftRevision: 0
    }
    const submitted = await createStudySubmissionService(
      submissionRepository,
      () => new Date(startedAt.getTime() + 2_000)
    ).submit(session.id, randomUUID(), sent, owner)

    expect(submitted.replayed).toBe(false)
    expect(
      submitted.response.items.map(({ selectedOptionId, isCorrect }) => ({
        selectedOptionId,
        isCorrect
      }))
    ).toEqual(
      material.map(() => ({ selectedOptionId: null, isCorrect: false }))
    )
    expect(
      await database.client.studyDraft.count({
        where: { studySessionId: session.id }
      })
    ).toBe(0)
  })

  it('두 탭의 동시 different-key 제출은 먼저 온 답 그대로 채점하고 나중 것은 SESSION_ALREADY_SUBMITTED다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const startedAt = new Date()
    const session = await createSession(owner, 1, startedAt)
    const material = await loadAnswerMaterial(session.id)
    const body = await prepareBody(
      session.id,
      owner,
      createBody(material, ({ correctOptionId }) => correctOptionId),
      startedAt
    )
    const observedAt = new Date(startedAt.getTime() + 4_000)
    let releaseReservations = (): void => undefined
    let signalBothReserved = (): void => undefined
    const mayLockSession = new Promise<void>((resolve) => {
      releaseReservations = resolve
    })
    const bothReserved = new Promise<void>((resolve) => {
      signalBothReserved = resolve
    })
    let reservationCount = 0
    const repository = createPrismaStudySubmissionRepository(database.client, {
      afterReservation: async () => {
        reservationCount += 1
        if (reservationCount === 2) {
          signalBothReserved()
        }
        await mayLockSession
      }
    })
    const service = createStudySubmissionService(
      repository,
      () => new Date(observedAt)
    )

    // The second tab sends other answers against a stale draft revision.
    const tabs = [
      body,
      { ...createBody(material, () => null), expectedDraftRevision: 0 }
    ]
    const submissions = tabs.map((tab) =>
      service.submit(session.id, randomUUID(), tab, owner)
    )
    await bothReserved
    releaseReservations()
    const outcomes = await Promise.allSettled(submissions)
    const fulfilled = outcomes.filter(
      (
        outcome
      ): outcome is PromiseFulfilledResult<
        Awaited<(typeof submissions)[number]>
      > => outcome.status === 'fulfilled'
    )
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === 'rejected'
    )

    expect(fulfilled).toHaveLength(1)
    expect(fulfilled[0]?.value.replayed).toBe(false)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toMatchObject({
      code: 'SESSION_ALREADY_SUBMITTED'
    })
    expect(await countSessionAnswers(session.id)).toBe(1)
    const winner =
      tabs[outcomes.findIndex(({ status }) => status === 'fulfilled')]
    expect(
      (
        await database.client.studyAnswer.findMany({
          where: { studySessionQuestion: { studySessionId: session.id } },
          select: { selectedOptionId: true }
        })
      ).map(({ selectedOptionId }) => selectedOptionId)
    ).toEqual(winner?.answers.map(({ selectedOptionId }) => selectedOptionId))
    expect(
      await database.client.studyResult.count({
        where: { studySessionId: session.id }
      })
    ).toBe(1)
    expect(
      await database.client.idempotencyRecord.count({
        where: { studySessionId: session.id, operation: 'STUDY_SUBMIT' }
      })
    ).toBe(1)
  })

  it('동일 USER/question의 동시 오답은 WrongNote 하나와 ordered event 두 개로 수렴한다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const pinned = await loadPinnedQuestion()
    const startedAt = new Date()
    const [firstSession, secondSession] = await Promise.all([
      createPinnedSession(owner, pinned, startedAt),
      createPinnedSession(owner, pinned, startedAt)
    ])
    const observedAt = new Date(startedAt.getTime() + 5_000)
    let releaseReservations = (): void => undefined
    let signalBothReserved = (): void => undefined
    const mayLockWrongNote = new Promise<void>((resolve) => {
      releaseReservations = resolve
    })
    const bothReserved = new Promise<void>((resolve) => {
      signalBothReserved = resolve
    })
    let reservationCount = 0
    const repository = createPrismaStudySubmissionRepository(database.client, {
      afterReservation: async () => {
        reservationCount += 1
        if (reservationCount === 2) {
          signalBothReserved()
        }
        await mayLockWrongNote
      }
    })
    const service = createStudySubmissionService(
      repository,
      () => new Date(observedAt)
    )

    const submissions = [firstSession, secondSession].map((session) =>
      service.submit(
        session.id,
        randomUUID(),
        {
          answers: [
            {
              studySessionQuestionId: session.material.studySessionQuestionId,
              selectedOptionId: null,
              elapsedSec: 0
            }
          ],
          durationSec: 10,
          expectedDraftRevision: 0
        },
        owner
      )
    )
    await bothReserved
    releaseReservations()
    await expect(Promise.all(submissions)).resolves.toHaveLength(2)

    const wrongNote = await database.client.wrongNote.findUniqueOrThrow({
      where: {
        userId_questionId: { userId, questionId: pinned.questionId }
      },
      select: { wrongCount: true, correctStreak: true, status: true }
    })
    expect(wrongNote).toEqual({
      wrongCount: 2,
      correctStreak: 0,
      status: 'AGAIN'
    })
    const events = await database.client.reviewEvent.findMany({
      where: {
        userId,
        questionId: pinned.questionId,
        studySessionId: { in: [firstSession.id, secondSession.id] }
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: {
        previousStatus: true,
        nextStatus: true,
        previousWrongCount: true,
        wrongCountAfter: true,
        occurredAt: true
      }
    })
    expect(
      events.map(
        ({
          previousStatus,
          nextStatus,
          previousWrongCount,
          wrongCountAfter
        }) => ({
          previousStatus,
          nextStatus,
          previousWrongCount,
          wrongCountAfter
        })
      )
    ).toEqual([
      {
        previousStatus: null,
        nextStatus: 'NEW',
        previousWrongCount: null,
        wrongCountAfter: 1
      },
      {
        previousStatus: 'NEW',
        nextStatus: 'AGAIN',
        previousWrongCount: 1,
        wrongCountAfter: 2
      }
    ])
    expect(events[0]?.occurredAt.getTime()).toBeLessThan(
      events[1]?.occurredAt.getTime() ?? Number.NEGATIVE_INFINITY
    )
    expect(
      await database.client.studyResult.count({
        where: { studySessionId: { in: [firstSession.id, secondSession.id] } }
      })
    ).toBe(2)
    expect(
      await database.client.idempotencyRecord.count({
        where: {
          studySessionId: { in: [firstSession.id, secondSession.id] },
          operation: 'STUDY_SUBMIT'
        }
      })
    ).toBe(2)
  })

  it('reservation barrier의 동시 same-key USER submit은 side effect 하나와 replay 하나로 수렴한다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const startedAt = new Date()
    const session = await createSession(owner, 1, startedAt)
    const material = await loadAnswerMaterial(session.id)
    const body = await prepareBody(
      session.id,
      owner,
      createBody(material, ({ correctOptionId }) => correctOptionId),
      startedAt
    )
    const observedAt = new Date(startedAt.getTime() + 4_000)
    let releaseWinner = (): void => undefined
    let signalReservation = (): void => undefined
    let signalLoserMiss = (): void => undefined
    const winnerCanCommit = new Promise<void>((resolve) => {
      releaseWinner = resolve
    })
    const reservationHeld = new Promise<void>((resolve) => {
      signalReservation = resolve
    })
    const loserMissedExisting = new Promise<void>((resolve) => {
      signalLoserMiss = resolve
    })
    let winnerReservationCount = 0
    const winnerRepository = createPrismaStudySubmissionRepository(
      database.client,
      {
        afterReservation: async () => {
          winnerReservationCount += 1
          if (winnerReservationCount === 1) {
            signalReservation()
            await winnerCanCommit
          }
        }
      }
    )
    const loserRepository = createPrismaStudySubmissionRepository(
      database.client,
      { afterExistingMiss: async () => signalLoserMiss() }
    )
    const winnerService = createStudySubmissionService(
      winnerRepository,
      () => new Date(observedAt)
    )
    const loserService = createStudySubmissionService(
      loserRepository,
      () => new Date(observedAt)
    )
    const idempotencyKey = randomUUID()

    const winner = winnerService.submit(session.id, idempotencyKey, body, owner)
    await reservationHeld
    const loser = loserService.submit(session.id, idempotencyKey, body, owner)
    await loserMissedExisting
    releaseWinner()

    const outcomes = await Promise.all([winner, loser])

    expect(outcomes.map(({ replayed }) => replayed).toSorted()).toEqual([
      false,
      true
    ])
    expect(winnerReservationCount).toBe(1)
    expect(await countSessionAnswers(session.id)).toBe(1)
    expect(
      await database.client.studyResult.count({
        where: { studySessionId: session.id }
      })
    ).toBe(1)
    expect(
      await database.client.idempotencyRecord.count({
        where: { studySessionId: session.id, operation: 'STUDY_SUBMIT' }
      })
    ).toBe(1)
  })
})
