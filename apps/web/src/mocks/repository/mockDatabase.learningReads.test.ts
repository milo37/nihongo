import type { CreateStudySessionResponse } from '@nihongo/contracts/study/create-study-session'
import { describe, expect, it } from 'vitest'
import { MOCK_DATABASE_STORAGE_KEY } from '@libs/storage'
import {
  getContractQuestionId,
  toStableMockUuid
} from '@mocks/adapters/questionContractAdapter'
import { mockCanonicalSubmissionOperations } from '@mocks/adapters/studySubmissionContractAdapter'
import { toContractStudySessionPayload } from '@mocks/adapters/studySessionContractAdapter'
import { toContractWrongNoteDetail } from '@mocks/adapters/wrongNoteReadContractAdapter'
import { originalQuestions } from '@mocks/data/questions'
import { MockDatabase, type MockStorage } from '@mocks/repository/mockDatabase'

const FIXED_NOW = '2026-08-16T12:00:00.000Z'
const QUESTION_ID = 'n5-vocabulary-01'

interface MemoryStorage extends MockStorage {
  readonly values: Map<string, string>
}

interface PersistedFixture {
  version: number
  currentUserId: string | null
  questions: Array<Record<string, unknown>>
  sessions: Array<Record<string, unknown>>
  sessionMetadata: Array<[string, Record<string, unknown>]>
  sessionQuestionSnapshots: Array<[string, Array<Record<string, unknown>>]>
  wrongNotes: Array<Record<string, unknown>>
  canonicalIdempotencyRecords?: Array<Record<string, unknown>>
  canonicalReviewEvents?: Array<Record<string, unknown>>
  canonicalStudyAnswers?: Array<[string, Array<Record<string, unknown>>]>
  canonicalStudyResults?: Array<Record<string, unknown>>
}

const createMemoryStorage = (): MemoryStorage => {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    }
  }
}

const readFixture = (storage: MemoryStorage): PersistedFixture => {
  const serialized = storage.values.get(MOCK_DATABASE_STORAGE_KEY)
  if (!serialized) {
    throw new Error('persisted canonical fixture가 필요합니다.')
  }
  return JSON.parse(serialized) as PersistedFixture
}

const writeFixture = (
  storage: MemoryStorage,
  fixture: PersistedFixture
): void => {
  storage.values.set(MOCK_DATABASE_STORAGE_KEY, JSON.stringify(fixture))
}

const createPinnedSession = (
  database: MockDatabase
): CreateStudySessionResponse => {
  const { session } = database.createStudySession({
    canonicalContractVersion: 1,
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    count: 1,
    questionIds: [QUESTION_ID]
  })
  return toContractStudySessionPayload(
    database.getCanonicalStudySessionSnapshotRecord(session.id, null),
    new Date(FIXED_NOW)
  )
}

const submitPinnedSession = (
  database: MockDatabase,
  payload: CreateStudySessionResponse,
  isCorrect: boolean
) => {
  const source = originalQuestions.find(({ id }) => id === QUESTION_ID)
  const question = payload.questions[0]
  const optionIndex = source?.options.findIndex(
    (option) => option.isCorrect === isCorrect
  )
  const selectedOption =
    optionIndex === undefined
      ? undefined
      : question?.question.options[optionIndex]
  if (!source || !question || !selectedOption) {
    throw new Error('canonical repository submit fixture가 필요합니다.')
  }

  return database.submitCanonicalStudySession(
    {
      body: {
        answers: [
          {
            studySessionQuestionId: question.sessionQuestionId,
            selectedOptionId: selectedOption.id,
            elapsedSec: 2
          }
        ],
        durationSec: 2
      },
      guestPrincipalId: null,
      idempotencyKey: crypto.randomUUID(),
      sessionId: payload.session.id
    },
    mockCanonicalSubmissionOperations
  ).response
}

const createPersistedWrongNoteFixture = (
  role: 'USER' | 'ADMIN' = 'USER'
): {
  storage: MemoryStorage
  userId: string
} => {
  const storage = createMemoryStorage()
  const database = new MockDatabase({
    now: () => FIXED_NOW,
    storage,
    listenToStorage: false
  })
  const user = database.loginAs(role)
  submitPinnedSession(database, createPinnedSession(database), false)
  database.dispose()
  return { storage, userId: user.id }
}

const expectCanonicalIntegrityFailure = (
  database: MockDatabase,
  userId: string
): void => {
  for (const read of [
    () => database.listCanonicalWrongNoteRecords(userId),
    () => database.getCanonicalDashboardRecord(userId),
    () =>
      database.getCanonicalWrongNoteRecord(
        userId,
        getContractQuestionId(QUESTION_ID)
      )
  ]) {
    expect(read).toThrowError(
      expect.objectContaining({ code: 'PERSISTENCE_FAILED', status: 500 })
    )
  }
}

describe('MockDatabase canonical learning-read provenance', () => {
  it('valid v3를 reload하고 mutable legacy result/wrongNote를 canonical authority로 사용하지 않는다', () => {
    const { storage, userId } = createPersistedWrongNoteFixture()
    const fixture = readFixture(storage)
    fixture.wrongNotes.push({
      id: 'legacy-mutated-note',
      userId,
      questionId: QUESTION_ID,
      wrongCount: 99,
      correctStreak: 99,
      status: 'SOLVED',
      memo: 'legacy secret',
      lastWrongAt: '2099-01-01T00:00:00.000Z',
      lastReviewedAt: '2099-01-01T00:00:00.000Z',
      nextReviewAt: null,
      createdAt: FIXED_NOW,
      updatedAt: '2099-01-01T00:00:00.000Z'
    })
    writeFixture(storage, fixture)

    const restored = new MockDatabase({
      now: () => FIXED_NOW,
      storage,
      listenToStorage: false
    })
    try {
      expect(restored.listCanonicalWrongNoteRecords(userId)[0]).toMatchObject({
        wrongCount: 1,
        correctStreak: 0,
        status: 'NEW',
        lastWrongAt: FIXED_NOW
      })
      expect(restored.getCanonicalDashboardRecord(userId)).toMatchObject({
        sessions: [{ totalCount: 1, correctCount: 0 }],
        wrongNotes: [{ wrongCount: 1 }]
      })
      expect(
        restored.getCanonicalWrongNoteRecord(
          userId,
          getContractQuestionId(QUESTION_ID)
        ).lastWrongQuestion.id
      ).toBe(QUESTION_ID)
      expect(
        restored.getWrongNote(userId, QUESTION_ID).wrongNote
      ).toMatchObject({ id: 'legacy-mutated-note', wrongCount: 99 })
    } finally {
      restored.dispose()
    }
  })

  it('canonical 첫 전이는 legacy note가 있어도 previous null이며 legacy map을 갱신하지 않는다', () => {
    const database = new MockDatabase({
      now: () => FIXED_NOW,
      storage: createMemoryStorage(),
      listenToStorage: false
    })
    const user = database.loginAs('USER')
    const source = originalQuestions.find(({ id }) => id === QUESTION_ID)
    const legacyWrongOption = source?.options.find(
      ({ isCorrect }) => !isCorrect
    )
    if (!legacyWrongOption) {
      throw new Error('legacy predecessor fixture가 필요합니다.')
    }
    const legacySession = database.createStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1,
      questionIds: [QUESTION_ID]
    })
    database.submitStudySession({
      sessionId: legacySession.session.id,
      answers: [
        {
          questionId: QUESTION_ID,
          selectedOptionId: legacyWrongOption.id,
          elapsedSec: 2
        }
      ],
      durationSec: 2
    })

    const canonical = submitPinnedSession(
      database,
      createPinnedSession(database),
      false
    )
    expect(canonical.items[0]?.wrongNoteStatus).toBe('NEW')
    expect(database.getCanonicalReviewEventRecords()[0]).toMatchObject({
      previousStatus: null,
      previousCorrectStreak: null,
      previousWrongCount: null,
      nextStatus: 'NEW',
      wrongCountAfter: 1
    })
    expect(database.getWrongNote(user.id, QUESTION_ID).wrongNote).toMatchObject(
      {
        wrongCount: 1,
        status: 'NEW'
      }
    )
  })

  it.each([
    'duplicate-answer-bundle',
    'duplicate-result',
    'duplicate-review-event',
    'duplicate-idempotency',
    'missing-idempotency',
    'idempotency-owner-mismatch',
    'idempotency-owner-orphan',
    'idempotency-response-mismatch',
    'answer-owner-chain',
    'snapshot-not-published',
    'duplicate-session-source',
    'date-only-instant',
    'date-only-start',
    'reversed-session-chronology'
  ] as const)(
    '%s v3 corruption을 모든 canonical read에서 safe500으로 거부한다',
    (kind) => {
      const { storage, userId } = createPersistedWrongNoteFixture()
      const fixture = readFixture(storage)
      const answers = fixture.canonicalStudyAnswers
      const results = fixture.canonicalStudyResults
      const events = fixture.canonicalReviewEvents
      const idempotency = fixture.canonicalIdempotencyRecords
      if (!answers?.[0] || !results?.[0] || !events?.[0] || !idempotency?.[0]) {
        throw new Error('canonical corruption fixture facts가 필요합니다.')
      }

      if (kind === 'duplicate-answer-bundle') {
        answers.push(structuredClone(answers[0]))
      } else if (kind === 'duplicate-result') {
        results.push(structuredClone(results[0]))
      } else if (kind === 'duplicate-review-event') {
        events.push(structuredClone(events[0]))
      } else if (kind === 'duplicate-idempotency') {
        idempotency.push(structuredClone(idempotency[0]))
      } else if (kind === 'missing-idempotency') {
        idempotency.splice(0)
      } else if (kind === 'idempotency-owner-mismatch') {
        idempotency[0].principalId = crypto.randomUUID()
      } else if (kind === 'idempotency-owner-orphan') {
        idempotency.push({
          ...structuredClone(idempotency[0]),
          idempotencyKey: crypto.randomUUID(),
          sessionId: crypto.randomUUID()
        })
      } else if (kind === 'idempotency-response-mismatch') {
        const response = idempotency[0].response
        if (typeof response !== 'object' || response === null) {
          throw new Error('tamper할 idempotency response가 필요합니다.')
        }
        ;(response as Record<string, unknown>).durationSec = 3
      } else if (kind === 'answer-owner-chain') {
        const firstAnswer = answers[0][1][0]
        if (!firstAnswer) {
          throw new Error('tamper할 StudyAnswer가 필요합니다.')
        }
        firstAnswer.sourceQuestionId = 'foreign-source-question'
      } else if (kind === 'snapshot-not-published') {
        const snapshot = fixture.sessionQuestionSnapshots[0]?.[1][0]
        if (!snapshot) {
          throw new Error('tamper할 pinned snapshot이 필요합니다.')
        }
        snapshot.status = 'DRAFT'
      } else if (kind === 'duplicate-session-source') {
        const [sessionId, sessionAnswers] = answers[0]
        const session = fixture.sessions.find(({ id }) => id === sessionId)
        const snapshot = fixture.sessionQuestionSnapshots.find(
          ([candidateSessionId]) => candidateSessionId === sessionId
        )?.[1]
        const firstAnswer = sessionAnswers[0]
        if (!session || !snapshot?.[0] || !firstAnswer) {
          throw new Error('duplicate session source fixture가 필요합니다.')
        }
        const sessionQuestionId = toStableMockUuid(
          'study-session-question',
          `${sessionId}:2`
        )
        const studyAnswerId = toStableMockUuid(
          'study-answer',
          sessionQuestionId
        )
        const questionIds = session.questionIds
        if (!Array.isArray(questionIds)) {
          throw new Error('duplicate session questionIds가 필요합니다.')
        }
        questionIds.push(questionIds[0])
        snapshot.push(structuredClone(snapshot[0]))
        sessionAnswers.push({
          ...structuredClone(firstAnswer),
          id: studyAnswerId,
          studySessionQuestionId: sessionQuestionId
        })
        const result = results[0]
        const resultItems = result.items
        if (!Array.isArray(resultItems) || !resultItems[0]) {
          throw new Error('duplicate session Result item이 필요합니다.')
        }
        resultItems.push({
          ...structuredClone(resultItems[0] as Record<string, unknown>),
          sessionQuestionId
        })
        result.totalCount = 2
        result.correctCount = 0
        result.incorrectCount = 2
        result.correctRate = 0
        const firstEvent = events[0]
        events.push({
          ...structuredClone(firstEvent),
          id: toStableMockUuid('review-event', studyAnswerId),
          studyAnswerId,
          previousStatus: 'NEW',
          previousCorrectStreak: 0,
          previousWrongCount: 1,
          nextStatus: 'AGAIN',
          wrongCountAfter: 2
        })
        const requestMaterial = idempotency[0].requestMaterial
        if (typeof requestMaterial !== 'string') {
          throw new Error('duplicate session request material이 필요합니다.')
        }
        const material = JSON.parse(
          requestMaterial.replace(/^submit-v1:/u, '')
        ) as { answers: Array<Record<string, unknown>> }
        material.answers.push({
          ...structuredClone(material.answers[0]),
          studySessionQuestionId: sessionQuestionId
        })
        idempotency[0].requestMaterial = `submit-v1:${JSON.stringify(material)}`
        idempotency[0].response = structuredClone(result)
      } else if (kind === 'date-only-instant') {
        const session = fixture.sessions.find(
          ({ status }) => status === 'SUBMITTED'
        )
        const firstAnswer = answers[0][1][0]
        if (!session || !firstAnswer) {
          throw new Error('tamper할 canonical timestamp가 필요합니다.')
        }
        session.submittedAt = '2026-08-16'
      } else {
        const session = fixture.sessions.find(
          ({ status }) => status === 'SUBMITTED'
        )
        if (!session) {
          throw new Error('tamper할 canonical session start가 필요합니다.')
        }
        session.startedAt =
          kind === 'date-only-start' ? '2026-08-16' : '2026-08-17T12:00:00.000Z'
      }
      writeFixture(storage, fixture)

      const restored = new MockDatabase({
        now: () => FIXED_NOW,
        storage,
        listenToStorage: false
      })
      try {
        expectCanonicalIntegrityFailure(restored, userId)
      } finally {
        restored.dispose()
      }
    }
  )

  it('offset 표현의 lexical 순서가 뒤집혀도 UTC instant 순으로 ReviewEvent chain을 replay한다', () => {
    let now = '2026-08-16T23:00:00.000Z'
    const storage = createMemoryStorage()
    const database = new MockDatabase({
      now: () => now,
      storage,
      listenToStorage: false
    })
    const user = database.loginAs('USER')
    submitPinnedSession(database, createPinnedSession(database), false)
    now = '2026-08-17T00:00:00.000Z'
    submitPinnedSession(database, createPinnedSession(database), true)
    database.dispose()

    const fixture = readFixture(storage)
    const sessions = fixture.sessions.filter(
      ({ status }) => status === 'SUBMITTED'
    )
    const firstSessionId = sessions[0]?.id
    const secondSessionId = sessions[1]?.id
    if (
      typeof firstSessionId !== 'string' ||
      typeof secondSessionId !== 'string'
    ) {
      throw new Error('offset chronology session fixture가 필요합니다.')
    }
    const offsets = new Map([
      [firstSessionId, '2026-08-17T08:00:00+09:00'],
      [secondSessionId, '2026-08-16T17:00:00-07:00']
    ])
    for (const session of sessions) {
      const id = session.id
      if (typeof id === 'string') session.submittedAt = offsets.get(id)
    }
    for (const result of fixture.canonicalStudyResults ?? []) {
      const offset =
        typeof result.sessionId === 'string'
          ? offsets.get(result.sessionId)
          : undefined
      if (offset) result.submittedAt = offset
    }
    for (const [sessionId, sessionAnswers] of fixture.canonicalStudyAnswers ??
      []) {
      const offset = offsets.get(sessionId)
      if (offset) {
        for (const answer of sessionAnswers) answer.answeredAt = offset
      }
    }
    for (const event of fixture.canonicalReviewEvents ?? []) {
      const offset =
        typeof event.studySessionId === 'string'
          ? offsets.get(event.studySessionId)
          : undefined
      if (offset) event.occurredAt = offset
    }
    for (const record of fixture.canonicalIdempotencyRecords ?? []) {
      const offset =
        typeof record.sessionId === 'string'
          ? offsets.get(record.sessionId)
          : undefined
      if (offset) {
        record.completedAt = offset
        const response = record.response
        if (typeof response === 'object' && response !== null) {
          ;(response as Record<string, unknown>).submittedAt = offset
        }
      }
    }
    writeFixture(storage, fixture)

    const restored = new MockDatabase({
      now: () => now,
      storage,
      listenToStorage: false
    })
    try {
      expect(restored.listCanonicalWrongNoteRecords(user.id)[0]).toMatchObject({
        status: 'REVIEWING',
        lastWrongAt: '2026-08-16T23:00:00.000Z',
        lastReviewedAt: '2026-08-17T00:00:00.000Z'
      })
    } finally {
      restored.dispose()
    }
  })

  it('Result의 public trim과 WrongNote의 exact historical tag label이 같은 stable tag ID로 공존한다', () => {
    const storage = createMemoryStorage()
    const bootstrap = new MockDatabase({
      now: () => FIXED_NOW,
      storage,
      listenToStorage: false
    })
    const user = bootstrap.loginAs('USER')
    bootstrap.dispose()
    const fixture = readFixture(storage)
    const question = fixture.questions.find(({ id }) => id === QUESTION_ID)
    if (!question) {
      throw new Error('exact historical tag source fixture가 필요합니다.')
    }
    const historicalLabel = '\tI\u00a0'
    question.tags = [historicalLabel]
    writeFixture(storage, fixture)

    const database = new MockDatabase({
      now: () => FIXED_NOW,
      storage,
      listenToStorage: false
    })
    try {
      const result = submitPinnedSession(
        database,
        createPinnedSession(database),
        false
      )
      const resultTag = result.items[0]?.question.tags[0]
      const detail = toContractWrongNoteDetail(
        database.getCanonicalWrongNoteRecord(
          user.id,
          getContractQuestionId(QUESTION_ID)
        )
      )
      expect(resultTag?.label).toBe('I')
      expect(detail.question.tags[0]?.label).toBe(historicalLabel)
      expect(detail.question.tags[0]?.id).toBe(resultTag?.id)
      expect(detail.wrongNote.tags).toEqual([historicalLabel])
    } finally {
      database.dispose()
    }
  })

  it.each(['USER', 'ADMIN'] as const)(
    'v2 unmarked %s canonical-looking facts는 canonical404/empty이고 legacy map은 보존한다',
    (role) => {
      const { storage, userId } = createPersistedWrongNoteFixture(role)
      const fixture = readFixture(storage)
      fixture.version = 2
      fixture.sessionMetadata = fixture.sessionMetadata.map(
        ([sessionId, metadata]) => {
          const legacyMetadata = { ...metadata }
          delete legacyMetadata.canonicalContractVersion
          return [sessionId, legacyMetadata]
        }
      )
      delete fixture.canonicalIdempotencyRecords
      delete fixture.canonicalReviewEvents
      delete fixture.canonicalStudyAnswers
      delete fixture.canonicalStudyResults
      fixture.wrongNotes.push({
        id: 'legacy-v2-note',
        userId,
        questionId: QUESTION_ID,
        wrongCount: 1,
        correctStreak: 0,
        status: 'NEW',
        memo: null,
        lastWrongAt: FIXED_NOW,
        lastReviewedAt: null,
        nextReviewAt: '2026-08-17T12:00:00.000Z',
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW
      })
      writeFixture(storage, fixture)

      const restored = new MockDatabase({
        now: () => FIXED_NOW,
        storage,
        listenToStorage: false
      })
      try {
        expect(restored.listCanonicalWrongNoteRecords(userId)).toEqual([])
        expect(restored.getCanonicalDashboardRecord(userId)).toMatchObject({
          sessions: [],
          wrongNotes: []
        })
        expect(() =>
          restored.getCanonicalWrongNoteRecord(
            userId,
            getContractQuestionId(QUESTION_ID)
          )
        ).toThrowError(
          expect.objectContaining({ code: 'NOT_FOUND', status: 404 })
        )
        expect(restored.getWrongNote(userId, QUESTION_ID).wrongNote.id).toBe(
          'legacy-v2-note'
        )
      } finally {
        restored.dispose()
      }
    }
  )
})
