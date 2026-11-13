import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useOutletContext, useParams } from 'react-router'
import type { ReactElement, RefObject } from 'react'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import type { PracticeNavigationContext } from '@app/layout'
import { usePracticeSessionController } from '@app/practice/hooks/usePracticeSessionController'
import { StudyDraftSaveStatus } from '@app/practice/session/StudyDraftSaveStatus'
import {
  PracticeQuestionBookmarkButton,
  PracticeQuestionBookmarkStatus
} from '@app/practice/session/components/PracticeQuestionBookmark'
import { PracticeQuestionActions } from '@app/practice/session/components/PracticeQuestionActions'
import { PracticeQuestionCard } from '@app/practice/session/components/PracticeQuestionCard'
import type { QuestionPush } from '@app/practice/session/components/PracticeQuestionCard'
import { PracticeQuestionNavigator } from '@app/practice/session/components/PracticeQuestionNavigator'
import {
  PracticeNavigationGuardDialog,
  PracticeSubmitDialog
} from '@app/practice/session/components/PracticeSessionDialogs'
import { PracticeSessionHeader } from '@app/practice/session/components/PracticeSessionHeader'
import { PracticeSessionNotices } from '@app/practice/session/components/PracticeSessionNotices'
import {
  SessionLoadError,
  SessionRecoveryState,
  SessionSetupLinkError
} from '@app/practice/session/components/PracticeSessionStateScreens'
import { useQuestionPush } from '@app/practice/session/useQuestionPush'
import type { QuestionPushMove } from '@app/practice/session/useQuestionPush'

type SessionController = ReturnType<typeof usePracticeSessionController>
type SessionQuestion = NonNullable<SessionController['currentQuestion']>

/** The current question with its bookmark status, actions and draft save status. */
const CurrentQuestionCard = ({
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
const LeavingQuestionCard = ({
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
const SessionSubmitDialog = ({
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

export const PracticeSessionPage = (): ReactElement => {
  const reviewContext =
    useOutletContext<PracticeNavigationContext | undefined>()
      ?.reviewReturnContext ?? null
  const { t } = useTranslation('practice')
  const { sessionId = '' } = useParams()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const submitButtonRef = useRef<HTMLButtonElement>(null)
  const [isQuestionSheetOpen, setQuestionSheetOpen] = useState(false)
  const session = usePracticeSessionController({ headingRef, sessionId })
  const push = useQuestionPush(
    session.safeQuestionIndex,
    Boolean(session.currentQuestion) &&
      session.sessionQuery.data?.session.status === 'IN_PROGRESS' &&
      (!session.isV2Session || session.draftController.isReady)
  )
  const refetchSession = (): void => void session.sessionQuery.refetch()

  const navigationPrompt = (
    <PracticeNavigationGuardDialog
      open={session.isNavigationGuardOpen}
      onContinue={session.cancelNavigation}
      onLeave={session.leaveWithoutSaving}
    />
  )

  if (session.isRetiredSession) {
    return (
      <SessionSetupLinkError
        framed
        title={t('session.terminal.retiredTitle')}
        description={t('session.terminal.retiredDescription')}
      />
    )
  }

  if (session.sessionQuery.isPending) {
    if (session.hasFrozenSubmissionAttempt) {
      return (
        <SessionRecoveryState
          connectivityMessage={session.submissionConnectivityMessage}
          description={t('session.recovery.pendingDescription')}
          idleStatus={t('session.recovery.checkingStatus')}
          onRetry={refetchSession}
        />
      )
    }
    if (session.sessionQuery.fetchStatus === 'paused') {
      return (
        <SessionLoadError
          description={t('session.errors.offlineSessionDescription')}
        />
      )
    }
    return <LoadingState message={t('session.loading.questions')} />
  }

  if (!session.sessionQuery.data) {
    if (session.isSessionNotFound) {
      return (
        <SessionSetupLinkError
          framed
          title={t('session.terminal.notFoundTitle')}
          description={t('session.terminal.notFoundDescription')}
        />
      )
    }
    if (session.hasFrozenSubmissionAttempt) {
      return (
        <SessionRecoveryState
          connectivityMessage={session.submissionConnectivityMessage}
          description={t('session.recovery.failedDescription')}
          idleStatus={t('session.recovery.connectedStatus')}
          onRetry={refetchSession}
        />
      )
    }
    return (
      <>
        <SessionLoadError
          description={
            session.isSessionOffline
              ? t('session.errors.offlineSessionDescription')
              : t('session.errors.sessionLoadDescription')
          }
          onRetry={refetchSession}
        />
        {navigationPrompt}
      </>
    )
  }

  if (!session.hasCurrentGuestOwnerProof) {
    if (session.sessionQuery.fetchStatus === 'paused') {
      return (
        <SessionLoadError
          description={t('session.errors.offlineSessionDescription')}
        />
      )
    }
    if (session.sessionQuery.isError) {
      return (
        <SessionLoadError
          description={t('session.errors.sessionLoadDescription')}
          onRetry={refetchSession}
        />
      )
    }
    return <LoadingState message={t('session.loading.guestOwnership')} />
  }

  const { status } = session.sessionQuery.data.session
  if (status === 'SUBMITTED') {
    if (session.isNavigationPromptBlocked) {
      return <LoadingState message={t('session.loading.resultRedirect')} />
    }
    return <Navigate replace to={`/practice/result/${sessionId}`} />
  }

  if (status !== 'IN_PROGRESS') {
    return (
      <SessionSetupLinkError
        title={
          status === 'EXPIRED'
            ? t('session.terminal.expiredTitle')
            : t('session.terminal.cancelledTitle')
        }
        description={t('session.terminal.description')}
      />
    )
  }

  if (session.isV2Session && !session.draftController.isReady) {
    if (
      session.draftController.draftQuery.isError ||
      session.draftController.saveState === 'error'
    ) {
      return (
        <SessionLoadError
          title={t('session.errors.draftLoadTitle')}
          description={t('session.errors.draftLoadDescription')}
          retryLabel={t('session.recovery.retry')}
          onRetry={() =>
            void session.draftController.retrySave().catch(() => undefined)
          }
        />
      )
    }
    return <LoadingState message={t('session.loading.draft')} />
  }

  if (!session.currentQuestion) {
    return (
      <SessionSetupLinkError
        title={t('session.errors.emptyTitle')}
        description={t('session.errors.emptyDescription')}
      />
    )
  }

  const question = session.currentQuestion
  const leaving = push.from === null ? undefined : session.questions[push.from]
  return (
    <section
      className={`learning-note study-session ${reviewContext ? 'study-review-session' : ''} w-full`}
    >
      <PracticeSessionHeader
        answeredCount={session.answeredCount}
        hasPassage={Boolean(question.passage)}
        progressStates={session.questions.map((item, index) =>
          index === session.safeQuestionIndex
            ? 'current'
            : session.displayedSelectedAnswers[item.id]
              ? 'answered'
              : 'todo'
        )}
        bookmarkButton={
          <PracticeQuestionBookmarkButton
            isBookmarked={session.bookmark.isBookmarked(question.id)}
            isDisabled={session.isBookmarkDisabled}
            onToggle={session.handleBookmark}
            questionNumber={session.safeQuestionIndex + 1}
          />
        }
        currentNumber={session.safeQuestionIndex + 1}
        isBackDisabled={session.isBackNavigationDisabled}
        isQuestionSheetDisabled={session.isQuestionNavigationLocked}
        onOpenQuestionSheet={() => setQuestionSheetOpen(true)}
        reviewContext={reviewContext}
        session={session.sessionQuery.data.session}
        total={session.questions.length}
      />

      <div
        className={`mx-auto w-full px-4 pt-5 sm:px-6 ${question.passage ? 'max-w-6xl' : 'max-w-[760px]'}`}
      >
        <PracticeSessionNotices
          draftActionMessage={session.draftActionMessage}
          draftController={session.draftController}
          hasUnresolvedConflictCheck={session.hasUnresolvedConflictCheck}
          isCompactDraftStatus={session.isCompactDraftStatus}
          isFirstQuestion={session.safeQuestionIndex === 0}
          isInlineDraftStatus={session.isInlineDraftStatus}
          isSessionError={session.sessionQuery.isError}
          isSessionPaused={session.sessionQuery.fetchStatus === 'paused'}
          isV2Session={session.isV2Session}
          onRetryDraftSave={session.retryDraftSave}
          onRetrySession={refetchSession}
          sessionData={session.sessionQuery.data}
        />

        <div className="relative">
          {leaving ? (
            <LeavingQuestionCard
              key={`leaving-${push.key}`}
              move={push}
              question={leaving}
              selectedOptionId={session.displayedSelectedAnswers[leaving.id]}
            />
          ) : null}
          <CurrentQuestionCard
            key={push.key}
            session={session}
            question={question}
            headingRef={headingRef}
            isReview={Boolean(reviewContext)}
            push={
              leaving && push.direction ? `in-${push.direction}` : undefined
            }
            submitButtonRef={submitButtonRef}
          />
        </div>
      </div>

      <PracticeQuestionNavigator
        currentIndex={session.safeQuestionIndex}
        isDisabled={session.isQuestionNavigationLocked}
        onJump={session.moveToOrdinal}
        onOpenChange={setQuestionSheetOpen}
        open={isQuestionSheetOpen && !session.isQuestionNavigationLocked}
        questions={session.questions}
        selectedAnswers={session.displayedSelectedAnswers}
      />

      <SessionSubmitDialog session={session} returnFocusRef={submitButtonRef} />

      {navigationPrompt}
    </section>
  )
}
