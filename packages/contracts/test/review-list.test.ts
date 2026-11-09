import { describe, expect, it } from 'vitest'
import {
  listReviewListQuerySchema,
  listReviewListResponseSchema,
  toWrongNoteReviewState
} from '../src/wrong-note/list-review-list.js'

const item = (index: number, reviewed = false) => ({
  questionId: `018f6b7a-1f4b-7d5e-8a91-4c27df9c10a${index}`,
  currentQuestionVersionId: `018f6b7a-1f4b-7d5e-8a91-4c27df9c10b${index}`,
  level: 'N5',
  subject: 'GRAMMAR',
  questionType: 'GRAMMAR_SELECT',
  questionPreview: 'わたしは 毎朝 パン（　）食べます。',
  reviewState: reviewed ? 'REVIEWED' : 'TO_REVIEW',
  wrongCount: 1,
  lastWrongAt: '2026-11-09T01:00:00.000Z',
  lastReviewedAt: reviewed ? '2026-11-10T01:00:00.000Z' : null
})

const page = {
  items: [item(1), item(2)],
  page: 1,
  pageSize: 20,
  total: 2,
  state: 'TO_REVIEW',
  counts: { toReview: 2, reviewed: 1 },
  oldestToReview: { level: 'N5', subject: 'GRAMMAR' },
  observedAt: '2026-11-10T02:00:00.000Z'
}

describe('review list contract (JLP-812)', () => {
  it('groups the four stored statuses into two states', () => {
    expect(toWrongNoteReviewState('NEW')).toBe('TO_REVIEW')
    expect(toWrongNoteReviewState('AGAIN')).toBe('TO_REVIEW')
    expect(toWrongNoteReviewState('REVIEWING')).toBe('REVIEWED')
    expect(toWrongNoteReviewState('SOLVED')).toBe('REVIEWED')
  })

  it('takes a tab and one level, nothing else', () => {
    expect(listReviewListQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      state: 'TO_REVIEW'
    })
    expect(
      listReviewListQuerySchema.parse({ state: 'REVIEWED', level: 'N3' })
    ).toMatchObject({ state: 'REVIEWED', level: 'N3' })
    for (const query of [
      { state: 'DUE' },
      { sort: 'RECENT' },
      { subject: 'GRAMMAR' }
    ]) {
      expect(listReviewListQuerySchema.safeParse(query).success).toBe(false)
    }
  })

  it('accepts a page of the chosen tab', () => {
    expect(listReviewListResponseSchema.parse(page)).toEqual(page)
    expect(
      listReviewListResponseSchema.parse({
        ...page,
        items: [item(3, true)],
        total: 1,
        state: 'REVIEWED'
      }).items
    ).toHaveLength(1)
  })

  it.each([
    ['an item of the other tab', { items: [item(1), item(2, true)] }],
    ['a total that is not the tab count', { total: 3 }],
    [
      'a start without questions to review',
      { counts: { toReview: 0, reviewed: 1 }, total: 0, items: [] }
    ],
    ['no start with questions to review', { oldestToReview: null }],
    ['the same question twice', { items: [item(1), item(1)] }]
  ])('rejects %s', (_label, change) => {
    expect(
      listReviewListResponseSchema.safeParse({ ...page, ...change }).success
    ).toBe(false)
  })

  it('needs the right-answer time on a reviewed item', () => {
    expect(
      listReviewListResponseSchema.safeParse({
        ...page,
        state: 'REVIEWED',
        total: 1,
        items: [{ ...item(3, true), lastReviewedAt: null }]
      }).success
    ).toBe(false)
  })
})
