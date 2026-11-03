import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { WrongNoteDetailView } from '@app/wrong-note/adapters/wrongNoteView'
import { useCreateTargetedReviewSession } from '@app/wrong-note/hooks/useCreateTargetedReviewSession'
import {
  assertCurrentTargetedReviewAction,
  completeTargetedReviewAction
} from '@app/wrong-note/queries/wrongNoteMutations'
import { saveReviewReturnContext } from '@app/wrong-note/reviewReturnContext'
import { readTargetedReviewAttempt } from '@nihongo/browser/app/wrong-note/targetedReviewAttemptStorage'
import { useAppStore } from '@nihongo/browser/store/index'
import { isQuestionNotAvailableApiError } from '@libs/apiError'

export type TargetedNoticeCode = 'endedArchived' | 'endedAvailable'

type ReviewAvailability = WrongNoteDetailView['wrongNote']['reviewAvailability']

type UseTargetedReviewStartInput = {
  identityKey: string
  questionId: string
  returnTo: string
}

// Starts or recovers the single-question review session from a wrong-note detail.
export const useTargetedReviewStart = ({
  identityKey,
  questionId,
  returnTo
}: UseTargetedReviewStartInput) => {
  const navigate = useNavigate()
  const createTargeted = useCreateTargetedReviewSession()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const [targetedNotice, setTargetedNotice] = useState({
    code: null as TargetedNoticeCode | null,
    questionId
  })
  const [targetedAttemptState, setTargetedAttemptState] = useState(() => ({
    identityKey,
    isPresent: readTargetedReviewAttempt(identityKey, questionId) !== null,
    questionId
  }))
  const currentQuestionIdRef = useRef(questionId)
  const hasRecoveryAttempt =
    targetedAttemptState.identityKey === identityKey &&
    targetedAttemptState.questionId === questionId
      ? targetedAttemptState.isPresent
      : readTargetedReviewAttempt(identityKey, questionId) !== null
  const noticeCode =
    targetedNotice.questionId === questionId ? targetedNotice.code : null
  const isCurrentMutation = createTargeted.variables?.questionId === questionId
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

  const start = (reviewAvailability: ReviewAvailability): void => {
    setTargetedNotice({ code: null, questionId })
    setTargetedAttemptState({ identityKey, isPresent: true, questionId })
    createTargeted.reset()
    createTargeted.mutate(
      { principalScope: identityKey, questionId },
      {
        onSuccess: ({ session }, input) => {
          assertCurrentTargetedReviewAction(input)
          if (input.questionId !== currentQuestionIdRef.current) {
            return
          }
          if (
            session.session.status === 'IN_PROGRESS' ||
            session.session.status === 'SUBMITTED'
          ) {
            saveReviewReturnContext({
              principalScope: identityKey,
              sessionId: session.session.id,
              questionId,
              returnTo
            })
          }
          if (session.session.status === 'IN_PROGRESS') {
            beginPractice(session.session.id, session.session.startedAt)
            void navigate(`/practice/session/${session.session.id}`)
          } else if (session.session.status === 'SUBMITTED') {
            void navigate(`/practice/result/${session.session.id}`)
          } else {
            setTargetedNotice({
              code:
                reviewAvailability === 'ARCHIVED'
                  ? 'endedArchived'
                  : 'endedAvailable',
              questionId
            })
          }
          completeTargetedReviewAction(input)
          setTargetedAttemptState({ identityKey, isPresent: false, questionId })
        },
        onError: () => {
          syncTargetedAttemptState()
        }
      }
    )
  }

  return {
    hasRecoveryAttempt,
    isError: isCurrentMutation && createTargeted.isError,
    isPaused: isCurrentMutation && createTargeted.isPaused,
    isPending: isCurrentMutation && createTargeted.isPending,
    isUnavailableError: isQuestionNotAvailableApiError(createTargeted.error),
    noticeCode,
    start
  }
}
