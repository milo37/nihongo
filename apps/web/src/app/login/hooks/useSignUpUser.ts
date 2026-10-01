import { useMutation } from '@tanstack/react-query'
import { authMutations } from '@app/login/queries/authMutations'
import { analyticsClient } from '@/analytics/client'

export const useSignUpUser = () =>
  useMutation({
    ...authMutations.signUp(),
    onSuccess: () => {
      analyticsClient.track({ event: 'sign_up', payload: {} })
    }
  })
