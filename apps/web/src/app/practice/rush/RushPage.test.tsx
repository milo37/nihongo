import { Suspense } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { http } from 'msw'
import { queryClient } from '@nihongo/browser/libs/queryClient'
import { ProtectedRouteProvider } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { practiceRoutes } from '@app/practice/router'
import { rushPairsByLevel } from '@mocks/data/rushPairs'
import { resetRushBests } from '@mocks/handlers/rushHandlers'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { mockServer } from '@/test/server'

const renderRush = (entry: string) => {
  const router = createMemoryRouter(
    [
      {
        element: (
          <ProtectedRouteProvider>
            <Outlet />
          </ProtectedRouteProvider>
        ),
        children: practiceRoutes
      }
    ],
    { initialEntries: [entry] }
  )
  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <Suspense fallback={<p>확인 중</p>}>
            <RouterProvider router={router} />
          </Suspense>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  )
  return router
}

const shownWord = () =>
  Array.from(document.querySelectorAll('.rush-box > span'))
    .map((cell) => cell.textContent)
    .join('')

/** 1-based key of the right (or a wrong) reading for the word on screen. */
const keyFor = (right: boolean) => {
  const word = shownWord()
  const answer = rushPairsByLevel.N2!.find((pair) => pair[0] === word)![1]
  const choices = Array.from(
    document.querySelectorAll('.rush-choices button span')
  ).map((cell) => cell.textContent)
  const index = choices.indexOf(answer!)
  return String((right ? index : (index + 1) % 4) + 1)
}

const answer = (right: boolean) => {
  fireEvent.keyDown(window, { key: keyFor(right) })
  act(() => vi.advanceTimersByTime(350))
}

const startRound = async (name = '시작') => {
  const start = await screen.findByRole('button', { name })
  await waitFor(() => expect(start).toBeEnabled())
  vi.useFakeTimers({
    toFake: [
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
      'Date'
    ]
  })
  fireEvent.click(start)
}

describe('#1043 30초 한자 러시', () => {
  afterEach(() => {
    vi.useRealTimers()
    resetRushBests()
    queryClient.clear()
  })

  it('비회원이 주소로 들어오면 학습 탭으로 돌아가고 학습 탭에 진입 줄이 없다', async () => {
    const router = renderRush('/practice/rush?level=N2')
    await waitFor(
      () => expect(router.state.location.pathname).toBe('/practice'),
      { timeout: 5000 }
    )
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByText('한자 스피드 퀴즈')).not.toBeInTheDocument()
  })

  it('30초 동안 숫자 키로 풀고, 끝나면 입력이 막히고 결과·첫 기록을 보여 준다', async () => {
    mockDatabase.loginAs('USER')
    const puts: unknown[] = []
    mockServer.events.on('request:start', ({ request }) => {
      if (request.method === 'PUT' && request.url.endsWith('/me/rush-best'))
        void request
          .clone()
          .json()
          .then((body) => puts.push(body))
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    renderRush('/practice/rush?level=N2')
    expect(
      await screen.findByRole('heading', { name: 'N2 한자 스피드 퀴즈' })
    ).toBeInTheDocument()
    await startRound()

    expect(screen.getByRole('timer')).toHaveAccessibleName('남은 시간 30초')
    answer(true)
    answer(true)
    expect(screen.getByText('2연속')).toBeInTheDocument()
    answer(false)
    expect(screen.queryByText(/연속/)).not.toBeInTheDocument()
    answer(true)

    act(() => vi.advanceTimersByTime(30_000))
    vi.useRealTimers()
    expect(
      await screen.findByRole('heading', { name: /3개 맞혔어요/ })
    ).toBeInTheDocument()
    expect(
      screen.getByText('4개 중 3개 · 최대 2개 연속 정답')
    ).toBeInTheDocument()
    expect(await screen.findByText('첫 기록이에요')).toBeInTheDocument()
    expect(puts).toEqual([{ mode: 'KANJI_RUSH_30S', level: 'N2', score: 3 }])
    expect(
      setItem.mock.calls.some(([key]) => String(key).includes('rush'))
    ).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '틀린 것 보기 1' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('틀린 한자 1개')).toBeInTheDocument()
    mockServer.events.removeAllListeners()
  })

  it('같은 단어가 연달아 나오지 않고, 낮은 판은 최고 기록을 바꾸지 않는다', async () => {
    mockDatabase.loginAs('USER')
    renderRush('/practice/rush?level=N2')
    await startRound()
    let last = ''
    for (let i = 0; i < 40; i++) {
      expect(shownWord()).not.toBe(last)
      last = shownWord()
      answer(true)
    }
    act(() => vi.advanceTimersByTime(30_000))
    vi.useRealTimers()
    expect(await screen.findByText('첫 기록이에요')).toBeInTheDocument()

    await startRound('한 번 더')
    answer(true)
    act(() => vi.advanceTimersByTime(30_000))
    vi.useRealTimers()
    expect(await screen.findByText('내 최고기록 40개')).toBeInTheDocument()
    expect(screen.queryByText('최고 기록이에요')).not.toBeInTheDocument()
  })

  it('판 도중 탭을 떠나면 기록 없이 준비 화면으로 돌아간다', async () => {
    mockDatabase.loginAs('USER')
    const put = vi.fn()
    mockServer.use(http.put('*/api/v1/me/rush-best', put))
    renderRush('/practice/rush?level=N2')
    await startRound()
    answer(true)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    vi.useRealTimers()
    expect(
      await screen.findByRole('button', { name: '시작' })
    ).toBeInTheDocument()
    expect(put).not.toHaveBeenCalled()
  })
})
