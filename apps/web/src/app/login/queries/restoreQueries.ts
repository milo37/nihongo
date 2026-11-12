import { mutationOptions, queryOptions } from '@tanstack/react-query'
import { declineSsoAccountRestore } from '@api/auth/declineSsoAccountRestore'
import { getSsoRestore } from '@api/auth/getSsoRestore'
import { restoreSsoAccount } from '@api/auth/restoreSsoAccount'
import { accountRequest } from '@app/account/accountFlowErrors'

// JLP-845: the restore offer after signing in to an account in its erasure
// grace period. The server holds the proof in a short-lived cookie.
export const restoreQueries = {
  allKey: () => ['sso-restore'] as const,
  state: () =>
    queryOptions({
      queryKey: ['sso-restore', 'state'] as const,
      queryFn: () => accountRequest(getSsoRestore),
      staleTime: Infinity,
      retry: false,
      refetchOnWindowFocus: false
    })
}

export const restoreMutations = {
  restore: () =>
    mutationOptions({
      mutationKey: [...restoreQueries.allKey(), 'restore'],
      retry: false,
      networkMode: 'always',
      mutationFn: () => accountRequest(restoreSsoAccount)
    }),
  decline: () =>
    mutationOptions({
      mutationKey: [...restoreQueries.allKey(), 'decline'],
      retry: false,
      networkMode: 'always',
      mutationFn: () => accountRequest(declineSsoAccountRestore)
    })
}
