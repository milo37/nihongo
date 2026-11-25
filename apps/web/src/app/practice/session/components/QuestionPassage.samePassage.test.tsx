import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { StudyQuestionView } from '@app/practice/adapters/studySessionView'
import { PracticeQuestionCard } from '@app/practice/session/components/PracticeQuestionCard'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import { clearStorageCache } from '@nihongo/browser/libs/storage'

const question = (
  id: string,
  isSamePassageAsPrevious: boolean,
  passageAudio: StudyQuestionView['passageAudio'] = null
): StudyQuestionView => ({
  id,
  sessionQuestionId: null,
  questionVersionId: null,
  ordinal: 1,
  level: 'N5',
  subject: 'READING',
  questionType: 'SHORT_READING',
  passage: '今日は雨です。\n明日は晴れです。',
  passageId: 'p1',
  isSamePassageAsPrevious,
  passageAudio,
  questionText: '天気は何ですか。',
  options: ['a', 'b', 'c', 'd'].map((option, index) => ({
    id: option,
    label: (['1', '2', '3', '4'] as const)[index]!,
    text: option
  })),
  difficulty: 'EASY',
  tags: []
})

const card = (view: StudyQuestionView) => (
  <I18nProvider>
    <ToastProvider>
      <PracticeQuestionCard
        actions={null}
        headingRef={createRef()}
        isOptionsDisabled={false}
        onSelectOption={() => undefined}
        question={view}
        questionNumber={2}
        saveStatus={null}
        selectedOptionId={undefined}
      />
    </ToastProvider>
  </I18nProvider>
)

describe('same passage on the solve screen (#986)', () => {
  beforeEach(() => {
    writeUiLocalePreference('ko')
    clearStorageCache()
  })

  it('shows nothing on the first question of a passage', () => {
    const { container } = render(card(question('q1', false)))
    expect(screen.queryByText('앞 문제와 같은 지문')).toBeNull()
    expect(screen.queryByRole('button', { name: '지문 펼치기' })).toBeNull()
    expect(container.querySelector('[data-folded]')).toBeNull()
  })

  it('folds a repeated passage until opened, and folds again on the next one', async () => {
    const { container, rerender } = render(card(question('q2', true)))
    expect(screen.getByText('앞 문제와 같은 지문')).toBeInTheDocument()
    const open = screen.getByRole('button', { name: '지문 펼치기' })
    const text = container.querySelector('.study-passage-text')!
    expect(open).toHaveAttribute('aria-expanded', 'false')
    expect(open).toHaveAttribute('aria-controls', text.id)
    expect(text).toHaveAttribute('data-folded')

    open.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.queryByRole('button', { name: '지문 펼치기' })).toBeNull()
    // Focus stays on the passage instead of falling to the page.
    expect(document.activeElement).toBe(text.closest('article'))
    expect(text).not.toHaveAttribute('data-folded')
    expect(screen.getByText('앞 문제와 같은 지문')).toBeInTheDocument()

    rerender(card(question('q3', true)))
    expect(
      screen.getByRole('button', { name: '지문 펼치기' })
    ).toBeInTheDocument()
  })

  it('opens with the read-aloud bar and stays open after it closes', async () => {
    // jsdom has no media playback.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockReturnValue()
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockReturnValue()
    const audio = { key: 'a'.repeat(64), durationMs: 5_000 }
    const { container } = render(card(question('q2', true, audio)))
    const text = container.querySelector('.study-passage-text')!
    expect(text).toHaveAttribute('data-folded')

    await userEvent.click(screen.getByRole('button', { name: '듣기' }))
    expect(text).not.toHaveAttribute('data-folded')
    expect(screen.queryByRole('button', { name: '지문 펼치기' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(text).not.toHaveAttribute('data-folded')
    vi.restoreAllMocks()
  })
})
