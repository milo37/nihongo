import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'
import { uniqueKeys } from '@app/content-operations/queries/uniqueInvalidationKeys'
import { adminQuestionReportKeys } from '@app/content-operations/reports/queries/questionReportKeys'

export interface CreatedQuestionReportInvalidationTarget {
  readonly questionIds?: readonly string[]
  readonly reportId?: string
}

export const invalidateCreatedQuestionReportCaches = async (
  queryClient: QueryClient,
  target: CreatedQuestionReportInvalidationTarget
): Promise<void> => {
  const questionIds = target.questionIds ?? []
  const keys: QueryKey[] = [serverStateQueryKeys.phase7AdminQuestion.lists()]

  questionIds.forEach((questionId) => {
    keys.push(serverStateQueryKeys.phase7AdminQuestion.detail(questionId))
  })
  keys.push(adminQuestionReportKeys.allLists())
  if (target.reportId) {
    keys.push(adminQuestionReportKeys.detail(target.reportId))
  }

  await Promise.all(
    uniqueKeys(keys).map((queryKey) =>
      queryClient.invalidateQueries({ queryKey })
    )
  )
}
