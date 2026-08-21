import { queryOptions } from '@tanstack/react-query'
import { getStudyResultV1 } from '@api/study/getStudyResultV1'
import { toCanonicalStudyResultView } from '@app/practice/adapters/studyResultView'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { clearSubmissionAttempt } from '@app/practice/submissionAttemptStorage'

const getResult = async (sessionId: string) => {
  const result = toCanonicalStudyResultView(await getStudyResultV1(sessionId))
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
