import { describe, expect, it } from 'vitest'
import {
  getWrongNoteErrorSchema,
  getWrongNoteParamsSchema,
  getWrongNoteQuerySchema,
  getWrongNoteResponseSchema
} from '../src/wrong-note/get-wrong-note.js'
import {
  listWrongNotesErrorSchema,
  listWrongNotesQuerySchema,
  listWrongNotesResponseSchema,
  trimWrongNoteTagLabel,
  wrongNoteSummarySchema
} from '../src/wrong-note/list-wrong-notes.js'

const id = (index: number): string =>
  `018f6b7a-1f4b-7d5e-8a91-${index.toString(16).padStart(12, '0')}`

const summary = {
  questionId: id(1),
  level: 'N5',
  subject: 'VOCABULARY',
  questionType: 'KANJI_READING',
  questionPreview: '「川」の読み方はどれですか。',
  wrongCount: 1,
  correctStreak: 0,
  status: 'NEW',
  lastWrongAt: '2026-08-15T01:00:00.000Z',
  lastReviewedAt: null,
  nextReviewAt: '2026-08-16T01:00:00.000Z',
  tags: ['N5 어휘', '한자 읽기'],
  hasMemo: false,
  reviewAvailability: 'AVAILABLE'
} as const

const reviewedQuestion = {
  id: id(1),
  questionVersionId: id(2),
  level: 'N5',
  subject: 'VOCABULARY',
  questionType: 'KANJI_READING',
  passage: null,
  questionText: '「川」の読み方はどれですか。',
  options: ['かわ', 'やま', 'うみ', 'そら'].map((text, index) => ({
    id: id(10 + index),
    label: String(index + 1),
    text
  })),
  difficulty: 'EASY',
  tags: [
    { id: id(21), label: 'N5 어휘' },
    { id: id(20), label: '한자 읽기' }
  ],
  correctOptionId: id(10),
  explanationKo: '川은 かわ라고 읽습니다.',
  explanationJa: null
}

describe('wrong-note contracts', () => {
  it('filter label edge·sort·pagination을 정리하고 unknown query를 거부한다', () => {
    expect(
      listWrongNotesQuerySchema.parse({
        level: 'N5',
        subject: 'VOCABULARY',
        status: 'NEW',
        tag: ' Ｎ５   어휘 ',
        page: '2',
        pageSize: '10'
      })
    ).toEqual({
      level: 'N5',
      subject: 'VOCABULARY',
      status: 'NEW',
      tag: 'Ｎ５   어휘',
      sort: 'RECENT',
      page: 2,
      pageSize: 10
    })

    expect(
      listWrongNotesQuerySchema.safeParse({ userId: id(99) }).success
    ).toBe(false)
    expect(
      listWrongNotesQuerySchema.safeParse({ sort: 'POPULAR' }).success
    ).toBe(false)
    expect(
      listWrongNotesQuerySchema.safeParse({
        page: String(Number.MAX_SAFE_INTEGER)
      }).success
    ).toBe(true)
    expect(trimWrongNoteTagLabel(' I  İ ')).toBe('I  İ')
    expect(trimWrongNoteTagLabel('\tI\u00a0')).toBe('\tI\u00a0')
    expect(getWrongNoteQuerySchema.parse({})).toEqual({})
    expect(getWrongNoteQuerySchema.safeParse({ userId: id(99) }).success).toBe(
      false
    )
  })

  it('NEW·AGAIN·REVIEWING·SOLVED snapshot 상태와 항상 존재하는 schedule을 고정한다', () => {
    for (const valid of [
      summary,
      {
        ...summary,
        wrongCount: 2,
        status: 'AGAIN',
        lastReviewedAt: '2026-08-15T02:00:00.000Z'
      },
      {
        ...summary,
        correctStreak: 1,
        status: 'REVIEWING',
        lastReviewedAt: '2026-08-15T02:00:00.000Z'
      },
      {
        ...summary,
        correctStreak: 2,
        status: 'SOLVED',
        lastReviewedAt: '2026-08-15T02:00:00.000Z'
      }
    ]) {
      expect(wrongNoteSummarySchema.safeParse(valid).success).toBe(true)
    }

    for (const invalid of [
      { ...summary, status: 'SOLVED', correctStreak: 1 },
      { ...summary, nextReviewAt: null },
      {
        ...summary,
        status: 'REVIEWING',
        correctStreak: 1,
        lastReviewedAt: '2026-08-14T23:00:00.000Z'
      }
    ]) {
      expect(wrongNoteSummarySchema.safeParse(invalid).success).toBe(false)
    }
  })

  it('historical tag label을 정렬·중복 없이 요구하고 memo/owner 누출을 닫는다', () => {
    const page = {
      items: [summary],
      page: 1,
      pageSize: 20,
      total: 1,
      availableTags: ['N5 어휘', '한자 읽기']
    }
    expect(listWrongNotesResponseSchema.parse(page)).toEqual(page)

    for (const invalid of [
      { ...page, availableTags: ['한자 읽기', 'N5 어휘'] },
      { ...page, availableTags: ['N5 어휘', ' N5 어휘 '] },
      { ...page, items: [{ ...summary, memo: 'private' }] },
      { ...page, userId: id(90) },
      {
        ...page,
        items: [{ ...summary, questionPreview: '𠮷'.repeat(161) }]
      }
    ]) {
      expect(listWrongNotesResponseSchema.safeParse(invalid).success).toBe(
        false
      )
    }

    expect(
      listWrongNotesResponseSchema.safeParse({
        ...page,
        availableTags: ['N5 어휘', 'Ｎ５ 어휘']
      }).success
    ).toBe(true)
    expect(
      listWrongNotesResponseSchema.safeParse({
        ...page,
        availableTags: ['\tN5 어휘', 'N5 어휘']
      }).success
    ).toBe(true)
  })

  it('owned historical ReviewedQuestion과 version identity를 강제한다', () => {
    const detail = {
      wrongNote: { ...summary, reviewAvailability: 'ARCHIVED' },
      question: reviewedQuestion,
      memo: null,
      lastWrongQuestionVersionId: reviewedQuestion.questionVersionId,
      currentReviewQuestionVersionId: null
    }

    expect(
      getWrongNoteParamsSchema.parse({ questionId: id(1).toUpperCase() })
    ).toEqual({ questionId: id(1) })
    expect(getWrongNoteResponseSchema.parse(detail)).toEqual(detail)
    expect(
      getWrongNoteResponseSchema.parse({
        ...detail,
        currentReviewQuestionVersionId: id(3)
      }).currentReviewQuestionVersionId
    ).toBe(id(3))
    const exactWhitespaceLabel = '\tI\u00a0'
    expect(
      getWrongNoteResponseSchema.parse({
        ...detail,
        wrongNote: { ...detail.wrongNote, tags: [exactWhitespaceLabel] },
        question: {
          ...detail.question,
          tags: [{ id: id(20), label: exactWhitespaceLabel }]
        }
      })
    ).toMatchObject({
      wrongNote: { tags: [exactWhitespaceLabel] },
      question: { tags: [{ label: exactWhitespaceLabel }] }
    })
    expect(
      getWrongNoteResponseSchema.safeParse({
        ...detail,
        wrongNote: { ...summary, questionPreview: '𠮷'.repeat(160) }
      }).success
    ).toBe(true)

    for (const invalid of [
      { ...detail, lastWrongQuestionVersionId: id(3) },
      { ...detail, question: { ...reviewedQuestion, id: id(4) } },
      { ...detail, memo: { text: 'future memo' } },
      {
        ...detail,
        wrongNote: { ...detail.wrongNote, tags: ['다른 태그'] }
      },
      { ...detail, userId: id(90) },
      {
        ...detail,
        question: { ...reviewedQuestion, createdByUserId: id(91) }
      }
    ]) {
      expect(getWrongNoteResponseSchema.safeParse(invalid).success).toBe(false)
    }
  })

  it('operation별 error code를 닫힌 집합으로 유지한다', () => {
    const failure = {
      message: '요청을 처리할 수 없습니다.',
      requestId: id(80),
      retryable: false
    }

    expect(
      listWrongNotesErrorSchema.safeParse({
        ...failure,
        code: 'AUTH_SESSION_EXPIRED'
      }).success
    ).toBe(true)
    expect(
      listWrongNotesErrorSchema.safeParse({
        ...failure,
        code: 'RESOURCE_NOT_FOUND'
      }).success
    ).toBe(false)
    expect(
      getWrongNoteErrorSchema.safeParse({
        ...failure,
        code: 'RESOURCE_NOT_FOUND'
      }).success
    ).toBe(true)
    expect(
      getWrongNoteErrorSchema.safeParse({
        ...failure,
        code: 'VALIDATION_ERROR'
      }).success
    ).toBe(true)
  })
})
