import { queryOptions } from '@tanstack/react-query'
import { isApiError } from '@api/config'
import { getStudyResult } from '@api/study/getStudyResult'
import { getStudyResultV1 } from '@api/study/getStudyResultV1'
import {
  toCanonicalStudyResultView,
  toLegacyStudyResultView
} from '@app/practice/adapters/studyResultView'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { clearSubmissionAttempt } from '@app/practice/submissionAttemptStorage'
import { isMockApiMode } from '@libs/apiMode'
import { isNotFoundApiError } from '@util/apiError'

const getResult = async (sessionId: string) => {
  let result
  try {
    result = toCanonicalStudyResultView(await getStudyResultV1(sessionId))
  } catch (error: unknown) {
    if (
      !isMockApiMode ||
      (!isNotFoundApiError(error) &&
        !(isApiError(error) && error.code === 'AUTHENTICATION_REQUIRED'))
    ) {
      throw error
    }
    result = toLegacyStudyResultView(await getStudyResult(sessionId))
  }

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
