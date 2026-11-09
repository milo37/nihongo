import { useMutation, useQueryClient } from '@tanstack/react-query'
import { refreshCanonicalAuthAfterMutation } from '@nihongo/browser/app/login/authSession'
import { targetLevelMutations } from '@app/account/queries/targetLevelMutations'

// After a save, /me is read again and committed: the auth sync only commits
// on an identity change, and every screen reads the level from the store.
// The read runs inside an auth transition epoch, so a logout that starts
// while the save is in flight wins and the old user is never restored.
export const useUpdateTargetLevel = () => {
  const queryClient = useQueryClient()
  return useMutation({
    ...targetLevelMutations.update(),
    onSuccess: async () => {
      await refreshCanonicalAuthAfterMutation(queryClient, {
        expectedIdentity: 'AUTHENTICATED'
      })
    }
  })
}
