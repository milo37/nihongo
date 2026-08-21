import { useEffect, useRef, useState } from 'react'
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
import { useAppStore } from '@store/index'
import {
  isAuthenticationBoundaryApiError,
  isNotFoundApiError
} from '@util/apiError'

const subjectLabels = {
  VOCABULARY: '문자·어휘',
  GRAMMAR: '문법',
  READING: '독해'
} as const

const modeLabels = {
  RANDOM: '랜덤',
  WRONG_NOTE: '오답',
  WEAKNESS: '약점 추천',
  BOOKMARK: '즐겨찾기',
  DAILY_REVIEW: '일일 복습'
} as const

const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

export const PracticeSessionPage = (): ReactElement => {
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
    questionId: string
    text: string
  } | null>(null)
  const [draftActionMessage, setDraftActionMessage] = useState<string | null>(
    null
  )
  const [isPreparingSubmission, setPreparingSubmission] = useState(false)
  const [isSavingBeforeNavigation, setSavingBeforeNavigation] = useState(false)
  const [verifiedGuestSessionId, setVerifiedGuestSessionId] = useState<
    string | null
  >(null)
  const [submissionConnectivityMessage, setSubmissionConnectivityMessage] =
    useState<string | null>(() =>
      typeof navigator !== 'undefined' && navigator.onLine === false
        ? '오프라인 상태입니다. 연결이 복구되면 동일 답안으로 다시 시도해 주세요.'
        : null
    )
  const sessionQuery = useGetStudySession(
    sessionId,
    isAuthReady && role === 'GUEST',
    isAuthReady
  )
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
    enabled: isEditableV2Session,
    expectedSessionQuestionIds,
    isInteractionPaused:
      isSubmitDialogOpen ||
      hasDraftConflict ||
      isNavigationPromptBlocked ||
      isPreparingSubmission ||
      sessionQuery.isError,
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
      setSubmissionConnectivityMessage(
        '오프라인 상태입니다. 연결이 복구되면 동일 답안으로 다시 시도해 주세요.'
      )
    }
    const handleOnline = (): void => {
      setSubmissionConnectivityMessage(
        '네트워크 연결이 복구되었습니다. 동일 답안으로 다시 시도할 수 있습니다.'
      )
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
    if (isV2Session) {
      draftController.moveToOrdinal(Math.max(1, safeQuestionIndex))
    } else {
      setCurrentQuestionIndex(Math.max(0, safeQuestionIndex - 1))
    }
  }

  const moveNext = (): void => {
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
        setDraftActionMessage(
          error instanceof Error
            ? error.message
            : '작업본을 저장하지 못해 현재 화면에 머뭅니다.'
        )
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
      title="작업본을 저장하고 이동할까요?"
      description="현재 문항의 답과 경과 시간을 서버에 저장한 뒤 요청한 화면으로 이동합니다."
      footer={
        <>
          <Button
            variant="secondary"
            disabled={isSavingBeforeNavigation}
            onClick={() => submissionNavigationBlocker.reset?.()}
          >
            계속 풀기
          </Button>
          <Button
            isLoading={isSavingBeforeNavigation}
            onClick={() => void handleSaveAndLeave()}
          >
            저장하고 이동
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
            title="이전 제출 결과 확인이 필요합니다"
            description="응답 손실 가능성이 있어 이 세션에서 이동하거나 답안을 바꿀 수 없습니다. 연결이 복구되면 세션 상태를 자동으로 다시 확인합니다."
            action={
              <div className="space-y-3">
                <Button onClick={() => void sessionQuery.refetch()}>
                  세션 상태 다시 확인
                </Button>
                <p
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950"
                  role="status"
                  aria-live="polite"
                >
                  {submissionConnectivityMessage ??
                    '세션 상태를 불러오는 중입니다. 결과를 확인할 때까지 이 화면에 머물러 주세요.'}
                </p>
              </div>
            }
          />
        </section>
      )
    }

    return <LoadingState message="문제를 준비하고 있습니다." />
  }

  if (sessionQuery.isError || !sessionQuery.data) {
    if (hasFrozenSubmissionAttempt) {
      return (
        <section className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
          <ErrorState
            autoFocus
            headingLevel={1}
            title="이전 제출 결과 확인이 필요합니다"
            description="응답 손실 가능성이 있어 이 세션에서 이동하거나 답안을 바꿀 수 없습니다. 네트워크 상태를 확인한 뒤 세션을 다시 불러와 동일 답안으로 계속해 주세요."
            action={
              <div className="space-y-3">
                <Button onClick={() => void sessionQuery.refetch()}>
                  세션 상태 다시 확인
                </Button>
                <p
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950"
                  role="status"
                  aria-live="polite"
                >
                  {submissionConnectivityMessage ??
                    '네트워크가 연결되어 있습니다. 세션 상태를 다시 확인해 주세요.'}
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
          title="학습 세션을 불러오지 못했습니다"
          description="세션 주소를 확인하거나 새 학습을 시작해 주세요."
          action={
            <Button onClick={() => void sessionQuery.refetch()}>
              다시 시도
            </Button>
          }
        />
        {navigationPrompt}
      </>
    )
  }

  if (!hasCurrentGuestOwnerProof) {
    return <LoadingState message="게스트 세션 소유권을 확인하고 있습니다." />
  }

  if (sessionQuery.data.session.status === 'SUBMITTED') {
    if (isNavigationPromptBlocked) {
      return <LoadingState message="제출 결과로 이동하고 있습니다." />
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
            ? '만료된 학습 세션입니다'
            : '취소된 학습 세션입니다'
        }
        description="새 RANDOM 학습을 시작해 주세요. 이 세션에는 답안을 제출할 수 없습니다."
        action={
          <Link
            className="inline-flex min-h-11 items-center px-1 font-bold text-brand underline hover:no-underline"
            to="/practice"
          >
            학습 설정으로 이동
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
          title="서버 작업본을 불러오지 못했습니다"
          description="답안을 화면에 복원하기 전에 세션 소유권과 최신 revision을 확인해야 합니다. 연결을 확인한 뒤 다시 시도해 주세요."
          action={
            <Button
              onClick={() =>
                void draftController.retrySave().catch(() => undefined)
              }
            >
              작업본 다시 확인
            </Button>
          }
        />
      )
    }
    return <LoadingState message="서버 작업본을 확인하고 있습니다." />
  }

  if (!currentQuestion) {
    return (
      <ErrorState
        autoFocus
        headingLevel={1}
        title="출제할 문제가 없습니다"
        description="다른 급수, 과목 또는 출제 모드를 선택해 주세요."
        action={
          <Link
            className="inline-flex min-h-11 items-center px-1 font-bold text-brand underline hover:no-underline"
            to="/practice"
          >
            학습 설정으로 이동
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
    role !== 'GUEST' && (bookmarksQuery.isPending || bookmarksQuery.isError)

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
    if (role === 'GUEST') {
      setBookmarkMessage({
        questionId: currentQuestion.id,
        text: '즐겨찾기를 저장하려면 로그인해 주세요.'
      })
      return
    }
    if (session.practiceContractVersion !== 2) {
      setBookmarkMessage({
        questionId: currentQuestion.id,
        text: '이전 계약 세션에서는 즐겨찾기를 변경할 수 없습니다.'
      })
      return
    }

    setBookmarkMessage(null)
    if (isBookmarked) {
      deleteBookmark.mutate(currentQuestion.id, {
        onSuccess: () =>
          setBookmarkMessage({
            questionId: currentQuestion.id,
            text: '즐겨찾기에서 해제했습니다.'
          }),
        onError: (error) => {
          if (!isAuthTransitionSupersededError(error)) {
            setBookmarkMessage({
              questionId: currentQuestion.id,
              text: '즐겨찾기 해제를 완료하지 못해 복원했습니다.'
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
            questionId: currentQuestion.id,
            text: '즐겨찾기에 저장했습니다.'
          }),
        onError: (error) => {
          if (!isAuthTransitionSupersededError(error)) {
            setBookmarkMessage({
              questionId: currentQuestion.id,
              text: '즐겨찾기를 저장하지 못해 이전 상태로 복원했습니다.'
            })
          }
        }
      }
    )
  }

  const completeSubmissionNavigation = (): void => {
    allowSubmissionNavigationRef.current = true
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
          setDraftActionMessage(
            '최신 서버 작업본을 확인했습니다. 충돌 항목을 확인한 뒤 다시 제출해 주세요.'
          )
          return
        }
        await sessionQuery.refetch()
      } catch (reconciliationError: unknown) {
        if (!isAuthTransitionSupersededError(reconciliationError)) {
          setDraftActionMessage(
            reconciliationError instanceof Error
              ? reconciliationError.message
              : '최신 세션 상태를 확인하지 못했습니다.'
          )
        }
      } finally {
        setPreparingSubmission(false)
      }
    })()
  }

  const handleSubmit = async (): Promise<void> => {
    if (isSubmissionActive || isPreparingSubmission || hasDraftConflict) {
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
          setDraftActionMessage(
            error instanceof Error
              ? error.message
              : '서버 작업본을 저장하지 못해 제출하지 않았습니다.'
          )
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

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
      <div className="grid gap-5 border-b border-line pb-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge>{session.level}</Badge>
            <Badge variant="neutral">{subjectLabels[session.subject]}</Badge>
            <Badge variant="brand">{modeLabels[session.mode]}</Badge>
          </div>
          <p className="mt-4 text-sm font-semibold text-muted">
            현재 {safeQuestionIndex + 1}번 / 전체 {questions.length}문제 · 답변{' '}
            {answeredCount}문제
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted">경과 시간</span>
          <strong className="font-mono text-lg">
            {formatDuration(elapsedSeconds)}
          </strong>
        </div>
      </div>

      {isV2Session ? (
        <div
          className="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold leading-6 text-sky-950"
          role="status"
          aria-live="polite"
          data-save-state={draftController.saveState}
        >
          <p>{draftController.statusMessage}</p>
          {isDraftConflictPending && !hasResolvedDraftConflict ? (
            <p className="mt-2 font-medium">
              최신 서버 작업본을 확인하는 동안 답안 저장과 제출을 잠시 멈춥니다.
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
                  setDraftActionMessage(
                    '작업본을 다시 저장하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.'
                  )
                })
              }}
            >
              작업본 저장 다시 시도
            </Button>
          ) : null}
        </div>
      ) : null}

      {draftActionMessage ? (
        <p
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold leading-6 text-red-900"
          role="alert"
        >
          {draftActionMessage}
        </p>
      ) : null}

      {actualCount < requestedCount || usedFallback ? (
        <div
          className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="status"
        >
          {actualCount < requestedCount
            ? `요청한 ${requestedCount}문제 중 ${modeLabels[session.mode]} 모드로 출제 가능한 ${actualCount}문제만 제공합니다. 다른 모드로 대체하지 않았습니다.`
            : session.practiceContractVersion === 1
              ? '레거시 세션에서 선택한 모드의 문제가 부족해 랜덤 문제를 함께 제공합니다.'
              : '서버 권위 세션은 다른 모드로 대체하지 않습니다.'}
        </div>
      ) : null}

      <div className="mt-5">
        <Progress
          label={`문제풀이 진행률 ${progressValue}%`}
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
          <article className="border-b border-line bg-slate-50 p-5 sm:p-8 lg:max-h-[680px] lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <p className="text-xs font-black tracking-[0.14em] text-brand">
              READING PASSAGE
            </p>
            <p className="sr-only">독해 지문</p>
            <p className="mt-5 whitespace-pre-line text-base leading-8 text-slate-800">
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
                hasPendingBookmarkMutation ||
                isBookmarkQueryUnavailable ||
                session.practiceContractVersion !== 2
              }
              aria-label={`${safeQuestionIndex + 1}번 문제 ${
                isBookmarked ? '즐겨찾기 해제' : '즐겨찾기 추가'
              }`}
              aria-pressed={isBookmarked}
              data-selected={isBookmarked}
              onClick={handleBookmark}
            >
              {isBookmarked ? '즐겨찾기 해제' : '즐겨찾기'}
            </button>
          </div>
          {(bookmarkMessage?.questionId === currentQuestion.id &&
            bookmarkMessage.text) ||
          bookmarkMutationActivity.isPaused ? (
            <p
              className="mt-3 text-sm font-semibold text-amber-800"
              role="status"
            >
              {bookmarkMutationActivity.isPaused
                ? '오프라인입니다. 연결되면 즐겨찾기 변경을 다시 시도합니다.'
                : bookmarkMessage?.text}{' '}
              {role === 'GUEST' ? (
                <Link
                  className="inline-flex min-h-11 items-center px-1 underline hover:no-underline"
                  to="/login?redirect=%2Fpractice"
                >
                  로그인 선택
                </Link>
              ) : null}
            </p>
          ) : null}
          {role !== 'GUEST' && bookmarksQuery.isError ? (
            <div
              className="mt-3 flex flex-wrap items-center gap-3 text-sm font-semibold text-red-700"
              role="alert"
            >
              <span>즐겨찾기 상태를 확인하지 못했습니다.</span>
              <Button
                variant="outline"
                onClick={() => void bookmarksQuery.refetch()}
              >
                다시 확인
              </Button>
            </div>
          ) : null}

          <h1
            ref={headingRef}
            className="mt-7 rounded-sm text-2xl font-black leading-10 sm:text-3xl"
            tabIndex={-1}
          >
            <span className="sr-only">{safeQuestionIndex + 1}번 문제. </span>
            {currentQuestion.questionText}
          </h1>

          <div className="mt-7">
            <RadioGroup
              disabled={
                isSubmitDialogOpen ||
                mustReplayFrozenSubmission ||
                hasDraftConflict ||
                isNavigationPromptBlocked ||
                isPreparingSubmission
              }
              name={`question-${currentQuestion.id}`}
              legend="정답 보기"
              value={displayedSelectedAnswers[currentQuestion.id] ?? ''}
              options={currentQuestion.options.map((option) => ({
                value: option.id,
                label: `${option.label}. ${option.text}`
              }))}
              onValueChange={handleSelectOption}
            />
          </div>
          <p className="mt-4 text-sm leading-6 text-muted">
            숫자 1–4로 답을 선택하고, ← → 키로 문제를 이동하며, 마지막 문제에서
            Ctrl+⏎ 또는 ⌘+⏎로 제출 확인을 열 수 있습니다.
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
            isPreparingSubmission
          }
          onClick={movePrevious}
        >
          이전
        </Button>
        {isLastQuestion ? (
          <Button
            ref={submitButtonRef}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            disabled={!canRequestSubmission}
            onClick={() => setSubmitDialogRequestedOpen(true)}
          >
            답안 제출
          </Button>
        ) : (
          <Button
            disabled={
              mustReplayFrozenSubmission ||
              hasDraftConflict ||
              isNavigationPromptBlocked ||
              isPreparingSubmission
            }
            onClick={moveNext}
          >
            다음
          </Button>
        )}
      </div>

      <nav className="mt-8" aria-label="문제 바로가기">
        <ol className="flex flex-wrap justify-center gap-2">
          {questions.map((question, index) => (
            <li key={question.id}>
              <button
                className="min-h-11 min-w-11 rounded-lg border border-line bg-white text-sm font-bold hover:border-slate-400 hover:bg-slate-50 data-[current=true]:border-brand data-[current=true]:bg-brand data-[current=true]:text-white data-[answered=true]:ring-2 data-[answered=true]:ring-emerald-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                type="button"
                disabled={
                  mustReplayFrozenSubmission ||
                  hasDraftConflict ||
                  isNavigationPromptBlocked ||
                  isPreparingSubmission
                }
                aria-label={`${index + 1}번 문제${displayedSelectedAnswers[question.id] ? ', 답변함' : ', 미응답'}`}
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
                {index + 1}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <Dialog
        open={isSubmitDialogOpen && !hasDraftConflict}
        title="답안을 제출하시겠습니까?"
        returnFocusRef={submitButtonRef}
        description={
          hasFrozenSubmissionAttempt
            ? '이전에 전송한 답안을 그대로 다시 제출합니다. 결과를 확인할 때까지 답안은 변경할 수 없습니다.'
            : unansweredCount > 0
              ? `아직 답하지 않은 문제가 ${unansweredCount}개 있습니다. 미응답은 오답으로 처리됩니다.`
              : '모든 문제에 답했습니다. 제출 후에는 답을 수정할 수 없습니다.'
        }
        footer={
          <>
            <Button
              variant="secondary"
              disabled={mustReplayFrozenSubmission}
              onClick={() => handleSubmitDialogOpenChange(false)}
            >
              계속 풀기
            </Button>
            <Button
              disabled={hasDraftConflict}
              isLoading={isSubmissionActive || isPreparingSubmission}
              onClick={() => void handleSubmit()}
            >
              제출하고 결과 보기
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
                  ? '결과를 확인하지 못했습니다. 네트워크 상태를 확인한 뒤 동일 답안으로 다시 시도해 주세요.'
                  : '제출 요청이 처리되지 않았습니다. 입력과 세션 상태를 확인한 뒤 다시 시도해 주세요.'}
              </div>
            ) : null}
            {hasFrozenSubmissionAttempt && submissionConnectivityMessage ? (
              <p
                className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"
                role="status"
                aria-live="polite"
              >
                {submissionConnectivityMessage}
              </p>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={hasResolvedDraftConflict}
        title="다른 기기의 작업과 충돌했습니다"
        description={`${draftController.conflictCount}개 항목의 변경이 서로 다릅니다. 자동으로 덮어쓰지 않고 선택한 기록을 기준으로 이어갑니다.`}
        returnFocusRef={draftConflictReturnFocusRef}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={draftController.resolveConflictWithServer}
            >
              서버 기록 사용
            </Button>
            <Button onClick={draftController.resolveConflictWithLocal}>
              내 변경 유지
            </Button>
          </>
        }
        preventClose
        onOpenChange={() => undefined}
      >
        <p className="text-sm leading-6 text-slate-700">
          서버 기록을 선택하면 이 탭의 충돌 변경을 버립니다. 내 변경을 선택하면
          최신 revision 위에 다시 저장합니다.
        </p>
      </Dialog>

      {navigationPrompt}
    </section>
  )
}
