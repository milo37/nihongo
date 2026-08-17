import { describe, expect, it } from 'vitest'
import {
  createWrongNoteQuestionPreview,
  toListWrongNotesResponse,
  toWrongNoteDetail,
  WrongNoteMapperIntegrityError
} from './wrongNoteMapper.js'
import type {
  WrongNoteDetailRecord,
  WrongNoteReadRecord
} from './wrongNoteRepository.js'
import { getWrongNoteResponseSchema } from '@nihongo/contracts/wrong-note/get-wrong-note'

const QUESTION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1'
const VERSION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2'
const OPTION_IDS = [
  '018f6b7a-1f4b-7d5e-8a91-4c27df9c10b1',
  '018f6b7a-1f4b-7d5e-8a91-4c27df9c10b2',
  '018f6b7a-1f4b-7d5e-8a91-4c27df9c10b3',
  '018f6b7a-1f4b-7d5e-8a91-4c27df9c10b4'
] as const

const summaryRecord = (
  overrides: Partial<WrongNoteReadRecord> = {}
): WrongNoteReadRecord => ({
  id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d1',
  questionId: QUESTION_ID,
  currentReviewQuestionVersionId: null,
  wrongCount: 3,
  correctStreak: 0,
  status: 'AGAIN',
  lastWrongAt: new Date('2026-08-15T00:00:00.000Z'),
  lastReviewedAt: new Date('2026-08-15T01:00:00.000Z'),
  nextReviewAt: new Date('2026-08-16T00:00:00.000Z'),
  questionLifecycleStatus: 'ACTIVE',
  currentPublishedVersionStatus: 'PUBLISHED',
  question: {
    id: QUESTION_ID,
    questionVersionId: VERSION_ID,
    level: 'N4',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionText: 'historical question text',
    tags: [
      {
        id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c1',
        label: 'Ｉ'
      },
      {
        id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c2',
        label: 'i'
      },
      {
        id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c3',
        label: 'İ'
      }
    ]
  },
  ...overrides
})

const detailRecord = (): WrongNoteDetailRecord => {
  const summary = summaryRecord()
  return {
    ...summary,
    question: {
      ...summary.question,
      passage: null,
      correctOptionId: OPTION_IDS[1],
      explanationKo: 'historical explanation',
      explanationJa: '履歴の説明',
      difficulty: 'HARD',
      options: OPTION_IDS.map((id, index) => ({
        id,
        label: String(index + 1),
        text: `historical option ${index + 1}`
      }))
    }
  }
}

describe('WrongNote mapper', () => {
  it('목록을 historical tag 기준 dedupe·정렬하고 lifecycle availability를 계산한다', () => {
    const response = toListWrongNotesResponse(
      [summaryRecord()],
      ['İ', 'i', '  Ｉ  ', '문 법'],
      1,
      20,
      1
    )

    expect(response.items[0]).toMatchObject({
      questionId: QUESTION_ID,
      level: 'N4',
      subject: 'GRAMMAR',
      questionType: 'GRAMMAR_SELECT',
      questionPreview: 'historical question text',
      tags: ['i', 'İ', 'Ｉ'],
      hasMemo: false,
      reviewAvailability: 'AVAILABLE'
    })
    expect(response.availableTags).toEqual(['i', 'İ', '문 법', 'Ｉ'])
    expect(
      toListWrongNotesResponse(
        [
          summaryRecord({
            questionLifecycleStatus: 'ARCHIVED',
            currentPublishedVersionStatus: null
          })
        ],
        [],
        1,
        20,
        1
      ).items[0]?.reviewAvailability
    ).toBe('ARCHIVED')
  })

  it('detail summary와 ReviewedQuestion 전체 metadata를 같은 lastWrong version에서 만든다', () => {
    const detail = getWrongNoteResponseSchema.parse(
      toWrongNoteDetail(detailRecord())
    )

    expect(detail.lastWrongQuestionVersionId).toBe(VERSION_ID)
    expect(detail.currentReviewQuestionVersionId).toBeNull()
    expect(detail.memo).toBeNull()
    expect(detail.question).toMatchObject({
      id: QUESTION_ID,
      questionVersionId: VERSION_ID,
      level: detail.wrongNote.level,
      subject: detail.wrongNote.subject,
      questionType: detail.wrongNote.questionType,
      questionText: detail.wrongNote.questionPreview,
      tags: [
        {
          id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c2',
          label: 'i'
        },
        {
          id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c3',
          label: 'İ'
        },
        {
          id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c1',
          label: 'Ｉ'
        }
      ],
      correctOptionId: OPTION_IDS[1],
      explanationKo: 'historical explanation'
    })
    expect(detail.question.options).toHaveLength(4)
  })

  it('tab/NBSP historical tag를 summary와 detail에 byte-equal하게 보존한다', () => {
    const record = detailRecord()
    const exactLabel = '\tI\u00a0'
    const detail = getWrongNoteResponseSchema.parse(
      toWrongNoteDetail({
        ...record,
        question: {
          ...record.question,
          tags: [
            {
              id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c1',
              label: exactLabel
            }
          ]
        }
      })
    )

    expect(detail.wrongNote.tags).toEqual([exactLabel])
    expect(detail.question.tags.map(({ label }) => label)).toEqual([exactLabel])
  })

  it('preview를 Unicode code point 160자로 자르고 astral 문자를 분리하지 않는다', () => {
    const source = '😀'.repeat(161)
    const preview = createWrongNoteQuestionPreview(source)

    expect([...preview]).toHaveLength(160)
    expect(preview).toBe(`${'😀'.repeat(157)}...`)
  })

  it('schedule 누락과 future review version을 fail closed한다', () => {
    expect(() =>
      toListWrongNotesResponse(
        [summaryRecord({ nextReviewAt: null })],
        [],
        1,
        20,
        1
      )
    ).toThrow(WrongNoteMapperIntegrityError)
    expect(() =>
      toListWrongNotesResponse(
        [
          summaryRecord({
            currentReviewQuestionVersionId:
              '018f6b7a-1f4b-7d5e-8a91-4c27df9c10ff'
          })
        ],
        [],
        1,
        20,
        1
      )
    ).toThrow(WrongNoteMapperIntegrityError)
  })
})
