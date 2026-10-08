import { safePostWithMetadata } from '@api/http'
import {
  cancelStudySessionRequestBodySchema,
  cancelStudySessionRequestParamsSchema,
  cancelStudySessionTransportResponseSchema
} from '@api/study/cancelStudySession/schema'
import type { CancelStudySessionTransportResponse } from '@api/study/cancelStudySession/schema'

const requestSessionCancellation = safePostWithMetadata(
  cancelStudySessionTransportResponseSchema
)

export const cancelStudySession = (
  sessionId: string
): Promise<CancelStudySessionTransportResponse> => {
  const params = cancelStudySessionRequestParamsSchema.parse({ sessionId })

  return requestSessionCancellation(
    `/v1/study-sessions/${params.sessionId}/cancellation`,
    cancelStudySessionRequestBodySchema.parse({}),
    { headers: { 'X-Nihongo-Practice-Contract': '2' } }
  )
}
