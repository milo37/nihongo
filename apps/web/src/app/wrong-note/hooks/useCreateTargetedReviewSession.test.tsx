import {
  onlineManager,
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reviewCenterConformanceFixture } from '@nihongo/contracts/testing/review-center-conformance'
import { commitCanonicalAuth } from '@app/login/authSession'
import { useCreateTargetedReviewSession } from '@app/wrong-note/hooks/useCreateTargetedReviewSession'
import { completeTargetedReviewAction } from '@app/wrong-note/queries/wrongNoteMutations'
import { readTargetedReviewAttempt } from '@app/wrong-note/targetedReviewAttemptStorage'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { demoUsers } from '@mocks/data/users'
import { mockServer } from '@/test/server'

const createClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false }
    }
  })

const createWrapper =
  (client: QueryClient) =>
  ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

const privateV2Headers = {
  'Cache-Control': 'private, no-store',
  'X-Nihongo-Practice-Contract': '2'
}

const createDeferred = (): {
  promise: Promise<void>
  release: () => void
} => {
  let release: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release: () => release?.() }
}

describe('useCreateTargetedReviewSession', () => {
  afterEach(() => {
    onlineManager.setOnline(true)
    vi.restoreAllMocks()
  })

  it('canonicalizes a submitted replay without requesting a deleted draft', async () => {
    const principalScope = `USER:${crypto.randomUUID()}`
    const questionId = reviewCenterConformanceFixture.targetedQuestionId
    const historical = reviewCenterConformanceFixture.targetedSession
    const submitted = {
      ...historical,
      session: {
        ...historical.session,
        durationSec: 9,
        status: 'SUBMITTED' as const,
        submittedAt: '2026-08-22T03:14:00.000Z'
      }
    }
    let draftRequestCount = 0
    mockServer.use(
      http.post('*/api/v1/wrong-notes/:questionId/review-session', () =>
        HttpResponse.json(historical, {
          status: 201,
          headers: {
            ...privateV2Headers,
            'Idempotency-Replayed': 'true',
            Location: reviewCenterConformanceFixture.targetedLocation
          }
        })
      ),
      http.get('*/api/v1/study-sessions/:sessionId', () =>
        HttpResponse.json(submitted, { headers: privateV2Headers })
      ),
      http.get('*/api/v1/study-sessions/:sessionId/draft-answers', () => {
        draftRequestCount += 1
        return HttpResponse.json({}, { status: 500 })
      })
    )
    const client = createClient()
    const sessionId = historical.session.id
    const detailKey = serverStateQueryKeys.wrongNote.detail(questionId)
    const memoKey = serverStateQueryKeys.wrongNote.memo(questionId)
    const historyKey = serverStateQueryKeys.wrongNote.reviewEventConnection(
      questionId,
      20
    )
    const queueKey = [
      ...serverStateQueryKeys.wrongNote.reviewQueues(),
      { view: 'DUE' }
    ] as const
    const dashboardKey = serverStateQueryKeys.dashboard.all()
    const resumableKey = serverStateQueryKeys.study.resumable({
      page: 1,
      pageSize: 5
    })
    const draftKey = serverStateQueryKeys.study.draft(sessionId)
    const input = { principalScope, questionId }
    client.setQueryData(detailKey, { pointer: 'old' })
    client.setQueryData(memoKey, { text: 'private memo' })
    client.setQueryData(historyKey, { pages: [] })
    client.setQueryData(queueKey, { items: [] })
    client.setQueryData(dashboardKey, { stats: true })
    client.setQueryData(resumableKey, { items: [] })
    client.setQueryData(draftKey, { revision: 0 })
    const hook = renderHook(() => useCreateTargetedReviewSession(), {
      wrapper: createWrapper(client)
    })

    let result: Awaited<ReturnType<typeof hook.result.current.mutateAsync>>
    await act(async () => {
      result = await hook.result.current.mutateAsync(input)
    })

    expect(result!.replayed).toBe(true)
    expect(result!.session.session.status).toBe('SUBMITTED')
    expect(draftRequestCount).toBe(0)
    expect(client.getQueryData(draftKey)).toBeUndefined()
    expect(
      client.getQueryData(serverStateQueryKeys.study.session(sessionId))
    ).toMatchObject({ session: { status: 'SUBMITTED' } })
    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(resumableKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(memoKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(historyKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(queueKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(dashboardKey)?.isInvalidated).toBe(true)
    expect(readTargetedReviewAttempt(principalScope, questionId)).not.toBeNull()
    completeTargetedReviewAction(input)
    expect(readTargetedReviewAttempt(principalScope, questionId)).toBeNull()
    client.clear()
  })

  it('draft reconciliation 실패 뒤 같은 key로 정확히 replay한다', async () => {
    const principalScope = `USER:${crypto.randomUUID()}`
    const questionId = reviewCenterConformanceFixture.targetedQuestionId
    const session = reviewCenterConformanceFixture.targetedSession
    const observedKeys: string[] = []
    let postCount = 0
    let draftCount = 0
    mockServer.use(
      http.post(
        '*/api/v1/wrong-notes/:questionId/review-session',
        ({ request }) => {
          postCount += 1
          observedKeys.push(request.headers.get('Idempotency-Key') ?? '')
          return HttpResponse.json(session, {
            status: 201,
            headers: {
              ...privateV2Headers,
              ...(postCount > 1 ? { 'Idempotency-Replayed': 'true' } : {}),
              Location: reviewCenterConformanceFixture.targetedLocation
            }
          })
        }
      ),
      http.get('*/api/v1/study-sessions/:sessionId', () =>
        HttpResponse.json(session, { headers: privateV2Headers })
      ),
      http.get('*/api/v1/study-sessions/:sessionId/draft-answers', () => {
        draftCount += 1
        if (draftCount === 1) {
          return HttpResponse.json(
            {
              code: 'RESOURCE_NOT_FOUND',
              message: '학습 세션을 찾을 수 없습니다.',
              requestId: crypto.randomUUID(),
              retryable: false
            },
            { status: 404 }
          )
        }
        return HttpResponse.json(
          {
            studySessionId: session.session.id,
            revision: 0,
            currentOrdinal: 1,
            savedAt: null,
            answers: session.questions.map(({ sessionQuestionId }) => ({
              studySessionQuestionId: sessionQuestionId,
              selectedOptionId: null,
              elapsedSec: 0
            }))
          },
          { headers: privateV2Headers }
        )
      })
    )
    const client = createClient()
    const detailKey = serverStateQueryKeys.wrongNote.detail(questionId)
    const resumableKey = serverStateQueryKeys.study.resumable({
      page: 1,
      pageSize: 5
    })
    client.setQueryData(detailKey, { pointer: 'stable' })
    client.setQueryData(resumableKey, { items: [] })
    const hook = renderHook(() => useCreateTargetedReviewSession(), {
      wrapper: createWrapper(client)
    })
    const firstInput = { principalScope, questionId }

    await act(async () => {
      await expect(
        hook.result.current.mutateAsync(firstInput)
      ).rejects.toMatchObject({ name: 'TargetedReviewReconciliationError' })
    })

    const persistedAttempt = readTargetedReviewAttempt(
      principalScope,
      questionId
    )
    expect(persistedAttempt).not.toBeNull()
    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(resumableKey)?.isInvalidated).toBe(false)

    const secondInput = { principalScope, questionId }
    await act(async () => {
      await expect(
        hook.result.current.mutateAsync(secondInput)
      ).resolves.toMatchObject({ replayed: true })
    })

    expect(observedKeys).toHaveLength(2)
    expect(observedKeys[0]).toBe(persistedAttempt?.idempotencyKey)
    expect(observedKeys[1]).toBe(observedKeys[0])
    expect(draftCount).toBe(2)
    completeTargetedReviewAction(secondInput)
    expect(readTargetedReviewAttempt(principalScope, questionId)).toBeNull()
    client.clear()
  })

  it('canonical replay cache cancel 중 auth 전환되면 새 계정 cache와 network를 건드리지 않는다', async () => {
    const principalScope = `USER:${crypto.randomUUID()}`
    const questionId = reviewCenterConformanceFixture.targetedQuestionId
    const session = reviewCenterConformanceFixture.targetedSession
    const sessionKey = serverStateQueryKeys.study.session(session.session.id)
    const cancelGate = createDeferred()
    let targetCancelStarted = false
    let sessionGetCount = 0
    let draftGetCount = 0
    mockServer.use(
      http.post('*/api/v1/wrong-notes/:questionId/review-session', () =>
        HttpResponse.json(session, {
          status: 201,
          headers: {
            ...privateV2Headers,
            'Idempotency-Replayed': 'true',
            Location: reviewCenterConformanceFixture.targetedLocation
          }
        })
      ),
      http.get('*/api/v1/study-sessions/:sessionId', () => {
        sessionGetCount += 1
        return HttpResponse.json(session, { headers: privateV2Headers })
      }),
      http.get('*/api/v1/study-sessions/:sessionId/draft-answers', () => {
        draftGetCount += 1
        return HttpResponse.json({}, { status: 500 })
      })
    )
    const client = createClient()
    const originalCancelQueries = client.cancelQueries.bind(client)
    vi.spyOn(client, 'cancelQueries').mockImplementation((filters, options) => {
      if (
        !targetCancelStarted &&
        JSON.stringify(filters?.queryKey) === JSON.stringify(sessionKey)
      ) {
        targetCancelStarted = true
        const cancellation = originalCancelQueries(filters, options)
        return cancellation.then(() => cancelGate.promise)
      }
      return originalCancelQueries(filters, options)
    })
    const hook = renderHook(() => useCreateTargetedReviewSession(), {
      wrapper: createWrapper(client)
    })
    const pendingMutation = hook.result.current.mutateAsync({
      principalScope,
      questionId
    })
    void pendingMutation.catch(() => undefined)
    await waitFor(() => expect(targetCancelStarted).toBe(true))
    const admin = demoUsers.find(({ role }) => role === 'ADMIN')
    if (!admin) throw new Error('ADMIN fixture가 필요합니다.')
    const nextAccountCache = { owner: 'next-account' }

    await act(async () => {
      await commitCanonicalAuth(client, admin, {
        forceClear: true,
        forcePracticeReset: true
      })
      client.setQueryData(sessionKey, nextAccountCache)
      cancelGate.release()
    })

    await expect(pendingMutation).rejects.toMatchObject({
      name: 'AuthTransitionSupersededError'
    })
    expect(sessionGetCount).toBe(0)
    expect(draftGetCount).toBe(0)
    expect(client.getQueryData(sessionKey)).toEqual(nextAccountCache)
    expect(readTargetedReviewAttempt(principalScope, questionId)).toBeNull()
    client.clear()
  })

  it('offline pause 뒤 같은 durable key로 한 번만 전송한다', async () => {
    onlineManager.setOnline(false)
    const principalScope = `USER:${crypto.randomUUID()}`
    const questionId = reviewCenterConformanceFixture.targetedQuestionId
    const session = reviewCenterConformanceFixture.targetedSession
    const observedKeys: string[] = []
    let postCount = 0
    mockServer.use(
      http.post(
        '*/api/v1/wrong-notes/:questionId/review-session',
        ({ request }) => {
          postCount += 1
          observedKeys.push(request.headers.get('Idempotency-Key') ?? '')
          return HttpResponse.json(session, {
            status: 201,
            headers: {
              ...privateV2Headers,
              Location: reviewCenterConformanceFixture.targetedLocation
            }
          })
        }
      ),
      http.get('*/api/v1/study-sessions/:sessionId/draft-answers', () =>
        HttpResponse.json(
          {
            studySessionId: session.session.id,
            revision: 0,
            currentOrdinal: 1,
            savedAt: null,
            answers: session.questions.map(({ sessionQuestionId }) => ({
              studySessionQuestionId: sessionQuestionId,
              selectedOptionId: null,
              elapsedSec: 0
            }))
          },
          { headers: privateV2Headers }
        )
      )
    )
    const client = createClient()
    const hook = renderHook(() => useCreateTargetedReviewSession(), {
      wrapper: createWrapper(client)
    })
    const input = { principalScope, questionId }
    const pendingMutation = hook.result.current.mutateAsync(input)
    void pendingMutation.catch(() => undefined)

    await waitFor(() => expect(hook.result.current.isPaused).toBe(true))
    const attempt = readTargetedReviewAttempt(principalScope, questionId)
    expect(attempt).not.toBeNull()
    expect(postCount).toBe(0)

    await act(async () => {
      onlineManager.setOnline(true)
      await pendingMutation
    })
    expect(postCount).toBe(1)
    expect(observedKeys).toEqual([attempt?.idempotencyKey])
    completeTargetedReviewAction(input)
    client.clear()
  })
})
