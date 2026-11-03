import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { getCurrentUser } from '@nihongo/browser/api/auth/getCurrentUser/index'
import { commitCanonicalAuth } from '@nihongo/browser/app/login/authSession'
import { IdleLockDialog } from '@app/admin/idle-lock/IdleLockDialog'
import { IDLE_LOCK_MS } from '@app/admin/idle-lock/useIdleLock'

const admin = { id: 'admin-1', role: 'ADMIN' }

vi.mock('@nihongo/browser/api/auth/getCurrentUser/index', () => ({
  getCurrentUser: vi.fn()
}))
vi.mock('@nihongo/browser/app/login/authSession', () => ({
  commitCanonicalAuth: vi.fn()
}))
vi.mock('@nihongo/browser/provider/ProtectedRouteProvider', () => ({
  useAuth: () => ({ user: admin, role: 'ADMIN', isReady: true })
}))
const me = vi.mocked(getCurrentUser)
const commit = vi.mocked(commitCanonicalAuth)

const title = '15분 동안 사용하지 않아 잠갔습니다'

const renderLocked = async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider>
        <label>
          메모
          <input defaultValue="" />
        </label>
        <IdleLockDialog />
      </I18nProvider>
    </QueryClientProvider>
  )
  const input = screen.getByLabelText('메모')
  fireEvent.change(input, { target: { value: '작성 중' } })
  act(() => vi.advanceTimersByTime(IDLE_LOCK_MS - 1000))
  fireEvent.keyDown(window, { key: 'a' })
  act(() => vi.advanceTimersByTime(IDLE_LOCK_MS - 1000))
  expect(screen.queryByRole('heading', { name: title })).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(1000))
  expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: '대화상자 닫기' })
  ).not.toBeInTheDocument()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))
  })
  return input
}

beforeEach(() => {
  vi.useFakeTimers()
  me.mockReset()
  commit.mockReset()
})
afterEach(() => vi.useRealTimers())

it('unlocks for the same admin and keeps input without re-running anything', async () => {
  me.mockResolvedValue(admin as never)
  const input = await renderLocked()
  expect(screen.queryByRole('heading', { name: title })).not.toBeInTheDocument()
  expect(input).toHaveValue('작성 중')
  expect(commit).not.toHaveBeenCalled()
})

it('stays locked with the failure message when /me fails', async () => {
  me.mockRejectedValue(Object.assign(new Error('503'), { isServerError: true }))
  const input = await renderLocked()
  expect(screen.getByRole('alert')).toHaveTextContent(
    '본인 확인이 끝나지 않았습니다'
  )
  expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
  expect(input).toHaveValue('작성 중')
  expect(commit).not.toHaveBeenCalled()
})

it.each([
  ['401', () => me.mockRejectedValue({ isAuthError: true })],
  ['no session', () => me.mockResolvedValue(null)]
])(
  'stays locked without redirecting when the session ended (%s)',
  async (_, arrange) => {
    arrange()
    const input = await renderLocked()
    expect(screen.getByRole('alert')).toHaveTextContent('로그인이 끝나')
    expect(input).toHaveValue('작성 중')
    expect(commit).not.toHaveBeenCalled()
  }
)

it('hands a different principal to the role guard', async () => {
  const other = { id: 'user-2', role: 'USER' }
  me.mockResolvedValue(other as never)
  await renderLocked()
  expect(commit).toHaveBeenCalledWith(expect.anything(), other)
})
