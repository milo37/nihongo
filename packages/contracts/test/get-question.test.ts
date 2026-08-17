import { describe, expect, it } from 'vitest'
import {
  getQuestionErrorSchema,
  getQuestionParamsSchema,
  getQuestionResponseSchema,
  normalizeQuestionTagText
} from '../src/question/get-question.js'

const QUESTION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1'
const VERSION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2'

const response = {
  id: QUESTION_ID,
  questionVersionId: VERSION_ID,
  level: 'N5',
  subject: 'VOCABULARY',
  questionType: 'KANJI_READING',
  passage: null,
  questionText: '「川」の読み方はどれですか。',
  options: ['かわ', 'やま', 'うみ', 'そら'].map((text, index) => ({
    id: `018f6b7a-1f4b-7d5e-8a91-4c27df9c10b${index}`,
    label: String(index + 1),
    text
  })),
  difficulty: 'EASY',
  tags: [
    {
      id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c1',
      label: '한자 읽기'
    }
  ]
}

describe('getQuestion contract', () => {
  it('태그를 locale 비의존 NFKC·whitespace·소문자로 정규화한다', () => {
    expect(normalizeQuestionTagText(' Ｉ  İ ')).toBe('i i̇')
  })

  it('UUID path parameter와 public response를 검증한다', () => {
    expect(getQuestionParamsSchema.parse({ questionId: QUESTION_ID })).toEqual({
      questionId: QUESTION_ID
    })
    expect(getQuestionResponseSchema.parse(response)).toEqual(response)
  })

  it('정답·해설·관리자 필드가 섞인 payload를 거부한다', () => {
    expect(
      getQuestionResponseSchema.safeParse({
        ...response,
        correctOptionId: response.options[0]?.id,
        explanationKo: '정답 해설',
        status: 'PUBLISHED'
      }).success
    ).toBe(false)

    expect(
      getQuestionResponseSchema.safeParse({
        ...response,
        options: response.options.map((option, index) => ({
          ...option,
          isCorrect: index === 0
        }))
      }).success
    ).toBe(false)
  })

  it('독해 문제는 비어 있지 않은 passage를 요구한다', () => {
    for (const passage of [null, '   ']) {
      expect(
        getQuestionResponseSchema.safeParse({
          ...response,
          subject: 'READING',
          questionType: 'SHORT_READING',
          passage
        }).success
      ).toBe(false)
    }

    expect(
      getQuestionResponseSchema.safeParse({
        ...response,
        subject: 'READING',
        questionType: 'SHORT_READING',
        passage: '駅前の図書館は、月曜日が休みです。'
      }).success
    ).toBe(true)
  })

  it('보기 순서와 ID 및 태그 identity 중복을 거부한다', () => {
    expect(
      getQuestionResponseSchema.safeParse({
        ...response,
        options: response.options.map((option, index) => ({
          ...option,
          label: String(4 - index)
        }))
      }).success
    ).toBe(false)

    expect(
      getQuestionResponseSchema.safeParse({
        ...response,
        options: response.options.map((option) => ({
          ...option,
          id: response.options[0]?.id
        }))
      }).success
    ).toBe(false)

    expect(
      getQuestionResponseSchema.safeParse({
        ...response,
        tags: [response.tags[0], response.tags[0]]
      }).success
    ).toBe(false)
  })

  it('operation별 오류 code 외의 값을 거부한다', () => {
    expect(
      getQuestionErrorSchema.safeParse({
        code: 'ADMIN_REQUIRED',
        message: '관리자 권한이 필요합니다.',
        requestId: QUESTION_ID,
        retryable: false
      }).success
    ).toBe(false)
  })
})
