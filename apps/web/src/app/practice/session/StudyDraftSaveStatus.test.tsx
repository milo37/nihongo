import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { StudyDraftSaveStatus } from '@app/practice/session/StudyDraftSaveStatus'
import type { PracticeDraftStatusCode } from '@app/practice/draft/practiceDraftModel'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'

// #1262: no line under the options; every save state that needs saying is
// a toast.
const setup = () => {
  writeUiLocalePreference('ko')
  const retry = vi.fn()
  const view = (status: PracticeDraftStatusCode | null) => (
    <I18nProvider>
      <ToastProvider>
        <StudyDraftSaveStatus status={status} onRetry={retry} />
      </ToastProvider>
    </I18nProvider>
  )
  const { rerender } = render(view('synced'))
  return {
    retry,
    show: (status: PracticeDraftStatusCode) => rerender(view(status))
  }
}
const toasts = () => screen.queryByRole('region', { name: '알림' })

it('keeps routine saving quiet', () => {
  const { show } = setup()
  for (const status of ['synced', 'savedAt', 'dirty', 'saving'] as const) {
    show(status)
    expect(toasts()).toBeNull()
  }
})

it('a failure stays as a toast with [다시 시도], and the next save says so', async () => {
  const user = userEvent.setup()
  const { retry, show } = setup()
  show('error')
  const region = await screen.findByRole('region', { name: '알림' })
  expect(
    within(region).getByText(
      '저장하지 못했어요. 고른 답은 그대로 있어요. 다시 시도해 주세요.'
    )
  ).toBeVisible()
  await user.click(within(region).getByRole('button', { name: '다시 시도' }))
  expect(retry).toHaveBeenCalledTimes(1)
  show('saving')
  show('synced')
  const after = await screen.findByRole('region', { name: '알림' })
  expect(within(after).getByText('저장했어요.')).toBeVisible()
  expect(within(after).getAllByRole('article')).toHaveLength(1)
  expect(within(after).queryByRole('button', { name: '다시 시도' })).toBeNull()
})

it('a failure closed with X comes back when the next save fails', async () => {
  const user = userEvent.setup()
  const { show } = setup()
  show('error')
  const region = await screen.findByRole('region', { name: '알림' })
  await user.click(within(region).getByRole('button', { name: '알림 닫기' }))
  await vi.waitFor(() => expect(toasts()).toBeNull())
  show('saving')
  show('error')
  const again = await screen.findByRole('region', { name: '알림' })
  expect(within(again).getByRole('button', { name: '다시 시도' })).toBeVisible()
})

it('offline is the connection toast; a merged copy is said once', async () => {
  const { show } = setup()
  show('offline')
  const region = await screen.findByRole('region', { name: '알림' })
  expect(
    within(region).getByText(
      '인터넷 연결이 끊겼어요. 답은 이 기기에 보관했다가 연결되면 저장할게요.'
    )
  ).toBeVisible()
  show('reconciled')
  expect(
    await within(region).findByText(
      '다른 곳에서 푼 답을 불러왔어요. 답을 확인해 주세요.'
    )
  ).toBeVisible()
})
