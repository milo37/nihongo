import { describe, expect, it } from 'vitest'
import { buildQuestionAggregateSeed } from '../../prisma/seed-data/buildQuestionSeed.js'
import { toStableSeedUuid } from '../../prisma/seed-data/id.js'
import { originalQuestionSeeds } from '../../prisma/seed-data/questions/index.js'
import { buildAllQuestionSeeds } from '../../prisma/seedQuestionCatalog.js'

const EXPECTED_SUBJECT_COUNTS = {
  VOCABULARY: 5,
  GRAMMAR: 5,
  READING: 3
} as const

describe('question seed catalog', () => {
  it('65문제와 급수별 5·5·3 분포를 고정한다', () => {
    const aggregates = buildAllQuestionSeeds()

    expect(aggregates).toHaveLength(65)

    for (const level of ['N5', 'N4', 'N3', 'N2', 'N1'] as const) {
      for (const subject of ['VOCABULARY', 'GRAMMAR', 'READING'] as const) {
        expect(
          aggregates.filter(
            (question) =>
              question.level === level && question.subject === subject
          )
        ).toHaveLength(EXPECTED_SUBJECT_COUNTS[subject])
      }
    }
  })

  it('전역 ID와 문항 불변식을 만족한다', () => {
    const aggregates = buildAllQuestionSeeds()
    const questionIds = new Set<string>()
    const versionIds = new Set<string>()
    const optionIds = new Set<string>()

    for (const question of aggregates) {
      expect(questionIds.has(question.questionId)).toBe(false)
      expect(versionIds.has(question.versionId)).toBe(false)
      questionIds.add(question.questionId)
      versionIds.add(question.versionId)
      expect(question.options).toHaveLength(4)
      expect(question.tags.length).toBeGreaterThan(0)
      expect(
        question.options.some(({ id }) => id === question.correctOptionId)
      ).toBe(true)

      if (question.subject === 'READING') {
        expect(question.passage?.trim().length).toBeGreaterThan(0)
      }

      question.options.forEach((option, index) => {
        expect(option.id).toMatch(/^[0-9a-f-]{36}$/)
        expect(option.label).toBe(String(index + 1))
        expect(optionIds.has(option.id)).toBe(false)
        optionIds.add(option.id)
      })
    }

    expect(optionIds.size).toBe(260)
  })

  it('내용 변경은 logical ID를 유지하고 version과 option ID를 바꾼다', () => {
    const source = originalQuestionSeeds[0]

    if (!source) {
      throw new Error('Question seed fixture가 필요합니다.')
    }

    const first = buildQuestionAggregateSeed(source, toStableSeedUuid)
    const second = buildQuestionAggregateSeed(
      { ...source, questionText: source.questionText + ' 수정' },
      toStableSeedUuid
    )

    expect(second.questionId).toBe(first.questionId)
    expect(second.versionId).not.toBe(first.versionId)
    expect(second.options.map(({ id }) => id)).not.toEqual(
      first.options.map(({ id }) => id)
    )
  })
})
