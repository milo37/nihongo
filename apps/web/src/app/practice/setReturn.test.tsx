import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ReactElement } from 'react'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { ResultActions } from '@app/practice/result/ResultActions'
import { PracticeSessionHeader } from '@app/practice/session/components/PracticeSessionHeader'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'

type Mode = StudySessionView['session']['mode']

const session = (mode: Mode): StudySessionView['session'] => ({
  id: '019d0000-0000-7000-8000-000000000856',
  level: 'N5',
  subject: 'VOCABULARY',
  mode,
  status: 'SUBMITTED',
  startedAt: '2026-11-12T09:00:00.000Z',
  expiresAt: null,
  submittedAt: '2026-11-12T09:05:00.000Z',
  durationSec: 300,
  practiceContractVersion: 2
})

const renderWith = (element: ReactElement, client = new QueryClient()) =>
  render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter>{element}</MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>
  )

const actions = (mode: Mode, isGuest = false, hasIncorrect = true) => (
  <ResultActions
    hasIncorrect={hasIncorrect}
    isGuest={isGuest}
    isGuestDone={false}
    isRetryDisabled={false}
    isRetryLoading={false}
    onRetry={() => undefined}
    retryLoadingLabel="…"
    session={session(mode)}
    requestedCount={10}
    showRetry={hasIncorrect}
  />
)

// The wrong-note list as the server just counted it (#1283).
const withToReview = (toReview: number) => {
  const client = new QueryClient()
  const { queryKey } = wrongNoteQueries.reviewList({
    state: 'TO_REVIEW',
    pageSize: 1
  })
  client.setQueryData(queryKey, {
    counts: { toReview, reviewed: 0 }
  } as never)
  return client
}

const header = (mode: Mode) => (
  <PracticeSessionHeader
    answeredCount={0}
    bookmarkButton={null}
    currentNumber={1}
    hasPassage={false}
    isBackDisabled={false}
    isQuestionSheetDisabled={false}
    onOpenQuestionSheet={() => undefined}
    progressStates={['current']}
    reviewContext={null}
    session={session(mode)}
    total={1}
  />
)

describe('세트가 온 목록으로 돌아가기 (JLP-856)', () => {
  beforeEach(() => {
    writeUiLocalePreference('ko')
  })

  it.each([
    ['DAILY_REVIEW', '오답노트로', '/wrong-notes'],
    ['WRONG_NOTE', '오답노트로', '/wrong-notes'],
    ['BOOKMARK', '책갈피로', '/bookmarks']
  ] as const)(
    '%s 세트 결과의 주 버튼은 목록으로 가고 다시 풀기는 보조로 남는다',
    async (mode, name, href) => {
      renderWith(actions(mode))
      const back = await screen.findByRole('link', { name })
      expect(back).toHaveAttribute('href', href)
      expect(back.className).toContain('bg-brand')
      expect(back.className).toContain('h-12')
      expect(
        screen.queryByRole('button', { name: /^다음 \d+문제/u })
      ).toBeNull()
      expect(
        screen.getByRole('button', { name: '틀린 문제만 다시 풀기' })
      ).toBeInTheDocument()
    }
  )

  it('무작위 세트 결과는 다음 10문제 그대로다', async () => {
    renderWith(actions('RANDOM'))
    expect(
      await screen.findByRole('button', { name: '다음 10문제' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it.each(['DAILY_REVIEW', 'WRONG_NOTE'] as const)(
    '%s 세트를 다 맞혀 복습할 문제가 없으면 [학습하기]로 학습 탭에 간다 (#1283)',
    async (mode) => {
      renderWith(actions(mode, false, false), withToReview(0))
      expect(
        await screen.findByRole('link', { name: '학습하기' })
      ).toHaveAttribute('href', '/practice')
      expect(screen.queryByRole('link', { name: '오답노트로' })).toBeNull()
    }
  )

  it.each(['DAILY_REVIEW', 'WRONG_NOTE'] as const)(
    '%s 세트를 다 맞혀도 복습할 문제가 남으면 오답노트로 (#1283)',
    async (mode) => {
      renderWith(actions(mode, false, false), withToReview(2))
      expect(
        await screen.findByRole('link', { name: '오답노트로' })
      ).toHaveAttribute('href', '/wrong-notes')
    }
  )

  it('책갈피 세트는 다 맞혀도 책갈피로 (#1283)', async () => {
    renderWith(actions('BOOKMARK', false, false), withToReview(0))
    expect(
      await screen.findByRole('link', { name: '책갈피로' })
    ).toHaveAttribute('href', '/bookmarks')
  })

  it.each([
    ['DAILY_REVIEW', '오답노트로', '/wrong-notes'],
    ['WRONG_NOTE', '오답노트로', '/wrong-notes'],
    ['BOOKMARK', '책갈피로', '/bookmarks'],
    ['RANDOM', '학습 화면으로', '/practice'],
    ['WEAKNESS', '학습 화면으로', '/practice']
  ] as const)('%s 풀이 중 ✕는 %s(%s)', async (mode, name, href) => {
    renderWith(header(mode))
    expect(await screen.findByRole('link', { name })).toHaveAttribute(
      'href',
      href
    )
  })
})
