import { queryOptions } from '@tanstack/react-query'
import { getDailyQuestion } from '@api/question/getDailyQuestion'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'

export const dailyQuestionQueries = {
  // The question changes at midnight Korea time; an hour is fresh enough.
  get: (level: JlptLevel) =>
    queryOptions({
      queryKey: serverStateQueryKeys.dailyQuestion(level),
      queryFn: ({ signal }) => getDailyQuestion({ level }, signal),
      staleTime: 60 * 60 * 1000,
      retry: false,
      meta: { localErrorUi: true }
    })
} as const
