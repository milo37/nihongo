import type { QueryClient } from '@tanstack/react-query'
import { adminReportReasonKey } from '@app/content-operations/reports/presentation/questionReportPresentation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import {
  invalidateCreatedQuestionReportCaches,
  type CreatedQuestionReportInvalidationTarget
} from '@app/content-operations/reports/queries/questionReportInvalidation'

type CreatedQuestionReportTarget = CreatedQuestionReportInvalidationTarget & {
  readonly kind: 'REPORT_CREATE'
}

export const questionReportReasonKey = adminReportReasonKey

export const useQuestionReportPresentation = () => {
  const { presentError, presentFieldError, t } = useAdminPresentation()
  return { presentError, presentFieldError, t }
}

export const invalidateCreatedQuestionReport = (
  queryClient: QueryClient,
  target: CreatedQuestionReportTarget
): Promise<void> => invalidateCreatedQuestionReportCaches(queryClient, target)
