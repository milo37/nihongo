import {
  adminReportMutationResponseSchema,
  getAdminReportResponseSchema,
  listAdminReportsResponseSchema,
  type CloseAdminReportRequest,
  type ListAdminReportsQuery,
  type ReplyAndCloseAdminReportRequest,
  type SaveAdminReportNoteRequest
} from '@nihongo/contracts/admin/reports'
import { safeGet, safePost } from '../http'

const REPORTS_PATH = '/v1/admin/reports'
const reportPath = (reportId: string): string =>
  `${REPORTS_PATH}/${encodeURIComponent(reportId)}`

const requestReports = safeGet(listAdminReportsResponseSchema)
const requestReport = safeGet(getAdminReportResponseSchema)
const requestCommand = safePost(adminReportMutationResponseSchema)

export const listAdminReports = (query: ListAdminReportsQuery) =>
  requestReports(REPORTS_PATH, query)

export const getAdminReport = (reportId: string) =>
  requestReport(reportPath(reportId))

export const replyAndCloseAdminReport = (
  reportId: string,
  body: ReplyAndCloseAdminReportRequest
) => requestCommand(`${reportPath(reportId)}/reply-and-close`, body)

export const saveAdminReportNote = (
  reportId: string,
  body: SaveAdminReportNoteRequest
) => requestCommand(`${reportPath(reportId)}/note`, body)

export const closeAdminReport = (
  reportId: string,
  body: CloseAdminReportRequest
) => requestCommand(`${reportPath(reportId)}/close`, body)
