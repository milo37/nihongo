import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useBlocker, useNavigate } from 'react-router'
import { useGetStudySession } from '@app/practice/hooks/useGetStudySession'
import { useGuestSessionOwnerProof } from '@app/practice/hooks/useGuestSessionOwnerProof'
import { usePracticeDraftController } from '@app/practice/hooks/usePracticeDraftController'
import { usePracticeKeyboard } from '@app/practice/hooks/usePracticeKeyboard'
import { usePracticeSessionBookmark } from '@app/practice/hooks/usePracticeSessionBookmark'
import { useSubmissionConnectivity } from '@app/practice/hooks/useSubmissionConnectivity'
import {
  assertCurrentStudySubmissionV2Action,
  useSubmitStudySessionV2
} from '@app/practice/hooks/useSubmitStudySessionV2'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { clearStudyDraftWorkingCopy } from '@nihongo/browser/app/practice/draft/studyDraftWorkingCopyStorage'
import { readStudyDraftSubmissionAttempt } from '@app/practice/studyDraftSubmissionAttempt'
import {
  clearSubmissionAttempt,
  hasStoredSubmissionAttempt
} from '@nihongo/browser/app/practice/submissionAttemptStorage'
import {
  getStudySubmissionErrorCode,
  isDefinitiveStudySubmissionError
} from '@app/practice/studySubmissionRetry'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { isAuthTransitionSupersededError } from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import {
  isNotFoundApiError,
  isOfflineApiError,
  isRetiredPracticeApiError
} from '@libs/apiError'
import { analyticsClient } from '@/analytics/client'

export type DraftActionNoticeCode =
  | 'saveBeforeLeaveFailed'
  | 'conflictRefreshComplete'
  | 'sessionRefreshFailed'
  | 'submissionPreparationFailed'
  | 'retrySaveFailed'

const COMPACT_DRAFT_STATUS_CODES = [
  'synced',
  'saved',
  'savedAt',
  'dirty',
  'saving'
]
const INLINE_DRAFT_STATUS_CODES = [
  'synced',
  'saved',
  'savedAt',
  'reconciled',
  'dirty',
  'saving',
  'error',
  'offline'
]

type UsePracticeSessionControllerInput = {
  headingRef: RefObject<HTMLHeadingElement | null>
  sessionId: string
}

export const usePracticeSessionController = ({
  headingRef,
  sessionId
}: UsePracticeSessionControllerInput) => {
  const navigate = useNavigate()
  const { isReady: isAuthReady, role, user } = useAuth()
  const [isSubmitDialogRequestedOpen, setSubmitDialogRequestedOpen] =
    useState(false)
  const [draftActionMessage, setDraftActionMessage] =
    useState<DraftActionNoticeCode | null>(null)
  const [isPreparingSubmission, setPreparingSubmission] = useState(false)
  const [isSubmissionNavigationStarted, setSubmissionNavigationStarted] =
    useState(false)
  const [isSavingBeforeNavigation, setSavingBeforeNavigation] = useState(false)
  const submissionConnectivityMessage = useSubmissionConnectivity()
  const sessionQuery = useGetStudySession(
    sessionId,
    isAuthReady && role === 'GUEST',
    isAuthReady
  )
  const hasCurrentGuestOwnerProof = useGuestSessionOwnerProof({
    isAuthReady,
    role,
    sessionId,
    sessionQuery
  })
  const isSessionRefreshUnavailable =
    sessionQuery.isError || sessionQuery.fetchStatus === 'paused'
  const isCanonicalSessionBoundaryTerminal =
    (Boolean(sessionQuery.data) &&
      sessionQuery.data?.session.status !== 'IN_PROGRESS') ||
    (sessionQuery.isError && isNotFoundApiError(sessionQuery.error))
  const isV2Session = sessionQuery.data?.session.practiceContractVersion === 2
  const isRetiredSession = sessionQuery.isError
    ? isRetiredPracticeApiError(sessionQuery.error)
    : sessionQuery.data?.session.practiceContractVersion === 1
  const isSessionNotFound =
    sessionQuery.isError && isNotFoundApiError(sessionQuery.error)
  const isSessionOffline =
    sessionQuery.isError && isOfflineApiError(sessionQuery.error)
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
  const isSubmissionActive =
    submitSessionV2.isPending || submitSessionV2.isPaused
  const submissionError = submitSessionV2.error
  const isSubmissionError = submitSessionV2.isError
  const frozenV2Attempt = readStudyDraftSubmissionAttempt(sessionId)
  const hasRawFrozenSubmissionAttempt =
    hasStoredSubmissionAttempt(sessionId) ||
    (isSubmissionError &&
      !isAuthTransitionSupersededError(submissionError) &&
      !isDefinitiveStudySubmissionError(submissionError))
  const hasFrozenSubmissionAttempt =
    hasRawFrozenSubmissionAttempt &&
    !isCanonicalSessionBoundaryTerminal &&
    !isRetiredSession
  const terminalSettlementKey =
    sessionQuery.isSuccess &&
    isV2Session &&
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
    !isRetiredSession &&
    (mustReplayFrozenSubmission || (isEditableV2Session && isScopedDraftReady))
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
  const bookmark = usePracticeSessionBookmark({
    role,
    sessionData: sessionQuery.data
  })
  const resetPractice = useAppStore((state) => state.resetPractice)

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
    if (!terminalSettlementKey) {
      if (
        sessionQuery.isSuccess &&
        sessionQuery.data?.session.status === 'IN_PROGRESS'
      ) {
        terminalSettlementRef.current = null
      }
      return
    }
    if (terminalSettlementRef.current === terminalSettlementKey) {
      return
    }
    terminalSettlementRef.current = terminalSettlementKey
    allowSubmissionNavigationRef.current = true
    clearSubmissionAttempt(sessionId)
    clearStudyDraftWorkingCopy(principalScope, sessionId)
    if (submitSessionV2.isError || submitSessionV2.isPending) {
      submitSessionV2.reset()
    }
    resetPractice()
  }, [
    principalScope,
    resetPractice,
    sessionId,
    sessionQuery.data,
    sessionQuery.isSuccess,
    submitSessionV2,
    terminalSettlementKey
  ])

  const questions = sessionQuery.data?.questions ?? []
  const currentQuestionIndex = draftController.currentOrdinal - 1
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
    draftController.isReady &&
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
  const displayedSelectedAnswers: Record<string, string> = Object.fromEntries(
    questions.flatMap((question) => {
      const selectedOptionId = question.sessionQuestionId
        ? v2AnswersBySessionQuestionId.get(question.sessionQuestionId)
        : null
      return selectedOptionId ? [[question.id, selectedOptionId]] : []
    })
  )
  const elapsedSeconds =
    frozenV2Attempt?.canonicalBody.durationSec ?? draftController.elapsedSeconds
  const answeredCount = questions.reduce(
    (count, question) =>
      displayedSelectedAnswers[question.id] ? count + 1 : count,
    0
  )
  const unansweredCount = Math.max(0, questions.length - answeredCount)

  useEffect(() => {
    if (canFocusCurrentQuestion && !isNavigationPromptBlocked) {
      headingRef.current?.focus()
    }
  }, [
    canFocusCurrentQuestion,
    currentQuestion?.id,
    headingRef,
    isNavigationPromptBlocked
  ])

  const movePrevious = (): void => {
    if (isSessionRefreshUnavailable) return
    draftController.moveToOrdinal(Math.max(1, safeQuestionIndex))
  }

  const moveNext = (): void => {
    if (isSessionRefreshUnavailable) return
    draftController.moveToOrdinal(
      Math.min(questions.length, safeQuestionIndex + 2)
    )
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
      const isFirstAnswer = !displayedSelectedAnswers[currentQuestion.id]
      if (currentQuestion.sessionQuestionId) {
        draftController.selectOption(
          currentQuestion.sessionQuestionId,
          optionId
        )
      }
      if (isFirstAnswer) {
        analyticsClient.track({
          event: 'question_answered',
          payload: { ordinal: currentQuestion.ordinal }
        })
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
    draftController.saveState !== 'saving'

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

  // A guest's work is not kept, so leaving needs no save first (U4 G3).
  const leaveWithoutSaving = (): void => {
    if (submissionNavigationBlocker.state !== 'blocked') return
    allowSubmissionNavigationRef.current = true
    submissionNavigationBlocker.proceed()
  }

  const cancelNavigation = (): void => {
    submissionNavigationBlocker.reset?.()
  }

  const handleBookmark = (): void => {
    if (isSessionRefreshUnavailable || !currentQuestion) return
    bookmark.toggle(currentQuestion)
  }

  const retryDraftSave = (): void => {
    setDraftActionMessage(null)
    void draftController.retrySave().catch(() => {
      setDraftActionMessage('retrySaveFailed')
    })
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
      errorCode !== 'STUDY_SESSION_NOT_EDITABLE'
    ) {
      return
    }

    setPreparingSubmission(true)
    void (async (): Promise<void> => {
      try {
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
  }

  const handleSubmitDialogOpenChange = (open: boolean): void => {
    if (!open && mustReplayFrozenSubmission) {
      return
    }

    setSubmitDialogRequestedOpen(open)
  }

  const hasUnresolvedConflictCheck =
    isDraftConflictPending && !hasResolvedDraftConflict
  const isCompactDraftStatus =
    COMPACT_DRAFT_STATUS_CODES.includes(draftController.status.code) &&
    !hasUnresolvedConflictCheck
  const isInlineDraftStatus =
    INLINE_DRAFT_STATUS_CODES.includes(draftController.status.code) &&
    !hasUnresolvedConflictCheck
  // Controls that freeze while a submission, conflict, or navigation decision is open.
  const isQuestionNavigationLocked =
    mustReplayFrozenSubmission ||
    hasDraftConflict ||
    isNavigationPromptBlocked ||
    isPreparingSubmission ||
    isSessionRefreshUnavailable

  const isBackNavigationDisabled =
    mustReplayFrozenSubmission ||
    isNavigationPromptBlocked ||
    isPreparingSubmission
  const isBookmarkDisabled =
    isBackNavigationDisabled ||
    isSessionRefreshUnavailable ||
    bookmark.hasPendingMutation ||
    bookmark.isQueryUnavailable
  const isNavigationGuardOpen =
    submissionNavigationBlocker.state === 'blocked' &&
    isV2Session &&
    !mustReplayFrozenSubmission

  return {
    answeredCount,
    bookmark,
    canRequestSubmission,
    cancelNavigation,
    currentQuestion,
    displayedSelectedAnswers,
    draftActionMessage,
    draftController,
    elapsedSeconds,
    handleBookmark,
    handleSaveAndLeave,
    leaveWithoutSaving,
    handleSelectOption,
    handleSubmit,
    handleSubmitDialogOpenChange,
    hasCurrentGuestOwnerProof,
    hasDraftConflict,
    hasFrozenSubmissionAttempt,
    hasUnresolvedConflictCheck,
    isBackNavigationDisabled,
    isBookmarkDisabled,
    isCompactDraftStatus,
    isInlineDraftStatus,
    isLastQuestion,
    isNavigationGuardOpen,
    isNavigationPromptBlocked,
    isPreparingSubmission,
    isQuestionNavigationLocked,
    isRetiredSession,
    isSavingBeforeNavigation,
    isSessionNotFound,
    isSessionOffline,
    isSessionRefreshUnavailable,
    isSubmissionActive,
    isSubmissionError,
    isSubmitDialogOpen,
    isV2Session,
    moveNext,
    movePrevious,
    moveToOrdinal: draftController.moveToOrdinal,
    mustReplayFrozenSubmission,
    openSubmitDialog: () => setSubmitDialogRequestedOpen(true),
    questions,
    retryDraftSave,
    role,
    safeQuestionIndex,
    sessionQuery,
    submissionConnectivityMessage,
    unansweredCount
  }
}

export type PracticeSessionController = ReturnType<
  typeof usePracticeSessionController
>
