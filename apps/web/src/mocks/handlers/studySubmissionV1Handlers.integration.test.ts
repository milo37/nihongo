import type { CreateStudySessionBody } from '@nihongo/contracts/study/create-study-session'
import {
  createStudySessionResponseSchema,
  type CreateStudySessionResponse
} from '@nihongo/contracts/study/create-study-session'
import {
  getStudyResultErrorSchema,
  getStudyResultResponseSchema
} from '@nihongo/contracts/study/get-study-result'
import {
  submitStudySessionErrorSchema,
  submitStudySessionResponseSchema,
  type SubmitStudySessionBody
} from '@nihongo/contracts/study/submit-study-session'
import { describe, expect, it, vi } from 'vitest'
import { logoutUser } from '@api/auth/logoutUser'
import { signInUser } from '@api/auth/signInUser'
import { getSourceQuestionId } from '@mocks/adapters/questionContractAdapter'
import { toContractStudySessionPayload } from '@mocks/adapters/studySessionContractAdapter'
import { DEMO_USER_ID } from '@mocks/data/users'
import { MOCK_GUEST_PRINCIPAL_COOKIE_NAME } from '@mocks/guestPrincipal'
import {
  MockDatabase,
  MockDatabaseError,
  mockDatabase,
  type AdminQuestionInput
} from '@mocks/repository/mockDatabase'
import { clearMockGuestPrincipalCookie } from '@/test/server'

const CREATE_URL = 'http://localhost/api/v1/study-sessions'
const DELETE_GUEST_URL = 'http://localhost/api/v1/guest-principal'
const LEGACY_URL = 'http://localhost/api/study/session'

type CanonicalQuestion = CreateStudySessionResponse['questions'][number]

const requireGuestCookie = (cookie: string | null): string => {
  if (!cookie?.startsWith(`${MOCK_GUEST_PRINCIPAL_COOKIE_NAME}=`)) {
    throw new Error('canonical guest cookie가 필요합니다.')
  }
  return cookie
}

const getGuestPrincipalId = (cookie: string): string =>
  cookie.slice(MOCK_GUEST_PRINCIPAL_COOKIE_NAME.length + 1)

const createCanonicalSession = async (
  body: CreateStudySessionBody,
  cookie?: string
): Promise<{
  cookie: string | null
  payload: CreateStudySessionResponse
  response: Response
}> => {
  const response = await fetch(CREATE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  })
  const payload = createStudySessionResponseSchema.parse(await response.json())

  return {
    cookie: response.headers.get('Set-Cookie')?.split(';', 1)[0] ?? null,
    payload,
    response
  }
}

const submitCanonicalSession = async (
  sessionId: string,
  idempotencyKey: string,
  body: SubmitStudySessionBody,
  cookie?: string
): Promise<Response> =>
  fetch(`${CREATE_URL}/${sessionId}/submission`, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  })

const getCanonicalResult = (
  sessionId: string,
  cookie?: string
): Promise<Response> =>
  fetch(`${CREATE_URL}/${sessionId}/result`, {
    credentials: 'omit',
    headers: cookie ? { Cookie: cookie } : undefined
  })

const getSourceQuestion = (question: CanonicalQuestion) => {
  const sourceQuestionId = getSourceQuestionId(
    question.question.id,
    mockDatabase.listAdminQuestions({ pageSize: 100 }).items
  )
  if (!sourceQuestionId) {
    throw new Error('contract 문제에 대응하는 source 문제가 필요합니다.')
  }
  return mockDatabase.getAdminQuestion(sourceQuestionId)
}

const getCorrectOptionId = (question: CanonicalQuestion): string => {
  const source = getSourceQuestion(question)
  const correctIndex = source.options.findIndex(({ isCorrect }) => isCorrect)
  const option = question.question.options[correctIndex]
  if (!option) {
    throw new Error('contract 문제의 정답 보기가 필요합니다.')
  }
  return option.id
}

const getWrongOptionId = (question: CanonicalQuestion): string => {
  const correctOptionId = getCorrectOptionId(question)
  const option = question.question.options.find(
    ({ id }) => id !== correctOptionId
  )
  if (!option) {
    throw new Error('contract 문제의 오답 보기가 필요합니다.')
  }
  return option.id
}

const toAnswer = (
  question: CanonicalQuestion,
  selectedOptionId: string | null,
  elapsedSec: number
): SubmitStudySessionBody['answers'][number] => ({
  studySessionQuestionId: question.sessionQuestionId,
  selectedOptionId,
  elapsedSec
})

const expectCanonicalHeaders = (response: Response): void => {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(response.headers.get('X-Request-Id')).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
  )
}

const toAdminInput = (
  question: ReturnType<typeof mockDatabase.getAdminQuestion>
): AdminQuestionInput => {
  const correctOption = question.options.find(({ isCorrect }) => isCorrect)
  if (!correctOption) {
    throw new Error('테스트 문제의 정답 보기가 필요합니다.')
  }
  return {
    level: question.level,
    subject: question.subject,
    questionType: question.questionType,
    passage: question.passage,
    questionText: question.questionText,
    options: question.options.map(({ id, label, text }) => ({
      id,
      label,
      text
    })),
    correctOptionId: correctOption.id,
    explanationKo: question.explanationKo,
    explanationJa: question.explanationJa,
    difficulty: question.difficulty,
    tags: question.tags,
    status: question.status
  }
}

const createPinnedUserSession = (
  sourceQuestionId: string
): CreateStudySessionResponse => {
  const { session } = mockDatabase.createStudySession({
    canonicalContractVersion: 1,
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    count: 1,
    questionIds: [sourceQuestionId]
  })
  return createStudySessionResponseSchema.parse(
    toContractStudySessionPayload(
      mockDatabase.getCanonicalStudySessionSnapshotRecord(session.id, null)
    )
  )
}

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

describe('canonical study submission/result v1 MSW integration', () => {
  it('full answer/null을 서버 채점하고 same-key reorder replay와 reload를 동일 결과로 고정한다', async () => {
    const created = await createCanonicalSession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 3
    })
    const cookie = requireGuestCookie(created.cookie)
    const [firstQuestion, secondQuestion, thirdQuestion] =
      created.payload.questions
    if (!firstQuestion || !secondQuestion || !thirdQuestion) {
      throw new Error('세 문제의 canonical session이 필요합니다.')
    }
    const answers = [
      toAnswer(thirdQuestion, null, 9),
      toAnswer(firstQuestion, getCorrectOptionId(firstQuestion), 7),
      toAnswer(secondQuestion, getWrongOptionId(secondQuestion), 8)
    ]
    const key = crypto.randomUUID()
    const firstResponse = await submitCanonicalSession(
      created.payload.session.id,
      key,
      { answers, durationSec: 24 },
      cookie
    )
    const firstResult = submitStudySessionResponseSchema.parse(
      await firstResponse.json()
    )

    expect(firstResponse.status).toBe(201)
    expectCanonicalHeaders(firstResponse)
    expect(firstResponse.headers.get('Idempotency-Replayed')).toBeNull()
    expect(firstResponse.headers.get('Set-Cookie')).toContain(cookie)
    expect(firstResult).toMatchObject({
      totalCount: 3,
      correctCount: 1,
      incorrectCount: 2,
      correctRate: 33.33,
      durationSec: 24
    })
    expect(
      firstResult.items.map(({ sessionQuestionId }) => sessionQuestionId)
    ).toEqual(
      created.payload.questions.map(
        ({ sessionQuestionId }) => sessionQuestionId
      )
    )
    expect(firstResult.items[2]?.selectedOptionId).toBeNull()
    expect(firstResult.items[2]?.isCorrect).toBe(false)
    expect(
      firstResult.items.every(({ wrongNoteStatus }) => wrongNoteStatus === null)
    ).toBe(true)
    expect(
      mockDatabase.getCanonicalStudyAnswerRecords(firstResult.sessionId)
    ).toHaveLength(3)
    expect(mockDatabase.getCanonicalIdempotencyRecords()).toHaveLength(1)
    expect(mockDatabase.getCanonicalReviewEventRecords()).toHaveLength(0)

    for (const question of [secondQuestion, thirdQuestion]) {
      expect(() =>
        mockDatabase.getWrongNote(DEMO_USER_ID, getSourceQuestion(question).id)
      ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }))
    }

    const replayResponse = await submitCanonicalSession(
      created.payload.session.id,
      key,
      { answers: answers.toReversed(), durationSec: 24 },
      cookie
    )
    const replayResult = submitStudySessionResponseSchema.parse(
      await replayResponse.json()
    )

    expect(replayResponse.status).toBe(201)
    expect(replayResponse.headers.get('Idempotency-Replayed')).toBe('true')
    expect(replayResponse.headers.get('Set-Cookie')).toContain(cookie)
    expect(replayResult).toEqual(firstResult)
    expect(
      mockDatabase.getCanonicalStudyAnswerRecords(firstResult.sessionId)
    ).toHaveLength(3)
    expect(mockDatabase.getCanonicalIdempotencyRecords()).toHaveLength(1)
    expect(mockDatabase.getCanonicalReviewEventRecords()).toHaveLength(0)

    const resultResponse = await getCanonicalResult(
      firstResult.sessionId,
      cookie
    )
    const fetched = getStudyResultResponseSchema.parse(
      await resultResponse.json()
    )
    expect(resultResponse.status).toBe(200)
    expectCanonicalHeaders(resultResponse)
    expect(resultResponse.headers.get('Set-Cookie')).toBeNull()
    expect(fetched).toEqual(firstResult)

    const restored = new MockDatabase({ listenToStorage: false })
    try {
      expect(
        restored.getCanonicalStudyResult(
          firstResult.sessionId,
          getGuestPrincipalId(cookie)
        )
      ).toEqual(firstResult)
      expect(
        restored.getCanonicalStudyAnswerRecords(firstResult.sessionId)
      ).toHaveLength(3)
      expect(restored.getCanonicalIdempotencyRecords()).toHaveLength(1)
      expect(restored.getCanonicalReviewEventRecords()).toHaveLength(0)
    } finally {
      restored.dispose()
    }
  })

  it('동시 same-key를 exact-once 처리하고 key reuse와 different-key conflict를 구분한다', async () => {
    const created = await createCanonicalSession({
      level: 'N5',
      subject: 'GRAMMAR',
      mode: 'RANDOM',
      count: 1
    })
    const cookie = requireGuestCookie(created.cookie)
    const question = created.payload.questions[0]
    if (!question) {
      throw new Error('canonical session 문제가 필요합니다.')
    }
    const key = crypto.randomUUID()
    const body: SubmitStudySessionBody = {
      answers: [toAnswer(question, getCorrectOptionId(question), 4)],
      durationSec: 4
    }

    const responses = await Promise.all([
      submitCanonicalSession(created.payload.session.id, key, body, cookie),
      submitCanonicalSession(created.payload.session.id, key, body, cookie)
    ])
    const results = await Promise.all(
      responses.map(async (response) =>
        submitStudySessionResponseSchema.parse(await response.json())
      )
    )

    expect(responses.map(({ status }) => status)).toEqual([201, 201])
    expect(
      responses
        .map((response) => response.headers.get('Idempotency-Replayed'))
        .toSorted()
    ).toEqual([null, 'true'])
    expect(results[1]).toEqual(results[0])
    expect(
      mockDatabase.getCanonicalStudyAnswerRecords(created.payload.session.id)
    ).toHaveLength(1)
    expect(mockDatabase.getCanonicalIdempotencyRecords()).toHaveLength(1)

    const reusedResponse = await submitCanonicalSession(
      created.payload.session.id,
      key,
      {
        answers: [{ ...body.answers[0], elapsedSec: 5 }],
        durationSec: 4
      },
      cookie
    )
    const reused = submitStudySessionErrorSchema.parse(
      await reusedResponse.json()
    )
    expect(reusedResponse.status).toBe(409)
    expect(reused.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(reusedResponse.headers.get('Location')).toBeNull()
    expect(reusedResponse.headers.get('Set-Cookie')).toBeNull()

    const differentKeyResponse = await submitCanonicalSession(
      created.payload.session.id,
      crypto.randomUUID(),
      body,
      cookie
    )
    const differentKey = submitStudySessionErrorSchema.parse(
      await differentKeyResponse.json()
    )
    expect(differentKeyResponse.status).toBe(409)
    expect(differentKey.code).toBe('SESSION_ALREADY_SUBMITTED')
    expect(differentKeyResponse.headers.get('Location')).toBe(
      `/api/v1/study-sessions/${created.payload.session.id}/result`
    )
    expect(differentKeyResponse.headers.get('Set-Cookie')).toBeNull()
    expect(
      mockDatabase.getCanonicalStudyAnswerRecords(created.payload.session.id)
    ).toHaveLength(1)
    expect(mockDatabase.getCanonicalIdempotencyRecords()).toHaveLength(1)
  })

  it('HTTP·answer·option validation을 stable code로 거부하고 canonical write를 남기지 않는다', async () => {
    const created = await createCanonicalSession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const cookie = requireGuestCookie(created.cookie)
    const foreign = await createCanonicalSession(
      {
        level: 'N5',
        subject: 'GRAMMAR',
        mode: 'RANDOM',
        count: 1
      },
      cookie
    )
    const question = created.payload.questions[0]
    const foreignQuestion = foreign.payload.questions[0]
    if (!question || !foreignQuestion) {
      throw new Error('owner와 foreign canonical 문제가 필요합니다.')
    }
    const validBody: SubmitStudySessionBody = {
      answers: [toAnswer(question, getCorrectOptionId(question), 4)],
      durationSec: 4
    }
    const baseUrl = `${CREATE_URL}/${created.payload.session.id}/submission`

    const missingKeyResponse = await fetch(baseUrl, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(validBody)
    })
    const missingKey = submitStudySessionErrorSchema.parse(
      await missingKeyResponse.json()
    )
    expect(missingKeyResponse.status).toBe(400)
    expect(missingKey.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(missingKey.fieldErrors).toBeUndefined()
    expectCanonicalHeaders(missingKeyResponse)
    expect(missingKeyResponse.headers.get('X-Request-Id')).toBe(
      missingKey.requestId
    )

    const invalidDurationResponse = await submitCanonicalSession(
      created.payload.session.id,
      crypto.randomUUID(),
      {
        answers: [{ ...validBody.answers[0], elapsedSec: 86_401 }],
        durationSec: 4
      },
      cookie
    )
    const invalidDuration = submitStudySessionErrorSchema.parse(
      await invalidDurationResponse.json()
    )
    expect(invalidDurationResponse.status).toBe(422)
    expect(invalidDuration.code).toBe('INVALID_DURATION')

    const duplicateAnswerResponse = await submitCanonicalSession(
      created.payload.session.id,
      crypto.randomUUID(),
      {
        answers: [validBody.answers[0], validBody.answers[0]],
        durationSec: 4
      },
      cookie
    )
    const duplicateAnswer = submitStudySessionErrorSchema.parse(
      await duplicateAnswerResponse.json()
    )
    expect(duplicateAnswerResponse.status).toBe(422)
    expect(duplicateAnswer.code).toBe('DUPLICATE_ANSWER')
    expectCanonicalHeaders(duplicateAnswerResponse)
    expect(duplicateAnswerResponse.headers.get('X-Request-Id')).toBe(
      duplicateAnswer.requestId
    )

    const foreignAnswerResponse = await submitCanonicalSession(
      created.payload.session.id,
      crypto.randomUUID(),
      {
        answers: [
          toAnswer(
            foreignQuestion,
            foreignQuestion.question.options[0]?.id ?? null,
            4
          )
        ],
        durationSec: 4
      },
      cookie
    )
    const foreignAnswer = submitStudySessionErrorSchema.parse(
      await foreignAnswerResponse.json()
    )
    expect(foreignAnswerResponse.status).toBe(422)
    expect(foreignAnswer.code).toBe('ANSWER_NOT_IN_SESSION')

    const foreignOptionResponse = await submitCanonicalSession(
      created.payload.session.id,
      crypto.randomUUID(),
      {
        answers: [
          toAnswer(question, foreignQuestion.question.options[0]?.id ?? null, 4)
        ],
        durationSec: 4
      },
      cookie
    )
    const foreignOption = submitStudySessionErrorSchema.parse(
      await foreignOptionResponse.json()
    )
    expect(foreignOptionResponse.status).toBe(422)
    expect(foreignOption.code).toBe('OPTION_NOT_IN_VERSION')

    const rawCases = [
      { body: '{', expectedCode: 'INVALID_JSON', expectedStatus: 400 },
      { body: '[]', expectedCode: 'INVALID_JSON', expectedStatus: 400 },
      {
        body: JSON.stringify({ padding: 'x'.repeat(17 * 1_024) }),
        expectedCode: 'INVALID_REQUEST',
        expectedStatus: 400
      }
    ] as const
    for (const testCase of rawCases) {
      const response = await fetch(baseUrl, {
        method: 'POST',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'Idempotency-Key': crypto.randomUUID()
        },
        body: testCase.body
      })
      const failure = submitStudySessionErrorSchema.parse(await response.json())
      expect(response.status).toBe(testCase.expectedStatus)
      expect(failure.code).toBe(testCase.expectedCode)
      expectCanonicalHeaders(response)
      expect(response.headers.get('X-Request-Id')).toBe(failure.requestId)
    }

    const invalidContentTypeResponse = await fetch(baseUrl, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'text/plain',
        Cookie: cookie,
        'Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify(validBody)
    })
    const invalidContentType = submitStudySessionErrorSchema.parse(
      await invalidContentTypeResponse.json()
    )
    expect(invalidContentTypeResponse.status).toBe(400)
    expect(invalidContentType.code).toBe('INVALID_REQUEST')
    expectCanonicalHeaders(invalidContentTypeResponse)
    expect(invalidContentTypeResponse.headers.get('X-Request-Id')).toBe(
      invalidContentType.requestId
    )

    const securityHeaderCases: Array<Record<string, string>> = [
      { Origin: 'https://evil.example' },
      { 'Sec-Fetch-Site': 'cross-site' }
    ]
    for (const securityHeaders of securityHeaderCases) {
      const response = await fetch(baseUrl, {
        method: 'POST',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'Idempotency-Key': crypto.randomUUID(),
          ...securityHeaders
        },
        body: JSON.stringify(validBody)
      })
      const failure = submitStudySessionErrorSchema.parse(await response.json())
      expect(response.status).toBe(403)
      expect(failure.code).toBe('UNTRUSTED_ORIGIN')
      expectCanonicalHeaders(response)
      expect(response.headers.get('X-Request-Id')).toBe(failure.requestId)
    }

    expect(
      mockDatabase.getCanonicalStudyAnswerRecords(created.payload.session.id)
    ).toHaveLength(0)
    expect(mockDatabase.getCanonicalIdempotencyRecords()).toHaveLength(0)
    expect(
      mockDatabase.hasCanonicalStudyResultRecord(created.payload.session.id)
    ).toBe(false)

    const notReadyResponse = await getCanonicalResult(
      created.payload.session.id,
      cookie
    )
    const notReady = getStudyResultErrorSchema.parse(
      await notReadyResponse.json()
    )
    expect(notReadyResponse.status).toBe(409)
    expect(notReady.code).toBe('STUDY_RESULT_NOT_READY')
    expectCanonicalHeaders(notReadyResponse)
    expect(notReadyResponse.headers.get('X-Request-Id')).toBe(
      notReady.requestId
    )
  })

  it('missing·foreign·legacy session을 동일 404로 숨기고 guest proof 오류는 401로 선행한다', async () => {
    const guestA = await createCanonicalSession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const guestACookie = requireGuestCookie(guestA.cookie)
    const guestAQuestion = guestA.payload.questions[0]
    if (!guestAQuestion) {
      throw new Error('guest A 문제가 필요합니다.')
    }
    await clearMockGuestPrincipalCookie()
    const guestB = await createCanonicalSession({
      level: 'N5',
      subject: 'GRAMMAR',
      mode: 'RANDOM',
      count: 1
    })
    const guestBCookie = requireGuestCookie(guestB.cookie)
    const legacy = mockDatabase.createStudySession({
      level: 'N5',
      subject: 'READING',
      mode: 'RANDOM',
      count: 1
    })
    await clearMockGuestPrincipalCookie()

    const body: SubmitStudySessionBody = {
      answers: [
        toAnswer(guestAQuestion, getCorrectOptionId(guestAQuestion), 3)
      ],
      durationSec: 3
    }
    const failures = []
    for (const sessionId of [
      crypto.randomUUID(),
      guestB.payload.session.id,
      legacy.session.id
    ]) {
      const response = await submitCanonicalSession(
        sessionId,
        crypto.randomUUID(),
        body,
        guestACookie
      )
      const failure = submitStudySessionErrorSchema.parse(await response.json())
      expect(response.status).toBe(404)
      failures.push(withoutRequestId(failure))
    }
    expect(failures[1]).toEqual(failures[0])
    expect(failures[2]).toEqual(failures[0])
    expect(failures[0]).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      message: '학습 세션을 찾을 수 없습니다.',
      retryable: false
    })

    const missingProofResponse = await submitCanonicalSession(
      guestA.payload.session.id,
      crypto.randomUUID(),
      body
    )
    const missingProof = submitStudySessionErrorSchema.parse(
      await missingProofResponse.json()
    )
    expect(missingProofResponse.status).toBe(401)
    expect(missingProof.code).toBe('AUTHENTICATION_REQUIRED')

    const invalidProofResponse = await submitCanonicalSession(
      guestA.payload.session.id,
      crypto.randomUUID(),
      body,
      `${MOCK_GUEST_PRINCIPAL_COOKIE_NAME}=tampered`
    )
    const invalidProof = submitStudySessionErrorSchema.parse(
      await invalidProofResponse.json()
    )
    expect(invalidProofResponse.status).toBe(401)
    expect(invalidProof.code).toBe('GUEST_SESSION_EXPIRED')

    const missingResultResponse = await getCanonicalResult(
      guestA.payload.session.id
    )
    const missingResultProof = getStudyResultErrorSchema.parse(
      await missingResultResponse.json()
    )
    expect(missingResultResponse.status).toBe(401)
    expect(missingResultProof.code).toBe('AUTHENTICATION_REQUIRED')

    const foreignResultResponse = await getCanonicalResult(
      guestA.payload.session.id,
      guestBCookie
    )
    const foreignResult = getStudyResultErrorSchema.parse(
      await foreignResultResponse.json()
    )
    expect(foreignResultResponse.status).toBe(404)
    expect(foreignResult.code).toBe('RESOURCE_NOT_FOUND')

    const invalidSubmitIdResponse = await fetch(
      `${CREATE_URL}/not-a-uuid/submission`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: guestACookie,
          'Idempotency-Key': crypto.randomUUID()
        },
        body: JSON.stringify(body)
      }
    )
    const invalidSubmitId = submitStudySessionErrorSchema.parse(
      await invalidSubmitIdResponse.json()
    )
    expect(invalidSubmitIdResponse.status).toBe(422)
    expect(invalidSubmitId.code).toBe('VALIDATION_ERROR')

    const invalidResultIdResponse = await getCanonicalResult(
      'not-a-uuid',
      guestACookie
    )
    const invalidResultId = getStudyResultErrorSchema.parse(
      await invalidResultIdResponse.json()
    )
    expect(invalidResultIdResponse.status).toBe(422)
    expect(invalidResultId.code).toBe('INVALID_ID')

    expect(
      mockDatabase.getCanonicalStudyAnswerRecords(guestA.payload.session.id)
    ).toHaveLength(0)
    expect(mockDatabase.getCanonicalIdempotencyRecords()).toHaveLength(0)
    expect(
      mockDatabase.hasCanonicalStudyResultRecord(guestA.payload.session.id)
    ).toBe(false)
  })

  it.each([
    {
      role: 'USER',
      email: 'user@example.com',
      password: 'Demo-user-2026!'
    },
    {
      role: 'ADMIN',
      email: 'admin@example.com',
      password: 'Demo-admin-2026!'
    }
  ])(
    '$role principal이 guest marker보다 우선해 자기 session만 제출한다',
    async ({ email, password }) => {
      const guest = await createCanonicalSession({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1
      })
      const guestCookie = requireGuestCookie(guest.cookie)
      const guestQuestion = guest.payload.questions[0]
      if (!guestQuestion) {
        throw new Error('guest canonical 문제가 필요합니다.')
      }

      await signInUser({ email, password })
      const guestAsUserResponse = await submitCanonicalSession(
        guest.payload.session.id,
        crypto.randomUUID(),
        {
          answers: [
            toAnswer(guestQuestion, getCorrectOptionId(guestQuestion), 2)
          ],
          durationSec: 2
        },
        guestCookie
      )
      const guestAsUser = submitStudySessionErrorSchema.parse(
        await guestAsUserResponse.json()
      )
      expect(guestAsUserResponse.status).toBe(404)
      expect(guestAsUser.code).toBe('RESOURCE_NOT_FOUND')

      const owned = await createCanonicalSession(
        {
          level: 'N5',
          subject: 'GRAMMAR',
          mode: 'RANDOM',
          count: 1
        },
        guestCookie
      )
      expect(owned.cookie).toBeNull()
      const ownedQuestion = owned.payload.questions[0]
      if (!ownedQuestion) {
        throw new Error('사용자 canonical 문제가 필요합니다.')
      }
      const ownedResponse = await submitCanonicalSession(
        owned.payload.session.id,
        crypto.randomUUID(),
        {
          answers: [
            toAnswer(ownedQuestion, getCorrectOptionId(ownedQuestion), 3)
          ],
          durationSec: 3
        },
        `${MOCK_GUEST_PRINCIPAL_COOKIE_NAME}=tampered`
      )
      const ownedResult = submitStudySessionResponseSchema.parse(
        await ownedResponse.json()
      )
      expect(ownedResponse.status).toBe(201)
      expect(ownedResponse.headers.get('Set-Cookie')).toBeNull()
      expect(ownedResult.correctCount).toBe(1)
      expect(mockDatabase.getCanonicalReviewEventRecords()).toHaveLength(0)

      await logoutUser()
    }
  )

  it('pinned snapshot으로 채점하고 과거 wrongNoteStatus/result를 후속 전이와 reload 뒤에도 고정한다', async () => {
    await signInUser({
      email: 'user@example.com',
      password: 'Demo-user-2026!'
    })
    const sourceQuestionId = 'n5-vocabulary-01'
    const source = mockDatabase.getAdminQuestion(sourceQuestionId)
    const firstSession = createPinnedUserSession(sourceQuestionId)
    const secondSession = createPinnedUserSession(sourceQuestionId)
    const thirdSession = createPinnedUserSession(sourceQuestionId)
    const firstQuestion = firstSession.questions[0]
    const secondQuestion = secondSession.questions[0]
    const thirdQuestion = thirdSession.questions[0]
    if (!firstQuestion || !secondQuestion || !thirdQuestion) {
      throw new Error('동일 문제를 고정한 세 canonical session이 필요합니다.')
    }
    const pinnedCorrectOptionId = getCorrectOptionId(firstQuestion)
    const pinnedWrongOptionId = getWrongOptionId(firstQuestion)
    const replacementCorrectOption = source.options.find(
      ({ id }) => id !== source.options.find(({ isCorrect }) => isCorrect)?.id
    )
    if (!replacementCorrectOption) {
      throw new Error('현재 문제의 정답을 교체할 보기가 필요합니다.')
    }
    mockDatabase.updateQuestion(source.id, {
      ...toAdminInput(source),
      questionText: `${source.questionText} current 수정`,
      correctOptionId: replacementCorrectOption.id,
      explanationKo: `${source.explanationKo} current 수정`
    })
    mockDatabase.deleteQuestion(source.id)

    const firstIdempotencyKey = crypto.randomUUID()
    const firstResponse = await submitCanonicalSession(
      firstSession.session.id,
      firstIdempotencyKey,
      {
        answers: [toAnswer(firstQuestion, pinnedWrongOptionId, 5)],
        durationSec: 5
      }
    )
    const firstResult = submitStudySessionResponseSchema.parse(
      await firstResponse.json()
    )
    expect(firstResponse.status).toBe(201)
    expect(firstResult.items[0]).toMatchObject({
      selectedOptionId: pinnedWrongOptionId,
      isCorrect: false,
      wrongNoteStatus: 'NEW',
      question: {
        questionText: source.questionText,
        correctOptionId: pinnedCorrectOptionId,
        explanationKo: source.explanationKo
      }
    })
    expect(mockDatabase.getCanonicalReviewEventRecords()).toHaveLength(1)

    const firstReplayResponse = await submitCanonicalSession(
      firstSession.session.id,
      firstIdempotencyKey,
      {
        answers: [toAnswer(firstQuestion, pinnedWrongOptionId, 5)],
        durationSec: 5
      }
    )
    expect(firstReplayResponse.status).toBe(201)
    expect(firstReplayResponse.headers.get('Idempotency-Replayed')).toBe('true')
    expect(mockDatabase.getCanonicalReviewEventRecords()).toHaveLength(1)

    const secondResponse = await submitCanonicalSession(
      secondSession.session.id,
      crypto.randomUUID(),
      {
        answers: [toAnswer(secondQuestion, pinnedWrongOptionId, 6)],
        durationSec: 6
      }
    )
    const secondResult = submitStudySessionResponseSchema.parse(
      await secondResponse.json()
    )
    expect(secondResponse.status).toBe(201)
    expect(secondResult.items[0]).toMatchObject({
      isCorrect: false,
      wrongNoteStatus: 'AGAIN',
      question: {
        questionText: source.questionText,
        correctOptionId: pinnedCorrectOptionId
      }
    })

    const thirdResponse = await submitCanonicalSession(
      thirdSession.session.id,
      crypto.randomUUID(),
      {
        answers: [toAnswer(thirdQuestion, pinnedCorrectOptionId, 7)],
        durationSec: 7
      }
    )
    const thirdResult = submitStudySessionResponseSchema.parse(
      await thirdResponse.json()
    )
    expect(thirdResponse.status).toBe(201)
    expect(thirdResult.items[0]).toMatchObject({
      isCorrect: true,
      wrongNoteStatus: 'REVIEWING',
      question: {
        questionText: source.questionText,
        correctOptionId: pinnedCorrectOptionId
      }
    })

    const firstGetResponse = await getCanonicalResult(firstSession.session.id)
    const firstHistorical = getStudyResultResponseSchema.parse(
      await firstGetResponse.json()
    )
    expect(firstHistorical).toEqual(firstResult)
    expect(firstHistorical.items[0]?.wrongNoteStatus).toBe('NEW')

    const events = mockDatabase.getCanonicalReviewEventRecords()
    expect(
      events.map(
        ({
          isCorrect,
          previousStatus,
          nextStatus,
          previousCorrectStreak,
          nextCorrectStreak,
          previousWrongCount,
          wrongCountAfter
        }) => ({
          isCorrect,
          previousStatus,
          nextStatus,
          previousCorrectStreak,
          nextCorrectStreak,
          previousWrongCount,
          wrongCountAfter
        })
      )
    ).toEqual([
      {
        isCorrect: false,
        previousStatus: null,
        nextStatus: 'NEW',
        previousCorrectStreak: null,
        nextCorrectStreak: 0,
        previousWrongCount: null,
        wrongCountAfter: 1
      },
      {
        isCorrect: false,
        previousStatus: 'NEW',
        nextStatus: 'AGAIN',
        previousCorrectStreak: 0,
        nextCorrectStreak: 0,
        previousWrongCount: 1,
        wrongCountAfter: 2
      },
      {
        isCorrect: true,
        previousStatus: 'AGAIN',
        nextStatus: 'REVIEWING',
        previousCorrectStreak: 0,
        nextCorrectStreak: 1,
        previousWrongCount: 2,
        wrongCountAfter: 2
      }
    ])
    const answerIds = new Set(
      [firstSession, secondSession, thirdSession].flatMap(({ session }) =>
        mockDatabase
          .getCanonicalStudyAnswerRecords(session.id)
          .map(({ id }) => id)
      )
    )
    expect(events).toHaveLength(3)
    expect(new Set(events.map(({ studyAnswerId }) => studyAnswerId))).toEqual(
      answerIds
    )
    expect(events.every(({ source }) => source === 'STUDY_SUBMIT')).toBe(true)
    expect(Date.parse(events[1]?.occurredAt ?? '')).toBeGreaterThan(
      Date.parse(events[0]?.occurredAt ?? '')
    )
    expect(Date.parse(events[2]?.occurredAt ?? '')).toBeGreaterThan(
      Date.parse(events[1]?.occurredAt ?? '')
    )

    const noOpDelete = await fetch(DELETE_GUEST_URL, { method: 'DELETE' })
    expect(noOpDelete.status).toBe(204)
    expect(noOpDelete.headers.get('Set-Cookie')).toBeNull()
    expect(mockDatabase.getCanonicalReviewEventRecords()).toEqual(events)

    const restored = new MockDatabase({ listenToStorage: false })
    try {
      expect(
        restored.getCanonicalStudyResult(firstSession.session.id, null)
      ).toEqual(firstResult)
      expect(
        restored.getCanonicalStudyResult(secondSession.session.id, null)
      ).toEqual(secondResult)
      expect(
        restored.getCanonicalStudyResult(thirdSession.session.id, null)
      ).toEqual(thirdResult)
      expect(
        restored.getCanonicalStudyAnswerRecords(firstSession.session.id)
      ).toHaveLength(1)
      expect(restored.getCanonicalIdempotencyRecords()).toHaveLength(3)
      expect(restored.getCanonicalReviewEventRecords()).toEqual(events)
    } finally {
      restored.dispose()
    }

    await logoutUser()
  })

  it('guest principal DELETE가 canonical answer/result/idempotency까지 cascade하고 stale proof를 401로 만든다', async () => {
    const created = await createCanonicalSession({
      level: 'N5',
      subject: 'READING',
      mode: 'RANDOM',
      count: 1
    })
    const cookie = requireGuestCookie(created.cookie)
    const question = created.payload.questions[0]
    if (!question) {
      throw new Error('guest canonical 문제가 필요합니다.')
    }
    const submittedResponse = await submitCanonicalSession(
      created.payload.session.id,
      crypto.randomUUID(),
      {
        answers: [toAnswer(question, getWrongOptionId(question), 4)],
        durationSec: 4
      },
      cookie
    )
    expect(submittedResponse.status).toBe(201)
    expect(
      mockDatabase.getCanonicalStudyAnswerRecords(created.payload.session.id)
    ).toHaveLength(1)
    expect(
      mockDatabase.hasCanonicalStudyResultRecord(created.payload.session.id)
    ).toBe(true)
    expect(mockDatabase.getCanonicalIdempotencyRecords()).toHaveLength(1)

    const deleted = await fetch(DELETE_GUEST_URL, {
      method: 'DELETE',
      credentials: 'omit',
      headers: { Cookie: cookie }
    })
    expect(deleted.status).toBe(204)
    expect(deleted.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect(
      mockDatabase.getCanonicalStudyAnswerRecords(created.payload.session.id)
    ).toHaveLength(0)
    expect(
      mockDatabase.hasCanonicalStudyResultRecord(created.payload.session.id)
    ).toBe(false)
    expect(mockDatabase.getCanonicalIdempotencyRecords()).toHaveLength(0)

    const staleResponse = await getCanonicalResult(
      created.payload.session.id,
      cookie
    )
    const stale = getStudyResultErrorSchema.parse(await staleResponse.json())
    expect(staleResponse.status).toBe(401)
    expect(stale.code).toBe('GUEST_SESSION_EXPIRED')

    const restored = new MockDatabase({ listenToStorage: false })
    try {
      expect(
        restored.getCanonicalStudyAnswerRecords(created.payload.session.id)
      ).toHaveLength(0)
      expect(
        restored.hasCanonicalStudyResultRecord(created.payload.session.id)
      ).toBe(false)
      expect(restored.getCanonicalIdempotencyRecords()).toHaveLength(0)
    } finally {
      restored.dispose()
    }
  })

  it('same key를 principal별 격리하고 auth DELETE no-op·guest DELETE cascade 범위를 지킨다', async () => {
    const sharedIdempotencyKey = crypto.randomUUID()
    const guestA = await createCanonicalSession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const guestACookie = requireGuestCookie(guestA.cookie)
    const guestAQuestion = guestA.payload.questions[0]
    if (!guestAQuestion) {
      throw new Error('guest A canonical 문제가 필요합니다.')
    }
    const guestAResponse = await submitCanonicalSession(
      guestA.payload.session.id,
      sharedIdempotencyKey,
      {
        answers: [
          toAnswer(guestAQuestion, getWrongOptionId(guestAQuestion), 3)
        ],
        durationSec: 3
      },
      guestACookie
    )
    expect(guestAResponse.status).toBe(201)

    await clearMockGuestPrincipalCookie()
    const guestB = await createCanonicalSession({
      level: 'N5',
      subject: 'GRAMMAR',
      mode: 'RANDOM',
      count: 1
    })
    const guestBCookie = requireGuestCookie(guestB.cookie)
    const guestBQuestion = guestB.payload.questions[0]
    if (!guestBQuestion) {
      throw new Error('guest B canonical 문제가 필요합니다.')
    }
    const guestBResponse = await submitCanonicalSession(
      guestB.payload.session.id,
      sharedIdempotencyKey,
      {
        answers: [
          toAnswer(guestBQuestion, getCorrectOptionId(guestBQuestion), 4)
        ],
        durationSec: 4
      },
      guestBCookie
    )
    expect(guestBResponse.status).toBe(201)
    await clearMockGuestPrincipalCookie()

    await signInUser({
      email: 'user@example.com',
      password: 'Demo-user-2026!'
    })
    const userSession = await createCanonicalSession({
      level: 'N5',
      subject: 'READING',
      mode: 'RANDOM',
      count: 1
    })
    const userQuestion = userSession.payload.questions[0]
    if (!userQuestion) {
      throw new Error('USER canonical 문제가 필요합니다.')
    }
    const userResponse = await submitCanonicalSession(
      userSession.payload.session.id,
      sharedIdempotencyKey,
      {
        answers: [toAnswer(userQuestion, getWrongOptionId(userQuestion), 5)],
        durationSec: 5
      }
    )
    expect(userResponse.status).toBe(201)
    await logoutUser()

    const preservedSessionIds = [
      guestA.payload.session.id,
      guestB.payload.session.id,
      userSession.payload.session.id
    ]
    const expectAllPrincipalFacts = (): void => {
      expect(
        mockDatabase.getCanonicalStudyAnswerRecords(guestA.payload.session.id)
      ).toHaveLength(1)
      expect(
        mockDatabase.hasCanonicalStudyResultRecord(guestA.payload.session.id)
      ).toBe(true)
      expect(
        mockDatabase.getCanonicalStudyAnswerRecords(guestB.payload.session.id)
      ).toHaveLength(1)
      expect(
        mockDatabase.hasCanonicalStudyResultRecord(guestB.payload.session.id)
      ).toBe(true)
      expect(
        mockDatabase.getCanonicalStudyAnswerRecords(
          userSession.payload.session.id
        )
      ).toHaveLength(1)
      expect(
        mockDatabase.hasCanonicalStudyResultRecord(
          userSession.payload.session.id
        )
      ).toBe(true)
      const idempotencyRecords = mockDatabase.getCanonicalIdempotencyRecords()
      expect(
        idempotencyRecords.map(({ sessionId }) => sessionId).toSorted()
      ).toEqual(preservedSessionIds.toSorted())
      expect(
        idempotencyRecords.every(
          ({ idempotencyKey }) => idempotencyKey === sharedIdempotencyKey
        )
      ).toBe(true)
      expect(
        new Set(idempotencyRecords.map(({ principalId }) => principalId)).size
      ).toBe(3)
      expect(mockDatabase.getCanonicalReviewEventRecords()).toHaveLength(1)
    }

    for (const credentials of [
      { email: 'user@example.com', password: 'Demo-user-2026!' },
      { email: 'admin@example.com', password: 'Demo-admin-2026!' }
    ]) {
      await signInUser(credentials)
      const noOpDelete = await fetch(DELETE_GUEST_URL, {
        method: 'DELETE',
        credentials: 'omit',
        headers: { Cookie: guestACookie }
      })
      expect(noOpDelete.status).toBe(204)
      expect(noOpDelete.headers.get('Set-Cookie')).toBeNull()
      expectAllPrincipalFacts()
      await logoutUser()
    }

    const deleteGuestA = await fetch(DELETE_GUEST_URL, {
      method: 'DELETE',
      credentials: 'omit',
      headers: { Cookie: guestACookie }
    })
    expect(deleteGuestA.status).toBe(204)
    expect(deleteGuestA.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect(
      mockDatabase.getCanonicalStudyAnswerRecords(guestA.payload.session.id)
    ).toHaveLength(0)
    expect(
      mockDatabase.hasCanonicalStudyResultRecord(guestA.payload.session.id)
    ).toBe(false)
    expect(
      mockDatabase.getCanonicalStudyAnswerRecords(guestB.payload.session.id)
    ).toHaveLength(1)
    expect(
      mockDatabase.hasCanonicalStudyResultRecord(guestB.payload.session.id)
    ).toBe(true)
    expect(
      mockDatabase.getCanonicalStudyAnswerRecords(
        userSession.payload.session.id
      )
    ).toHaveLength(1)
    expect(
      mockDatabase.hasCanonicalStudyResultRecord(userSession.payload.session.id)
    ).toBe(true)
    expect(
      mockDatabase
        .getCanonicalIdempotencyRecords()
        .map(({ sessionId }) => sessionId)
        .toSorted()
    ).toEqual(
      [guestB.payload.session.id, userSession.payload.session.id].toSorted()
    )
    const preservedEvents = mockDatabase.getCanonicalReviewEventRecords()
    expect(preservedEvents).toHaveLength(1)
    expect(preservedEvents[0]).toMatchObject({
      studySessionId: userSession.payload.session.id,
      nextStatus: 'NEW',
      source: 'STUDY_SUBMIT'
    })

    const guestBResultResponse = await getCanonicalResult(
      guestB.payload.session.id,
      guestBCookie
    )
    expect(guestBResultResponse.status).toBe(200)
    getStudyResultResponseSchema.parse(await guestBResultResponse.json())

    const restored = new MockDatabase({ listenToStorage: false })
    try {
      expect(
        restored.getCanonicalStudyAnswerRecords(guestA.payload.session.id)
      ).toHaveLength(0)
      expect(
        restored.getCanonicalStudyAnswerRecords(guestB.payload.session.id)
      ).toHaveLength(1)
      expect(
        restored.hasCanonicalStudyResultRecord(guestB.payload.session.id)
      ).toBe(true)
      expect(
        restored.getCanonicalStudyAnswerRecords(userSession.payload.session.id)
      ).toHaveLength(1)
      expect(
        restored.hasCanonicalStudyResultRecord(userSession.payload.session.id)
      ).toBe(true)
      expect(
        restored
          .getCanonicalIdempotencyRecords()
          .map(({ sessionId }) => sessionId)
          .toSorted()
      ).toEqual(
        [guestB.payload.session.id, userSession.payload.session.id].toSorted()
      )
      expect(restored.getCanonicalReviewEventRecords()).toEqual(preservedEvents)
    } finally {
      restored.dispose()
    }
  })

  it('canonical guest와 USER session을 legacy get/submit/result에서 차단하고 legacy session은 유지한다', async () => {
    const guestCanonical = await createCanonicalSession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const assertLegacyBlocked = async (sessionId: string): Promise<void> => {
      const responses = await Promise.all([
        fetch(`${LEGACY_URL}/${sessionId}`, { credentials: 'omit' }),
        fetch(`${LEGACY_URL}/${sessionId}/submit`, {
          method: 'POST',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: [], durationSec: 0 })
        }),
        fetch(`${LEGACY_URL}/${sessionId}/result`, { credentials: 'omit' })
      ])
      for (const response of responses) {
        expect(response.status).toBe(404)
        expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' })
      }
    }

    await assertLegacyBlocked(guestCanonical.payload.session.id)
    expect(
      mockDatabase.getCanonicalStudyAnswerRecords(
        guestCanonical.payload.session.id
      )
    ).toHaveLength(0)

    await signInUser({
      email: 'user@example.com',
      password: 'Demo-user-2026!'
    })
    const userCanonical = await createCanonicalSession({
      level: 'N5',
      subject: 'GRAMMAR',
      mode: 'RANDOM',
      count: 1
    })
    await assertLegacyBlocked(userCanonical.payload.session.id)
    expect(
      mockDatabase.getCanonicalStudyAnswerRecords(
        userCanonical.payload.session.id
      )
    ).toHaveLength(0)

    const legacyCreateResponse = await fetch(LEGACY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: 'N5',
        subject: 'READING',
        mode: 'RANDOM',
        count: 1
      })
    })
    const legacyPayload = (await legacyCreateResponse.json()) as {
      session: { id: string }
      questions: unknown[]
      actualCount: number
    }
    expect(legacyCreateResponse.status).toBe(200)
    expect(legacyPayload.actualCount).toBe(1)
    expect(legacyPayload.questions).toHaveLength(1)

    const legacyGetResponse = await fetch(
      `${LEGACY_URL}/${legacyPayload.session.id}`
    )
    expect(legacyGetResponse.status).toBe(200)
    expect(await legacyGetResponse.json()).toMatchObject({
      session: { id: legacyPayload.session.id },
      actualCount: 1
    })

    await logoutUser()
  })

  it('strict success/error headers에서 internal persistence field를 노출하지 않는다', async () => {
    const created = await createCanonicalSession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const cookie = requireGuestCookie(created.cookie)
    const question = created.payload.questions[0]
    if (!question) {
      throw new Error('canonical 문제가 필요합니다.')
    }
    const response = await submitCanonicalSession(
      created.payload.session.id,
      crypto.randomUUID(),
      {
        answers: [toAnswer(question, getCorrectOptionId(question), 2)],
        durationSec: 2
      },
      cookie
    )
    const text = await response.text()
    const parsed = submitStudySessionResponseSchema.parse(JSON.parse(text))
    expect(response.status).toBe(201)
    expectCanonicalHeaders(response)
    expect(parsed.correctCount).toBe(1)
    for (const forbidden of [
      'sourceQuestionId',
      'requestMaterial',
      'principalId',
      'userId',
      'responseStatus'
    ]) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('persistence 실패와 strict response 위반을 safe 500으로 정규화해 내부 값을 숨긴다', async () => {
    const created = await createCanonicalSession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const cookie = requireGuestCookie(created.cookie)
    const question = created.payload.questions[0]
    if (!question) {
      throw new Error('safe 500 검증용 canonical 문제가 필요합니다.')
    }
    const body: SubmitStudySessionBody = {
      answers: [toAnswer(question, getCorrectOptionId(question), 2)],
      durationSec: 2
    }
    const secret = 'do-not-leak-persistence-secret'
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const submitSpy = vi
      .spyOn(mockDatabase, 'submitCanonicalStudySession')
      .mockImplementationOnce(() => {
        throw new MockDatabaseError('PERSISTENCE_FAILED', 500, secret)
      })

    const failedResponse = await submitCanonicalSession(
      created.payload.session.id,
      crypto.randomUUID(),
      body,
      cookie
    )
    const failedText = await failedResponse.text()
    const failed = submitStudySessionErrorSchema.parse(JSON.parse(failedText))
    expect(failedResponse.status).toBe(500)
    expect(failed).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      retryable: true
    })
    expect(failedText).not.toContain(secret)
    expect(failedResponse.headers.get('Set-Cookie')).toBeNull()
    expectCanonicalHeaders(failedResponse)
    expect(failedResponse.headers.get('X-Request-Id')).toBe(failed.requestId)
    expect(
      mockDatabase.getCanonicalStudyAnswerRecords(created.payload.session.id)
    ).toHaveLength(0)
    expect(mockDatabase.getCanonicalIdempotencyRecords()).toHaveLength(0)
    submitSpy.mockRestore()

    const successResponse = await submitCanonicalSession(
      created.payload.session.id,
      crypto.randomUUID(),
      body,
      cookie
    )
    const success = submitStudySessionResponseSchema.parse(
      await successResponse.json()
    )
    expect(successResponse.status).toBe(201)

    const second = await createCanonicalSession(
      {
        level: 'N5',
        subject: 'GRAMMAR',
        mode: 'RANDOM',
        count: 1
      },
      cookie
    )
    vi.spyOn(mockDatabase, 'submitCanonicalStudySession').mockReturnValueOnce({
      replayed: false,
      response: { ...success, internalSecret: secret } as typeof success
    })
    const secondQuestion = second.payload.questions[0]
    if (!secondQuestion) {
      throw new Error('strict response 검증용 canonical 문제가 필요합니다.')
    }
    const strictResponse = await submitCanonicalSession(
      second.payload.session.id,
      crypto.randomUUID(),
      {
        answers: [
          toAnswer(secondQuestion, getCorrectOptionId(secondQuestion), 2)
        ],
        durationSec: 2
      },
      cookie
    )
    const strictText = await strictResponse.text()
    const strictFailure = submitStudySessionErrorSchema.parse(
      JSON.parse(strictText)
    )
    expect(strictResponse.status).toBe(500)
    expect(strictFailure.code).toBe('INTERNAL_SERVER_ERROR')
    expect(strictText).not.toContain(secret)
    expect(strictResponse.headers.get('Set-Cookie')).toBeNull()
    expectCanonicalHeaders(strictResponse)
    expect(strictResponse.headers.get('X-Request-Id')).toBe(
      strictFailure.requestId
    )
    expect(
      mockDatabase.getCanonicalStudyAnswerRecords(second.payload.session.id)
    ).toHaveLength(0)
    expect(consoleError).toHaveBeenCalled()
  })
})
