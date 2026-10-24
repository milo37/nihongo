import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { analyticsClient, type AnalyticsClient } from '@/analytics/client'

interface TrackStudySubmissionOptions {
  readonly analytics?: AnalyticsClient
  readonly questionCount: number
  readonly session: StudySessionView | undefined
}

export const trackStudySubmission = ({
  analytics = analyticsClient,
  questionCount,
  session
}: TrackStudySubmissionOptions): void => {
  if (!session) return

  analytics.track({
    event: 'study_submitted',
    payload: {
      mode: session.session.mode,
      questionCount
    }
  })

  if (
    session.session.mode === 'DAILY_REVIEW' ||
    session.session.mode === 'WRONG_NOTE'
  ) {
    analytics.track({
      event: 'review_submitted',
      payload: {
        source:
          session.session.mode === 'DAILY_REVIEW'
            ? 'DAILY_REVIEW'
            : 'WRONG_NOTE',
        questionCount
      }
    })
  }
}
