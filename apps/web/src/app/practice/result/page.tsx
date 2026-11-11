import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams } from 'react-router'
import type { ReactElement } from 'react'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { usePracticeResultController } from '@app/practice/hooks/usePracticeResultController'
import { ResultActions } from '@app/practice/result/ResultActions'
import {
  ResultBookmarkNotices,
  ResultRetryNotice,
  ResultSourceNotice
} from '@app/practice/result/ResultNotices'
import { ResultQuestionDetail } from '@app/practice/result/ResultQuestionDetail'
import { ResultQuestionNavigation } from '@app/practice/result/ResultQuestionNavigation'
import {
  ResultSetupLinkError,
  RetryNavigationDialog
} from '@app/practice/result/ResultStateScreens'
import { ResultSummary } from '@app/practice/result/ResultSummary'
import { ReviewCompletion } from '@app/practice/result/ReviewCompletion'
import { readReviewReturnContext } from '@app/wrong-note/reviewReturnContext'
import { AppErrorReportButton } from '@app/question-report/components/AppErrorReportDialog'

type ResultController = ReturnType<typeof usePracticeResultController>
type ResultItem = NonNullable<ResultController['selectedItem']>

/** Question navigation above the selected question's detail. */
const SelectedResultItem = ({
  result,
  items,
  item
}: {
  result: ResultController
  items: readonly ResultItem[]
  item: ResultItem
}): ReactElement => {
  const { t } = useTranslation('result')
  const { bookmark } = result
  return (
    <div className="study-result-layout">
      <ResultQuestionNavigation
        items={items}
        selectedQuestionId={item.question.id}
        onSelect={result.selectQuestion}
      />
      <ResultQuestionDetail
        key={item.question.id}
        item={item}
        ordinal={result.selectedIndex + 1}
        canReport={result.role !== 'GUEST'}
        isBookmarked={result.selectedIsBookmarked}
        bookmarkDisabled={
          bookmark.isUnavailable || result.isResultSourceUnavailable
        }
        isResultSourceUnavailable={result.isResultSourceUnavailable}
        bookmarkMessage={
          bookmark.message?.questionId === item.question.id
            ? {
                text: t(`bookmark.${bookmark.message.code}`),
                isError: bookmark.message.code !== 'unavailable'
              }
            : null
        }
        onToggleBookmark={result.toggleSelectedBookmark}
      />
    </div>
  )
}

const PracticeResultPageContent = (): ReactElement => {
  const { t } = useTranslation('result')
  const { sessionId = '' } = useParams()
  const summaryHeadingRef = useRef<HTMLHeadingElement>(null)
  const result = usePracticeResultController({ sessionId, summaryHeadingRef })
  const { resultQuery, sessionQuery } = result
  const location = useLocation()
  const navigate = useNavigate()
  // The red pen plays once right after submit; the state is dropped at once
  // so Back or reload show the finished marks.
  const [animateGrading] = useState(() =>
    Boolean(
      (location.state as { gradingReveal?: boolean } | null)?.gradingReveal
    )
  )
  useEffect(() => {
    if (!animateGrading) return
    void navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: null
    })
    // Run once on mount; the replaced entry keeps the same path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const autoFocusOnPush = result.navigationType !== 'POP'
  const isGuest = result.role === 'GUEST'

  if (!result.isAuthReady) {
    return <LoadingState message={t('loading')} />
  }

  if (result.isRetiredSession) {
    return (
      <ResultSetupLinkError
        autoFocus
        title={t('retired.title')}
        description={t('retired.description')}
      />
    )
  }

  if (result.isColdOffline || result.isUnverifiedGuestProbePaused) {
    return (
      <ErrorState
        headingLevel={1}
        title={t('error.offlineTitle')}
        description={t('error.offlineDescription')}
      />
    )
  }

  if (result.isWaitingForResult) {
    return <LoadingState message={t('loading')} />
  }

  if (result.hasRetryableError) {
    return (
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
    return (
      <ResultSetupLinkError
        autoFocus={autoFocusOnPush}
        title={t('notFound.title')}
        description={t('notFound.description')}
      />
    )
  }

  if (result.isRetrySourceMissing) {
    return (
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
  const { selectedItem } = result

  if (
    !isGuest &&
    session.practiceContractVersion === 2 &&
    session.mode === 'WRONG_NOTE' &&
    sessionView.requestedCount === 1 &&
    sessionView.actualCount === 1 &&
    !sessionView.usedFallback &&
    studyResult.items.length === 1 &&
    readReviewReturnContext(result.principalScope, session.id)?.questionId ===
      studyResult.items[0]?.question.id
  ) {
    return <ReviewCompletion item={studyResult.items[0]!} session={session} />
  }

  const isResultPaused =
    resultQuery.fetchStatus === 'paused' ||
    sessionQuery.fetchStatus === 'paused'
  const { bookmark, createRetrySession } = result

  return (
    <section className="learning-note study-page study-result mx-auto max-w-[760px] px-4 py-10 sm:px-6 lg:py-14">
      <div className="study-result-main">
        {result.isResultSourceUnavailable ? (
          <ResultSourceNotice
            isError={resultQuery.isError || sessionQuery.isError}
            isPaused={isResultPaused}
            onRetry={result.refetchResult}
          />
        ) : null}
        <ResultSummary
          headingRef={summaryHeadingRef}
          incorrectCount={result.incorrectItems.length}
          isGuest={isGuest}
          isGuestDone={result.isGuestDone}
          animateGrading={animateGrading}
          result={studyResult}
          session={session}
        />
        {/* What to do next sits right under the score (G, #792 design). */}
        <ResultActions
          isGuest={isGuest}
          isGuestDone={result.isGuestDone}
          guestTriesLeft={result.guestTriesLeft}
          isRetryDisabled={result.isResultSourceUnavailable}
          isRetryLoading={
            createRetrySession.isPending || result.isRetrySourceRefreshing
          }
          onRetry={result.handleRetryIncorrect}
          retryLoadingLabel={
            result.isRetrySourceRefreshing
              ? t('retry.checking')
              : createRetrySession.isPaused
                ? t('retry.waitingConnection')
                : t('retry.creating')
          }
          requestedCount={sessionView.requestedCount}
          session={session}
          showRetry={result.canShowRetryButton}
        />

        <ResultRetryNotice
          canRequestCanonicalRetry={result.canRequestCanonicalRetry}
          hasNoEligibleRetry={result.hasNoEligibleRetry}
          hasRetryRequestError={result.hasRetryRequestError}
          isRetryAccountRestricted={result.isRetryAccountRestricted}
          incorrectCount={result.incorrectItems.length}
          isRetryPaused={createRetrySession.isPaused}
          retryMessage={result.retryMessage}
        />

        <div className="study-explanations mt-10 space-y-4">
          {/* Named for screen readers only; the B4 page shows no subheads. */}
          <h2 id="result-explanations" className="sr-only">
            {t('items.title')}
          </h2>
          <ResultBookmarkNotices bookmark={bookmark} isGuest={isGuest} />
          {selectedItem ? (
            <SelectedResultItem
              result={result}
              items={studyResult.items}
              item={selectedItem}
            />
          ) : (
            <EmptyState
              title={t('navigation.emptyTitle')}
              description={t('navigation.emptyDescription')}
            />
          )}
        </div>
      </div>

      <RetryNavigationDialog
        open={result.isRetryBlocked}
        onStay={result.stayOnResult}
      />
    </section>
  )
}

export const PracticeResultPage = (): ReactElement => {
  const { sessionId = '' } = useParams()
  const { role, user } = useAuth()
  const principalKey = `${role}:${user?.id ?? 'guest'}`

  return <PracticeResultPageContent key={`${principalKey}:${sessionId}`} />
}
