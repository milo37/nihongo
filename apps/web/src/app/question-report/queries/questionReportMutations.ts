import { mutationOptions } from '@tanstack/react-query'
import type { CreateQuestionReportRequest } from '@nihongo/contracts/admin/phase7'
import { createQuestionReport } from '@api/content-operations/contentOperationsApi'

interface CreateQuestionReportInput {
  readonly questionId: string
  readonly request: CreateQuestionReportRequest
}

export const questionReportMutations = {
  create: () =>
    mutationOptions({
      mutationKey: ['phase7', 'question-report'] as const,
      networkMode: 'always',
      mutationFn: (input: CreateQuestionReportInput) =>
        createQuestionReport(input.request)
    })
} as const
