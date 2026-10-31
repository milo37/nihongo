import type { ListAdminQuestionReportsQuery } from '@nihongo/contracts/admin/phase7'

const rootKey = ['admin-content'] as const

export const adminQuestionReportKeys = {
  all: () => [...rootKey, 'question-reports'] as const,
  allLists: () => [...adminQuestionReportKeys.all(), 'list'] as const,
  list: (query: ListAdminQuestionReportsQuery) =>
    [...adminQuestionReportKeys.allLists(), query] as const,
  details: () => [...adminQuestionReportKeys.all(), 'detail'] as const,
  detail: (reportId: string) =>
    [...adminQuestionReportKeys.details(), reportId] as const
} as const
