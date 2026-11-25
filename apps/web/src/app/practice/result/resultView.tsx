import type { TFunction } from 'i18next'
import type { ReactElement } from 'react'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { ResultSetupLinkError } from '@app/practice/result/ResultStateScreens'
import { ReviewCompletion } from '@app/practice/result/ReviewCompletion'
import type { ResultController } from '@app/practice/result/SelectedResultItem'
import { readReviewReturnContext } from '@app/wrong-note/reviewReturnContext'
import { AppErrorReportButton } from '@app/question-report/components/AppErrorReportDialog'

type StudyResult = NonNullable<ResultController['resultQuery']['data']>
type SessionView = NonNullable<ResultController['sessionQuery']['data']>

/** Either a screen for a result that cannot be shown as a set, or the set to show. */
export type ResultView =
  | { screen: ReactElement }
  | { studyResult: StudyResult; sessionView: SessionView }

export const readResultView = ({
  result,
  t,
  autoFocusOnPush,
  isGuest
}: {
  result: ResultController
  t: TFunction<'result'>
  autoFocusOnPush: boolean
  isGuest: boolean
}): ResultView => {
  const { resultQuery, sessionQuery } = result
  const screen = (element: ReactElement): ResultView => ({ screen: element })
  if (!result.isAuthReady) {
    return screen(<LoadingState message={t('loading')} />)
  }

  if (result.isRetiredSession) {
    return screen(
      <ResultSetupLinkError
        autoFocus
        title={t('retired.title')}
        description={t('retired.description')}
      />
    )
  }

  if (result.isColdOffline || result.isUnverifiedGuestProbePaused) {
    return screen(
      <ErrorState
        headingLevel={1}
        title={t('error.offlineTitle')}
        description={t('error.offlineDescription')}
      />
    )
  }

  if (result.isWaitingForResult) {
    return screen(<LoadingState message={t('loading')} />)
  }

  if (result.hasRetryableError) {
    return screen(
      <ErrorState
        autoFocus={autoFocusOnPush}
        headingLevel={1}
        title={t('error.title')}
        description={t('error.description')}
        onRetry={result.refetchResult}
        action={<AppErrorReportButton />}
      />
    )
  }

  if (result.hasNotFoundError || !resultQuery.data || !sessionQuery.data) {
    return screen(
      <ResultSetupLinkError
        autoFocus={autoFocusOnPush}
        title={t('notFound.title')}
        description={t('notFound.description')}
      />
    )
  }

  if (result.isRetrySourceMissing) {
    return screen(
      <ResultSetupLinkError
        autoFocus
        title={t('notFound.title')}
        description={t('notFound.retrySourceDescription')}
      />
    )
  }

  const studyResult = resultQuery.data
  const sessionView = sessionQuery.data
  const { session } = sessionView

  if (
    !isGuest &&
    session.mode === 'WRONG_NOTE' &&
    sessionView.requestedCount === 1 &&
    sessionView.actualCount === 1 &&
    !sessionView.usedFallback &&
    studyResult.items.length === 1 &&
    readReviewReturnContext(result.principalScope, session.id)?.questionId ===
      studyResult.items[0]?.question.id
  ) {
    return screen(
      <ReviewCompletion item={studyResult.items[0]!} session={session} />
    )
  }

  return { studyResult, sessionView }
}
