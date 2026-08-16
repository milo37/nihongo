import { randomUUID } from 'node:crypto'
import { studyResultSchema } from '@nihongo/contracts/study/study-result'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import {
  createPrismaStudySessionRepository,
  type ExistingStudyOwner,
  type StudySessionRecord
} from './studySessionRepository.js'
import { createPrismaStudySubmissionRepository } from './studySubmissionRepository.js'
import { createStudySubmissionService } from './studySubmissionService.js'

const DAY_MS = 24 * 60 * 60 * 1_000

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createDatabaseRuntime(environment.DATABASE_URL)
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

const createUser = async (): Promise<string> => {
  const user = await database.client.user.create({
    data: {
      name: 'Slice 4 submission user',
      email: `slice4-submit-${randomUUID()}@example.test`,
      emailVerified: true
    },
    select: { id: true }
  })
  createdUserIds.add(user.id)
  return user.id
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

const countSessionAnswers = async (sessionId: string): Promise<number> =>
  await database.client.studyAnswer.count({
    where: { studySessionQuestion: { studySessionId: sessionId } }
  })

beforeAll(async () => {
  await database.checkReadiness()
})

afterAll(async () => {
  if (createdUserIds.size > 0) {
    await database.client.user.deleteMany({
      where: { id: { in: [...createdUserIds] } }
    })
  }
  if (createdGuestIds.size > 0) {
    await database.client.guestPrincipal.deleteMany({
      where: { id: { in: [...createdGuestIds] } }
    })
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
    const body = createBody(material, (item, index) =>
      index === 0 ? item.correctOptionId : null
    )
    const idempotencyKey = randomUUID()

    const first = await service.submit(session.id, idempotencyKey, body, owner)
    const response = studyResultSchema.parse(first.response)

    expect(first.replayed).toBe(false)
    expect(response).toMatchObject({
      sessionId: session.id,
      totalCount: 2,
      correctCount: 1,
      incorrectCount: 1,
      correctRate: 50,
      durationSec: 20
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
    await expect(service.getResult(session.id, owner)).resolves.toEqual(
      first.response
    )

    const secondSession = await createSession(owner, 5, startedAt)
    const secondMaterial = await loadAnswerMaterial(secondSession.id)
    const secondBody = createBody(
      secondMaterial,
      ({ correctOptionId }) => correctOptionId
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
    await expect(service.getResult(session.id, owner)).resolves.toEqual(
      first.response
    )
  })

  it('foreign USER submit/result는 존재를 숨기고 submission write를 만들지 않는다', async () => {
    const ownerUserId = await createUser()
    const foreignUserId = await createUser()
    const owner = { kind: 'USER' as const, userId: ownerUserId }
    const foreignOwner = { kind: 'USER' as const, userId: foreignUserId }
    const startedAt = new Date()
    const session = await createSession(owner, 1, startedAt)
    const material = await loadAnswerMaterial(session.id)
    const body = createBody(material, ({ correctOptionId }) => correctOptionId)
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
        where: { studySessionId: session.id }
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
      createBody(material, ({ correctOptionId }) => correctOptionId),
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

  it('missing/foreign session answer와 foreign version option은 stable 422 code로 rollback한다', async () => {
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
    const validBody = createBody(
      material,
      ({ correctOptionId }) => correctOptionId
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
        where: { studySessionId: session.id }
      })
    ).toBe(0)
    expect(
      await database.client.studySession.findUniqueOrThrow({
        where: { id: session.id },
        select: { status: true }
      })
    ).toEqual({ status: 'IN_PROGRESS' })
  })

  it('Question pointer 제거와 archive 뒤에도 pinned version으로 채점·조회한다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const startedAt = new Date()
    const pinned = await loadPinnedQuestion()
    const session = await createPinnedSession(owner, pinned, startedAt)
    const originalQuestion = await database.client.question.findUniqueOrThrow({
      where: { id: pinned.questionId },
      select: {
        lifecycleStatus: true,
        archivedAt: true,
        currentPublishedVersionId: true
      }
    })
    await database.client.question.update({
      where: { id: pinned.questionId },
      data: {
        lifecycleStatus: 'ARCHIVED',
        archivedAt: new Date(startedAt.getTime() + 500),
        currentPublishedVersionId: null
      }
    })

    try {
      const service = createStudySubmissionService(
        submissionRepository,
        () => new Date(startedAt.getTime() + 1_000)
      )
      const body = createBody(
        [session.material],
        ({ correctOptionId }) => correctOptionId
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
      await expect(service.getResult(session.id, owner)).resolves.toEqual(
        submitted.response
      )
    } finally {
      await database.client.question.update({
        where: { id: pinned.questionId },
        data: originalQuestion
      })
    }
  })

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
    const body = createBody(material, () => null)
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
        createBody(material, () => null),
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
        where: { studySessionId: session.id }
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
    const body = createBody(material, () => null)
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
        where: { studySessionId: session.id }
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
    const body = createBody(material, ({ correctOptionId }) => correctOptionId)
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
        where: { studySessionId: session.id }
      })
    ).toBe(1)
  })

  it('동시 different-key 제출은 결과 하나와 SESSION_ALREADY_SUBMITTED 하나로 수렴한다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const startedAt = new Date()
    const session = await createSession(owner, 1, startedAt)
    const material = await loadAnswerMaterial(session.id)
    const body = createBody(material, ({ correctOptionId }) => correctOptionId)
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

    const submissions = [
      service.submit(session.id, randomUUID(), body, owner),
      service.submit(session.id, randomUUID(), body, owner)
    ]
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
    expect(
      await database.client.studyResult.count({
        where: { studySessionId: session.id }
      })
    ).toBe(1)
    expect(
      await database.client.idempotencyRecord.count({
        where: { studySessionId: session.id }
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
        createBody([session.material], () => null),
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
        where: { studySessionId: { in: [firstSession.id, secondSession.id] } }
      })
    ).toBe(2)
  })

  it('reservation barrier의 동시 same-key USER submit은 side effect 하나와 replay 하나로 수렴한다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const startedAt = new Date()
    const session = await createSession(owner, 1, startedAt)
    const material = await loadAnswerMaterial(session.id)
    const body = createBody(material, ({ correctOptionId }) => correctOptionId)
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
        where: { studySessionId: session.id }
      })
    ).toBe(1)
  })
})
