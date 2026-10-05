import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import { useAppStore } from '@store/index'
import { appI18n } from '@/i18n/config'
import {
  DashboardRecommendedEntry,
  LearningEntry
} from '@app/dashboard/components/LearningEntry'
import { LearningHomePage } from '@app/dashboard/page'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resume: vi.fn(),
  insights: vi.fn(),
  action: vi.fn(),
  run: vi.fn(),
  retry: vi.fn(),
  ready: vi.fn()
}))
vi.mock('@provider/ProtectedRouteProvider', () => ({ useAuth: mocks.auth }))
vi.mock('@app/practice/hooks/useListResumableStudySessions', () => ({
  useListResumableStudySessions: mocks.resume
}))
vi.mock('@app/dashboard/hooks/useGetDashboardInsights', () => ({
  useGetDashboardInsights: mocks.insights
}))
vi.mock('@app/dashboard/hooks/useDashboardRecommendationAction', () => ({
  useDashboardRecommendationAction: mocks.action
}))

const recommendation = (rank: number) => ({
  rank,
  kind: 'RECENT_LOW_ACCURACY_TYPE',
  title: `추천 ${rank}`,
  reason: {
    leading: '최근 응답 6개 중 4개 오답',
    japanesePreview: null,
    trailing: ''
  },
  action: {
    kind: 'START_SESSION',
    level: 'N2',
    subject: 'GRAMMAR',
    mode: 'WEAKNESS',
    count: 5
  },
  actionLabel: `추천 ${rank} 시작`,
  actionSummary: 'N2 문법 · 최대 5문제'
})
const renderHome = () =>
  render(
    <MemoryRouter>
      <LearningHomePage />
    </MemoryRouter>
  )

beforeEach(() => {
  mocks.auth.mockReturnValue({
    isReady: true,
    role: 'USER',
    user: { id: 'member' }
  })
  mocks.resume.mockReturnValue({
    isPending: false,
    isError: false,
    fetchStatus: 'idle',
    data: { items: [] },
    refetch: mocks.retry
  })
  mocks.insights.mockReturnValue({
    isPending: false,
    isError: false,
    fetchStatus: 'idle',
    data: {
      personalizationNotice: '개인화 근거가 아직 충분하지 않습니다.',
      recommendations: [recommendation(2), recommendation(1)]
    },
    refetch: mocks.retry
  })
  mocks.action.mockReturnValue({
    isActionPending: false,
    blockedRecommendationKind: null,
    pendingRecommendationKind: null,
    actionNotice: null,
    runRecommendation: mocks.run,
    retryInsights: mocks.retry
  })
  mocks.run.mockClear()
  mocks.retry.mockReset()
  mocks.retry.mockResolvedValue({ isSuccess: false })
})

describe('NH-P01 home entry', () => {
  it('uses the smallest rank and preserves evidence, scope and alternate choice', async () => {
    renderHome()
    expect(screen.getByRole('heading', { name: '추천 1' })).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: '추천 2' })
    ).not.toBeInTheDocument()
    expect(screen.getByText('최근 응답 6개 중 4개 오답')).toBeVisible()
    expect(
      screen.getByText('개인화 근거가 아직 충분하지 않습니다.')
    ).toBeVisible()
    expect(screen.getByText(/다른 유형도 함께/)).toBeVisible()
    expect(
      screen.getByRole('link', { name: '다른 학습 고르기' })
    ).toHaveAttribute('href', '/practice?count=5')
    await userEvent.click(screen.getByRole('button', { name: '추천 1 시작' }))
    expect(mocks.run).toHaveBeenCalledWith(recommendation(1))
  })
  it('prioritizes the latest returned resumable session with actual count and saved time', () => {
    mocks.resume.mockReturnValue({
      isPending: false,
      isError: false,
      fetchStatus: 'idle',
      data: {
        items: [
          {
            id: 'resume-1',
            level: 'N2',
            subject: 'READING',
            currentOrdinal: 2,
            actualCount: 3,
            draftSavedAt: '2026-10-03T03:00:00Z',
            resumeAvailability: 'SERVER'
          }
        ]
      }
    })
    renderHome()
    expect(screen.getByText('현재 2번 · 실제 3문제')).toBeVisible()
    expect(screen.getByText(/서버에 마지막 저장/)).toBeVisible()
    expect(screen.getByRole('link', { name: '이어서 풀기' })).toHaveAttribute(
      'href',
      '/practice/session/resume-1'
    )
    expect(
      screen.queryByRole('button', { name: '추천 1 시작' })
    ).not.toBeInTheDocument()
  })
  it('does not offer stale recommendations when resume lookup failed', async () => {
    mocks.resume.mockReturnValue({
      isPending: false,
      isError: true,
      fetchStatus: 'idle',
      refetch: mocks.retry,
      data: { items: [] }
    })
    renderHome()
    expect(screen.getByRole('alert')).toHaveTextContent(
      '이어갈 학습을 확인하지 못했습니다'
    )
    expect(
      screen.queryByRole('button', { name: '추천 1 시작' })
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '다시 확인' }))
    expect(mocks.retry).toHaveBeenCalledOnce()
  })
  it('blocks an exhausted recommendation while exposing the existing retry action', async () => {
    mocks.action.mockReturnValue({
      isActionPending: false,
      blockedRecommendationKind: 'RECENT_LOW_ACCURACY_TYPE',
      pendingRecommendationKind: null,
      actionNotice: { code: 'sessionExhausted', id: 1 },
      runRecommendation: mocks.run,
      retryInsights: mocks.retry
    })
    renderHome()
    expect(screen.getByRole('button', { name: '추천 1 시작' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '다시 확인' }))
    expect(mocks.retry).toHaveBeenCalledOnce()
  })
})

it.each(['ko', 'ja'] as const)(
  'restores the recommendation heading after manual retry in %s',
  async (locale) => {
    await appI18n.changeLanguage(locale)
    let finishRetry!: (result: { isSuccess: boolean }) => void
    mocks.retry.mockReturnValue(
      new Promise((resolve) => {
        finishRetry = resolve
      })
    )
    mocks.insights.mockReturnValue({
      isPending: false,
      isError: true,
      isSuccess: false,
      isFetching: false,
      fetchStatus: 'idle',
      refetch: mocks.retry
    })
    const view = render(
      <MemoryRouter>
        <DashboardRecommendedEntry onReady={mocks.ready} />
      </MemoryRouter>
    )
    const retry = screen.getByRole('button')
    retry.focus()
    await userEvent.keyboard('{Enter}')
    mocks.insights.mockReturnValue({
      isPending: false,
      isError: false,
      isSuccess: true,
      isFetching: false,
      fetchStatus: 'idle',
      data: {
        recommendations: [recommendation(1)],
        personalizationNotice: null
      },
      refetch: mocks.retry
    })
    view.rerender(
      <MemoryRouter>
        <DashboardRecommendedEntry onReady={mocks.ready} />
      </MemoryRouter>
    )
    await act(async () => finishRetry({ isSuccess: true }))
    expect(screen.getByRole('heading', { name: '추천 1' })).toHaveFocus()
  }
)

it.each(['ko', 'ja'] as const)(
  'restores the resume heading after manual retry in %s',
  async (locale) => {
    await appI18n.changeLanguage(locale)
    let finishRetry!: (result: { isSuccess: boolean }) => void
    mocks.retry.mockReturnValue(
      new Promise((resolve) => {
        finishRetry = resolve
      })
    )
    mocks.resume.mockReturnValue({
      isPending: false,
      isError: true,
      isSuccess: false,
      isFetching: false,
      fetchStatus: 'idle',
      refetch: mocks.retry
    })
    const view = render(
      <MemoryRouter>
        <LearningEntry isMember />
      </MemoryRouter>
    )
    screen.getByRole('button').focus()
    await userEvent.keyboard('{Enter}')
    mocks.resume.mockReturnValue({
      isPending: false,
      isError: false,
      isSuccess: true,
      isFetching: false,
      fetchStatus: 'idle',
      data: {
        items: [
          {
            id: 'resume',
            level: 'N2',
            subject: 'READING',
            currentOrdinal: 1,
            actualCount: 3,
            draftSavedAt: null,
            resumeAvailability: 'SERVER'
          }
        ]
      },
      refetch: mocks.retry
    })
    view.rerender(
      <MemoryRouter>
        <LearningEntry isMember />
      </MemoryRouter>
    )
    await act(async () => finishRetry({ isSuccess: true }))
    expect(screen.getByRole('heading', { level: 2 })).toHaveFocus()
  }
)

it('does not move focus after a background recommendation refresh', async () => {
  await appI18n.changeLanguage('ko')
  mocks.insights.mockReturnValue({
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    fetchStatus: 'idle',
    data: { recommendations: [recommendation(1)], personalizationNotice: null },
    refetch: mocks.retry
  })
  const view = render(
    <MemoryRouter>
      <DashboardRecommendedEntry onReady={mocks.ready} />
    </MemoryRouter>
  )
  const alternate = screen.getByRole('button', { name: '추천 1 시작' })
  alternate.focus()
  mocks.insights.mockReturnValue({
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: true,
    fetchStatus: 'fetching',
    data: { recommendations: [recommendation(1)], personalizationNotice: null },
    refetch: mocks.retry
  })
  view.rerender(
    <MemoryRouter>
      <DashboardRecommendedEntry onReady={mocks.ready} />
    </MemoryRouter>
  )
  mocks.insights.mockReturnValue({
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    fetchStatus: 'idle',
    data: { recommendations: [recommendation(1)], personalizationNotice: null },
    refetch: mocks.retry
  })
  view.rerender(
    <MemoryRouter>
      <DashboardRecommendedEntry onReady={mocks.ready} />
    </MemoryRouter>
  )
  expect(alternate).toHaveFocus()
})

describe.each(['recommendation', 'resume'] as const)(
  '%s retry intent lifecycle',
  (kind) => {
    const mockQuery = (isError: boolean, empty = false): void => {
      const state = {
        isPending: false,
        isError,
        isSuccess: !isError,
        isFetching: false,
        fetchStatus: 'idle',
        refetch: mocks.retry,
        data:
          kind === 'recommendation'
            ? {
                recommendations: empty ? [] : [recommendation(1)],
                personalizationNotice: null
              }
            : {
                items: empty
                  ? []
                  : [
                      {
                        id: 'resume',
                        level: 'N2',
                        subject: 'READING',
                        currentOrdinal: 1,
                        actualCount: 3,
                        draftSavedAt: null,
                        resumeAvailability: 'SERVER'
                      }
                    ]
              }
      }
      ;(kind === 'recommendation'
        ? mocks.insights
        : mocks.resume
      ).mockReturnValue(state)
    }
    const entry = () => (
      <MemoryRouter>
        <a href="#other">Other action</a>
        {kind === 'recommendation' ? (
          <DashboardRecommendedEntry onReady={mocks.ready} />
        ) : (
          <LearningEntry isMember={false} />
        )}
      </MemoryRouter>
    )
    beforeEach(() => {
      useAppStore.setState({ sessionId: 'resume' })
    })
    afterEach(() => useAppStore.setState({ sessionId: null }))

    it('discards failed retry before automatic recovery', async () => {
      mockQuery(true)
      const view = render(entry())
      await userEvent.click(screen.getByRole('button'))
      await userEvent.tab({ shift: true })
      const alternate = screen.getByRole('link', { name: 'Other action' })
      expect(alternate).toHaveFocus()
      mockQuery(false)
      view.rerender(entry())
      expect(alternate).toHaveFocus()
    })
    it('does not transfer a failed request intent to later automatic success', async () => {
      mockQuery(true)
      const view = render(entry())
      await userEvent.click(screen.getByRole('button'))
      mockQuery(false)
      view.rerender(entry())
      expect(screen.getByRole('heading')).not.toHaveFocus()
    })
    it('discards rejected requests before background recovery', async () => {
      mocks.retry.mockRejectedValue(new Error('offline'))
      mockQuery(true)
      const view = render(entry())
      await userEvent.click(screen.getByRole('button'))
      mockQuery(false)
      view.rerender(entry())
      expect(screen.getByRole('heading')).not.toHaveFocus()
    })
    it('cancels a pending retry when the user moves, even if it succeeds', async () => {
      let finish!: (result: { isSuccess: boolean }) => void
      mocks.retry.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      mockQuery(true)
      const view = render(entry())
      await userEvent.click(screen.getByRole('button'))
      await userEvent.tab({ shift: true })
      const alternate = screen.getByRole('link', { name: 'Other action' })
      mockQuery(false)
      view.rerender(entry())
      await act(async () => finish({ isSuccess: true }))
      expect(alternate).toHaveFocus()
    })
    it('consumes empty success so a later recommendation or resume cannot take focus', async () => {
      let finish!: (result: { isSuccess: boolean }) => void
      mocks.retry.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      mockQuery(true)
      const view = render(entry())
      await userEvent.click(screen.getByRole('button'))
      mockQuery(false, true)
      view.rerender(entry())
      await act(async () => finish({ isSuccess: true }))
      mockQuery(false)
      view.rerender(entry())
      expect(screen.getByRole('heading')).not.toHaveFocus()
    })
    it('ignores completion after unmount', async () => {
      let finish!: (result: { isSuccess: boolean }) => void
      mocks.retry.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      mockQuery(true)
      const view = render(entry())
      await userEvent.click(screen.getByRole('button'))
      view.unmount()
      const other = render(<button>Outside</button>)
      screen.getByRole('button').focus()
      await act(async () => finish({ isSuccess: true }))
      expect(screen.getByRole('button')).toHaveFocus()
      other.unmount()
    })
    it('does not start overlapping manual requests', async () => {
      mocks.retry.mockReturnValue(new Promise(() => {}))
      mockQuery(true)
      render(entry())
      const retry = screen.getByRole('button')
      await userEvent.click(retry)
      await userEvent.click(retry)
      expect(mocks.retry).toHaveBeenCalledOnce()
    })
  }
)
