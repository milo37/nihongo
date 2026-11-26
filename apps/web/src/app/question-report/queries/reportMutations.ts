import { mutationOptions } from '@tanstack/react-query'
import type { CreateReportRequest } from '@nihongo/contracts/report/reports'
import { createReport } from '@api/report/createReport'

export const reportMutations = {
  create: () =>
    mutationOptions({
      mutationKey: ['report', 'create'] as const,
      networkMode: 'always',
      meta: { localErrorUi: true },
      mutationFn: (request: CreateReportRequest) => createReport(request)
    })
} as const
