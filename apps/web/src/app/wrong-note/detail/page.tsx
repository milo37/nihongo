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
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { ErrorState } from '@common/components/ErrorState'
import { ExplanationLanguagePanel } from '@common/components/ExplanationLanguagePanel'
import { LoadingState } from '@common/components/LoadingState'
import { MemoEditor } from '@app/wrong-note/components/MemoEditor'
import { ReviewTimeline } from '@app/wrong-note/components/ReviewTimeline'
import { useCreateTargetedReviewSession } from '@app/wrong-note/hooks/useCreateTargetedReviewSession'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import type { WrongNoteDetailView } from '@app/wrong-note/adapters/wrongNoteView'
import { useGetWrongNote } from '@app/wrong-note/hooks/useGetWrongNote'
import { useGetWrongNoteMemo } from '@app/wrong-note/hooks/useGetWrongNoteMemo'
import { useListReviewEvents } from '@app/wrong-note/hooks/useListReviewEvents'
import {
  assertCurrentTargetedReviewAction,
  completeTargetedReviewAction
} from '@app/wrong-note/queries/wrongNoteMutations'
import { getSafeWrongNoteReturnTo } from '@app/wrong-note/reviewQueueSearch'
import { readTargetedReviewAttempt } from '@app/wrong-note/targetedReviewAttemptStorage'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'
import { QuestionReportDialog } from '@app/question-report/components/QuestionReportDialog'
import { resolveUiLocale } from '@/i18n/types'
import {
  formatDateTime as formatLocaleDateTime,
  formatNumber
} from '@libs/localeFormatters'
import { useTrackWrongNoteOpened } from '@/analytics/client'

type WrongNoteDetailContentProps = {
  action?: ReactNode
  data: WrongNoteDetailView
  headingRef?: RefObject<HTMLHeadingElement | null>
}

type TargetedNoticeCode = 'endedArchived' | 'endedAvailable'

export const WrongNoteDetailContent = ({
  action,
  data,
  headingRef
}: WrongNoteDetailContentProps): ReactElement => {
  const { i18n, t } = useTranslation('wrongNote')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const formatCount = (value: number): string => formatNumber(value, locale)
  const formatDateTime = (value: string | null): string =>
    value
      ? formatLocaleDateTime(value, locale, {
          dateStyle: 'medium',
          timeStyle: 'short'
        })
      : t('detail.review.noRecord')
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Badge variant="brand">{data.question.level}</Badge>
        <Badge>{commonT(`taxonomy.subjects.${data.question.subject}`)}</Badge>
        <Badge
          variant={data.wrongNote.status === 'SOLVED' ? 'success' : 'warning'}
        >
          {commonT(`taxonomy.wrongNoteStatuses.${data.wrongNote.status}`)}
        </Badge>
        <Badge
          variant={
            data.wrongNote.reviewAvailability === 'ARCHIVED'
              ? 'neutral'
              : 'info'
          }
        >
          {commonT(
            `taxonomy.availability.${data.wrongNote.reviewAvailability}`
          )}
        </Badge>
      </div>
      <h1
        ref={headingRef}
        className="mt-5 rounded-sm text-3xl font-black leading-tight"
        tabIndex={-1}
      >
        {t('detail.title')}
      </h1>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <article className="rounded-xl border border-line bg-white p-5 sm:p-7">
          <p className="mb-4 rounded-lg bg-slate-100 p-3 text-sm font-semibold leading-6 text-slate-700">
            {t('detail.snapshotNotice')}
          </p>
          {data.question.passage ? (
            <div
              className="mb-6 border-l-4 border-slate-300 bg-slate-50 p-4 leading-8 text-slate-700"
              lang="ja"
            >
              {data.question.passage}
            </div>
          ) : null}
          <h2 className="text-2xl font-black leading-9" lang="ja">
            {data.question.questionText}
          </h2>
          <ol className="mt-6 space-y-2">
            {data.question.options.map((option) => (
              <li
                key={option.id}
                className={[
                  'flex min-h-12 items-center justify-between gap-3 rounded-lg border px-4 py-3',
                  option.isCorrect
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-line'
                ].join(' ')}
              >
                <span className="min-w-0 break-words" lang="ja">
                  {option.label}. {option.text}
                </span>
                {option.isCorrect ? (
                  <strong className="text-sm text-emerald-800">
                    {t('detail.correct')}
                  </strong>
                ) : null}
              </li>
            ))}
          </ol>

          <div className="mt-7 border-t border-line pt-6">
            <h3 className="text-lg font-black">{t('detail.explanation')}</h3>
            <div className="mt-3">
              <ExplanationLanguagePanel
                key={data.question.id}
                explanationJa={data.question.explanationJa}
                explanationKo={data.question.explanationKo}
              />
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {data.question.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
        </article>

        <aside className="space-y-5">
          <div className="rounded-xl border border-line bg-white p-5">
            <h2 className="text-lg font-black">{t('detail.review.title')}</h2>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted">{t('detail.review.wrongCount')}</dt>
                <dd className="mt-1 text-xl font-black">
                  {t('detail.review.count', {
                    formattedCount: formatCount(data.wrongNote.wrongCount)
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-muted">{t('detail.review.streak')}</dt>
                <dd className="mt-1 text-xl font-black">
                  {t('detail.review.count', {
                    formattedCount: formatCount(data.wrongNote.correctStreak)
                  })}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted">{t('detail.review.lastWrong')}</dt>
                <dd className="mt-1 font-semibold">
                  {formatDateTime(data.wrongNote.lastWrongAt)}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted">{t('detail.review.nextReview')}</dt>
                <dd className="mt-1 font-semibold">
                  {formatDateTime(data.wrongNote.nextReviewAt)}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted">{t('detail.review.lastReview')}</dt>
                <dd className="mt-1 font-semibold">
                  {formatDateTime(data.wrongNote.lastReviewedAt)}
                </dd>
              </div>
            </dl>
            <div
              className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950"
              role="status"
            >
              {data.wrongNote.reviewAvailability === 'ARCHIVED'
                ? t('detail.review.archived')
                : t('detail.review.available')}
            </div>
            {action ? <div className="mt-4">{action}</div> : null}
          </div>
        </aside>
      </div>
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
  const memoQuery = useGetWrongNoteMemo(questionId)
  const historyQuery = useListReviewEvents(questionId)
  const createTargeted = useCreateTargetedReviewSession()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const [memoDirtyState, setMemoDirtyState] = useState({
    isDirty: false,
    questionId
  })
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
  const isMemoDirty =
    memoDirtyState.questionId === questionId && memoDirtyState.isDirty
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
  const handleMemoDirtyChange = useCallback(
    (isDirty: boolean) => setMemoDirtyState({ isDirty, questionId }),
    [questionId]
  )
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
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <Link
        className="mb-6 inline-flex min-h-11 items-center px-1 font-bold text-brand underline underline-offset-2 hover:no-underline"
        to={returnTo}
      >
        {returnTo.startsWith('/wrong-notes/history')
          ? t('detail.states.backHistory')
          : returnTo === '/dashboard'
            ? t('detail.states.backDashboard')
            : t('detail.states.backCenter')}
      </Link>
      <WrongNoteDetailContent
        data={wrongNoteQuery.data}
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
                  isLoading={isTargetedPending}
                  loadingLabel={
                    isTargetedPaused
                      ? t('detail.targeted.waitingConnection')
                      : t('detail.targeted.loading')
                  }
                  disabled={isMemoDirty}
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
                {isMemoDirty ? (
                  <p className="mt-3 text-sm font-semibold text-amber-900">
                    {t('detail.targeted.memoDirty')}
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
        <div
          className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          <p className="font-semibold">{t('detail.states.stale')}</p>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => {
              shouldRestoreRetryFocusRef.current = true
              void wrongNoteQuery.refetch()
            }}
          >
            {t('detail.states.retry')}
          </Button>
        </div>
      ) : null}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section
          className="min-w-0 rounded-xl border border-line bg-white p-5 sm:p-7"
          aria-labelledby="memo-heading"
        >
          <h2 id="memo-heading" className="text-xl font-black">
            {t('detail.memoSection.title')}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            {t('detail.memoSection.description')}
          </p>
          <div className="mt-5">
            <MemoEditor
              key={`${identityKey}:${questionId}`}
              disabled={isTargetedPending}
              memoQuery={memoQuery}
              onDirtyChange={handleMemoDirtyChange}
              questionId={questionId}
            />
          </div>
        </section>

        <section
          className="min-w-0 rounded-xl border border-line bg-slate-50 p-5 sm:p-7"
          aria-labelledby="timeline-heading"
        >
          <h2 id="timeline-heading" className="text-xl font-black">
            {t('detail.timelineSection.title')}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            {t('detail.timelineSection.description')}
          </p>
          <div className="mt-5">
            <ReviewTimeline historyQuery={historyQuery} />
          </div>
        </section>
      </div>
    </section>
  )
}
