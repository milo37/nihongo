import { useMutation, useQueryClient } from '@tanstack/react-query'
import { commitCanonicalAuth } from '@nihongo/browser/app/login/authSession'
import { authQueries } from '@nihongo/browser/app/login/queries/authQueries'
import { targetLevelMutations } from '@app/account/queries/targetLevelMutations'

// After a save, /me is read again and committed: the auth sync only commits
// on an identity change, and every screen reads the level from the store.
export const useUpdateTargetLevel = () => {
  const queryClient = useQueryClient()
  return useMutation({
    ...targetLevelMutations.update(),
    onSuccess: async () => {
      const user = await queryClient.fetchQuery({
        ...authQueries.currentUser(),
        staleTime: 0
      })
      await commitCanonicalAuth(queryClient, user)
    }
  })
}
