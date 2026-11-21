import { describe, expect, it } from 'vitest'
import { publicPracticeQuestionSchema } from '@nihongo/contracts/question/get-question'
import { publicQuestionSummarySchema } from '@nihongo/contracts/question/list-questions'
import type { PublishedQuestionDetailRecord } from './questionRepository.js'
import {
  toPublicPracticeQuestion,
  toPublicQuestionSummary
} from './questionMapper.js'

const record: PublishedQuestionDetailRecord = {
  id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
  questionVersionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2',
  level: 'N5',
  subject: 'VOCABULARY',
  questionType: 'KANJI_READING',
  passage: null,
  questionText: '「山」の よみかたは どれですか。',
  difficulty: 'EASY',
  options: ['かわ', 'うみ', 'やま', 'そら'].map((text, index) => ({
    id: `018f6b7a-1f4b-7d5e-8a91-4c27df9c10b${index}`,
    label: String(index + 1),
    text
  })),
  tags: [
    {
      id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c2',
      label: '조사',
      labelJa: null
    },
    {
      id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c1',
      label: '기초 명사',
      labelJa: '基礎名詞'
    }
  ]
}

// #1059: the Japanese tag name reaches every response built from a question.
describe('question tag mapping', () => {
  it.each([
    [
      'practice question',
      toPublicPracticeQuestion,
      publicPracticeQuestionSchema
    ],
    ['question summary', toPublicQuestionSummary, publicQuestionSummarySchema]
  ] as const)('keeps labelJa in a %s', (_name, map, schema) => {
    const { tags } = schema.parse(map(record))
    expect(tags).toEqual([
      { id: record.tags[1]!.id, label: '기초 명사', labelJa: '基礎名詞' },
      { id: record.tags[0]!.id, label: '조사', labelJa: null }
    ])
  })
})

// #1182: the study session read adds the passage id and reviewed furigana;
// other reads leave both out.
describe('passage furigana mapping', () => {
  it('passes both fields through only when the record has them', () => {
    expect(toPublicPracticeQuestion(record)).not.toHaveProperty('passageId')
    const reading: PublishedQuestionDetailRecord = {
      ...record,
      subject: 'READING',
      questionType: 'SHORT_READING',
      passage: '駅の前',
      passageId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d1',
      passageFurigana: [{ start: 0, length: 1, reading: 'えき' }]
    }
    const mapped = publicPracticeQuestionSchema.parse(
      toPublicPracticeQuestion(reading)
    )
    expect(mapped.passageId).toBe(reading.passageId)
    expect(mapped.passageFurigana).toEqual(reading.passageFurigana)
    expect(
      toPublicPracticeQuestion({ ...reading, passageFurigana: null })
        .passageFurigana
    ).toBeNull()
  })
})
