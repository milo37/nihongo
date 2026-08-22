import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, Link, RouterProvider } from 'react-router'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { reviewCenterConformanceFixture } from '@nihongo/contracts/testing/review-center-conformance'
import type { UserMemo } from '@nihongo/contracts/wrong-note/user-memo'
import { MemoEditor } from '@app/wrong-note/components/MemoEditor'
import { useGetWrongNoteMemo } from '@app/wrong-note/hooks/useGetWrongNoteMemo'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'
import { mockServer } from '@/test/server'

type Deferred = {
  promise: Promise<void>
  release: () => void
}

const createDeferred = (): Deferred => {
  let release: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release: () => release?.() }
}

const createClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false }
    }
  })

const MemoHarness = ({ questionId }: { questionId: string }): ReactElement => {
  const memoQuery = useGetWrongNoteMemo(questionId)
  return (
    <main>
      <MemoEditor memoQuery={memoQuery} questionId={questionId} />
      <Link to="/away">다른 화면으로 이동</Link>
    </main>
  )
}

const renderMemoEditor = (initialMemo: UserMemo | null): QueryClient => {
  const questionId = reviewCenterConformanceFixture.memo.questionId
  const client = createClient()
  client.setQueryData(wrongNoteQueries.memo(questionId).queryKey, initialMemo)
  const router = createMemoryRouter(
    [
      { path: '/memo', element: <MemoHarness questionId={questionId} /> },
      { path: '/away', element: <h1>이동한 화면</h1> }
    ],
    { initialEntries: ['/memo'] }
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return client
}

describe('MemoEditor', () => {
  it('counts Unicode code points, saves 2000 characters, and explicitly deletes', async () => {
    const user = userEvent.setup()
    const questionId = reviewCenterConformanceFixture.memo.questionId
    const observedBodies: unknown[] = []
    mockServer.use(
      http.put('*/api/v1/wrong-notes/:questionId/memo', async ({ request }) => {
        const body = (await request.json()) as { memo: string | null }
        observedBodies.push(body)
        return body.memo === null
          ? HttpResponse.json(null)
          : HttpResponse.json({
              questionId,
              text: body.memo,
              createdAt: '2026-08-22T04:00:00.000Z',
              updatedAt: '2026-08-22T04:00:00.000Z'
            })
      })
    )
    const client = renderMemoEditor(null)
    const textarea = await screen.findByRole('textbox', { name: '나의 메모' })
    const validMemo = '🙂'.repeat(2_000)

    fireEvent.change(textarea, { target: { value: `${validMemo}🙂` } })
    expect(screen.getByText(/2,001\/2,000자/u)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '메모 저장' })).toBeDisabled()

    fireEvent.change(textarea, { target: { value: validMemo } })
    await user.click(screen.getByRole('button', { name: '메모 저장' }))
    expect(await screen.findByText('메모를 저장했습니다.')).toBeInTheDocument()
    expect(observedBodies[0]).toEqual({ memo: validMemo })

    await user.click(screen.getByRole('button', { name: '메모 삭제' }))
    expect(await screen.findByText('메모를 삭제했습니다.')).toBeInTheDocument()
    expect(observedBodies[1]).toEqual({ memo: null })
    expect(textarea).toHaveValue('')
    client.clear()
  })

  it('keeps dirty input and unload protection when saving fails', async () => {
    const user = userEvent.setup()
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
    const client = renderMemoEditor(null)
    const textarea = await screen.findByRole('textbox', { name: '나의 메모' })

    await user.type(textarea, '실패해도 보존할 메모')
    await user.click(screen.getByRole('button', { name: '메모 저장' }))

    expect(
      await screen.findByText(/메모를 저장하지 못했습니다/u)
    ).toBeInTheDocument()
    expect(textarea).toHaveValue('실패해도 보존할 메모')
    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)
    client.clear()
  })

  it('keeps input and shows an exact offline save message without transport', async () => {
    const user = userEvent.setup()
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    let requestCount = 0
    mockServer.use(
      http.put('*/api/v1/wrong-notes/:questionId/memo', () => {
        requestCount += 1
        return HttpResponse.json(null)
      })
    )
    const client = renderMemoEditor(null)
    const textarea = await screen.findByRole('textbox', { name: '나의 메모' })
    await user.type(textarea, '오프라인 입력')
    await user.click(screen.getByRole('button', { name: '메모 저장' }))

    expect(
      await screen.findByText(
        '오프라인에서는 메모를 저장할 수 없습니다. 입력은 유지됩니다. 연결 후 다시 시도해 주세요.'
      )
    ).toBeInTheDocument()
    expect(textarea).toHaveValue('오프라인 입력')
    expect(requestCount).toBe(0)
    online.mockRestore()
    client.clear()
  })

  it('lets keyboard users keep writing or explicitly discard a dirty memo before leaving', async () => {
    const user = userEvent.setup()
    const client = renderMemoEditor(null)
    const textarea = await screen.findByRole('textbox', { name: '나의 메모' })
    await user.type(textarea, '아직 저장하지 않은 메모')

    await user.click(screen.getByRole('link', { name: '다른 화면으로 이동' }))
    const dialog = screen.getByRole('dialog', {
      name: '저장하지 않은 메모가 있습니다'
    })
    expect(dialog).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '계속 작성' }))
    expect(
      screen.queryByRole('dialog', {
        name: '저장하지 않은 메모가 있습니다'
      })
    ).not.toBeInTheDocument()
    expect(textarea).toHaveValue('아직 저장하지 않은 메모')

    await user.click(screen.getByRole('link', { name: '다른 화면으로 이동' }))
    await user.click(screen.getByRole('button', { name: '변경사항 버리기' }))
    expect(
      await screen.findByRole('heading', { name: '이동한 화면' })
    ).toBeInTheDocument()
    client.clear()
  })

  it('finishes a blocked navigation after the pending save succeeds', async () => {
    const user = userEvent.setup()
    const questionId = reviewCenterConformanceFixture.memo.questionId
    const responseGate = createDeferred()
    mockServer.use(
      http.put('*/api/v1/wrong-notes/:questionId/memo', async ({ request }) => {
        const body = (await request.json()) as { memo: string }
        await responseGate.promise
        return HttpResponse.json({
          questionId,
          text: body.memo,
          createdAt: '2026-08-22T04:00:00.000Z',
          updatedAt: '2026-08-22T04:00:00.000Z'
        })
      })
    )
    const client = renderMemoEditor(null)
    const textarea = await screen.findByRole('textbox', { name: '나의 메모' })
    await user.type(textarea, '저장 후 이동')
    await user.click(screen.getByRole('button', { name: '메모 저장' }))
    expect(textarea).toBeDisabled()

    await user.click(screen.getByRole('link', { name: '다른 화면으로 이동' }))
    expect(
      screen.getByRole('dialog', { name: '저장하지 않은 메모가 있습니다' })
    ).toBeInTheDocument()

    await act(async () => responseGate.release())
    expect(
      await screen.findByRole('heading', { name: '이동한 화면' })
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', {
          name: '저장하지 않은 메모가 있습니다'
        })
      ).not.toBeInTheDocument()
    )
    client.clear()
  })

  it('keeps the dirty editor and route dialog when a cached memo refresh fails', async () => {
    const user = userEvent.setup()
    const responseGate = createDeferred()
    mockServer.use(
      http.get('*/api/v1/wrong-notes/:questionId/memo', async () => {
        await responseGate.promise
        return HttpResponse.json(
          {
            code: 'INTERNAL_SERVER_ERROR',
            message: '잠시 후 다시 시도해 주세요.',
            requestId: crypto.randomUUID(),
            retryable: true
          },
          { status: 500 }
        )
      })
    )
    const questionId = reviewCenterConformanceFixture.memo.questionId
    const client = createClient()
    client.setQueryData(
      wrongNoteQueries.memo(questionId).queryKey,
      reviewCenterConformanceFixture.memo
    )
    await client.invalidateQueries({
      queryKey: wrongNoteQueries.memo(questionId).queryKey,
      exact: true,
      refetchType: 'none'
    })
    const router = createMemoryRouter(
      [
        { path: '/memo', element: <MemoHarness questionId={questionId} /> },
        { path: '/away', element: <h1>이동한 화면</h1> }
      ],
      { initialEntries: ['/memo'] }
    )
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
    const textarea = await screen.findByRole('textbox', { name: '나의 메모' })
    await waitFor(() =>
      expect(textarea).toHaveValue(reviewCenterConformanceFixture.memo.text)
    )
    await user.clear(textarea)
    await user.type(textarea, 'background 실패에도 남을 메모')

    await act(async () => responseGate.release())
    expect(
      await screen.findByText(/메모의 최신 상태를 확인하지 못했습니다/u)
    ).toBeInTheDocument()
    expect(textarea).toHaveValue('background 실패에도 남을 메모')

    await user.click(screen.getByRole('link', { name: '다른 화면으로 이동' }))
    expect(
      screen.getByRole('dialog', { name: '저장하지 않은 메모가 있습니다' })
    ).toBeInTheDocument()
    client.clear()
  })
})
