import {
  listAdminAuditLogQuerySchema,
  type ListAdminAuditLogQuery
} from '@nihongo/contracts/admin/phase7'
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { listPhase7AdminAuditLog } from '@api/phase7/phase7AdminApi'
import { adminAuditLogKeys } from '@app/content-operations/audit/queries/auditLogKeys'

export const adminAuditLogQueries = {
  list: (input: ListAdminAuditLogQuery) => {
    const query = listAdminAuditLogQuerySchema.parse(input)
    return queryOptions({
      queryKey: adminAuditLogKeys.list(query),
      queryFn: () => listPhase7AdminAuditLog(query),
      staleTime: 15_000
    })
  },
  connection: (input: Omit<ListAdminAuditLogQuery, 'cursor'>) => {
    const query = listAdminAuditLogQuerySchema.parse(input)
    return infiniteQueryOptions({
      queryKey: [...adminAuditLogKeys.allLists(), 'connection', query] as const,
      queryFn: ({ pageParam }) =>
        listPhase7AdminAuditLog({
          ...query,
          ...(pageParam === null ? {} : { cursor: pageParam })
        }),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: 15_000
    })
  }
} as const
