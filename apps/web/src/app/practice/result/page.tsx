import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Link,
  useBlocker,
  useNavigate,
  useNavigationType,
  useLocation,
  useParams
} from 'react-router'
import type { ReactElement } from 'react'
import type { BookmarkSummary } from '@nihongo/contracts/bookmark/bookmark'
import {
  isAuthenticationBoundaryApiError,
  isNoEligibleQuestionsApiError,
  isNotFoundApiError,
  isStudyResultNotReadyApiError
} from '@libs/apiError'
import { ReviewCompletion } from '@app/practice/result/ReviewCompletion'
import {
  readReviewReturnContext,
  rememberCurrentResult
} from '@app/wrong-note/reviewReturnContext'
import { Badge } from '@common/components/Badge'
import { Button, getButtonClassName } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { EmptyState } from '@common/components/EmptyState'
import { ErrorState } from '@common/components/ErrorState'
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
import { ResultQuestionNavigation } from '@app/practice/result/ResultQuestionNavigation'
import { ResultQuestionDetail } from '@app/practice/result/ResultQuestionDetail'
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
  const location = useLocation()
  const summaryHeadingRef = useRef<HTMLHeadingElement>(null)
  const readyResultPathRef = useRef<string | null>(null)
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
    if (
      hasCurrentGuestOwnerProof &&
      isResultReady &&
      !resultQuery.isError &&
      !sessionQuery.isError &&
      sessionQuery.data?.session.status === 'SUBMITTED'
    ) {
      rememberCurrentResult(principalScope, sessionId)
    }
  }, [
    hasCurrentGuestOwnerProof,
    isResultReady,
    principalScope,
    sessionId,
    resultQuery.isError,
    sessionQuery.isError,
    sessionQuery.data
  ])

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
      sessionQuery.isSuccess
    ) {
      const isNewResultPath = readyResultPathRef.current !== location.pathname
      readyResultPathRef.current = location.pathname
      if (
        (isNewResultPath && navigationType !== 'POP') ||
        shouldRestoreRetryFocusRef.current
      ) {
        shouldRestoreRetryFocusRef.current = false
        summaryHeadingRef.current?.focus()
      }
    }
  }, [
    hasCurrentGuestOwnerProof,
    isAuthReady,
    isRetrySourceRefreshing,
    isResultReady,
    location.pathname,
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
  const selection = new URLSearchParams(location.search).get('question')
  const selectedIndex = Math.max(
    0,
    result.items.findIndex((item) => item.question.id === selection)
  )
  const selectedItem = result.items[selectedIndex]
  const selectedIsBookmarked = Boolean(
    selectedItem &&
      bookmarksQuery.data?.items.some(
        (bookmark) => bookmark.questionId === selectedItem.question.id
      )
  )
  const selectQuestion = (questionId: string): void => {
    if (!result.items.some((item) => item.question.id === questionId)) return
    const next = new URLSearchParams(location.search)
    next.set('question', questionId)
    void navigate(
      { search: next.toString(), hash: location.hash },
      { replace: true, preventScrollReset: true }
    )
  }
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

  if (
    role !== 'GUEST' &&
    session.practiceContractVersion === 2 &&
    session.mode === 'WRONG_NOTE' &&
    sessionQuery.data.requestedCount === 1 &&
    sessionQuery.data.actualCount === 1 &&
    !sessionQuery.data.usedFallback &&
    result.items.length === 1 &&
    readReviewReturnContext(principalScope, session.id)?.questionId ===
      result.items[0]?.question.id
  ) {
    return <ReviewCompletion item={result.items[0]!} session={session} />
  }

  return (
    <section className="learning-note study-page study-result mx-auto max-w-[760px] px-4 py-10 sm:px-6 lg:py-14">
      <div className="study-result-main">
        {isResultSourceUnavailable ? (
          <div
            className="mb-6 rounded-lg border border-warning-line bg-warning-soft p-4 text-sm text-warning-strong"
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
        <div className="study-result-summary border-b border-line pb-6">
          <div className="flex flex-wrap gap-2">
            <Badge variant="brand">{session.level}</Badge>
            <Badge>{commonT(`taxonomy.subjects.${session.subject}`)}</Badge>
          </div>
          <h1
            ref={summaryHeadingRef}
            className="mt-3 rounded-sm text-2xl font-black sm:text-3xl"
            tabIndex={-1}
          >
            {t('name')}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            {t('description')}
          </p>

          <p className="mt-5 text-lg font-bold">
            {t('outcomes', {
              correct: formatCount(result.correctCount),
              wrong: formatCount(
                result.items.filter(
                  (item) => !item.isCorrect && item.selectedOptionId !== null
                ).length
              ),
              unanswered: formatCount(
                result.items.filter((item) => item.selectedOptionId === null)
                  .length
              )
            })}
          </p>
          <p className="mt-2 text-sm leading-6 text-muted">
            {t('outcomesNote')}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a className={getButtonClassName()} href="#result-explanations">
              {t('reviewExplanations')}
            </a>
            <Link
              className="note-link"
              to={role === 'GUEST' ? '/' : '/dashboard?view=learning'}
            >
              {t('finish')}
            </Link>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div className="min-w-0">
              <dt className="text-xs text-muted">{t('metrics.total')}</dt>
              <dd className="mt-1 font-semibold">
                {formatCount(result.totalCount)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted">{t('metrics.correct')}</dt>
              <dd className="mt-1 font-semibold">
                {formatCount(result.correctCount)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted">{t('metrics.incorrect')}</dt>
              <dd className="mt-1 font-semibold">
                {formatCount(result.incorrectCount)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted">{t('metrics.accuracy')}</dt>
              <dd className="mt-1 font-semibold">
                {formatNumber(result.correctRate, locale, {
                  maximumFractionDigits: 2
                })}
                %
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted">{t('metrics.duration')}</dt>
              <dd className="mt-1 font-semibold">
                {formatDuration(result.durationSec)}
              </dd>
            </div>
          </dl>
        </div>

        {isNoEligibleQuestionsApiError(createRetrySession.error) ? (
          <EmptyState
            autoFocus
            className="mt-4 rounded-lg border border-warning-line bg-warning-soft"
            title={t('retry.noEligibleTitle')}
            description={t('retry.noEligibleDescription')}
            action={
              <Link className="note-link" to="/practice">
                {t('newPractice')}
              </Link>
            }
          />
        ) : incorrectItems.length > 0 && !canRequestCanonicalRetry ? (
          <p
            className="mt-4 rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-strong"
            role="status"
          >
            {t('retry.unsupported')}
          </p>
        ) : incorrectItems.length === 0 ? (
          <EmptyState
            className="mt-4 rounded-lg border border-success-line bg-success-soft"
            title={t('retry.allCorrectTitle')}
            description={t('retry.allCorrectDescription')}
            action={
              <Link className="note-link" to="/practice">
                {t('newPractice')}
              </Link>
            }
          />
        ) : createRetrySession.isPaused ? (
          <p
            className="mt-4 rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-strong"
            role="status"
            aria-live="polite"
          >
            {t('retry.offline')}
          </p>
        ) : createRetrySession.isError &&
          !isStudyResultNotReadyApiError(createRetrySession.error) &&
          !isAuthTransitionSupersededError(createRetrySession.error) ? (
          <div
            className="mt-4 rounded-lg border border-danger-line bg-danger-soft p-4 text-sm text-danger-strong"
            role="alert"
          >
            <p className="font-bold">{t('retry.errorTitle')}</p>
            <p className="mt-1 leading-6">{t('retry.errorDescription')}</p>
          </div>
        ) : retryMessage ? (
          <p
            className="mt-4 rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-strong"
            role="status"
            aria-live="polite"
          >
            {t(`retry.${retryMessage}`)}
          </p>
        ) : null}

        <div className="study-explanations mt-7 space-y-5">
          <h2
            id="result-explanations"
            className="scroll-mt-24 text-2xl font-black"
          >
            {t('items.title')}
          </h2>
          {bookmarkMutationActivity.isPaused ? (
            <p
              className="rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-strong"
              role="status"
              aria-live="polite"
            >
              {t('bookmark.offline')}
            </p>
          ) : null}
          {role !== 'GUEST' && bookmarksQuery.fetchStatus === 'paused' ? (
            <p
              className="rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-strong"
              role="status"
            >
              {t('bookmark.loadOffline')}
            </p>
          ) : role !== 'GUEST' && bookmarksQuery.isError ? (
            <div
              className="flex flex-wrap items-center gap-3 rounded-lg border border-danger-line bg-danger-soft p-4 text-sm font-semibold text-danger"
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
          {selectedItem ? (
            <div className="study-result-layout">
              <ResultQuestionNavigation
                items={result.items}
                selectedQuestionId={selectedItem.question.id}
                onSelect={selectQuestion}
              />
              <ResultQuestionDetail
                key={selectedItem.question.id}
                item={selectedItem}
                ordinal={selectedIndex + 1}
                canManage={role !== 'GUEST'}
                isBookmarked={selectedIsBookmarked}
                bookmarkDisabled={
                  hasPendingBookmarkMutation ||
                  isResultSourceUnavailable ||
                  bookmarksQuery.isPending ||
                  bookmarksQuery.isError ||
                  bookmarksQuery.fetchStatus === 'paused'
                }
                isResultSourceUnavailable={isResultSourceUnavailable}
                bookmarkMessage={
                  bookmarkMessage?.questionId === selectedItem.question.id
                    ? t(`bookmark.${bookmarkMessage.code}`)
                    : null
                }
                onToggleBookmark={() =>
                  toggleBookmark(selectedItem, selectedIsBookmarked)
                }
                actions={
                  <div className="study-result-actions mt-4 flex flex-col gap-3">
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
                      !isNoEligibleQuestionsApiError(
                        createRetrySession.error
                      ) ? (
                        <Button
                          size="lg"
                          disabled={isResultSourceUnavailable}
                          isLoading={
                            createRetrySession.isPending ||
                            isRetrySourceRefreshing
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
                        className={getButtonClassName({ variant: 'outline' })}
                        to="/bookmarks"
                      >
                        {t('navigation.openBookmarks')}
                      </Link>
                      <Link
                        className="note-link"
                        to={
                          role === 'GUEST'
                            ? `/login?redirect=${encodeURIComponent('/practice')}`
                            : `/wrong-notes?level=${session.level}&subject=${session.subject}&view=UNREVIEWED`
                        }
                      >
                        {role === 'GUEST'
                          ? t('actions.loginChoice')
                          : t('actions.openWrongNotes')}
                      </Link>
                      <Link
                        className="inline-flex min-h-11 items-center justify-center rounded-control px-4 py-2.5 text-sm font-semibold text-muted hover:bg-surface-muted focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
                        to="/practice"
                      >
                        {t('newPractice')}
                      </Link>
                    </div>
                  </div>
                }
              />
            </div>
          ) : (
            <EmptyState
              title={t('navigation.emptyTitle')}
              description={t('navigation.emptyDescription')}
            />
          )}
        </div>
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
