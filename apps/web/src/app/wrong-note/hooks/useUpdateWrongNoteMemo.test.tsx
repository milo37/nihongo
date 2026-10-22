import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { reviewCenterConformanceFixture } from '@nihongo/contracts/testing/review-center-conformance'
import { useUpdateWrongNoteMemo } from '@app/wrong-note/hooks/useUpdateWrongNoteMemo'
import { serverStateQueryKeys } from '@libs/serverStateQueryKeys'
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

describe('useUpdateWrongNoteMemo', () => {
  it('sets only the exact memo cache and invalidates queue variants', async () => {
    const questionId = reviewCenterConformanceFixture.memo.questionId
    const updatedMemo = {
      ...reviewCenterConformanceFixture.memo,
      text: '새 메모',
      updatedAt: '2026-08-22T04:00:00.000Z'
    }
    let observedBody: unknown
    mockServer.use(
      http.put('*/api/v1/wrong-notes/:questionId/memo', async ({ request }) => {
        observedBody = await request.json()
        return HttpResponse.json(updatedMemo)
      })
    )
    const client = createClient()
    const memoKey = serverStateQueryKeys.wrongNote.memo(questionId)
    const queueKey = [
      ...serverStateQueryKeys.wrongNote.reviewQueues(),
      { view: 'DUE' }
    ] as const
    const detailKey = serverStateQueryKeys.wrongNote.detail(questionId)
    const historyKey = serverStateQueryKeys.wrongNote.reviewEventConnection(
      questionId,
      20
    )
    const historicalKey = [
      ...serverStateQueryKeys.wrongNote.historicalLists(),
      { page: 1 }
    ] as const
    client.setQueryData(memoKey, reviewCenterConformanceFixture.memo)
    client.setQueryData(queueKey, { items: [] })
    client.setQueryData(detailKey, { questionId })
    client.setQueryData(historyKey, { pages: [] })
    client.setQueryData(historicalKey, { items: [] })
    const hook = renderHook(() => useUpdateWrongNoteMemo(questionId), {
      wrapper: createWrapper(client)
    })

    await act(async () => {
      await hook.result.current.mutateAsync({ memo: '  새 메모  ' })
    })

    expect(observedBody).toEqual({ memo: '새 메모' })
    expect(client.getQueryData(memoKey)).toEqual(updatedMemo)
    expect(client.getQueryState(queueKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(historyKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(historicalKey)?.isInvalidated).toBe(false)
    client.clear()
  })

  it('keeps memo and queue caches unchanged when the write fails', async () => {
    const questionId = reviewCenterConformanceFixture.memo.questionId
    mockServer.use(
      http.put('*/api/v1/wrong-notes/:questionId/memo', () =>
        HttpResponse.json(
          {
            code: 'SERVICE_UNAVAILABLE',
            message: '잠시 후 다시 시도해 주세요.',
            requestId: crypto.randomUUID(),
            retryable: true
          },
          { status: 503 }
        )
      )
    )
    const client = createClient()
    const memoKey = serverStateQueryKeys.wrongNote.memo(questionId)
    const queueKey = [
      ...serverStateQueryKeys.wrongNote.reviewQueues(),
      { view: 'DUE' }
    ] as const
    client.setQueryData(memoKey, reviewCenterConformanceFixture.memo)
    client.setQueryData(queueKey, { items: [] })
    const hook = renderHook(() => useUpdateWrongNoteMemo(questionId), {
      wrapper: createWrapper(client)
    })

    await act(async () => {
      await expect(
        hook.result.current.mutateAsync({ memo: '저장 실패 메모' })
      ).rejects.toMatchObject({ status: 503 })
    })

    expect(client.getQueryData(memoKey)).toEqual(
      reviewCenterConformanceFixture.memo
    )
    expect(client.getQueryState(queueKey)?.isInvalidated).toBe(false)
    client.clear()
  })
})
