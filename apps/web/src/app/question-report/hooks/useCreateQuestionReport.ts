import { useMutation, useQueryClient } from '@tanstack/react-query'
import { invalidateCreatedQuestionReport } from '@app/content-operations/reports/questionReportPublic'
import { questionReportMutations } from '@app/question-report/queries/questionReportMutations'
import {
  AuthTransitionSupersededError,
  assertCurrentAuthActorTransitionFence,
  captureAuthActorTransitionFence
} from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import { analyticsClient } from '@/analytics/client'

export const useCreateQuestionReport = (onSuccess?: () => void) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...questionReportMutations.create(),
    onMutate: () => {
      const actor = useAppStore.getState().currentUser
      if (actor?.role !== 'USER' && actor?.role !== 'ADMIN') {
        throw new AuthTransitionSupersededError()
      }
      return captureAuthActorTransitionFence(actor)
    },
    onSuccess: async (result, input, fence) => {
      assertCurrentAuthActorTransitionFence(
        fence,
        useAppStore.getState().currentUser
      )
      await invalidateCreatedQuestionReport(queryClient, {
        kind: 'REPORT_CREATE',
        questionIds: [input.questionId],
        reportId: result.id
      })
      assertCurrentAuthActorTransitionFence(
        fence,
        useAppStore.getState().currentUser
      )
      analyticsClient.track({
        event: 'question_reported',
        payload: { reason: input.request.reason }
      })
      onSuccess?.()
    }
  })
}
