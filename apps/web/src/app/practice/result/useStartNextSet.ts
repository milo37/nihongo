import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import {
  MEMBER_COUNT,
  MEMBER_COUNT_CHOICES
} from '@app/practice/practiceSetupOptions'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { GUEST_SESSION_QUESTION_LIMIT } from '@nihongo/contracts/study/guest-limits'
import { useAppStore } from '@nihongo/browser/store/index'
import { isAuthTransitionSupersededError } from '@nihongo/browser/libs/authTransitionFence'
import {
  getSessionCap,
  isAccountRestrictedApiError,
  isGuestLimitReachedApiError,
  isNoEligibleQuestionsApiError
} from '@libs/apiError'

const MAX_TIMER_MS = 2 ** 31 - 1

/**
 * [다음 10문제] (subtract table 10): one press starts a new random set at
 * the same level and subject. If the server refuses, the reason shows
 * right under the button (no questions left, account restricted, failure);
 * a guest's daily limit opens the setup screen, whose card says when the
 * tries come back. A member's set cap (#1006) shows its card here until
 * new sets open again.
 */
export const useStartNextSet = (
  session: StudySessionView['session'],
  isGuest: boolean,
  /** The set just played: a member gets the same size again (5/10/20). */
  requestedCount: number = MEMBER_COUNT
) => {
  const navigate = useNavigate()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const createSession = useCreateStudySession()
  // A retry set (any size) is followed by a normal one of ten.
  const count = isGuest
    ? GUEST_SESSION_QUESTION_LIMIT
    : MEMBER_COUNT_CHOICES.includes(requestedCount)
      ? requestedCount
      : MEMBER_COUNT
  const start = (): void => {
    if (createSession.isPending) return
    createSession.mutate(
      {
        level: session.level,
        subject: session.subject,
        count,
        mode: 'RANDOM'
      },
      {
        onSuccess: ({ session: next }, input) => {
          assertCurrentCreateStudySessionAction(input)
          beginPractice(next.id, next.startedAt)
          void navigate(`/practice/session/${next.id}`)
        },
        onError: (error) => {
          if (isGuestLimitReachedApiError(error)) {
            void navigate(
              `/practice?level=${session.level}&subject=${session.subject}`
            )
          }
        }
      }
    )
  }
  const error = createSession.isError ? createSession.error : null
  const sessionCap = error === null ? null : getSessionCap(error)
  const sessionCapResetsAt = sessionCap?.resetsAt
  const resetCreateSession = createSession.reset
  useEffect(() => {
    if (!sessionCapResetsAt) return
    const waitMs = Date.parse(sessionCapResetsAt) - Date.now()
    if (!(waitMs > 0) || waitMs > MAX_TIMER_MS) return
    const timerId = window.setTimeout(resetCreateSession, waitMs)
    return () => window.clearTimeout(timerId)
  }, [resetCreateSession, sessionCapResetsAt])
  return {
    accountRestricted: error !== null && isAccountRestrictedApiError(error),
    noEligibleQuestions: error !== null && isNoEligibleQuestionsApiError(error),
    hasCreateError:
      error !== null &&
      !isGuestLimitReachedApiError(error) &&
      !sessionCap &&
      !isAuthTransitionSupersededError(error),
    count,
    isStarting: createSession.isPending || createSession.isPaused,
    sessionCap,
    start
  }
}
