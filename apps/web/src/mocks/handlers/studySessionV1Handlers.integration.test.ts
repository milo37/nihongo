import {
  createStudySessionErrorSchema,
  createStudySessionResponseSchema,
  type CreateStudySessionBody,
  type CreateStudySessionResponse
} from '@nihongo/contracts/study/create-study-session'
import {
  getStudySessionErrorSchema,
  getStudySessionResponseSchema
} from '@nihongo/contracts/study/get-study-session'
import { describe, expect, it } from 'vitest'
import { logoutUser } from '@api/auth/logoutUser'
import { signInUser } from '@api/auth/signInUser'
import { createStudySession } from '@api/study/createStudySession'
import {
  getSourceQuestionId,
  toStableMockUuid
} from '@mocks/adapters/questionContractAdapter'
import { toContractStudySessionPayload } from '@mocks/adapters/studySessionContractAdapter'
import { MOCK_GUEST_PRINCIPAL_COOKIE_NAME } from '@mocks/guestPrincipal'
import { hasTrustedMockWriteOrigin } from '@mocks/handlers/shared'
import {
  MockDatabase,
  mockDatabase,
  type AdminQuestionInput
} from '@mocks/repository/mockDatabase'
import { clearMockGuestPrincipalCookie } from '@/test/server'

const CREATE_URL = 'http://localhost/api/v1/study-sessions'
const DELETE_GUEST_URL = 'http://localhost/api/v1/guest-principal'
const TRUSTED_WRITE_HEADERS = { Origin: 'http://localhost' }
const FORBIDDEN_KEYS = new Set([
  'userId',
  'guestPrincipalId',
  'questionIds',
  'correctOptionId',
  'isCorrect',
  'explanationKo',
  'explanationJa',
  'sourceType',
  'createdByUserId',
  'createdAt',
  'updatedAt'
])

const collectKeys = (value: unknown, keys: Set<string>): void => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys))
    return
  }

  if (typeof value !== 'object' || value === null) {
    return
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    keys.add(key)
    collectKeys(nestedValue, keys)
  }
}

const postCanonicalSession = async (
  body: CreateStudySessionBody,
  cookie?: string
): Promise<{
  guestCookie: string | null
  response: Response
  payload: CreateStudySessionResponse
}> => {
  const response = await fetch(CREATE_URL, {
    method: 'POST',
    headers: {
      ...TRUSTED_WRITE_HEADERS,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  })
  const payload = createStudySessionResponseSchema.parse(await response.json())
  const guestCookie =
    response.headers.get('Set-Cookie')?.split(';', 1)[0] ?? null

  return { guestCookie, response, payload }
}

const getCanonicalSession = async (
  sessionId: string,
  cookie?: string
): Promise<{ response: Response; payload: CreateStudySessionResponse }> => {
  const response = await fetch(`${CREATE_URL}/${sessionId}`, {
    headers: cookie ? { Cookie: cookie } : undefined
  })
  const payload = getStudySessionResponseSchema.parse(await response.json())

  return { response, payload }
}

const requireGuestCookie = (cookie: string | null): string => {
  if (!cookie?.startsWith(`${MOCK_GUEST_PRINCIPAL_COOKIE_NAME}=`)) {
    throw new Error('canonical guest cookie가 필요합니다.')
  }
  return cookie
}

const getGuestPrincipalId = (cookie: string): string =>
  cookie.slice(MOCK_GUEST_PRINCIPAL_COOKIE_NAME.length + 1)

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

describe('canonical study session v1 MSW integration', () => {
  it('RANDOM shortage를 fallback 없이 201로 반환하고 GET과 공개 shape가 일치한다', async () => {
    const created = await postCanonicalSession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 20
    })

    expect(created.response.status).toBe(201)
    expectCanonicalHeaders(created.response)
    const guestCookie = requireGuestCookie(created.guestCookie)
    expect(created.response.headers.get('Set-Cookie')).toContain('SameSite=Lax')
    expect(created.response.headers.get('Set-Cookie')).not.toContain('HttpOnly')
    expect(created.payload.session).toMatchObject({
      requestedCount: 20,
      actualCount: 5,
      usedFallback: false,
      fallbackReason: null
    })
    expect(created.payload.questions).toHaveLength(5)

    const keys = new Set<string>()
    collectKeys(created.payload, keys)
    for (const key of FORBIDDEN_KEYS) {
      expect(keys.has(key)).toBe(false)
    }

    const fetched = await getCanonicalSession(
      created.payload.session.id,
      guestCookie
    )

    expect(fetched.response.status).toBe(200)
    expectCanonicalHeaders(fetched.response)
    expect(fetched.payload).toEqual(created.payload)
  })

  it('세션 생성 당시 full question snapshot을 수정·삭제 뒤에도 고정한다', async () => {
    const createdResult = await postCanonicalSession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const created = createdResult.payload
    const guestCookie = requireGuestCookie(createdResult.guestCookie)
    const contractQuestionId = created.questions[0]?.question.id

    if (!contractQuestionId) {
      throw new Error('테스트 세션에 문제가 필요합니다.')
    }

    const sourceQuestionId = getSourceQuestionId(
      contractQuestionId,
      mockDatabase.listAdminQuestions({ pageSize: 100 }).items
    )

    if (!sourceQuestionId) {
      throw new Error('contract 문제에 대응하는 source 문제가 필요합니다.')
    }

    const source = mockDatabase.getAdminQuestion(sourceQuestionId)
    mockDatabase.updateQuestion(source.id, {
      ...toAdminInput(source),
      questionText: `${source.questionText} 수정`,
      explanationKo: `${source.explanationKo} 수정`
    })
    mockDatabase.deleteQuestion(source.id)

    const { payload: fetched } = await getCanonicalSession(
      created.session.id,
      guestCookie
    )

    expect(fetched).toEqual(created)
  })

  it('persisted full snapshot을 새 MockDatabase 인스턴스에서 동일하게 복구한다', async () => {
    const createdResult = await postCanonicalSession({
      level: 'N5',
      subject: 'GRAMMAR',
      mode: 'RANDOM',
      count: 3
    })
    const created = createdResult.payload
    const guestCookie = requireGuestCookie(createdResult.guestCookie)
    const restored = new MockDatabase({ listenToStorage: false })

    try {
      const restoredPayload = toContractStudySessionPayload(
        restored.getCanonicalStudySessionSnapshotRecord(
          created.session.id,
          getGuestPrincipalId(guestCookie)
        )
      )

      expect(restoredPayload).toEqual(created)
    } finally {
      restored.dispose()
    }
  })

  it('guest proof 없음·변조·cross-guest를 401/404로 분리한다', async () => {
    const missingUnknownProof = await fetch(
      `${CREATE_URL}/${crypto.randomUUID()}`,
      { credentials: 'omit' }
    )
    const missingUnknownError = getStudySessionErrorSchema.parse(
      await missingUnknownProof.json()
    )
    expect(missingUnknownProof.status).toBe(401)
    expect(missingUnknownError.code).toBe('AUTHENTICATION_REQUIRED')

    const guestA = await postCanonicalSession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    await clearMockGuestPrincipalCookie()
    const guestB = await postCanonicalSession({
      level: 'N5',
      subject: 'GRAMMAR',
      mode: 'RANDOM',
      count: 1
    })
    const guestACookie = requireGuestCookie(guestA.guestCookie)
    const guestBCookie = requireGuestCookie(guestB.guestCookie)
    await clearMockGuestPrincipalCookie()

    const missingProof = await fetch(
      `${CREATE_URL}/${guestA.payload.session.id}`,
      { credentials: 'omit' }
    )
    const missingError = getStudySessionErrorSchema.parse(
      await missingProof.json()
    )
    expect(missingProof.status).toBe(401)
    expect(missingError.code).toBe('AUTHENTICATION_REQUIRED')

    const invalidProof = await fetch(
      `${CREATE_URL}/${guestA.payload.session.id}`,
      {
        headers: {
          Cookie: `${MOCK_GUEST_PRINCIPAL_COOKIE_NAME}=tampered`
        }
      }
    )
    const invalidError = getStudySessionErrorSchema.parse(
      await invalidProof.json()
    )
    expect(invalidProof.status).toBe(401)
    expect(invalidError.code).toBe('GUEST_SESSION_EXPIRED')

    const foreignProof = await fetch(
      `${CREATE_URL}/${guestA.payload.session.id}`,
      { headers: { Cookie: guestBCookie } }
    )
    const foreignError = getStudySessionErrorSchema.parse(
      await foreignProof.json()
    )
    expect(foreignProof.status).toBe(404)
    expect(foreignError.code).toBe('RESOURCE_NOT_FOUND')

    const own = await getCanonicalSession(
      guestA.payload.session.id,
      guestACookie
    )
    expect(own.response.status).toBe(200)
    expect(own.payload).toEqual(guestA.payload)

    const repeated = await postCanonicalSession(
      {
        level: 'N5',
        subject: 'READING',
        mode: 'RANDOM',
        count: 1
      },
      guestACookie
    )
    expect(repeated.response.status).toBe(201)
    expect(repeated.guestCookie).toBeNull()
  })

  it('guest와 로그인 principal 사이의 세션 소유권을 fail closed로 정규화한다', async () => {
    const guestSessionResult = await postCanonicalSession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const guestSession = guestSessionResult.payload
    const guestCookie = requireGuestCookie(guestSessionResult.guestCookie)

    await signInUser({
      email: 'user@example.com',
      password: 'Demo-user-2026!'
    })

    const guestAsUser = await fetch(`${CREATE_URL}/${guestSession.session.id}`)
    const guestAsUserError = getStudySessionErrorSchema.parse(
      await guestAsUser.json()
    )

    expect(guestAsUser.status).toBe(404)
    expect(guestAsUserError.code).toBe('RESOURCE_NOT_FOUND')

    const { payload: userSession } = await postCanonicalSession({
      level: 'N5',
      subject: 'GRAMMAR',
      mode: 'RANDOM',
      count: 1
    })

    await signInUser({
      email: 'admin@example.com',
      password: 'Demo-admin-2026!'
    })

    const userAsAdmin = await fetch(`${CREATE_URL}/${userSession.session.id}`)
    const userAsAdminError = getStudySessionErrorSchema.parse(
      await userAsAdmin.json()
    )

    expect(userAsAdmin.status).toBe(404)
    expect(userAsAdminError.code).toBe('RESOURCE_NOT_FOUND')

    await logoutUser()
    const userAsProvenGuest = await fetch(
      `${CREATE_URL}/${userSession.session.id}`,
      { headers: { Cookie: guestCookie } }
    )
    const userAsProvenGuestError = getStudySessionErrorSchema.parse(
      await userAsProvenGuest.json()
    )

    expect(userAsProvenGuest.status).toBe(404)
    expect(userAsProvenGuestError.code).toBe('RESOURCE_NOT_FOUND')

    await clearMockGuestPrincipalCookie()
    const userAsGuest = await fetch(`${CREATE_URL}/${userSession.session.id}`, {
      credentials: 'omit'
    })
    const userAsGuestError = getStudySessionErrorSchema.parse(
      await userAsGuest.json()
    )

    expect(userAsGuest.status).toBe(401)
    expect(userAsGuestError.code).toBe('AUTHENTICATION_REQUIRED')
  })

  it('create JSON object·16KiB·same-origin 경계를 real API와 맞춘다', async () => {
    expect(
      hasTrustedMockWriteOrigin(
        new Request(CREATE_URL, {
          method: 'POST',
          referrer: 'http://localhost/practice'
        })
      )
    ).toBe(true)
    expect(
      hasTrustedMockWriteOrigin(
        new Request(CREATE_URL, {
          method: 'POST',
          referrer: 'https://attacker.example/practice'
        })
      )
    ).toBe(false)

    const rawCases = [
      { body: '[]', expectedCode: 'INVALID_JSON', expectedStatus: 400 },
      { body: 'null', expectedCode: 'INVALID_JSON', expectedStatus: 400 },
      {
        body: `${' '.repeat(16 * 1_024)}${JSON.stringify({
          level: 'N5',
          subject: 'VOCABULARY',
          mode: 'RANDOM',
          count: 1
        })}`,
        expectedCode: 'INVALID_REQUEST',
        expectedStatus: 400
      }
    ] as const

    for (const testCase of rawCases) {
      const response = await fetch(CREATE_URL, {
        method: 'POST',
        headers: {
          ...TRUSTED_WRITE_HEADERS,
          'Content-Type': 'application/json'
        },
        body: testCase.body
      })
      const error = createStudySessionErrorSchema.parse(await response.json())
      expect(response.status).toBe(testCase.expectedStatus)
      expect(error.code).toBe(testCase.expectedCode)
    }

    const missingOrigin = await fetch(CREATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1
      })
    })
    expect(missingOrigin.status).toBe(403)
    expect(
      createStudySessionErrorSchema.parse(await missingOrigin.json()).code
    ).toBe('UNTRUSTED_ORIGIN')
  })

  it.each(['WRONG_NOTE', 'WEAKNESS', 'BOOKMARK'] as const)(
    '%s 모드를 canonical 422로 거부한다',
    async (mode) => {
      const response = await fetch(CREATE_URL, {
        method: 'POST',
        headers: {
          ...TRUSTED_WRITE_HEADERS,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          level: 'N5',
          subject: 'VOCABULARY',
          mode,
          count: 1
        })
      })
      const error = createStudySessionErrorSchema.parse(await response.json())

      expect(response.status).toBe(422)
      expectCanonicalHeaders(response)
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.fieldErrors).toHaveProperty('mode')
    }
  )

  it('explicitQuestionIds를 canonical 422로 거부한다', async () => {
    const response = await fetch(CREATE_URL, {
      method: 'POST',
      headers: {
        ...TRUSTED_WRITE_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1,
        explicitQuestionIds: [toStableMockUuid('question', 'n5-vocabulary-01')]
      })
    })
    const error = createStudySessionErrorSchema.parse(await response.json())

    expect(response.status).toBe(422)
    expectCanonicalHeaders(response)
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.fieldErrors).toBeUndefined()
  })

  it('출제 가능한 문제가 없으면 canonical NO_ELIGIBLE_QUESTIONS로 정규화한다', async () => {
    const readingQuestions = mockDatabase.listAdminQuestions({
      level: 'N5',
      subject: 'READING',
      pageSize: 100
    }).items

    for (const summary of readingQuestions) {
      const source = mockDatabase.getAdminQuestion(summary.id)
      mockDatabase.updateQuestion(source.id, {
        ...toAdminInput(source),
        status: 'DRAFT'
      })
    }

    const response = await fetch(CREATE_URL, {
      method: 'POST',
      headers: {
        ...TRUSTED_WRITE_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        level: 'N5',
        subject: 'READING',
        mode: 'RANDOM',
        count: 1
      })
    })
    const error = createStudySessionErrorSchema.parse(await response.json())

    expect(response.status).toBe(404)
    expectCanonicalHeaders(response)
    expect(error.code).toBe('NO_ELIGIBLE_QUESTIONS')
  })

  it('guest principal 삭제는 자기 canonical session만 지우고 stale proof를 401로 만든다', async () => {
    const legacy = await createStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const guestA = await postCanonicalSession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const guestACookie = requireGuestCookie(guestA.guestCookie)
    const guestAId = getGuestPrincipalId(guestACookie)

    await clearMockGuestPrincipalCookie()
    const guestB = await postCanonicalSession({
      level: 'N5',
      subject: 'GRAMMAR',
      mode: 'RANDOM',
      count: 1
    })
    const guestBCookie = requireGuestCookie(guestB.guestCookie)
    const guestBId = getGuestPrincipalId(guestBCookie)
    await clearMockGuestPrincipalCookie()

    const deleted = await fetch(DELETE_GUEST_URL, {
      method: 'DELETE',
      headers: { Cookie: guestACookie }
    })

    expect(deleted.status).toBe(204)
    expect(deleted.headers.get('Set-Cookie')).toBe(
      `${MOCK_GUEST_PRINCIPAL_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0`
    )
    expect(document.cookie).not.toContain(
      `${MOCK_GUEST_PRINCIPAL_COOKIE_NAME}=`
    )
    expect(mockDatabase.isCanonicalGuestPrincipalActive(guestAId)).toBe(false)
    expect(mockDatabase.isCanonicalGuestPrincipalActive(guestBId)).toBe(true)
    expect(() =>
      mockDatabase.getStudySession(guestA.payload.session.id)
    ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }))
    expect(mockDatabase.getStudySession(legacy.session.id)).toEqual(
      legacy.session
    )

    const withoutProof = await fetch(
      `${CREATE_URL}/${guestA.payload.session.id}`,
      { credentials: 'omit' }
    )
    const withoutProofError = getStudySessionErrorSchema.parse(
      await withoutProof.json()
    )
    expect(withoutProof.status).toBe(401)
    expect(withoutProofError.code).toBe('AUTHENTICATION_REQUIRED')

    const withStaleProof = await fetch(
      `${CREATE_URL}/${guestA.payload.session.id}`,
      { headers: { Cookie: guestACookie } }
    )
    const staleProofError = getStudySessionErrorSchema.parse(
      await withStaleProof.json()
    )
    expect(withStaleProof.status).toBe(401)
    expect(staleProofError.code).toBe('GUEST_SESSION_EXPIRED')

    const preservedGuestB = await getCanonicalSession(
      guestB.payload.session.id,
      guestBCookie
    )
    expect(preservedGuestB.response.status).toBe(200)
    expect(preservedGuestB.payload).toEqual(guestB.payload)

    for (const cookie of [
      undefined,
      `${MOCK_GUEST_PRINCIPAL_COOKIE_NAME}=tampered`
    ]) {
      await clearMockGuestPrincipalCookie()
      const idempotentDelete = await fetch(DELETE_GUEST_URL, {
        method: 'DELETE',
        credentials: 'omit',
        headers: cookie ? { Cookie: cookie } : undefined
      })
      expect(idempotentDelete.status).toBe(204)
      expect(idempotentDelete.headers.get('Set-Cookie')).toContain('Max-Age=0')
    }

    const stillPreservedGuestB = await getCanonicalSession(
      guestB.payload.session.id,
      guestBCookie
    )
    expect(stillPreservedGuestB.response.status).toBe(200)

    const rotated = await postCanonicalSession(
      {
        level: 'N5',
        subject: 'READING',
        mode: 'RANDOM',
        count: 1
      },
      guestACookie
    )
    const rotatedCookie = requireGuestCookie(rotated.guestCookie)
    expect(rotatedCookie).not.toBe(guestACookie)
    expect(
      mockDatabase.isCanonicalGuestPrincipalActive(
        getGuestPrincipalId(rotatedCookie)
      )
    ).toBe(true)
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
    '$role의 guest marker 삭제 요청은 marker와 session을 보존한다',
    async ({ email, password }) => {
      const guest = await postCanonicalSession({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1
      })
      const guestCookie = requireGuestCookie(guest.guestCookie)
      const guestId = getGuestPrincipalId(guestCookie)
      document.cookie = `${guestCookie}; Path=/; SameSite=Lax`
      await signInUser({ email, password })

      const response = await fetch(DELETE_GUEST_URL, {
        method: 'DELETE',
        headers: { Cookie: guestCookie }
      })

      expect(response.status).toBe(204)
      expect(response.headers.get('Set-Cookie')).toBeNull()
      expect(document.cookie).toContain(guestCookie)
      expect(mockDatabase.isCanonicalGuestPrincipalActive(guestId)).toBe(true)

      await logoutUser()
      expect(mockDatabase.getStudySession(guest.payload.session.id).id).toBe(
        guest.payload.session.id
      )
      const preserved = await getCanonicalSession(
        guest.payload.session.id,
        guestCookie
      )
      expect(preserved.response.status).toBe(200)
      expect(preserved.payload).toEqual(guest.payload)
    }
  )

  it('legacy study API의 기존 URL과 응답 시그니처를 유지한다', async () => {
    const legacy = await createStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 2
    })

    expect(legacy.actualCount).toBe(2)
    expect(legacy.questions).toHaveLength(2)
    expect(legacy.session).not.toHaveProperty('actualCount')
    expect(legacy).not.toHaveProperty('fallbackReason')
  })
})
