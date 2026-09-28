import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { DashboardRecommendationView } from '@app/dashboard/adapters/dashboardInsightsView'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { useCreateTargetedReviewSession } from '@app/wrong-note/hooks/useCreateTargetedReviewSession'
import {
  assertCurrentTargetedReviewAction,
  completeTargetedReviewAction
} from '@app/wrong-note/queries/wrongNoteMutations'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'
import {
  isNotFoundApiError,
  isNoEligibleQuestionsApiError,
  isQuestionNotAvailableApiError
} from '@util/apiError'

export interface DashboardActionNotice {
  readonly code: DashboardActionNoticeCode
  readonly id: number
}

export type DashboardActionNoticeCode =
  | 'sessionExhausted'
  | 'sessionRefreshed'
  | 'sessionRefreshFailed'
  | 'sessionFailed'
  | 'targetedEnded'
  | 'targetedEndedRefreshed'
  | 'targetedEndedRefreshFailed'
  | 'targetedUnavailable'
  | 'targetedRefreshed'
  | 'targetedRefreshFailed'
  | 'targetedFailed'

interface UseDashboardRecommendationActionOptions {
  readonly refetchInsights: () => Promise<boolean>
}

export const useDashboardRecommendationAction = ({
  refetchInsights
}: UseDashboardRecommendationActionOptions) => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const createSession = useCreateStudySession()
  const createTargetedReview = useCreateTargetedReviewSession()
  const commandLockRef = useRef(false)
  const blockedRecommendationKindRef = useRef<
    DashboardRecommendationView['kind'] | null
  >(null)
  const [actionNotice, setActionNotice] =
    useState<DashboardActionNotice | null>(null)
  const [pendingRecommendationKind, setPendingRecommendationKind] = useState<
    DashboardRecommendationView['kind'] | null
  >(null)
  const [blockedRecommendationKind, setBlockedRecommendationKind] = useState<
    DashboardRecommendationView['kind'] | null
  >(null)
  const [isInsightsRetryPending, setIsInsightsRetryPending] = useState(false)

  const isActionPending =
    pendingRecommendationKind !== null ||
    isInsightsRetryPending ||
    createSession.isPending ||
    createSession.isPaused ||
    createTargetedReview.isPending ||
    createTargetedReview.isPaused

  const announce = (code: DashboardActionNoticeCode): void => {
    setActionNotice((current) => ({
      code,
      id: (current?.id ?? 0) + 1
    }))
  }

  const clearBlockedRecommendation = (): void => {
    blockedRecommendationKindRef.current = null
    setBlockedRecommendationKind(null)
  }

  const blockRecommendation = (
    kind: DashboardRecommendationView['kind']
  ): void => {
    blockedRecommendationKindRef.current = kind
    setBlockedRecommendationKind(kind)
  }

  const completePendingAction = (
    kind: DashboardRecommendationView['kind']
  ): void => {
    commandLockRef.current = false
    setPendingRecommendationKind((current) =>
      current === kind ? null : current
    )
  }

  const refreshAfterCandidateExhaustion = async (
    kind: DashboardRecommendationView['kind'],
    successCode: DashboardActionNoticeCode,
    failureCode: DashboardActionNoticeCode
  ): Promise<void> => {
    const refreshed = await refetchInsights().catch(() => false)
    if (refreshed) {
      clearBlockedRecommendation()
      announce(successCode)
    } else {
      announce(failureCode)
    }
    completePendingAction(kind)
  }

  const retryInsights = async (): Promise<void> => {
    if (commandLockRef.current) return

    const blockedKindAtStart = blockedRecommendationKindRef.current
    commandLockRef.current = true
    setIsInsightsRetryPending(true)
    try {
      const refreshed = await refetchInsights().catch(() => false)
      if (
        refreshed &&
        blockedKindAtStart !== null &&
        blockedRecommendationKindRef.current === blockedKindAtStart
      ) {
        clearBlockedRecommendation()
        setActionNotice(null)
      }
    } finally {
      commandLockRef.current = false
      setIsInsightsRetryPending(false)
    }
  }

  const runRecommendation = (
    recommendation: DashboardRecommendationView
  ): void => {
    if (
      commandLockRef.current ||
      isActionPending ||
      blockedRecommendationKindRef.current === recommendation.kind
    ) {
      return
    }

    setActionNotice(null)

    switch (recommendation.action.kind) {
      case 'OPEN_PRACTICE_SETUP':
        void navigate('/practice')
        return
      case 'START_SESSION': {
        const { count, level, mode, subject } = recommendation.action
        const input = { count, level, mode, subject }
        let isRefreshingExhaustedRecommendation = false
        commandLockRef.current = true
        setPendingRecommendationKind(recommendation.kind)
        createSession.reset()
        createSession.mutate(input, {
          onSuccess: ({ session }, submittedInput) => {
            assertCurrentCreateStudySessionAction(submittedInput)
            beginPractice(session.id, session.startedAt)
            void navigate(`/practice/session/${session.id}`)
          },
          onError: (error) => {
            if (isAuthTransitionSupersededError(error)) return
            if (isNoEligibleQuestionsApiError(error)) {
              isRefreshingExhaustedRecommendation = true
              blockRecommendation(recommendation.kind)
              announce('sessionExhausted')
              void refreshAfterCandidateExhaustion(
                recommendation.kind,
                'sessionRefreshed',
                'sessionRefreshFailed'
              )
              return
            }
            announce('sessionFailed')
          },
          onSettled: () => {
            if (!isRefreshingExhaustedRecommendation) {
              completePendingAction(recommendation.kind)
            }
          }
        })
        return
      }
      case 'START_TARGETED_REVIEW': {
        const input = {
          principalScope: getStudyDraftPrincipalScope(user),
          questionId: recommendation.action.questionId
        }
        let isRefreshingExhaustedRecommendation = false
        commandLockRef.current = true
        setPendingRecommendationKind(recommendation.kind)
        createTargetedReview.reset()
        createTargetedReview.mutate(input, {
          onSuccess: ({ session }, submittedInput) => {
            assertCurrentTargetedReviewAction(submittedInput)
            if (session.session.status === 'IN_PROGRESS') {
              beginPractice(session.session.id, session.session.startedAt)
              void navigate(`/practice/session/${session.session.id}`)
            } else if (session.session.status === 'SUBMITTED') {
              void navigate(`/practice/result/${session.session.id}`)
            } else {
              isRefreshingExhaustedRecommendation = true
              announce('targetedEnded')
              blockRecommendation(recommendation.kind)
              void refreshAfterCandidateExhaustion(
                recommendation.kind,
                'targetedEndedRefreshed',
                'targetedEndedRefreshFailed'
              )
            }
            completeTargetedReviewAction(submittedInput)
          },
          onError: (error) => {
            if (isAuthTransitionSupersededError(error)) return
            if (
              isQuestionNotAvailableApiError(error) ||
              isNotFoundApiError(error)
            ) {
              isRefreshingExhaustedRecommendation = true
              blockRecommendation(recommendation.kind)
              announce('targetedUnavailable')
              void refreshAfterCandidateExhaustion(
                recommendation.kind,
                'targetedRefreshed',
                'targetedRefreshFailed'
              )
              return
            }
            announce('targetedFailed')
          },
          onSettled: () => {
            if (!isRefreshingExhaustedRecommendation) {
              completePendingAction(recommendation.kind)
            }
          }
        })
        return
      }
    }
  }

  return {
    actionNotice,
    blockedRecommendationKind,
    isActionPending,
    pendingRecommendationKind,
    retryInsights,
    runRecommendation
  }
}
