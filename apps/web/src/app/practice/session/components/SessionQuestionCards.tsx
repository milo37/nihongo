import { useLayoutEffect, useRef } from 'react'
import type { ReactElement, RefObject } from 'react'
import type { usePracticeSessionController } from '@app/practice/hooks/usePracticeSessionController'
import { StudyDraftSaveStatus } from '@app/practice/session/StudyDraftSaveStatus'
import { PracticeQuestionBookmarkStatus } from '@app/practice/session/components/PracticeQuestionBookmark'
import { PracticeQuestionActions } from '@app/practice/session/components/PracticeQuestionActions'
import { PracticeQuestionCard } from '@app/practice/session/components/PracticeQuestionCard'
import type { QuestionPush } from '@app/practice/session/components/PracticeQuestionCard'
import { PracticeSubmitDialog } from '@app/practice/session/components/PracticeSessionDialogs'
import type { QuestionPushMove } from '@app/practice/session/useQuestionPush'

export type SessionController = ReturnType<typeof usePracticeSessionController>
export type SessionQuestion = NonNullable<SessionController['currentQuestion']>

/** The current question with its bookmark status, actions and draft save status. */
export const CurrentQuestionCard = ({
  session,
  question,
  headingRef,
  isReview,
  push,
  submitButtonRef
}: {
  session: SessionController
  question: SessionQuestion
  headingRef: RefObject<HTMLHeadingElement | null>
  isReview: boolean
  push: QuestionPush | undefined
  submitButtonRef: RefObject<HTMLButtonElement | null>
}): ReactElement => {
  const inlineSaveStatus = session.isInlineDraftStatus
    ? session.draftController.status.code
    : null
  return (
    <PracticeQuestionCard
      actions={
        <PracticeQuestionActions
          canSubmit={session.canRequestSubmission}
          hidePrevious={isReview}
          isFirstQuestion={session.safeQuestionIndex === 0}
          isLastQuestion={session.isLastQuestion}
          isLocked={session.isQuestionNavigationLocked}
          onNext={session.moveNext}
          onPrevious={session.movePrevious}
          onSubmit={session.requestSubmission}
          submitButtonRef={submitButtonRef}
        />
      }
      bookmarkStatus={
        <PracticeQuestionBookmarkStatus
          bookmark={session.bookmark}
          questionId={question.id}
          role={session.role}
        />
      }
      headingRef={headingRef}
      isOptionsDisabled={
        session.isSubmitDialogOpen || session.isQuestionNavigationLocked
      }
      onSelectOption={session.handleSelectOption}
      push={push}
      question={question}
      questionNumber={session.safeQuestionIndex + 1}
      saveStatus={
        // A guest's answers are not kept (F4), so no "saved" line.
        session.isV2Session && session.role !== 'GUEST' ? (
          <StudyDraftSaveStatus
            status={inlineSaveStatus}
            onRetry={session.retryDraftSave}
          />
        ) : null
      }
      selectedOptionId={session.displayedSelectedAnswers[question.id]}
    />
  )
}

const ignoreSelect = (): void => undefined

/**
 * JLP-870: the question being pushed out, drawn over the new one's place.
 * Hidden from assistive tech and input; gone when its slide ends. It has no
 * h1 and no radios: its hidden inputs become unnamed checkboxes (they keep
 * the chosen look, which reads input:checked), so the document holds one
 * heading and one answer group throughout.
 */
export const LeavingQuestionCard = ({
  move,
  question,
  selectedOptionId
}: {
  move: QuestionPushMove
  question: SessionQuestion
  selectedOptionId: string | undefined
}): ReactElement => {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const copyRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    for (const input of copyRef.current?.querySelectorAll('input') ?? []) {
      input.type = 'checkbox'
      input.removeAttribute('name')
      input.removeAttribute('id')
    }
    for (const label of copyRef.current?.querySelectorAll('label') ?? []) {
      label.removeAttribute('for')
    }
  }, [])
  return (
    <div
      ref={copyRef}
      className="study-push-leaving"
      aria-hidden="true"
      inert
      onAnimationEnd={move.finish}
    >
      <PracticeQuestionCard
        actions={null}
        bookmarkStatus={null}
        headingRef={headingRef}
        isDecorative
        isOptionsDisabled
        onSelectOption={ignoreSelect}
        push={`out-${move.direction ?? 'next'}`}
        question={question}
        questionNumber={(move.from ?? 0) + 1}
        saveStatus={null}
        selectedOptionId={selectedOptionId}
      />
    </div>
  )
}

/** Confirm-submit dialog wired to the session's submission state. */
export const SessionSubmitDialog = ({
  session,
  returnFocusRef
}: {
  session: SessionController
  returnFocusRef: RefObject<HTMLButtonElement | null>
}): ReactElement => (
  <PracticeSubmitDialog
    open={session.isSubmitDialogOpen && !session.hasDraftConflict}
    connectivityMessage={session.submissionConnectivityMessage}
    hasFrozenAttempt={session.hasFrozenSubmissionAttempt}
    isConfirmDisabled={
      session.hasDraftConflict || session.isSessionRefreshUnavailable
    }
    isConfirmLoading={
      session.isSubmissionActive || session.isPreparingSubmission
    }
    isContinueDisabled={session.mustReplayFrozenSubmission}
    isSubmissionError={session.isSubmissionError}
    onConfirm={() => void session.handleSubmit()}
    onOpenChange={session.handleSubmitDialogOpenChange}
    returnFocusRef={returnFocusRef}
    unansweredCount={session.unansweredCount}
  />
)
