import { render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { BookmarkListItem } from '@app/bookmark/components/BookmarkListItem'
import { appI18n } from '@nihongo/browser/i18n/config'

type Bookmark = ComponentProps<typeof BookmarkListItem>['bookmark']

const bookmark = {
  questionId: 'question-1',
  createdAt: '2026-11-14T00:00:00.000Z',
  question: {
    level: 'N5',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionTextPreview: '本は つくえの 上（ ）あります。',
    // #976: the first tag has no Japanese name, the second has one.
    tags: [
      { label: '경어', labelJa: null },
      { label: '조사', labelJa: '助詞' }
    ]
  }
} as unknown as Bookmark

const renderItem = (locale: 'ko' | 'ja') =>
  render(
    <ul>
      <BookmarkListItem
        bookmark={bookmark}
        isDeleting={false}
        isRemoveDisabled={false}
        locale={locale}
        onRemove={() => undefined}
        removeButtonRef={() => undefined}
      />
    </ul>
  )

afterEach(async () => {
  await appI18n.changeLanguage('ko')
})

it('shows only Japanese tag names on a Japanese screen (#976)', async () => {
  await appI18n.changeLanguage('ja')
  renderItem('ja')
  expect(screen.getByText(/助詞/u)).toBeVisible()
  expect(screen.queryByText(/경어|조사/u)).toBeNull()
})

it('shows the Korean tag name on a Korean screen (#976)', () => {
  renderItem('ko')
  expect(screen.getByText(/경어/u)).toBeVisible()
  expect(screen.queryByText(/助詞/u)).toBeNull()
})
