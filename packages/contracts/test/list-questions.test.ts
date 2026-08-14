import { describe, expect, it } from 'vitest'
import {
  listQuestionsErrorSchema,
  listQuestionsQuerySchema,
  listQuestionsResponseSchema
} from '../src/question/list-questions.js'

const QUESTION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1'
const VERSION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2'
const TAG_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c1'

const response = {
  items: [
    {
      id: QUESTION_ID,
      questionVersionId: VERSION_ID,
      level: 'N3',
      subject: 'GRAMMAR',
      questionType: 'GRAMMAR_SELECT',
      difficulty: 'NORMAL',
      questionTextPreview: '会議が始まる前に、資料を確認しておきましょう。',
      tags: [{ id: TAG_ID, label: '문법 선택' }]
    }
  ],
  page: 1,
  pageSize: 20,
  total: 1
}

describe('listQuestions contract', () => {
  it('filter와 pagination 기본값을 정규화한다', () => {
    expect(
      listQuestionsQuerySchema.parse({
        level: 'N3',
        subject: 'GRAMMAR',
        type: 'GRAMMAR_SELECT',
        tag: ' 문법   선택 '
      })
    ).toEqual({
      level: 'N3',
      subject: 'GRAMMAR',
      type: 'GRAMMAR_SELECT',
      tag: '문법 선택',
      page: 1,
      pageSize: 20
    })
  })

  it('strict public summary page를 검증한다', () => {
    expect(listQuestionsResponseSchema.parse(response)).toEqual(response)

    expect(
      listQuestionsResponseSchema.safeParse({
        ...response,
        items: [
          {
            ...response.items[0],
            passage: '목록에서는 지문 전문을 보내지 않습니다.',
            options: [],
            explanationKo: '해설'
          }
        ]
      }).success
    ).toBe(false)
  })

  it('알 수 없는 query와 범위를 벗어난 pagination을 거부한다', () => {
    expect(
      listQuestionsQuerySchema.safeParse({ search: 'legacy' }).success
    ).toBe(false)
    expect(listQuestionsQuerySchema.safeParse({ page: 0 }).success).toBe(false)
    expect(listQuestionsQuerySchema.safeParse({ pageSize: 101 }).success).toBe(
      false
    )
  })

  it('operation별 오류 code만 허용한다', () => {
    expect(
      listQuestionsErrorSchema.safeParse({
        code: 'RESOURCE_NOT_FOUND',
        message: '목록 조회에는 없는 코드입니다.',
        requestId: QUESTION_ID,
        retryable: false
      }).success
    ).toBe(false)
  })
})
