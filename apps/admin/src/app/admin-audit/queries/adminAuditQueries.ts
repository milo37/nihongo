import { infiniteQueryOptions } from '@tanstack/react-query'
import { requestPhase7Operation } from '@nihongo/browser/api/phase7/requestPhase7Operation'

export const adminAuditQueries = {
  allKey: () => ['phase7-admin', 'audit-log'] as const,
  connection: (actorId: string | null) =>
    infiniteQueryOptions({
      queryKey: [
        ...adminAuditQueries.allKey(),
        'connection',
        actorId,
        { limit: 50 }
      ] as const,
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) =>
        requestPhase7Operation({
          operation: 'listAdminAuditLog',
          params: {},
          query: {
            limit: 50,
            ...(pageParam === undefined ? {} : { cursor: pageParam })
          },
          body: undefined
        }),
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: 15_000
    })
} as const
