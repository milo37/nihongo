import { describe, expect, it } from 'vitest'
import {
  createStudySessionBodySchema,
  createStudySessionV2BodySchema
} from '../src/study/create-study-session.js'
import {
  createTargetedReviewSessionBodySchema,
  createTargetedReviewSessionCanonicalMaterial,
  createTargetedReviewSessionErrorCodeSchema,
  createTargetedReviewSessionHeadersSchema,
  createTargetedReviewSessionLocationSchema,
  createTargetedReviewSessionParamsSchema,
  createTargetedReviewSessionQuerySchema,
  createTargetedReviewSessionResponseForQuestionSchema,
  createTargetedReviewSessionResponseSchema
} from '../src/wrong-note/create-targeted-review-session.js'
import {
  createGetWrongNoteMemoResponseSchema,
  getWrongNoteMemoErrorCodeSchema,
  getWrongNoteMemoParamsSchema,
  getWrongNoteMemoQuerySchema,
  getWrongNoteMemoResponseSchema
} from '../src/wrong-note/get-wrong-note-memo.js'
import {
  decodeReviewEventCursor,
  encodeReviewEventCursor,
  listReviewEventsErrorCodeSchema,
  listReviewEventsQuerySchema,
  listReviewEventsResponseSchema,
  reviewEventCursorMaximumLength,
  reviewEventCursorTokenSchema,
  reviewEventHistoryItemSchema
} from '../src/wrong-note/list-review-events.js'
import {
  compareReviewQueueItems,
  listReviewQueueErrorCodeSchema,
  listReviewQueueQuerySchema,
  listReviewQueueResponseSchema,
  reviewQueueItemSchema
} from '../src/wrong-note/list-review-queue.js'
import {
  createUpdateWrongNoteMemoResponseSchema,
  updateWrongNoteMemoBodySchema,
  updateWrongNoteMemoErrorCodeSchema,
  updateWrongNoteMemoResponseSchema
} from '../src/wrong-note/update-wrong-note-memo.js'
import {
  normalizeUserMemoText,
  userMemoMaximumCodePoints,
  userMemoSchema
} from '../src/wrong-note/user-memo.js'
import { reviewCenterConformanceFixture } from '../src/testing/review-center-conformance.js'

const id = (index: number): string =>
  `018f6b7a-1f4b-7d5e-8a91-${index.toString(16).padStart(12, '0')}`

const createBody = {
  level: 'N5',
  subject: 'VOCABULARY',
  mode: 'DAILY_REVIEW',
  count: 20
} as const

describe('Phase 5 review center contracts', () => {
  it('headerless v1 body를 보존하고 reviewFilter를 v2 review mode에만 허용한다', () => {
    expect(createStudySessionBodySchema.parse(createBody)).toEqual(createBody)
    expect(
      createStudySessionBodySchema.safeParse({
        ...createBody,
        reviewFilter: { questionType: 'KANJI_READING' }
      }).success
    ).toBe(false)

    expect(
      createStudySessionV2BodySchema.parse({
        ...createBody,
        reviewFilter: {
          questionType: 'KANJI_READING',
          tag: ' 한자 읽기 '
        }
      })
    ).toEqual({
      ...createBody,
      reviewFilter: {
        questionType: 'KANJI_READING',
        tag: '한자 읽기'
      }
    })

    expect(
      createStudySessionV2BodySchema.parse({
        ...createBody,
        reviewFilter: {}
      })
    ).toEqual({ ...createBody, reviewFilter: {} })

    for (const mode of ['RANDOM', 'WEAKNESS', 'BOOKMARK'] as const) {
      expect(
        createStudySessionV2BodySchema.safeParse({
          ...createBody,
          mode,
          reviewFilter: { tag: '한자 읽기' }
        }).success
      ).toBe(false)
    }

    expect(
      createStudySessionV2BodySchema.safeParse({
        ...createBody,
        questionIds: [id(1)]
      }).success
    ).toBe(false)
  })

  it('queue query default·filter·safe integer 경계를 strict하게 고정한다', () => {
    expect(
      listReviewQueueQuerySchema.parse({
        level: 'N5',
        subject: 'VOCABULARY',
        questionType: 'KANJI_READING',
        tag: ' 한자 읽기 ',
        page: '2',
        pageSize: '10'
      })
    ).toEqual({
      view: 'DUE',
      level: 'N5',
      subject: 'VOCABULARY',
      questionType: 'KANJI_READING',
      tag: '한자 읽기',
      sort: 'NEXT_REVIEW',
      page: 2,
      pageSize: 10
    })

    expect(
      listReviewQueueQuerySchema.parse({
        view: 'SOLVED',
        sort: 'RECENT'
      })
    ).toMatchObject({ view: 'SOLVED', sort: 'RECENT' })

    for (const invalid of [
      { page: String(Number.MAX_SAFE_INTEGER + 1) },
      { pageSize: 101 },
      { view: 'ALL' },
      { sort: 'OLDEST' },
      { userId: id(99) }
    ]) {
      expect(listReviewQueueQuerySchema.safeParse(invalid).success).toBe(false)
    }
  })

  it('queue page·state·tag·count와 beyond-last page를 exact하게 검증한다', () => {
    const fixture = reviewCenterConformanceFixture.queue
    expect(listReviewQueueResponseSchema.parse(fixture)).toEqual(fixture)
    expect(
      listReviewQueueResponseSchema.parse({
        ...fixture,
        items: [],
        page: 2
      })
    ).toMatchObject({ items: [], page: 2, total: 1 })

    for (const invalid of [
      { ...fixture, items: [] },
      {
        ...fixture,
        counts: { ...fixture.counts, due: Number.MAX_SAFE_INTEGER + 1 }
      },
      {
        ...fixture,
        items: [{ ...fixture.items[0], status: 'SOLVED', correctStreak: 1 }]
      },
      {
        ...fixture,
        items: [fixture.items[0], fixture.items[0]],
        total: 2
      },
      {
        ...fixture,
        availableTags: ['한자 읽기', 'N5 어휘']
      },
      {
        ...fixture,
        availableTags: ['N5 어휘']
      },
      {
        ...fixture,
        items: [{ ...fixture.items[0], memo: 'private' }]
      }
    ]) {
      expect(listReviewQueueResponseSchema.safeParse(invalid).success).toBe(
        false
      )
    }
  })

  it('queue comparator가 NEXT_REVIEW·MOST_WRONG·RECENT tie-break를 고정한다', () => {
    const left = reviewQueueItemSchema.parse(
      reviewCenterConformanceFixture.queue.items[0]
    )
    const later = reviewQueueItemSchema.parse({
      ...left,
      questionId: id(90),
      currentQuestionVersionId: id(91),
      nextReviewAt: '2026-08-23T02:00:00.000Z',
      lastWrongAt: '2026-08-22T01:00:00.000Z',
      lastReviewedAt: '2026-08-22T02:00:00.000Z',
      wrongCount: 3
    })

    expect(compareReviewQueueItems(left, later, 'NEXT_REVIEW')).toBeLessThan(0)
    expect(compareReviewQueueItems(left, later, 'MOST_WRONG')).toBeGreaterThan(
      0
    )
    expect(compareReviewQueueItems(left, later, 'RECENT')).toBeGreaterThan(0)
  })

  it('memo는 ECMAScript trim·Unicode code point 2000 경계와 delete null을 고정한다', () => {
    expect(normalizeUserMemoText('\u3000 복습 메모 \n')).toBe('복습 메모')
    expect(updateWrongNoteMemoBodySchema.parse({ memo: ' \t\n ' })).toEqual({
      memo: null
    })
    expect(updateWrongNoteMemoBodySchema.parse({ memo: null })).toEqual({
      memo: null
    })
    expect(
      updateWrongNoteMemoBodySchema.parse({
        memo: ` ${'𠮷'.repeat(userMemoMaximumCodePoints)} `
      }).memo
    ).toBe('𠮷'.repeat(userMemoMaximumCodePoints))
    expect(
      updateWrongNoteMemoBodySchema.safeParse({
        memo: '𠮷'.repeat(userMemoMaximumCodePoints + 1)
      }).success
    ).toBe(false)
    expect(
      updateWrongNoteMemoBodySchema.safeParse({ memo: '유효\u0000하지 않음' })
        .success
    ).toBe(false)
    expect(
      updateWrongNoteMemoBodySchema.safeParse({ memo: '\ud800' }).success
    ).toBe(false)
    expect(
      updateWrongNoteMemoBodySchema.safeParse({
        memo: 'valid',
        userId: id(99)
      }).success
    ).toBe(false)
  })

  it('memo DTO·GET query·timestamp를 strict하게 검증한다', () => {
    const memo = reviewCenterConformanceFixture.memo
    expect(userMemoSchema.parse(memo)).toEqual(memo)
    expect(getWrongNoteMemoResponseSchema.parse(memo)).toEqual(memo)
    expect(updateWrongNoteMemoResponseSchema.parse(null)).toBeNull()
    expect(
      createGetWrongNoteMemoResponseSchema(memo.questionId).parse(memo)
    ).toEqual(memo)
    expect(
      createUpdateWrongNoteMemoResponseSchema(memo.questionId).parse(null)
    ).toBeNull()
    expect(
      createGetWrongNoteMemoResponseSchema(memo.questionId).safeParse({
        ...memo,
        questionId: id(99)
      }).success
    ).toBe(false)
    expect(
      createUpdateWrongNoteMemoResponseSchema(memo.questionId).safeParse({
        ...memo,
        questionId: id(99)
      }).success
    ).toBe(false)
    expect(getWrongNoteMemoQuerySchema.parse({})).toEqual({})
    expect(
      getWrongNoteMemoParamsSchema.parse({
        questionId: memo.questionId.toUpperCase()
      })
    ).toEqual({ questionId: memo.questionId })

    for (const invalid of [
      { ...memo, text: ` ${memo.text}` },
      { ...memo, text: '' },
      { ...memo, text: '유효\u0000하지 않음' },
      { ...memo, text: '\udc00' },
      { ...memo, updatedAt: '2026-08-21T02:00:00.000Z' },
      { ...memo, ownerId: id(99) }
    ]) {
      expect(userMemoSchema.safeParse(invalid).success).toBe(false)
    }
    expect(
      getWrongNoteMemoQuerySchema.safeParse({ includeOwner: true }).success
    ).toBe(false)
  })

  it('ReviewEvent cursor를 canonical JSON·base64url·256자로 닫는다', () => {
    const cursor = {
      v: 1 as const,
      occurredAt: '2026-08-21T02:00:00+00:00',
      id: id(31).toUpperCase()
    }
    const encoded = encodeReviewEventCursor(cursor)
    expect(encoded).not.toContain('=')
    expect(encoded.length).toBeLessThanOrEqual(reviewEventCursorMaximumLength)
    expect(decodeReviewEventCursor(encoded)).toEqual({
      v: 1,
      occurredAt: '2026-08-21T02:00:00.000Z',
      id: id(31)
    })
    expect(reviewEventCursorTokenSchema.parse(encoded)).toBe(encoded)
    expect(listReviewEventsQuerySchema.parse({ cursor: encoded })).toEqual({
      cursor: encoded,
      pageSize: 20
    })

    for (const invalid of [
      '',
      `${encoded}=`,
      'not_canonical',
      'a'.repeat(reviewEventCursorMaximumLength + 1)
    ]) {
      expect(reviewEventCursorTokenSchema.safeParse(invalid).success).toBe(
        false
      )
    }
  })

  it('ReviewEvent answer/version-rebase·state chain·cursor order를 검증한다', () => {
    const fixture = reviewCenterConformanceFixture.history
    expect(listReviewEventsResponseSchema.parse(fixture)).toEqual(fixture)

    expect(
      reviewEventHistoryItemSchema.safeParse({
        ...fixture.items[0],
        id: id(50),
        source: 'VERSION_REBASE',
        selectedOptionId: null,
        isCorrect: null,
        elapsedSec: null,
        nextStatus: 'NEW',
        nextCorrectStreak: 0,
        wrongCountAfter: 1
      }).success
    ).toBe(true)

    const pageItem = fixture.items[0]
    if (pageItem === undefined) {
      throw new Error('ReviewEvent conformance fixture가 비어 있습니다.')
    }
    const nextCursor = encodeReviewEventCursor({
      v: 1,
      occurredAt: pageItem.occurredAt,
      id: pageItem.id
    })
    expect(
      listReviewEventsResponseSchema.safeParse({
        items: [pageItem],
        nextCursor
      }).success
    ).toBe(true)

    for (const invalid of [
      {
        ...fixture.items[0],
        previousWrongCount: null
      },
      {
        ...fixture.items[0],
        source: 'VERSION_REBASE',
        isCorrect: null,
        elapsedSec: null
      },
      {
        ...fixture.items[0],
        source: 'STUDY_SUBMIT',
        isCorrect: null
      },
      {
        ...fixture.items[0],
        isCorrect: true,
        selectedOptionId: null
      },
      {
        ...fixture.items[0],
        nextStatus: 'SOLVED',
        nextCorrectStreak: 0
      },
      {
        ...fixture.items[0],
        previousStatus: 'NEW',
        previousCorrectStreak: 5,
        previousWrongCount: 1
      },
      {
        ...fixture.items[1],
        wrongCountAfter: 0
      }
    ]) {
      expect(reviewEventHistoryItemSchema.safeParse(invalid).success).toBe(
        false
      )
    }

    expect(
      listReviewEventsResponseSchema.safeParse({
        items: [...fixture.items].reverse(),
        nextCursor: null
      }).success
    ).toBe(false)
    expect(
      listReviewEventsResponseSchema.safeParse({
        items: [fixture.items[0]],
        nextCursor: reviewCenterConformanceFixture.nextHistoryCursor
      }).success
    ).toBe(false)
    expect(
      listReviewEventsResponseSchema.safeParse({
        items: [fixture.items[0]],
        nextCursor: null
      }).success
    ).toBe(false)
  })

  it('targeted command를 strict v2 WRONG_NOTE 단일 세션과 SHA material로 고정한다', async () => {
    const fixture = reviewCenterConformanceFixture.targetedSession
    const targetQuestion = fixture.questions[0]
    if (targetQuestion === undefined) {
      throw new Error('Targeted review conformance fixture가 비어 있습니다.')
    }

    expect(createTargetedReviewSessionBodySchema.parse({})).toEqual({})
    expect(createTargetedReviewSessionQuerySchema.parse({})).toEqual({})
    expect(
      createTargetedReviewSessionQuerySchema.safeParse({ userId: id(1) })
        .success
    ).toBe(false)
    expect(
      createTargetedReviewSessionBodySchema.safeParse({ questionId: id(1) })
        .success
    ).toBe(false)
    expect(
      createTargetedReviewSessionHeadersSchema.parse({
        'x-nihongo-practice-contract': '2',
        'idempotency-key': id(1).toUpperCase()
      })
    ).toEqual({
      'x-nihongo-practice-contract': '2',
      'idempotency-key': id(1)
    })
    expect(
      createTargetedReviewSessionParamsSchema.parse({
        questionId: id(2).toUpperCase()
      })
    ).toEqual({ questionId: id(2) })
    expect(createTargetedReviewSessionResponseSchema.parse(fixture)).toEqual(
      fixture
    )
    expect(
      createTargetedReviewSessionResponseForQuestionSchema(
        reviewCenterConformanceFixture.targetedQuestionId
      ).parse(fixture)
    ).toEqual(fixture)
    expect(
      createTargetedReviewSessionResponseForQuestionSchema(
        reviewCenterConformanceFixture.targetedQuestionId
      ).safeParse({
        ...fixture,
        questions: [
          {
            ...targetQuestion,
            question: {
              ...targetQuestion.question,
              id: id(99)
            }
          }
        ]
      }).success
    ).toBe(false)
    expect(
      createTargetedReviewSessionLocationSchema(fixture.session.id).parse(
        reviewCenterConformanceFixture.targetedLocation
      )
    ).toBe(reviewCenterConformanceFixture.targetedLocation)
    expect(
      createTargetedReviewSessionLocationSchema(fixture.session.id).safeParse(
        `/api/v1/study-sessions/${id(99)}`
      ).success
    ).toBe(false)
    expect(targetQuestion.question.id).toBe(
      reviewCenterConformanceFixture.targetedQuestionId
    )
    const canonicalMaterial = createTargetedReviewSessionCanonicalMaterial(
      reviewCenterConformanceFixture.targetedQuestionId.toUpperCase()
    )
    expect(canonicalMaterial).toBe(
      reviewCenterConformanceFixture.targetedCanonicalMaterial
    )
    const crypto = (
      globalThis as typeof globalThis & {
        crypto?: {
          subtle: {
            digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>
          }
        }
      }
    ).crypto
    if (!crypto) {
      throw new Error(
        'Targeted review SHA-256 conformance에 Web Crypto가 필요합니다.'
      )
    }
    const digest = await crypto.subtle.digest(
      'SHA-256',
      Uint8Array.from(canonicalMaterial, (character) => character.charCodeAt(0))
    )
    expect(
      [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
    ).toBe(reviewCenterConformanceFixture.targetedSha256)

    for (const invalid of [
      { ...fixture, session: { ...fixture.session, mode: 'RANDOM' } },
      { ...fixture, session: { ...fixture.session, requestedCount: 2 } },
      { ...fixture, session: { ...fixture.session, actualCount: 2 } },
      {
        ...fixture,
        session: {
          ...fixture.session,
          usedFallback: true,
          fallbackReason: 'INSUFFICIENT_MODE_CANDIDATES'
        }
      }
    ]) {
      expect(
        createTargetedReviewSessionResponseSchema.safeParse(invalid).success
      ).toBe(false)
    }
  })

  it('operation별 closed error union을 exact하게 소유한다', () => {
    expect(listReviewQueueErrorCodeSchema.options).toEqual([
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'VALIDATION_ERROR',
      'RATE_LIMITED',
      'INTERNAL_SERVER_ERROR',
      'SERVICE_UNAVAILABLE'
    ])
    expect(getWrongNoteMemoErrorCodeSchema.options).toEqual([
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'INVALID_ID',
      'RESOURCE_NOT_FOUND',
      'VALIDATION_ERROR',
      'RATE_LIMITED',
      'INTERNAL_SERVER_ERROR',
      'SERVICE_UNAVAILABLE'
    ])
    expect(updateWrongNoteMemoErrorCodeSchema.options).toEqual([
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'INVALID_JSON',
      'INVALID_REQUEST',
      'INVALID_CSRF',
      'UNTRUSTED_ORIGIN',
      'INVALID_ID',
      'RESOURCE_NOT_FOUND',
      'VALIDATION_ERROR',
      'RATE_LIMITED',
      'INTERNAL_SERVER_ERROR',
      'SERVICE_UNAVAILABLE'
    ])
    expect(listReviewEventsErrorCodeSchema.options).toEqual(
      getWrongNoteMemoErrorCodeSchema.options
    )
    expect(createTargetedReviewSessionErrorCodeSchema.options).toEqual([
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'INVALID_JSON',
      'INVALID_REQUEST',
      'INVALID_CSRF',
      'UNTRUSTED_ORIGIN',
      'INVALID_ID',
      'RESOURCE_NOT_FOUND',
      'IDEMPOTENCY_KEY_REQUIRED',
      'IDEMPOTENCY_KEY_REUSED',
      'QUESTION_NOT_AVAILABLE',
      'RATE_LIMITED',
      'INTERNAL_SERVER_ERROR',
      'SERVICE_UNAVAILABLE'
    ])
  })
})
