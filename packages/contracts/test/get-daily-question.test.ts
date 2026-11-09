import { describe, expect, it } from 'vitest'
import {
  getDailyQuestionErrorSchema,
  getDailyQuestionQuerySchema,
  getDailyQuestionResponseSchema
} from '../src/question/get-daily-question.js'

const optionId = (index: number): string =>
  `018f6b7a-1f4b-7d5e-8a91-4c27df9c10b${index}`

const response = {
  date: '2026-11-10',
  level: 'N5',
  question: {
    id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
    questionVersionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2',
    level: 'N5',
    subject: 'VOCABULARY',
    questionType: 'KANJI_READING',
    passage: null,
    questionText: '「山」の よみかたは どれですか。',
    options: ['かわ', 'うみ', 'やま', 'そら'].map((text, index) => ({
      id: optionId(index),
      label: String(index + 1),
      text
    })),
    difficulty: 'EASY',
    tags: [{ id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c1', label: '기초 명사' }],
    correctOptionId: optionId(2),
    explanationKo: '핵심: 山 = やま(산)',
    explanationJa: null
  }
}

describe('getDailyQuestion contract (JLP-815)', () => {
  it('accepts one level and nothing else', () => {
    expect(getDailyQuestionQuerySchema.parse({ level: 'N3' })).toEqual({
      level: 'N3'
    })
    expect(getDailyQuestionQuerySchema.safeParse({}).success).toBe(false)
    expect(getDailyQuestionQuerySchema.safeParse({ level: 'N6' }).success).toBe(
      false
    )
    expect(
      getDailyQuestionQuerySchema.safeParse({ level: 'N5', subject: 'GRAMMAR' })
        .success
    ).toBe(false)
  })

  it('returns the question with its answer and explanations', () => {
    expect(getDailyQuestionResponseSchema.parse(response)).toEqual(response)
  })

  it('rejects another level, a reading question or a bad date', () => {
    expect(
      getDailyQuestionResponseSchema.safeParse({ ...response, level: 'N4' })
        .success
    ).toBe(false)
    expect(
      getDailyQuestionResponseSchema.safeParse({
        ...response,
        question: {
          ...response.question,
          subject: 'READING',
          questionType: 'SHORT_READING',
          passage: '本文'
        }
      }).success
    ).toBe(false)
    expect(
      getDailyQuestionResponseSchema.safeParse({
        ...response,
        date: '2026-02-30'
      }).success
    ).toBe(false)
  })

  it('names the empty level as NO_ELIGIBLE_QUESTIONS', () => {
    expect(
      getDailyQuestionErrorSchema.safeParse({
        code: 'NO_ELIGIBLE_QUESTIONS',
        message: '오늘의 문제가 없습니다.',
        requestId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d1',
        retryable: false
      }).success
    ).toBe(true)
  })
})
