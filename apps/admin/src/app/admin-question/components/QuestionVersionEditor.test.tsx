import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import { appI18n } from '@nihongo/browser/i18n/config'
import { QuestionVersionEditor } from '@app/admin-question/components/QuestionVersionEditor'
import { previewFor } from '@app/admin-question/test/workflowFixture'
const t = appI18n.getFixedT('ko', 'admin')
afterEach(() => {
  cleanup()
  writeUiLocalePreference('ko')
  vi.restoreAllMocks()
})
const view = (
  overrides: Partial<Parameters<typeof QuestionVersionEditor>[0]> = {}
) => {
  const props = {
    preview: previewFor(),
    rowVersion: 1,
    disabled: false,
    isSubmitting: false,
    conflictRevision: 0,
    serverFieldErrors: {},
    onDirtyChange: vi.fn(),
    onSubmit: vi.fn().mockResolvedValue(true),
    ...overrides
  }
  const result = render(
    <I18nProvider>
      <QuestionVersionEditor {...props} />
    </I18nProvider>
  )
  return { ...result, props }
}
it('saves canonical IDs and moves options with keyboard without changing correct-option identity', async () => {
  const { props } = view()
  const first = screen.getByRole('textbox', {
    name: t('editor.optionLabel', { number: 1 })
  })
  fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true })
  expect(
    screen.getByRole('textbox', {
      name: t('editor.optionLabel', { number: 2 })
    })
  ).toHaveValue(previewFor().question.options[0]!.text)
  expect(
    screen.getByRole('radio', {
      name: t('editor.correctOption', { number: 2 })
    })
  ).toBeChecked()
  await userEvent.click(
    screen.getByRole('button', { name: t('questionDetail.saveDraft') })
  )
  await waitFor(() => expect(props.onSubmit).toHaveBeenCalledTimes(1))
  expect(vi.mocked(props.onSubmit).mock.calls[0]![0]).toMatchObject({
    expectedRowVersion: 1,
    correctOptionId: previewFor().adminAnswer.correctOptionId,
    options: [
      { id: previewFor().question.options[1]!.id, ordinal: 1 },
      { id: previewFor().question.options[0]!.id, ordinal: 2 },
      { ordinal: 3 },
      { ordinal: 4 }
    ]
  })
})
it('preserves local dirty content on passive server changes and requires explicit snapshot+rebase before a new CAS', async () => {
  const { props, rerender } = view()
  fireEvent.change(
    screen.getByRole('textbox', { name: t('editor.questionText') }),
    { target: { value: 'Local original question' } }
  )
  const server = {
    ...previewFor(),
    question: {
      ...previewFor().question,
      questionText: 'Server changed question'
    }
  }
  const renderNext = (revision: number) =>
    rerender(
      <I18nProvider>
        <QuestionVersionEditor
          {...props}
          preview={server}
          rowVersion={2}
          conflictRevision={revision}
        />
      </I18nProvider>
    )
  renderNext(0)
  expect(
    screen.getByRole('textbox', { name: t('editor.questionText') })
  ).toHaveValue('Local original question')
  expect(
    screen.getByRole('button', { name: t('questionDetail.saveDraft') })
  ).toBeDisabled()
  expect(
    screen.getByRole('button', { name: t('editor.rebaseAction') })
  ).toBeDisabled()
  renderNext(1)
  await userEvent.click(
    screen.getByRole('button', { name: t('editor.rebaseAction') })
  )
  await userEvent.click(
    screen.getByRole('button', { name: t('questionDetail.saveDraft') })
  )
  await waitFor(() =>
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRowVersion: 2,
        questionText: 'Local original question'
      })
    )
  )
})
it('blocks invalid original content and exposes localized validation without raw server text', async () => {
  const { props } = view({
    serverFieldErrors: { questionText: ['private raw message'] }
  })
  fireEvent.change(
    screen.getByRole('textbox', { name: t('editor.questionText') }),
    { target: { value: '' } }
  )
  await userEvent.click(
    screen.getByRole('button', { name: t('questionDetail.saveDraft') })
  )
  expect(props.onSubmit).not.toHaveBeenCalled()
  expect(screen.queryByText('private raw message')).not.toBeInTheDocument()
  expect(
    screen.getByRole('textbox', { name: t('editor.questionText') })
  ).toHaveAttribute('aria-invalid', 'true')
})
it('keeps all fields disabled but local content visible during pending/offline/conflict', () => {
  view({ disabled: true })
  const input = screen.getByRole('textbox', { name: t('editor.questionText') })
  expect(input).toBeDisabled()
  expect(input).toHaveValue('Current question')
  expect(
    within(input.closest('form')!).getByRole('button', {
      name: t('questionDetail.saveDraft')
    })
  ).toBeDisabled()
})
it('uses the current Japanese catalog and accessible field labels', () => {
  writeUiLocalePreference('ja')
  view()
  expect(screen.getByRole('textbox', { name: '問題文' })).toBeVisible()
  expect(
    screen.getByRole('button', { name: '下書きの変更を保存' })
  ).toBeDisabled()
  expect(screen.queryByText('editor.questionText')).not.toBeInTheDocument()
})

it('allows multiple comma-separated tags without consuming the separator while typing', async () => {
  const { props } = view()
  const input = screen.getByRole('textbox', { name: t('editor.selectedTags') })
  await userEvent.clear(input)
  await userEvent.type(input, 'original, grammar')
  expect(input).toHaveValue('original, grammar')
  await userEvent.click(
    screen.getByRole('button', { name: t('questionDetail.saveDraft') })
  )
  await waitFor(() =>
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ tagNames: ['original', 'grammar'] })
    )
  )
})

it.each([
  ['questionText', 'editor.questionText', undefined],
  ['tagNames.0', 'editor.selectedTags', undefined],
  ['options.2.text', 'editor.optionLabel', 3]
] as const)(
  'regression: focuses the first server field error %s once while keeping dirty input',
  async (path, label, number) => {
    const { props, rerender } = view({
      onSubmit: vi.fn().mockResolvedValue(false)
    })
    const local = screen.getByRole('textbox', {
      name: t('editor.questionText')
    })
    fireEvent.change(local, {
      target: { value: 'Kept original local question' }
    })
    await userEvent.click(
      screen.getByRole('button', { name: t('questionDetail.saveDraft') })
    )
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledTimes(1))
    const next = () =>
      rerender(
        <I18nProvider>
          <QuestionVersionEditor
            {...props}
            serverFieldErrors={{ [path]: ['private wording'] }}
          />
        </I18nProvider>
      )
    next()
    const target = screen.getByRole('textbox', {
      name: number ? t(label, { number }) : t(label)
    })
    await waitFor(() => expect(target).toHaveFocus())
    expect(target).toHaveAttribute('aria-invalid', 'true')
    expect(local).toHaveValue('Kept original local question')
    expect(screen.queryByText('private wording')).not.toBeInTheDocument()
    const other = screen.getByRole('textbox', {
      name: t('editor.explanationKo')
    })
    other.focus()
    next()
    expect(other).toHaveFocus()
  }
)
it('regression: focuses locally invalid tags and preserves other dirty fields', async () => {
  const { props } = view()
  const local = screen.getByRole('textbox', { name: t('editor.questionText') })
  fireEvent.change(local, { target: { value: 'Kept original local question' } })
  const tags = screen.getByRole('textbox', { name: t('editor.selectedTags') })
  await userEvent.clear(tags)
  await userEvent.click(
    screen.getByRole('button', { name: t('questionDetail.saveDraft') })
  )
  await waitFor(() => expect(tags).toHaveFocus())
  expect(tags).toHaveAttribute('aria-invalid', 'true')
  expect(local).toHaveValue('Kept original local question')
  expect(props.onSubmit).not.toHaveBeenCalled()
})
