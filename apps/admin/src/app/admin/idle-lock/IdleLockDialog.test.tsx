import { act, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { useAdminFreshReturn } from '@nihongo/browser/app/login/hooks/useAdminFreshReturn'
import { IdleLockDialog } from '@app/admin/idle-lock/IdleLockDialog'
import { IDLE_LOCK_MS } from '@app/admin/idle-lock/useIdleLock'

vi.mock('@nihongo/browser/app/login/hooks/useAdminFreshReturn', () => ({
  useAdminFreshReturn: vi.fn()
}))
const phase = vi.mocked(useAdminFreshReturn)

const renderLock = () =>
  render(
    <I18nProvider>
      <label>
        메모
        <input defaultValue="" />
      </label>
      <IdleLockDialog />
    </I18nProvider>
  )

beforeEach(() => {
  vi.useFakeTimers()
  phase.mockReset()
})
afterEach(() => vi.useRealTimers())

it('locks after 15 idle minutes, keeps input, and unlocks without re-running anything', () => {
  phase.mockReturnValue('checked')
  renderLock()
  const input = screen.getByLabelText('메모')
  fireEvent.change(input, { target: { value: '작성 중' } })
  act(() => vi.advanceTimersByTime(IDLE_LOCK_MS - 1000))
  fireEvent.keyDown(window, { key: 'a' })
  act(() => vi.advanceTimersByTime(IDLE_LOCK_MS - 1000))
  expect(
    screen.queryByRole('heading', { name: '화면을 잠갔습니다' })
  ).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(1000))
  expect(
    screen.getByRole('heading', { name: '화면을 잠갔습니다' })
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))
  expect(
    screen.queryByRole('heading', { name: '화면을 잠갔습니다' })
  ).not.toBeInTheDocument()
  expect(input).toHaveValue('작성 중')
})

it('stays locked with a visible message when the re-check fails', () => {
  phase.mockReturnValue('unknown')
  renderLock()
  act(() => vi.advanceTimersByTime(IDLE_LOCK_MS))
  fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))
  expect(screen.getByRole('alert')).toHaveTextContent(
    '본인 확인이 끝나지 않았습니다'
  )
  expect(
    screen.getByRole('heading', { name: '화면을 잠갔습니다' })
  ).toBeInTheDocument()
})
