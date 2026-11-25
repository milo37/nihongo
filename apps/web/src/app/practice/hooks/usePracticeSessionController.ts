import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useBlocker, useNavigate } from 'react-router'
import { useGetStudySession } from '@app/practice/hooks/useGetStudySession'
import { useGuestSessionOwnerProof } from '@app/practice/hooks/useGuestSessionOwnerProof'
import { usePracticeDraftController } from '@app/practice/hooks/usePracticeDraftController'
import { usePracticeKeyboard } from '@app/practice/hooks/usePracticeKeyboard'
import { usePracticeSessionBookmark } from '@app/practice/hooks/usePracticeSessionBookmark'
import {
  assertCurrentStudySubmissionV2Action,
  useSubmitStudySessionV2
} from '@app/practice/hooks/useSubmitStudySessionV2'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { clearStudyDraftWorkingCopy } from '@nihongo/browser/app/practice/draft/studyDraftWorkingCopyStorage'
import { getStudySubmissionErrorCode } from '@app/practice/studySubmissionRetry'
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

type UsePracticeSessionControllerInput = {
  headingRef: RefObject<HTMLHeadingElement | null>
  /** #1234: where a question card starts (its passage, else its number). */
  stageRef: RefObject<HTMLElement | null>
  sessionId: string
}

export const usePracticeSessionController = ({
  headingRef,
  stageRef,
  sessionId
}: UsePracticeSessionControllerInput) => {
  const navigate = useNavigate()
  const { isReady: isAuthReady, role, user } = useAuth()
  const [isSubmitDialogOpen, setSubmitDialogOpen] = useState(false)
  const [draftActionMessage, setDraftActionMessage] =
    useState<DraftActionNoticeCode | null>(null)
  const [isPreparingSubmission, setPreparingSubmission] = useState(false)
  const [isSubmissionNavigationStarted, setSubmissionNavigationStarted] =
    useState(false)
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
  const hasSession = Boolean(sessionQuery.data)
  const isRetiredSession =
    sessionQuery.isError && isRetiredPracticeApiError(sessionQuery.error)
  const isSessionNotFound =
    sessionQuery.isError && isNotFoundApiError(sessionQuery.error)
  const isSessionOffline =
    sessionQuery.isError && isOfflineApiError(sessionQuery.error)
  const isEditableSession =
    hasSession &&
    sessionQuery.data?.session.status === 'IN_PROGRESS' &&
    hasCurrentGuestOwnerProof &&
    !isCanonicalSessionBoundaryTerminal
  const principalScope = getStudyDraftPrincipalScope(user)
  const submitSessionV2 = useSubmitStudySessionV2(sessionId, principalScope)
  const isDraftConflictPending = useAppStore(
    (state) => state.isDraftConflictPending
  )
  const hasDraftConflict = isDraftConflictPending
  const isScopedDraftReady = useAppStore(
    (state) =>
      state.draftWorkingCopy?.principalScope === principalScope &&
      state.draftWorkingCopy.sessionId === sessionId
  )
  const allowSubmissionNavigationRef = useRef(false)
  const isSubmissionActive =
    submitSessionV2.isPending || submitSessionV2.isPaused
  const isSubmissionError =
    submitSessionV2.isError &&
    !isAuthTransitionSupersededError(submitSessionV2.error)
  const terminalSettlementKey =
    sessionQuery.isSuccess &&
    hasSession &&
    sessionQuery.data.session.status !== 'IN_PROGRESS'
      ? `${sessionId}:${sessionQuery.data.session.status}`
      : null
  const terminalSettlementRef = useRef<string | null>(null)
  const focusedQuestionIdRef = useRef<string | null>(null)
  const wasNavigationPromptOpenRef = useRef(false)
  // #1262: a failed submit locks nothing. The answers stay editable and
  // [제출하기] sends what is on screen again.
  const isSubmissionInFlight =
    !isCanonicalSessionBoundaryTerminal && isSubmissionActive
  const mustBlockNavigation =
    !isRetiredSession &&
    (isSubmissionInFlight || (isEditableSession && isScopedDraftReady))
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
    enabled: isEditableSession && !isSubmissionNavigationStarted,
    expectedSessionQuestionIds,
    isInteractionPaused:
      isSubmitDialogOpen ||
      isSubmissionInFlight ||
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
    if (!isSubmissionInFlight) {
      return
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isSubmissionInFlight])

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
  const v2Answers = draftController.snapshot?.answers ?? []
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
  const elapsedSeconds = draftController.elapsedSeconds
  const answeredCount = questions.reduce(
    (count, question) =>
      displayedSelectedAnswers[question.id] ? count + 1 : count,
    0
  )
  const unansweredCount = Math.max(0, questions.length - answeredCount)

  useEffect(() => {
    if (isNavigationPromptBlocked) {
      wasNavigationPromptOpenRef.current = true
      return
    }
    if (!wasNavigationPromptOpenRef.current) return
    wasNavigationPromptOpenRef.current = false
    // #1240: the dialog hands focus back to what had it. An option is still
    // disabled at that moment, so focus can drop to the page; a frame later
    // the question heading takes it then, without moving the page.
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement
      if (!active || active === document.body)
        headingRef.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [headingRef, isNavigationPromptBlocked])

  useEffect(() => {
    const questionId = currentQuestion?.id
    if (!canFocusCurrentQuestion || isNavigationPromptBlocked || !questionId)
      return
    // #1240: only a new question moves focus and the page; closing the
    // leave dialog (or any pause) keeps the learner where they were.
    if (focusedQuestionIdRef.current === questionId) return
    focusedQuestionIdRef.current = questionId
    // #1234: screen readers still read the new question, but the page
    // shows the card from its start, never jumping to the question.
    headingRef.current?.focus({ preventScroll: true })
    const stage = stageRef.current
    if (stage && stage.getBoundingClientRect().top < 0)
      stage.scrollIntoView({ block: 'start' })
  }, [
    canFocusCurrentQuestion,
    currentQuestion?.id,
    headingRef,
    isNavigationPromptBlocked,
    stageRef
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
      !isSubmissionInFlight &&
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

  // #985: an autosave in flight does not grey the button; a press waits for
  // that save through prepareSubmission before submitting.
  const canRequestSubmission =
    isLastQuestion &&
    !isSubmitDialogOpen &&
    !hasDraftConflict &&
    !isNavigationPromptBlocked &&
    !isPreparingSubmission &&
    !isSubmissionActive &&
    !isSessionRefreshUnavailable &&
    draftController.isReady &&
    sessionQuery.data?.session.status === 'IN_PROGRESS'

  usePracticeKeyboard({
    enabled:
      !isSubmitDialogOpen &&
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
    onSubmit: () => requestSubmission(),
    submitEnabled: canRequestSubmission
  })

  // A member leaves without a prompt: save first, stay with one error line if that fails.
  const isMemberLeaving =
    isNavigationPromptBlocked &&
    hasSession &&
    role !== 'GUEST' &&
    !isSubmissionInFlight
  const memberLeaveStartedRef = useRef(false)
  const { flush: flushDraft } = draftController
  useEffect(() => {
    if (!isMemberLeaving) {
      memberLeaveStartedRef.current = false
      return
    }
    if (memberLeaveStartedRef.current) return
    memberLeaveStartedRef.current = true
    setDraftActionMessage(null)
    void (async (): Promise<void> => {
      try {
        await flushDraft()
        allowSubmissionNavigationRef.current = true
        submissionNavigationBlocker.proceed?.()
      } catch (error: unknown) {
        submissionNavigationBlocker.reset?.()
        if (!isAuthTransitionSupersededError(error)) {
          setDraftActionMessage('saveBeforeLeaveFailed')
        }
      }
    })()
  }, [flushDraft, isMemberLeaving, submissionNavigationBlocker])

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
    setSubmitDialogOpen(false)
    resetPractice()
    // The result page plays the grading reveal once for a fresh submit.
    void navigate(`/practice/result/${sessionId}`, {
      state: { gradingReveal: true }
    })
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
      const prepared = await draftController.prepareSubmission()
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

  // All answered: submit at once. Otherwise confirm the unanswered count first.
  const requestSubmission = (): void => {
    if (unansweredCount > 0) {
      setSubmitDialogOpen(true)
      return
    }
    void handleSubmit()
  }

  const handleSubmitDialogOpenChange = (open: boolean): void => {
    if (!open && isSubmissionActive) {
      return
    }

    setSubmitDialogOpen(open)
  }

  // Controls that freeze while a submission, conflict, or navigation decision is open.
  const isQuestionNavigationLocked =
    isSubmissionInFlight ||
    hasDraftConflict ||
    isNavigationPromptBlocked ||
    isPreparingSubmission ||
    isSessionRefreshUnavailable

  const isBackNavigationDisabled =
    isSubmissionInFlight || isNavigationPromptBlocked || isPreparingSubmission
  const isBookmarkDisabled =
    isBackNavigationDisabled ||
    isSessionRefreshUnavailable ||
    bookmark.hasPendingMutation ||
    bookmark.isQueryUnavailable
  // Only a guest is asked: leaving drops their answers (subtract #8).
  const isNavigationGuardOpen =
    submissionNavigationBlocker.state === 'blocked' &&
    hasSession &&
    role === 'GUEST' &&
    !isSubmissionInFlight

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
    leaveWithoutSaving,
    handleSelectOption,
    handleSubmit,
    handleSubmitDialogOpenChange,
    hasCurrentGuestOwnerProof,
    hasDraftConflict,
    isBackNavigationDisabled,
    isBookmarkDisabled,
    isLastQuestion,
    isNavigationGuardOpen,
    isNavigationPromptBlocked,
    isPreparingSubmission,
    isQuestionNavigationLocked,
    isRetiredSession,
    isSessionNotFound,
    isSessionOffline,
    isSessionRefreshUnavailable,
    isSubmissionActive,
    isSubmissionError,
    isSubmitDialogOpen,
    hasSession,
    moveNext,
    movePrevious,
    moveToOrdinal: draftController.moveToOrdinal,
    requestSubmission,
    questions,
    retryDraftSave,
    role,
    safeQuestionIndex,
    sessionQuery,
    unansweredCount
  }
}

export type PracticeSessionController = ReturnType<
  typeof usePracticeSessionController
>
