import { describe, expect, it } from 'vitest'
import { spacedTagQuestionListCase } from '@nihongo/contracts/testing/question-read-conformance'
import { listQuestion } from '@api/question/listQuestion'

const FORBIDDEN_KEYS = new Set([
  'correctOptionId',
  'isCorrect',
  'explanationKo',
  'explanationJa',
  'passage',
  'options',
  'status',
  'sourceType'
])

const collectKeys = (value: unknown, keys: Set<string>): void => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys))
    return
  }

  if (typeof value !== 'object' || value === null) {
    return
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    keys.add(key)
    collectKeys(nestedValue, keys)
  }
}

describe('listQuestion MSW contract integration', () => {
  it('canonical summary와 stable pagination만 반환한다', async () => {
    const result = await listQuestion({
      level: 'N5',
      subject: 'VOCABULARY',
      page: 1,
      pageSize: 2
    })
    const keys = new Set<string>()
    collectKeys(result, keys)

    expect(result.total).toBe(5)
    expect(result.items).toHaveLength(2)
    expect(result.items.map(({ id }) => id)).toEqual(
      result.items.map(({ id }) => id).toSorted()
    )

    for (const forbiddenKey of FORBIDDEN_KEYS) {
      expect(keys.has(forbiddenKey)).toBe(false)
    }
  })

  it('type과 tag filter를 적용한다', async () => {
    const byType = await listQuestion({
      type: 'KANJI_READING',
      pageSize: 100
    })
    const byTag = await listQuestion(spacedTagQuestionListCase.query)

    expect(byType.items.length).toBeGreaterThan(0)
    expect(
      byType.items.every(({ questionType }) => questionType === 'KANJI_READING')
    ).toBe(true)
    expect(byTag.total).toBe(spacedTagQuestionListCase.expectedTotal)
    expect(byTag.items.map(({ id }) => id)).toEqual(
      spacedTagQuestionListCase.expectedQuestionIds
    )
    expect(
      byTag.items.every(({ tags }) =>
        tags.some(({ label }) => label === '한자 읽기')
      )
    ).toBe(true)
  })

  it('범위를 벗어난 page는 total과 빈 items를 반환한다', async () => {
    const result = await listQuestion({ page: 999, pageSize: 20 })

    expect(result.total).toBe(65)
    expect(result.items).toEqual([])
    expect(result.page).toBe(999)
  })

  it('잘못된 query는 요청 전에 거부한다', () => {
    expect(() => listQuestion({ page: 0 })).toThrow()
  })
})
