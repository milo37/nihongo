import { mutationOptions } from '@tanstack/react-query'
import type {
  ValidateQuestionImportRequest,
  ApplyQuestionImportRequest
} from '@nihongo/contracts/admin/content-operations'
import { requestContentOperation } from '@nihongo/browser/api/content-operations/requestContentOperation'
export const adminImportMutations = {
  allKey: () => ['admin-content', 'import'] as const,
  validate: () =>
    mutationOptions({
      mutationKey: [...adminImportMutations.allKey(), 'validate'],
      mutationFn: (body: ValidateQuestionImportRequest) =>
        requestContentOperation({
          operation: 'validateQuestionImport',
          params: {},
          query: {},
          body
        })
    }),
  apply: () =>
    mutationOptions({
      mutationKey: [...adminImportMutations.allKey(), 'apply'],
      mutationFn: (body: ApplyQuestionImportRequest) =>
        requestContentOperation({
          operation: 'applyQuestionImport',
          params: {},
          query: {},
          body
        })
    })
}
