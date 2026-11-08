import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import * as startApi from '@nihongo/browser/api/auth/startAdminReauth/index'
import { authQueries } from '@nihongo/browser/app/login/queries/authQueries'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import {
  recordServerDate,
  resetServerClockForTesting
} from '@nihongo/browser/libs/serverClock'
import {
  ReauthDialogButton,
  ReauthRequiredNotice
} from '@app/admin/reauth/ReauthRequiredNotice'
import { AdminReauthStatus } from '@app/admin/reauth/ReauthStatus'
import { useAdminReauth } from '@app/admin/reauth/useAdminReauth'
import { reauthClockFor } from '@app/admin/reauth/hooks/useReauthClock'
import type { ReactElement, ReactNode } from 'react'

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
      : new Date(SERVER_NOW + freshMinutes * MINUTE).toISOString()
})

const renderWith = (
  user: ReturnType<typeof admin> | null,
  ui: ReactNode
): void => {
  const client = new QueryClient()
  if (user) client.setQueryData(authQueries.currentUser().queryKey, user)
  render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter
          basename="/admin"
          initialEntries={['/admin/questions?level=N3']}
        >
          {ui}
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>
  )
}

afterEach(() => {
  resetServerClockForTesting()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('rounds the minutes left up and warns from five minutes', () => {
  expect(reauthClockFor(28 * MINUTE)).toEqual({ state: 'active', minutes: 28 })
  expect(reauthClockFor(4 * MINUTE + 10_000)).toEqual({
    state: 'soon',
    minutes: 5
  })
  expect(reauthClockFor(0)).toEqual({ state: 'need' })
})

it('counts on the server clock, warns once at five minutes and once at the end', () => {
  vi.useFakeTimers({ now: SERVER_NOW })
  // The /me Date header says the server is 3 minutes behind the browser, so
  // 6 minutes are left by the server although the browser counts 3.
  recordServerDate(new Date(SERVER_NOW - 3 * MINUTE).toUTCString(), SERVER_NOW)
  renderWith(admin(3), <AdminReauthStatus />)
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

it('offers the check when no fresh window is reported', () => {
  renderWith(admin(null), <AdminReauthStatus />)
  expect(screen.getByRole('button', { name: '본인 확인' })).toBeInTheDocument()
  expect(screen.queryByText(/남음/u)).toBeNull()
  expect(screen.getByRole('group', { name: '본인 확인' })).toHaveAttribute(
    'id',
    'reauth-status'
  )
})

const ExpiredDialogBody = ({
  keep
}: {
  readonly keep: () => boolean
}): ReactElement => {
  const reauth = useAdminReauth()
  return (
    <>
      <ReauthRequiredNotice command="승인" keeps="selection" reauth={reauth} />
      <ReauthDialogButton reauth={reauth} keep={keep} />
    </>
  )
}

it('explains an expired command, focuses the check and stays when input cannot be kept', async () => {
  const user = userEvent.setup()
  const start = vi
    .spyOn(startApi, 'startAdminReauth')
    .mockReturnValue(new Promise(() => undefined))
  renderWith(admin(null), <ExpiredDialogBody keep={() => false} />)
  expect(screen.getByRole('alert')).toHaveTextContent(
    '본인 확인 시간이 끝나 ‘승인’ 작업을 적용하지 않았습니다.'
  )
  expect(screen.getByRole('alert')).toHaveTextContent('선택한 문제는 그대로')
  expect(
    screen.getByText('관리자 작업은 본인 확인 후 30분 동안 다시 묻지 않습니다.')
  ).toBeInTheDocument()
  const button = screen.getByRole('button', { name: '본인 확인' })
  expect(button).toHaveFocus()

  await user.click(button)
  expect(start).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent(
    '입력을 보관하지 못해 본인 확인 화면으로 이동하지 않았습니다.'
  )
})

it('leaves for Google from this page once the input is kept', async () => {
  const user = userEvent.setup()
  const start = vi
    .spyOn(startApi, 'startAdminReauth')
    .mockReturnValue(new Promise(() => undefined))
  const keep = vi.fn(() => true)
  renderWith(admin(null), <ExpiredDialogBody keep={keep} />)
  await user.click(screen.getByRole('button', { name: '본인 확인' }))
  expect(keep).toHaveBeenCalledTimes(1)
  expect(start).toHaveBeenCalledWith({
    purpose: 'ADMIN_FRESH',
    provider: 'google',
    callbackURL: '/admin/questions?level=N3'
  })
})

it('says in the dialog when leaving for Google failed and lets the admin try again', async () => {
  const user = userEvent.setup()
  let fail: (error: Error) => void = () => undefined
  const start = vi
    .spyOn(startApi, 'startAdminReauth')
    .mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject
      })
    )
    .mockReturnValue(new Promise(() => undefined))
  renderWith(admin(null), <ExpiredDialogBody keep={() => true} />)
  await user.click(screen.getByRole('button', { name: '본인 확인' }))
  // A browser drops focus from the button while it is disabled; jsdom keeps
  // it, so move it elsewhere the way the page would lose it.
  const elsewhere = document.createElement('button')
  document.body.append(elsewhere)
  act(() => elsewhere.focus())
  act(() => fail(new Error('503')))
  expect(
    await screen.findByText('Google로 이동하지 못했습니다. 다시 시도해 주세요.')
  ).toHaveAttribute('role', 'alert')
  expect(screen.getByRole('button', { name: '본인 확인' })).toHaveFocus()
  elsewhere.remove()

  await user.click(screen.getByRole('button', { name: '본인 확인' }))
  expect(start).toHaveBeenCalledTimes(2)
  expect(screen.queryByText(/Google로 이동하지 못했습니다/u)).toBeNull()
})

it('shows a red notice with a retry when the top bar check cannot leave', async () => {
  const user = userEvent.setup()
  const start = vi
    .spyOn(startApi, 'startAdminReauth')
    .mockRejectedValueOnce(new Error('503'))
    .mockRejectedValueOnce(new Error('503'))
    .mockReturnValue(new Promise(() => undefined))
  renderWith(admin(null), <AdminReauthStatus />)
  await user.click(screen.getByRole('button', { name: '본인 확인' }))
  const notice = await screen.findByRole('alert')
  expect(notice).toHaveTextContent(
    'Google로 이동하지 못했습니다. 다시 시도해 주세요.'
  )
  expect(notice).toHaveFocus()

  await user.click(screen.getByRole('button', { name: '닫기' }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('group', { name: '본인 확인' })).toHaveFocus()

  await user.click(screen.getByRole('button', { name: '본인 확인' }))
  await screen.findByRole('alert')
  await user.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(start).toHaveBeenCalledTimes(3)
  expect(start).toHaveBeenLastCalledWith({
    purpose: 'ADMIN_FRESH',
    provider: 'google',
    callbackURL: '/admin/questions?level=N3'
  })
})
