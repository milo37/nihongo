import { mutationOptions } from '@tanstack/react-query'
import type {
  ValidateQuestionImportRequest,
  ApplyQuestionImportRequest
} from '@nihongo/contracts/admin/phase7'
import { requestPhase7Operation } from '@nihongo/browser/api/phase7/requestPhase7Operation'
export const adminImportMutations = {
  allKey: () => ['phase7-admin', 'import'] as const,
  validate: () =>
    mutationOptions({
      mutationKey: [...adminImportMutations.allKey(), 'validate'],
      mutationFn: (body: ValidateQuestionImportRequest) =>
        requestPhase7Operation({
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
        requestPhase7Operation({
          operation: 'applyQuestionImport',
          params: {},
          query: {},
          body
        })
    })
}
