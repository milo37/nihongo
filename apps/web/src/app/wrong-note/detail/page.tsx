import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import { isNotFoundApiError } from '@libs/apiError'
import { WrongNoteMemoSection } from '@app/wrong-note/components/WrongNoteMemoSection'
import { TargetedReviewAction } from '@app/wrong-note/detail/TargetedReviewAction'
import { WrongNoteDetailContent } from '@app/wrong-note/detail/WrongNoteDetailContent'
import { Button } from '@nihongo/browser/common/components/Button'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { useGetWrongNote } from '@app/wrong-note/hooks/useGetWrongNote'
import { useTargetedReviewStart } from '@app/wrong-note/hooks/useTargetedReviewStart'
import { useWrongNotePreviousAnswer } from '@app/wrong-note/hooks/useWrongNotePreviousAnswer'
import { getSafeWrongNoteReturnTo } from '@app/wrong-note/reviewQueueSearch'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { useTrackWrongNoteOpened } from '@/analytics/client'
import { AppErrorReportButton } from '@app/question-report/components/AppErrorReportDialog'
import { TextLink } from '@nihongo/browser/common/components/TextLink'

export const WrongNoteDetailPage = (): ReactElement => {
  const { t } = useTranslation('wrongNote')
  const { questionId = '' } = useParams()
  useTrackWrongNoteOpened('DETAIL', questionId)
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const identityKey = getStudyDraftPrincipalScope(user)
  const wrongNoteQuery = useGetWrongNote(questionId)
  const previousAnswer = useWrongNotePreviousAnswer(wrongNoteQuery.data)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const shouldRestoreRetryFocusRef = useRef(false)
  const returnTo = getSafeWrongNoteReturnTo(searchParams.get('returnTo'))
  const targeted = useTargetedReviewStart({ identityKey, questionId, returnTo })
  const isDetailPaused = wrongNoteQuery.fetchStatus === 'paused'
  const retryDetail = (): void => {
    shouldRestoreRetryFocusRef.current = true
    void wrongNoteQuery.refetch()
  }

  useEffect(() => {
    if (
      wrongNoteQuery.isSuccess &&
      wrongNoteQuery.data &&
      shouldRestoreRetryFocusRef.current
    ) {
      shouldRestoreRetryFocusRef.current = false
      headingRef.current?.focus()
    }
  }, [wrongNoteQuery.data, wrongNoteQuery.isSuccess])

  if (wrongNoteQuery.isPending && isDetailPaused) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <ErrorState
          headingLevel={1}
          title={t('detail.states.coldOfflineTitle')}
          description={t('detail.states.coldOfflineDescription')}
        />
      </section>
    )
  }

  if (wrongNoteQuery.isPending) {
    return <LoadingState message={t('detail.states.loading')} />
  }

  if (
    wrongNoteQuery.isError &&
    !wrongNoteQuery.data &&
    isNotFoundApiError(wrongNoteQuery.error)
  ) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <ErrorState
          headingLevel={1}
          title={t('detail.states.notFoundTitle')}
          description={t('detail.states.notFoundDescription')}
          action={
            <TextLink to="/wrong-notes">
              {t('detail.states.backCenter')}
            </TextLink>
          }
        />
      </section>
    )
  }

  if (!wrongNoteQuery.data) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <ErrorState
          headingLevel={1}
          title={t('detail.states.loadErrorTitle')}
          description={t('detail.states.loadErrorDescription')}
          onRetry={retryDetail}
          action={<AppErrorReportButton />}
        />
      </section>
    )
  }

  return (
    <section className="review-document">
      <Link
        className="mb-6 inline-flex min-h-11 items-center px-1 font-bold text-brand underline underline-offset-2 hover:no-underline"
        to={returnTo}
        state={{ reviewFocus: questionId }}
      >
        {t('integration.back')}
      </Link>
      <WrongNoteDetailContent
        data={wrongNoteQuery.data}
        previousAnswer={previousAnswer}
        headingRef={headingRef}
        memo={<WrongNoteMemoSection key={questionId} questionId={questionId} />}
        action={
          <TargetedReviewAction
            data={wrongNoteQuery.data}
            isStartDisabled={
              wrongNoteQuery.isError ||
              wrongNoteQuery.isFetching ||
              isDetailPaused
            }
            targeted={targeted}
          />
        }
      />

      {isDetailPaused ? (
        <p
          className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950"
          role="status"
        >
          {t('detail.states.cachedOffline')}
        </p>
      ) : null}
      {wrongNoteQuery.isError ? (
        <ErrorState
          className="mt-6"
          density="inline"
          title={t('detail.states.stale')}
          description={t('detail.states.loadErrorDescription')}
          action={
            <Button size="sm" onClick={retryDetail}>
              {t('detail.states.retry')}
            </Button>
          }
        />
      ) : null}
    </section>
  )
}
