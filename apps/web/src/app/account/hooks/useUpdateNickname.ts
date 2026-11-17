import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isApiError } from '@nihongo/browser/api/config'
import { refreshCanonicalAuthAfterMutation } from '@nihongo/browser/app/login/authSession'
import { updateNickname } from '@api/auth/updateNickname'

// #1096: like the target level, /me is read again after a save so the name
// and the avatar's letter change everywhere. A nickname the server refuses
// (400) is the field's own error; anything else is the row's save error.
export const useUpdateNickname = (callbacks: {
  onSaved: () => void
  onInvalid: () => void
}) => {
  const queryClient = useQueryClient()
  return useMutation({
    retry: false,
    meta: { localErrorUi: true },
    mutationFn: updateNickname,
    onSuccess: async () => {
      await refreshCanonicalAuthAfterMutation(queryClient, {
        expectedIdentity: 'AUTHENTICATED'
      })
      callbacks.onSaved()
    },
    onError: (error) => {
      if (isApiError(error) && error.code === 'INVALID_REQUEST')
        callbacks.onInvalid()
    }
  })
}
