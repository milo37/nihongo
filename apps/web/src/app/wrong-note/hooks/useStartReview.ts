import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { ListReviewListResponse } from '@nihongo/contracts/wrong-note/list-review-list'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { isAuthTransitionSupersededError } from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import {
  isAccountRestrictedApiError,
  isNoEligibleQuestionsApiError
} from '@libs/apiError'

export type StartReviewNotice = 'accountRestricted' | 'empty' | 'error'

const REVIEW_COUNT = 10

// [Start review] runs DAILY_REVIEW on the oldest wrong answer's level and subject.
export const useStartReview = (onExhausted: () => void) => {
  const navigate = useNavigate()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const createSession = useCreateStudySession()
  const [notice, setNotice] = useState<StartReviewNotice | null>(null)

  const start = (
    oldestToReview: ListReviewListResponse['oldestToReview']
  ): void => {
    if (!oldestToReview || createSession.isPending) return
    setNotice(null)
    createSession.mutate(
      {
        level: oldestToReview.level,
        subject: oldestToReview.subject,
        mode: 'DAILY_REVIEW',
        count: REVIEW_COUNT
      },
      {
        onSuccess: ({ session }, input) => {
          assertCurrentCreateStudySessionAction(input)
          beginPractice(session.id, session.startedAt)
          void navigate(`/practice/session/${session.id}`)
        },
        onError: (error) => {
          if (isAuthTransitionSupersededError(error)) return
          if (isNoEligibleQuestionsApiError(error)) {
            setNotice('empty')
            onExhausted()
            return
          }
          setNotice(
            isAccountRestrictedApiError(error) ? 'accountRestricted' : 'error'
          )
        }
      }
    )
  }

  return {
    isPending: createSession.isPending || createSession.isPaused,
    notice,
    start
  }
}
