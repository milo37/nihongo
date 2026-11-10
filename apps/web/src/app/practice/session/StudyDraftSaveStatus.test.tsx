import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { StudyDraftSaveStatus } from '@app/practice/session/StudyDraftSaveStatus'
import type { PracticeDraftStatusCode } from '@app/practice/draft/practiceDraftModel'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'

it.each(['ko', 'ja'] as const)(
  'hides routine saving and shows only a failure line (%s)',
  (locale) => {
    writeUiLocalePreference(locale)
    const retry = vi.fn()
    const view = (status: PracticeDraftStatusCode | null) => (
      <I18nProvider>
        <StudyDraftSaveStatus status={status} onRetry={retry} />
      </I18nProvider>
    )
    const { rerender, container } = render(view('synced'))
    for (const status of ['synced', 'savedAt', 'dirty', 'saving'] as const) {
      rerender(view(status))
      const quiet = container.querySelector('[data-save-state]')
      expect(quiet).toHaveAttribute('data-save-state', status)
      expect(quiet).not.toBeVisible()
      expect(quiet).toBeEmptyDOMElement()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    }
    const failure =
      locale === 'ko'
        ? ['저장하지 못했어요', '연결 끊김 · 이 기기에만 저장 중']
        : ['保存できませんでした', '接続なし · この端末にだけ保存中']
    for (const [index, status] of (['error', 'offline'] as const).entries()) {
      rerender(view(status))
      expect(screen.getByText(failure[index] ?? '')).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
      expect(screen.getAllByRole('button')).toHaveLength(1)
    }
    rerender(view(null))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  }
)

it('reuses keyboard retry without another success announcement or focus movement', async () => {
  const user = userEvent.setup()
  const retry = vi.fn()
  render(
    <I18nProvider>
      <button>Before</button>
      <StudyDraftSaveStatus status="error" onRetry={retry} />
    </I18nProvider>
  )
  await user.tab()
  expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus()
  await user.tab()
  const action = screen.getByRole('button', { name: '다시 저장' })
  expect(action).toHaveFocus()
  expect(action).toHaveTextContent('다시 시도')
  await user.keyboard('{Enter}')
  expect(retry).toHaveBeenCalledOnce()
  expect(action).toHaveFocus()
})

it.each([
  ['ko', '다른 곳에서 푼 답을 불러왔어요. 답을 확인해 주세요.'],
  ['ja', '別の場所で解いた答えを読み込みました。答えを確認してください。']
] as const)(
  'announces the server-applied record without claiming the last answer was saved (%s)',
  (locale, message) => {
    writeUiLocalePreference(locale)
    render(
      <I18nProvider>
        <StudyDraftSaveStatus status="reconciled" onRetry={vi.fn()} />
      </I18nProvider>
    )
    expect(screen.getByRole('status')).toHaveTextContent(message)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  }
)
