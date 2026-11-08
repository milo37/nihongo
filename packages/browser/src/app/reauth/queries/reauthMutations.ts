import { mutationOptions } from '@tanstack/react-query'
import { startAdminReauth } from '../../../api/auth/startAdminReauth'
import { AuthFlowError } from '../../login/authFlowErrors'
import { authQueries } from '../../login/queries/authQueries'

export const reauthMutations = {
  startAdmin: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'admin-reauth'] as const,
      networkMode: 'always',
      mutationFn: async (callbackURL: string) => {
        try {
          return await startAdminReauth({
            purpose: 'ADMIN_FRESH',
            provider: 'google',
            callbackURL
          })
        } catch (error: unknown) {
          throw new AuthFlowError(error)
        }
      }
    })
} as const
