import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

export const useQuestionReportPresentation = () => {
  const { presentError, presentFieldError, t } = useAdminPresentation()
  return { presentError, presentFieldError, t }
}
