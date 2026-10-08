import { mutationOptions } from '@tanstack/react-query'
import type { CreateQuestionReportRequest } from '@nihongo/contracts/admin/phase7'
import { createPhase7QuestionReport } from '@api/phase7/phase7AdminApi'

interface CreatePhase7QuestionReportInput {
  readonly questionId: string
  readonly request: CreateQuestionReportRequest
}

export const questionReportMutations = {
  create: () =>
    mutationOptions({
      mutationKey: ['phase7', 'question-report'] as const,
      networkMode: 'always',
      mutationFn: (input: CreatePhase7QuestionReportInput) =>
        createPhase7QuestionReport(input.request)
    })
} as const
