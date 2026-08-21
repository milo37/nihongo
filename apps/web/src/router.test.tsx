import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { ReactElement } from 'react'
import type { RouteObject } from 'react-router'
import { appRoutes } from '@/router'
import { createStudySessionV1 } from '@api/study/createStudySessionV1'
import { submitStudySessionV1 } from '@api/study/submitStudySessionV1'
import { toCanonicalStudyResultView } from '@app/practice/adapters/studyResultView'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import { studyQueries } from '@app/practice/queries/studyQueries'
import { ToastProvider } from '@common/components/Toast'
import { queryClient } from '@libs/queryClient'
import { mockDatabase } from '@mocks/repository/mockDatabase'

const DelayedHashTarget = (): ReactElement => {
  const [isReady, setReady] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 25)
    return () => window.clearTimeout(timer)
  }, [])

  return isReady ? (
    <h1 id="delayed-target">늦게 준비된 대상</h1>
  ) : (
    <p role="status">대상을 준비하고 있습니다…</p>
  )
}

const renderRoutes = (
  initialEntry: string,
  routes: RouteObject[] = appRoutes
): ReturnType<typeof createMemoryRouter> => {
  const router = createMemoryRouter(routes, {
    initialEntries: [initialEntry]
  })

  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  )

  return router
}

describe('application router boundaries', () => {
  it('guest의 보호 경로와 search를 login redirect에 보존한다', async () => {
    const router = renderRoutes('/wrong-notes?status=NEW')

    expect(
      await screen.findByRole('heading', {
        name: '학습 계정으로 시작하세요'
      })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe(
      '?redirect=%2Fwrong-notes%3Fstatus%3DNEW'
    )
  })

  it('USER의 관리자 경로는 forbidden으로 이동한다', async () => {
    mockDatabase.loginAs('USER')
    const router = renderRoutes('/admin/questions')

    expect(
      await screen.findByRole('heading', {
        name: '이 페이지를 볼 권한이 없습니다'
      })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/forbidden')
  })

  it('ADMIN은 관리자 문제 목록에 접근한다', async () => {
    mockDatabase.loginAs('ADMIN')
    renderRoutes('/admin/questions')

    expect(
      await screen.findByRole('heading', { name: '문제 관리' })
    ).toBeInTheDocument()
    const tableRegion = await screen.findByRole('region', {
      name: '관리자 문제 목록'
    })
    expect(tableRegion).toHaveAttribute('tabindex', '0')
    expect(
      within(tableRegion).getByRole('table', {
        name: /JLPT 관리자 문제 목록/
      })
    ).toBeInTheDocument()
  })

  it('등록되지 않은 경로는 Not Found를 표시한다', async () => {
    renderRoutes('/not-registered')

    expect(
      await screen.findByRole('heading', {
        name: '요청한 페이지가 없습니다'
      })
    ).toBeInTheDocument()
  })

  it('일반 PUSH navigation에서 main focus, top scroll, 화면 안내를 제공한다', async () => {
    const user = userEvent.setup()
    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined)
    renderRoutes('/')
    expect(
      await screen.findByRole('heading', {
        name: /틀린 문제를 끝까지 해결하는 학습/
      })
    ).toBeInTheDocument()

    const navigation = screen.getByRole('navigation', { name: '주요 메뉴' })
    await user.click(within(navigation).getByRole('link', { name: '문제풀이' }))
    expect(
      await screen.findByRole('heading', {
        name: '오늘 풀 문제를 설정하세요'
      })
    ).toBeInTheDocument()

    await vi.waitFor(() => {
      expect(document.querySelector('#main-content')).toHaveFocus()
      expect(
        screen.getByText('문제풀이 설정 화면으로 이동했습니다.')
      ).toBeInTheDocument()
    })
    expect(scrollTo).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: 'auto'
    })
  })

  it('hash navigation은 main top scroll보다 대상 포커스를 우선한다', async () => {
    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined)
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    })

    try {
      const router = renderRoutes('/')
      const target = await screen.findByRole('heading', {
        name: '문제를 푸는 순간부터 복습까지 연결됩니다'
      })

      await act(async () => {
        await router.navigate('/#loop-title')
      })

      await vi.waitFor(() => {
        expect(target).toHaveFocus()
      })
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
      expect(scrollTo).not.toHaveBeenCalled()
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScrollIntoView
        })
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
      }
    }
  })

  it('lazy route의 hash target이 늦게 나타나도 해당 대상을 포커스한다', async () => {
    const rootRoute = appRoutes[0]
    expect(rootRoute).toBeDefined()
    if (!rootRoute) {
      return
    }

    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined)
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    })

    try {
      const router = renderRoutes('/start', [
        {
          path: rootRoute.path,
          element: rootRoute.element,
          errorElement: rootRoute.errorElement,
          children: [
            { path: 'start', element: <h1>시작 화면</h1> },
            { path: 'delayed', element: <DelayedHashTarget /> }
          ]
        }
      ])
      await screen.findByRole('heading', { name: '시작 화면' })

      await act(async () => {
        await router.navigate('/delayed#delayed-target')
      })

      const target = await screen.findByRole('heading', {
        name: '늦게 준비된 대상'
      })
      await vi.waitFor(() => expect(target).toHaveFocus())
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
      expect(scrollTo).not.toHaveBeenCalled()
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScrollIntoView
        })
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
      }
    }
  })

  it('search-only navigation은 포커스와 top scroll을 다시 설정하지 않는다', async () => {
    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined)
    const router = renderRoutes('/practice')
    await screen.findByRole('heading', {
      name: '오늘 풀 문제를 설정하세요'
    })
    const main = document.querySelector('#main-content')
    expect(main).not.toHaveFocus()

    await act(async () => {
      await router.navigate('/practice?level=N2')
    })

    await vi.waitFor(() => {
      expect(router.state.location.search).toBe('?level=N2')
    })
    expect(main).not.toHaveFocus()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('POP navigation은 브라우저의 scroll 복원을 덮어쓰지 않는다', async () => {
    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined)
    const router = renderRoutes('/')
    await screen.findByRole('heading', {
      name: /틀린 문제를 끝까지 해결하는 학습/
    })

    await act(async () => {
      await router.navigate('/practice')
    })
    await screen.findByRole('heading', {
      name: '오늘 풀 문제를 설정하세요'
    })
    scrollTo.mockClear()

    await act(async () => {
      await router.navigate(-1)
    })
    await screen.findByRole('heading', {
      name: /틀린 문제를 끝까지 해결하는 학습/
    })

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('문제풀이 화면은 Layout main 대신 현재 문제 제목을 포커스한다', async () => {
    mockDatabase.loginAs('USER')
    const sessionPayload = await createStudySessionV1({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    queryClient.setQueryData(
      studyQueries.session(sessionPayload.session.id).queryKey,
      toCanonicalStudySessionView(sessionPayload)
    )
    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined)
    const router = renderRoutes('/practice')
    await screen.findByRole('heading', {
      name: '오늘 풀 문제를 설정하세요'
    })

    await act(async () => {
      await router.navigate(`/practice/session/${sessionPayload.session.id}`)
    })

    const questionHeading = await screen.findByRole(
      'heading',
      {
        level: 1,
        name: /1번 문제/
      },
      { timeout: 3000 }
    )
    await vi.waitFor(
      () => {
        expect(questionHeading).toHaveFocus()
      },
      { timeout: 3000 }
    )
    expect(document.querySelector('#main-content')).not.toHaveFocus()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('POP으로 결과 화면에 복귀할 때 결과 포커스가 native scroll 복원을 덮지 않는다', async () => {
    mockDatabase.loginAs('USER')
    const sessionPayload = await createStudySessionV1({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const sessionView = toCanonicalStudySessionView(sessionPayload)
    const sessionQuestion = sessionPayload.questions[0]

    if (!sessionQuestion) {
      throw new Error('테스트 세션에 문제가 없습니다.')
    }

    const result = await submitStudySessionV1(
      sessionPayload.session.id,
      {
        answers: [
          {
            studySessionQuestionId: sessionQuestion.sessionQuestionId,
            selectedOptionId: null,
            elapsedSec: 2
          }
        ],
        durationSec: 2
      },
      crypto.randomUUID()
    )
    queryClient.setQueryData(
      studyQueries.session(sessionPayload.session.id).queryKey,
      sessionView
    )
    queryClient.setQueryData(
      studyQueries.result(sessionPayload.session.id).queryKey,
      toCanonicalStudyResultView(result)
    )
    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined)
    const router = renderRoutes('/practice')
    await screen.findByRole('heading', {
      name: '오늘 풀 문제를 설정하세요'
    })

    await act(async () => {
      await router.navigate(`/practice/result/${sessionPayload.session.id}`)
    })
    const firstResultHeading = await screen.findByRole('heading', {
      name: '학습 결과'
    })
    await vi.waitFor(() => expect(firstResultHeading).toHaveFocus())

    await act(async () => {
      await router.navigate('/practice')
    })
    await screen.findByRole('heading', {
      name: '오늘 풀 문제를 설정하세요'
    })
    await vi.waitFor(() =>
      expect(document.querySelector('#main-content')).toHaveFocus()
    )
    scrollTo.mockClear()

    await act(async () => {
      await router.navigate(-1)
    })
    const restoredResultHeading = await screen.findByRole('heading', {
      name: '학습 결과'
    })
    expect(restoredResultHeading).not.toHaveFocus()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('render 예외는 실제 route errorElement로 처리한다', async () => {
    const BrokenPage = (): never => {
      throw new Error('route-render-failure')
    }
    const rootRoute = appRoutes[0]
    expect(rootRoute).toBeDefined()
    if (!rootRoute) {
      return
    }

    renderRoutes('/broken', [
      {
        path: rootRoute.path,
        element: rootRoute.element,
        errorElement: rootRoute.errorElement,
        children: [{ path: 'broken', element: <BrokenPage /> }]
      }
    ])

    expect(
      await screen.findByRole('heading', {
        name: '화면을 불러오지 못했습니다'
      })
    ).toBeInTheDocument()
    expect(screen.getByText('route-render-failure')).toBeInTheDocument()
  })
})
