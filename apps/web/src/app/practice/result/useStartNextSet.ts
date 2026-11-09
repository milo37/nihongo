import { useNavigate } from 'react-router'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { MEMBER_COUNT } from '@app/practice/practiceSetupOptions'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { GUEST_SESSION_QUESTION_LIMIT } from '@nihongo/contracts/study/guest-limits'
import { useAppStore } from '@nihongo/browser/store/index'

/**
 * [다음 10문제] (subtract table 10): one press starts a new random set at
 * the same level and subject. If the server refuses (no questions left,
 * a guest's daily limit), the setup screen opens with that scope and says
 * why.
 */
export const useStartNextSet = (
  session: StudySessionView['session'],
  isGuest: boolean
) => {
  const navigate = useNavigate()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const createSession = useCreateStudySession()
  const count = isGuest ? GUEST_SESSION_QUESTION_LIMIT : MEMBER_COUNT
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
        onError: () => {
          void navigate(
            `/practice?level=${session.level}&subject=${session.subject}`
          )
        }
      }
    )
  }
  return {
    count,
    isStarting: createSession.isPending || createSession.isPaused,
    start
  }
}
