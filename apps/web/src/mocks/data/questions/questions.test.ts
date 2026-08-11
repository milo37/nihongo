import { describe, expect, it } from 'vitest'
import {
  LEVELS,
  SUBJECTS,
  type JlptLevel,
  type QuestionSubject
} from '@common/types/domain'
import { originalQuestions } from '@mocks/data/questions'

const expectedCountBySubject: Record<QuestionSubject, number> = {
  VOCABULARY: 5,
  GRAMMAR: 5,
  READING: 3
}

describe('originalQuestions', () => {
  it('급수별 어휘 5, 문법 5, 독해 3으로 총 65문제를 제공한다', () => {
    expect(originalQuestions).toHaveLength(65)

    for (const level of LEVELS) {
      for (const subject of SUBJECTS) {
        expect(
          originalQuestions.filter(
            (question) =>
              question.level === level && question.subject === subject
          )
        ).toHaveLength(expectedCountBySubject[subject])
      }
    }
  })

  it('ID, 보기, 정답, 해설, 태그, 독해 지문 불변식을 만족한다', () => {
    const questionIds = new Set<string>()
    const optionIds = new Set<string>()

    for (const question of originalQuestions) {
      expect(questionIds.has(question.id)).toBe(false)
      questionIds.add(question.id)
      expect(question.options).toHaveLength(4)
      expect(
        question.options.filter(({ isCorrect }) => isCorrect)
      ).toHaveLength(1)
      expect(question.explanationKo.trim().length).toBeGreaterThan(0)
      expect(question.tags.length).toBeGreaterThan(0)
      expect(question.sourceType).toBe('ORIGINAL')
      expect(question.status).toBe('PUBLISHED')

      if (question.subject === 'READING') {
        expect(question.passage?.trim().length).toBeGreaterThan(0)
      }

      for (const option of question.options) {
        expect(optionIds.has(option.id)).toBe(false)
        optionIds.add(option.id)
      }
    }

    expect(questionIds.size).toBe(65)
    expect(optionIds.size).toBe(260)
  })

  it('정답 위치가 급수와 과목에 걸쳐 고르게 분포한다', () => {
    const overallPositions = [0, 0, 0, 0]
    const positionsByLevel = new Map<JlptLevel, number[]>()
    const positionsBySubject = new Map<QuestionSubject, number[]>()

    for (const level of LEVELS) {
      positionsByLevel.set(level, [0, 0, 0, 0])
    }
    for (const subject of SUBJECTS) {
      positionsBySubject.set(subject, [0, 0, 0, 0])
    }

    for (const question of originalQuestions) {
      const correctIndex = question.options.findIndex(
        ({ isCorrect }) => isCorrect
      )
      overallPositions[correctIndex] += 1
      positionsByLevel.get(question.level)![correctIndex] += 1
      positionsBySubject.get(question.subject)![correctIndex] += 1
    }

    expect(overallPositions.every((count) => count > 0)).toBe(true)
    expect(
      Math.max(...overallPositions) - Math.min(...overallPositions)
    ).toBeLessThanOrEqual(1)
    for (const positions of positionsByLevel.values()) {
      expect(
        Math.max(...positions) - Math.min(...positions)
      ).toBeLessThanOrEqual(1)
    }
    for (const positions of positionsBySubject.values()) {
      expect(
        Math.max(...positions) - Math.min(...positions)
      ).toBeLessThanOrEqual(1)
    }
  })
})
