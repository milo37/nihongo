import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { authQueries } from '@nihongo/browser/app/login/queries/authQueries'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ReauthButton } from '@app/admin/reauth/ReauthButton'
import type { ReauthStart } from '@app/admin/reauth/ReauthButton'
import { ReauthRequiredNotice } from '@app/admin/reauth/ReauthRequiredNotice'
import { ReauthStatus } from '@app/admin/reauth/ReauthStatus'
import { reauthClockAt, reauthEndsAt } from '@app/admin/reauth/useReauthClock'
import type { ReactNode } from 'react'

const MINUTE = 60_000
const SERVER_NOW = Date.parse('2026-11-08T10:00:00.000Z')

const admin = (freshMinutes: number | null) => ({
  id: 'admin-1',
  name: '관리자',
  role: 'ADMIN' as const,
  targetLevel: null,
  adminSessionExpiresAt: '2026-11-08T18:00:00.000Z',
  adminFreshUntil:
    freshMinutes === null
      ? null
      : new Date(SERVER_NOW + freshMinutes * MINUTE).toISOString(),
  adminServerTime: new Date(SERVER_NOW).toISOString()
})

const start = (pending = false): ReauthStart => ({
  run: vi.fn(),
  pending,
  pendingLabel: 'Google로 이동 중…'
})

const renderWithUser = (
  user: ReturnType<typeof admin>,
  ui: ReactNode
): QueryClient => {
  const client = new QueryClient()
  client.setQueryData(authQueries.currentUser().queryKey, user)
  render(
    <QueryClientProvider client={client}>
      <I18nProvider>{ui}</I18nProvider>
    </QueryClientProvider>
  )
  return client
}

afterEach(() => vi.useRealTimers())

it('measures the window on the server clock and rounds minutes up', () => {
  // The browser clock is 7 minutes fast; 28 minutes were left on arrival.
  const receivedAt = SERVER_NOW + 7 * MINUTE
  const endsAt = reauthEndsAt(
    admin(28).adminFreshUntil,
    admin(28).adminServerTime,
    receivedAt
  )
  expect(endsAt).toBe(receivedAt + 28 * MINUTE)
  expect(reauthClockAt(endsAt, receivedAt)).toEqual({
    state: 'active',
    minutes: 28
  })
  expect(reauthClockAt(endsAt, receivedAt + 23 * MINUTE + 50_000)).toEqual({
    state: 'soon',
    minutes: 5
  })
  expect(reauthClockAt(endsAt, receivedAt + 28 * MINUTE)).toEqual({
    state: 'need'
  })
  expect(reauthEndsAt(null, admin(28).adminServerTime, receivedAt)).toBeNull()
  expect(reauthClockAt(null, receivedAt)).toEqual({ state: 'need' })
})

it('shows the time left, warns once at five minutes and once at the end', () => {
  vi.useFakeTimers({ now: SERVER_NOW })
  renderWithUser(admin(6), <ReauthStatus start={start()} />)
  expect(screen.getByText('본인 확인 · 6분 남음')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '연장' })).toBeNull()
  expect(screen.getByRole('status')).toHaveTextContent('')

  act(() => vi.advanceTimersByTime(MINUTE + 100))
  expect(screen.getByText('본인 확인 · 5분 남음')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '연장' })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(
    '본인 확인이 5분 뒤 끝납니다.'
  )

  act(() => vi.advanceTimersByTime(MINUTE + 100))
  expect(screen.getByText('본인 확인 · 4분 남음')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(
    '본인 확인이 5분 뒤 끝납니다.'
  )

  for (let minute = 0; minute < 4; minute += 1)
    act(() => vi.advanceTimersByTime(MINUTE + 100))
  expect(screen.getByRole('button', { name: '본인 확인' })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(
    '본인 확인 시간이 끝났습니다.'
  )
})

it('offers the check when the session is not fresh and blocks a second press', () => {
  const idle = start()
  const { rerender } = render(
    <I18nProvider>
      <ReauthButton start={idle} />
    </I18nProvider>
  )
  screen.getByRole('button', { name: '본인 확인' }).click()
  expect(idle.run).toHaveBeenCalledTimes(1)

  rerender(
    <I18nProvider>
      <ReauthButton start={start(true)} />
    </I18nProvider>
  )
  const busy = screen.getByRole('button', { name: 'Google로 이동 중…' })
  expect(busy).toBeDisabled()
  expect(busy).toHaveAttribute('aria-busy', 'true')
})

it('starts with the check button when no fresh window is reported', () => {
  renderWithUser(admin(null), <ReauthStatus start={start()} />)
  expect(screen.getByRole('button', { name: '본인 확인' })).toBeInTheDocument()
  expect(screen.queryByText(/남음/u)).toBeNull()
})

it('explains an expired command in the dialog and focuses the check', () => {
  render(
    <I18nProvider>
      <ReauthRequiredNotice command="승인" keeps="selection" />
      <ReauthButton start={start()} variant="primary" focusOnMount />
    </I18nProvider>
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    '본인 확인 시간이 끝나 ‘승인’ 작업을 적용하지 않았습니다.'
  )
  expect(screen.getByRole('alert')).toHaveTextContent('선택한 문제는 그대로')
  expect(
    screen.getByText('관리자 작업은 본인 확인 후 30분 동안 다시 묻지 않습니다.')
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '본인 확인' })).toHaveFocus()
})
