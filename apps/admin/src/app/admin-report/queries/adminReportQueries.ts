import { mutationOptions, queryOptions } from '@tanstack/react-query'
import type {
  ListAdminQuestionReportsQuery,
  ResolveAdminQuestionReportRequest,
  TriageAdminQuestionReportRequest
} from '@nihongo/contracts/admin/phase7'
import { requestPhase7Operation } from '@nihongo/browser/api/phase7/requestPhase7Operation'

export const adminReportQueries = {
  allKey: () => ['phase7-admin', 'reports'] as const,
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
        requestPhase7Operation({
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
        requestPhase7Operation({
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
        requestPhase7Operation({
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
        requestPhase7Operation({
          operation: 'resolveAdminQuestionReport',
          params: { reportId },
          query: {},
          body
        })
    })
} as const
