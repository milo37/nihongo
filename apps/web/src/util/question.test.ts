import { describe, expect, it } from 'vitest'
import { originalQuestions } from '@mocks/data/questions'
import { toPracticeQuestion } from '@util/question'

describe('toPracticeQuestion', () => {
  it('정답, 해설, 관리자 상태를 공개 모델에서 제거한다', () => {
    const practiceQuestion = toPracticeQuestion(originalQuestions[0])
    const serialized = JSON.stringify(practiceQuestion)

    expect(practiceQuestion).not.toHaveProperty('explanationKo')
    expect(practiceQuestion).not.toHaveProperty('explanationJa')
    expect(practiceQuestion).not.toHaveProperty('status')
    expect(practiceQuestion).not.toHaveProperty('sourceType')
    expect(serialized).not.toContain('isCorrect')
    expect(practiceQuestion.options).toHaveLength(4)
  })
})
