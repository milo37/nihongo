import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Link,
  useBlocker,
  useNavigate,
  useNavigationType,
  useParams
} from 'react-router'
import type { ReactElement } from 'react'
import type { BookmarkSummary } from '@nihongo/contracts/bookmark/bookmark'
import {
  isAuthenticationBoundaryApiError,
  isNoEligibleQuestionsApiError,
  isNotFoundApiError,
  isStudyResultNotReadyApiError
} from '@util/apiError'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { EmptyState } from '@common/components/EmptyState'
import { ErrorState } from '@common/components/ErrorState'
import { ExplanationLanguagePanel } from '@common/components/ExplanationLanguagePanel'
import { LoadingState } from '@common/components/LoadingState'
import { useBookmarkMutationActivity } from '@app/bookmark/hooks/useBookmarkMutationActivity'
import { useCreateBookmark } from '@app/bookmark/hooks/useCreateBookmark'
import { useDeleteBookmark } from '@app/bookmark/hooks/useDeleteBookmark'
import { useListBookmarks } from '@app/bookmark/hooks/useListBookmarks'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { useCreateResultRetrySession } from '@app/practice/hooks/useCreateResultRetrySession'
import { useGetStudyResult } from '@app/practice/hooks/useGetStudyResult'
import { useGetStudySession } from '@app/practice/hooks/useGetStudySession'
import { readResultRetryAttempt } from '@app/practice/resultRetryAttemptStorage'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'
import { QuestionReportDialog } from '@app/question-report/components/QuestionReportDialog'
import { resolveUiLocale } from '@/i18n/types'
import { formatNumber } from '@libs/localeFormatters'

type BookmarkStatusCode =
  | 'unavailable'
  | 'removed'
  | 'removeFailed'
  | 'saved'
  | 'saveFailed'

type RetryStatusCode = 'priorEnded' | 'sourceRefreshing'

const PracticeResultPageContent = (): ReactElement => {
  const { i18n, t } = useTranslation('result')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const formatCount = (value: number): string => formatNumber(value, locale)
  const formatDuration = (seconds: number): string =>
    t('metrics.durationValue', {
      minutes: formatCount(Math.floor(seconds / 60)),
      seconds: formatCount(seconds % 60)
    })
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const summaryHeadingRef = useRef<HTMLHeadingElement>(null)
  const shouldRestoreRetryFocusRef = useRef(false)
  const allowRetryNavigationRef = useRef(false)
  const navigatedRetryDestinationRef = useRef<string | null>(null)
  const [bookmarkMessage, setBookmarkMessage] = useState<{
    code: BookmarkStatusCode
    questionId: string
  } | null>(null)
  const [retryMessage, setRetryMessage] = useState<RetryStatusCode | null>(null)
  const [isRetrySourceRefreshing, setRetrySourceRefreshing] = useState(false)
  const [retryDestination, setRetryDestination] = useState<string | null>(null)
  const [isRetrySourceMissing, setRetrySourceMissing] = useState(false)
  const [verifiedGuestResultSessionId, setVerifiedGuestResultSessionId] =
    useState<string | null>(null)
  const { isReady: isAuthReady, role, user } = useAuth()
  const principalScope = getStudyDraftPrincipalScope(user)
  const requireFreshGuestOwnerProbe = isAuthReady && role === 'GUEST'
  const resultQuery = useGetStudyResult(
    sessionId,
    requireFreshGuestOwnerProbe,
    isAuthReady
  )
  const sessionQuery = useGetStudySession(
    sessionId,
    requireFreshGuestOwnerProbe,
    isAuthReady
  )
  const createRetrySession = useCreateResultRetrySession()
  const retryNavigationBlocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      createRetrySession.isPending &&
      !allowRetryNavigationRef.current &&
      currentLocation.pathname !== nextLocation.pathname
  )
  const createBookmark = useCreateBookmark('RESULT')
  const deleteBookmark = useDeleteBookmark()
  const bookmarkMutationActivity = useBookmarkMutationActivity()
  const resultQuestionIds =
    sessionQuery.data?.session.practiceContractVersion === 2
      ? (resultQuery.data?.items.map((item) => item.question.id).toSorted() ??
        [])
      : []
  const bookmarksQuery = useListBookmarks(
    {
      page: 1,
      pageSize: 20,
      ...(resultQuestionIds.length > 0
        ? { questionIds: resultQuestionIds }
        : {})
    },
    role !== 'GUEST' && resultQuestionIds.length > 0
  )

  const isResultReady = Boolean(resultQuery.data && sessionQuery.data)
  const hasCurrentGuestOwnerProof =
    isAuthReady &&
    (role !== 'GUEST' || verifiedGuestResultSessionId === sessionId)
  const hasFrozenRetryAttempt =
    sessionId.length > 0 &&
    readResultRetryAttempt(principalScope, sessionId) !== null

  useEffect(() => {
    if (retryNavigationBlocker.state !== 'blocked') {
      return
    }
    if (retryDestination || !createRetrySession.isPending) {
      retryNavigationBlocker.reset()
    }
  }, [createRetrySession.isPending, retryDestination, retryNavigationBlocker])

  useEffect(() => {
    if (
      !retryDestination ||
      retryNavigationBlocker.state === 'blocked' ||
      navigatedRetryDestinationRef.current === retryDestination
    ) {
      return
    }
    navigatedRetryDestinationRef.current = retryDestination
    allowRetryNavigationRef.current = true
    void navigate(retryDestination)
  }, [navigate, retryDestination, retryNavigationBlocker.state])

  useEffect(() => {
    let nextVerifiedSessionId: string | null | undefined
    if (!isAuthReady || role !== 'GUEST') {
      nextVerifiedSessionId = null
    }
    if (
      nextVerifiedSessionId === undefined &&
      resultQuery.isSuccess &&
      resultQuery.isFetchedAfterMount &&
      resultQuery.data.sessionId === sessionId &&
      sessionQuery.isSuccess &&
      sessionQuery.isFetchedAfterMount &&
      sessionQuery.data.session.id === sessionId
    ) {
      nextVerifiedSessionId = sessionId
    }
    if (
      nextVerifiedSessionId === undefined &&
      ((resultQuery.isError &&
        isAuthenticationBoundaryApiError(resultQuery.error)) ||
        (sessionQuery.isError &&
          isAuthenticationBoundaryApiError(sessionQuery.error)))
    ) {
      nextVerifiedSessionId = null
    }
    if (nextVerifiedSessionId === undefined) {
      return
    }

    let active = true
    queueMicrotask(() => {
      if (active) {
        setVerifiedGuestResultSessionId((current) =>
          current === nextVerifiedSessionId ? current : nextVerifiedSessionId
        )
      }
    })
    return () => {
      active = false
    }
  }, [
    isAuthReady,
    resultQuery.data,
    resultQuery.error,
    resultQuery.isError,
    resultQuery.isFetchedAfterMount,
    resultQuery.isSuccess,
    role,
    sessionId,
    sessionQuery.data,
    sessionQuery.error,
    sessionQuery.isError,
    sessionQuery.isFetchedAfterMount,
    sessionQuery.isSuccess
  ])

  useEffect(() => {
    if (!hasFrozenRetryAttempt) {
      return
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasFrozenRetryAttempt])

  useEffect(() => {
    if (
      isAuthReady &&
      hasCurrentGuestOwnerProof &&
      !isRetrySourceRefreshing &&
      isResultReady &&
      resultQuery.isSuccess &&
      sessionQuery.isSuccess &&
      (navigationType !== 'POP' || shouldRestoreRetryFocusRef.current)
    ) {
      shouldRestoreRetryFocusRef.current = false
      summaryHeadingRef.current?.focus()
    }
  }, [
    hasCurrentGuestOwnerProof,
    isAuthReady,
    isRetrySourceRefreshing,
    isResultReady,
    navigationType,
    resultQuery.isSuccess,
    sessionQuery.isSuccess
  ])

  if (!isAuthReady) {
    return <LoadingState message={t('loading')} />
  }

  const isUnverifiedGuestProbePaused =
    role === 'GUEST' &&
    !hasCurrentGuestOwnerProof &&
    (resultQuery.fetchStatus === 'paused' ||
      sessionQuery.fetchStatus === 'paused')
  const isColdOffline =
    (resultQuery.isPending &&
      !resultQuery.data &&
      resultQuery.fetchStatus === 'paused') ||
    (sessionQuery.isPending &&
      !sessionQuery.data &&
      sessionQuery.fetchStatus === 'paused')

  if (isColdOffline || isUnverifiedGuestProbePaused) {
    return (
      <ErrorState
        headingLevel={1}
        title={t('error.offlineTitle')}
        description={t('error.offlineDescription')}
      />
    )
  }

  const hasNotFoundError =
    (resultQuery.isError && isNotFoundApiError(resultQuery.error)) ||
    (sessionQuery.isError && isNotFoundApiError(sessionQuery.error))
  const hasUnverifiedGuestProbeError =
    role === 'GUEST' &&
    !hasCurrentGuestOwnerProof &&
    (resultQuery.isError || sessionQuery.isError)

  if (
    resultQuery.isPending ||
    sessionQuery.isPending ||
    (!hasCurrentGuestOwnerProof &&
      !resultQuery.isError &&
      !sessionQuery.isError)
  ) {
    return <LoadingState message={t('loading')} />
  }

  const hasRetryableError =
    (hasUnverifiedGuestProbeError && !hasNotFoundError) ||
    (resultQuery.isError &&
      !resultQuery.data &&
      !isNotFoundApiError(resultQuery.error)) ||
    (sessionQuery.isError &&
      !sessionQuery.data &&
      !isNotFoundApiError(sessionQuery.error)) ||
    (!resultQuery.isError && !resultQuery.data) ||
    (!sessionQuery.isError && !sessionQuery.data)
  if (hasRetryableError) {
    return (
      <ErrorState
        autoFocus={navigationType !== 'POP'}
        headingLevel={1}
        title={t('error.title')}
        description={t('error.description')}
        onRetry={() => {
          shouldRestoreRetryFocusRef.current = true
          void Promise.all([resultQuery.refetch(), sessionQuery.refetch()])
        }}
      />
    )
  }

  if (hasNotFoundError || !resultQuery.data || !sessionQuery.data) {
    return (
      <ErrorState
        autoFocus={navigationType !== 'POP'}
        headingLevel={1}
        title={t('notFound.title')}
        description={t('notFound.description')}
        action={
          <Link
            className="inline-flex min-h-11 items-center px-1 font-bold text-brand underline hover:no-underline"
            to="/practice"
          >
            {t('newPractice')}
          </Link>
        }
      />
    )
  }

  if (isRetrySourceMissing) {
    return (
      <ErrorState
        autoFocus
        headingLevel={1}
        title={t('notFound.title')}
        description={t('notFound.retrySourceDescription')}
        action={
          <Link
            className="inline-flex min-h-11 items-center px-1 font-bold text-brand underline hover:no-underline"
            to="/practice"
          >
            {t('newPractice')}
          </Link>
        }
      />
    )
  }

  const result = resultQuery.data
  const session = sessionQuery.data.session
  const isResultSourceUnavailable =
    resultQuery.isError ||
    sessionQuery.isError ||
    resultQuery.fetchStatus === 'paused' ||
    sessionQuery.fetchStatus === 'paused'
  const incorrectItems = result.items.filter((item) => !item.isCorrect)
  const canRequestCanonicalRetry = incorrectItems.every(
    (item) =>
      item.sessionQuestionId !== null &&
      item.question.questionVersionId !== null
  )
  const hasPendingBookmarkMutation =
    bookmarkMutationActivity.pendingQuestionIds.size > 0

  const handleRetryIncorrect = (): void => {
    if (
      incorrectItems.length === 0 ||
      !canRequestCanonicalRetry ||
      isNoEligibleQuestionsApiError(createRetrySession.error) ||
      isResultSourceUnavailable ||
      isRetrySourceRefreshing ||
      createRetrySession.isPending
    ) {
      return
    }
    setRetryMessage(null)
    setRetrySourceMissing(false)
    createRetrySession.reset()
    createRetrySession.mutate(
      { principalScope, sourceSessionId: sessionId },
      {
        onSuccess: ({ session: nextSession }) => {
          if (nextSession.session.status === 'SUBMITTED') {
            setRetryDestination(`/practice/result/${nextSession.session.id}`)
            return
          }
          if (nextSession.session.status === 'IN_PROGRESS') {
            setRetryDestination(`/practice/session/${nextSession.session.id}`)
            return
          }
          setRetryMessage('priorEnded')
        },
        onError: (error) => {
          if (
            isNotFoundApiError(error) &&
            !isNoEligibleQuestionsApiError(error)
          ) {
            setRetrySourceMissing(true)
            return
          }
          if (isStudyResultNotReadyApiError(error)) {
            setRetryMessage('sourceRefreshing')
            setRetrySourceRefreshing(true)
            void Promise.all([
              resultQuery.refetch(),
              sessionQuery.refetch()
            ]).then(() => {
              setRetryMessage(null)
              shouldRestoreRetryFocusRef.current = true
              setRetrySourceRefreshing(false)
            })
          }
        }
      }
    )
  }

  const toggleBookmark = (
    item: (typeof result.items)[number],
    isBookmarked: boolean
  ): void => {
    const { question } = item
    if (
      isResultSourceUnavailable ||
      role === 'GUEST' ||
      !question.questionVersionId ||
      !question.tagSummaries
    ) {
      setBookmarkMessage({
        code: 'unavailable',
        questionId: question.id
      })
      return
    }
    setBookmarkMessage(null)
    if (isBookmarked) {
      deleteBookmark.mutate(question.id, {
        onSuccess: () =>
          setBookmarkMessage({
            code: 'removed',
            questionId: question.id
          }),
        onError: (error) => {
          if (!isAuthTransitionSupersededError(error)) {
            setBookmarkMessage({
              code: 'removeFailed',
              questionId: question.id
            })
          }
        }
      })
      return
    }
    const characters = [...question.questionText]
    const optimisticBookmark: BookmarkSummary = {
      questionId: question.id,
      question: {
        id: question.id,
        questionVersionId: question.questionVersionId,
        level: question.level,
        subject: question.subject,
        questionType: question.questionType,
        difficulty: question.difficulty,
        questionTextPreview:
          characters.length <= 160
            ? question.questionText
            : `${characters.slice(0, 157).join('')}...`,
        tags: question.tagSummaries
      },
      availability: 'AVAILABLE',
      createdAt: new Date().toISOString()
    }
    createBookmark.mutate(
      { questionId: question.id, optimisticBookmark },
      {
        onSuccess: () =>
          setBookmarkMessage({
            code: 'saved',
            questionId: question.id
          }),
        onError: (error) => {
          if (!isAuthTransitionSupersededError(error)) {
            setBookmarkMessage({
              code: 'saveFailed',
              questionId: question.id
            })
          }
        }
      }
    )
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
      {isResultSourceUnavailable ? (
        <div
          className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          role={
            resultQuery.isError || sessionQuery.isError ? 'alert' : 'status'
          }
        >
          <p className="font-semibold">
            {t(
              resultQuery.fetchStatus === 'paused' ||
                sessionQuery.fetchStatus === 'paused'
                ? 'error.cachedOffline'
                : 'error.staleDescription'
            )}
          </p>
          {resultQuery.isError || sessionQuery.isError ? (
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              onClick={() => {
                shouldRestoreRetryFocusRef.current = true
                void Promise.all([
                  resultQuery.refetch(),
                  sessionQuery.refetch()
                ])
              }}
            >
              {commonT('actions.retry')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="rounded-2xl bg-slate-950 p-6 text-white sm:p-9">
        <div className="flex flex-wrap gap-2">
          <Badge variant="brand">{session.level}</Badge>
          <Badge>{commonT(`taxonomy.subjects.${session.subject}`)}</Badge>
        </div>
        <h1
          ref={summaryHeadingRef}
          className="mt-6 rounded-sm text-3xl font-black sm:text-4xl"
          tabIndex={-1}
        >
          {t('name')}
        </h1>
        <p className="mt-3 text-slate-300">{t('description')}</p>

        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-slate-700 sm:grid-cols-5">
          <div className="bg-slate-900 p-4">
            <dt className="text-xs text-slate-400">{t('metrics.total')}</dt>
            <dd className="mt-1 text-2xl font-black">
              {formatCount(result.totalCount)}
            </dd>
          </div>
          <div className="bg-slate-900 p-4">
            <dt className="text-xs text-slate-400">{t('metrics.correct')}</dt>
            <dd className="mt-1 text-2xl font-black text-emerald-300">
              {formatCount(result.correctCount)}
            </dd>
          </div>
          <div className="bg-slate-900 p-4">
            <dt className="text-xs text-slate-400">{t('metrics.incorrect')}</dt>
            <dd className="mt-1 text-2xl font-black text-red-300">
              {formatCount(result.incorrectCount)}
            </dd>
          </div>
          <div className="bg-slate-900 p-4">
            <dt className="text-xs text-slate-400">{t('metrics.accuracy')}</dt>
            <dd className="mt-1 text-2xl font-black">
              {formatNumber(result.correctRate, locale, {
                maximumFractionDigits: 2
              })}
              %
            </dd>
          </div>
          <div className="col-span-2 bg-slate-900 p-4 sm:col-span-1">
            <dt className="text-xs text-slate-400">{t('metrics.duration')}</dt>
            <dd className="mt-1 text-lg font-black">
              {formatDuration(result.durationSec)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-6 flex flex-col gap-3 rounded-xl border border-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-6 text-muted">
          {role === 'GUEST'
            ? t('status.guest')
            : t('status.savedWrongCount', {
                formattedCount: formatCount(incorrectItems.length)
              })}
        </p>
        <div className="flex flex-wrap gap-2">
          {incorrectItems.length > 0 &&
          canRequestCanonicalRetry &&
          !isNoEligibleQuestionsApiError(createRetrySession.error) ? (
            <Button
              variant="outline"
              disabled={isResultSourceUnavailable}
              isLoading={
                createRetrySession.isPending || isRetrySourceRefreshing
              }
              loadingLabel={
                isRetrySourceRefreshing
                  ? t('retry.checking')
                  : createRetrySession.isPaused
                    ? t('retry.waitingConnection')
                    : t('retry.creating')
              }
              onClick={handleRetryIncorrect}
            >
              {t('actions.retryIncorrect')}
            </Button>
          ) : null}
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-control bg-ink px-4 py-2.5 text-sm font-semibold text-on-accent shadow-control hover:bg-ink/90 focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
            to={
              role === 'GUEST'
                ? `/login?redirect=${encodeURIComponent('/practice')}`
                : '/wrong-notes'
            }
          >
            {role === 'GUEST'
              ? t('actions.loginChoice')
              : t('actions.openWrongNotes')}
          </Link>
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-control bg-brand px-4 py-2.5 text-sm font-semibold text-on-accent shadow-control hover:bg-brand-strong focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
            to="/practice"
          >
            {t('newPractice')}
          </Link>
        </div>
      </div>

      {isNoEligibleQuestionsApiError(createRetrySession.error) ? (
        <EmptyState
          autoFocus
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50"
          title={t('retry.noEligibleTitle')}
          description={t('retry.noEligibleDescription')}
          action={
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-control bg-brand px-4 py-2.5 text-sm font-semibold text-on-accent shadow-control hover:bg-brand-strong focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
              to="/practice"
            >
              {t('newPractice')}
            </Link>
          }
        />
      ) : incorrectItems.length > 0 && !canRequestCanonicalRetry ? (
        <p
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
          role="status"
        >
          {t('retry.unsupported')}
        </p>
      ) : incorrectItems.length === 0 ? (
        <EmptyState
          className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50"
          title={t('retry.allCorrectTitle')}
          description={t('retry.allCorrectDescription')}
          action={
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-control bg-brand px-4 py-2.5 text-sm font-semibold text-on-accent shadow-control hover:bg-brand-strong focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
              to="/practice"
            >
              {t('newPractice')}
            </Link>
          }
        />
      ) : createRetrySession.isPaused ? (
        <p
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
          role="status"
          aria-live="polite"
        >
          {t('retry.offline')}
        </p>
      ) : createRetrySession.isError &&
        !isStudyResultNotReadyApiError(createRetrySession.error) &&
        !isAuthTransitionSupersededError(createRetrySession.error) ? (
        <div
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          <p className="font-bold">{t('retry.errorTitle')}</p>
          <p className="mt-1 leading-6">{t('retry.errorDescription')}</p>
        </div>
      ) : retryMessage ? (
        <p
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
          role="status"
          aria-live="polite"
        >
          {t(`retry.${retryMessage}`)}
        </p>
      ) : null}

      <div className="mt-10 space-y-5">
        <h2 className="text-2xl font-black">{t('items.title')}</h2>
        {bookmarkMutationActivity.isPaused ? (
          <p
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
            role="status"
            aria-live="polite"
          >
            {t('bookmark.offline')}
          </p>
        ) : null}
        {role !== 'GUEST' && bookmarksQuery.fetchStatus === 'paused' ? (
          <p
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
            role="status"
          >
            {t('bookmark.loadOffline')}
          </p>
        ) : role !== 'GUEST' && bookmarksQuery.isError ? (
          <div
            className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"
            role="alert"
          >
            <span>{t('bookmark.loadError')}</span>
            <Button
              variant="outline"
              onClick={() => void bookmarksQuery.refetch()}
            >
              {t('bookmark.retry')}
            </Button>
          </div>
        ) : null}
        {result.items.map((item, index) => {
          const optionById = new Map(
            item.question.options.map((option) => [option.id, option])
          )
          const selectedOption = item.selectedOptionId
            ? optionById.get(item.selectedOptionId)
            : undefined
          const correctOption = optionById.get(item.correctOptionId)
          const isBookmarked = Boolean(
            bookmarksQuery.data?.items.some(
              (bookmark) => bookmark.questionId === item.question.id
            )
          )
          return (
            <article
              key={item.question.id}
              className="content-auto rounded-xl border border-line bg-white p-5 sm:p-7"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={item.isCorrect ? 'success' : 'danger'}>
                    {item.isCorrect ? t('items.correct') : t('items.incorrect')}
                  </Badge>
                  <Badge>
                    {t('items.ordinal', {
                      formattedOrdinal: formatCount(index + 1)
                    })}
                  </Badge>
                  {item.tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                </div>
                {role !== 'GUEST' ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="min-h-11 rounded-lg border border-line px-3 text-sm font-bold hover:border-slate-400 hover:bg-slate-50 data-[selected=true]:border-amber-500 data-[selected=true]:bg-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      type="button"
                      disabled={
                        hasPendingBookmarkMutation ||
                        isResultSourceUnavailable ||
                        bookmarksQuery.isPending ||
                        bookmarksQuery.isError ||
                        bookmarksQuery.fetchStatus === 'paused' ||
                        item.question.questionVersionId === null
                      }
                      aria-label={t(
                        isBookmarked
                          ? 'bookmark.removeLabel'
                          : 'bookmark.addLabel',
                        { formattedOrdinal: formatCount(index + 1) }
                      )}
                      aria-pressed={isBookmarked}
                      data-selected={isBookmarked}
                      onClick={() => toggleBookmark(item, isBookmarked)}
                    >
                      {isBookmarked ? t('bookmark.remove') : t('bookmark.add')}
                    </button>
                    {item.question.questionVersionId &&
                    !isResultSourceUnavailable ? (
                      <QuestionReportDialog
                        questionId={item.question.id}
                        questionVersionId={item.question.questionVersionId}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>

              {bookmarkMessage?.questionId === item.question.id ? (
                <p
                  className="mt-3 text-sm font-semibold text-amber-800"
                  role="status"
                >
                  {t(`bookmark.${bookmarkMessage.code}`)}
                </p>
              ) : null}

              {item.question.passage ? (
                <div
                  className="mt-5 border-l-4 border-slate-200 bg-slate-50 p-4 leading-7 text-slate-700"
                  lang="ja"
                >
                  {item.question.passage}
                </div>
              ) : null}
              <h3 className="mt-5 text-xl font-black leading-8" lang="ja">
                {item.question.questionText}
              </h3>

              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-4">
                  <dt className="text-xs font-bold text-muted">
                    {t('items.selectedAnswer')}
                  </dt>
                  <dd
                    className="mt-1 font-semibold"
                    lang={selectedOption ? 'ja' : undefined}
                  >
                    {selectedOption
                      ? `${selectedOption.label}. ${selectedOption.text}`
                      : t('items.unanswered')}
                  </dd>
                </div>
                <div className="rounded-lg bg-emerald-50 p-4">
                  <dt className="text-xs font-bold text-emerald-800">
                    {t('items.correctAnswer')}
                  </dt>
                  <dd
                    className="mt-1 font-semibold text-emerald-950"
                    lang={correctOption ? 'ja' : undefined}
                  >
                    {correctOption
                      ? `${correctOption.label}. ${correctOption.text}`
                      : t('items.correctAnswerUnavailable')}
                  </dd>
                </div>
              </dl>

              <div className="mt-5 border-t border-line pt-5">
                <h4 className="font-black">{t('items.explanation')}</h4>
                <div className="mt-3">
                  <ExplanationLanguagePanel
                    explanationJa={item.explanationJa}
                    explanationKo={item.explanationKo}
                  />
                </div>
              </div>
            </article>
          )
        })}
      </div>

      <Dialog
        open={retryNavigationBlocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && retryNavigationBlocker.state === 'blocked') {
            retryNavigationBlocker.reset()
          }
        }}
        title={t('blocker.title')}
        description={t('blocker.description')}
        preventClose
        footer={
          <Button
            variant="secondary"
            onClick={() => {
              if (retryNavigationBlocker.state === 'blocked') {
                retryNavigationBlocker.reset()
              }
            }}
          >
            {t('blocker.stay')}
          </Button>
        }
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
