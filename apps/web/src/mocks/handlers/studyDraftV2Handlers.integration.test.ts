import {
  createStudySessionResponseSchema,
  createStudySessionV2ResponseSchema,
  type CreateStudySessionBody
} from '@nihongo/contracts/study/create-study-session'
import { getStudyDraftAnswersResponseSchema } from '@nihongo/contracts/study/get-study-draft-answers'
import { getStudySessionV2ResponseSchema } from '@nihongo/contracts/study/get-study-session'
import { listResumableStudySessionsResponseSchema } from '@nihongo/contracts/study/list-resumable-study-sessions'
import {
  saveStudyDraftAnswersErrorSchema,
  saveStudyDraftAnswersResponseSchema
} from '@nihongo/contracts/study/save-study-draft-answers'
import {
  submitStudySessionErrorSchema,
  submitStudySessionV2ErrorSchema,
  submitStudySessionV2ResponseSchema
} from '@nihongo/contracts/study/submit-study-session'
import { cancelStudySessionErrorSchema } from '@nihongo/contracts/study/cancel-study-session'
import { describe, expect, it, vi } from 'vitest'
import { MOCK_GUEST_PRINCIPAL_COOKIE_NAME } from '@mocks/guestPrincipal'
import {
  MockDatabase,
  MockDatabaseError,
  mockDatabase
} from '@mocks/repository/mockDatabase'

const BASE_URL = 'http://localhost/api/v1/study-sessions'
const PRACTICE_HEADERS = {
  Origin: 'http://localhost',
  'X-Nihongo-Practice-Contract': '2'
}

const createV2Session = async (
  body: CreateStudySessionBody = {
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    count: 2
  },
  existingCookie?: string
) => {
  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      ...PRACTICE_HEADERS,
      'Content-Type': 'application/json',
      ...(existingCookie ? { Cookie: existingCookie } : {})
    },
    body: JSON.stringify(body)
  })
  const payload = createStudySessionV2ResponseSchema.parse(
    await response.json()
  )
  const cookie =
    response.headers.get('Set-Cookie')?.split(';', 1)[0] ?? existingCookie
  if (!cookie?.startsWith(`${MOCK_GUEST_PRINCIPAL_COOKIE_NAME}=`)) {
    throw new Error('v2 canonical guest cookie가 필요합니다.')
  }
  return { cookie, payload, response }
}

const draftHeaders = (cookie: string, idempotencyKey?: string) => ({
  ...PRACTICE_HEADERS,
  Cookie: cookie,
  ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
})

describe('canonical practice v2 MSW integration', () => {
  it('v2 create와 revision 0 draft/resumable을 원자적으로 만들고 v3/v4를 복구한다', async () => {
    const created = await createV2Session()
    expect(created.response.status).toBe(201)
    expect(created.response.headers.get('X-Nihongo-Practice-Contract')).toBe(
      '2'
    )
    expect(created.payload.session.practiceContractVersion).toBe(2)

    const draftResponse = await fetch(
      `${BASE_URL}/${created.payload.session.id}/draft-answers`,
      { headers: draftHeaders(created.cookie) }
    )
    const draft = getStudyDraftAnswersResponseSchema.parse(
      await draftResponse.json()
    )
    expect(draft).toMatchObject({
      studySessionId: created.payload.session.id,
      revision: 0,
      currentOrdinal: 1,
      savedAt: null
    })
    expect(draft.answers).toHaveLength(created.payload.questions.length)
    expect(
      draft.answers.every(({ selectedOptionId }) => selectedOptionId === null)
    ).toBe(true)

    const listResponse = await fetch(
      `${BASE_URL}?status=IN_PROGRESS&page=1&pageSize=20`,
      { headers: draftHeaders(created.cookie) }
    )
    const list = listResumableStudySessionsResponseSchema.parse(
      await listResponse.json()
    )
    expect(list.items).toEqual([
      expect.objectContaining({
        id: created.payload.session.id,
        practiceContractVersion: 2,
        draftRevision: 0,
        draftSavedAt: null,
        currentOrdinal: 1,
        resumeAvailability: 'SERVER'
      })
    ])

    const restored = new MockDatabase({ listenToStorage: false })
    try {
      expect(
        restored.getCanonicalStudyDraft(
          created.payload.session.id,
          created.cookie.slice(MOCK_GUEST_PRINCIPAL_COOKIE_NAME.length + 1)
        )
      ).toEqual(draft)
    } finally {
      restored.dispose()
    }
  })

  it('response loss형 historical replay와 독립 revision 진행을 보존한다', async () => {
    const created = await createV2Session()
    const draftResponse = await fetch(
      `${BASE_URL}/${created.payload.session.id}/draft-answers`,
      { headers: draftHeaders(created.cookie) }
    )
    const draft = getStudyDraftAnswersResponseSchema.parse(
      await draftResponse.json()
    )
    const firstQuestion = created.payload.questions[0]
    const firstAnswer = draft.answers[0]
    const firstOptionId = firstQuestion?.question.options[0]?.id
    if (!firstAnswer || !firstOptionId) {
      throw new Error('draft save fixture가 필요합니다.')
    }
    const revisionOneBody = {
      expectedRevision: 0,
      currentOrdinal: 2,
      answers: draft.answers.map((answer) =>
        answer.studySessionQuestionId === firstAnswer.studySessionQuestionId
          ? { ...answer, selectedOptionId: firstOptionId, elapsedSec: 7 }
          : answer
      )
    }
    const firstKey = crypto.randomUUID()
    const firstSave = await fetch(
      `${BASE_URL}/${created.payload.session.id}/draft-answers`,
      {
        method: 'PUT',
        headers: {
          ...draftHeaders(created.cookie, firstKey),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(revisionOneBody)
      }
    )
    const revisionOne = saveStudyDraftAnswersResponseSchema.parse(
      await firstSave.json()
    )
    expect(revisionOne.revision).toBe(1)

    const secondKey = crypto.randomUUID()
    const revisionTwoBody = {
      expectedRevision: 1,
      currentOrdinal: 2,
      answers: revisionOne.answers.map((answer) => ({
        ...answer,
        elapsedSec: answer.elapsedSec + 1
      }))
    }
    const secondSave = await fetch(
      `${BASE_URL}/${created.payload.session.id}/draft-answers`,
      {
        method: 'PUT',
        headers: {
          ...draftHeaders(created.cookie, secondKey),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(revisionTwoBody)
      }
    )
    const revisionTwo = saveStudyDraftAnswersResponseSchema.parse(
      await secondSave.json()
    )
    expect(revisionTwo.revision).toBe(2)

    const historicalReplay = await fetch(
      `${BASE_URL}/${created.payload.session.id}/draft-answers`,
      {
        method: 'PUT',
        headers: {
          ...draftHeaders(created.cookie, firstKey),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(revisionOneBody)
      }
    )
    expect(historicalReplay.headers.get('Idempotency-Replayed')).toBe('true')
    expect(
      saveStudyDraftAnswersResponseSchema.parse(await historicalReplay.json())
    ).toEqual(revisionOne)

    const canonicalGet = await fetch(
      `${BASE_URL}/${created.payload.session.id}/draft-answers`,
      { headers: draftHeaders(created.cookie) }
    )
    expect(
      getStudyDraftAnswersResponseSchema.parse(await canonicalGet.json())
    ).toEqual(revisionTwo)

    const stale = await fetch(
      `${BASE_URL}/${created.payload.session.id}/draft-answers`,
      {
        method: 'PUT',
        headers: {
          ...draftHeaders(created.cookie, crypto.randomUUID()),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(revisionOneBody)
      }
    )
    expect(stale.status).toBe(409)
    expect(
      saveStudyDraftAnswersErrorSchema.parse(await stale.json()).code
    ).toBe('DRAFT_VERSION_CONFLICT')
  })

  it('동시 다른 key의 같은 base revision은 한 save만 성공시킨다', async () => {
    const created = await createV2Session()
    const draftResponse = await fetch(
      `${BASE_URL}/${created.payload.session.id}/draft-answers`,
      { headers: draftHeaders(created.cookie) }
    )
    const draft = getStudyDraftAnswersResponseSchema.parse(
      await draftResponse.json()
    )
    const save = (elapsedSec: number) =>
      fetch(`${BASE_URL}/${created.payload.session.id}/draft-answers`, {
        method: 'PUT',
        headers: {
          ...draftHeaders(created.cookie, crypto.randomUUID()),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          expectedRevision: 0,
          currentOrdinal: 1,
          answers: draft.answers.map((answer, index) =>
            index === 0 ? { ...answer, elapsedSec } : answer
          )
        })
      })
    const responses = await Promise.all([save(1), save(2)])
    expect(responses.map(({ status }) => status).toSorted()).toEqual([200, 409])
    const canonical = await fetch(
      `${BASE_URL}/${created.payload.session.id}/draft-answers`,
      { headers: draftHeaders(created.cookie) }
    )
    expect(
      getStudyDraftAnswersResponseSchema.parse(await canonical.json()).revision
    ).toBe(1)
  })

  it('draft persistence 실패를 safe 500으로 정규화해 내부 값을 숨긴다', async () => {
    const created = await createV2Session()
    const draftResponse = await fetch(
      `${BASE_URL}/${created.payload.session.id}/draft-answers`,
      { headers: draftHeaders(created.cookie) }
    )
    const draft = getStudyDraftAnswersResponseSchema.parse(
      await draftResponse.json()
    )
    const secret = 'do-not-leak-v2-draft-persistence-secret'
    const saveSpy = vi
      .spyOn(mockDatabase, 'saveCanonicalStudyDraft')
      .mockImplementationOnce(() => {
        throw new MockDatabaseError('PERSISTENCE_FAILED', 500, secret)
      })

    try {
      const response = await fetch(
        `${BASE_URL}/${created.payload.session.id}/draft-answers`,
        {
          method: 'PUT',
          headers: {
            ...draftHeaders(created.cookie, crypto.randomUUID()),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            expectedRevision: 0,
            currentOrdinal: 1,
            answers: draft.answers
          })
        }
      )
      const text = await response.text()
      const error = saveStudyDraftAnswersErrorSchema.parse(JSON.parse(text))

      expect(response.status).toBe(500)
      expect(error).toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: '학습 draft를 저장하지 못했습니다.',
        retryable: true
      })
      expect(text).not.toContain(secret)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('X-Nihongo-Practice-Contract')).toBe('2')
    } finally {
      saveSpy.mockRestore()
    }
  })

  it('bounded JSON·duration·strict cancel·same-origin 오류를 real API와 맞춘다', async () => {
    const created = await createV2Session()
    const draftResponse = await fetch(
      `${BASE_URL}/${created.payload.session.id}/draft-answers`,
      { headers: draftHeaders(created.cookie) }
    )
    const draft = getStudyDraftAnswersResponseSchema.parse(
      await draftResponse.json()
    )
    const saveUrl = `${BASE_URL}/${created.payload.session.id}/draft-answers`

    const invalidDuration = await fetch(saveUrl, {
      method: 'PUT',
      headers: {
        ...draftHeaders(created.cookie, crypto.randomUUID()),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        expectedRevision: 0,
        currentOrdinal: 1,
        answers: draft.answers.map((answer, index) =>
          index === 0 ? { ...answer, elapsedSec: 86_401 } : answer
        )
      })
    })
    expect(invalidDuration.status).toBe(422)
    expect(
      saveStudyDraftAnswersErrorSchema.parse(await invalidDuration.json()).code
    ).toBe('INVALID_DURATION')

    const oversized = await fetch(saveUrl, {
      method: 'PUT',
      headers: {
        ...draftHeaders(created.cookie, crypto.randomUUID()),
        'Content-Type': 'application/json'
      },
      body: `${' '.repeat(16 * 1_024)}{}`
    })
    expect(oversized.status).toBe(400)
    expect(
      saveStudyDraftAnswersErrorSchema.parse(await oversized.json()).code
    ).toBe('INVALID_REQUEST')

    const missingOrigin = await fetch(saveUrl, {
      method: 'PUT',
      headers: {
        Cookie: created.cookie,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
        'X-Nihongo-Practice-Contract': '2'
      },
      body: JSON.stringify({
        expectedRevision: 0,
        currentOrdinal: 1,
        answers: draft.answers
      })
    })
    expect(missingOrigin.status).toBe(403)
    expect(
      saveStudyDraftAnswersErrorSchema.parse(await missingOrigin.json()).code
    ).toBe('UNTRUSTED_ORIGIN')

    const invalidCancel = await fetch(
      `${BASE_URL}/${created.payload.session.id}/cancellation`,
      {
        method: 'POST',
        headers: {
          ...draftHeaders(created.cookie),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ unexpected: true })
      }
    )
    expect(invalidCancel.status).toBe(400)
    expect(
      cancelStudySessionErrorSchema.parse(await invalidCancel.json()).code
    ).toBe('INVALID_REQUEST')

    const unchanged = await fetch(saveUrl, {
      headers: draftHeaders(created.cookie)
    })
    expect(
      getStudyDraftAnswersResponseSchema.parse(await unchanged.json()).revision
    ).toBe(0)
  })

  it('48시간이 지난 draft idempotency response를 terminal session에서 replay하지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-18T00:00:00.000Z'))
    try {
      const created = await createV2Session()
      const draftResponse = await fetch(
        `${BASE_URL}/${created.payload.session.id}/draft-answers`,
        { headers: draftHeaders(created.cookie) }
      )
      const draft = getStudyDraftAnswersResponseSchema.parse(
        await draftResponse.json()
      )
      const key = crypto.randomUUID()
      const body = {
        expectedRevision: 0,
        currentOrdinal: 1,
        answers: draft.answers
      }
      const first = await fetch(
        `${BASE_URL}/${created.payload.session.id}/draft-answers`,
        {
          method: 'PUT',
          headers: {
            ...draftHeaders(created.cookie, key),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        }
      )
      expect(first.status).toBe(200)

      vi.setSystemTime(new Date('2026-08-20T01:00:00.000Z'))
      const expiredReplay = await fetch(
        `${BASE_URL}/${created.payload.session.id}/draft-answers`,
        {
          method: 'PUT',
          headers: {
            ...draftHeaders(created.cookie, key),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        }
      )
      expect(expiredReplay.status).toBe(409)
      expect(expiredReplay.headers.get('Idempotency-Replayed')).toBeNull()
      expect(
        saveStudyDraftAnswersErrorSchema.parse(await expiredReplay.json()).code
      ).toBe('STUDY_SESSION_NOT_EDITABLE')
    } finally {
      vi.useRealTimers()
    }
  })

  it('foreign과 missing draft/session을 동일 404로 숨긴다', async () => {
    const owner = await createV2Session()
    const foreign = await createV2Session(
      undefined,
      `${MOCK_GUEST_PRINCIPAL_COOKIE_NAME}=${crypto.randomUUID()}`
    )
    const missingId = crypto.randomUUID()
    const normalizeFailure = async (response: Response) => {
      const payload = (await response.json()) as Record<string, unknown>
      const { requestId: _requestId, ...failure } = payload
      return { status: response.status, failure }
    }
    const getPair = await Promise.all([
      fetch(`${BASE_URL}/${owner.payload.session.id}/draft-answers`, {
        headers: draftHeaders(foreign.cookie)
      }),
      fetch(`${BASE_URL}/${missingId}/draft-answers`, {
        headers: draftHeaders(foreign.cookie)
      })
    ])
    const normalizedGet = await Promise.all(getPair.map(normalizeFailure))
    expect(normalizedGet[0]).toEqual(normalizedGet[1])
    expect(normalizedGet[0]).toMatchObject({
      status: 404,
      failure: { code: 'RESOURCE_NOT_FOUND', retryable: false }
    })

    const cancel = (sessionId: string) =>
      fetch(`${BASE_URL}/${sessionId}/cancellation`, {
        method: 'POST',
        headers: {
          ...draftHeaders(foreign.cookie),
          'Content-Type': 'application/json'
        },
        body: '{}'
      })
    const cancelPair = await Promise.all([
      cancel(owner.payload.session.id),
      cancel(missingId)
    ])
    const normalizedCancel = await Promise.all(cancelPair.map(normalizeFailure))
    expect(normalizedCancel[0]).toEqual(normalizedCancel[1])
  })

  it('v2 submit은 authoritative draft와 일치해야 하고 성공 시 draft를 제거한다', async () => {
    const created = await createV2Session()
    const draftResponse = await fetch(
      `${BASE_URL}/${created.payload.session.id}/draft-answers`,
      { headers: draftHeaders(created.cookie) }
    )
    const draft = getStudyDraftAnswersResponseSchema.parse(
      await draftResponse.json()
    )
    const response = await fetch(
      `${BASE_URL}/${created.payload.session.id}/submission`,
      {
        method: 'POST',
        headers: {
          ...draftHeaders(created.cookie, crypto.randomUUID()),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          answers: draft.answers,
          durationSec: 0,
          expectedDraftRevision: 0
        })
      }
    )
    expect(response.status).toBe(201)
    expect(response.headers.get('X-Nihongo-Practice-Contract')).toBe('2')
    expect(
      submitStudySessionV2ResponseSchema.parse(await response.json()).sessionId
    ).toBe(created.payload.session.id)

    const removedDraft = await fetch(
      `${BASE_URL}/${created.payload.session.id}/draft-answers`,
      { headers: draftHeaders(created.cookie) }
    )
    expect(removedDraft.status).toBe(409)
  })

  it('submit은 cross-version same-key를 reuse로, 새 key를 contract mismatch로 닫는다', async () => {
    const created = await createV2Session()
    const draftResponse = await fetch(
      `${BASE_URL}/${created.payload.session.id}/draft-answers`,
      { headers: draftHeaders(created.cookie) }
    )
    const draft = getStudyDraftAnswersResponseSchema.parse(
      await draftResponse.json()
    )
    const key = crypto.randomUUID()
    const submitUrl = `${BASE_URL}/${created.payload.session.id}/submission`
    const first = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        ...draftHeaders(created.cookie, key),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        answers: draft.answers,
        durationSec: 0,
        expectedDraftRevision: 0
      })
    })
    expect(first.status).toBe(201)

    const v1Body = { answers: draft.answers, durationSec: 0 }
    const reused = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: created.cookie,
        'Content-Type': 'application/json',
        'Idempotency-Key': key
      },
      body: JSON.stringify(v1Body)
    })
    expect(reused.status).toBe(409)
    expect(submitStudySessionErrorSchema.parse(await reused.json()).code).toBe(
      'IDEMPOTENCY_KEY_REUSED'
    )

    const mismatch = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: created.cookie,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify(v1Body)
    })
    expect(mismatch.status).toBe(409)
    expect(
      submitStudySessionErrorSchema.parse(await mismatch.json()).code
    ).toBe('PRACTICE_CONTRACT_VERSION_MISMATCH')
  })

  it('v1을 header 2로 읽고 v2의 header 없는 GET을 차단하며 cancel은 body 없는 204다', async () => {
    const v1Response = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1
      })
    })
    const v1Cookie = v1Response.headers.get('Set-Cookie')?.split(';', 1)[0]
    const v1Payload = createStudySessionResponseSchema.parse(
      await v1Response.json()
    )
    if (!v1Cookie) throw new Error('v1 guest cookie가 필요합니다.')
    const versionedV1 = await fetch(`${BASE_URL}/${v1Payload.session.id}`, {
      headers: draftHeaders(v1Cookie)
    })
    expect(
      getStudySessionV2ResponseSchema.parse(await versionedV1.json()).session
        .practiceContractVersion
    ).toBe(1)

    const cancelledV1 = await fetch(
      `${BASE_URL}/${v1Payload.session.id}/cancellation`,
      {
        method: 'POST',
        headers: {
          ...draftHeaders(v1Cookie),
          'Content-Type': 'application/json'
        },
        body: '{}'
      }
    )
    expect(cancelledV1.status).toBe(204)
    const submitCancelledV1 = await fetch(
      `${BASE_URL}/${v1Payload.session.id}/submission`,
      {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          Cookie: v1Cookie,
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID()
        },
        body: JSON.stringify({
          answers: v1Payload.questions.map(({ sessionQuestionId }) => ({
            studySessionQuestionId: sessionQuestionId,
            selectedOptionId: null,
            elapsedSec: 0
          })),
          durationSec: 0
        })
      }
    )
    expect(submitCancelledV1.status).toBe(409)
    expect(
      submitStudySessionErrorSchema.parse(await submitCancelledV1.json()).code
    ).toBe('STUDY_SESSION_NOT_EDITABLE')

    const v2 = await createV2Session(
      {
        level: 'N5',
        subject: 'GRAMMAR',
        mode: 'RANDOM',
        count: 1
      },
      v1Cookie
    )
    const missingSelector = await fetch(
      `${BASE_URL}/${v2.payload.session.id}`,
      {
        headers: { Cookie: v2.cookie }
      }
    )
    expect(missingSelector.status).toBe(409)

    const cancelled = await fetch(
      `${BASE_URL}/${v2.payload.session.id}/cancellation`,
      {
        method: 'POST',
        headers: {
          ...draftHeaders(v2.cookie),
          'Content-Type': 'application/json'
        },
        body: '{}'
      }
    )
    expect(cancelled.status).toBe(204)
    expect(await cancelled.text()).toBe('')
    expect(cancelled.headers.get('Content-Type')).toBeNull()

    const repeated = await fetch(
      `${BASE_URL}/${v2.payload.session.id}/cancellation`,
      {
        method: 'POST',
        headers: {
          ...draftHeaders(v2.cookie),
          'Content-Type': 'application/json'
        },
        body: '{}'
      }
    )
    expect(repeated.status).toBe(204)

    const submitCancelledV2 = await fetch(
      `${BASE_URL}/${v2.payload.session.id}/submission`,
      {
        method: 'POST',
        headers: {
          ...draftHeaders(v2.cookie, crypto.randomUUID()),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          answers: v2.payload.questions.map(({ sessionQuestionId }) => ({
            studySessionQuestionId: sessionQuestionId,
            selectedOptionId: null,
            elapsedSec: 0
          })),
          durationSec: 0,
          expectedDraftRevision: 0
        })
      }
    )
    expect(submitCancelledV2.status).toBe(409)
    expect(
      submitStudySessionV2ErrorSchema.parse(await submitCancelledV2.json()).code
    ).toBe('STUDY_SESSION_NOT_EDITABLE')
  })
})
