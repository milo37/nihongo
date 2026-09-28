import {
  onlineManager,
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach } from 'vitest'
import { authQueries } from '@app/login/queries/authQueries'
import { PracticePage } from '@app/practice/page'
import { studyDraftQueries } from '@app/practice/queries/studyDraftQueries'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

afterEach(() => {
  act(() => onlineManager.setOnline(true))
})

const protectedModes = [
  ['BOOKMARK', '즐겨찾기'],
  ['DAILY_REVIEW', '오늘의 복습'],
  ['WRONG_NOTE', '오답 문제']
] as const

describe('PracticePage guest mode boundary', () => {
  it('cold offline에서 이어풀기 확인을 무한 loading으로 남기지 않는다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.setState({ currentUser })
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    })
    client.setQueryData(authQueries.currentUser().queryKey, currentUser)
    act(() => onlineManager.setOnline(false))
    const router = createMemoryRouter(
      [
        {
          path: '/practice',
          element: (
            <ProtectedRouteProvider>
              <PracticePage />
            </ProtectedRouteProvider>
          )
        }
      ],
      { initialEntries: ['/practice'] }
    )

    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    expect(
      await screen.findByText(
        '오프라인입니다. 연결되면 이어풀기 목록을 자동으로 다시 확인합니다.'
      )
    ).toBeVisible()
    expect(
      screen.queryByText('저장된 작업본을 확인하고 있습니다…')
    ).not.toBeInTheDocument()
    client.clear()
  })

  it('cached 이어풀기 갱신 실패 시 목록을 유지하고 변경 동작을 잠근다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.setState({ currentUser })
    mockDatabase.createStudySession({
      canonicalContractVersion: 2,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1,
      questionIds: ['n5-vocabulary-01']
    })
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    })
    client.setQueryData(authQueries.currentUser().queryKey, currentUser)
    const router = createMemoryRouter(
      [
        {
          path: '/practice',
          element: (
            <ProtectedRouteProvider>
              <PracticePage />
            </ProtectedRouteProvider>
          )
        }
      ],
      { initialEntries: ['/practice'] }
    )
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    expect(
      await screen.findByRole('link', { name: '이어서 풀기' })
    ).toBeVisible()
    mockServer.use(
      http.get('*/api/v1/study-sessions', () =>
        HttpResponse.json(
          {
            code: 'SERVICE_UNAVAILABLE',
            message: 'temporary resumable error',
            requestId: crypto.randomUUID(),
            retryable: true
          },
          { status: 503 }
        )
      )
    )

    await act(async () => {
      await client.refetchQueries({
        exact: true,
        queryKey: studyDraftQueries.resumable({
          page: 1,
          pageSize: 5,
          status: 'IN_PROGRESS'
        }).queryKey
      })
    })

    expect(
      await screen.findByText(
        '최신 이어풀기 목록으로 갱신하지 못했습니다. 마지막으로 확인한 목록을 유지합니다.'
      )
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '이어서 풀기' })).toBeVisible()
    expect(screen.getByRole('button', { name: '세션 취소' })).toBeDisabled()
    client.clear()
  })

  it.each(protectedModes)(
    'direct %s 요청을 RANDOM으로 바꾸지 않고 로그인 경계에서 막는다',
    async (mode, label) => {
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false }
        }
      })
      const router = createMemoryRouter(
        [
          {
            path: '/practice',
            element: (
              <ProtectedRouteProvider>
                <PracticePage />
              </ProtectedRouteProvider>
            )
          }
        ],
        { initialEntries: [`/practice?mode=${mode}`] }
      )

      render(
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      )

      expect(
        await screen.findByRole('button', { name: new RegExp(`^${label}`) })
      ).toHaveAttribute('aria-pressed', 'true')
      expect(
        screen.getByRole('button', { name: /^랜덤 문제/u })
      ).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByRole('alert')).toHaveTextContent(
        '랜덤 문제로 바꾸지 않았습니다.'
      )
      screen.getAllByRole('link', { name: '로그인하기' }).forEach((link) => {
        expect(link).toHaveAttribute(
          'href',
          `/login?redirect=${encodeURIComponent(`/practice?mode=${mode}`)}`
        )
      })
      expect(
        screen.getByRole('button', { name: '학습 시작하기' })
      ).toBeDisabled()
    }
  )
})
