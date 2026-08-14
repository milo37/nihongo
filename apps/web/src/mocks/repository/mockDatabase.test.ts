import { describe, expect, it } from 'vitest'
import { originalQuestions } from '@mocks/data/questions'
import {
  MockDatabase,
  MockDatabaseError,
  type MockStorage
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

describe('MockDatabase', () => {
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
})
