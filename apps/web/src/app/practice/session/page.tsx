import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Link,
  Navigate,
  useBlocker,
  useNavigate,
  useParams
} from 'react-router'
import type { ReactElement } from 'react'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { Progress } from '@common/components/Progress'
import { RadioGroup } from '@common/components/RadioGroup'
import { useBookmarkMutationActivity } from '@app/bookmark/hooks/useBookmarkMutationActivity'
import { useCreateBookmark } from '@app/bookmark/hooks/useCreateBookmark'
import { useDeleteBookmark } from '@app/bookmark/hooks/useDeleteBookmark'
import { useListBookmarks } from '@app/bookmark/hooks/useListBookmarks'
import type { BookmarkSummary } from '@nihongo/contracts/bookmark/bookmark'
import { useElapsedSeconds } from '@app/practice/hooks/useElapsedSeconds'
import { useClearGuestPracticeQueryCache } from '@app/practice/hooks/useClearGuestPracticeQueryCache'
import { useGetStudySession } from '@app/practice/hooks/useGetStudySession'
import { usePracticeDraftController } from '@app/practice/hooks/usePracticeDraftController'
import { usePracticeKeyboard } from '@app/practice/hooks/usePracticeKeyboard'
import {
  assertCurrentStudySubmissionAction,
  useSubmitStudySession
} from '@app/practice/hooks/useSubmitStudySession'
import {
  assertCurrentStudySubmissionV2Action,
  useSubmitStudySessionV2
} from '@app/practice/hooks/useSubmitStudySessionV2'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import {
  clearGuestStudyDraftWorkingCopies,
  clearStudyDraftWorkingCopy
} from '@app/practice/draft/studyDraftWorkingCopyStorage'
import { readStudyDraftSubmissionAttempt } from '@app/practice/studyDraftSubmissionAttempt'
import {
  clearSubmissionAttempt,
  hasStoredSubmissionAttempt,
  readStoredSubmissionLogicalRequest
} from '@app/practice/submissionAttemptStorage'
import {
  getStudySubmissionErrorCode,
  isDefinitiveStudySubmissionError
} from '@app/practice/studySubmissionRetry'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'
import { formatDateTime, formatNumber } from '@libs/localeFormatters'
import { useAppStore } from '@store/index'
import { resolveUiLocale } from '@/i18n/types'
import {
  isAuthenticationBoundaryApiError,
  isOfflineApiError,
  isNotFoundApiError
} from '@util/apiError'

type BookmarkNoticeCode =
  | 'loginRequired'
  | 'legacyReadOnly'
  | 'removed'
  | 'removeRollback'
  | 'saved'
  | 'saveRollback'

type DraftActionNoticeCode =
  | 'saveBeforeLeaveFailed'
  | 'conflictRefreshComplete'
  | 'sessionRefreshFailed'
  | 'submissionPreparationFailed'
  | 'retrySaveFailed'

type SubmissionConnectivityCode = 'offline' | 'restored'

export const PracticeSessionPage = (): ReactElement => {
  const { i18n, t } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const formatCount = (value: number): string => formatNumber(value, locale)
  const formatDuration = (seconds: number): string => {
    const options: Intl.NumberFormatOptions = {
      minimumIntegerDigits: 2,
      useGrouping: false
    }
    return `${formatNumber(Math.floor(seconds / 60), locale, options)}:${formatNumber(
      seconds % 60,
      locale,
      options
    )}`
  }
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const clearGuestPracticeQueryCache = useClearGuestPracticeQueryCache()
  const { isReady: isAuthReady, role, user } = useAuth()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const draftConflictReturnFocusRef = useRef<HTMLElement | null>(null)
  const submitButtonRef = useRef<HTMLButtonElement>(null)
  const [isSubmitDialogRequestedOpen, setSubmitDialogRequestedOpen] =
    useState(false)
  const [bookmarkMessage, setBookmarkMessage] = useState<{
    code: BookmarkNoticeCode
    questionId: string
  } | null>(null)
  const [draftActionMessage, setDraftActionMessage] =
    useState<DraftActionNoticeCode | null>(null)
  const [isPreparingSubmission, setPreparingSubmission] = useState(false)
  const [isSubmissionNavigationStarted, setSubmissionNavigationStarted] =
    useState(false)
  const [isSavingBeforeNavigation, setSavingBeforeNavigation] = useState(false)
  const [verifiedGuestSessionId, setVerifiedGuestSessionId] = useState<
    string | null
  >(null)
  const [submissionConnectivityMessage, setSubmissionConnectivityMessage] =
    useState<SubmissionConnectivityCode | null>(() =>
      typeof navigator !== 'undefined' && navigator.onLine === false
        ? 'offline'
        : null
    )
  const sessionQuery = useGetStudySession(
    sessionId,
    isAuthReady && role === 'GUEST',
    isAuthReady
  )
  const isSessionRefreshUnavailable =
    sessionQuery.isError || sessionQuery.fetchStatus === 'paused'
  const submitSession = useSubmitStudySession(sessionId)
  const hasCurrentGuestOwnerProof =
    isAuthReady && (role !== 'GUEST' || verifiedGuestSessionId === sessionId)
  const isCanonicalSessionBoundaryTerminal =
    (Boolean(sessionQuery.data) &&
      sessionQuery.data?.session.status !== 'IN_PROGRESS') ||
    (sessionQuery.isError && isNotFoundApiError(sessionQuery.error))
  const isV2Session = sessionQuery.data?.session.practiceContractVersion === 2
  const isEditableV2Session =
    isV2Session &&
    sessionQuery.data?.session.status === 'IN_PROGRESS' &&
    hasCurrentGuestOwnerProof &&
    !isCanonicalSessionBoundaryTerminal
  const principalScope = getStudyDraftPrincipalScope(user)
  const submitSessionV2 = useSubmitStudySessionV2(sessionId, principalScope)
  const hasResolvedDraftConflict = useAppStore((state) =>
    Boolean(state.draftConflict)
  )
  const isDraftConflictPending = useAppStore(
    (state) => state.isDraftConflictPending
  )
  const hasDraftConflict = hasResolvedDraftConflict || isDraftConflictPending
  const isScopedDraftReady = useAppStore(
    (state) =>
      state.draftWorkingCopy?.principalScope === principalScope &&
      state.draftWorkingCopy.sessionId === sessionId
  )
  const allowSubmissionNavigationRef = useRef(false)
  const isSubmissionActive = isV2Session
    ? submitSessionV2.isPending || submitSessionV2.isPaused
    : submitSession.isPending || submitSession.isPaused
  const submissionError = isV2Session
    ? submitSessionV2.error
    : submitSession.error
  const isSubmissionError = isV2Session
    ? submitSessionV2.isError
    : submitSession.isError
  const frozenLogicalRequest = readStoredSubmissionLogicalRequest(sessionId)
  const frozenV2Attempt = readStudyDraftSubmissionAttempt(sessionId)
  const hasRawFrozenSubmissionAttempt =
    hasStoredSubmissionAttempt(sessionId) ||
    (isSubmissionError &&
      !isAuthTransitionSupersededError(submissionError) &&
      !isDefinitiveStudySubmissionError(submissionError))
  const hasFrozenSubmissionAttempt =
    hasRawFrozenSubmissionAttempt && !isCanonicalSessionBoundaryTerminal
  const terminalSettlementKey =
    sessionQuery.isError && isNotFoundApiError(sessionQuery.error)
      ? `${sessionId}:NOT_FOUND`
      : sessionQuery.data?.session.status &&
          sessionQuery.data.session.status !== 'IN_PROGRESS'
        ? `${sessionId}:${sessionQuery.data.session.status}`
        : null
  const terminalSettlementRef = useRef<string | null>(null)
  const isSubmitDialogOpen =
    isSubmitDialogRequestedOpen || hasFrozenSubmissionAttempt
  const mustReplayFrozenSubmission =
    !isCanonicalSessionBoundaryTerminal &&
    (isSubmissionActive || hasRawFrozenSubmissionAttempt)
  const mustBlockNavigation =
    mustReplayFrozenSubmission || (isEditableV2Session && isScopedDraftReady)
  const submissionNavigationBlocker = useBlocker(
    () => mustBlockNavigation && !allowSubmissionNavigationRef.current
  )
  const isNavigationPromptBlocked =
    submissionNavigationBlocker.state === 'blocked'
  const expectedSessionQuestionIds =
    sessionQuery.data?.questions.flatMap((question) =>
      question.sessionQuestionId ? [question.sessionQuestionId] : []
    ) ?? []
  const draftController = usePracticeDraftController({
    enabled: isEditableV2Session && !isSubmissionNavigationStarted,
    expectedSessionQuestionIds,
    isInteractionPaused:
      isSubmitDialogOpen ||
      hasDraftConflict ||
      isNavigationPromptBlocked ||
      isPreparingSubmission ||
      isSessionRefreshUnavailable,
    sessionId,
    user
  })
  const createBookmark = useCreateBookmark()
  const deleteBookmark = useDeleteBookmark()
  const bookmarkMutationActivity = useBookmarkMutationActivity()
  const bookmarkQuestionIds =
    sessionQuery.data?.session.practiceContractVersion === 2
      ? sessionQuery.data.questions.map((question) => question.id).toSorted()
      : []
  const bookmarksQuery = useListBookmarks(
    {
      page: 1,
      pageSize: 20,
      ...(bookmarkQuestionIds.length > 0
        ? { questionIds: bookmarkQuestionIds }
        : {})
    },
    role !== 'GUEST' && bookmarkQuestionIds.length > 0
  )
  const storedSessionId = useAppStore((state) => state.sessionId)
  const storedCurrentQuestionIndex = useAppStore(
    (state) => state.currentQuestionIndex
  )
  const selectedAnswers = useAppStore((state) => state.selectedAnswers)
  const startedAt = useAppStore((state) => state.startedAt)
  const beginPractice = useAppStore((state) => state.beginPractice)
  const setCurrentQuestionIndex = useAppStore(
    (state) => state.setCurrentQuestionIndex
  )
  const selectAnswer = useAppStore((state) => state.selectAnswer)
  const resetPractice = useAppStore((state) => state.resetPractice)
  const legacyElapsedSeconds = useElapsedSeconds(startedAt)

  useEffect(() => {
    let nextVerifiedSessionId: string | null | undefined
    if (!isAuthReady || role !== 'GUEST') {
      nextVerifiedSessionId = null
    }
    if (
      nextVerifiedSessionId === undefined &&
      sessionQuery.isSuccess &&
      sessionQuery.isFetchedAfterMount &&
      sessionQuery.data.session.id === sessionId
    ) {
      nextVerifiedSessionId = sessionId
    }
    if (
      nextVerifiedSessionId === undefined &&
      sessionQuery.isError &&
      isAuthenticationBoundaryApiError(sessionQuery.error)
    ) {
      nextVerifiedSessionId = null
    }
    if (nextVerifiedSessionId === undefined) {
      return
    }

    let active = true
    queueMicrotask(() => {
      if (active) {
        setVerifiedGuestSessionId((current) =>
          current === nextVerifiedSessionId ? current : nextVerifiedSessionId
        )
      }
    })
    return () => {
      active = false
    }
  }, [
    isAuthReady,
    role,
    sessionId,
    sessionQuery.data,
    sessionQuery.error,
    sessionQuery.isError,
    sessionQuery.isFetchedAfterMount,
    sessionQuery.isSuccess
  ])

  useEffect(() => {
    if (!mustBlockNavigation) {
      allowSubmissionNavigationRef.current = isCanonicalSessionBoundaryTerminal
      if (submissionNavigationBlocker.state === 'blocked') {
        if (isCanonicalSessionBoundaryTerminal) {
          submissionNavigationBlocker.reset()
        } else {
          submissionNavigationBlocker.reset()
        }
      }
    }
  }, [
    isCanonicalSessionBoundaryTerminal,
    mustBlockNavigation,
    submissionNavigationBlocker
  ])

  useEffect(() => {
    if (!mustReplayFrozenSubmission) {
      return
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [mustReplayFrozenSubmission])

  useEffect(() => {
    const handleOffline = (): void => {
      setSubmissionConnectivityMessage('offline')
    }
    const handleOnline = (): void => {
      setSubmissionConnectivityMessage('restored')
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  useEffect(() => {
    if (!terminalSettlementKey) {
      terminalSettlementRef.current = null
      return
    }
    if (terminalSettlementRef.current === terminalSettlementKey) {
      return
    }
    terminalSettlementRef.current = terminalSettlementKey
    allowSubmissionNavigationRef.current = true
    clearSubmissionAttempt(sessionId)
    clearStudyDraftWorkingCopy(principalScope, sessionId)
    if (role === 'GUEST' && terminalSettlementKey.endsWith(':NOT_FOUND')) {
      clearGuestStudyDraftWorkingCopies()
      clearGuestPracticeQueryCache()
    }
    if (submitSession.isError || submitSession.isPending) {
      submitSession.reset()
    }
    if (submitSessionV2.isError || submitSessionV2.isPending) {
      submitSessionV2.reset()
    }
    resetPractice()
  }, [
    principalScope,
    clearGuestPracticeQueryCache,
    role,
    resetPractice,
    sessionId,
    submitSession,
    submitSessionV2,
    terminalSettlementKey
  ])

  const questions = sessionQuery.data?.questions ?? []
  const currentQuestionIndex = isV2Session
    ? draftController.currentOrdinal - 1
    : storedCurrentQuestionIndex
  const safeQuestionIndex =
    questions.length > 0
      ? Math.min(currentQuestionIndex, questions.length - 1)
      : 0
  const isLastQuestion =
    questions.length > 0 && safeQuestionIndex === questions.length - 1
  const currentQuestion = questions[safeQuestionIndex]
  const canFocusCurrentQuestion =
    !sessionQuery.isPending &&
    !sessionQuery.isError &&
    Boolean(sessionQuery.data) &&
    hasCurrentGuestOwnerProof &&
    sessionQuery.data?.session.status === 'IN_PROGRESS' &&
    (!isV2Session || draftController.isReady) &&
    Boolean(currentQuestion)
  const v2Answers =
    frozenV2Attempt?.canonicalBody.answers ??
    draftController.snapshot?.answers ??
    []
  const v2AnswersBySessionQuestionId = new Map(
    v2Answers.map((answer) => [
      answer.studySessionQuestionId,
      answer.selectedOptionId
    ])
  )
  const displayedSelectedAnswers = isV2Session
    ? Object.fromEntries(
        questions.flatMap((question) => {
          const selectedOptionId = question.sessionQuestionId
            ? v2AnswersBySessionQuestionId.get(question.sessionQuestionId)
            : null
          return selectedOptionId ? [[question.id, selectedOptionId]] : []
        })
      )
    : frozenLogicalRequest
      ? Object.fromEntries(
          frozenLogicalRequest.answers.map((answer) => [
            answer.questionId,
            answer.selectedOptionId
          ])
        )
      : selectedAnswers
  const elapsedSeconds = isV2Session
    ? (frozenV2Attempt?.canonicalBody.durationSec ??
      draftController.elapsedSeconds)
    : legacyElapsedSeconds
  const answeredCount = questions.reduce(
    (count, question) =>
      displayedSelectedAnswers[question.id] ? count + 1 : count,
    0
  )
  const unansweredCount = Math.max(0, questions.length - answeredCount)

  useEffect(() => {
    if (!sessionQuery.data || isV2Session || storedSessionId === sessionId) {
      return
    }

    beginPractice(sessionId, sessionQuery.data.session.startedAt)
  }, [
    beginPractice,
    isV2Session,
    sessionId,
    sessionQuery.data,
    storedSessionId
  ])

  useEffect(() => {
    if (canFocusCurrentQuestion && !isNavigationPromptBlocked) {
      headingRef.current?.focus()
    }
  }, [canFocusCurrentQuestion, currentQuestion?.id, isNavigationPromptBlocked])

  useEffect(() => {
    draftConflictReturnFocusRef.current = null
  }, [currentQuestion?.id])

  const movePrevious = (): void => {
    if (isSessionRefreshUnavailable) return
    if (isV2Session) {
      draftController.moveToOrdinal(Math.max(1, safeQuestionIndex))
    } else {
      setCurrentQuestionIndex(Math.max(0, safeQuestionIndex - 1))
    }
  }

  const moveNext = (): void => {
    if (isSessionRefreshUnavailable) return
    if (isV2Session) {
      draftController.moveToOrdinal(
        Math.min(questions.length, safeQuestionIndex + 2)
      )
    } else {
      setCurrentQuestionIndex(
        Math.min(Math.max(questions.length - 1, 0), safeQuestionIndex + 1)
      )
    }
  }

  const handleSelectOption = (optionId: string): void => {
    if (
      currentQuestion &&
      !isSubmitDialogOpen &&
      !mustReplayFrozenSubmission &&
      !isNavigationPromptBlocked &&
      !isPreparingSubmission &&
      !isSessionRefreshUnavailable &&
      sessionQuery.data?.session.status === 'IN_PROGRESS'
    ) {
      if (document.activeElement instanceof HTMLElement) {
        draftConflictReturnFocusRef.current = document.activeElement
      }
      if (isV2Session && currentQuestion.sessionQuestionId) {
        draftController.selectOption(
          currentQuestion.sessionQuestionId,
          optionId
        )
      } else {
        selectAnswer(currentQuestion.id, optionId)
      }
    }
  }

  const canRequestSubmission =
    isLastQuestion &&
    !isSubmitDialogOpen &&
    !mustReplayFrozenSubmission &&
    !hasDraftConflict &&
    !isNavigationPromptBlocked &&
    !isPreparingSubmission &&
    !isSubmissionActive &&
    !isSessionRefreshUnavailable &&
    draftController.isReady &&
    sessionQuery.data?.session.status === 'IN_PROGRESS' &&
    (!isV2Session || draftController.saveState !== 'saving')

  usePracticeKeyboard({
    enabled:
      !isSubmitDialogOpen &&
      !mustReplayFrozenSubmission &&
      !hasDraftConflict &&
      !isNavigationPromptBlocked &&
      !isPreparingSubmission &&
      !isSubmissionActive &&
      !isSessionRefreshUnavailable &&
      draftController.isReady &&
      sessionQuery.data?.session.status === 'IN_PROGRESS',
    optionIds: currentQuestion?.options.map((option) => option.id) ?? [],
    onSelectOption: handleSelectOption,
    onPrevious: movePrevious,
    onNext: moveNext,
    onSubmit: () => setSubmitDialogRequestedOpen(true),
    submitEnabled: canRequestSubmission
  })

  const handleSaveAndLeave = async (): Promise<void> => {
    if (submissionNavigationBlocker.state !== 'blocked') {
      return
    }
    setSavingBeforeNavigation(true)
    setDraftActionMessage(null)
    try {
      await draftController.flush()
      allowSubmissionNavigationRef.current = true
      submissionNavigationBlocker.proceed()
    } catch (error: unknown) {
      if (!isAuthTransitionSupersededError(error)) {
        setDraftActionMessage('saveBeforeLeaveFailed')
      }
    } finally {
      setSavingBeforeNavigation(false)
    }
  }

  const navigationPrompt = (
    <Dialog
      open={
        submissionNavigationBlocker.state === 'blocked' &&
        isV2Session &&
        !mustReplayFrozenSubmission
      }
      title={t('session.navigationGuard.title')}
      description={t('session.navigationGuard.description')}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={isSavingBeforeNavigation}
            onClick={() => submissionNavigationBlocker.reset?.()}
          >
            {t('session.navigationGuard.continue')}
          </Button>
          <Button
            isLoading={isSavingBeforeNavigation}
            onClick={() => void handleSaveAndLeave()}
          >
            {t('session.navigationGuard.saveAndLeave')}
          </Button>
        </>
      }
      preventClose={isSavingBeforeNavigation}
      onOpenChange={(open) => {
        if (!open && !isSavingBeforeNavigation) {
          submissionNavigationBlocker.reset?.()
        }
      }}
    />
  )

  if (sessionQuery.isPending) {
    if (hasFrozenSubmissionAttempt) {
      return (
        <section className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
          <ErrorState
            autoFocus
            headingLevel={1}
            title={t('session.recovery.title')}
            description={t('session.recovery.pendingDescription')}
            action={
              <div className="space-y-3">
                <Button onClick={() => void sessionQuery.refetch()}>
                  {t('session.recovery.retry')}
                </Button>
                <p
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950"
                  role="status"
                  aria-live="polite"
                >
                  {submissionConnectivityMessage
                    ? t(
                        `session.submit.connectivity.${submissionConnectivityMessage}`
                      )
                    : t('session.recovery.checkingStatus')}
                </p>
              </div>
            }
          />
        </section>
      )
    }

    if (sessionQuery.fetchStatus === 'paused') {
      return (
        <ErrorState
          autoFocus
          headingLevel={1}
          title={t('session.errors.sessionLoadTitle')}
          description={t('session.errors.offlineSessionDescription')}
        />
      )
    }

    return <LoadingState message={t('session.loading.questions')} />
  }

  if (!sessionQuery.data) {
    if (hasFrozenSubmissionAttempt) {
      return (
        <section className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
          <ErrorState
            autoFocus
            headingLevel={1}
            title={t('session.recovery.title')}
            description={t('session.recovery.failedDescription')}
            action={
              <div className="space-y-3">
                <Button onClick={() => void sessionQuery.refetch()}>
                  {t('session.recovery.retry')}
                </Button>
                <p
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950"
                  role="status"
                  aria-live="polite"
                >
                  {submissionConnectivityMessage
                    ? t(
                        `session.submit.connectivity.${submissionConnectivityMessage}`
                      )
                    : t('session.recovery.connectedStatus')}
                </p>
              </div>
            }
          />
        </section>
      )
    }

    return (
      <>
        <ErrorState
          autoFocus
          headingLevel={1}
          title={t('session.errors.sessionLoadTitle')}
          description={
            sessionQuery.isError && isOfflineApiError(sessionQuery.error)
              ? t('session.errors.offlineSessionDescription')
              : t('session.errors.sessionLoadDescription')
          }
          action={
            <Button onClick={() => void sessionQuery.refetch()}>
              {commonT('actions.retry')}
            </Button>
          }
        />
        {navigationPrompt}
      </>
    )
  }

  if (!hasCurrentGuestOwnerProof) {
    if (sessionQuery.fetchStatus === 'paused') {
      return (
        <ErrorState
          autoFocus
          headingLevel={1}
          title={t('session.errors.sessionLoadTitle')}
          description={t('session.errors.offlineSessionDescription')}
        />
      )
    }

    if (sessionQuery.isError) {
      return (
        <ErrorState
          autoFocus
          headingLevel={1}
          title={t('session.errors.sessionLoadTitle')}
          description={t('session.errors.sessionLoadDescription')}
          action={
            <Button onClick={() => void sessionQuery.refetch()}>
              {commonT('actions.retry')}
            </Button>
          }
        />
      )
    }

    return <LoadingState message={t('session.loading.guestOwnership')} />
  }

  if (sessionQuery.data.session.status === 'SUBMITTED') {
    if (isNavigationPromptBlocked) {
      return <LoadingState message={t('session.loading.resultRedirect')} />
    }
    return <Navigate replace to={`/practice/result/${sessionId}`} />
  }

  if (sessionQuery.data.session.status !== 'IN_PROGRESS') {
    return (
      <ErrorState
        autoFocus
        headingLevel={1}
        title={
          sessionQuery.data.session.status === 'EXPIRED'
            ? t('session.terminal.expiredTitle')
            : t('session.terminal.cancelledTitle')
        }
        description={t('session.terminal.description')}
        action={
          <Link
            className="inline-flex min-h-11 items-center px-1 font-bold text-brand underline hover:no-underline"
            to="/practice"
          >
            {t('session.terminal.openSetup')}
          </Link>
        }
      />
    )
  }

  if (isV2Session && !draftController.isReady) {
    if (
      draftController.draftQuery.isError ||
      draftController.saveState === 'error'
    ) {
      return (
        <ErrorState
          autoFocus
          headingLevel={1}
          title={t('session.errors.draftLoadTitle')}
          description={t('session.errors.draftLoadDescription')}
          action={
            <Button
              onClick={() =>
                void draftController.retrySave().catch(() => undefined)
              }
            >
              {t('session.recovery.retry')}
            </Button>
          }
        />
      )
    }
    return <LoadingState message={t('session.loading.draft')} />
  }

  if (!currentQuestion) {
    return (
      <ErrorState
        autoFocus
        headingLevel={1}
        title={t('session.errors.emptyTitle')}
        description={t('session.errors.emptyDescription')}
        action={
          <Link
            className="inline-flex min-h-11 items-center px-1 font-bold text-brand underline hover:no-underline"
            to="/practice"
          >
            {t('session.terminal.openSetup')}
          </Link>
        }
      />
    )
  }

  const { session, requestedCount, actualCount, usedFallback } =
    sessionQuery.data
  const progressValue = Math.round(
    ((safeQuestionIndex + 1) / questions.length) * 100
  )
  const isBookmarked = Boolean(
    bookmarksQuery.data?.items.some(
      (bookmark) => bookmark.questionId === currentQuestion.id
    )
  )
  const hasPendingBookmarkMutation =
    bookmarkMutationActivity.pendingQuestionIds.size > 0
  const isBookmarkQueryUnavailable =
    role !== 'GUEST' &&
    (bookmarksQuery.isPending ||
      bookmarksQuery.isError ||
      bookmarksQuery.fetchStatus === 'paused')

  const toOptimisticBookmark = (): BookmarkSummary | undefined => {
    if (!currentQuestion.questionVersionId || !currentQuestion.tagSummaries) {
      return undefined
    }
    const characters = [...currentQuestion.questionText]
    return {
      questionId: currentQuestion.id,
      question: {
        id: currentQuestion.id,
        questionVersionId: currentQuestion.questionVersionId,
        level: currentQuestion.level,
        subject: currentQuestion.subject,
        questionType: currentQuestion.questionType,
        difficulty: currentQuestion.difficulty,
        questionTextPreview:
          characters.length <= 160
            ? currentQuestion.questionText
            : `${characters.slice(0, 157).join('')}...`,
        tags: currentQuestion.tagSummaries
      },
      availability: 'AVAILABLE',
      createdAt: new Date().toISOString()
    }
  }

  const handleBookmark = (): void => {
    if (isSessionRefreshUnavailable) return
    if (role === 'GUEST') {
      setBookmarkMessage({
        code: 'loginRequired',
        questionId: currentQuestion.id
      })
      return
    }
    if (session.practiceContractVersion !== 2) {
      setBookmarkMessage({
        code: 'legacyReadOnly',
        questionId: currentQuestion.id
      })
      return
    }

    setBookmarkMessage(null)
    if (isBookmarked) {
      deleteBookmark.mutate(currentQuestion.id, {
        onSuccess: () =>
          setBookmarkMessage({
            code: 'removed',
            questionId: currentQuestion.id
          }),
        onError: (error) => {
          if (!isAuthTransitionSupersededError(error)) {
            setBookmarkMessage({
              code: 'removeRollback',
              questionId: currentQuestion.id
            })
          }
        }
      })
      return
    }

    createBookmark.mutate(
      {
        questionId: currentQuestion.id,
        optimisticBookmark: toOptimisticBookmark()
      },
      {
        onSuccess: () =>
          setBookmarkMessage({
            code: 'saved',
            questionId: currentQuestion.id
          }),
        onError: (error) => {
          if (!isAuthTransitionSupersededError(error)) {
            setBookmarkMessage({
              code: 'saveRollback',
              questionId: currentQuestion.id
            })
          }
        }
      }
    )
  }

  const completeSubmissionNavigation = (): void => {
    allowSubmissionNavigationRef.current = true
    setSubmissionNavigationStarted(true)
    if (submissionNavigationBlocker.state === 'blocked') {
      submissionNavigationBlocker.reset()
    }
    setSubmitDialogRequestedOpen(false)
    resetPractice()
    void navigate(`/practice/result/${sessionId}`)
  }

  const handleSubmissionFailure = (error: unknown): void => {
    if (isAuthTransitionSupersededError(error)) {
      return
    }
    const errorCode = getStudySubmissionErrorCode(error)
    if (
      errorCode !== 'RESOURCE_NOT_FOUND' &&
      errorCode !== 'STUDY_SESSION_NOT_EDITABLE' &&
      errorCode !== 'DRAFT_VERSION_CONFLICT' &&
      errorCode !== 'DRAFT_SUBMIT_MISMATCH'
    ) {
      return
    }

    setPreparingSubmission(true)
    void (async (): Promise<void> => {
      try {
        if (
          errorCode === 'DRAFT_VERSION_CONFLICT' ||
          errorCode === 'DRAFT_SUBMIT_MISMATCH'
        ) {
          await draftController.retrySave()
          setDraftActionMessage('conflictRefreshComplete')
          return
        }
        await sessionQuery.refetch()
      } catch (reconciliationError: unknown) {
        if (!isAuthTransitionSupersededError(reconciliationError)) {
          setDraftActionMessage('sessionRefreshFailed')
        }
      } finally {
        setPreparingSubmission(false)
      }
    })()
  }

  const handleSubmit = async (): Promise<void> => {
    if (
      isSubmissionActive ||
      isPreparingSubmission ||
      hasDraftConflict ||
      isSessionRefreshUnavailable
    ) {
      return
    }

    setDraftActionMessage(null)

    if (isV2Session) {
      setPreparingSubmission(true)
      try {
        const prepared = frozenV2Attempt
          ? frozenV2Attempt.canonicalBody
          : await draftController.prepareSubmission()
        submitSessionV2.mutate(prepared, {
          onSuccess: (_result, input) => {
            assertCurrentStudySubmissionV2Action(input)
            completeSubmissionNavigation()
          },
          onError: handleSubmissionFailure
        })
      } catch (error: unknown) {
        if (!isAuthTransitionSupersededError(error)) {
          setDraftActionMessage('submissionPreparationFailed')
        }
      } finally {
        setPreparingSubmission(false)
      }
      return
    }

    const elapsedPerQuestion = Math.floor(
      elapsedSeconds / Math.max(questions.length, 1)
    )
    submitSession.mutate(
      frozenLogicalRequest ?? {
        durationSec: elapsedSeconds,
        answers: questions.flatMap((question) => {
          const selectedOptionId = displayedSelectedAnswers[question.id]

          return selectedOptionId
            ? [
                {
                  questionId: question.id,
                  selectedOptionId,
                  elapsedSec: elapsedPerQuestion
                }
              ]
            : []
        })
      },
      {
        onSuccess: (_result, input) => {
          assertCurrentStudySubmissionAction(input)
          completeSubmissionNavigation()
        },
        onError: handleSubmissionFailure
      }
    )
  }

  const handleSubmitDialogOpenChange = (open: boolean): void => {
    if (!open && mustReplayFrozenSubmission) {
      return
    }

    setSubmitDialogRequestedOpen(open)
  }

  const draftStatusMessage = t(
    `session.draft.status.${draftController.status.code}`,
    draftController.status.savedAt
      ? {
          time: formatDateTime(draftController.status.savedAt, locale, {
            hour: '2-digit',
            minute: '2-digit'
          })
        }
      : undefined
  )
  const isDraftActionInformational =
    draftActionMessage === 'conflictRefreshComplete'

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
      <div className="grid gap-5 border-b border-line pb-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge>{session.level}</Badge>
            <Badge variant="neutral">
              {commonT(`taxonomy.subjects.${session.subject}`)}
            </Badge>
            <Badge variant="brand">
              {commonT(`taxonomy.studyModes.${session.mode}`)}
            </Badge>
          </div>
          <p className="mt-4 text-sm font-semibold text-muted">
            {t('session.header.progressSummary', {
              answered: formatCount(answeredCount),
              current: formatCount(safeQuestionIndex + 1),
              total: formatCount(questions.length)
            })}
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted">{t('session.header.elapsedTime')}</span>
          <strong className="font-mono text-lg">
            {formatDuration(elapsedSeconds)}
          </strong>
        </div>
      </div>

      {sessionQuery.fetchStatus === 'paused' ? (
        <p
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-950"
          role="status"
        >
          {t('session.errors.cachedOfflineDescription')}
        </p>
      ) : sessionQuery.isError ? (
        <div
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          <p className="font-semibold">
            {t('session.errors.staleSessionDescription')}
          </p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            onClick={() => void sessionQuery.refetch()}
          >
            {t('session.errors.retrySession')}
          </Button>
        </div>
      ) : null}

      {isV2Session ? (
        <div
          className="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold leading-6 text-sky-950"
          role="status"
          aria-live="polite"
          data-save-state={draftController.saveState}
        >
          <p>{draftStatusMessage}</p>
          {isDraftConflictPending && !hasResolvedDraftConflict ? (
            <p className="mt-2 font-medium">
              {t('session.draft.conflictCheckPending')}
            </p>
          ) : null}
          {draftController.saveState === 'error' ||
          draftController.saveState === 'offline' ? (
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              onClick={() => {
                setDraftActionMessage(null)
                void draftController.retrySave().catch(() => {
                  setDraftActionMessage('retrySaveFailed')
                })
              }}
            >
              {t('session.draft.retry')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {draftActionMessage ? (
        <p
          className={`mt-4 rounded-lg border px-4 py-3 text-sm font-semibold leading-6 ${
            isDraftActionInformational
              ? 'border-info-line bg-info-soft text-info-strong'
              : 'border-danger-line bg-danger-soft text-danger-strong'
          }`}
          role={isDraftActionInformational ? 'status' : 'alert'}
        >
          {t(`session.draft.notices.${draftActionMessage}`)}
        </p>
      ) : null}

      {actualCount < requestedCount || usedFallback ? (
        <div
          className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="status"
        >
          {actualCount < requestedCount
            ? t('session.supply.canonicalPartial', {
                actual: formatCount(actualCount),
                mode: commonT(`taxonomy.studyModes.${session.mode}`),
                requested: formatCount(requestedCount)
              })
            : session.practiceContractVersion === 1
              ? t('session.supply.legacyFallback')
              : t('session.supply.canonicalNoFallback')}
        </div>
      ) : null}

      <div className="mt-5">
        <Progress
          label={t('session.progressLabel', {
            percent: formatCount(progressValue)
          })}
          value={progressValue}
        />
      </div>

      <div
        className={[
          'mt-6 overflow-hidden rounded-2xl border border-line bg-white shadow-soft',
          currentQuestion.subject === 'READING'
            ? 'lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]'
            : ''
        ].join(' ')}
      >
        {currentQuestion.passage ? (
          <article
            aria-label={t('session.question.passageLabel')}
            className="border-b border-line bg-slate-50 p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-brand sm:p-8 lg:max-h-[680px] lg:overflow-y-auto lg:border-b-0 lg:border-r"
            tabIndex={0}
          >
            <p className="text-xs font-black tracking-[0.14em] text-brand">
              {t('session.question.passageEyebrow')}
            </p>
            <p className="sr-only">{t('session.question.passageLabel')}</p>
            <p
              className="mt-5 whitespace-pre-line text-base leading-8 text-slate-800"
              lang="ja"
            >
              {currentQuestion.passage}
            </p>
          </article>
        ) : null}

        <article className="p-5 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              {currentQuestion.tags.map((tag) => (
                <Badge key={tag} variant="neutral">
                  {tag}
                </Badge>
              ))}
            </div>
            <button
              className="min-h-11 shrink-0 rounded-lg border border-line px-3 text-sm font-bold hover:border-slate-400 hover:bg-slate-50 data-[selected=true]:border-amber-500 data-[selected=true]:bg-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              type="button"
              disabled={
                mustReplayFrozenSubmission ||
                isNavigationPromptBlocked ||
                isPreparingSubmission ||
                isSessionRefreshUnavailable ||
                hasPendingBookmarkMutation ||
                isBookmarkQueryUnavailable ||
                session.practiceContractVersion !== 2
              }
              aria-label={t(
                isBookmarked
                  ? 'session.bookmark.removeLabel'
                  : 'session.bookmark.addLabel',
                { ordinal: formatCount(safeQuestionIndex + 1) }
              )}
              aria-pressed={isBookmarked}
              data-selected={isBookmarked}
              onClick={handleBookmark}
            >
              {isBookmarked
                ? t('session.bookmark.remove')
                : t('session.bookmark.add')}
            </button>
          </div>
          {bookmarkMessage?.questionId === currentQuestion.id ||
          bookmarkMutationActivity.isPaused ? (
            <p
              className="mt-3 text-sm font-semibold text-amber-800"
              role="status"
            >
              {bookmarkMutationActivity.isPaused
                ? t('session.bookmark.offlineQueued')
                : bookmarkMessage
                  ? t(`session.bookmark.${bookmarkMessage.code}`)
                  : null}{' '}
              {role === 'GUEST' ? (
                <Link
                  className="inline-flex min-h-11 items-center px-1 underline hover:no-underline"
                  to="/login?redirect=%2Fpractice"
                >
                  {t('session.bookmark.chooseLogin')}
                </Link>
              ) : null}
            </p>
          ) : null}
          {role !== 'GUEST' && bookmarksQuery.fetchStatus === 'paused' ? (
            <p
              className="mt-3 text-sm font-semibold text-amber-800"
              role="status"
            >
              {t('session.bookmark.statusLoadOffline')}
            </p>
          ) : role !== 'GUEST' && bookmarksQuery.isError ? (
            <div
              className="mt-3 flex flex-wrap items-center gap-3 text-sm font-semibold text-red-700"
              role="alert"
            >
              <span>{t('session.bookmark.statusLoadFailed')}</span>
              <Button
                variant="outline"
                onClick={() => void bookmarksQuery.refetch()}
              >
                {t('session.bookmark.retryStatus')}
              </Button>
            </div>
          ) : null}

          <h1
            ref={headingRef}
            className="mt-7 rounded-sm text-2xl font-black leading-10 sm:text-3xl"
            tabIndex={-1}
          >
            <span className="sr-only">
              {t('session.question.numberLabel', {
                ordinal: formatCount(safeQuestionIndex + 1)
              })}{' '}
            </span>
            <span lang="ja">{currentQuestion.questionText}</span>
          </h1>

          <div className="mt-7">
            <RadioGroup
              disabled={
                isSubmitDialogOpen ||
                mustReplayFrozenSubmission ||
                hasDraftConflict ||
                isNavigationPromptBlocked ||
                isPreparingSubmission ||
                isSessionRefreshUnavailable
              }
              name={`question-${currentQuestion.id}`}
              legend={t('session.question.answerLegend')}
              value={displayedSelectedAnswers[currentQuestion.id] ?? ''}
              options={currentQuestion.options.map((option) => ({
                value: option.id,
                label: (
                  <span lang="ja">
                    {option.label}. {option.text}
                  </span>
                )
              }))}
              onValueChange={handleSelectOption}
            />
          </div>
          <p className="mt-4 text-sm leading-6 text-muted">
            {t('session.question.keyboardHint')}
          </p>
        </article>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <Button
          variant="secondary"
          disabled={
            safeQuestionIndex === 0 ||
            mustReplayFrozenSubmission ||
            hasDraftConflict ||
            isNavigationPromptBlocked ||
            isPreparingSubmission ||
            isSessionRefreshUnavailable
          }
          onClick={movePrevious}
        >
          {t('session.navigation.previous')}
        </Button>
        {isLastQuestion ? (
          <Button
            ref={submitButtonRef}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            disabled={!canRequestSubmission}
            onClick={() => setSubmitDialogRequestedOpen(true)}
          >
            {t('session.navigation.submit')}
          </Button>
        ) : (
          <Button
            disabled={
              mustReplayFrozenSubmission ||
              hasDraftConflict ||
              isNavigationPromptBlocked ||
              isPreparingSubmission ||
              isSessionRefreshUnavailable
            }
            onClick={moveNext}
          >
            {t('session.navigation.next')}
          </Button>
        )}
      </div>

      <nav className="mt-8" aria-label={t('session.navigation.jumpLabel')}>
        <ol className="flex flex-wrap justify-center gap-2">
          {questions.map((question, index) => (
            <li key={question.id}>
              <button
                className="ui-question-jump min-h-11 min-w-11 rounded-lg border border-line bg-white text-sm font-bold hover:border-slate-400 hover:bg-slate-50 data-[current=true]:border-brand data-[current=true]:bg-brand data-[current=true]:text-white data-[answered=true]:ring-2 data-[answered=true]:ring-emerald-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                type="button"
                disabled={
                  mustReplayFrozenSubmission ||
                  hasDraftConflict ||
                  isNavigationPromptBlocked ||
                  isPreparingSubmission ||
                  isSessionRefreshUnavailable
                }
                aria-label={t(
                  displayedSelectedAnswers[question.id]
                    ? 'session.navigation.jumpQuestionAnswered'
                    : 'session.navigation.jumpQuestionUnanswered',
                  { ordinal: formatCount(index + 1) }
                )}
                aria-current={index === safeQuestionIndex ? 'step' : undefined}
                data-current={index === safeQuestionIndex}
                data-answered={Boolean(displayedSelectedAnswers[question.id])}
                onClick={() => {
                  if (isV2Session) {
                    draftController.moveToOrdinal(index + 1)
                  } else {
                    setCurrentQuestionIndex(index)
                  }
                }}
              >
                {formatCount(index + 1)}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <Dialog
        open={isSubmitDialogOpen && !hasDraftConflict}
        title={t('session.submit.title')}
        returnFocusRef={submitButtonRef}
        description={
          hasFrozenSubmissionAttempt
            ? t('session.submit.frozenDescription')
            : unansweredCount > 0
              ? t('session.submit.unansweredDescription', {
                  unanswered: formatCount(unansweredCount)
                })
              : t('session.submit.completeDescription')
        }
        footer={
          <>
            <Button
              variant="secondary"
              disabled={mustReplayFrozenSubmission}
              onClick={() => handleSubmitDialogOpenChange(false)}
            >
              {t('session.submit.continue')}
            </Button>
            <Button
              disabled={hasDraftConflict || isSessionRefreshUnavailable}
              isLoading={isSubmissionActive || isPreparingSubmission}
              onClick={() => void handleSubmit()}
            >
              {t('session.submit.confirm')}
            </Button>
          </>
        }
        preventClose={mustReplayFrozenSubmission}
        onOpenChange={handleSubmitDialogOpenChange}
      >
        {isSubmissionError ||
        (hasFrozenSubmissionAttempt && submissionConnectivityMessage) ? (
          <div className="space-y-3">
            {isSubmissionError ? (
              <div
                className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900"
                role="alert"
              >
                {hasFrozenSubmissionAttempt
                  ? t('session.submit.frozenFailure')
                  : t('session.submit.requestFailure')}
              </div>
            ) : null}
            {hasFrozenSubmissionAttempt && submissionConnectivityMessage ? (
              <p
                className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"
                role="status"
                aria-live="polite"
              >
                {t(
                  `session.submit.connectivity.${submissionConnectivityMessage}`
                )}
              </p>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={hasResolvedDraftConflict}
        title={t('session.conflict.title')}
        description={t('session.conflict.description', {
          conflicts: formatCount(draftController.conflictCount)
        })}
        returnFocusRef={draftConflictReturnFocusRef}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={draftController.resolveConflictWithServer}
            >
              {t('session.conflict.useServer')}
            </Button>
            <Button onClick={draftController.resolveConflictWithLocal}>
              {t('session.conflict.keepLocal')}
            </Button>
          </>
        }
        preventClose
        onOpenChange={() => undefined}
      >
        <p className="text-sm leading-6 text-slate-700">
          {t('session.conflict.detail')}
        </p>
      </Dialog>

      {navigationPrompt}
    </section>
  )
}
