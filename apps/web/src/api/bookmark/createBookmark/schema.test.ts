import { createBookmarkTransportResponseSchema } from '@api/bookmark/createBookmark/schema'

const questionId = '018f6b7a-1f4b-7d5e-8a91-000000000001'

const response = {
  data: {
    questionId,
    question: {
      id: questionId,
      questionVersionId: '018f6b7a-1f4b-7d5e-8a91-000000000002',
      level: 'N5',
      subject: 'VOCABULARY',
      questionType: 'KANJI_READING',
      difficulty: 'EASY',
      questionTextPreview: '문제',
      tags: [
        {
          id: '018f6b7a-1f4b-7d5e-8a91-000000000003',
          label: '태그'
        }
      ]
    },
    availability: 'AVAILABLE',
    createdAt: '2026-08-21T00:00:00.000Z'
  },
  headers: {
    'cache-control': 'private, no-store',
    'content-type': 'application/json; charset=UTF-8',
    'idempotency-replayed': null,
    location: `/api/v1/bookmarks/${questionId}`,
    'x-nihongo-practice-contract': null
  },
  status: 201
} as const

describe('create Bookmark transport schema', () => {
  it('Location을 canonical UUID로 정규화하고 response questionId와 결합한다', () => {
    const uppercaseLocation = `/api/v1/bookmarks/${questionId.toUpperCase()}`
    expect(
      createBookmarkTransportResponseSchema.parse({
        ...response,
        headers: {
          ...response.headers,
          location: uppercaseLocation
        }
      }).headers.location
    ).toBe(uppercaseLocation)

    for (const location of [
      '/api/v1/bookmarks/not-an-id',
      '/api/v1/bookmarks/018f6b7a-1f4b-7d5e-8a91-000000000099',
      `/other/${questionId}`
    ]) {
      expect(
        createBookmarkTransportResponseSchema.safeParse({
          ...response,
          headers: { ...response.headers, location }
        }).success
      ).toBe(false)
    }
  })
})
