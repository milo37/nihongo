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
  readonly id: number
  readonly message: string
}

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

  const announce = (message: string): void => {
    setActionNotice((current) => ({
      id: (current?.id ?? 0) + 1,
      message
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
    successMessage: string,
    failureMessage: string
  ): Promise<void> => {
    const refreshed = await refetchInsights().catch(() => false)
    if (refreshed) {
      clearBlockedRecommendation()
      announce(successMessage)
    } else {
      announce(failureMessage)
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
              announce(
                '추천 시점 이후 출제 가능한 문제가 없어 이 학습을 시작하지 못했습니다. 요청한 모드는 다른 모드로 바꾸지 않았으며 최신 추천을 확인하는 중입니다.'
              )
              void refreshAfterCandidateExhaustion(
                recommendation.kind,
                '요청한 모드는 다른 모드로 바꾸지 않았으며 최신 추천을 새로 확인했습니다.',
                '요청한 모드는 다른 모드로 바꾸지 않았습니다. 최신 추천을 불러오지 못해 이 추천은 잠시 비활성화했습니다. 최근 인사이트를 다시 시도해 주세요.'
              )
              return
            }
            announce(
              '추천 학습을 시작하지 못했습니다. 다른 모드로 자동 변경하지 않았습니다. 같은 추천을 다시 시도해 주세요.'
            )
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
              announce(
                '이전에 만든 단일 복습 세션이 이미 종료됐습니다. 다른 학습으로 바꾸지 않고 최신 추천을 확인하는 중입니다.'
              )
              blockRecommendation(recommendation.kind)
              void refreshAfterCandidateExhaustion(
                recommendation.kind,
                '종료된 단일 복습을 다른 학습으로 바꾸지 않고 최신 추천을 새로 확인했습니다.',
                '종료된 단일 복습을 다른 학습으로 바꾸지 않았습니다. 최신 추천을 불러오지 못해 이 추천은 잠시 비활성화했습니다. 최근 인사이트를 다시 시도해 주세요.'
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
              announce(
                '추천한 문제가 더 이상 복습 가능하지 않습니다. 다른 학습으로 자동 변경하지 않았으며 최신 추천을 확인하는 중입니다.'
              )
              void refreshAfterCandidateExhaustion(
                recommendation.kind,
                '다른 학습으로 자동 변경하지 않았으며 최신 추천을 새로 확인했습니다.',
                '다른 학습으로 자동 변경하지 않았습니다. 최신 추천을 불러오지 못해 이 추천은 잠시 비활성화했습니다. 최근 인사이트를 다시 시도해 주세요.'
              )
              return
            }
            announce(
              '단일 복습을 시작하지 못했습니다. 다른 학습으로 자동 변경하지 않았습니다. 같은 추천을 다시 시도해 주세요.'
            )
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
