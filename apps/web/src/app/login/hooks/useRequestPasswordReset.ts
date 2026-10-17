import { useMutation } from '@tanstack/react-query'
import { authMutations } from '@app/login/queries/authMutations'

export const useRequestPasswordReset = () =>
  useMutation(authMutations.requestPasswordReset())
