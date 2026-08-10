import { safeGet } from '@api/http'
import {
  getStudyResultRequestSchema,
  getStudyResultResponseSchema
} from '@api/study/getStudyResult/schema'
import type { GetStudyResultResponse } from '@api/study/getStudyResult/schema'

const requestStudyResult = safeGet(getStudyResultResponseSchema)

export const getStudyResult = (
  sessionId: string
): Promise<GetStudyResultResponse> => {
  const request = getStudyResultRequestSchema.parse({ sessionId })

  return requestStudyResult(`/study/session/${request.sessionId}/result`)
}
