import { describe, expect, it } from 'vitest'
import { MOCK_DATABASE_STORAGE_KEY } from '@libs/storage'
import {
  mockCanonicalSubmissionOperations,
  mockCanonicalSubmissionV2Operations
} from '@mocks/adapters/studySubmissionContractAdapter'
import {
  toContractStudySessionPayload,
  toVersionedContractStudySessionPayload
} from '@mocks/adapters/studySessionContractAdapter'
import { getContractQuestionId } from '@mocks/adapters/questionContractAdapter'
import { originalQuestions } from '@mocks/data/questions'
import {
  MockDatabase,
  MockDatabaseError,
  type AdminQuestionInput,
  type MockStorage,
  type SubmitCanonicalStudySessionInput
} from '@mocks/repository/mockDatabase'

const FIXED_NOW = '2026-08-09T12:00:00.000Z'

const createMemoryStorage = (): MockStorage => {
  const values = new Map<string, string>()

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    }
  }
}

const getCorrectOptionId = (questionId: string): string => {
  const question = originalQuestions.find(({ id }) => id === questionId)
  const option = question?.options.find(({ isCorrect }) => isCorrect)

  if (!option) {
    throw new Error('테스트 문제의 정답을 찾을 수 없습니다.')
  }

  return option.id
}

const getIncorrectOptionId = (questionId: string): string => {
  const question = originalQuestions.find(({ id }) => id === questionId)
  const option = question?.options.find(({ isCorrect }) => !isCorrect)

  if (!option) {
    throw new Error('테스트 문제의 오답을 찾을 수 없습니다.')
  }

  return option.id
}

const toAdminInput = (
  question: ReturnType<MockDatabase['getAdminQuestion']>
): AdminQuestionInput => {
  const correctOption = question.options.find(({ isCorrect }) => isCorrect)
  if (!correctOption) {
    throw new Error('관리자 문제 fixture의 정답이 필요합니다.')
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

const submitEmptyCanonicalV2Session = (
  database: MockDatabase,
  sessionId: string,
  guestPrincipalId: string | null = null
): void => {
  const payload = toVersionedContractStudySessionPayload(
    database.getCanonicalStudySessionSnapshotRecord(sessionId, guestPrincipalId)
  )
  database.submitCanonicalStudySession(
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
      sessionId
    },
    mockCanonicalSubmissionV2Operations
  )
}

const submitEmptyCanonicalV1Session = (
  database: MockDatabase,
  sessionId: string
): void => {
  const payload = toContractStudySessionPayload(
    database.getCanonicalStudySessionSnapshotRecord(sessionId, null)
  )
  database.submitCanonicalStudySession(
    {
      body: {
        answers: payload.questions.map(({ sessionQuestionId }) => ({
          studySessionQuestionId: sessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 0
        })),
        durationSec: 0
      },
      contractVersion: 1,
      guestPrincipalId: null,
      idempotencyKey: crypto.randomUUID(),
      sessionId
    },
    mockCanonicalSubmissionOperations
  )
}

describe('MockDatabase', () => {
  it('canonical Slice 3 모드를 stable question 기준으로 선택하고 source·pointer를 보존한다', () => {
    let now = new Date(FIXED_NOW)
    const database = new MockDatabase({
      now: () => now.toISOString(),
      storage: createMemoryStorage(),
      listenToStorage: false
    })
    const user = database.loginAs('USER')
    const questionId = 'n5-vocabulary-01'

    for (let index = 0; index < 3; index += 1) {
      now = new Date(new Date(FIXED_NOW).getTime() + index * 60_000)
      const history = database.createStudySession({
        canonicalContractVersion: 2,
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1,
        questionIds: [questionId]
      })
      submitEmptyCanonicalV2Session(database, history.session.id)
    }

    now = new Date(new Date(FIXED_NOW).getTime() + 5 * 60_000)
    const repeatAvoided = database.createStudySession({
      canonicalContractVersion: 2,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 5,
      seed: 'slice3-repeat-avoidance'
    })
    expect(repeatAvoided.questions).toHaveLength(5)
    expect(new Set(repeatAvoided.questions.map(({ id }) => id)).size).toBe(5)
    expect(repeatAvoided.questions.at(-1)?.id).toBe(questionId)

    const weakness = database.createStudySession({
      canonicalContractVersion: 2,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'WEAKNESS',
      count: 5
    })
    expect(weakness).toMatchObject({
      requestedCount: 5,
      actualCount: 1,
      usedFallback: false
    })
    expect(weakness.questions.map(({ id }) => id)).toEqual([questionId])

    const wrongNote = database.createStudySession({
      canonicalContractVersion: 2,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'WRONG_NOTE',
      count: 5
    })
    const reviewPayload = toVersionedContractStudySessionPayload(
      database.getCanonicalStudySessionSnapshotRecord(
        wrongNote.session.id,
        null
      )
    )
    const reviewQuestion = reviewPayload.questions[0]?.question
    if (!reviewQuestion) {
      throw new Error('Slice 3 review question fixture가 필요합니다.')
    }
    expect(wrongNote.questions.map(({ id }) => id)).toEqual([questionId])
    submitEmptyCanonicalV2Session(database, wrongNote.session.id)

    now = new Date(now.getTime() + 24 * 60 * 60 * 1_000 + 1)
    const daily = database.createStudySession({
      canonicalContractVersion: 2,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'DAILY_REVIEW',
      count: 5
    })
    expect(daily.questions.map(({ id }) => id)).toEqual([questionId])
    submitEmptyCanonicalV2Session(database, daily.session.id)

    expect(
      database
        .getCanonicalReviewEventRecords()
        .filter(({ studySessionId }) =>
          [wrongNote.session.id, daily.session.id].includes(studySessionId)
        )
        .map(({ source }) => source)
    ).toEqual(['WRONG_NOTE_REVIEW', 'WRONG_NOTE_REVIEW'])
    expect(
      database.getCanonicalWrongNoteRecord(user.id, reviewQuestion.id)
        .currentReviewQuestionVersionId
    ).toBe(reviewQuestion.questionVersionId)
  })

  it('canonical guest WEAKNESS는 같은 guest history만 사용한다', () => {
    let now = new Date(FIXED_NOW)
    const database = new MockDatabase({
      now: () => now.toISOString(),
      storage: createMemoryStorage(),
      listenToStorage: false
    })
    const guestPrincipalId = crypto.randomUUID()
    const questionId = 'n5-vocabulary-01'

    for (let index = 0; index < 3; index += 1) {
      now = new Date(new Date(FIXED_NOW).getTime() + index * 60_000)
      const history = database.createStudySession({
        canonicalContractVersion: 2,
        canonicalGuestPrincipalId: guestPrincipalId,
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1,
        questionIds: [questionId]
      })
      submitEmptyCanonicalV2Session(
        database,
        history.session.id,
        guestPrincipalId
      )
    }

    const weakness = database.createStudySession({
      canonicalContractVersion: 2,
      canonicalGuestPrincipalId: guestPrincipalId,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'WEAKNESS',
      count: 5
    })
    expect(weakness.questions.map(({ id }) => id)).toEqual([questionId])

    expect(() =>
      database.createStudySession({
        canonicalContractVersion: 2,
        canonicalGuestPrincipalId: crypto.randomUUID(),
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'WEAKNESS',
        count: 5
      })
    ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND', status: 404 }))
  })

  it('fixed clock에서도 review pointer는 생성 순서대로 전진하고 reverse submit에 rewind하지 않는다', () => {
    const storage = createMemoryStorage()
    const database = new MockDatabase({
      now: () => FIXED_NOW,
      storage,
      listenToStorage: false
    })
    const user = database.loginAs('USER')
    const questionId = 'n5-vocabulary-01'
    const history = database.createStudySession({
      canonicalContractVersion: 2,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1,
      questionIds: [questionId]
    })
    submitEmptyCanonicalV2Session(database, history.session.id)

    const reviewA = database.createStudySession({
      canonicalContractVersion: 2,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'WRONG_NOTE',
      count: 1
    })
    const payloadA = toVersionedContractStudySessionPayload(
      database.getCanonicalStudySessionSnapshotRecord(reviewA.session.id, null)
    )
    const source = database.getAdminQuestion(questionId)
    database.updateQuestion(questionId, {
      ...toAdminInput(source),
      questionText: `${source.questionText} fixed-clock v2`
    })
    const reviewB = database.createStudySession({
      canonicalContractVersion: 2,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'WRONG_NOTE',
      count: 1
    })
    const payloadB = toVersionedContractStudySessionPayload(
      database.getCanonicalStudySessionSnapshotRecord(reviewB.session.id, null)
    )
    const questionA = payloadA.questions[0]?.question
    const questionB = payloadB.questions[0]?.question
    if (!questionA || !questionB) {
      throw new Error('review pointer fixture가 필요합니다.')
    }
    expect(questionB.questionVersionId).not.toBe(questionA.questionVersionId)

    submitEmptyCanonicalV2Session(database, reviewA.session.id)
    expect(
      database.getCanonicalWrongNoteRecord(user.id, questionB.id)
        .currentReviewQuestionVersionId
    ).toBe(questionB.questionVersionId)

    const restored = new MockDatabase({ storage, listenToStorage: false })
    try {
      expect(
        restored.getCanonicalWrongNoteRecord(user.id, questionB.id)
          .currentReviewQuestionVersionId
      ).toBe(questionB.questionVersionId)
    } finally {
      restored.dispose()
    }
  })

  it('legacy-only WrongNote를 canonical review 후보나 이전 snapshot으로 섞지 않는다', () => {
    const database = new MockDatabase({
      now: () => FIXED_NOW,
      storage: createMemoryStorage(),
      listenToStorage: false
    })
    database.loginAs('USER')
    const questionId = 'n5-vocabulary-01'
    const legacy = database.createStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'WRONG_NOTE',
      count: 1,
      questionIds: [questionId]
    })
    database.submitStudySession({
      sessionId: legacy.session.id,
      answers: [
        {
          questionId,
          selectedOptionId: getIncorrectOptionId(questionId),
          elapsedSec: 0
        }
      ],
      durationSec: 0
    })

    expect(() =>
      database.createStudySession({
        canonicalContractVersion: 2,
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'WRONG_NOTE',
        count: 1
      })
    ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND', status: 404 }))
  })

  it('legacy RANDOM history는 canonical repeat·WEAKNESS에서 격리하고 canonical v1 history는 사용한다', () => {
    const legacyDatabase = new MockDatabase({
      now: () => FIXED_NOW,
      storage: createMemoryStorage(),
      listenToStorage: false
    })
    const cleanDatabase = new MockDatabase({
      now: () => FIXED_NOW,
      storage: createMemoryStorage(),
      listenToStorage: false
    })
    legacyDatabase.loginAs('USER')
    cleanDatabase.loginAs('USER')
    const questionId = 'n5-vocabulary-01'

    for (let index = 0; index < 3; index += 1) {
      const legacy = legacyDatabase.createStudySession({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1,
        questionIds: [questionId]
      })
      legacyDatabase.submitStudySession({
        sessionId: legacy.session.id,
        answers: [
          {
            questionId,
            selectedOptionId: getIncorrectOptionId(questionId),
            elapsedSec: index
          }
        ],
        durationSec: index
      })
    }

    const legacyRandom = legacyDatabase.createStudySession({
      canonicalContractVersion: 2,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 5,
      seed: 'canonical-isolation'
    })
    const cleanRandom = cleanDatabase.createStudySession({
      canonicalContractVersion: 2,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 5,
      seed: 'canonical-isolation'
    })
    expect(legacyRandom.questions.map(({ id }) => id)).toEqual(
      cleanRandom.questions.map(({ id }) => id)
    )
    expect(() =>
      legacyDatabase.createStudySession({
        canonicalContractVersion: 2,
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'WEAKNESS',
        count: 1
      })
    ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND', status: 404 }))

    for (let index = 0; index < 3; index += 1) {
      const canonicalV1 = legacyDatabase.createStudySession({
        canonicalContractVersion: 1,
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1,
        questionIds: [questionId]
      })
      submitEmptyCanonicalV1Session(legacyDatabase, canonicalV1.session.id)
    }
    expect(
      legacyDatabase
        .createStudySession({
          canonicalContractVersion: 2,
          level: 'N5',
          subject: 'VOCABULARY',
          mode: 'WEAKNESS',
          count: 1
        })
        .questions.map(({ id }) => id)
    ).toEqual([questionId])
  })

  it('관리자 문제의 정규화된 중복 태그를 거부한다', () => {
    const database = new MockDatabase({
      now: () => FIXED_NOW,
      storage: createMemoryStorage(),
      listenToStorage: false
    })
    database.loginAs('ADMIN')

    expect(() =>
      database.createQuestion({
        level: 'N5',
        subject: 'VOCABULARY',
        questionType: 'KANJI_READING',
        passage: null,
        questionText: '「山」の 読み方を 選んでください。',
        options: [
          { label: '1', text: 'やま' },
          { label: '2', text: 'かわ' },
          { label: '3', text: 'うみ' },
          { label: '4', text: 'そら' }
        ],
        correctOptionId: '1',
        explanationKo: '「山」은 「やま」라고 읽습니다.',
        explanationJa: null,
        difficulty: 'EASY',
        tags: ['INFO', 'info'],
        status: 'PUBLISHED'
      })
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_INPUT',
        status: 422
      })
    )
  })

  it('제출 결과로 오답 상태를 누적하고 두 번 연속 정답이면 해결한다', () => {
    const database = new MockDatabase({
      now: () => FIXED_NOW,
      storage: createMemoryStorage(),
      listenToStorage: false
    })
    const user = database.loginAs('USER')
    const questionId = 'n5-vocabulary-01'

    const submit = (selectedOptionId: string): void => {
      const { session } = database.createStudySession({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'WRONG_NOTE',
        count: 1,
        questionIds: [questionId]
      })
      database.submitStudySession({
        sessionId: session.id,
        answers: [{ questionId, selectedOptionId, elapsedSec: 5 }],
        durationSec: 5
      })
    }

    submit('n5-vocabulary-01-option-4')
    expect(database.getWrongNote(user.id, questionId).wrongNote).toMatchObject({
      wrongCount: 1,
      correctStreak: 0,
      status: 'NEW'
    })

    submit('n5-vocabulary-01-option-4')
    expect(database.getWrongNote(user.id, questionId).wrongNote).toMatchObject({
      wrongCount: 2,
      correctStreak: 0,
      status: 'AGAIN'
    })

    const correctOptionId = getCorrectOptionId(questionId)
    submit(correctOptionId)
    submit(correctOptionId)

    expect(database.getWrongNote(user.id, questionId).wrongNote).toMatchObject({
      wrongCount: 2,
      correctStreak: 2,
      status: 'SOLVED'
    })
  })

  it('초기 한 번 읽은 저장소를 메모리 캐시로 사용하고 mutation을 저장한다', () => {
    const values = new Map<string, string>()
    let readCount = 0
    const storage: MockStorage = {
      getItem: (key) => {
        readCount += 1
        return values.get(key) ?? null
      },
      setItem: (key, value) => {
        values.set(key, value)
      },
      removeItem: (key) => {
        values.delete(key)
      }
    }
    const database = new MockDatabase({
      now: () => FIXED_NOW,
      storage,
      listenToStorage: false
    })

    expect(readCount).toBe(1)
    database.loginAs('ADMIN')
    expect(readCount).toBe(2)
    database.listQuestions({ level: 'N3', subject: 'GRAMMAR' })
    database.listQuestions({ level: 'N2', subject: 'READING' })

    expect(readCount).toBe(2)
    expect(values.size).toBe(1)

    const restored = new MockDatabase({
      now: () => FIXED_NOW,
      storage,
      listenToStorage: false
    })
    expect(restored.getCurrentUser()?.role).toBe('ADMIN')
  })

  it('저장 실패 시 login/logout을 성공 처리하지 않고 이전 identity로 롤백한다', () => {
    const values = new Map<string, string>()
    let shouldFail = true
    const storage: MockStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (shouldFail) {
          return false
        }
        values.set(key, value)
        return true
      },
      removeItem: (key) => {
        values.delete(key)
      }
    }
    const database = new MockDatabase({
      now: () => FIXED_NOW,
      storage,
      listenToStorage: false
    })

    expect(() => database.loginAs('USER')).toThrowError(
      expect.objectContaining({
        code: 'PERSISTENCE_FAILED',
        status: 500
      })
    )
    expect(database.getCurrentUser()).toBeNull()

    shouldFail = false
    expect(database.loginAs('USER').role).toBe('USER')
    shouldFail = true

    expect(() => database.logout()).toThrowError(
      expect.objectContaining({
        code: 'PERSISTENCE_FAILED',
        status: 500
      })
    )
    expect(database.getCurrentUser()?.role).toBe('USER')
  })

  it('현재 사용자와 소유자가 다른 학습 세션 접근을 차단한다', () => {
    const database = new MockDatabase({
      now: () => FIXED_NOW,
      storage: createMemoryStorage(),
      listenToStorage: false
    })
    database.loginAs('USER')
    const { session, questions } = database.createStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })

    database.loginAs('ADMIN')

    const assertForbidden = (operation: () => unknown): void => {
      try {
        operation()
        expect.unreachable('다른 사용자의 세션 접근이 차단되어야 합니다.')
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(MockDatabaseError)
        if (error instanceof MockDatabaseError) {
          expect(error.status).toBe(403)
          expect(error.code).toBe('FORBIDDEN')
        }
      }
    }

    assertForbidden(() => database.getStudySession(session.id))
    assertForbidden(() =>
      database.submitStudySession({
        sessionId: session.id,
        answers: [
          {
            questionId: questions[0]?.id ?? '',
            selectedOptionId: questions[0]?.options[0]?.id ?? '',
            elapsedSec: 1
          }
        ],
        durationSec: 1
      })
    )
  })

  it('제출한 결과도 세션 소유자에게만 공개한다', () => {
    const database = new MockDatabase({
      now: () => FIXED_NOW,
      storage: createMemoryStorage(),
      listenToStorage: false
    })
    database.loginAs('USER')
    const { session } = database.createStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    database.submitStudySession({
      sessionId: session.id,
      answers: [],
      durationSec: 1
    })

    database.loginAs('ADMIN')

    expect(() => database.getStudyResult(session.id)).toThrowError(
      MockDatabaseError
    )
    try {
      database.getStudyResult(session.id)
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(MockDatabaseError)
      if (error instanceof MockDatabaseError) {
        expect(error.status).toBe(403)
      }
    }
  })

  it('게스트의 저장형 출제 모드 생성을 차단한다', () => {
    const database = new MockDatabase({
      now: () => FIXED_NOW,
      storage: createMemoryStorage(),
      listenToStorage: false
    })

    for (const mode of ['WRONG_NOTE', 'BOOKMARK'] as const) {
      try {
        database.createStudySession({
          level: 'N5',
          subject: 'VOCABULARY',
          mode,
          count: 1
        })
        expect.unreachable('게스트 저장형 모드는 차단되어야 합니다.')
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(MockDatabaseError)
        if (error instanceof MockDatabaseError) {
          expect(error.status).toBe(401)
        }
      }
    }
  })

  it('BOOKMARK 동일 시각 tie는 canonical stable Question UUID 순서로 고정한다', () => {
    const database = new MockDatabase({
      now: () => FIXED_NOW,
      storage: createMemoryStorage(),
      listenToStorage: false
    })
    const user = database.loginAs('USER')
    const sourceQuestionIds = ['n5-vocabulary-01', 'n5-vocabulary-02']
    for (const sourceQuestionId of sourceQuestionIds) {
      database.createCanonicalBookmark(user.id, sourceQuestionId)
    }

    const session = database.createStudySession({
      canonicalContractVersion: 2,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'BOOKMARK',
      count: 2
    })
    const expected = sourceQuestionIds.toSorted((left, right) =>
      getContractQuestionId(left).localeCompare(getContractQuestionId(right))
    )

    expect(session.questions.map(({ id }) => id)).toEqual(expected)
  })

  it('v4의 안전한 공개 snapshot 없는 Bookmark는 v5 hydration에서 폐기한다', () => {
    const storage = createMemoryStorage()
    const database = new MockDatabase({
      now: () => FIXED_NOW,
      storage,
      listenToStorage: false
    })
    const user = database.loginAs('USER')
    const questionId = 'n5-vocabulary-01'
    database.createCanonicalBookmark(user.id, questionId)
    database.updateQuestion(questionId, {
      ...toAdminInput(database.getAdminQuestion(questionId)),
      questionText: 'v4 비공개 draft',
      status: 'DRAFT'
    })
    database.dispose()

    const serialized = storage.getItem(MOCK_DATABASE_STORAGE_KEY)
    if (!serialized) {
      throw new Error('v4 hydration fixture가 필요합니다.')
    }
    const legacyState = JSON.parse(serialized) as Record<string, unknown>
    legacyState.version = 4
    delete legacyState.archivedQuestions
    storage.setItem(MOCK_DATABASE_STORAGE_KEY, JSON.stringify(legacyState))

    const hydrated = new MockDatabase({
      now: () => FIXED_NOW,
      storage,
      listenToStorage: false
    })
    expect(hydrated.listCanonicalBookmarkSources(user.id)).toEqual([])
    hydrated.loginAs('USER')
    hydrated.dispose()

    const reloaded = new MockDatabase({
      now: () => FIXED_NOW,
      storage,
      listenToStorage: false
    })
    expect(reloaded.listCanonicalBookmarkSources(user.id)).toEqual([])
    reloaded.dispose()
  })

  it('문제 은행에서 삭제되어도 기존 세션은 생성 당시 문제로 채점한다', () => {
    const database = new MockDatabase({
      now: () => FIXED_NOW,
      storage: createMemoryStorage(),
      listenToStorage: false
    })
    database.loginAs('USER')
    const questionId = 'n5-vocabulary-01'
    const { session } = database.createStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1,
      questionIds: [questionId]
    })

    database.deleteQuestion(questionId)

    expect(database.getStudySessionPayload(session.id).questions[0]?.id).toBe(
      questionId
    )
    const result = database.submitStudySession({
      sessionId: session.id,
      answers: [
        {
          questionId,
          selectedOptionId: getCorrectOptionId(questionId),
          elapsedSec: 3
        }
      ],
      durationSec: 3
    })

    expect(result.correctCount).toBe(1)
    expect(database.getStudyResult(session.id).correctCount).toBe(1)
  })

  it('canonical 제출 저장 실패를 answer/result/idempotency/review event와 WrongNote까지 원자 롤백한다', () => {
    const values = new Map<string, string>()
    let shouldFail = false
    const storage: MockStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (shouldFail) {
          return false
        }
        values.set(key, value)
        return true
      },
      removeItem: (key) => {
        values.delete(key)
      }
    }
    const database = new MockDatabase({
      now: () => FIXED_NOW,
      storage,
      listenToStorage: false
    })
    const user = database.loginAs('USER')
    const questionId = 'n5-vocabulary-01'
    const sourceQuestion = originalQuestions.find(({ id }) => id === questionId)
    if (!sourceQuestion) {
      throw new Error('canonical rollback용 source 문제가 필요합니다.')
    }
    const { session } = database.createStudySession({
      canonicalContractVersion: 1,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1,
      questionIds: [questionId]
    })
    const payload = toContractStudySessionPayload(
      database.getCanonicalStudySessionSnapshotRecord(session.id, null),
      new Date(FIXED_NOW)
    )
    const question = payload.questions[0]
    const wrongOptionIndex = sourceQuestion.options.findIndex(
      ({ isCorrect }) => !isCorrect
    )
    const selectedOptionId = question?.question.options[wrongOptionIndex]?.id
    if (!question || !selectedOptionId) {
      throw new Error('canonical rollback용 오답 보기가 필요합니다.')
    }
    const submission = {
      body: {
        answers: [
          {
            studySessionQuestionId: question.sessionQuestionId,
            selectedOptionId,
            elapsedSec: 5
          }
        ],
        durationSec: 5
      },
      guestPrincipalId: null,
      idempotencyKey: crypto.randomUUID(),
      sessionId: session.id
    } satisfies SubmitCanonicalStudySessionInput

    shouldFail = true
    expect(() =>
      database.submitCanonicalStudySession(
        submission,
        mockCanonicalSubmissionOperations
      )
    ).toThrowError(
      expect.objectContaining({ code: 'PERSISTENCE_FAILED', status: 500 })
    )
    expect(
      database.getCanonicalStudySessionSnapshotRecord(session.id, null).session
        .status
    ).toBe('IN_PROGRESS')
    expect(database.getCanonicalStudyAnswerRecords(session.id)).toHaveLength(0)
    expect(database.hasCanonicalStudyResultRecord(session.id)).toBe(false)
    expect(database.getCanonicalIdempotencyRecords()).toHaveLength(0)
    expect(database.getCanonicalReviewEventRecords()).toHaveLength(0)
    expect(() => database.getWrongNote(user.id, questionId)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' })
    )

    shouldFail = false
    const completed = database.submitCanonicalStudySession(
      submission,
      mockCanonicalSubmissionOperations
    )
    expect(completed.replayed).toBe(false)
    expect(completed.response.items[0]?.wrongNoteStatus).toBe('NEW')
    const answers = database.getCanonicalStudyAnswerRecords(session.id)
    const events = database.getCanonicalReviewEventRecords(session.id)
    expect(answers).toHaveLength(1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      studyAnswerId: answers[0]?.id,
      previousStatus: null,
      nextStatus: 'NEW',
      previousWrongCount: null,
      wrongCountAfter: 1,
      source: 'STUDY_SUBMIT'
    })
    expect(database.getCanonicalIdempotencyRecords()).toHaveLength(1)
  })

  it('v2 guest marker만 canonical로 복구하고 모호한 USER session과 legacy session은 legacy로 보존한다', () => {
    const values = new Map<string, string>()
    const storage: MockStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value)
      },
      removeItem: (key) => {
        values.delete(key)
      }
    }
    const database = new MockDatabase({
      now: () => FIXED_NOW,
      storage,
      listenToStorage: false
    })
    const guestPrincipalId = crypto.randomUUID()
    const guestCanonical = database.createStudySession({
      canonicalContractVersion: 1,
      canonicalGuestPrincipalId: guestPrincipalId,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    database.loginAs('USER')
    const userCanonical = database.createStudySession({
      canonicalContractVersion: 1,
      level: 'N5',
      subject: 'GRAMMAR',
      mode: 'RANDOM',
      count: 1
    })
    const legacy = database.createStudySession({
      level: 'N5',
      subject: 'READING',
      mode: 'RANDOM',
      count: 1
    })
    database.dispose()

    interface MutablePersistedFixture {
      version: number
      currentUserId: string | null
      sessionMetadata: Array<[string, Record<string, unknown>]>
      canonicalIdempotencyRecords?: unknown
      canonicalReviewEvents?: unknown
      canonicalStudyAnswers?: unknown
      canonicalStudyResults?: unknown
    }
    const serialized = values.get(MOCK_DATABASE_STORAGE_KEY)
    if (!serialized) {
      throw new Error(
        'v2 migration fixture를 만들 persisted state가 필요합니다.'
      )
    }
    const v2Fixture = JSON.parse(serialized) as MutablePersistedFixture
    v2Fixture.version = 2
    v2Fixture.sessionMetadata = v2Fixture.sessionMetadata.map(
      ([sessionId, metadata]) => {
        const v2Metadata = { ...metadata }
        delete v2Metadata.canonicalContractVersion
        return [sessionId, v2Metadata]
      }
    )
    delete v2Fixture.canonicalIdempotencyRecords
    delete v2Fixture.canonicalReviewEvents
    delete v2Fixture.canonicalStudyAnswers
    delete v2Fixture.canonicalStudyResults
    values.set(MOCK_DATABASE_STORAGE_KEY, JSON.stringify(v2Fixture))

    const userRestored = new MockDatabase({
      now: () => FIXED_NOW,
      storage,
      listenToStorage: false
    })
    try {
      expect(userRestored.getCurrentUser()?.role).toBe('USER')
      expect(() =>
        userRestored.getCanonicalStudySessionSnapshotRecord(
          userCanonical.session.id,
          null
        )
      ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }))
      expect(
        userRestored.getStudySessionPayload(userCanonical.session.id).session.id
      ).toBe(userCanonical.session.id)
      expect(
        userRestored.getStudySessionPayload(legacy.session.id).session.id
      ).toBe(legacy.session.id)
    } finally {
      userRestored.dispose()
    }

    v2Fixture.currentUserId = null
    values.set(MOCK_DATABASE_STORAGE_KEY, JSON.stringify(v2Fixture))
    const guestRestored = new MockDatabase({
      now: () => FIXED_NOW,
      storage,
      listenToStorage: false
    })
    try {
      expect(
        guestRestored.isCanonicalGuestPrincipalActive(guestPrincipalId)
      ).toBe(true)
      expect(
        guestRestored.getCanonicalStudySessionSnapshotRecord(
          guestCanonical.session.id,
          guestPrincipalId
        ).session.id
      ).toBe(guestCanonical.session.id)
      expect(() =>
        guestRestored.getStudySessionPayload(guestCanonical.session.id)
      ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }))
      expect(
        guestRestored.getCanonicalStudyAnswerRecords(guestCanonical.session.id)
      ).toHaveLength(0)
      expect(guestRestored.getCanonicalReviewEventRecords()).toHaveLength(0)
      expect(guestRestored.getCanonicalIdempotencyRecords()).toHaveLength(0)
    } finally {
      guestRestored.dispose()
    }
  })
})
