import { safeGetWithMetadata } from '@api/http'
import {
  getStudySessionV2RequestSchema,
  getStudySessionV2TransportResponseSchema
} from '@api/study/getStudySessionV2/schema'
import type { GetStudySessionV2TransportResponse } from '@api/study/getStudySessionV2/schema'

const requestStudySession = safeGetWithMetadata(
  getStudySessionV2TransportResponseSchema
)

export const getStudySessionV2 = (
  sessionId: string
): Promise<GetStudySessionV2TransportResponse> => {
  const request = getStudySessionV2RequestSchema.parse({ sessionId })

  return requestStudySession(`/v1/study-sessions/${request.sessionId}`, null, {
    headers: { 'X-Nihongo-Practice-Contract': '2' }
  })
}
