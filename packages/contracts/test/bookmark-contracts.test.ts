import { describe, expect, it } from 'vitest'
import { bookmarkSummarySchema } from '../src/bookmark/bookmark.js'
import {
  createBookmarkBodySchema,
  createBookmarkErrorCodeSchema,
  createBookmarkParamsSchema,
  createBookmarkResponseSchema
} from '../src/bookmark/create-bookmark.js'
import {
  deleteBookmarkErrorCodeSchema,
  deleteBookmarkParamsSchema
} from '../src/bookmark/delete-bookmark.js'
import {
  listBookmarksErrorCodeSchema,
  listBookmarksQuerySchema,
  listBookmarksResponseSchema
} from '../src/bookmark/list-bookmarks.js'

const id = (index: number): string =>
  `018f6b7a-1f4b-7d5e-8a91-${index.toString(16).padStart(12, '0')}`

const question = {
  id: id(1),
  questionVersionId: id(2),
  level: 'N5',
  subject: 'VOCABULARY',
  questionType: 'KANJI_READING',
  difficulty: 'EASY',
  questionTextPreview: '「川」의 읽는 법은 어느 것입니까.',
  tags: [{ id: id(3), label: '한자 읽기' }]
}

const bookmark = {
  questionId: id(1),
  question,
  availability: 'AVAILABLE',
  createdAt: '2026-08-17T01:00:00.000Z'
}

describe('Phase 4 Bookmark contracts', () => {
  it('safe public summary와 archived preservation을 허용한다', () => {
    expect(bookmarkSummarySchema.parse(bookmark)).toEqual(bookmark)
    expect(
      createBookmarkResponseSchema.parse({
        ...bookmark,
        availability: 'ARCHIVED'
      }).availability
    ).toBe('ARCHIVED')

    for (const invalid of [
      { ...bookmark, questionId: id(9) },
      { ...bookmark, userId: id(8) },
      {
        ...bookmark,
        question: { ...question, correctOptionId: id(4) }
      }
    ]) {
      expect(bookmarkSummarySchema.safeParse(invalid).success).toBe(false)
    }
  })

  it('page query와 repeated question ID array를 strict unique로 검증한다', () => {
    expect(listBookmarksQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20
    })
    expect(
      listBookmarksQuerySchema.parse({
        page: '2',
        pageSize: '10',
        questionIds: [id(1).toUpperCase(), id(2)]
      })
    ).toEqual({ page: 2, pageSize: 10, questionIds: [id(1), id(2)] })

    for (const invalid of [
      { questionIds: id(1) },
      { questionIds: `${id(1)},${id(2)}` },
      { questionIds: [] },
      { questionIds: [id(1), id(1).toUpperCase()] },
      { questionIds: Array.from({ length: 21 }, (_, index) => id(index + 1)) }
    ]) {
      expect(listBookmarksQuerySchema.safeParse(invalid).success).toBe(false)
    }
  })

  it('Bookmark page integrity와 strict create/delete params를 고정한다', () => {
    expect(
      listBookmarksResponseSchema.parse({
        items: [bookmark],
        page: 1,
        pageSize: 20,
        total: 1
      }).items
    ).toHaveLength(1)
    expect(
      listBookmarksResponseSchema.safeParse({
        items: [bookmark, bookmark],
        page: 1,
        pageSize: 20,
        total: 2
      }).success
    ).toBe(false)
    expect(
      listBookmarksResponseSchema.safeParse({
        items: [bookmark],
        page: 2,
        pageSize: 20,
        total: 1
      }).success
    ).toBe(false)
    expect(
      listBookmarksResponseSchema.safeParse({
        items: [bookmark],
        page: 1,
        pageSize: 20,
        total: 2
      }).success
    ).toBe(false)
    expect(createBookmarkParamsSchema.parse({ questionId: id(1) })).toEqual({
      questionId: id(1)
    })
    expect(deleteBookmarkParamsSchema.parse({ questionId: id(1) })).toEqual({
      questionId: id(1)
    })
    expect(createBookmarkBodySchema.parse({})).toEqual({})
    expect(createBookmarkBodySchema.safeParse({ userId: id(8) }).success).toBe(
      false
    )
  })

  it('operation별 error option set을 exact equality로 고정한다', () => {
    expect(listBookmarksErrorCodeSchema.options).toEqual([
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'VALIDATION_ERROR',
      'RATE_LIMITED',
      'INTERNAL_SERVER_ERROR',
      'SERVICE_UNAVAILABLE'
    ])
    expect(createBookmarkErrorCodeSchema.options).toEqual([
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'INVALID_JSON',
      'INVALID_REQUEST',
      'INVALID_CSRF',
      'UNTRUSTED_ORIGIN',
      'INVALID_ID',
      'RESOURCE_NOT_FOUND',
      'QUESTION_NOT_AVAILABLE',
      'RATE_LIMITED',
      'INTERNAL_SERVER_ERROR',
      'SERVICE_UNAVAILABLE'
    ])
    expect(deleteBookmarkErrorCodeSchema.options).toEqual([
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'INVALID_CSRF',
      'UNTRUSTED_ORIGIN',
      'INVALID_ID',
      'RATE_LIMITED',
      'INTERNAL_SERVER_ERROR',
      'SERVICE_UNAVAILABLE'
    ])
  })
})
