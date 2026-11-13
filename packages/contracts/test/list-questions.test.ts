import { describe, expect, it } from 'vitest'
import { publicQuestionSummarySchema } from '../src/question/list-questions.js'

const QUESTION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1'
const VERSION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2'
const TAG_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c1'

const summary = {
  id: QUESTION_ID,
  questionVersionId: VERSION_ID,
  level: 'N3',
  subject: 'GRAMMAR',
  questionType: 'GRAMMAR_SELECT',
  difficulty: 'NORMAL',
  questionTextPreview: '会議が始まる前に、資料を確認しておきましょう。',
  tags: [{ id: TAG_ID, label: '문법 선택' }]
}

describe('public question summary contract', () => {
  it('strict public summary를 검증한다', () => {
    expect(publicQuestionSummarySchema.parse(summary)).toEqual(summary)

    expect(
      publicQuestionSummarySchema.safeParse({
        ...summary,
        passage: '요약에서는 지문 전문을 보내지 않습니다.',
        options: [],
        explanationKo: '해설'
      }).success
    ).toBe(false)
  })
})
