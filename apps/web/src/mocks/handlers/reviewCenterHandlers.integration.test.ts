import {
  createStudySessionV2ResponseSchema,
  type CreateStudySessionV2Body,
  type CreateStudySessionV2Response
} from '@nihongo/contracts/study/create-study-session'
import { submitStudySessionV2ResponseSchema } from '@nihongo/contracts/study/submit-study-session'
import {
  getWrongNoteMemoErrorSchema,
  getWrongNoteMemoResponseSchema
} from '@nihongo/contracts/wrong-note/get-wrong-note-memo'
import {
  listReviewEventsResponseSchema,
  type ListReviewEventsResponse
} from '@nihongo/contracts/wrong-note/list-review-events'
import {
  listReviewQueueErrorSchema,
  listReviewQueueResponseSchema,
  type ListReviewQueueResponse
} from '@nihongo/contracts/wrong-note/list-review-queue'
import {
  updateWrongNoteMemoErrorSchema,
  updateWrongNoteMemoResponseSchema
} from '@nihongo/contracts/wrong-note/update-wrong-note-memo'
import { assertNoReviewCenterForbiddenKeys } from '@nihongo/contracts/testing/review-center-conformance'
import { describe, expect, it, vi } from 'vitest'
import { cachedStorage, MOCK_DATABASE_STORAGE_KEY } from '@libs/storage'
import { mockCanonicalSubmissionV2Operations } from '@mocks/adapters/studySubmissionContractAdapter'
import { toVersionedContractStudySessionPayload } from '@mocks/adapters/studySessionContractAdapter'
import {
  getContractQuestionId,
  getSourceQuestionId
} from '@mocks/adapters/questionContractAdapter'
import { originalQuestions } from '@mocks/data/questions'
import { MockDatabase, mockDatabase } from '@mocks/repository/mockDatabase'

const STUDY_URL = 'http://localhost/api/v1/study-sessions'
const QUEUE_URL = 'http://localhost/api/v1/review-queue'
const TRUSTED_HEADERS = {
  Origin: globalThis.location.origin,
  'Content-Type': 'application/json',
  'X-Nihongo-Practice-Contract': '2'
}

const createSession = async (
  body: CreateStudySessionV2Body
): Promise<CreateStudySessionV2Response> => {
  const response = await fetch(STUDY_URL, {
    method: 'POST',
    headers: TRUSTED_HEADERS,
    body: JSON.stringify(body)
  })
  expect(response.status).toBe(201)
  return createStudySessionV2ResponseSchema.parse(await response.json())
}

const submitAllIncorrect = async (
  created: CreateStudySessionV2Response
): Promise<void> => {
  const response = await fetch(
    `${STUDY_URL}/${created.session.id}/submission`,
    {
      method: 'POST',
      headers: {
        ...TRUSTED_HEADERS,
        'Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({
        answers: created.questions.map(({ sessionQuestionId }) => ({
          studySessionQuestionId: sessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 0
        })),
        durationSec: 0,
        expectedDraftRevision: 0
      })
    }
  )
  const body: unknown = await response.json()
  expect(response.status, JSON.stringify(body)).toBe(201)
  submitStudySessionV2ResponseSchema.parse(body)
}

const prepareWrongNotes = async (): Promise<void> => {
  mockDatabase.loginAs('USER')
  const created = await createSession({
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    count: 20
  })
  await submitAllIncorrect(created)
}

const submitPinnedCanonicalQuestion = (
  sourceQuestionId: string,
  isCorrect: boolean
): void => {
  const created = mockDatabase.createStudySession({
    canonicalContractVersion: 2,
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'WRONG_NOTE',
    count: 1,
    questionIds: [sourceQuestionId]
  })
  const payload = toVersionedContractStudySessionPayload(
    mockDatabase.getCanonicalStudySessionSnapshotRecord(
      created.session.id,
      null
    )
  )
  const question = payload.questions[0]
  const source = mockDatabase.getAdminQuestion(sourceQuestionId)
  const selectedIndex = source.options.findIndex(
    (option) => option.isCorrect === isCorrect
  )
  const selectedOptionId = question?.question.options[selectedIndex]?.id
  if (!question || !selectedOptionId) {
    throw new Error('canonical 상태 전이 fixture의 선택지가 필요합니다.')
  }
  const answers = [
    {
      studySessionQuestionId: question.sessionQuestionId,
      selectedOptionId,
      elapsedSec: 3
    }
  ]
  mockDatabase.saveCanonicalStudyDraft({
    body: {
      answers,
      currentOrdinal: 1,
      expectedRevision: 0
    },
    guestPrincipalId: null,
    idempotencyKey: crypto.randomUUID(),
    sessionId: created.session.id
  })
  mockDatabase.submitCanonicalStudySession(
    {
      body: {
        answers,
        durationSec: 3,
        expectedDraftRevision: 1
      },
      contractVersion: 2,
      guestPrincipalId: null,
      idempotencyKey: crypto.randomUUID(),
      sessionId: created.session.id
    },
    mockCanonicalSubmissionV2Operations
  )
}

const archiveQuestion = (sourceQuestionId: string): void => {
  const question = mockDatabase.getAdminQuestion(sourceQuestionId)
  const correctOption = question.options.find(({ isCorrect }) => isCorrect)
  if (!correctOption) {
    throw new Error('archive fixture의 정답 선택지가 필요합니다.')
  }
  mockDatabase.updateQuestion(sourceQuestionId, {
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
    status: 'DRAFT'
  })
}

const readQueue = async (suffix = ''): Promise<ListReviewQueueResponse> => {
  const response = await fetch(`${QUEUE_URL}${suffix}`)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/u)
  const body = listReviewQueueResponseSchema.parse(await response.json())
  assertNoReviewCenterForbiddenKeys('QUEUE', body)
  return body
}

describe('canonical review-center MSW integration', () => {
  it('fixed clock queue와 filtered DAILY가 exact current IDs/order를 공유한다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-18T00:00:00.000Z'))

    try {
      await prepareWrongNotes()

      const future = await readQueue('?pageSize=100')
      expect(future.total).toBe(0)
      expect(future.items).toEqual([])
      expect(future.counts.due).toBe(0)
      expect(future.availableTags.length).toBeGreaterThan(0)

      vi.setSystemTime(new Date('2026-08-19T00:00:00.000Z'))
      const due = await readQueue('?pageSize=100')
      expect(due.total).toBe(5)
      expect(due.items).toHaveLength(5)
      expect(due.counts).toEqual({
        due: 5,
        unreviewed: 5,
        repeated: 0,
        solved: 0
      })
      expect(
        due.items.every(({ nextReviewAt }) => nextReviewAt <= due.observedAt)
      ).toBe(true)

      const wrongNote = await createSession({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'WRONG_NOTE',
        count: 20,
        reviewFilter: {}
      })
      expect(wrongNote.session).toMatchObject({
        mode: 'WRONG_NOTE',
        actualCount: due.total,
        usedFallback: false,
        fallbackReason: null
      })
      expect(wrongNote.questions.map(({ question }) => question.id)).toEqual(
        due.items.map(({ questionId }) => questionId)
      )
      expect(
        wrongNote.questions.map(({ question }) => question.questionVersionId)
      ).toEqual(
        due.items.map(
          ({ currentQuestionVersionId }) => currentQuestionVersionId
        )
      )

      const first = due.items[0]
      const tag = first?.tags[0]
      if (!first || !tag) {
        throw new Error(
          'filtered queue fixture에 current item/tag가 필요합니다.'
        )
      }
      const filter = {
        questionType: first.questionType,
        tag
      }
      const filtered = await readQueue(
        `?pageSize=100&questionType=${first.questionType}&tag=${encodeURIComponent(tag)}`
      )
      expect(filtered.items.length).toBeGreaterThan(0)
      expect(
        filtered.items.every(
          (item) =>
            item.questionType === filter.questionType &&
            item.tags.includes(filter.tag)
        )
      ).toBe(true)

      const daily = await createSession({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'DAILY_REVIEW',
        count: 20,
        reviewFilter: filter
      })
      expect(daily.session).toMatchObject({
        mode: 'DAILY_REVIEW',
        requestedCount: 20,
        actualCount: filtered.total,
        usedFallback: false,
        fallbackReason: null,
        practiceContractVersion: 2
      })
      expect(daily.questions.map(({ question }) => question.id)).toEqual(
        filtered.items.map(({ questionId }) => questionId)
      )
      expect(
        daily.questions.map(({ question }) => question.questionVersionId)
      ).toEqual(
        filtered.items.map(
          ({ currentQuestionVersionId }) => currentQuestionVersionId
        )
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('due SOLVED와 겹치는 facet, archive 제외, account 격리를 동일하게 투영한다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-18T00:00:00.000Z'))

    try {
      await prepareWrongNotes()
      vi.setSystemTime(new Date('2026-08-19T00:00:00.000Z'))
      const initial = await readQueue('?pageSize=100')
      const sourceIds = initial.items.map(({ questionId }) =>
        getSourceQuestionId(questionId, originalQuestions)
      )
      const solvedSourceId = sourceIds[0]
      const repeatedSourceId = sourceIds[1]
      const archivedSourceId = sourceIds[2]
      if (!solvedSourceId || !repeatedSourceId || !archivedSourceId) {
        throw new Error('facet fixture의 source question ID가 필요합니다.')
      }

      submitPinnedCanonicalQuestion(solvedSourceId, true)
      submitPinnedCanonicalQuestion(repeatedSourceId, false)
      vi.setSystemTime(new Date('2026-08-22T00:00:00.000Z'))
      submitPinnedCanonicalQuestion(solvedSourceId, true)
      archiveQuestion(archivedSourceId)

      vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'))
      const due = await readQueue('?view=DUE&pageSize=100')
      const solvedQuestionId = getContractQuestionId(solvedSourceId)
      const repeatedQuestionId = getContractQuestionId(repeatedSourceId)
      const archivedQuestionId = getContractQuestionId(archivedSourceId)
      expect(due.total).toBe(4)
      expect(due.counts).toEqual({
        due: 4,
        unreviewed: 2,
        repeated: 1,
        solved: 1
      })
      expect(due.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            questionId: solvedQuestionId,
            status: 'SOLVED'
          }),
          expect.objectContaining({
            questionId: repeatedQuestionId,
            status: 'AGAIN',
            wrongCount: 2
          })
        ])
      )
      expect(
        due.items.some(({ questionId }) => questionId === archivedQuestionId)
      ).toBe(false)

      const unreviewed = await readQueue('?view=UNREVIEWED&pageSize=100')
      const repeated = await readQueue('?view=REPEATED&pageSize=100')
      const solved = await readQueue('?view=SOLVED&pageSize=100')
      expect(unreviewed.total).toBe(2)
      expect(
        unreviewed.items.every(({ lastReviewedAt }) => lastReviewedAt === null)
      ).toBe(true)
      expect(repeated.items.map(({ questionId }) => questionId)).toEqual([
        repeatedQuestionId
      ])
      expect(solved.items.map(({ questionId }) => questionId)).toEqual([
        solvedQuestionId
      ])

      const mostWrong = await readQueue(
        '?view=DUE&sort=MOST_WRONG&pageSize=100'
      )
      const nextReview = await readQueue(
        '?view=DUE&sort=NEXT_REVIEW&pageSize=100'
      )
      const beyondLast = await readQueue(
        '?view=DUE&sort=RECENT&page=5&pageSize=1'
      )
      expect(mostWrong.items[0]?.questionId).toBe(repeatedQuestionId)
      expect(nextReview.items.at(-1)?.questionId).toBe(solvedQuestionId)
      expect(beyondLast).toMatchObject({ total: 4, items: [] })

      mockDatabase.loginAs('ADMIN')
      const adminQueue = await readQueue('?pageSize=100')
      expect(adminQueue).toMatchObject({ total: 0, items: [] })
      mockDatabase.loginAs('USER')
    } finally {
      vi.useRealTimers()
    }
  })

  it('memo/history를 canonical persistence로 유지하고 legacy projection과 분리한다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-18T00:00:00.000Z'))

    try {
      await prepareWrongNotes()
      vi.setSystemTime(new Date('2026-08-19T00:00:00.000Z'))
      const queue = await readQueue('?pageSize=100')
      const questionId = queue.items[0]?.questionId
      if (!questionId) {
        throw new Error('memo/history fixture의 question ID가 필요합니다.')
      }
      const memoUrl = `http://localhost/api/v1/wrong-notes/${questionId}/memo`
      const historyUrl = `http://localhost/api/v1/wrong-notes/${questionId}/review-events`

      const emptyMemo = await fetch(memoUrl)
      expect(emptyMemo.status).toBe(200)
      expect(
        getWrongNoteMemoResponseSchema.parse(await emptyMemo.json())
      ).toBeNull()

      const storedMemo = await fetch(memoUrl, {
        method: 'PUT',
        headers: TRUSTED_HEADERS,
        body: JSON.stringify({ memo: '  복습 메모  ' })
      })
      expect(storedMemo.status).toBe(200)
      const memo = updateWrongNoteMemoResponseSchema.parse(
        await storedMemo.json()
      )
      expect(memo).toMatchObject({ questionId, text: '복습 메모' })
      assertNoReviewCenterForbiddenKeys('MEMO', memo)

      const queueWithMemo = await readQueue('?pageSize=100')
      expect(
        queueWithMemo.items.find((item) => item.questionId === questionId)
          ?.hasMemo
      ).toBe(true)

      const historyResponse = await fetch(`${historyUrl}?pageSize=1`)
      expect(historyResponse.status).toBe(200)
      const history: ListReviewEventsResponse =
        listReviewEventsResponseSchema.parse(await historyResponse.json())
      expect(history.items).toHaveLength(1)
      expect(history.items[0]).toMatchObject({
        source: 'STUDY_SUBMIT',
        isCorrect: false,
        elapsedSec: 0,
        previousStatus: null,
        nextStatus: 'NEW'
      })
      assertNoReviewCenterForbiddenKeys('HISTORY', history)

      const currentUser = mockDatabase.getCurrentUser()
      if (!currentUser) {
        throw new Error('persisted memo fixture의 user가 필요합니다.')
      }
      const reloaded = new MockDatabase({
        storage: cachedStorage,
        listenToStorage: false
      })
      expect(reloaded.getCanonicalUserMemo(currentUser.id, questionId)).toEqual(
        memo
      )
      reloaded.dispose()

      const serialized = cachedStorage.getItem(MOCK_DATABASE_STORAGE_KEY)
      if (!serialized) {
        throw new Error('v6 migration fixture의 persisted state가 필요합니다.')
      }
      const withRebaseState = JSON.parse(serialized) as Record<string, unknown>
      const reviewEvents = withRebaseState.canonicalReviewEvents as Array<
        Record<string, unknown>
      >
      const answerEvent = reviewEvents.find(
        (event) =>
          typeof event.questionId === 'string' &&
          getContractQuestionId(event.questionId) === questionId
      )
      if (!answerEvent) {
        throw new Error(
          'VERSION_REBASE history fixture의 answer event가 필요합니다.'
        )
      }
      const rebaseBase = {
        algorithmVersion: 1,
        source: 'VERSION_REBASE',
        studySessionId: null,
        studyAnswerId: null,
        selectedOptionId: null,
        isCorrect: null,
        userId: answerEvent.userId,
        wrongNoteId: answerEvent.wrongNoteId,
        questionId: answerEvent.questionId,
        questionVersionId: answerEvent.questionVersionId,
        previousStatus: answerEvent.nextStatus,
        nextStatus: answerEvent.nextStatus,
        previousCorrectStreak: answerEvent.nextCorrectStreak,
        nextCorrectStreak: answerEvent.nextCorrectStreak,
        previousWrongCount: answerEvent.wrongCountAfter,
        wrongCountAfter: answerEvent.wrongCountAfter
      }
      const olderRebaseId = '00000000-0000-4000-8000-000000000101'
      const newerRebaseId = '00000000-0000-4000-8000-000000000102'
      reviewEvents.push(
        {
          ...rebaseBase,
          id: olderRebaseId,
          occurredAt: '2026-08-20T09:00:00+09:00'
        },
        {
          ...rebaseBase,
          id: newerRebaseId,
          occurredAt: '2026-08-19T19:30:00-05:00'
        }
      )
      cachedStorage.setItem(
        MOCK_DATABASE_STORAGE_KEY,
        JSON.stringify(withRebaseState)
      )
      const withRebase = new MockDatabase({
        storage: cachedStorage,
        listenToStorage: false
      })
      const rebaseHistory = listReviewEventsResponseSchema.parse({
        items: withRebase.listCanonicalReviewEvents(currentUser.id, questionId),
        nextCursor: null
      })
      expect(rebaseHistory.items.slice(0, 2)).toEqual([
        expect.objectContaining({
          id: newerRebaseId,
          source: 'VERSION_REBASE',
          isCorrect: null,
          elapsedSec: null,
          occurredAt: '2026-08-20T00:30:00.000Z'
        }),
        expect.objectContaining({
          id: olderRebaseId,
          source: 'VERSION_REBASE',
          isCorrect: null,
          elapsedSec: null,
          occurredAt: '2026-08-20T00:00:00.000Z'
        })
      ])
      withRebase.dispose()
      cachedStorage.setItem(MOCK_DATABASE_STORAGE_KEY, serialized)

      const sourceQuestionId = getSourceQuestionId(
        questionId,
        originalQuestions
      )
      const sourceQuestion = originalQuestions.find(
        ({ id }) => id === sourceQuestionId
      )
      const incorrectOptionId = sourceQuestion?.options.find(
        ({ isCorrect }) => !isCorrect
      )?.id
      if (!sourceQuestionId || !incorrectOptionId) {
        throw new Error(
          'legacy memo 격리 fixture의 source answer가 필요합니다.'
        )
      }
      const legacySession = mockDatabase.createStudySession({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'WRONG_NOTE',
        count: 1,
        questionIds: [sourceQuestionId]
      })
      mockDatabase.submitStudySession({
        sessionId: legacySession.session.id,
        answers: [
          {
            questionId: sourceQuestionId,
            selectedOptionId: incorrectOptionId,
            elapsedSec: 1
          }
        ],
        durationSec: 1
      })
      const serializedWithLegacy = cachedStorage.getItem(
        MOCK_DATABASE_STORAGE_KEY
      )
      if (!serializedWithLegacy) {
        throw new Error(
          'legacy memo 격리 fixture의 persisted state가 필요합니다.'
        )
      }
      const v6 = JSON.parse(serializedWithLegacy) as Record<string, unknown>
      v6.version = 6
      delete v6.canonicalUserMemos
      const legacyWrongNotes = v6.wrongNotes as Array<Record<string, unknown>>
      const legacyWrongNote = legacyWrongNotes[0]
      if (!legacyWrongNote) {
        throw new Error('legacy memo 격리 fixture의 WrongNote가 필요합니다.')
      }
      legacyWrongNote.memo = 'legacy memo must not migrate'
      expect(legacyWrongNote.memo).toBe('legacy memo must not migrate')
      cachedStorage.setItem(MOCK_DATABASE_STORAGE_KEY, JSON.stringify(v6))
      const upgraded = new MockDatabase({
        storage: cachedStorage,
        listenToStorage: false
      })
      expect(
        upgraded.getCanonicalUserMemo(currentUser.id, questionId)
      ).toBeNull()
      upgraded.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('strict auth/query/body/write-security 오류를 real API와 같은 union으로 닫는다', async () => {
    const anonymousQueue = await fetch(QUEUE_URL)
    expect(anonymousQueue.status).toBe(401)
    expect(
      listReviewQueueErrorSchema.parse(await anonymousQueue.json()).code
    ).toBe('AUTHENTICATION_REQUIRED')

    mockDatabase.loginAs('USER')
    const protoQuery = await fetch(`${QUEUE_URL}?__proto__=x`)
    expect(protoQuery.status).toBe(422)
    expect(listReviewQueueErrorSchema.parse(await protoQuery.json()).code).toBe(
      'VALIDATION_ERROR'
    )

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-18T00:00:00.000Z'))
    try {
      await prepareWrongNotes()
      const questionId = mockDatabase.listCanonicalWrongNoteRecords(
        mockDatabase.getCurrentUser()!.id
      )[0]
      if (!questionId) {
        throw new Error('memo validation fixture가 필요합니다.')
      }
      const memoUrl = `http://localhost/api/v1/wrong-notes/${getContractQuestionId(questionId.sourceQuestionId)}/memo`

      const structural = await fetch(memoUrl, {
        method: 'PUT',
        headers: TRUSTED_HEADERS,
        body: JSON.stringify({ memo: 'ok', userId: crypto.randomUUID() })
      })
      expect(structural.status).toBe(400)
      expect(
        updateWrongNoteMemoErrorSchema.parse(await structural.json()).code
      ).toBe('INVALID_REQUEST')

      const semantic = await fetch(memoUrl, {
        method: 'PUT',
        headers: TRUSTED_HEADERS,
        body: JSON.stringify({ memo: '가'.repeat(2_001) })
      })
      expect(semantic.status).toBe(422)
      expect(
        updateWrongNoteMemoErrorSchema.parse(await semantic.json()).code
      ).toBe('VALIDATION_ERROR')

      const untrusted = await fetch(memoUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example'
        },
        body: JSON.stringify({ memo: 'private sentinel' })
      })
      expect(untrusted.status).toBe(403)
      expect(
        updateWrongNoteMemoErrorSchema.parse(await untrusted.json()).code
      ).toBe('UNTRUSTED_ORIGIN')

      const matchingArbitraryOrigin = await fetch(
        memoUrl.replace('http://localhost', 'https://attacker.example'),
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://attacker.example'
          },
          body: JSON.stringify({ memo: 'private sentinel' })
        }
      )
      expect(matchingArbitraryOrigin.status).toBe(403)
      expect(
        updateWrongNoteMemoErrorSchema.parse(
          await matchingArbitraryOrigin.json()
        ).code
      ).toBe('UNTRUSTED_ORIGIN')

      const invalidIdMissingJson = await fetch(
        'http://localhost/api/v1/wrong-notes/not-a-uuid/memo',
        {
          method: 'PUT',
          headers: { Origin: 'https://evil.example' }
        }
      )
      expect(invalidIdMissingJson.status).toBe(400)
      expect(
        updateWrongNoteMemoErrorSchema.parse(await invalidIdMissingJson.json())
          .code
      ).toBe('INVALID_REQUEST')

      const invalidIdUntrusted = await fetch(
        'http://localhost/api/v1/wrong-notes/not-a-uuid/memo',
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://evil.example'
          },
          body: JSON.stringify({ memo: null })
        }
      )
      expect(invalidIdUntrusted.status).toBe(403)
      expect(
        updateWrongNoteMemoErrorSchema.parse(await invalidIdUntrusted.json())
          .code
      ).toBe('UNTRUSTED_ORIGIN')

      const sameOriginMetadata = await fetch(memoUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Sec-Fetch-Site': 'same-origin'
        },
        body: JSON.stringify({ memo: null })
      })
      expect(sameOriginMetadata.status).toBe(200)
      expect(
        updateWrongNoteMemoResponseSchema.parse(await sameOriginMetadata.json())
      ).toBeNull()

      vi.setSystemTime(new Date('2026-08-25T00:00:00.000Z'))
      const allowedWrites = await Promise.all(
        Array.from({ length: 60 }, () =>
          fetch(memoUrl, {
            method: 'PUT',
            headers: TRUSTED_HEADERS,
            body: JSON.stringify({ memo: null })
          })
        )
      )
      expect(allowedWrites.every(({ status }) => status === 200)).toBe(true)

      const rateLimited = await fetch(memoUrl, {
        method: 'PUT',
        headers: TRUSTED_HEADERS,
        body: JSON.stringify({ memo: null })
      })
      expect(rateLimited.status).toBe(429)
      expect(rateLimited.headers.get('Retry-After')).toBe('60')
      expect(
        updateWrongNoteMemoErrorSchema.parse(await rateLimited.json())
      ).toMatchObject({ code: 'RATE_LIMITED', retryable: true })

      mockDatabase.logout()
      const anonymousMemo = await fetch(memoUrl)
      expect(anonymousMemo.status).toBe(401)
      expect(
        getWrongNoteMemoErrorSchema.parse(await anonymousMemo.json()).code
      ).toBe('AUTHENTICATION_REQUIRED')
    } finally {
      vi.useRealTimers()
    }
  })
})
