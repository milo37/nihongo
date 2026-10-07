import type { QueryClient } from '@tanstack/react-query'
import { adminReportReasonKey } from '@app/admin/presentation/adminPresentation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import {
  invalidatePhase7AdminMutation,
  type Phase7InvalidationTarget
} from '@app/admin-question/queries/phase7AdminInvalidation'

type CreatedQuestionReportTarget = Pick<
  Phase7InvalidationTarget,
  'questionIds' | 'reportId'
> & { readonly kind: 'REPORT_CREATE' }

export const questionReportReasonKey = adminReportReasonKey

export const useQuestionReportPresentation = () => {
  const { presentError, presentFieldError, t } = useAdminPresentation()
  return { presentError, presentFieldError, t }
}

export const invalidateCreatedQuestionReport = (
  queryClient: QueryClient,
  target: CreatedQuestionReportTarget
): Promise<void> => invalidatePhase7AdminMutation(queryClient, target)
