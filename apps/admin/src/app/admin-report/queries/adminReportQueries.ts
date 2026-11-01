import { mutationOptions, queryOptions } from '@tanstack/react-query'
import type {
  ListAdminQuestionReportsQuery,
  ResolveAdminQuestionReportRequest,
  TriageAdminQuestionReportRequest
} from '@nihongo/contracts/admin/content-operations'
import { requestContentOperation } from '@nihongo/browser/api/content-operations/requestContentOperation'

export const adminReportQueries = {
  allKey: () => ['admin-content', 'reports'] as const,
  list: (
    actorId: string | null,
    epoch: number,
    query: ListAdminQuestionReportsQuery
  ) =>
    queryOptions({
      queryKey: [
        ...adminReportQueries.allKey(),
        'list',
        actorId,
        epoch,
        query
      ] as const,
      queryFn: () =>
        requestContentOperation({
          operation: 'listAdminQuestionReports',
          params: {},
          query,
          body: undefined
        }),
      staleTime: 15_000,
      retry: false
    }),
  detail: (actorId: string | null, epoch: number, reportId: string) =>
    queryOptions({
      queryKey: [
        ...adminReportQueries.allKey(),
        'detail',
        actorId,
        epoch,
        reportId
      ] as const,
      queryFn: () =>
        requestContentOperation({
          operation: 'getAdminQuestionReport',
          params: { reportId },
          query: {},
          body: undefined
        }),
      staleTime: 15_000,
      retry: false
    })
} as const
export const adminReportMutations = {
  triage: (reportId: string) =>
    mutationOptions({
      mutationKey: [
        ...adminReportQueries.allKey(),
        'triage',
        reportId
      ] as const,
      mutationFn: (body: TriageAdminQuestionReportRequest) =>
        requestContentOperation({
          operation: 'triageAdminQuestionReport',
          params: { reportId },
          query: {},
          body
        })
    }),
  resolve: (reportId: string) =>
    mutationOptions({
      mutationKey: [
        ...adminReportQueries.allKey(),
        'resolve',
        reportId
      ] as const,
      mutationFn: (body: ResolveAdminQuestionReportRequest) =>
        requestContentOperation({
          operation: 'resolveAdminQuestionReport',
          params: { reportId },
          query: {},
          body
        })
    })
} as const
