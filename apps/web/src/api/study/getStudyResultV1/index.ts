import { safeGet } from '@api/http'
import {
  getStudyResultV1RequestSchema,
  getStudyResultV1ResponseSchema
} from '@api/study/getStudyResultV1/schema'
import type { GetStudyResultV1Response } from '@api/study/getStudyResultV1/schema'

const requestStudyResult = safeGet(getStudyResultV1ResponseSchema)

export const getStudyResultV1 = (
  sessionId: string
): Promise<GetStudyResultV1Response> => {
  const request = getStudyResultV1RequestSchema.parse({ sessionId })

  return requestStudyResult(`/v1/study-sessions/${request.sessionId}/result`)
}
