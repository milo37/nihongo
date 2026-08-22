import { describe, expect, it } from 'vitest'
import {
  createReviewQueueSearch,
  getSafeWrongNoteReturnTo,
  parseReviewQueueSearch
} from '@app/wrong-note/reviewQueueSearch'

describe('review queue URL state', () => {
  it('defaults to the canonical due/next-review first page URL', () => {
    const parsed = parseReviewQueueSearch(new URLSearchParams())

    expect(parsed).toMatchObject({
      canonicalSearch: '',
      needsReplace: false,
      query: {
        page: 1,
        pageSize: 20,
        sort: 'NEXT_REVIEW',
        view: 'DUE'
      }
    })
  })

  it('keeps valid filters while replacing unknown, duplicate, and invalid values', () => {
    const parsed = parseReviewQueueSearch(
      new URLSearchParams(
        'view=REPEATED&view=SOLVED&level=N5&sort=NOPE&page=0&owner=x'
      )
    )

    expect(parsed.needsReplace).toBe(true)
    expect(parsed.query).toMatchObject({
      level: 'N5',
      page: 1,
      sort: 'NEXT_REVIEW',
      view: 'REPEATED'
    })
    expect(parsed.canonicalSearch).toBe('view=REPEATED&level=N5')
  })

  it('serializes only canonical non-default state in a stable order', () => {
    const parsed = parseReviewQueueSearch(
      createReviewQueueSearch({
        level: 'N4',
        page: 3,
        pageSize: 20,
        questionType: 'GRAMMAR_SELECT',
        sort: 'MOST_WRONG',
        subject: 'GRAMMAR',
        tag: '문법 연결',
        view: 'REPEATED'
      })
    )

    expect(parsed.needsReplace).toBe(false)
    expect(parsed.canonicalSearch).toBe(
      'view=REPEATED&level=N4&subject=GRAMMAR&questionType=GRAMMAR_SELECT&tag=%EB%AC%B8%EB%B2%95+%EC%97%B0%EA%B2%B0&sort=MOST_WRONG&page=3'
    )
  })

  it('accepts only allowlisted internal return destinations', () => {
    expect(
      getSafeWrongNoteReturnTo(
        '/wrong-notes?view=REPEATED&sort=MOST_WRONG&page=2'
      )
    ).toBe('/wrong-notes?view=REPEATED&sort=MOST_WRONG&page=2')
    expect(
      getSafeWrongNoteReturnTo('/wrong-notes/history?status=SOLVED&page=2')
    ).toBe('/wrong-notes/history?status=SOLVED&page=2')
    expect(getSafeWrongNoteReturnTo('/dashboard')).toBe('/dashboard')
    expect(getSafeWrongNoteReturnTo('/dashboard?owner=x')).toBe('/wrong-notes')
    expect(getSafeWrongNoteReturnTo('https://evil.example/wrong-notes')).toBe(
      '/wrong-notes'
    )
    expect(getSafeWrongNoteReturnTo('/wrong-notes/not-a-return-target')).toBe(
      '/wrong-notes'
    )
  })
})
