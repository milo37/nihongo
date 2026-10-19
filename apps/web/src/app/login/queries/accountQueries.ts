import { queryOptions } from '@tanstack/react-query'
import { getSsoAccounts } from '@api/auth/getSsoAccounts'
import { getSsoDeletion } from '@api/auth/getSsoDeletion'
import { accountRequest } from '@app/login/accountFlowErrors'
export const accountQueries = {
  allKey: () => ['sso-account'] as const,
  capabilities: (userId: string) =>
    queryOptions({
      queryKey: ['sso-account', 'capabilities', userId] as const,
      queryFn: () => accountRequest(getSsoAccounts),
      staleTime: 0,
      retry: false,
      refetchOnWindowFocus: false
    }),
  deletion: () =>
    queryOptions({
      queryKey: ['sso-account', 'deletion'] as const,
      queryFn: () => accountRequest(getSsoDeletion),
      staleTime: 0,
      retry: false,
      refetchOnWindowFocus: false
    })
}
