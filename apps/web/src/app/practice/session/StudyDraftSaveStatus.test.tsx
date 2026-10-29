import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { StudyDraftSaveStatus } from '@app/practice/session/StudyDraftSaveStatus'
import type { PracticeDraftStatusCode } from '@app/practice/hooks/usePracticeDraftController'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'

it.each(['ko', 'ja'] as const)(
  'keeps states quiet, removes stale success and reserves every localized state (%s)',
  (locale) => {
    writeUiLocalePreference(locale)
    const retry = vi.fn()
    const view = (status: PracticeDraftStatusCode | null) => (
      <I18nProvider>
        <StudyDraftSaveStatus status={status} onRetry={retry} />
      </I18nProvider>
    )
    const { rerender, container } = render(view('synced'))
    const row = container.querySelector('.study-inline-save')
    const measures = container.querySelector('.study-inline-save-measures')
    expect(measures).toHaveAttribute('aria-hidden', 'true')
    expect(measures?.children).toHaveLength(6)
    const copy =
      locale === 'ko'
        ? [
            '학습 기록이 자동으로 저장됐어요',
            '학습 기록을 저장할 준비 중이에요',
            '학습 기록을 저장하고 있어요…',
            '학습 기록을 저장하지 못했어요',
            '오프라인 · 이 기기에 임시 보관 중'
          ]
        : [
            '学習記録を自動保存しました',
            '学習記録の保存待ちです',
            '学習記録を保存しています…',
            '学習記録を保存できませんでした',
            'オフライン・この端末に一時保存中'
          ]
    const statuses = ['synced', 'dirty', 'saving', 'error', 'offline'] as const
    for (const [index, status] of statuses.entries()) {
      rerender(view(status))
      expect(screen.getByText(copy[index] ?? '')).toBeInTheDocument()
      expect(container.querySelector('.study-inline-save')).toBe(row)
      expect(container.querySelector('.study-inline-save-measures')).toBe(
        measures
      )
      if (status !== 'synced')
        expect(screen.queryByText(copy[0] ?? '')).not.toBeInTheDocument()
      if (status === 'error' || status === 'offline') {
        expect(screen.getByRole('status')).toHaveAttribute(
          'aria-live',
          'polite'
        )
        expect(screen.getAllByRole('button')).toHaveLength(1)
      } else {
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
        expect(
          container.querySelector('.study-inline-save-current')
        ).toHaveAttribute('aria-live', 'off')
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
      }
    }
    rerender(view(null))
    expect(container.querySelector('.study-inline-save')).toBe(row)
    expect(
      container.querySelector('.study-inline-save-current')
    ).toBeEmptyDOMElement()
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
  const action = screen.getByRole('button', { name: '작업본 저장 다시 시도' })
  expect(action).toHaveFocus()
  expect(action).toHaveTextContent('다시 시도')
  await user.keyboard('{Enter}')
  expect(retry).toHaveBeenCalledOnce()
  expect(action).toHaveFocus()
})

it.each([
  ['ko', '최신 저장 기록을 불러왔어요. 답을 확인해 주세요.'],
  ['ja', '最新の保存記録を読み込みました。回答を確認してください。']
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
