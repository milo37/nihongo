import { useMutation } from '@tanstack/react-query'
import { authMutations } from '@app/login/queries/authMutations'

export const useVerifyEmail = () => useMutation(authMutations.verifyEmail())
