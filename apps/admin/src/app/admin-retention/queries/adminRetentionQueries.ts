import { queryOptions } from '@tanstack/react-query'
import { getAdminRetention } from '@nihongo/browser/api/admin-retention/index'

export const adminRetentionQueries = {
  allKey: () => ['admin-retention'] as const,
  table: (actorId: string | null) =>
    queryOptions({
      queryKey: [...adminRetentionQueries.allKey(), actorId] as const,
      queryFn: getAdminRetention,
      staleTime: 60_000,
      retry: false
    })
} as const
