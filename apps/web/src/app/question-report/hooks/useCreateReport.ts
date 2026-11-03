import { useMutation } from '@tanstack/react-query'
import { reportMutations } from '@app/question-report/queries/reportMutations'
import {
  AuthTransitionSupersededError,
  assertCurrentAuthActorTransitionFence,
  captureAuthActorTransitionFence
} from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import { analyticsClient } from '@/analytics/client'

export const useCreateReport = (onSuccess?: () => void) =>
  useMutation({
    ...reportMutations.create(),
    onMutate: () => {
      const actor = useAppStore.getState().currentUser
      if (actor?.role !== 'USER' && actor?.role !== 'ADMIN') {
        throw new AuthTransitionSupersededError()
      }
      return captureAuthActorTransitionFence(actor)
    },
    onSuccess: (_result, request, fence) => {
      assertCurrentAuthActorTransitionFence(
        fence,
        useAppStore.getState().currentUser
      )
      analyticsClient.track({
        event: 'report_submitted',
        payload: { kind: request.kind }
      })
      onSuccess?.()
    }
  })
