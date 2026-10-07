import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import type { CreateStudySessionV2TransportResponse } from '@api/study/createStudySessionV2/schema'
import { HomePage } from '@app/home/page'
import { commitCanonicalAuth } from '@app/login/authSession'
import { PracticePage } from '@app/practice/page'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'
import { demoUsers } from '@mocks/data/users'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

const createClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  })

const createFixture = async (
  role: 'GUEST' | 'USER' = 'USER'
): Promise<CreateStudySessionV2TransportResponse['data']> => {
  if (role === 'GUEST') {
    mockDatabase.logout()
    useAppStore.getState().setCurrentUser(null)
  } else {
    const user = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(user)
  }
  return (
    await createStudySessionV2({
      level: 'N3',
      subject: 'GRAMMAR',
      mode: 'RANDOM',
      count: 10
    })
  ).data
}

const createV2Response = (
  fixture: CreateStudySessionV2TransportResponse['data']
) =>
  HttpResponse.json(fixture, {
    status: 201,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Nihongo-Practice-Contract': '2'
    }
  })

const renderPage = (
  page: ReactElement,
  initialPath: string,
  resultText: string
): { client: QueryClient; router: ReturnType<typeof createMemoryRouter> } => {
  const client = createClient()
  const router = createMemoryRouter(
    [
      {
        path: initialPath,
        element: <ProtectedRouteProvider>{page}</ProtectedRouteProvider>
      },
      {
        path: '/practice/session/:sessionId',
        element: <p>{resultText}</p>
      },
      {
        path: '/dashboard',
        element: <h1>인증 후 학습 홈</h1>
      }
    ],
    { initialEntries: [initialPath] }
  )

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { client, router }
}

describe('study session create intent lock', () => {
  it('locks Home controls to one request and re-enables the same intent after failure', async () => {
    const user = userEvent.setup()
    const fixture = await createFixture('GUEST')
    let requestCount = 0
    const requestInputs: unknown[] = []
    let releaseFirst: (() => void) | undefined
    const firstRequestGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    mockServer.use(
      http.post('*/api/v1/study-sessions', async ({ request }) => {
        requestInputs.push(await request.json())
        requestCount += 1
        if (requestCount === 1) {
          await firstRequestGate
          return HttpResponse.json(
            { code: 'SERVICE_UNAVAILABLE', message: 'try again' },
            { status: 503 }
          )
        }
        return createV2Response(fixture)
      })
    )
    renderPage(<HomePage />, '/', '홈 세션 도착')

    const start = await screen.findByRole('button', {
      name: 'N3 문법 시작'
    })
    await user.click(start)
    await waitFor(() => expect(requestCount).toBe(1))

    const pendingStart = screen.getByRole('button', { name: '불러오는 중' })
    const originalLevel = screen.getByRole('radio', { name: 'N3' })
    const otherLevel = screen.getByRole('radio', { name: 'N5' })
    const originalSubject = screen.getByRole('radio', { name: '문법' })
    const otherSubject = screen.getByRole('radio', { name: '어휘' })
    expect(pendingStart).toBeDisabled()
    expect(otherLevel).toBeDisabled()
    expect(otherSubject).toBeDisabled()
    await user.click(otherLevel)
    await user.click(otherSubject)
    await user.click(pendingStart)
    expect(originalLevel).toBeChecked()
    expect(originalSubject).toBeChecked()
    expect(requestCount).toBe(1)

    releaseFirst?.()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '네트워크 상태와 선택 조건을 확인'
    )
    expect(screen.getByRole('radio', { name: 'N5' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'N3 문법 시작' }))

    expect(await screen.findByText('홈 세션 도착')).toBeInTheDocument()
    expect(requestCount).toBe(2)
    expect(requestInputs).toEqual([
      { level: 'N3', subject: 'GRAMMAR', count: 10, mode: 'RANDOM' },
      { level: 'N3', subject: 'GRAMMAR', count: 10, mode: 'RANDOM' }
    ])
  })

  it('locks every Practice setup control and CTA to the displayed request intent', async () => {
    const user = userEvent.setup()
    const fixture = await createFixture()
    let requestCount = 0
    const requestInputs: unknown[] = []
    let releaseResponse: (() => void) | undefined
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    mockServer.use(
      http.post('*/api/v1/study-sessions', async ({ request }) => {
        requestInputs.push(await request.json())
        requestCount += 1
        await responseGate
        return createV2Response(fixture)
      })
    )
    renderPage(<PracticePage />, '/practice', '설정 세션 도착')

    const start = await screen.findByRole('button', {
      name: 'N3 문법 시작'
    })
    await user.click(start)
    await waitFor(() => expect(requestCount).toBe(1))

    expect(screen.getByRole('button', { name: '불러오는 중' })).toBeDisabled()
    for (const name of ['N5', '문자·어휘', '5문제']) {
      expect(screen.getByRole('radio', { name })).toBeDisabled()
    }
    expect(screen.getByRole('radio', { name: /^랜덤 문제/ })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'N5' }))
    await user.click(screen.getByRole('radio', { name: '문자·어휘' }))
    await user.click(screen.getByRole('radio', { name: '5문제' }))
    for (const name of ['N3', '문법', '10문제', /^랜덤 문제/]) {
      expect(screen.getByRole('radio', { name })).toBeChecked()
    }
    expect(requestCount).toBe(1)

    releaseResponse?.()
    expect(await screen.findByText('설정 세션 도착')).toBeInTheDocument()
    expect(requestCount).toBe(1)
    expect(requestInputs).toEqual([
      { level: 'N3', subject: 'GRAMMAR', count: 10, mode: 'RANDOM' }
    ])
  })

  it('opens the canonical member dashboard and ignores a guest create superseded by auth', async () => {
    const user = userEvent.setup()
    const fixture = await createFixture('GUEST')
    let requestCount = 0
    let releaseResponse: (() => void) | undefined
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    mockServer.use(
      http.post('*/api/v1/study-sessions', async () => {
        requestCount += 1
        await responseGate
        return createV2Response(fixture)
      })
    )
    const { client, router } = renderPage(<HomePage />, '/', '이전 사용자 세션')

    await user.click(
      await screen.findByRole('button', {
        name: 'N3 문법 시작'
      })
    )
    expect(
      await screen.findByRole('button', { name: '불러오는 중' })
    ).toBeDisabled()
    await waitFor(() => expect(requestCount).toBe(1))
    const pendingCreate = client.getMutationCache().getAll()[0]
    expect(pendingCreate).toBeDefined()
    if (!pendingCreate) {
      throw new Error('Expected a pending guest create mutation')
    }
    const nextUser = demoUsers.find(({ role }) => role === 'ADMIN')
    expect(nextUser).toBeDefined()
    if (!nextUser) {
      throw new Error('Expected the canonical admin fixture')
    }

    await act(async () => {
      mockDatabase.loginAs('ADMIN', nextUser.id)
      await commitCanonicalAuth(client, nextUser, {
        forceClear: true,
        forcePracticeReset: true
      })
    })

    expect(
      await screen.findByRole('heading', { name: '인증 후 학습 홈' })
    ).toBeVisible()
    expect(router.state.location).toMatchObject({
      pathname: '/dashboard',
      search: '?view=learning'
    })
    releaseResponse?.()
    await waitFor(() => expect(pendingCreate.state.status).toBe('error'))
    expect(isAuthTransitionSupersededError(pendingCreate.state.error)).toBe(
      true
    )
    expect(
      screen.queryByRole('button', { name: 'N3 문법 시작' })
    ).not.toBeInTheDocument()
    expect(requestCount).toBe(1)
    expect(useAppStore.getState().currentUser?.id).toBe(nextUser.id)
    expect(router.state.location).toMatchObject({
      pathname: '/dashboard',
      search: '?view=learning'
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('이전 사용자 세션')).not.toBeInTheDocument()
    expect(useAppStore.getState().sessionId).toBeNull()
  })

  it('returns to the preceding resumable page when cancellation removes the last item', async () => {
    const user = userEvent.setup()
    await createFixture()
    const sessionIds = Array.from(
      { length: 6 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
    )
    const summaries = sessionIds.map((id, index) => ({
      actualCount: 5,
      currentOrdinal: 1,
      draftRevision: 1,
      draftSavedAt: `2026-08-18T00:0${index}:00.000Z`,
      expiresAt: '2026-08-19T00:00:00.000Z',
      id,
      level: 'N5' as const,
      mode: 'RANDOM' as const,
      practiceContractVersion: 2 as const,
      resumeAvailability: 'SERVER' as const,
      startedAt: `2026-08-17T00:0${index}:00.000Z`,
      status: 'IN_PROGRESS' as const,
      subject: 'VOCABULARY' as const
    }))
    let cancelled = false
    const requestedPages: number[] = []

    mockServer.use(
      http.get('*/api/v1/study-sessions', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'))
        requestedPages.push(page)
        const active = cancelled ? summaries.slice(0, 5) : summaries
        const offset = (page - 1) * 5
        return HttpResponse.json(
          {
            items: active.slice(offset, offset + 5),
            page,
            pageSize: 5,
            total: active.length
          },
          {
            headers: {
              'Cache-Control': 'private, no-store',
              'X-Nihongo-Practice-Contract': '2'
            }
          }
        )
      }),
      http.post(`*/api/v1/study-sessions/${sessionIds[5]}/cancellation`, () => {
        cancelled = true
        return new HttpResponse(null, {
          status: 204,
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Nihongo-Practice-Contract': '2'
          }
        })
      })
    )
    const { client } = renderPage(
      <PracticePage />,
      '/practice',
      'pagination session'
    )

    expect(
      await screen.findByRole('link', { name: '1페이지, 현재 페이지' })
    ).toHaveAttribute('aria-current', 'page')
    await user.click(screen.getByRole('link', { name: '다음 페이지' }))
    expect(
      await screen.findByRole('link', { name: '2페이지, 현재 페이지' })
    ).toHaveAttribute('aria-current', 'page')
    await user.click(screen.getByRole('button', { name: '세션 취소' }))
    const dialog = screen.getByRole('dialog', {
      name: '진행 중 세션을 취소할까요?'
    })
    await user.click(within(dialog).getByRole('button', { name: '세션 취소' }))

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: '세션 취소' })).toHaveLength(
        5
      )
      expect(
        screen.queryByRole('navigation', { name: '이어풀기 페이지' })
      ).not.toBeInTheDocument()
      expect(requestedPages.at(-1)).toBe(1)
      expect(screen.getByRole('heading', { name: '이어서 풀기' })).toHaveFocus()
    })
    expect(requestedPages).toContain(2)
    client.clear()
  })
})
