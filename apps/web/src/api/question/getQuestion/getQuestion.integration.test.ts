import { describe, expect, it } from 'vitest'
import { getQuestion } from '@api/question/getQuestion'
import { isApiError } from '@api/config'
import { getContractQuestionId } from '@mocks/adapters/questionContractAdapter'
import {
  mockDatabase,
  type AdminQuestionInput
} from '@mocks/repository/mockDatabase'

const FORBIDDEN_KEYS = new Set([
  'correctOptionId',
  'isCorrect',
  'explanationKo',
  'explanationJa',
  'status',
  'sourceType'
])

const collectKeys = (value: unknown, keys: Set<string>): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, keys)
    }

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

describe('getQuestion MSW contract integration', () => {
  it('공유 계약으로 검증된 공개 문제만 반환한다', async () => {
    const question = await getQuestion(
      getContractQuestionId('n5-vocabulary-01')
    )
    const keys = new Set<string>()
    collectKeys(question, keys)

    expect(question.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(question.questionVersionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(question.options).toHaveLength(4)

    for (const forbiddenKey of FORBIDDEN_KEYS) {
      expect(keys.has(forbiddenKey)).toBe(false)
    }
  })

  it('잘못된 ID는 네트워크 요청 전에 거부한다', () => {
    expect(() => getQuestion('n5-vocabulary-01')).toThrow()
  })

  it('존재하지 않는 UUID는 404로 분류한다', async () => {
    try {
      await getQuestion('018f6b7a-1f4b-7d5e-8a91-4c27df9c1999')
      expect.unreachable('요청이 실패해야 합니다.')
    } catch (error: unknown) {
      expect(isApiError(error)).toBe(true)

      if (isApiError(error)) {
        expect(error.status).toBe(404)
        expect(error.isNotFoundError).toBe(true)
      }
    }
  })

  it('CMS에서 생성·수정한 공개 문제를 stable ID와 새 version ID로 조회한다', async () => {
    const input = {
      level: 'N5',
      subject: 'VOCABULARY',
      questionType: 'CONTEXT_VOCABULARY',
      passage: null,
      questionText: '「ゆっくり」の使い方として正しいものはどれですか。',
      options: [
        { label: '1', text: 'ゆっくり歩きます。' },
        { label: '2', text: 'ゆっくり赤いです。' },
        { label: '3', text: 'ゆっくり本です。' },
        { label: '4', text: 'ゆっくり学生です。' }
      ],
      correctOptionId: '1',
      explanationKo: '천천히 걷는다는 표현이 자연스럽습니다.',
      explanationJa: null,
      difficulty: 'EASY',
      tags: ['부사'],
      status: 'PUBLISHED'
    } satisfies AdminQuestionInput
    const created = mockDatabase.createQuestion(input)
    const contractId = getContractQuestionId(created.id)
    const first = await getQuestion(contractId)

    mockDatabase.updateQuestion(created.id, {
      ...input,
      questionText: '「ゆっくり」の自然な使い方はどれですか。'
    })
    const second = await getQuestion(contractId)

    expect(second.id).toBe(first.id)
    expect(second.questionVersionId).not.toBe(first.questionVersionId)
    expect(second.options.map(({ id }) => id)).not.toEqual(
      first.options.map(({ id }) => id)
    )
    expect(second.questionText).toBe('「ゆっくり」の自然な使い方はどれですか。')
  })

  it('공개 중지된 문제는 canonical 404로 응답한다', async () => {
    const source = mockDatabase.getAdminQuestion('n5-vocabulary-01')
    const correctOption = source.options.find(({ isCorrect }) => isCorrect)

    if (!correctOption) {
      throw new Error('테스트 문제의 정답 보기가 필요합니다.')
    }

    mockDatabase.updateQuestion(source.id, {
      level: source.level,
      subject: source.subject,
      questionType: source.questionType,
      passage: source.passage,
      questionText: source.questionText,
      options: source.options.map(({ id, label, text }) => ({
        id,
        label,
        text
      })),
      correctOptionId: correctOption.id,
      explanationKo: source.explanationKo,
      explanationJa: source.explanationJa,
      difficulty: source.difficulty,
      tags: source.tags,
      status: 'DRAFT'
    })

    try {
      await getQuestion(getContractQuestionId(source.id))
      expect.unreachable('요청이 실패해야 합니다.')
    } catch (error: unknown) {
      expect(isApiError(error)).toBe(true)

      if (isApiError(error)) {
        expect(error.status).toBe(404)
        expect(error.isNotFoundError).toBe(true)
      }
    }
  })
})
