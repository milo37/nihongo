import { infiniteQueryOptions } from '@tanstack/react-query'
import { requestContentOperation } from '@nihongo/browser/api/content-operations/requestContentOperation'

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
        requestContentOperation({
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
