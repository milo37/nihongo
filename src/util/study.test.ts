import { describe, expect, it } from 'vitest'
import { originalQuestions } from '@mocks/data/questions'
import { calculateStudyResult, StudyResultCalculationError } from '@util/study'

const getCorrectOptionId = (questionIndex: number): string => {
  const option = originalQuestions[questionIndex].options.find(
    ({ isCorrect }) => isCorrect
  )

  if (!option) {
    throw new Error('테스트 문제에 정답이 없습니다.')
  }

  return option.id
}

describe('calculateStudyResult', () => {
  it('정답 수, 오답 수, 정답률과 미응답을 계산한다', () => {
    const questions = originalQuestions.slice(0, 2)
    const result = calculateStudyResult({
      sessionId: 'session-test',
      questions,
      answers: [
        {
          questionId: questions[0].id,
          selectedOptionId: getCorrectOptionId(0),
          elapsedSec: 10
        }
      ],
      durationSec: 25
    })

    expect(result).toMatchObject({
      totalCount: 2,
      correctCount: 1,
      incorrectCount: 1,
      correctRate: 50,
      durationSec: 25
    })
    expect(result.items[1].selectedOptionId).toBeNull()
    expect(result.items[1].isCorrect).toBe(false)
  })

  it('문제에 속하지 않은 option ID를 거부한다', () => {
    const question = originalQuestions[0]

    expect(() =>
      calculateStudyResult({
        sessionId: 'session-invalid-option',
        questions: [question],
        answers: [
          {
            questionId: question.id,
            selectedOptionId: 'unknown-option',
            elapsedSec: 3
          }
        ],
        durationSec: 3
      })
    ).toThrowError(StudyResultCalculationError)

    try {
      calculateStudyResult({
        sessionId: 'session-invalid-option',
        questions: [question],
        answers: [
          {
            questionId: question.id,
            selectedOptionId: 'unknown-option',
            elapsedSec: 3
          }
        ],
        durationSec: 3
      })
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(StudyResultCalculationError)
      expect((error as StudyResultCalculationError).code).toBe('INVALID_OPTION')
    }
  })
})
