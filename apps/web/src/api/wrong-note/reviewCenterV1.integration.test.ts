import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { reviewCenterConformanceFixture } from '@nihongo/contracts/testing/review-center-conformance'
import { apiClient, isApiError } from '@api/config'
import { createTargetedReviewSession } from '@api/wrong-note/createTargetedReviewSession'
import { getWrongNoteMemo } from '@api/wrong-note/getWrongNoteMemo'
import { listReviewEvents } from '@api/wrong-note/listReviewEvents'
import { listReviewQueue } from '@api/wrong-note/listReviewQueue'
import { updateWrongNoteMemoV1 } from '@api/wrong-note/updateWrongNoteMemoV1'
import { mockServer } from '@/test/server'

const TARGETED_URL = '*/api/v1/wrong-notes/:questionId/review-session'

describe('review center endpoint adapters', () => {
  it('uses canonical queue, memo, and cursor-history paths and normalized payloads', async () => {
    const observed = {
      historyUrl: '',
      memoBody: undefined as unknown,
      queueUrl: ''
    }
    mockServer.use(
      http.get('*/api/v1/review-queue', ({ request }) => {
        observed.queueUrl = request.url
        return HttpResponse.json(reviewCenterConformanceFixture.queue)
      }),
      http.get('*/api/v1/wrong-notes/:questionId/memo', () =>
        HttpResponse.json(reviewCenterConformanceFixture.memo)
      ),
      http.put('*/api/v1/wrong-notes/:questionId/memo', async ({ request }) => {
        observed.memoBody = await request.json()
        return HttpResponse.json(reviewCenterConformanceFixture.memo)
      }),
      http.get(
        '*/api/v1/wrong-notes/:questionId/review-events',
        ({ request }) => {
          observed.historyUrl = request.url
          return HttpResponse.json(reviewCenterConformanceFixture.history)
        }
      )
    )

    await expect(
      listReviewQueue({
        page: 2,
        pageSize: 20,
        sort: 'MOST_WRONG',
        view: 'REPEATED'
      })
    ).resolves.toEqual(reviewCenterConformanceFixture.queue)
    await expect(
      getWrongNoteMemo(reviewCenterConformanceFixture.memo.questionId)
    ).resolves.toEqual(reviewCenterConformanceFixture.memo)
    await expect(
      updateWrongNoteMemoV1(reviewCenterConformanceFixture.memo.questionId, {
        memo: `  ${reviewCenterConformanceFixture.memo.text}  `
      })
    ).resolves.toEqual(reviewCenterConformanceFixture.memo)
    await expect(
      listReviewEvents(reviewCenterConformanceFixture.memo.questionId, {
        cursor: reviewCenterConformanceFixture.nextHistoryCursor,
        pageSize: 100
      })
    ).resolves.toEqual(reviewCenterConformanceFixture.history)

    const queueSearch = new URL(observed.queueUrl).searchParams
    expect(Object.fromEntries(queueSearch)).toEqual({
      page: '2',
      pageSize: '20',
      sort: 'MOST_WRONG',
      view: 'REPEATED'
    })
    expect(observed.memoBody).toEqual({
      memo: reviewCenterConformanceFixture.memo.text
    })
    expect(
      Object.fromEntries(new URL(observed.historyUrl).searchParams)
    ).toEqual({
      cursor: reviewCenterConformanceFixture.nextHistoryCursor,
      pageSize: '100'
    })
  })

  it('validates targeted 201 metadata and request question identity', async () => {
    const idempotencyKey = crypto.randomUUID()
    let observedBody: unknown
    let observedHeaders: Headers | undefined
    mockServer.use(
      http.post(TARGETED_URL, async ({ request }) => {
        observedBody = await request.json()
        observedHeaders = request.headers
        return HttpResponse.json(
          reviewCenterConformanceFixture.targetedSession,
          {
            status: 201,
            headers: {
              'Cache-Control': 'private, no-store',
              Location: reviewCenterConformanceFixture.targetedLocation,
              'X-Nihongo-Practice-Contract': '2'
            }
          }
        )
      })
    )

    const response = await createTargetedReviewSession(
      reviewCenterConformanceFixture.targetedQuestionId,
      idempotencyKey
    )

    expect(response.status).toBe(201)
    expect(response.data).toEqual(
      reviewCenterConformanceFixture.targetedSession
    )
    expect(observedBody).toEqual({})
    expect(observedHeaders?.get('Idempotency-Key')).toBe(idempotencyKey)
    expect(observedHeaders?.get('X-Nihongo-Practice-Contract')).toBe('2')
  })

  it('rejects malformed requests and cross-question responses at the adapter boundary', async () => {
    const post = vi.spyOn(apiClient, 'post')

    await expect(
      createTargetedReviewSession('not-a-uuid', crypto.randomUUID())
    ).rejects.toThrow()
    await expect(
      createTargetedReviewSession(
        reviewCenterConformanceFixture.targetedQuestionId,
        'not-a-uuid'
      )
    ).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()

    mockServer.use(
      http.get('*/api/v1/wrong-notes/:questionId/memo', () =>
        HttpResponse.json(reviewCenterConformanceFixture.memo)
      ),
      http.post(TARGETED_URL, () =>
        HttpResponse.json(reviewCenterConformanceFixture.targetedSession, {
          status: 201,
          headers: {
            'Cache-Control': 'private, no-store',
            Location: reviewCenterConformanceFixture.targetedLocation,
            'X-Nihongo-Practice-Contract': '2'
          }
        })
      )
    )
    const otherQuestionId = crypto.randomUUID()

    const memoError = await getWrongNoteMemo(otherQuestionId).catch(
      (error: unknown) => error
    )
    const targetError = await createTargetedReviewSession(
      otherQuestionId,
      crypto.randomUUID()
    ).catch((error: unknown) => error)
    for (const error of [memoError, targetError]) {
      expect(isApiError(error)).toBe(true)
      expect(error).toMatchObject({
        isResponseValidationError: true,
        isValidationError: true,
        status: 422
      })
    }
  })

  it('rejects targeted responses with unsafe transport metadata', async () => {
    const metadataCases: Array<Record<string, string>> = [
      {
        'Cache-Control': 'public, max-age=60',
        Location: reviewCenterConformanceFixture.targetedLocation,
        'X-Nihongo-Practice-Contract': '2'
      },
      {
        'Cache-Control': 'private, no-store',
        Location: `/api/v1/study-sessions/${crypto.randomUUID()}`,
        'X-Nihongo-Practice-Contract': '2'
      },
      {
        'Cache-Control': 'private, no-store',
        Location: reviewCenterConformanceFixture.targetedLocation,
        'X-Nihongo-Practice-Contract': '1'
      },
      {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'application/jsonp',
        Location: reviewCenterConformanceFixture.targetedLocation,
        'X-Nihongo-Practice-Contract': '2'
      }
    ]
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    for (const headers of metadataCases) {
      mockServer.use(
        http.post(
          TARGETED_URL,
          () =>
            HttpResponse.json(reviewCenterConformanceFixture.targetedSession, {
              status: 201,
              headers
            }),
          { once: true }
        )
      )
      const error = await createTargetedReviewSession(
        reviewCenterConformanceFixture.targetedQuestionId,
        crypto.randomUUID()
      ).catch((cause: unknown) => cause)

      expect(isApiError(error)).toBe(true)
      expect(error).toMatchObject({
        isResponseValidationError: true,
        isValidationError: true,
        status: 422
      })
    }
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      reviewCenterConformanceFixture.memo.text
    )
    consoleError.mockRestore()
  })
})
