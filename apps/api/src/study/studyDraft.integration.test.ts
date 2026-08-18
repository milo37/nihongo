import { randomUUID } from 'node:crypto'
import { apiFailureSchema } from '@nihongo/contracts/common/error'
import { createStudySessionV2ResponseSchema } from '@nihongo/contracts/study/create-study-session'
import { getStudyDraftAnswersResponseSchema } from '@nihongo/contracts/study/get-study-draft-answers'
import { listResumableStudySessionsResponseSchema } from '@nihongo/contracts/study/list-resumable-study-sessions'
import { saveStudyDraftAnswersResponseSchema } from '@nihongo/contracts/study/save-study-draft-answers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiApp } from '../app/createApp.js'
import { createAuthGateway } from '../auth/authGateway.js'
import { createAuthRuntime } from '../auth/createAuth.js'
import { createAuthEmailDispatcher } from '../auth/emailDispatcher.js'
import { InMemoryAuthEmailPort } from '../auth/emailPort.js'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import { createPrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createJsonLogger } from '../observability/logger.js'
import { createPrismaQuestionRepository } from '../question/questionRepository.js'
import { createQuestionService } from '../question/questionService.js'
import { GUEST_COOKIE_NAME } from '../routes/principal.js'
import { Prisma } from '../generated/prisma/client.js'
import {
  createPrismaStudyDraftRepository,
  DraftVersionConflictError,
  StudyDraftNotEditableError
} from './studyDraftRepository.js'
import { createStudyDraftService } from './studyDraftService.js'
import { createPrismaStudySessionRepository } from './studySessionRepository.js'
import { createStudySessionService } from './studySessionService.js'
import {
  createPrismaStudySubmissionRepository,
  IdempotencyKeyReusedError
} from './studySubmissionRepository.js'
import { createStudySubmissionService } from './studySubmissionService.js'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createDatabaseRuntime(environment.DATABASE_URL)
const emailDispatcher = createAuthEmailDispatcher({
  emailPort: new InMemoryAuthEmailPort()
})
const auth = createAuthRuntime({
  client: database.client,
  emailDispatcher,
  environment
})
const guestPrincipalService = createGuestPrincipalService({
  client: database.client,
  secret: environment.GUEST_COOKIE_SECRET
})
const principalService = createPrincipalService({
  authApi: auth.api,
  client: database.client
})
const noOpRateLimiter: ApplicationRateLimiter = {
  consume: async () => undefined
}
const studyDraftRepository = createPrismaStudyDraftRepository(database.client)
const studySessionRepository = createPrismaStudySessionRepository(
  database.client
)
const studySubmissionRepository = createPrismaStudySubmissionRepository(
  database.client
)
const app = createApiApp({
  auth: {
    environment,
    gateway: createAuthGateway({ auth, client: database.client, environment }),
    guestPrincipalService,
    principalService
  },
  checkReadiness: database.checkReadiness,
  logger: createJsonLogger('silent'),
  questionReader: createQuestionService(
    createPrismaQuestionRepository(database.client)
  ),
  study: {
    draftService: createStudyDraftService(studyDraftRepository),
    practiceContractV2Enabled: true,
    rateLimiter: noOpRateLimiter,
    service: createStudySessionService(studySessionRepository),
    submissionService: createStudySubmissionService(studySubmissionRepository)
  }
})

const origin = environment.TRUSTED_ORIGINS[0]
if (!origin) {
  throw new Error('StudyDraft integration에는 trusted origin이 필요합니다.')
}

const createdGuestIds = new Set<string>()
const createdUserIds = new Set<string>()

const cookieHeader = (response: Response): string => {
  const values =
    response.headers.getSetCookie?.() ??
    [response.headers.get('Set-Cookie')].filter(
      (cookie): cookie is string => cookie !== null
    )
  return (
    values
      .map((cookie) => cookie.split(';', 1)[0] ?? '')
      .find((cookie) => cookie.startsWith(`${GUEST_COOKIE_NAME}=`)) ?? ''
  )
}

const rememberGuest = async (sessionId: string): Promise<void> => {
  const session = await database.client.studySession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { guestPrincipalId: true }
  })
  if (session.guestPrincipalId) {
    createdGuestIds.add(session.guestPrincipalId)
  }
}

const createV2Session = async (): Promise<{
  cookie: string
  payload: ReturnType<typeof createStudySessionV2ResponseSchema.parse>
}> => {
  const response = await app.request('/api/v1/study-sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      'X-Nihongo-Practice-Contract': '2'
    },
    body: JSON.stringify({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 2
    })
  })
  expect(response.status).toBe(201)
  expect(response.headers.get('X-Nihongo-Practice-Contract')).toBe('2')
  const payload = createStudySessionV2ResponseSchema.parse(
    await response.json()
  )
  await rememberGuest(payload.session.id)
  return { cookie: cookieHeader(response), payload }
}

const draftRequest = async (
  sessionId: string,
  cookie: string,
  init?: RequestInit
): Promise<Response> =>
  await app.request(`/api/v1/study-sessions/${sessionId}/draft-answers`, {
    ...init,
    headers: {
      Cookie: cookie,
      'X-Nihongo-Practice-Contract': '2',
      ...init?.headers
    }
  })

const createUser = async (): Promise<string> => {
  const user = await database.client.user.create({
    data: {
      name: 'Slice 1 draft user',
      email: `slice1-draft-${randomUUID()}@example.test`,
      emailVerified: true
    },
    select: { id: true }
  })
  createdUserIds.add(user.id)
  return user.id
}

const createOwnedV2Session = async (
  userId: string,
  {
    expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000),
    startedAt = new Date()
  }: { expiresAt?: Date; startedAt?: Date } = {}
) =>
  (
    await studySessionRepository.createRandom({
      owner: { kind: 'USER', userId },
      level: 'N5',
      subject: 'VOCABULARY',
      requestedCount: 2,
      startedAt,
      expiresAt,
      practiceContractVersion: 2
    })
  ).session

const createOwnedV1Session = async (
  userId: string,
  {
    expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000),
    startedAt = new Date()
  }: { expiresAt?: Date; startedAt?: Date } = {}
) =>
  (
    await studySessionRepository.createRandom({
      owner: { kind: 'USER', userId },
      level: 'N5',
      subject: 'VOCABULARY',
      requestedCount: 2,
      startedAt,
      expiresAt,
      practiceContractVersion: 1
    })
  ).session

const toEmptyDraftBody = (
  session: Awaited<ReturnType<typeof createOwnedV2Session>>,
  expectedRevision = 0
) => ({
  expectedRevision,
  currentOrdinal: 1,
  answers: session.questions.map(({ sessionQuestionId }) => ({
    studySessionQuestionId: sessionQuestionId,
    selectedOptionId: null,
    elapsedSec: 0
  }))
})

const createBarrier = () => {
  let announceEntered: (() => void) | undefined
  let releaseWaiter: (() => void) | undefined
  const entered = new Promise<void>((resolve) => {
    announceEntered = resolve
  })
  const released = new Promise<void>((resolve) => {
    releaseWaiter = resolve
  })
  return {
    entered,
    hook: async () => {
      announceEntered?.()
      await released
    },
    release: () => releaseWaiter?.()
  }
}

beforeAll(async () => {
  await database.checkReadiness()
})

afterAll(async () => {
  if (createdGuestIds.size > 0) {
    await database.client.guestPrincipal.deleteMany({
      where: { id: { in: [...createdGuestIds] } }
    })
  }
  if (createdUserIds.size > 0) {
    await database.client.user.deleteMany({
      where: { id: { in: [...createdUserIds] } }
    })
  }
  await database.client.rateLimit.deleteMany()
  await database.disconnect()
})

describe('Phase 4 StudyDraft PostgreSQL integration', () => {
  it('v1/v2 resumable을 stable pagination하고 v1은 LEGACY_LOCAL_ONLY로 투영한다', async () => {
    const userId = await createUser()
    const now = new Date()
    const olderV2 = await createOwnedV2Session(userId, {
      startedAt: new Date(now.getTime() - 2_000)
    })
    const newerV1 = await createOwnedV1Session(userId, {
      startedAt: new Date(now.getTime() - 1_000)
    })
    const owner = { kind: 'USER' as const, userId }

    const firstPage = await studyDraftRepository.listOwnedResumable(
      owner,
      { page: 1, pageSize: 1, status: 'IN_PROGRESS' },
      now
    )
    const secondPage = await studyDraftRepository.listOwnedResumable(
      owner,
      { page: 2, pageSize: 1, status: 'IN_PROGRESS' },
      now
    )
    const beyondLastPage = await studyDraftRepository.listOwnedResumable(
      owner,
      { page: 3, pageSize: 1, status: 'IN_PROGRESS' },
      now
    )

    expect(firstPage).toMatchObject({
      total: 2,
      items: [
        {
          id: newerV1.id,
          practiceContractVersion: 1,
          draftRevision: null,
          draftSavedAt: null,
          currentOrdinal: null,
          resumeAvailability: 'LEGACY_LOCAL_ONLY'
        }
      ]
    })
    expect(secondPage).toMatchObject({
      total: 2,
      items: [
        {
          id: olderV2.id,
          practiceContractVersion: 2,
          draftRevision: 0,
          draftSavedAt: null,
          currentOrdinal: 1,
          resumeAvailability: 'SERVER'
        }
      ]
    })
    expect(beyondLastPage).toEqual({
      items: [],
      page: 3,
      pageSize: 1,
      total: 2
    })
  })

  it('v2 create가 revision 0 full draft를 원자 생성하고 resumable에 노출한다', async () => {
    const { cookie, payload } = await createV2Session()
    const response = await draftRequest(payload.session.id, cookie)

    expect(response.status).toBe(200)
    const draft = getStudyDraftAnswersResponseSchema.parse(
      await response.json()
    )
    expect(draft).toMatchObject({
      studySessionId: payload.session.id,
      revision: 0,
      currentOrdinal: 1,
      savedAt: null
    })
    expect(draft.answers).toEqual(
      payload.questions.map(({ sessionQuestionId }) => ({
        studySessionQuestionId: sessionQuestionId,
        selectedOptionId: null,
        elapsedSec: 0
      }))
    )

    const listResponse = await app.request(
      '/api/v1/study-sessions?status=IN_PROGRESS&page=1&pageSize=20',
      {
        headers: {
          Cookie: cookie,
          'X-Nihongo-Practice-Contract': '2'
        }
      }
    )
    expect(listResponse.status).toBe(200)
    const page = listResumableStudySessionsResponseSchema.parse(
      await listResponse.json()
    )
    expect(page.items).toContainEqual(
      expect.objectContaining({
        id: payload.session.id,
        practiceContractVersion: 2,
        draftRevision: 0,
        resumeAvailability: 'SERVER'
      })
    )
  })

  it('response-loss replay와 historical replay가 revision을 중복 증가시키지 않는다', async () => {
    const { cookie, payload } = await createV2Session()
    const [firstQuestion, secondQuestion] = payload.questions
    if (!firstQuestion || !secondQuestion) {
      throw new Error('두 문제 fixture가 필요합니다.')
    }
    const keyA = randomUUID()
    const bodyA = {
      expectedRevision: 0,
      currentOrdinal: 2,
      answers: [
        {
          studySessionQuestionId: firstQuestion.sessionQuestionId,
          selectedOptionId: firstQuestion.question.options[0]?.id ?? null,
          elapsedSec: 8
        },
        {
          studySessionQuestionId: secondQuestion.sessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 4
        }
      ]
    }
    const save = (key: string, body: object) =>
      draftRequest(payload.session.id, cookie, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          'Idempotency-Key': key
        },
        body: JSON.stringify(body)
      })

    const first = await save(keyA, bodyA)
    expect(first.status).toBe(200)
    const revisionOne = saveStudyDraftAnswersResponseSchema.parse(
      await first.json()
    )
    expect(revisionOne.revision).toBe(1)
    expect(first.headers.get('Idempotency-Replayed')).toBeNull()

    const replay = await save(keyA, bodyA)
    expect(replay.status).toBe(200)
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await replay.json()).toEqual(revisionOne)

    const keyB = randomUUID()
    const bodyB = {
      ...bodyA,
      expectedRevision: 1,
      answers: bodyA.answers.map((answer, index) =>
        index === 1 ? { ...answer, elapsedSec: 9 } : answer
      )
    }
    const second = await save(keyB, bodyB)
    expect(second.status).toBe(200)
    const revisionTwo = saveStudyDraftAnswersResponseSchema.parse(
      await second.json()
    )
    expect(revisionTwo.revision).toBe(2)

    const historical = await save(keyA, bodyA)
    expect(historical.status).toBe(200)
    expect(historical.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await historical.json()).toEqual(revisionOne)

    const canonical = await draftRequest(payload.session.id, cookie)
    expect(canonical.status).toBe(200)
    expect(await canonical.json()).toEqual(revisionTwo)

    const stale = await save(randomUUID(), bodyB)
    expect(stale.status).toBe(409)
    expect(apiFailureSchema.parse(await stale.json()).code).toBe(
      'DRAFT_VERSION_CONFLICT'
    )

    const changedReuse = await save(keyA, {
      ...bodyA,
      currentOrdinal: 1
    })
    expect(changedReuse.status).toBe(409)
    expect(apiFailureSchema.parse(await changedReuse.json()).code).toBe(
      'IDEMPOTENCY_KEY_REUSED'
    )

    const records = await database.client.idempotencyRecord.findMany({
      where: {
        studySessionId: payload.session.id,
        operation: 'STUDY_DRAFT_SAVE'
      },
      orderBy: { createdAt: 'asc' }
    })
    expect(records).toHaveLength(2)
    expect(records.map(({ state }) => state)).toEqual([
      'SUCCEEDED',
      'SUCCEEDED'
    ])
  })

  it('v2 submit과 repeated cancellation이 terminal draft를 제거한다', async () => {
    const submissionSession = await createV2Session()
    const body = {
      expectedRevision: 0,
      currentOrdinal: 1,
      answers: submissionSession.payload.questions.map(
        ({ sessionQuestionId }) => ({
          studySessionQuestionId: sessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 3
        })
      )
    }
    const draftKey = randomUUID()
    const save = await draftRequest(
      submissionSession.payload.session.id,
      submissionSession.cookie,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          'Idempotency-Key': draftKey
        },
        body: JSON.stringify(body)
      }
    )
    expect(save.status).toBe(200)
    const saved = saveStudyDraftAnswersResponseSchema.parse(await save.json())

    const submissionKey = randomUUID()
    const submissionBody = {
      answers: saved.answers,
      durationSec: saved.answers.reduce(
        (sum, answer) => sum + answer.elapsedSec,
        0
      ),
      expectedDraftRevision: saved.revision
    }
    const submitRequest = () =>
      app.request(
        `/api/v1/study-sessions/${submissionSession.payload.session.id}/submission`,
        {
          method: 'POST',
          headers: {
            Cookie: submissionSession.cookie,
            'Content-Type': 'application/json',
            Origin: origin,
            'Idempotency-Key': submissionKey,
            'X-Nihongo-Practice-Contract': '2'
          },
          body: JSON.stringify(submissionBody)
        }
      )
    const submit = await submitRequest()
    expect(submit.status).toBe(201)
    expect(submit.headers.get('X-Nihongo-Practice-Contract')).toBe('2')
    expect(
      await database.client.studyDraft.count({
        where: { studySessionId: submissionSession.payload.session.id }
      })
    ).toBe(0)

    const draftReplay = await draftRequest(
      submissionSession.payload.session.id,
      submissionSession.cookie,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          'Idempotency-Key': draftKey
        },
        body: JSON.stringify(body)
      }
    )
    expect(draftReplay.status).toBe(200)
    expect(draftReplay.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await draftReplay.json()).toEqual(saved)

    const submitReplay = await submitRequest()
    expect(submitReplay.status).toBe(201)
    expect(submitReplay.headers.get('Idempotency-Replayed')).toBe('true')

    const v1SubmissionBody = {
      answers: submissionBody.answers,
      durationSec: submissionBody.durationSec
    }
    const crossVersionReuse = await app.request(
      `/api/v1/study-sessions/${submissionSession.payload.session.id}/submission`,
      {
        method: 'POST',
        headers: {
          Cookie: submissionSession.cookie,
          'Content-Type': 'application/json',
          Origin: origin,
          'Idempotency-Key': submissionKey
        },
        body: JSON.stringify(v1SubmissionBody)
      }
    )
    expect(crossVersionReuse.status).toBe(409)
    expect(apiFailureSchema.parse(await crossVersionReuse.json()).code).toBe(
      'IDEMPOTENCY_KEY_REUSED'
    )
    const crossVersionMismatch = await app.request(
      `/api/v1/study-sessions/${submissionSession.payload.session.id}/submission`,
      {
        method: 'POST',
        headers: {
          Cookie: submissionSession.cookie,
          'Content-Type': 'application/json',
          Origin: origin,
          'Idempotency-Key': randomUUID()
        },
        body: JSON.stringify(v1SubmissionBody)
      }
    )
    expect(crossVersionMismatch.status).toBe(409)
    expect(apiFailureSchema.parse(await crossVersionMismatch.json()).code).toBe(
      'PRACTICE_CONTRACT_VERSION_MISMATCH'
    )

    const cancellationSession = await createV2Session()
    const cancel = () =>
      app.request(
        `/api/v1/study-sessions/${cancellationSession.payload.session.id}/cancellation`,
        {
          method: 'POST',
          headers: {
            Cookie: cancellationSession.cookie,
            'Content-Type': 'application/json',
            Origin: origin,
            'X-Nihongo-Practice-Contract': '2'
          },
          body: '{}'
        }
      )
    const firstCancel = await cancel()
    const repeatedCancel = await cancel()
    expect(firstCancel.status).toBe(204)
    expect(repeatedCancel.status).toBe(204)
    expect(firstCancel.headers.get('Content-Type')).toBeNull()
    expect(await firstCancel.text()).toBe('')
    expect(
      await database.client.studyDraft.count({
        where: { studySessionId: cancellationSession.payload.session.id }
      })
    ).toBe(0)
  })

  it('동시 same-key는 한 side effect로 replay하고 다른 key는 revision conflict로 직렬화한다', async () => {
    const sameKeySession = await createV2Session()
    const sameKeyBody = {
      expectedRevision: 0,
      currentOrdinal: 1,
      answers: sameKeySession.payload.questions.map(
        ({ sessionQuestionId }) => ({
          studySessionQuestionId: sessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 1
        })
      )
    }
    const save = (
      sessionId: string,
      cookie: string,
      key: string,
      body: object
    ) =>
      draftRequest(sessionId, cookie, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          'Idempotency-Key': key
        },
        body: JSON.stringify(body)
      })

    const sameKey = randomUUID()
    const sameKeyResponses = await Promise.all([
      save(
        sameKeySession.payload.session.id,
        sameKeySession.cookie,
        sameKey,
        sameKeyBody
      ),
      save(
        sameKeySession.payload.session.id,
        sameKeySession.cookie,
        sameKey,
        sameKeyBody
      )
    ])
    expect(sameKeyResponses.map(({ status }) => status)).toEqual([200, 200])
    expect(
      sameKeyResponses.filter(
        (response) => response.headers.get('Idempotency-Replayed') === 'true'
      )
    ).toHaveLength(1)
    expect(
      await database.client.studyDraft.findUniqueOrThrow({
        where: { studySessionId: sameKeySession.payload.session.id },
        select: { revision: true }
      })
    ).toEqual({ revision: 1 })

    const conflictSession = await createV2Session()
    const baseBody = {
      expectedRevision: 0,
      currentOrdinal: 1,
      answers: conflictSession.payload.questions.map(
        ({ sessionQuestionId }) => ({
          studySessionQuestionId: sessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 1
        })
      )
    }
    const conflictResponses = await Promise.all([
      save(
        conflictSession.payload.session.id,
        conflictSession.cookie,
        randomUUID(),
        baseBody
      ),
      save(
        conflictSession.payload.session.id,
        conflictSession.cookie,
        randomUUID(),
        {
          ...baseBody,
          answers: baseBody.answers.map((answer, index) =>
            index === 0 ? { ...answer, elapsedSec: 2 } : answer
          )
        }
      )
    ])
    expect(conflictResponses.map(({ status }) => status).toSorted()).toEqual([
      200, 409
    ])
    const rejected = conflictResponses.find(({ status }) => status === 409)
    expect(rejected).toBeDefined()
    expect(apiFailureSchema.parse(await rejected?.json()).code).toBe(
      'DRAFT_VERSION_CONFLICT'
    )
    expect(
      await database.client.idempotencyRecord.count({
        where: {
          studySessionId: conflictSession.payload.session.id,
          operation: 'STUDY_DRAFT_SAVE',
          state: 'SUCCEEDED'
        }
      })
    ).toBe(1)
  })

  it('draft finalize 실패는 revision·answers·idempotency reservation을 모두 rollback한다', async () => {
    const userId = await createUser()
    const session = await createOwnedV2Session(userId)
    const failure = new Error('forced draft finalize failure')
    const failingRepository = createPrismaStudyDraftRepository(
      database.client,
      {
        beforeFinalize: async () => {
          throw failure
        }
      }
    )

    await expect(
      failingRepository.saveAtomic({
        sessionId: session.id,
        idempotencyKey: randomUUID(),
        owner: { kind: 'USER', userId },
        observedAt: new Date(),
        body: toEmptyDraftBody(session)
      })
    ).rejects.toBe(failure)

    const draft = await database.client.studyDraft.findUniqueOrThrow({
      where: { studySessionId: session.id },
      select: {
        revision: true,
        answers: {
          orderBy: { studySessionQuestionId: 'asc' },
          select: { elapsedSec: true, selectedOptionId: true }
        }
      }
    })
    expect(draft.revision).toBe(0)
    expect(draft.answers).toEqual(
      session.questions
        .map(() => ({ elapsedSec: 0, selectedOptionId: null }))
        .toSorted(() => 0)
    )
    expect(
      await database.client.idempotencyRecord.count({
        where: {
          studySessionId: session.id,
          operation: 'STUDY_DRAFT_SAVE'
        }
      })
    ).toBe(0)
  })

  it('draft idempotency committed response는 canonical snapshot 전체와 일치해야 한다', async () => {
    const userId = await createUser()
    const session = await createOwnedV2Session(userId)
    const saved = await studyDraftRepository.saveAtomic({
      sessionId: session.id,
      idempotencyKey: randomUUID(),
      owner: { kind: 'USER', userId },
      observedAt: new Date(),
      body: toEmptyDraftBody(session)
    })
    const record = await database.client.idempotencyRecord.findFirstOrThrow({
      where: {
        studySessionId: session.id,
        operation: 'STUDY_DRAFT_SAVE'
      },
      select: { id: true }
    })
    const changedAnswer = structuredClone(saved.response)
    const firstAnswer = changedAnswer.answers[0]
    if (!firstAnswer) {
      throw new Error('Draft response answer fixture가 필요합니다.')
    }
    firstAnswer.elapsedSec += 1
    const malformedResponses: unknown[] = [
      { ...saved.response, unexpected: true },
      { ...saved.response, currentOrdinal: 2 },
      { ...saved.response, savedAt: '2099-01-01T00:00:00.000Z' },
      changedAnswer,
      {
        studySessionId: saved.response.studySessionId,
        revision: saved.response.revision,
        currentOrdinal: saved.response.currentOrdinal,
        savedAt: saved.response.savedAt
      }
    ]

    for (const malformedResponse of malformedResponses) {
      await expect(
        database.client.$transaction(async (transaction) => {
          await transaction.$executeRaw(
            Prisma.sql`ALTER TABLE "IdempotencyRecord"
              DISABLE TRIGGER "IdempotencyRecord_validate_change"`
          )
          await transaction.$executeRaw(Prisma.sql`
            UPDATE "IdempotencyRecord"
            SET "responseBody" = ${JSON.stringify(malformedResponse)}::jsonb
            WHERE "id" = ${record.id}::uuid
          `)
          await transaction.$executeRaw(
            Prisma.sql`ALTER TABLE "IdempotencyRecord"
              ENABLE TRIGGER "IdempotencyRecord_validate_change"`
          )
        })
      ).rejects.toThrow()
    }
  })

  it('foreign과 missing session을 GET/PUT/cancel 모두 같은 404로 숨긴다', async () => {
    const ownerSession = await createV2Session()
    const foreignSession = await createV2Session()
    const missingId = randomUUID()
    const body = {
      expectedRevision: 0,
      currentOrdinal: 1,
      answers: ownerSession.payload.questions.map(({ sessionQuestionId }) => ({
        studySessionQuestionId: sessionQuestionId,
        selectedOptionId: null,
        elapsedSec: 0
      }))
    }
    const normalizeFailure = async (response: Response) => {
      const { requestId: _requestId, ...failure } = apiFailureSchema.parse(
        await response.json()
      )
      return { status: response.status, failure }
    }
    const paths = [
      {
        foreign: draftRequest(
          ownerSession.payload.session.id,
          foreignSession.cookie
        ),
        missing: draftRequest(missingId, foreignSession.cookie)
      },
      {
        foreign: draftRequest(
          ownerSession.payload.session.id,
          foreignSession.cookie,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Origin: origin,
              'Idempotency-Key': randomUUID()
            },
            body: JSON.stringify(body)
          }
        ),
        missing: draftRequest(missingId, foreignSession.cookie, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Origin: origin,
            'Idempotency-Key': randomUUID()
          },
          body: JSON.stringify(body)
        })
      },
      {
        foreign: app.request(
          `/api/v1/study-sessions/${ownerSession.payload.session.id}/cancellation`,
          {
            method: 'POST',
            headers: {
              Cookie: foreignSession.cookie,
              'Content-Type': 'application/json',
              Origin: origin,
              'X-Nihongo-Practice-Contract': '2'
            },
            body: '{}'
          }
        ),
        missing: app.request(
          `/api/v1/study-sessions/${missingId}/cancellation`,
          {
            method: 'POST',
            headers: {
              Cookie: foreignSession.cookie,
              'Content-Type': 'application/json',
              Origin: origin,
              'X-Nihongo-Practice-Contract': '2'
            },
            body: '{}'
          }
        )
      }
    ]

    for (const pair of paths) {
      const [foreign, missing] = await Promise.all([
        normalizeFailure(await pair.foreign),
        normalizeFailure(await pair.missing)
      ])
      expect(foreign).toEqual(missing)
      expect(foreign).toMatchObject({
        status: 404,
        failure: { code: 'RESOURCE_NOT_FOUND', retryable: false }
      })
    }
  })

  it('foreign draft 조회는 owner session row lock에 대기하지 않고 404로 수렴한다', async () => {
    const ownerUserId = await createUser()
    const foreignUserId = await createUser()
    const session = await createOwnedV2Session(ownerUserId)

    let timeout: ReturnType<typeof setTimeout> | undefined
    const outcome = await database.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT session."id"
        FROM "StudySession" AS session
        WHERE session."id" = ${session.id}::uuid
        FOR UPDATE OF session
      `
      return await Promise.race([
        studyDraftRepository
          .findOwned(
            session.id,
            { kind: 'USER', userId: foreignUserId },
            new Date()
          )
          .then((value) => ({ kind: 'COMPLETED' as const, value })),
        new Promise<{ readonly kind: 'BLOCKED' }>((resolve) => {
          timeout = setTimeout(() => resolve({ kind: 'BLOCKED' }), 1_000)
        })
      ])
    })
    if (timeout) {
      clearTimeout(timeout)
    }

    expect(outcome).toEqual({ kind: 'COMPLETED', value: null })
  })

  it('모든 authoritative 관찰 경로가 overdue v2 session을 영속 만료시킨다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const observedAt = new Date()
    const createExpired = () =>
      createOwnedV2Session(userId, {
        startedAt: new Date(observedAt.getTime() - 48 * 60 * 60 * 1_000),
        expiresAt: new Date(observedAt.getTime() - 24 * 60 * 60 * 1_000)
      })
    const assertExpired = async (sessionId: string) => {
      expect(
        await database.client.studySession.findUniqueOrThrow({
          where: { id: sessionId },
          select: { status: true, draft: true }
        })
      ).toMatchObject({ status: 'EXPIRED', draft: null })
    }

    const readSession = await createExpired()
    await expect(
      studySessionRepository.findOwnedById(readSession.id, owner, observedAt)
    ).resolves.toMatchObject({ status: 'EXPIRED' })
    await assertExpired(readSession.id)

    const readDraft = await createExpired()
    await expect(
      studyDraftRepository.findOwned(readDraft.id, owner, observedAt)
    ).rejects.toBeInstanceOf(StudyDraftNotEditableError)
    await assertExpired(readDraft.id)

    const saveDraft = await createExpired()
    await expect(
      studyDraftRepository.saveAtomic({
        sessionId: saveDraft.id,
        idempotencyKey: randomUUID(),
        owner,
        observedAt,
        body: toEmptyDraftBody(saveDraft)
      })
    ).rejects.toBeInstanceOf(StudyDraftNotEditableError)
    await assertExpired(saveDraft.id)

    const historicalReplaySession = await createOwnedV2Session(userId, {
      startedAt: new Date(observedAt.getTime() - 2 * 60 * 60 * 1_000),
      expiresAt: new Date(observedAt.getTime() - 1)
    })
    const historicalReplayInput = {
      sessionId: historicalReplaySession.id,
      idempotencyKey: randomUUID(),
      owner,
      observedAt: new Date(observedAt.getTime() - 60 * 60 * 1_000),
      body: toEmptyDraftBody(historicalReplaySession)
    }
    await expect(
      studyDraftRepository.saveAtomic(historicalReplayInput)
    ).resolves.toMatchObject({ replayed: false })
    await expect(
      studyDraftRepository.saveAtomic({
        ...historicalReplayInput,
        observedAt
      })
    ).resolves.toMatchObject({ replayed: true })
    await assertExpired(historicalReplaySession.id)

    const changedReplaySession = await createOwnedV2Session(userId, {
      startedAt: new Date(observedAt.getTime() - 2 * 60 * 60 * 1_000),
      expiresAt: new Date(observedAt.getTime() - 1)
    })
    const changedReplayInput = {
      sessionId: changedReplaySession.id,
      idempotencyKey: randomUUID(),
      owner,
      observedAt: new Date(observedAt.getTime() - 60 * 60 * 1_000),
      body: toEmptyDraftBody(changedReplaySession)
    }
    await studyDraftRepository.saveAtomic(changedReplayInput)
    await expect(
      studyDraftRepository.saveAtomic({
        ...changedReplayInput,
        observedAt,
        body: { ...changedReplayInput.body, currentOrdinal: 2 }
      })
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError)
    await assertExpired(changedReplaySession.id)

    const cancelSession = await createExpired()
    await expect(
      studyDraftRepository.cancelOwned(cancelSession.id, owner, observedAt)
    ).resolves.toEqual({ kind: 'NOT_EDITABLE' })
    await assertExpired(cancelSession.id)

    const submitSession = await createExpired()
    await expect(
      createStudySubmissionService(
        studySubmissionRepository,
        () => observedAt
      ).submit(
        submitSession.id,
        randomUUID(),
        {
          answers: toEmptyDraftBody(submitSession).answers,
          durationSec: 0,
          expectedDraftRevision: 0
        },
        owner,
        2
      )
    ).rejects.toMatchObject({ code: 'STUDY_SESSION_NOT_EDITABLE' })
    await assertExpired(submitSession.id)
  })

  it('draft 48h와 submit 24h TTL 경계에서만 historical replay를 허용한다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const now = new Date()
    const draftSession = await createOwnedV2Session(userId, {
      startedAt: new Date(now.getTime() - 72 * 60 * 60 * 1_000),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000)
    })
    const draftInput = {
      sessionId: draftSession.id,
      idempotencyKey: randomUUID(),
      owner,
      observedAt: new Date(now.getTime() - 49 * 60 * 60 * 1_000),
      body: toEmptyDraftBody(draftSession)
    }
    await studyDraftRepository.saveAtomic(draftInput)
    const draftRecord =
      await database.client.idempotencyRecord.findFirstOrThrow({
        where: {
          studySessionId: draftSession.id,
          operation: 'STUDY_DRAFT_SAVE'
        },
        select: { expiresAt: true }
      })
    if (!draftRecord.expiresAt) {
      throw new Error('Draft idempotency expiry가 필요합니다.')
    }
    await expect(
      studyDraftRepository.saveAtomic({
        ...draftInput,
        observedAt: new Date(draftRecord.expiresAt.getTime() - 1)
      })
    ).resolves.toMatchObject({ replayed: true })
    await expect(
      studyDraftRepository.saveAtomic({
        ...draftInput,
        observedAt: draftRecord.expiresAt
      })
    ).rejects.toBeInstanceOf(DraftVersionConflictError)

    const submitSession = (
      await studySessionRepository.createRandom({
        owner,
        level: 'N5',
        subject: 'VOCABULARY',
        requestedCount: 1,
        startedAt: new Date(now.getTime() - 48 * 60 * 60 * 1_000),
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000)
      })
    ).session
    const submitKey = randomUUID()
    const submitBody = {
      answers: submitSession.questions.map(({ sessionQuestionId }) => ({
        studySessionQuestionId: sessionQuestionId,
        selectedOptionId: null,
        elapsedSec: 0
      })),
      durationSec: 0
    }
    await createStudySubmissionService(
      studySubmissionRepository,
      () => new Date(now.getTime() - 25 * 60 * 60 * 1_000)
    ).submit(submitSession.id, submitKey, submitBody, owner)
    const submitRecord =
      await database.client.idempotencyRecord.findFirstOrThrow({
        where: { studySessionId: submitSession.id, operation: 'STUDY_SUBMIT' },
        select: { expiresAt: true }
      })
    if (!submitRecord.expiresAt) {
      throw new Error('Submit idempotency expiry가 필요합니다.')
    }
    const submitExpiresAt = submitRecord.expiresAt
    await expect(
      createStudySubmissionService(
        studySubmissionRepository,
        () => new Date(submitExpiresAt.getTime() - 1)
      ).submit(submitSession.id, submitKey, submitBody, owner)
    ).resolves.toMatchObject({ replayed: true })
    await expect(
      createStudySubmissionService(
        studySubmissionRepository,
        () => submitExpiresAt
      ).submit(submitSession.id, submitKey, submitBody, owner)
    ).rejects.toMatchObject({ code: 'SESSION_ALREADY_SUBMITTED' })
  })

  it('save/cancel·submit/cancel·save/submit lock winner를 양방향으로 직렬화한다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }

    const saveFirstSession = await createOwnedV2Session(userId)
    const saveBarrier = createBarrier()
    const saveFirstRepository = createPrismaStudyDraftRepository(
      database.client,
      { afterSessionLocked: saveBarrier.hook }
    )
    const savePromise = saveFirstRepository.saveAtomic({
      sessionId: saveFirstSession.id,
      idempotencyKey: randomUUID(),
      owner,
      observedAt: new Date(),
      body: toEmptyDraftBody(saveFirstSession)
    })
    await saveBarrier.entered
    const cancelAfterSave = studyDraftRepository.cancelOwned(
      saveFirstSession.id,
      owner,
      new Date()
    )
    saveBarrier.release()
    await expect(savePromise).resolves.toMatchObject({ replayed: false })
    await expect(cancelAfterSave).resolves.toEqual({ kind: 'CANCELLED' })

    const cancelFirstSession = await createOwnedV2Session(userId)
    const cancelBarrier = createBarrier()
    const cancelFirstRepository = createPrismaStudyDraftRepository(
      database.client,
      { afterCancelSessionLocked: cancelBarrier.hook }
    )
    const cancelPromise = cancelFirstRepository.cancelOwned(
      cancelFirstSession.id,
      owner,
      new Date()
    )
    await cancelBarrier.entered
    const saveAfterCancel = studyDraftRepository.saveAtomic({
      sessionId: cancelFirstSession.id,
      idempotencyKey: randomUUID(),
      owner,
      observedAt: new Date(),
      body: toEmptyDraftBody(cancelFirstSession)
    })
    cancelBarrier.release()
    await expect(cancelPromise).resolves.toEqual({ kind: 'CANCELLED' })
    await expect(saveAfterCancel).rejects.toBeInstanceOf(
      StudyDraftNotEditableError
    )

    const submitFirstSession = await createOwnedV2Session(userId)
    const submitBarrier = createBarrier()
    const submitFirstService = createStudySubmissionService(
      createPrismaStudySubmissionRepository(database.client, {
        beforeFinalize: submitBarrier.hook
      })
    )
    const submitPromise = submitFirstService.submit(
      submitFirstSession.id,
      randomUUID(),
      {
        answers: toEmptyDraftBody(submitFirstSession).answers,
        durationSec: 0,
        expectedDraftRevision: 0
      },
      owner,
      2
    )
    await submitBarrier.entered
    const cancelAfterSubmit = studyDraftRepository.cancelOwned(
      submitFirstSession.id,
      owner,
      new Date()
    )
    submitBarrier.release()
    await expect(submitPromise).resolves.toMatchObject({ replayed: false })
    await expect(cancelAfterSubmit).resolves.toEqual({ kind: 'NOT_EDITABLE' })

    const cancelBeforeSubmitSession = await createOwnedV2Session(userId)
    const cancelBeforeSubmitBarrier = createBarrier()
    const cancelBeforeSubmitRepository = createPrismaStudyDraftRepository(
      database.client,
      { afterCancelSessionLocked: cancelBeforeSubmitBarrier.hook }
    )
    const cancelBeforeSubmit = cancelBeforeSubmitRepository.cancelOwned(
      cancelBeforeSubmitSession.id,
      owner,
      new Date()
    )
    await cancelBeforeSubmitBarrier.entered
    const submitAfterCancel = createStudySubmissionService(
      studySubmissionRepository
    ).submit(
      cancelBeforeSubmitSession.id,
      randomUUID(),
      {
        answers: toEmptyDraftBody(cancelBeforeSubmitSession).answers,
        durationSec: 0,
        expectedDraftRevision: 0
      },
      owner,
      2
    )
    cancelBeforeSubmitBarrier.release()
    await expect(cancelBeforeSubmit).resolves.toEqual({ kind: 'CANCELLED' })
    await expect(submitAfterCancel).rejects.toMatchObject({
      code: 'STUDY_SESSION_NOT_EDITABLE'
    })

    const saveBeforeSubmitSession = await createOwnedV2Session(userId)
    const saveBeforeSubmitBarrier = createBarrier()
    const saveBeforeSubmitRepository = createPrismaStudyDraftRepository(
      database.client,
      { afterSessionLocked: saveBeforeSubmitBarrier.hook }
    )
    const saveBeforeSubmit = saveBeforeSubmitRepository.saveAtomic({
      sessionId: saveBeforeSubmitSession.id,
      idempotencyKey: randomUUID(),
      owner,
      observedAt: new Date(),
      body: toEmptyDraftBody(saveBeforeSubmitSession)
    })
    await saveBeforeSubmitBarrier.entered
    const submitAfterSave = createStudySubmissionService(
      studySubmissionRepository
    ).submit(
      saveBeforeSubmitSession.id,
      randomUUID(),
      {
        answers: toEmptyDraftBody(saveBeforeSubmitSession).answers,
        durationSec: 0,
        expectedDraftRevision: 0
      },
      owner,
      2
    )
    saveBeforeSubmitBarrier.release()
    await expect(saveBeforeSubmit).resolves.toMatchObject({ replayed: false })
    await expect(submitAfterSave).rejects.toMatchObject({
      code: 'DRAFT_VERSION_CONFLICT'
    })

    const submitBeforeSaveSession = await createOwnedV2Session(userId)
    const submitBeforeSaveBarrier = createBarrier()
    const submitBeforeSaveService = createStudySubmissionService(
      createPrismaStudySubmissionRepository(database.client, {
        beforeFinalize: submitBeforeSaveBarrier.hook
      })
    )
    const submitBeforeSave = submitBeforeSaveService.submit(
      submitBeforeSaveSession.id,
      randomUUID(),
      {
        answers: toEmptyDraftBody(submitBeforeSaveSession).answers,
        durationSec: 0,
        expectedDraftRevision: 0
      },
      owner,
      2
    )
    await submitBeforeSaveBarrier.entered
    const saveAfterSubmit = studyDraftRepository.saveAtomic({
      sessionId: submitBeforeSaveSession.id,
      idempotencyKey: randomUUID(),
      owner,
      observedAt: new Date(),
      body: toEmptyDraftBody(submitBeforeSaveSession)
    })
    submitBeforeSaveBarrier.release()
    await expect(submitBeforeSave).resolves.toMatchObject({ replayed: false })
    await expect(saveAfterSubmit).rejects.toBeInstanceOf(
      StudyDraftNotEditableError
    )

    const finalStates = await database.client.studySession.findMany({
      where: {
        id: {
          in: [
            saveFirstSession.id,
            cancelFirstSession.id,
            submitFirstSession.id,
            cancelBeforeSubmitSession.id,
            saveBeforeSubmitSession.id,
            submitBeforeSaveSession.id
          ]
        }
      },
      select: { id: true, status: true, draft: true }
    })
    expect(finalStates).toEqual(
      expect.arrayContaining([
        { id: saveFirstSession.id, status: 'CANCELLED', draft: null },
        { id: cancelFirstSession.id, status: 'CANCELLED', draft: null },
        { id: submitFirstSession.id, status: 'SUBMITTED', draft: null },
        {
          id: cancelBeforeSubmitSession.id,
          status: 'CANCELLED',
          draft: null
        },
        {
          id: saveBeforeSubmitSession.id,
          status: 'IN_PROGRESS',
          draft: expect.objectContaining({ revision: 1 })
        },
        { id: submitBeforeSaveSession.id, status: 'SUBMITTED', draft: null }
      ])
    )
  }, 20_000)
})
