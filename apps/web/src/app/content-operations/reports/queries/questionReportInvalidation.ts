import type { QueryClient, QueryKey } from '@tanstack/react-query'
import {
  adminQuestionKeys,
  adminQuestionReportKeys
} from '@app/admin-question/queries/phase7AdminQueries'
import { uniqueKeys } from '@app/content-operations/queries/uniqueInvalidationKeys'

export interface CreatedQuestionReportInvalidationTarget {
  readonly questionIds?: readonly string[]
  readonly reportId?: string
}

export const invalidateCreatedQuestionReportCaches = async (
  queryClient: QueryClient,
  target: CreatedQuestionReportInvalidationTarget
): Promise<void> => {
  const questionIds = target.questionIds ?? []
  const keys: QueryKey[] = [adminQuestionKeys.allLists()]

  questionIds.forEach((questionId) => {
    keys.push(adminQuestionKeys.detail(questionId))
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
