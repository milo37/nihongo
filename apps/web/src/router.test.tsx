import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { ReactElement } from 'react'
import type { RouteObject } from 'react-router'
import { appRoutes } from '@/router'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import { getStudySessionV2 } from '@api/study/getStudySessionV2'
import { getStudyDraftAnswers } from '@api/study/getStudyDraftAnswers'
import { getStudyResultV1 } from '@api/study/getStudyResultV1'
import { submitStudySessionV2 } from '@api/study/submitStudySessionV2'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import { toCanonicalStudyResultView } from '@app/practice/adapters/studyResultView'
import { studySessionQueries } from '@app/practice/queries/studySessionQueries'
import { studyResultQueries } from '@app/practice/queries/studyResultQueries'
import { I18nProvider } from '@provider/I18nProvider'
import { ToastProvider } from '@common/components/Toast'
import { queryClient } from '@libs/queryClient'
import { adminQuestionHandlers } from '@mocks/handlers/adminQuestionHandlers'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { mockServer } from '@/test/server'

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
      <I18nProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  )

  return router
}

describe('application router boundaries', () => {
  it('guest의 보호 상세 경로와 search를 login redirect에 보존한다', async () => {
    const entry =
      '/wrong-notes/00000000-0000-4000-8000-000000000001?returnTo=%2Fwrong-notes%3Fview%3DUNREVIEWED'
    const router = renderRoutes(entry)
    expect(
      await screen.findByRole('heading', { name: '로그인' })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe(
      `?redirect=${encodeURIComponent(entry)}`
    )
  })

  it('guest의 공개 복습 진입은 로그인 안내와 보호된 기록 경계를 제공한다', async () => {
    const router = renderRoutes('/wrong-notes')
    expect(
      await screen.findByRole('heading', { name: '복습' })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/wrong-notes')
    const main = screen.getByRole('main')
    expect(within(main).getByRole('link', { name: '로그인' })).toHaveAttribute(
      'href',
      '/login?redirect=%2Fwrong-notes'
    )
    expect(within(main).queryByRole('combobox')).not.toBeInTheDocument()
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

  it('ADMIN은 목록 fixture가 준비된 관리자 경로에 접근한다', async () => {
    mockServer.use(...adminQuestionHandlers)
    mockDatabase.loginAs('ADMIN')
    const router = renderRoutes('/admin/questions')

    expect(
      await screen.findByRole('heading', { name: '문제 관리' })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admin/questions')
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
    const router = renderRoutes('/')
    expect(
      await screen.findByRole('heading', {
        name: '학습'
      })
    ).toBeInTheDocument()

    const navigation = screen.getByRole('navigation', { name: '주요 메뉴' })
    await user.click(within(navigation).getByRole('link', { name: '학습' }))
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/practice')
      expect(router.state.navigation.state).toBe('idle')
      expect(screen.getByRole('heading', { name: '학습' })).toBeInTheDocument()
    })

    await vi.waitFor(() => {
      expect(document.querySelector('#main-content')).toHaveFocus()
      expect(
        screen.getByText('학습 화면으로 이동했습니다.')
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
      const rootRoute = appRoutes[0]
      if (!rootRoute) throw new Error('Application root route required')
      const router = renderRoutes('/hash', [
        {
          path: rootRoute.path,
          element: rootRoute.element,
          errorElement: rootRoute.errorElement,
          children: [
            { path: 'hash', element: <h1 id="hash-target">해시 대상</h1> }
          ]
        }
      ])
      const target = await screen.findByRole('heading', { name: '해시 대상' })
      await act(async () => {
        await router.navigate('/hash#hash-target')
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
      name: '학습'
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
      name: '학습'
    })

    await act(async () => {
      await router.navigate('/practice')
    })
    await screen.findByRole('heading', {
      name: '학습'
    })
    scrollTo.mockClear()

    await act(async () => {
      await router.navigate(-1)
    })
    await screen.findByRole('heading', {
      name: '학습'
    })

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('문제풀이 화면은 Layout main 대신 현재 문제 제목을 포커스한다', async () => {
    const sessionPayload = (
      await createStudySessionV2({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1
      })
    ).data
    queryClient.setQueryData(
      studySessionQueries.session(sessionPayload.session.id).queryKey,
      toCanonicalStudySessionView(sessionPayload)
    )
    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined)
    const router = renderRoutes('/practice')
    await screen.findByRole('heading', {
      name: '학습'
    })

    await act(async () => {
      await router.navigate(`/practice/session/${sessionPayload.session.id}`)
    })

    const questionHeading = await screen.findByRole(
      'heading',
      {
        level: 1,
        name: new RegExp(
          sessionPayload.questions[0]?.question.questionText ??
            'missing-fixture'
        )
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
    const created = await createStudySessionV2({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const sessionId = created.data.session.id
    const draft = (await getStudyDraftAnswers(sessionId)).data
    await submitStudySessionV2(
      sessionId,
      {
        answers: draft.answers,
        durationSec: 0,
        expectedDraftRevision: draft.revision
      },
      crypto.randomUUID()
    )
    const sessionPayload = (await getStudySessionV2(sessionId)).data
    const result = await getStudyResultV1(sessionId)
    queryClient.setQueryData(
      studySessionQueries.session(sessionId).queryKey,
      toCanonicalStudySessionView(sessionPayload)
    )
    queryClient.setQueryData(
      studyResultQueries.result(sessionId).queryKey,
      toCanonicalStudyResultView(result)
    )
    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined)
    const router = renderRoutes('/practice')
    await screen.findByRole('heading', {
      name: '학습'
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
      name: '학습'
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
    expect(
      screen.getByText('예상하지 못한 오류가 발생했습니다.')
    ).toBeInTheDocument()
    expect(screen.queryByText('route-render-failure')).not.toBeInTheDocument()
  })
})
