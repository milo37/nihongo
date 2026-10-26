import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type { ReactElement, ReactNode, RefObject } from 'react'
import {
  isNotFoundApiError,
  isQuestionNotAvailableApiError
} from '@libs/apiError'
import { ReviewStatus } from '@app/wrong-note/components/ReviewStatus'
import { saveReviewReturnContext } from '@app/wrong-note/reviewReturnContext'
import { Button } from '@nihongo/browser/common/components/Button'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { ExplanationLanguagePanel } from '@common/components/ExplanationLanguagePanel'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { useCreateTargetedReviewSession } from '@app/wrong-note/hooks/useCreateTargetedReviewSession'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import type { WrongNoteDetailView } from '@app/wrong-note/adapters/wrongNoteView'
import { useGetWrongNote } from '@app/wrong-note/hooks/useGetWrongNote'
import { useWrongNotePreviousAnswer } from '@app/wrong-note/hooks/useWrongNotePreviousAnswer'
import type { WrongNotePreviousAnswer } from '@app/wrong-note/adapters/wrongNotePreviousAnswer'
import {
  assertCurrentTargetedReviewAction,
  completeTargetedReviewAction
} from '@app/wrong-note/queries/wrongNoteMutations'
import { getSafeWrongNoteReturnTo } from '@app/wrong-note/reviewQueueSearch'
import { readTargetedReviewAttempt } from '@nihongo/browser/app/wrong-note/targetedReviewAttemptStorage'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { useAppStore } from '@nihongo/browser/store/index'
import { QuestionReportDialog } from '@app/question-report/components/QuestionReportDialog'
import { useTrackWrongNoteOpened } from '@/analytics/client'

type WrongNoteDetailContentProps = {
  action?: ReactNode
  data: WrongNoteDetailView
  previousAnswer: WrongNotePreviousAnswer
  headingRef?: RefObject<HTMLHeadingElement | null>
}

type TargetedNoticeCode = 'endedArchived' | 'endedAvailable'

export const WrongNoteDetailContent = ({
  action,
  data,
  previousAnswer,
  headingRef
}: WrongNoteDetailContentProps): ReactElement => {
  const { t } = useTranslation('wrongNote')
  const { t: commonT } = useTranslation('common')
  return (
    <>
      <h1 ref={headingRef} className="review-title" tabIndex={-1}>
        {t('integration.detail')}
      </h1>
      <div className="review-item-meta">
        <span>
          {data.question.level} ·{' '}
          {commonT(`taxonomy.subjects.${data.question.subject}`)}
        </span>
        <ReviewStatus status={data.wrongNote.status} />
      </div>
      <p className="review-notice">{t('detail.snapshotNotice')}</p>
      {data.question.passage ? (
        <div className="review-passage" lang="ja">
          {data.question.passage}
        </div>
      ) : null}
      <h2 className="review-question" lang="ja">
        {data.question.questionText}
      </h2>
      {previousAnswer.status !== 'selected' ? (
        <p className="review-notice" role="status">
          {t(`detail.previousAnswer.${previousAnswer.status}`)}
        </p>
      ) : null}
      <ol className="review-options">
        {data.question.options.map((option) => (
          <li key={option.id} className={option.isCorrect ? 'is-correct' : ''}>
            <span lang="ja">
              {option.label}. {option.text}
            </span>
            {previousAnswer.status === 'selected' &&
            previousAnswer.optionId === option.id ? (
              <strong>{t('detail.previousAnswer.selected')}</strong>
            ) : null}
            {option.isCorrect ? <strong>{t('detail.correct')}</strong> : null}
          </li>
        ))}
      </ol>
      <section
        className="review-explanation"
        aria-labelledby="review-detail-explanation"
      >
        <h2 id="review-detail-explanation">{t('detail.explanation')}</h2>
        <ExplanationLanguagePanel
          key={data.question.id}
          explanationJa={data.question.explanationJa}
          explanationKo={data.question.explanationKo}
        />
      </section>
      {data.wrongNote.reviewAvailability === 'ARCHIVED' ? (
        <p className="review-notice" role="status">
          {t('detail.review.archived')}
        </p>
      ) : null}
      {data.currentReviewQuestionVersionId !==
        data.question.questionVersionId &&
      data.wrongNote.reviewAvailability !== 'ARCHIVED' ? (
        <p className="review-notice">{t('integration.versionChanged')}</p>
      ) : null}
      {action ? <div className="review-document-actions">{action}</div> : null}
    </>
  )
}

export const WrongNoteDetailPage = (): ReactElement => {
  const { t } = useTranslation('wrongNote')
  const { questionId = '' } = useParams()
  useTrackWrongNoteOpened('DETAIL', questionId)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const identityKey = getStudyDraftPrincipalScope(user)
  const wrongNoteQuery = useGetWrongNote(questionId)
  const previousAnswer = useWrongNotePreviousAnswer(wrongNoteQuery.data)
  const createTargeted = useCreateTargetedReviewSession()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const [targetedNotice, setTargetedNotice] = useState({
    code: null as TargetedNoticeCode | null,
    questionId
  })
  const [targetedAttemptState, setTargetedAttemptState] = useState(() => ({
    identityKey,
    isPresent: readTargetedReviewAttempt(identityKey, questionId) !== null,
    questionId
  }))
  const headingRef = useRef<HTMLHeadingElement>(null)
  const currentQuestionIdRef = useRef(questionId)
  const shouldRestoreRetryFocusRef = useRef(false)
  const returnTo = getSafeWrongNoteReturnTo(searchParams.get('returnTo'))
  const hasTargetedRecoveryAttempt =
    targetedAttemptState.identityKey === identityKey &&
    targetedAttemptState.questionId === questionId
      ? targetedAttemptState.isPresent
      : readTargetedReviewAttempt(identityKey, questionId) !== null
  const targetedMessage =
    targetedNotice.questionId === questionId && targetedNotice.code
      ? t(`detail.targeted.${targetedNotice.code}`)
      : ''
  const isCurrentTargetedMutation =
    createTargeted.variables?.questionId === questionId
  const isTargetedPending =
    isCurrentTargetedMutation && createTargeted.isPending
  const isTargetedError = isCurrentTargetedMutation && createTargeted.isError
  const isTargetedPaused = isCurrentTargetedMutation && createTargeted.isPaused
  const isDetailPaused = wrongNoteQuery.fetchStatus === 'paused'
  const syncTargetedAttemptState = useCallback(
    () =>
      setTargetedAttemptState({
        identityKey,
        isPresent: readTargetedReviewAttempt(identityKey, questionId) !== null,
        questionId
      }),
    [identityKey, questionId]
  )

  useLayoutEffect(() => {
    currentQuestionIdRef.current = questionId
  }, [questionId])

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
            <Link
              className="inline-flex min-h-11 items-center px-1 font-bold text-brand underline hover:no-underline"
              to="/wrong-notes"
            >
              {t('detail.states.backCenter')}
            </Link>
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
          onRetry={() => {
            shouldRestoreRetryFocusRef.current = true
            void wrongNoteQuery.refetch()
          }}
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
        action={
          <>
            {wrongNoteQuery.data.question.questionVersionId ? (
              <div className="mb-3">
                <QuestionReportDialog
                  questionId={wrongNoteQuery.data.question.id}
                  questionVersionId={
                    wrongNoteQuery.data.question.questionVersionId
                  }
                />
              </div>
            ) : null}
            {wrongNoteQuery.data.wrongNote.reviewAvailability === 'AVAILABLE' ||
            hasTargetedRecoveryAttempt ? (
              <>
                <Button
                  fullWidth
                  disabled={
                    wrongNoteQuery.isError ||
                    wrongNoteQuery.isFetching ||
                    isDetailPaused
                  }
                  isLoading={isTargetedPending}
                  loadingLabel={
                    isTargetedPaused
                      ? t('detail.targeted.waitingConnection')
                      : t('detail.targeted.loading')
                  }
                  onClick={() => {
                    setTargetedNotice({ code: null, questionId })
                    setTargetedAttemptState({
                      identityKey,
                      isPresent: true,
                      questionId
                    })
                    createTargeted.reset()
                    createTargeted.mutate(
                      { principalScope: identityKey, questionId },
                      {
                        onSuccess: ({ session }, input) => {
                          assertCurrentTargetedReviewAction(input)
                          if (
                            input.questionId !== currentQuestionIdRef.current
                          ) {
                            return
                          }
                          if (
                            session.session.status === 'IN_PROGRESS' ||
                            session.session.status === 'SUBMITTED'
                          ) {
                            saveReviewReturnContext({
                              principalScope: identityKey,
                              sessionId: session.session.id,
                              questionId,
                              returnTo
                            })
                          }
                          if (session.session.status === 'IN_PROGRESS') {
                            beginPractice(
                              session.session.id,
                              session.session.startedAt
                            )
                            void navigate(
                              `/practice/session/${session.session.id}`
                            )
                            completeTargetedReviewAction(input)
                            setTargetedAttemptState({
                              identityKey,
                              isPresent: false,
                              questionId
                            })
                          } else if (session.session.status === 'SUBMITTED') {
                            void navigate(
                              `/practice/result/${session.session.id}`
                            )
                            completeTargetedReviewAction(input)
                            setTargetedAttemptState({
                              identityKey,
                              isPresent: false,
                              questionId
                            })
                          } else {
                            setTargetedNotice({
                              code:
                                wrongNoteQuery.data.wrongNote
                                  .reviewAvailability === 'ARCHIVED'
                                  ? 'endedArchived'
                                  : 'endedAvailable',
                              questionId
                            })
                            completeTargetedReviewAction(input)
                            setTargetedAttemptState({
                              identityKey,
                              isPresent: false,
                              questionId
                            })
                          }
                        },
                        onError: () => {
                          syncTargetedAttemptState()
                        }
                      }
                    )
                  }}
                >
                  {wrongNoteQuery.data.wrongNote.reviewAvailability ===
                  'ARCHIVED'
                    ? t('detail.targeted.recover')
                    : t('detail.targeted.start')}
                </Button>
                {wrongNoteQuery.data.wrongNote.reviewAvailability ===
                'ARCHIVED' ? (
                  <p className="mt-3 text-sm font-semibold text-muted">
                    {t('detail.targeted.archivedRecovery')}
                  </p>
                ) : null}
                {isTargetedPaused ? (
                  <p
                    className="mt-3 text-sm font-semibold text-amber-900"
                    role="status"
                  >
                    {t('detail.targeted.offline')}
                  </p>
                ) : null}
                {isTargetedError ? (
                  <p
                    className="mt-3 text-sm font-semibold text-red-800"
                    role="alert"
                  >
                    {isQuestionNotAvailableApiError(createTargeted.error)
                      ? t('detail.targeted.unavailable')
                      : t('detail.targeted.error')}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm font-semibold text-muted">
                {t('detail.targeted.archivedOnly')}
              </p>
            )}
            <p
              className="mt-3 min-h-6 text-sm font-semibold text-muted"
              aria-live="polite"
            >
              {targetedMessage}
            </p>
          </>
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
            <Button
              size="sm"
              onClick={() => {
                shouldRestoreRetryFocusRef.current = true
                void wrongNoteQuery.refetch()
              }}
            >
              {t('detail.states.retry')}
            </Button>
          }
        />
      ) : null}
    </section>
  )
}
