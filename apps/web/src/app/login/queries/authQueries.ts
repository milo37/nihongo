import { queryOptions } from '@tanstack/react-query'
import { getCurrentUser } from '@api/auth/getCurrentUser'

export const authQueries = {
  allKey: () => ['auth'] as const,
  currentUser: () =>
    queryOptions({
      queryKey: [...authQueries.allKey(), 'get-current-user'] as const,
      queryFn: getCurrentUser,
      staleTime: Number.POSITIVE_INFINITY
    })
} as const
