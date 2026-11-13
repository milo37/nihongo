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
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { queryClient } from '@nihongo/browser/libs/queryClient'
import { mockDatabase } from '@mocks/repository/mockDatabase'

// Compile every lazy page this file opens before any test starts its wait.
// The first test to open a lazy route otherwise pays the cold module
// transform inside its wait, which a slow CI runner can push past the limit.
beforeAll(async () => {
  await Promise.all([
    import('@app/home/page'),
    import('@app/practice/page'),
    import('@app/practice/session/page'),
    import('@app/practice/result/page')
  ])
})

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
  it('guest가 보호 상세 경로에 오면 그 자리에서 로그인 안내 카드를 보여 준다 (U4 R4)', async () => {
    const entry =
      '/wrong-notes/00000000-0000-4000-8000-000000000001?returnTo=%2Fwrong-notes%3Fview%3DUNREVIEWED'
    const router = renderRoutes(entry)
    expect(
      await screen.findByRole(
        'heading',
        { level: 2, name: '틀린 문제가 여기에 모여요' },
        { timeout: 3000 }
      )
    ).toBeInTheDocument()
    // No silent move to /login: the address stays for the sign-in return.
    expect(
      `${router.state.location.pathname}${router.state.location.search}`
    ).toBe(entry)
    expect(
      screen.getByText(
        '로그인하고 풀면 틀린 문제가 저절로 모여요. 풀기는 로그인 없이도 돼요.'
      )
    ).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('guest의 공개 복습 진입은 로그인 안내와 보호된 기록 경계를 제공한다', async () => {
    const router = renderRoutes('/wrong-notes')
    expect(
      await screen.findByRole(
        'heading',
        { name: '오답노트' },
        { timeout: 3000 }
      )
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/wrong-notes')
    const main = screen.getByRole('main')
    expect(
      within(main).getByRole('heading', {
        level: 2,
        name: '틀린 문제가 여기에 모여요'
      })
    ).toBeVisible()
    expect(within(main).getByRole('button', { name: '로그인' })).toBeEnabled()
    expect(within(main).queryByRole('combobox')).not.toBeInTheDocument()
  })

  it.each(['USER', 'ADMIN'] as const)(
    '%s도 학습자 router에서는 관리자 화면을 로드하지 않는다',
    async (role) => {
      mockDatabase.loginAs(role)
      const router = renderRoutes('/admin/questions')
      expect(
        await screen.findByRole('heading', { name: '없는 페이지예요' })
      ).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/admin/questions')
      expect(
        screen.queryByRole('heading', { name: '문제 관리' })
      ).not.toBeInTheDocument()
    }
  )

  it('등록되지 않은 경로는 Not Found를 표시한다', async () => {
    renderRoutes('/not-registered')

    expect(
      await screen.findByRole('heading', {
        name: '없는 페이지예요'
      })
    ).toBeInTheDocument()
  })

  it('일반 PUSH navigation에서 main focus, top scroll, 화면 안내를 제공한다', async () => {
    const user = userEvent.setup()
    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined)
    // JLP-873: the first tab is '홈' and goes to / from anywhere.
    const router = renderRoutes('/practice')
    expect(
      await screen.findByRole(
        'heading',
        { name: '무엇을 풀까요?' },
        { timeout: 3000 }
      )
    ).toBeInTheDocument()

    const navigation = document.getElementById(
      'primary-navigation'
    ) as HTMLElement
    await user.click(within(navigation).getByRole('link', { name: '홈' }))
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
      expect(router.state.navigation.state).toBe('idle')
      expect(
        screen.getByRole('heading', { name: /^오늘은 N5 문자·어휘/u })
      ).toBeInTheDocument()
    })

    await vi.waitFor(() => {
      expect(document.querySelector('#main-content')).toHaveFocus()
      expect(screen.getByText('홈 화면이에요.')).toBeInTheDocument()
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
      const rootRoute = appRoutes.find((route) => route.path === '/')
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
    const rootRoute = appRoutes.find((route) => route.path === '/')
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
      name: '무엇을 풀까요?'
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
      name: /^오늘은 N5 문자·어휘/u
    })

    await act(async () => {
      await router.navigate('/practice')
    })
    await screen.findByRole('heading', {
      name: '무엇을 풀까요?'
    })
    scrollTo.mockClear()

    await act(async () => {
      await router.navigate(-1)
    })
    await screen.findByRole('heading', {
      name: /^오늘은 N5 문자·어휘/u
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
      name: '무엇을 풀까요?'
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
      name: '무엇을 풀까요?'
    })

    await act(async () => {
      await router.navigate(`/practice/result/${sessionPayload.session.id}`)
    })
    const firstResultHeading = await screen.findByRole('heading', {
      level: 1,
      name: /문제 중 .*맞음/u
    })
    await vi.waitFor(() => expect(firstResultHeading).toHaveFocus())

    await act(async () => {
      await router.navigate('/practice')
    })
    await screen.findByRole('heading', {
      name: '무엇을 풀까요?'
    })
    await vi.waitFor(() =>
      expect(document.querySelector('#main-content')).toHaveFocus()
    )
    scrollTo.mockClear()

    await act(async () => {
      await router.navigate(-1)
    })
    const restoredResultHeading = await screen.findByRole('heading', {
      level: 1,
      name: /문제 중 .*맞음/u
    })
    expect(restoredResultHeading).not.toHaveFocus()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('render 예외는 실제 route errorElement로 처리한다', async () => {
    const BrokenPage = (): never => {
      throw new Error('route-render-failure')
    }
    const rootRoute = appRoutes.find((route) => route.path === '/')
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
        name: '화면을 불러오지 못했어요'
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText('알 수 없는 문제가 생겼어요. 새로고침해 주세요.')
    ).toBeInTheDocument()
    expect(screen.queryByText('route-render-failure')).not.toBeInTheDocument()
  })
})
