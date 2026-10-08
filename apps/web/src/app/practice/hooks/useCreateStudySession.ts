import { useMutation } from '@tanstack/react-query'
import {
  assertCurrentCreateStudySessionAction,
  studySessionMutations
} from '@app/practice/queries/studySessionQueries'
import { analyticsClient } from '@/analytics/client'

export const useCreateStudySession = () => {
  return useMutation({
    ...studySessionMutations.createSession(),
    onSuccess: (data, input) => {
      assertCurrentCreateStudySessionAction(input)
      analyticsClient.track({
        event: 'practice_configured',
        payload: {
          level: input.level,
          subject: input.subject,
          mode: input.mode,
          questionCount: input.count
        }
      })
      analyticsClient.track({
        event: 'study_started',
        payload: {
          level: data.session.level,
          subject: data.session.subject,
          mode: data.session.mode,
          questionCount: data.actualCount
        }
      })
      if (data.session.mode === 'DAILY_REVIEW') {
        analyticsClient.track({
          event: 'review_started',
          payload: {
            source: 'DAILY_REVIEW',
            questionCount: data.actualCount
          }
        })
      } else if (data.session.mode === 'WRONG_NOTE') {
        analyticsClient.track({
          event: 'review_started',
          payload: {
            source: 'WRONG_NOTE',
            questionCount: data.actualCount
          }
        })
      }
    }
  })
}
