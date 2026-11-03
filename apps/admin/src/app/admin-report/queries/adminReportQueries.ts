import { mutationOptions, queryOptions } from '@tanstack/react-query'
import type {
  CloseAdminReportRequest,
  ListAdminReportsQuery,
  ReplyAndCloseAdminReportRequest,
  SaveAdminReportNoteRequest
} from '@nihongo/contracts/admin/reports'
import {
  closeAdminReport,
  getAdminReport,
  listAdminReports,
  replyAndCloseAdminReport,
  saveAdminReportNote
} from '@nihongo/browser/api/admin-report/index'

export const adminReportQueries = {
  allKey: () => ['admin-content', 'reports'] as const,
  list: (actorId: string | null, epoch: number, query: ListAdminReportsQuery) =>
    queryOptions({
      queryKey: [
        ...adminReportQueries.allKey(),
        'list',
        actorId,
        epoch,
        query
      ] as const,
      queryFn: () => listAdminReports(query),
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
      queryFn: () => getAdminReport(reportId),
      staleTime: 15_000,
      retry: false
    })
} as const

export const adminReportMutations = {
  replyAndClose: (reportId: string) =>
    mutationOptions({
      mutationKey: [
        ...adminReportQueries.allKey(),
        'reply-and-close',
        reportId
      ],
      mutationFn: (body: ReplyAndCloseAdminReportRequest) =>
        replyAndCloseAdminReport(reportId, body)
    }),
  note: (reportId: string) =>
    mutationOptions({
      mutationKey: [...adminReportQueries.allKey(), 'note', reportId],
      mutationFn: (body: SaveAdminReportNoteRequest) =>
        saveAdminReportNote(reportId, body)
    }),
  close: (reportId: string) =>
    mutationOptions({
      mutationKey: [...adminReportQueries.allKey(), 'close', reportId],
      mutationFn: (body: CloseAdminReportRequest) =>
        closeAdminReport(reportId, body)
    })
} as const
