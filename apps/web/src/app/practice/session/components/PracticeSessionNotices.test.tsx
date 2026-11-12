import { render, screen } from '@testing-library/react'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import type { PracticeDraftController } from '@app/practice/hooks/usePracticeDraftController'
import { PracticeSessionNotices } from '@app/practice/session/components/PracticeSessionNotices'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'

type Mode = StudySessionView['session']['mode']

const sessionData = (mode: Mode): StudySessionView => ({
  session: {
    id: '019d0000-0000-7000-8000-000000000858',
    level: 'N5',
    subject: 'VOCABULARY',
    mode,
    status: 'IN_PROGRESS',
    startedAt: '2026-11-13T09:00:00.000Z',
    expiresAt: null,
    submittedAt: null,
    durationSec: null,
    practiceContractVersion: 2
  },
  questions: [],
  requestedCount: 20,
  actualCount: 1,
  usedFallback: false,
  fallbackReason: null
})

const notices = (mode: Mode) => (
  <I18nProvider>
    <PracticeSessionNotices
      draftActionMessage={null}
      // Only read when isV2Session shows the draft status.
      draftController={{} as PracticeDraftController}
      hasUnresolvedConflictCheck={false}
      isCompactDraftStatus={false}
      isFirstQuestion
      isInlineDraftStatus={false}
      isSessionError={false}
      isSessionPaused={false}
      isV2Session={false}
      onRetryDraftSave={() => undefined}
      onRetrySession={() => undefined}
      sessionData={sessionData(mode)}
    />
  </I18nProvider>
)

const notice =
  '20문제를 골랐지만 지금 풀 수 있는 문제가 1문제라 1문제만 나왔어요.'

describe('문제 수 부족 안내 (JLP-858)', () => {
  beforeEach(() => {
    writeUiLocalePreference('ko')
  })

  it.each(['RANDOM', 'WEAKNESS'] as const)(
    '%s 세트는 고른 수보다 적게 나오면 안내한다',
    async (mode) => {
      render(notices(mode))
      expect(await screen.findByText(notice)).toBeInTheDocument()
    }
  )

  it.each(['BOOKMARK', 'DAILY_REVIEW', 'WRONG_NOTE'] as const)(
    '%s 세트는 문제 수를 고르지 않으니 안내하지 않는다',
    async (mode) => {
      // The same short set as a random one shows the notice first, so the
      // copy has loaded before the list-backed set is checked.
      const { rerender } = render(notices('RANDOM'))
      expect(await screen.findByText(notice)).toBeInTheDocument()
      rerender(notices(mode))
      expect(screen.queryByText(notice)).not.toBeInTheDocument()
    }
  )
})
