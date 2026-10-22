import { describe, expect, it } from 'vitest'
import type { QuestionRecord } from '@common/types/domain'
import {
  compareAdminTags,
  type CreateAdminQuestionRequest
} from '@nihongo/contracts/admin/phase7'
import {
  MOCK_DATABASE_STORAGE_KEY,
  PHASE7_ADMIN_CMS_STORAGE_KEY
} from '@libs/storage'
import {
  mockCanonicalSubmissionOperations,
  mockCanonicalSubmissionV2Operations
} from '@mocks/adapters/studySubmissionContractAdapter'
import {
  toContractStudySessionPayload,
  toVersionedContractStudySessionPayload
} from '@mocks/adapters/studySessionContractAdapter'
import {
  getContractQuestionId,
  getQuestionVersionFingerprint,
  toContractPracticeQuestion
} from '@mocks/adapters/questionContractAdapter'
import { originalQuestions } from '@mocks/data/questions'
import {
  MockDatabase,
  MockDatabaseError,
  type AdminQuestionInput,
  type MockStorage,
  type SubmitCanonicalStudySessionInput
} from '@mocks/repository/mockDatabase'
import { toPracticeQuestion } from '@mocks/logic/question'

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
          studySessionId === null
            ? false
            : [wrongNote.session.id, daily.session.id].includes(studySessionId)
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

  it('두 authority key를 초기 한 번씩 읽고 mutation을 저장한다', () => {
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

    expect(readCount).toBe(2)
    database.loginAs('ADMIN')
    expect(readCount).toBe(3)
    database.listQuestions({ level: 'N3', subject: 'GRAMMAR' })
    database.listQuestions({ level: 'N2', subject: 'READING' })

    expect(readCount).toBe(3)
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

  it('결과 재시도를 historical pin과 revision 0 draft로 저장하고 terminal target도 exact replay한다', () => {
    const storage = createMemoryStorage()
    const database = new MockDatabase({
      now: () => FIXED_NOW,
      storage,
      listenToStorage: false
    })
    const user = database.loginAs('USER')
    const source = database.createStudySession({
      canonicalContractVersion: 2,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 2,
      questionIds: ['n5-vocabulary-01', 'n5-vocabulary-02']
    })
    submitEmptyCanonicalV2Session(database, source.session.id)
    expect(
      database
        .listCanonicalWrongNoteRecords(user.id)
        .every(
          ({ currentReviewQuestionVersionId }) =>
            currentReviewQuestionVersionId === null
        )
    ).toBe(true)

    const idempotencyKey = crypto.randomUUID()
    const created = database.createCanonicalResultRetry({
      guestPrincipalId: null,
      idempotencyKey,
      sourceSessionId: source.session.id
    })
    expect(created.replayed).toBe(false)
    expect(created.response).toMatchObject({
      session: {
        mode: 'WRONG_NOTE',
        practiceContractVersion: 2,
        requestedCount: 2,
        actualCount: 2,
        usedFallback: false
      }
    })
    const sourcePayload = toVersionedContractStudySessionPayload(
      database.getCanonicalStudySessionSnapshotRecord(source.session.id, null)
    )
    expect(
      created.response.questions.map(
        ({ question }) => question.questionVersionId
      )
    ).toEqual(
      sourcePayload.questions.map(({ question }) => question.questionVersionId)
    )
    expect(
      database.getCanonicalStudyDraft(created.response.session.id, null)
    ).toMatchObject({ revision: 0, savedAt: null })
    expect(
      database
        .listCanonicalWrongNoteRecords(user.id)
        .every(
          ({ currentReviewQuestionVersionId }) =>
            currentReviewQuestionVersionId === null
        )
    ).toBe(true)
    const record = database
      .getCanonicalIdempotencyRecords()
      .find(({ operation }) => operation === 'study.createResultRetrySession')
    expect(record).toMatchObject({
      operation: 'study.createResultRetrySession',
      responseStatus: 201,
      sourceSessionId: source.session.id,
      sessionId: created.response.session.id
    })
    expect(Date.parse(record?.expiresAt ?? '') - Date.parse(FIXED_NOW)).toBe(
      7 * 24 * 60 * 60 * 1_000
    )
    database.dispose()

    const restored = new MockDatabase({
      now: () => FIXED_NOW,
      storage,
      listenToStorage: false
    })
    try {
      expect(
        restored.createCanonicalResultRetry({
          guestPrincipalId: null,
          idempotencyKey,
          sourceSessionId: source.session.id
        })
      ).toEqual({ replayed: true, response: created.response })
      restored.cancelCanonicalStudySession(created.response.session.id, null)
      expect(
        restored.createCanonicalResultRetry({
          guestPrincipalId: null,
          idempotencyKey,
          sourceSessionId: source.session.id
        })
      ).toEqual({ replayed: true, response: created.response })
    } finally {
      restored.dispose()
    }
  })

  it('v6 retry response와 Answer/Result evidence 변조를 fail closed 처리한다', () => {
    const createSubmittedWrongSource = (database: MockDatabase): string => {
      database.loginAs('USER')
      const source = database.createStudySession({
        canonicalContractVersion: 2,
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1,
        questionIds: ['n5-vocabulary-01']
      })
      submitEmptyCanonicalV2Session(database, source.session.id)
      return source.session.id
    }

    const responseStorage = createMemoryStorage()
    const responseDatabase = new MockDatabase({
      now: () => FIXED_NOW,
      storage: responseStorage,
      listenToStorage: false
    })
    const responseSourceId = createSubmittedWrongSource(responseDatabase)
    const responseKey = crypto.randomUUID()
    responseDatabase.createCanonicalResultRetry({
      guestPrincipalId: null,
      idempotencyKey: responseKey,
      sourceSessionId: responseSourceId
    })
    responseDatabase.dispose()
    const serializedResponse = responseStorage.getItem(
      MOCK_DATABASE_STORAGE_KEY
    )
    if (!serializedResponse) {
      throw new Error('retry response tamper fixture가 필요합니다.')
    }
    const responseState = JSON.parse(serializedResponse) as Record<
      string,
      unknown
    >
    const idempotencyRecords = responseState.canonicalIdempotencyRecords
    if (!Array.isArray(idempotencyRecords)) {
      throw new Error('retry idempotency fixture가 필요합니다.')
    }
    const retryRecord = idempotencyRecords.find(
      (record) =>
        typeof record === 'object' &&
        record !== null &&
        'operation' in record &&
        record.operation === 'study.createResultRetrySession'
    )
    if (
      typeof retryRecord !== 'object' ||
      retryRecord === null ||
      !('response' in retryRecord) ||
      typeof retryRecord.response !== 'object' ||
      retryRecord.response === null ||
      !('session' in retryRecord.response) ||
      typeof retryRecord.response.session !== 'object' ||
      retryRecord.response.session === null
    ) {
      throw new Error('retry stored response fixture가 필요합니다.')
    }
    ;(retryRecord.response.session as Record<string, unknown>).id =
      crypto.randomUUID()
    responseStorage.setItem(
      MOCK_DATABASE_STORAGE_KEY,
      JSON.stringify(responseState)
    )
    const responseRestored = new MockDatabase({
      now: () => FIXED_NOW,
      storage: responseStorage,
      listenToStorage: false
    })
    expect(() =>
      responseRestored.createCanonicalResultRetry({
        guestPrincipalId: null,
        idempotencyKey: responseKey,
        sourceSessionId: responseSourceId
      })
    ).toThrowError(
      expect.objectContaining({ code: 'PERSISTENCE_FAILED', status: 500 })
    )
    responseRestored.dispose()

    const evidenceStorage = createMemoryStorage()
    const evidenceDatabase = new MockDatabase({
      now: () => FIXED_NOW,
      storage: evidenceStorage,
      listenToStorage: false
    })
    const evidenceSourceId = createSubmittedWrongSource(evidenceDatabase)
    evidenceDatabase.dispose()
    const serializedEvidence = evidenceStorage.getItem(
      MOCK_DATABASE_STORAGE_KEY
    )
    if (!serializedEvidence) {
      throw new Error('retry evidence tamper fixture가 필요합니다.')
    }
    const evidenceState = JSON.parse(serializedEvidence) as Record<
      string,
      unknown
    >
    const results = evidenceState.canonicalStudyResults
    const result = Array.isArray(results) ? results[0] : undefined
    if (
      typeof result !== 'object' ||
      result === null ||
      !('items' in result) ||
      !Array.isArray(result.items) ||
      typeof result.items[0] !== 'object' ||
      result.items[0] === null ||
      !('question' in result.items[0]) ||
      typeof result.items[0].question !== 'object' ||
      result.items[0].question === null ||
      !('correctOptionId' in result.items[0].question) ||
      typeof result.items[0].question.correctOptionId !== 'string'
    ) {
      throw new Error('retry result evidence fixture가 필요합니다.')
    }
    result.correctCount = 1
    result.incorrectCount = 0
    result.items[0].isCorrect = true
    result.items[0].selectedOptionId = result.items[0].question.correctOptionId
    evidenceStorage.setItem(
      MOCK_DATABASE_STORAGE_KEY,
      JSON.stringify(evidenceState)
    )
    const evidenceRestored = new MockDatabase({
      now: () => FIXED_NOW,
      storage: evidenceStorage,
      listenToStorage: false
    })
    expect(() =>
      evidenceRestored.createCanonicalResultRetry({
        guestPrincipalId: null,
        idempotencyKey: crypto.randomUUID(),
        sourceSessionId: evidenceSourceId
      })
    ).toThrowError(
      expect.objectContaining({ code: 'PERSISTENCE_FAILED', status: 500 })
    )
    evidenceRestored.dispose()
  })

  it('retry target draft와 source historical pin 변조를 fail closed 처리한다', () => {
    const createRetryFixture = (
      storage: ReturnType<typeof createMemoryStorage>
    ): {
      idempotencyKey: string
      sourceSessionId: string
      targetSessionId: string
    } => {
      const database = new MockDatabase({
        now: () => FIXED_NOW,
        storage,
        listenToStorage: false
      })
      database.loginAs('USER')
      const source = database.createStudySession({
        canonicalContractVersion: 2,
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 2,
        questionIds: ['n5-vocabulary-01', 'n5-vocabulary-02']
      })
      submitEmptyCanonicalV2Session(database, source.session.id)
      const idempotencyKey = crypto.randomUUID()
      const retry = database.createCanonicalResultRetry({
        guestPrincipalId: null,
        idempotencyKey,
        sourceSessionId: source.session.id
      })
      database.dispose()
      return {
        idempotencyKey,
        sourceSessionId: source.session.id,
        targetSessionId: retry.response.session.id
      }
    }

    const draftStorage = createMemoryStorage()
    const draftFixture = createRetryFixture(draftStorage)
    const serializedDraft = draftStorage.getItem(MOCK_DATABASE_STORAGE_KEY)
    if (!serializedDraft) {
      throw new Error('retry draft tamper fixture가 필요합니다.')
    }
    const draftState = JSON.parse(serializedDraft) as Record<string, unknown>
    if (!Array.isArray(draftState.canonicalDrafts)) {
      throw new Error('canonical draft fixture가 필요합니다.')
    }
    draftState.canonicalDrafts = draftState.canonicalDrafts.filter(
      (draft) =>
        !(
          typeof draft === 'object' &&
          draft !== null &&
          'studySessionId' in draft &&
          draft.studySessionId === draftFixture.targetSessionId
        )
    )
    draftStorage.setItem(MOCK_DATABASE_STORAGE_KEY, JSON.stringify(draftState))
    const draftRestored = new MockDatabase({
      now: () => FIXED_NOW,
      storage: draftStorage,
      listenToStorage: false
    })
    expect(() =>
      draftRestored.createCanonicalResultRetry({
        guestPrincipalId: null,
        idempotencyKey: draftFixture.idempotencyKey,
        sourceSessionId: draftFixture.sourceSessionId
      })
    ).toThrowError(
      expect.objectContaining({ code: 'PERSISTENCE_FAILED', status: 500 })
    )
    draftRestored.dispose()

    const pinStorage = createMemoryStorage()
    const pinFixture = createRetryFixture(pinStorage)
    const serializedPin = pinStorage.getItem(MOCK_DATABASE_STORAGE_KEY)
    if (!serializedPin) {
      throw new Error('retry pin tamper fixture가 필요합니다.')
    }
    const pinState = JSON.parse(serializedPin) as Record<string, unknown>
    if (
      !Array.isArray(pinState.sessionQuestionSnapshots) ||
      !Array.isArray(pinState.sessions) ||
      !Array.isArray(pinState.canonicalIdempotencyRecords)
    ) {
      throw new Error('retry target snapshot fixture가 필요합니다.')
    }
    const targetSnapshot = pinState.sessionQuestionSnapshots.find(
      (entry) => Array.isArray(entry) && entry[0] === pinFixture.targetSessionId
    )
    const targetSession = pinState.sessions.find(
      (session) =>
        typeof session === 'object' &&
        session !== null &&
        'id' in session &&
        session.id === pinFixture.targetSessionId
    )
    const retryRecord = pinState.canonicalIdempotencyRecords.find(
      (record) =>
        typeof record === 'object' &&
        record !== null &&
        'sessionId' in record &&
        record.sessionId === pinFixture.targetSessionId
    )
    if (
      !Array.isArray(targetSnapshot) ||
      !Array.isArray(targetSnapshot[1]) ||
      targetSnapshot[1].length !== 2 ||
      typeof targetSession !== 'object' ||
      targetSession === null ||
      !('questionIds' in targetSession) ||
      !Array.isArray(targetSession.questionIds) ||
      typeof retryRecord !== 'object' ||
      retryRecord === null ||
      !('response' in retryRecord) ||
      typeof retryRecord.response !== 'object' ||
      retryRecord.response === null ||
      !('questions' in retryRecord.response) ||
      !Array.isArray(retryRecord.response.questions) ||
      retryRecord.response.questions.length !== 2
    ) {
      throw new Error('retry source-pin relation fixture가 필요합니다.')
    }
    targetSnapshot[1].reverse()
    targetSession.questionIds.reverse()
    const firstResponseQuestion = retryRecord.response.questions[0]
    const secondResponseQuestion = retryRecord.response.questions[1]
    if (
      typeof firstResponseQuestion !== 'object' ||
      firstResponseQuestion === null ||
      !('question' in firstResponseQuestion) ||
      typeof secondResponseQuestion !== 'object' ||
      secondResponseQuestion === null ||
      !('question' in secondResponseQuestion)
    ) {
      throw new Error('retry response question fixture가 필요합니다.')
    }
    const firstQuestion = firstResponseQuestion.question
    firstResponseQuestion.question = secondResponseQuestion.question
    secondResponseQuestion.question = firstQuestion
    pinStorage.setItem(MOCK_DATABASE_STORAGE_KEY, JSON.stringify(pinState))
    const pinRestored = new MockDatabase({
      now: () => FIXED_NOW,
      storage: pinStorage,
      listenToStorage: false
    })
    expect(() =>
      pinRestored.createCanonicalResultRetry({
        guestPrincipalId: null,
        idempotencyKey: pinFixture.idempotencyKey,
        sourceSessionId: pinFixture.sourceSessionId
      })
    ).toThrowError(
      expect.objectContaining({ code: 'PERSISTENCE_FAILED', status: 500 })
    )
    pinRestored.dispose()
  })

  it('정답과 archived logical question은 제외하고 active historical pin은 유지한다', () => {
    const database = new MockDatabase({
      now: () => FIXED_NOW,
      storage: createMemoryStorage(),
      listenToStorage: false
    })
    database.loginAs('USER')
    const questionId = 'n5-vocabulary-01'
    const sourceQuestion = originalQuestions.find(({ id }) => id === questionId)
    const correctSourceIndex = sourceQuestion?.options.findIndex(
      ({ isCorrect }) => isCorrect
    )
    const correctSource = database.createStudySession({
      canonicalContractVersion: 1,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1,
      questionIds: [questionId]
    })
    const correctPayload = toContractStudySessionPayload(
      database.getCanonicalStudySessionSnapshotRecord(
        correctSource.session.id,
        null
      )
    )
    const correctQuestion = correctPayload.questions[0]
    const correctOptionId =
      correctSourceIndex === undefined || correctSourceIndex < 0
        ? undefined
        : correctQuestion?.question.options[correctSourceIndex]?.id
    if (!correctQuestion || !correctOptionId) {
      throw new Error('결과 재시도 정답 fixture가 필요합니다.')
    }
    database.submitCanonicalStudySession(
      {
        body: {
          answers: [
            {
              studySessionQuestionId: correctQuestion.sessionQuestionId,
              selectedOptionId: correctOptionId,
              elapsedSec: 1
            }
          ],
          durationSec: 1
        },
        contractVersion: 1,
        guestPrincipalId: null,
        idempotencyKey: crypto.randomUUID(),
        sessionId: correctSource.session.id
      },
      mockCanonicalSubmissionOperations
    )
    expect(() =>
      database.createCanonicalResultRetry({
        guestPrincipalId: null,
        idempotencyKey: crypto.randomUUID(),
        sourceSessionId: correctSource.session.id
      })
    ).toThrowError(
      expect.objectContaining({ code: 'NO_ELIGIBLE_QUESTIONS', status: 404 })
    )

    const wrongSource = database.createStudySession({
      canonicalContractVersion: 2,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1,
      questionIds: [questionId]
    })
    submitEmptyCanonicalV2Session(database, wrongSource.session.id)
    database.loginAs('ADMIN')
    database.updateQuestion(questionId, {
      ...toAdminInput(database.getAdminQuestion(questionId)),
      status: 'DRAFT'
    })
    database.loginAs('USER')
    const historicalRetry = database.createCanonicalResultRetry({
      guestPrincipalId: null,
      idempotencyKey: crypto.randomUUID(),
      sourceSessionId: wrongSource.session.id
    })
    expect(historicalRetry.response.questions).toHaveLength(1)
    expect(
      historicalRetry.response.questions[0]?.question.questionVersionId
    ).toBe(
      toContractStudySessionPayload(
        database.getCanonicalStudySessionSnapshotRecord(
          wrongSource.session.id,
          null
        )
      ).questions[0]?.question.questionVersionId
    )

    database.loginAs('ADMIN')
    database.deleteQuestion(questionId)
    database.loginAs('USER')
    expect(() =>
      database.createCanonicalResultRetry({
        guestPrincipalId: null,
        idempotencyKey: crypto.randomUUID(),
        sourceSessionId: wrongSource.session.id
      })
    ).toThrowError(
      expect.objectContaining({ code: 'NO_ELIGIBLE_QUESTIONS', status: 404 })
    )
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

  it('targeted review를 response-loss/reload/7일 경계에서 replay하고 저장 실패를 원자 롤백한다', () => {
    const values = new Map<string, string>()
    let observedAt = FIXED_NOW
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
      now: () => observedAt,
      storage,
      listenToStorage: false
    })
    const user = database.loginAs('USER')
    const sourceQuestionId = 'n5-vocabulary-01'
    const source = database.createStudySession({
      canonicalContractVersion: 2,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1,
      questionIds: [sourceQuestionId]
    })
    submitEmptyCanonicalV2Session(database, source.session.id)
    const questionId = getContractQuestionId(sourceQuestionId)
    const key = crypto.randomUUID()
    const persistedBeforeFailure = values.get(MOCK_DATABASE_STORAGE_KEY)
    const recordCountBefore = database.getCanonicalIdempotencyRecords().length
    expect(
      database.getCanonicalWrongNoteRecord(user.id, questionId)
        .currentReviewQuestionVersionId
    ).toBeNull()

    shouldFail = true
    expect(() =>
      database.createCanonicalTargetedReview({
        userId: user.id,
        questionId,
        idempotencyKey: key
      })
    ).toThrowError(
      expect.objectContaining({ code: 'PERSISTENCE_FAILED', status: 500 })
    )
    expect(values.get(MOCK_DATABASE_STORAGE_KEY)).toBe(persistedBeforeFailure)
    expect(database.getCanonicalIdempotencyRecords()).toHaveLength(
      recordCountBefore
    )
    expect(
      database.getCanonicalWrongNoteRecord(user.id, questionId)
        .currentReviewQuestionVersionId
    ).toBeNull()

    shouldFail = false
    const created = database.createCanonicalTargetedReview({
      userId: user.id,
      questionId,
      idempotencyKey: key
    })
    expect(created.replayed).toBe(false)
    expect(created.response.questions[0]?.question.id).toBe(questionId)
    expect(
      database.getCanonicalReviewEventRecords(created.response.session.id)
    ).toHaveLength(0)
    expect(
      database.getCanonicalWrongNoteRecord(user.id, questionId)
        .currentReviewQuestionVersionId
    ).toBe(created.response.questions[0]?.question.questionVersionId)

    const canonicalSerialized = values.get(MOCK_DATABASE_STORAGE_KEY)
    if (!canonicalSerialized) {
      throw new Error('targeted persistence fixture가 필요합니다.')
    }
    interface MutableTargetedPersistedState {
      canonicalDrafts: Array<Record<string, unknown>>
      canonicalIdempotencyRecords: Array<Record<string, unknown>>
      canonicalStudyAnswers: Array<[string, Array<Record<string, unknown>>]>
    }
    const expectTamperedRecordRejected = (
      mutate: (
        record: Record<string, unknown>,
        state: MutableTargetedPersistedState
      ) => void
    ): void => {
      const state = JSON.parse(
        canonicalSerialized
      ) as MutableTargetedPersistedState
      const record = state.canonicalIdempotencyRecords.find(
        ({ operation, idempotencyKey }) =>
          operation === 'wrongNote.createTargetedReviewSession' &&
          idempotencyKey === key
      )
      if (!record) {
        throw new Error('targeted idempotency tamper record가 필요합니다.')
      }
      mutate(record, state)
      values.set(MOCK_DATABASE_STORAGE_KEY, JSON.stringify(state))
      const tampered = new MockDatabase({
        now: () => observedAt,
        storage,
        listenToStorage: false
      })
      expect(() =>
        tampered.createCanonicalTargetedReview({
          userId: user.id,
          questionId,
          idempotencyKey: key
        })
      ).toThrowError(
        expect.objectContaining({ code: 'PERSISTENCE_FAILED', status: 500 })
      )
      tampered.dispose()
    }
    expectTamperedRecordRejected((record) => {
      record.responseStatus = 200
    })
    expectTamperedRecordRejected((record) => {
      record.expiresAt = new Date(
        Date.parse(FIXED_NOW) + 8 * 24 * 60 * 60 * 1_000
      ).toISOString()
    })
    expectTamperedRecordRejected((_record, state) => {
      const sourceAnswers = state.canonicalStudyAnswers[0]?.[1]
      if (!sourceAnswers) {
        throw new Error('canonical answer tamper fixture가 필요합니다.')
      }
      state.canonicalStudyAnswers.push([
        created.response.session.id,
        sourceAnswers
      ])
    })
    expectTamperedRecordRejected((_record, state) => {
      const draft = state.canonicalDrafts.find(
        ({ studySessionId }) => studySessionId === created.response.session.id
      )
      const answers = draft?.answers
      if (!draft || !Array.isArray(answers) || !answers[0]) {
        throw new Error('targeted draft tamper fixture가 필요합니다.')
      }
      draft.revision = 1
      draft.savedAt = observedAt
      ;(answers[0] as Record<string, unknown>).elapsedSec = 86_401
    })
    values.set(MOCK_DATABASE_STORAGE_KEY, canonicalSerialized)

    const reloaded = new MockDatabase({
      now: () => observedAt,
      storage,
      listenToStorage: false
    })
    const replay = reloaded.createCanonicalTargetedReview({
      userId: user.id,
      questionId,
      idempotencyKey: key
    })
    expect(replay).toEqual({ replayed: true, response: created.response })

    observedAt = new Date(
      Date.parse(FIXED_NOW) + 7 * 24 * 60 * 60 * 1_000
    ).toISOString()
    const replaced = reloaded.createCanonicalTargetedReview({
      userId: user.id,
      questionId,
      idempotencyKey: key
    })
    expect(replaced.replayed).toBe(false)
    expect(replaced.response.session.id).not.toBe(created.response.session.id)
    expect(
      reloaded
        .getCanonicalIdempotencyRecords()
        .filter(
          ({ idempotencyKey, operation }) =>
            idempotencyKey === key &&
            operation === 'wrongNote.createTargetedReviewSession'
        )
    ).toHaveLength(1)
    reloaded.dispose()
    database.dispose()
  })

  it('persists Phase 7 v8 state, upgrades v7 as seed-only, and rolls back failed writes', async () => {
    const values = new Map<string, string>()
    let rejectNextWrite = false
    const storage: MockStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value)
        if (rejectNextWrite) {
          rejectNextWrite = false
          return false
        }
      },
      removeItem: (key) => {
        values.delete(key)
      }
    }
    const database = new MockDatabase({ storage, listenToStorage: false })
    const admin = database.loginAs('ADMIN')
    const state = database.getPhase7AdminCmsStateForHandlers()
    const source = database.getCanonicalAdminCmsSnapshot().versions[0]
    if (!source) throw new Error('Phase 7 persistence source is unavailable.')
    const correctIndex = source.options.findIndex(
      (option) => option.id === source.correctOptionId
    )
    if (correctIndex < 0) {
      throw new Error('Phase 7 persistence correct option is unavailable.')
    }
    const createRequest: CreateAdminQuestionRequest = {
      level: source.level,
      subject: source.subject,
      questionType: source.questionType,
      difficulty: source.difficulty,
      questionText: `${source.questionText}\nv8 persistence fixture`,
      passage: source.passage,
      explanationKo: source.explanationKo,
      explanationJa: source.explanationJa,
      tagNames: source.tags.map((tag) => tag.label),
      options: source.options.map((option, index) => ({
        clientOptionKey: `option-${index + 1}`,
        text: option.text
      })),
      correctOptionKey: `option-${correctIndex + 1}`
    }
    const created = await state.createQuestion({
      actorId: admin.id,
      assertAuthority: () =>
        database.assertPhase7AdminCommandAuthority({
          actorId: admin.id,
          requiresFresh: false
        }),
      request: createRequest,
      requestId: crypto.randomUUID(),
      sources: database.listCanonicalAdminQuestionSources()
    })
    const serializedV8 = values.get(MOCK_DATABASE_STORAGE_KEY)
    if (!serializedV8) throw new Error('v8 persistence fixture is unavailable.')

    const restored = new MockDatabase({ storage, listenToStorage: false })
    expect(
      restored
        .getCanonicalAdminCmsSnapshot()
        .questions.some(
          (question) => question.questionId === created.questionId
        )
    ).toBe(true)
    restored.dispose()

    const v7 = JSON.parse(serializedV8) as Record<string, unknown>
    v7.version = 7
    delete v7.phase7AdminCms
    values.set(MOCK_DATABASE_STORAGE_KEY, JSON.stringify(v7))
    values.delete(PHASE7_ADMIN_CMS_STORAGE_KEY)
    const upgraded = new MockDatabase({ storage, listenToStorage: false })
    expect(upgraded.getCanonicalAdminCmsSnapshot().questions).toHaveLength(65)
    expect(
      upgraded
        .getCanonicalAdminCmsSnapshot()
        .questions.some(
          (question) => question.questionId === created.questionId
        )
    ).toBe(false)
    const upgradedCreate = await upgraded
      .getPhase7AdminCmsStateForHandlers()
      .createQuestion({
        actorId: admin.id,
        assertAuthority: () =>
          upgraded.assertPhase7AdminCommandAuthority({
            actorId: admin.id,
            requiresFresh: false
          }),
        request: {
          ...createRequest,
          questionText: `${createRequest.questionText}\nv7 first mutation`
        },
        requestId: crypto.randomUUID(),
        sources: upgraded.listCanonicalAdminQuestionSources()
      })
    expect(
      upgraded
        .getCanonicalAdminCmsSnapshot()
        .questions.some(
          (question) => question.questionId === upgradedCreate.questionId
        )
    ).toBe(true)
    expect(values.get(PHASE7_ADMIN_CMS_STORAGE_KEY)).toBeDefined()
    upgraded.dispose()

    values.set(MOCK_DATABASE_STORAGE_KEY, serializedV8)
    const rollbackDatabase = new MockDatabase({
      storage,
      listenToStorage: false
    })
    const beforeSnapshot = rollbackDatabase.getCanonicalAdminCmsSnapshot()
    const beforeStorage = values.get(MOCK_DATABASE_STORAGE_KEY)
    const beforePhase7Storage = values.get(PHASE7_ADMIN_CMS_STORAGE_KEY)
    rejectNextWrite = true
    await expect(
      rollbackDatabase.getPhase7AdminCmsStateForHandlers().createQuestion({
        actorId: admin.id,
        assertAuthority: () =>
          rollbackDatabase.assertPhase7AdminCommandAuthority({
            actorId: admin.id,
            requiresFresh: false
          }),
        request: {
          ...createRequest,
          questionText: `${createRequest.questionText}\nrollback`
        },
        requestId: crypto.randomUUID(),
        sources: rollbackDatabase.listCanonicalAdminQuestionSources()
      })
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      disposition: 'DEFINITE_ROLLBACK'
    })
    expect(rollbackDatabase.getCanonicalAdminCmsSnapshot()).toEqual(
      beforeSnapshot
    )
    expect(values.get(MOCK_DATABASE_STORAGE_KEY)).toBe(beforeStorage)
    expect(values.get(PHASE7_ADMIN_CMS_STORAGE_KEY)).toBe(beforePhase7Storage)
    rollbackDatabase.dispose()
    database.dispose()
  })

  it('fails closed and never resurrects auth for persisted Phase 7 graph tampering', () => {
    interface PersistedTagFixture {
      id: string
      label: string
      normalizedName: string
    }
    interface PersistedVersionFixture {
      level: string
      questionId: string
      questionType: string
      subject: string
      tags: PersistedTagFixture[]
    }
    interface PersistedTamperFixture {
      currentUserId: string | null
      questions: Array<{ id: string; tags: string[] }>
      phase7AdminCms: {
        questions: Array<{
          currentPublishedVersionId: string | null
          questionId: string
        }>
        versions: PersistedVersionFixture[]
      }
    }

    const baselineStorage = createMemoryStorage()
    const database = new MockDatabase({
      storage: baselineStorage,
      listenToStorage: false
    })
    database.loginAs('ADMIN')
    const serialized = baselineStorage.getItem(MOCK_DATABASE_STORAGE_KEY)
    if (!serialized) throw new Error('Phase 7 tamper fixture is unavailable.')
    const baseline = JSON.parse(serialized) as PersistedTamperFixture
    database.dispose()

    const requireVersion = (
      persisted: PersistedTamperFixture,
      predicate: (version: PersistedVersionFixture) => boolean = () => true
    ): PersistedVersionFixture => {
      const version = persisted.phase7AdminCms.versions.find(predicate)
      if (!version) throw new Error('Phase 7 version fixture is unavailable.')
      return version
    }
    const tamperCases: ReadonlyArray<{
      name: string
      tamper: (persisted: PersistedTamperFixture) => void
    }> = [
      {
        name: 'published pointer',
        tamper: (persisted) => {
          const question = persisted.phase7AdminCms.questions[0]
          if (!question) {
            throw new Error('Phase 7 question fixture is unavailable.')
          }
          question.currentPublishedVersionId = crypto.randomUUID()
        }
      },
      {
        name: 'tag label/normalizedName coupling',
        tamper: (persisted) => {
          const tag = requireVersion(persisted).tags[0]
          if (!tag) throw new Error('Phase 7 tag fixture is unavailable.')
          tag.label += ' 변조'
        }
      },
      {
        name: 'canonical tag order',
        tamper: (persisted) => {
          requireVersion(
            persisted,
            (version) => version.tags.length >= 2
          ).tags.reverse()
        }
      },
      {
        name: 'trusted taxonomy applicability',
        tamper: (persisted) => {
          const target = requireVersion(persisted)
          const targetApplicableTagNames = new Set(
            persisted.phase7AdminCms.versions
              .filter(
                (version) =>
                  version.level === target.level &&
                  version.subject === target.subject &&
                  version.questionType === target.questionType
              )
              .flatMap((version) =>
                version.tags.map((tag) => tag.normalizedName)
              )
          )
          const foreign = requireVersion(
            persisted,
            (version) =>
              (version.level !== target.level ||
                version.subject !== target.subject ||
                version.questionType !== target.questionType) &&
              version.tags.some(
                (tag) => !targetApplicableTagNames.has(tag.normalizedName)
              )
          )
          const foreignTag = foreign.tags.find(
            (tag) => !targetApplicableTagNames.has(tag.normalizedName)
          )
          if (!foreignTag || !target.tags[0]) {
            throw new Error('Foreign Phase 7 taxonomy fixture is unavailable.')
          }
          target.tags[0] = { ...foreignTag }
          target.tags.sort(compareAdminTags)

          const source = persisted.questions.find(
            (question) =>
              getContractQuestionId(question.id) === target.questionId
          )
          if (!source) {
            throw new Error('Phase 7 source question fixture is unavailable.')
          }
          source.tags = target.tags.map((tag) => tag.label)
        }
      }
    ]

    for (const { name, tamper } of tamperCases) {
      const storage = createMemoryStorage()
      const persisted = structuredClone(baseline)
      tamper(persisted)
      storage.setItem(MOCK_DATABASE_STORAGE_KEY, JSON.stringify(persisted))

      const hydrated = new MockDatabase({ storage, listenToStorage: false })
      expect(hydrated.getCurrentUser(), name).toBeNull()
      expect(
        hydrated.getCanonicalAdminCmsSnapshot().questions,
        name
      ).toHaveLength(65)
      hydrated.createStudySession({
        count: 1,
        level: 'N5',
        mode: 'RANDOM',
        subject: 'VOCABULARY'
      })
      expect(hydrated.getCurrentUser(), name).toBeNull()
      expect(
        JSON.parse(storage.getItem(MOCK_DATABASE_STORAGE_KEY) ?? '{}'),
        name
      ).toMatchObject({ currentUserId: null })
      hydrated.dispose()
    }
  })

  it('ignores legacy source-only tag tampering across Phase 7 reads and entitlement', () => {
    const storage = createMemoryStorage()
    const database = new MockDatabase({ storage, listenToStorage: false })
    const admin = database.loginAs('ADMIN')
    const serialized = storage.getItem(MOCK_DATABASE_STORAGE_KEY)
    if (!serialized) throw new Error('Phase 7 source fixture is unavailable.')
    const persisted = JSON.parse(serialized) as {
      questions: QuestionRecord[]
    }
    const source = persisted.questions[0]
    if (!source) throw new Error('Legacy source question is unavailable.')
    const canonical = originalQuestions.find(
      (question) => question.id === source.id
    )
    if (!canonical) throw new Error('Canonical source question is unavailable.')
    const canonicalQuestionId = getContractQuestionId(canonical.id)
    const canonicalVersionId = database
      .getCanonicalAdminCmsSnapshot()
      .versions.find(
        (version) => version.questionId === canonicalQuestionId
      )?.questionVersionId
    if (!canonicalVersionId) {
      throw new Error('Canonical Phase 7 version is unavailable.')
    }
    source.tags = ['조작된 태그']
    const forgedVersionId = toContractPracticeQuestion(
      toPracticeQuestion(source),
      getQuestionVersionFingerprint(source)
    ).questionVersionId
    expect(forgedVersionId).not.toBe(canonicalVersionId)
    storage.setItem(MOCK_DATABASE_STORAGE_KEY, JSON.stringify(persisted))
    database.dispose()

    const hydrated = new MockDatabase({ storage, listenToStorage: false })
    expect(hydrated.getCurrentUser()).toMatchObject({ role: 'ADMIN' })
    const authoritativeSource = hydrated
      .listPhase7AuthoritativeAdminQuestionSources()
      .find(({ question }) => question.id === source.id)
    expect(authoritativeSource?.question.tags).toEqual(canonical.tags)

    const seedVersion = hydrated
      .getCanonicalAdminCmsSnapshot()
      .versions.find((version) => version.questionId === canonicalQuestionId)
    expect(seedVersion?.tags.map((tag) => tag.label).toSorted()).toEqual(
      canonical.tags.toSorted()
    )
    expect(seedVersion?.tags.map((tag) => tag.label)).not.toContain(
      '조작된 태그'
    )
    expect(
      hydrated.resolvePhase7QuestionReportEntitlement(admin.id, forgedVersionId)
    ).toBeNull()
    expect(
      hydrated.resolvePhase7QuestionReportEntitlement(
        admin.id,
        canonicalVersionId
      )
    ).toBe(canonicalQuestionId)
    hydrated.createStudySession({
      count: 1,
      level: 'N5',
      mode: 'RANDOM',
      subject: 'VOCABULARY'
    })
    expect(hydrated.getCurrentUser()).toMatchObject({ role: 'ADMIN' })
    hydrated.dispose()
  })

  it('ignores hydrated legacy content and seed-set tampering across Phase 7 reads and entitlement', () => {
    const baselineStorage = createMemoryStorage()
    const database = new MockDatabase({
      storage: baselineStorage,
      listenToStorage: false
    })
    const admin = database.loginAs('ADMIN')
    const serialized = baselineStorage.getItem(MOCK_DATABASE_STORAGE_KEY)
    if (!serialized) throw new Error('Phase 7 source fixture is unavailable.')
    const canonical = originalQuestions[0]
    if (!canonical) throw new Error('Canonical source question is unavailable.')
    const canonicalQuestionId = getContractQuestionId(canonical.id)
    const canonicalVersionId = database
      .getCanonicalAdminCmsSnapshot()
      .versions.find(
        (version) => version.questionId === canonicalQuestionId
      )?.questionVersionId
    if (!canonicalVersionId) {
      throw new Error('Canonical Phase 7 version is unavailable.')
    }
    database.dispose()

    for (const mode of ['CONTENT', 'EMPTY'] as const) {
      const storage = createMemoryStorage()
      const persisted = JSON.parse(serialized) as {
        questions: QuestionRecord[]
      }
      let forgedVersionId: string | null = null
      if (mode === 'CONTENT') {
        const source = persisted.questions.find(
          (question) => question.id === canonical.id
        )
        if (!source) throw new Error('Legacy source question is unavailable.')
        source.questionText += ' 조작'
        forgedVersionId = toContractPracticeQuestion(
          toPracticeQuestion(source),
          getQuestionVersionFingerprint(source)
        ).questionVersionId
      } else {
        persisted.questions = []
      }
      storage.setItem(MOCK_DATABASE_STORAGE_KEY, JSON.stringify(persisted))

      const hydrated = new MockDatabase({ storage, listenToStorage: false })
      expect(hydrated.getCurrentUser(), mode).toMatchObject({ role: 'ADMIN' })
      expect(
        hydrated.listPhase7AuthoritativeAdminQuestionSources(),
        mode
      ).toHaveLength(65)
      expect(
        hydrated.getCanonicalAdminCmsSnapshot().questions,
        mode
      ).toHaveLength(65)
      expect(
        hydrated.getCanonicalPublicQuestionRecord(canonicalQuestionId)
          .questionText,
        mode
      ).toBe(canonical.questionText)
      if (forgedVersionId) {
        expect(
          hydrated.resolvePhase7QuestionReportEntitlement(
            admin.id,
            forgedVersionId
          ),
          mode
        ).toBeNull()
      }
      expect(
        hydrated.resolvePhase7QuestionReportEntitlement(
          admin.id,
          canonicalVersionId
        ),
        mode
      ).toBe(canonicalQuestionId)
      hydrated.dispose()
    }
  })
})
