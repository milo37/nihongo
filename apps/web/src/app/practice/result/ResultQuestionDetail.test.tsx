import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { StudyResultItemView } from '@app/practice/adapters/studyResultView'
import { ResultQuestionDetail } from '@app/practice/result/ResultQuestionDetail'
import { appI18n } from '@nihongo/browser/i18n/config'

const option = (id: string, label: number) => ({
  id,
  label,
  text: `選択肢${id}`
})
const item = {
  isCorrect: true,
  selectedOptionId: 'a',
  correctOptionId: 'a',
  explanationKo: '해설',
  explanationJa: null,
  tags: ['조사', '경어'],
  question: {
    id: 'question-1',
    questionVersionId: 'version-1',
    passage: null,
    questionText: '本は つくえの 上（ ）あります。',
    options: [option('a', 1), option('b', 2)],
    // #976: one tag has a Japanese name, one does not.
    tagSummaries: [
      { label: '조사', labelJa: '助詞' },
      { label: '경어', labelJa: null }
    ]
  }
} as unknown as StudyResultItemView

const renderDetail = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ResultQuestionDetail
          item={item}
          ordinal={1}
          canReport={false}
          isBookmarked={false}
          bookmarkDisabled={false}
          isResultSourceUnavailable={false}
          bookmarkMessage={null}
          onToggleBookmark={() => undefined}
        />
      </MemoryRouter>
    </QueryClientProvider>
  )

afterEach(async () => {
  await act(() => appI18n.changeLanguage('ko'))
})

it('shows Japanese tag names on a Japanese screen, Korean where none (#976)', async () => {
  await appI18n.changeLanguage('ja')
  renderDetail()
  expect(screen.getByText('助詞 · 경어')).toBeVisible()
})

it('keeps the Korean tag names on a Korean screen (#976)', async () => {
  await appI18n.changeLanguage('ko')
  renderDetail()
  expect(screen.getByText('조사 · 경어')).toBeVisible()
})
