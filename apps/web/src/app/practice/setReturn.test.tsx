import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ReactElement } from 'react'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { ResultActions } from '@app/practice/result/ResultActions'
import { PracticeSessionHeader } from '@app/practice/session/components/PracticeSessionHeader'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'

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

const renderWith = (element: ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider>
        <MemoryRouter>{element}</MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>
  )

const actions = (mode: Mode, isGuest = false) => (
  <ResultActions
    isGuest={isGuest}
    isGuestDone={false}
    isRetryDisabled={false}
    isRetryLoading={false}
    onRetry={() => undefined}
    retryLoadingLabel="…"
    session={session(mode)}
    requestedCount={10}
    showRetry
  />
)

const header = (mode: Mode) => (
  <PracticeSessionHeader
    answeredCount={0}
    bookmarkButton={null}
    currentNumber={1}
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
