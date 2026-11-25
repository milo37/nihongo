import { queryOptions } from '@tanstack/react-query'
import { getStudyResultV1 } from '@api/study/getStudyResultV1'
import { toCanonicalStudyResultView } from '@app/practice/adapters/studyResultView'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'

const getResult = async (sessionId: string) =>
  toCanonicalStudyResultView(await getStudyResultV1(sessionId))

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
