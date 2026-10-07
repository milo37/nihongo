import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { CreateQuestionReportRequest } from '@nihongo/contracts/admin/phase7'
import { createPhase7QuestionReport } from '@api/phase7/phase7AdminApi'
import { invalidateCreatedQuestionReport as invalidatePhase7AdminMutation } from '@app/content-operations/reports/questionReportPublic'
import {
  AuthTransitionSupersededError,
  assertCurrentAuthActorTransitionFence,
  captureAuthActorTransitionFence
} from '@libs/authTransitionFence'
import { useAppStore } from '@store/index'
import { analyticsClient } from '@/analytics/client'

interface CreatePhase7QuestionReportInput {
  readonly questionId: string
  readonly request: CreateQuestionReportRequest
}

export const useCreatePhase7QuestionReport = (onSuccess?: () => void) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['phase7', 'question-report'],
    networkMode: 'always',
    mutationFn: (input: CreatePhase7QuestionReportInput) =>
      createPhase7QuestionReport(input.request),
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
      await invalidatePhase7AdminMutation(queryClient, {
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
