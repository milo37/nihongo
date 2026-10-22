import {
  createResultRetrySessionErrorSchema,
  createResultRetrySessionResponseSchema
} from '@nihongo/contracts/study/create-result-retry-session'
import { describe, expect, it } from 'vitest'
import { toVersionedContractStudySessionPayload } from '@mocks/adapters/studySessionContractAdapter'
import { mockCanonicalSubmissionV2Operations } from '@mocks/adapters/studySubmissionContractAdapter'
import { createMockGuestPrincipalCookie } from '@mocks/guestPrincipal'
import { mockDatabase } from '@mocks/repository/mockDatabase'

const BASE_URL = 'http://localhost/api/v1/study-sessions'
const RETRY_HEADERS = {
  'Content-Type': 'application/json',
  Origin: 'http://localhost',
  'X-Nihongo-Practice-Contract': '2'
}

const createSubmittedSource = (): string => {
  mockDatabase.loginAs('USER')
  const created = mockDatabase.createStudySession({
    canonicalContractVersion: 2,
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    count: 2,
    questionIds: ['n5-vocabulary-01', 'n5-vocabulary-02']
  })
  const payload = toVersionedContractStudySessionPayload(
    mockDatabase.getCanonicalStudySessionSnapshotRecord(
      created.session.id,
      null
    )
  )
  mockDatabase.submitCanonicalStudySession(
    {
      body: {
        answers: payload.questions.map(({ sessionQuestionId }) => ({
          studySessionQuestionId: sessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 0
        })),
        durationSec: 0,
        expectedDraftRevision: 0
      },
      contractVersion: 2,
      guestPrincipalId: null,
      idempotencyKey: crypto.randomUUID(),
      sessionId: created.session.id
    },
    mockCanonicalSubmissionV2Operations
  )
  return created.session.id
}

const createSubmittedGuestSource = (): {
  cookie: string
  guestPrincipalId: string
  sourceSessionId: string
} => {
  mockDatabase.logout()
  const guestPrincipalId = crypto.randomUUID()
  const created = mockDatabase.createStudySession({
    canonicalContractVersion: 2,
    canonicalGuestPrincipalId: guestPrincipalId,
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    count: 2,
    questionIds: ['n5-vocabulary-01', 'n5-vocabulary-02']
  })
  const payload = toVersionedContractStudySessionPayload(
    mockDatabase.getCanonicalStudySessionSnapshotRecord(
      created.session.id,
      guestPrincipalId
    )
  )
  mockDatabase.submitCanonicalStudySession(
    {
      body: {
        answers: payload.questions.map(({ sessionQuestionId }) => ({
          studySessionQuestionId: sessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 0
        })),
        durationSec: 0,
        expectedDraftRevision: 0
      },
      contractVersion: 2,
      guestPrincipalId,
      idempotencyKey: crypto.randomUUID(),
      sessionId: created.session.id
    },
    mockCanonicalSubmissionV2Operations
  )

  const cookie = createMockGuestPrincipalCookie(guestPrincipalId).split(
    ';',
    1
  )[0]
  if (!cookie) {
    throw new Error('canonical guest cookie가 필요합니다.')
  }

  return { cookie, guestPrincipalId, sourceSessionId: created.session.id }
}

const createRetry = (
  sourceSessionId: string,
  idempotencyKey: string,
  cookie?: string
): Promise<Response> =>
  fetch(`${BASE_URL}/${sourceSessionId}/retry`, {
    method: 'POST',
    headers: {
      ...RETRY_HEADERS,
      'Idempotency-Key': idempotencyKey,
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: '{}'
  })

const withoutRequestId = (failure: {
  code: string
  message: string
  requestId: string
  retryable: boolean
}) => ({
  code: failure.code,
  message: failure.message,
  retryable: failure.retryable
})

describe('canonical result retry MSW integration', () => {
  it('오답의 historical pin으로 v2 세션을 만들고 같은 key를 exact replay한다', async () => {
    const sourceSessionId = createSubmittedSource()
    const idempotencyKey = crypto.randomUUID()
    const create = (): Promise<Response> =>
      createRetry(sourceSessionId, idempotencyKey)

    const firstResponse = await create()
    expect(firstResponse.status).toBe(201)
    const first = createResultRetrySessionResponseSchema.parse(
      await firstResponse.json()
    )
    expect(first).toMatchObject({
      session: {
        mode: 'WRONG_NOTE',
        practiceContractVersion: 2,
        requestedCount: 2,
        actualCount: 2,
        usedFallback: false,
        fallbackReason: null
      }
    })
    expect(firstResponse.headers.get('Location')).toBe(
      `/api/v1/study-sessions/${first.session.id}`
    )
    expect(firstResponse.headers.get('X-Nihongo-Practice-Contract')).toBe('2')
    expect(firstResponse.headers.get('Idempotency-Replayed')).toBeNull()

    const replayResponse = await create()
    expect(replayResponse.status).toBe(201)
    expect(replayResponse.headers.get('Idempotency-Replayed')).toBe('true')
    expect(
      createResultRetrySessionResponseSchema.parse(await replayResponse.json())
    ).toEqual(first)
  })

  it('active guest는 RANDOM target을 만들고 cookie 갱신 없이 exact replay한다', async () => {
    const source = createSubmittedGuestSource()
    const idempotencyKey = crypto.randomUUID()

    const firstResponse = await createRetry(
      source.sourceSessionId,
      idempotencyKey,
      source.cookie
    )
    const first = createResultRetrySessionResponseSchema.parse(
      await firstResponse.json()
    )

    expect(firstResponse.status).toBe(201)
    expect(firstResponse.headers.get('Set-Cookie')).toBeNull()
    expect(firstResponse.headers.get('Idempotency-Replayed')).toBeNull()
    expect(first.session).toMatchObject({
      mode: 'RANDOM',
      practiceContractVersion: 2,
      requestedCount: 2,
      actualCount: 2,
      usedFallback: false,
      fallbackReason: null
    })

    const replayResponse = await createRetry(
      source.sourceSessionId,
      idempotencyKey,
      source.cookie
    )
    const replay = createResultRetrySessionResponseSchema.parse(
      await replayResponse.json()
    )

    expect(replayResponse.status).toBe(201)
    expect(replayResponse.headers.get('Set-Cookie')).toBeNull()
    expect(replayResponse.headers.get('Idempotency-Replayed')).toBe('true')
    expect(replay).toEqual(first)
  })

  it('guest proof 오류를 401로 선행하고 foreign·missing source를 같은 404로 숨긴다', async () => {
    const guestA = createSubmittedGuestSource()
    const guestB = createSubmittedGuestSource()

    const invalidProofResponse = await createRetry(
      guestA.sourceSessionId,
      crypto.randomUUID(),
      'nihongo.mock_guest_principal=tampered'
    )
    const invalidProof = createResultRetrySessionErrorSchema.parse(
      await invalidProofResponse.json()
    )
    expect(invalidProofResponse.status).toBe(401)
    expect(invalidProof.code).toBe('GUEST_SESSION_EXPIRED')

    const foreignResponse = await createRetry(
      guestA.sourceSessionId,
      crypto.randomUUID(),
      guestB.cookie
    )
    const missingResponse = await createRetry(
      crypto.randomUUID(),
      crypto.randomUUID(),
      guestB.cookie
    )
    const foreign = createResultRetrySessionErrorSchema.parse(
      await foreignResponse.json()
    )
    const missing = createResultRetrySessionErrorSchema.parse(
      await missingResponse.json()
    )

    expect(foreignResponse.status).toBe(404)
    expect(missingResponse.status).toBe(404)
    expect(withoutRequestId(foreign)).toEqual(withoutRequestId(missing))

    mockDatabase.deleteCanonicalGuestPrincipal(guestA.guestPrincipalId)
    const inactiveResponse = await createRetry(
      guestA.sourceSessionId,
      crypto.randomUUID(),
      guestA.cookie
    )
    const inactive = createResultRetrySessionErrorSchema.parse(
      await inactiveResponse.json()
    )
    expect(inactiveResponse.status).toBe(401)
    expect(inactive.code).toBe('GUEST_SESSION_EXPIRED')
  })

  it('인증·header·멱등 key 경계를 fail closed로 처리한다', async () => {
    const unauthenticated = await fetch(
      `${BASE_URL}/${crypto.randomUUID()}/retry`,
      {
        method: 'POST',
        headers: {
          ...RETRY_HEADERS,
          'Idempotency-Key': crypto.randomUUID()
        },
        body: '{}'
      }
    )
    expect(unauthenticated.status).toBe(401)
    expect(
      createResultRetrySessionErrorSchema.parse(await unauthenticated.json())
        .code
    ).toBe('AUTHENTICATION_REQUIRED')

    const sourceSessionId = createSubmittedSource()
    const missingKey = await fetch(`${BASE_URL}/${sourceSessionId}/retry`, {
      method: 'POST',
      headers: RETRY_HEADERS,
      body: '{}'
    })
    expect(missingKey.status).toBe(400)
    expect(
      createResultRetrySessionErrorSchema.parse(await missingKey.json()).code
    ).toBe('IDEMPOTENCY_KEY_REQUIRED')

    const wrongContract = await fetch(`${BASE_URL}/${sourceSessionId}/retry`, {
      method: 'POST',
      headers: {
        ...RETRY_HEADERS,
        'Idempotency-Key': crypto.randomUUID(),
        'X-Nihongo-Practice-Contract': '1'
      },
      body: '{}'
    })
    expect(wrongContract.status).toBe(400)
    expect(
      createResultRetrySessionErrorSchema.parse(await wrongContract.json()).code
    ).toBe('INVALID_REQUEST')
  })
})
