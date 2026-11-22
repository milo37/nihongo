import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import type { ReactElement } from 'react'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { usePracticeResultController } from '@app/practice/hooks/usePracticeResultController'
import { ResultActions } from '@app/practice/result/ResultActions'
import { ResultBookmarkNotices } from '@app/practice/result/ResultBookmarkNotices'
import {
  ResultRetryNotice,
  ResultSourceNotice
} from '@app/practice/result/ResultNotices'
import { SelectedResultItem } from '@app/practice/result/SelectedResultItem'
import { readResultView } from '@app/practice/result/resultView'
import { useGradingReveal } from '@app/practice/result/useGradingReveal'
import { RetryNavigationDialog } from '@app/practice/result/ResultStateScreens'
import { ResultSummary } from '@app/practice/result/ResultSummary'
import { ResultRushLine } from '@app/practice/result/ResultRushLine'

const PracticeResultPageContent = (): ReactElement => {
  // Left uncompiled as before the split: the one-run effect (now in
  // useGradingReveal) used to keep the compiler off this component.
  'use no memo'
  const { user } = useAuth()
  const { t } = useTranslation('result')
  const { sessionId = '' } = useParams()
  const summaryHeadingRef = useRef<HTMLHeadingElement>(null)
  const result = usePracticeResultController({ sessionId, summaryHeadingRef })
  const { resultQuery, sessionQuery } = result
  const animateGrading = useGradingReveal()
  const autoFocusOnPush = result.navigationType !== 'POP'
  const isGuest = result.role === 'GUEST'
  const view = readResultView({ result, t, autoFocusOnPush, isGuest })
  if ('screen' in view) return view.screen

  const { studyResult, sessionView } = view
  const { session } = sessionView
  const { selectedItem } = result

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
          memberId={isGuest ? null : (user?.id ?? null)}
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
        {isGuest || result.isResultSourceUnavailable ? null : (
          <ResultRushLine level={session.level} />
        )}
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
