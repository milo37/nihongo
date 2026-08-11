import { afterEach, describe, expect, it } from 'vitest'
import { isApiError } from '@api/config'
import { loginDemoUser } from '@api/auth/loginDemoUser'
import { logoutUser } from '@api/auth/logoutUser'
import { createStudySession } from '@api/study/createStudySession'
import { submitStudySession } from '@api/study/submitStudySession'
import { listWrongNote } from '@api/wrong-note/listWrongNote'

describe('MSW 학습 API 흐름', () => {
  afterEach(async () => {
    await logoutUser()
  })

  it('로그인 후 세션을 제출하면 오답노트에 저장한다', async () => {
    const user = await loginDemoUser()
    const { session, questions, actualCount } = await createStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 5
    })

    expect(user.role).toBe('USER')
    expect(actualCount).toBeGreaterThan(0)
    expect(questions).toHaveLength(actualCount)
    expect(questions[0]).not.toHaveProperty('explanationKo')
    expect(questions[0]?.options[0]).not.toHaveProperty('isCorrect')

    const result = await submitStudySession(session.id, {
      answers: [],
      durationSec: 30
    })

    expect(result.correctCount).toBe(0)
    expect(result.incorrectCount).toBe(actualCount)

    const wrongNotes = await listWrongNote({ pageSize: 100 })
    const savedQuestionIds = new Set(
      wrongNotes.items.map(({ wrongNote }) => wrongNote.questionId)
    )

    for (const question of questions) {
      expect(savedQuestionIds.has(question.id)).toBe(true)
    }
  })

  it('세션에 속하지 않은 답안은 검증 오류로 분류한다', async () => {
    await loginDemoUser()
    const { session } = await createStudySession({
      level: 'N5',
      subject: 'GRAMMAR',
      mode: 'RANDOM',
      count: 5
    })

    try {
      await submitStudySession(session.id, {
        answers: [
          {
            questionId: 'not-in-session',
            selectedOptionId: 'not-an-option',
            elapsedSec: 1
          }
        ],
        durationSec: 1
      })
      expect.unreachable('검증 오류가 발생해야 합니다.')
    } catch (error: unknown) {
      expect(isApiError(error)).toBe(true)
      if (isApiError(error)) {
        expect(error.status).toBe(422)
        expect(error.isValidationError).toBe(true)
        expect(error.isServerError).toBe(false)
      }
    }
  })
})
