import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { StudyQuestionView } from '@app/practice/adapters/studySessionView'
import { PracticeQuestionCard } from '@app/practice/session/components/PracticeQuestionCard'
import { resetFuriganaForTest } from '@app/practice/session/useFurigana'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import { clearStorageCache } from '@nihongo/browser/libs/storage'

const question = (
  passageFurigana: StudyQuestionView['passageFurigana']
): StudyQuestionView => ({
  id: 'q1',
  sessionQuestionId: null,
  questionVersionId: null,
  ordinal: 1,
  level: 'N5',
  subject: 'READING',
  questionType: 'SHORT_READING',
  passage: '今日は雨です。',
  passageFurigana,
  questionText: '天気は何ですか。',
  options: ['a', 'b', 'c', 'd'].map((id, index) => ({
    id,
    label: (['1', '2', '3', '4'] as const)[index]!,
    text: id
  })),
  difficulty: 'EASY',
  tags: []
})

const card = (furigana: StudyQuestionView['passageFurigana']) => (
  <I18nProvider>
    <PracticeQuestionCard
      actions={null}
      bookmarkStatus={null}
      headingRef={createRef()}
      isOptionsDisabled={false}
      onSelectOption={() => undefined}
      question={question(furigana)}
      questionNumber={1}
      saveStatus={null}
      selectedOptionId={undefined}
    />
  </I18nProvider>
)

const READINGS = [
  { start: 0, length: 2, reading: 'きょう' },
  { start: 3, length: 1, reading: 'あめ' }
]

describe('passage furigana switch (#1182)', () => {
  beforeEach(() => {
    writeUiLocalePreference('ko')
    localStorage.removeItem('harumaru:furigana:v1')
    clearStorageCache()
    resetFuriganaForTest()
  })

  it('is off at first and turns the readings on and off', async () => {
    const { container } = render(card(READINGS))
    const toggle = await screen.findByRole('button', { name: '후리가나 보기' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(container.querySelector('rt')).toBeNull()
    // The name is read in the UI language; only the word is Japanese.
    expect(toggle).not.toHaveAttribute('lang')
    expect(screen.getByText('ふりがな')).toHaveAttribute('lang', 'ja')

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(
      [...container.querySelectorAll('rt')].map((rt) => rt.textContent)
    ).toEqual(['きょう', 'あめ'])
    expect(localStorage.getItem('harumaru:furigana:v1')).toBe('1')

    await userEvent.click(toggle)
    expect(container.querySelector('rt')).toBeNull()
    expect(localStorage.getItem('harumaru:furigana:v1')).toBe('0')
  })

  it('remembers the choice for the next passage', async () => {
    localStorage.setItem('harumaru:furigana:v1', '1')
    const { container } = render(card(READINGS))
    expect(
      await screen.findByRole('button', { name: '후리가나 보기' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelectorAll('rt')).toHaveLength(2)
  })

  it.each([[null], [[]], [undefined]])(
    'is disabled with no readings (%j), quiet while off',
    async (furigana) => {
      render(card(furigana))
      const toggle = await screen.findByRole('button', {
        name: '후리가나 보기'
      })
      expect(toggle).toBeDisabled()
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      expect(
        screen.queryByText('이 지문은 아직 후리가나가 없어요.')
      ).not.toBeInTheDocument()
    }
  )

  it('tells someone who turned it on that this passage has none', async () => {
    localStorage.setItem('harumaru:furigana:v1', '1')
    render(card(null))
    expect(
      await screen.findByText('이 지문은 아직 후리가나가 없어요.')
    ).toBeInTheDocument()
  })
})
