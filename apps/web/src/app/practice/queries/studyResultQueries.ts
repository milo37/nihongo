import { queryOptions } from '@tanstack/react-query'
import { getStudyResult } from '@api/study/getStudyResult'
import { getStudyResultV1 } from '@api/study/getStudyResultV1'
import {
  toCanonicalStudyResultView,
  toLegacyStudyResultView
} from '@app/practice/adapters/studyResultView'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { clearSubmissionAttempt } from '@app/practice/submissionAttemptStorage'
import { isMockApiMode } from '@libs/apiMode'

const getResult = async (sessionId: string) => {
  const result = isMockApiMode
    ? toLegacyStudyResultView(await getStudyResult(sessionId))
    : toCanonicalStudyResultView(await getStudyResultV1(sessionId))

  clearSubmissionAttempt(sessionId)

  return result
}

export const studyResultQueries = {
  result: (sessionId: string) =>
    queryOptions({
      queryKey: serverStateQueryKeys.study.result(sessionId),
      queryFn: () => getResult(sessionId),
      enabled: sessionId.length > 0,
      staleTime: Number.POSITIVE_INFINITY,
      retry: false
    })
} as const
