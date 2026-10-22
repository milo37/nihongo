import { describe, expect, it } from 'vitest'
import { studyResultSchema } from '@nihongo/contracts/study/study-result'
import {
  toStudyResult,
  type StudyResultRecord
} from './studySubmissionMapper.js'

const id = (suffix: number): string =>
  `018f6b7a-1f4b-7d5e-8a91-${suffix.toString().padStart(12, '0')}`

const record: StudyResultRecord = {
  id: id(1),
  level: 'N5',
  subject: 'VOCABULARY',
  mode: 'RANDOM',
  totalCount: 1,
  correctCount: 0,
  incorrectCount: 1,
  correctRateBasisPoints: 0,
  durationSec: 8,
  submittedAt: new Date('2026-08-15T01:00:00.000Z'),
  questions: [
    {
      sessionQuestionId: id(2),
      ordinal: 1,
      question: {
        id: id(3),
        questionVersionId: id(4),
        level: 'N5',
        subject: 'VOCABULARY',
        questionType: 'KANJI_READING',
        passage: null,
        questionText: '「川」의 읽는 방법은 무엇입니까?',
        options: ['かわ', 'やま', 'うみ', 'そら'].map((text, index) => ({
          id: id(10 + index),
          label: String(index + 1),
          text
        })),
        difficulty: 'EASY',
        tags: [{ id: id(20), label: '한자 읽기' }],
        correctOptionId: id(10),
        explanationKo: '川은 かわ라고 읽습니다.',
        explanationJa: null
      },
      answer: {
        selectedOptionId: null,
        isCorrect: false,
        reviewEvent: { nextStatus: 'NEW' }
      }
    }
  ]
}

describe('study result mapper', () => {
  it('현재 WrongNote가 아니라 해당 Answer ReviewEvent의 historical status를 투영한다', () => {
    const result = studyResultSchema.parse(toStudyResult(record))

    expect(result.correctRate).toBe(0)
    expect(result.items[0]?.wrongNoteStatus).toBe('NEW')
    expect(result.items[0]?.question.correctOptionId).toBe(id(10))
  })

  it('첫 정답처럼 ReviewEvent가 없으면 historical status를 null로 둔다', () => {
    const result = toStudyResult({
      ...record,
      correctCount: 1,
      incorrectCount: 0,
      correctRateBasisPoints: 10_000,
      questions: [
        {
          ...record.questions[0]!,
          answer: {
            selectedOptionId: id(10),
            isCorrect: true,
            reviewEvent: null
          }
        }
      ]
    })

    expect(studyResultSchema.parse(result).items[0]?.wrongNoteStatus).toBeNull()
  })
})
