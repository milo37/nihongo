import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext, useParams } from 'react-router'
import type { ReactElement } from 'react'
import type { PracticeNavigationContext } from '@app/layout'
import { usePracticeSessionController } from '@app/practice/hooks/usePracticeSessionController'
import { PracticeQuestionBookmarkButton } from '@app/practice/session/components/PracticeQuestionBookmark'
import { PracticeQuestionNavigator } from '@app/practice/session/components/PracticeQuestionNavigator'
import { PracticeNavigationGuardDialog } from '@app/practice/session/components/PracticeSessionDialogs'
import { PracticeSessionHeader } from '@app/practice/session/components/PracticeSessionHeader'
import { PracticeSessionNotices } from '@app/practice/session/components/PracticeSessionNotices'
import { useQuestionPush } from '@app/practice/session/useQuestionPush'
import {
  CurrentQuestionCard,
  LeavingQuestionCard,
  SessionSubmitDialog
} from '@app/practice/session/components/SessionQuestionCards'
import { readSessionView } from '@app/practice/session/sessionView'

export const PracticeSessionPage = (): ReactElement => {
  const reviewContext =
    useOutletContext<PracticeNavigationContext | undefined>()
      ?.reviewReturnContext ?? null
  const { t } = useTranslation('practice')
  const { sessionId = '' } = useParams()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const submitButtonRef = useRef<HTMLButtonElement>(null)
  const [isQuestionSheetOpen, setQuestionSheetOpen] = useState(false)
  const session = usePracticeSessionController({
    headingRef,
    stageRef,
    sessionId
  })
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

  const view = readSessionView({
    session,
    t,
    sessionId,
    refetchSession,
    navigationPrompt
  })
  if ('screen' in view) return view.screen

  const { data, question } = view
  const leaving = push.from === null ? undefined : session.questions[push.from]
  return (
    <section
      className={`learning-note study-session ${reviewContext ? 'study-review-session' : ''}`}
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
        session={data.session}
        total={session.questions.length}
      />

      <div
        className={`study-session-body ${question.passage ? 'study-session-body-wide' : 'study-session-body-narrow'}`}
      >
        <PracticeSessionNotices
          draftActionMessage={session.draftActionMessage}
          isFirstQuestion={session.safeQuestionIndex === 0}
          isSessionError={session.sessionQuery.isError}
          onRetrySession={refetchSession}
          sessionData={data}
        />

        <div ref={stageRef} className="study-card-stage">
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
