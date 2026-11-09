import { render, screen } from '@testing-library/react'
import { appI18n } from '@nihongo/browser/i18n/config'
import { WrongNoteDetailContent } from '@app/wrong-note/detail/WrongNoteDetailContent'
import type { WrongNoteDetailView } from '@app/wrong-note/adapters/wrongNoteView'

const view = (
  currentReviewQuestionVersionId: string | null
): WrongNoteDetailView => ({
  wrongNote: {
    questionId: 'q1',
    wrongCount: 1,
    correctStreak: 0,
    status: 'NEW',
    lastWrongAt: '2026-11-09T00:00:00.000Z',
    lastReviewedAt: null,
    nextReviewAt: '2026-11-10T00:00:00.000Z',
    reviewAvailability: 'AVAILABLE'
  },
  question: {
    id: 'q1',
    questionVersionId: 'v1',
    level: 'N5',
    subject: 'VOCABULARY',
    questionType: 'KANJI_READING',
    passage: null,
    questionText: '「がっこう」',
    options: [
      { id: 'o1', label: '1', text: '学生', isCorrect: false },
      { id: 'o2', label: '2', text: '学校', isCorrect: true }
    ],
    explanationKo: '해설',
    explanationJa: null,
    difficulty: 'EASY',
    tags: []
  },
  memo: null,
  lastWrongQuestionVersionId: 'v1',
  currentReviewQuestionVersionId,
  canRetry: false,
  canUpdateMemo: false
})

const changed = '문제가 고쳐졌어요. 다시 풀면 고친 문제가 나와요.'

beforeEach(async () => {
  await appI18n.changeLanguage('ko')
})

it.each([
  [null, false],
  ['v1', false],
  ['v2', true]
])(
  'shows the question-changed line only for a different pinned version (%s)',
  (current, shown) => {
    render(
      <WrongNoteDetailContent
        data={view(current)}
        previousAnswer={{ status: 'selected', optionId: 'o1' }}
      />
    )
    if (shown) expect(screen.getByText(changed)).toBeVisible()
    else expect(screen.queryByText(changed)).toBeNull()
  }
)

it('shows the missing-Japanese notice only on the Japanese screen', async () => {
  const notice = (): string =>
    appI18n.t('common:explanation.japaneseUnavailable')
  const { rerender } = render(
    <WrongNoteDetailContent
      data={view(null)}
      previousAnswer={{ status: 'selected', optionId: 'o1' }}
    />
  )
  expect(screen.queryByText(notice())).toBeNull()
  await appI18n.changeLanguage('ja')
  rerender(
    <WrongNoteDetailContent
      data={view(null)}
      previousAnswer={{ status: 'selected', optionId: 'o1' }}
    />
  )
  expect(await screen.findByText(notice())).toBeVisible()
})
