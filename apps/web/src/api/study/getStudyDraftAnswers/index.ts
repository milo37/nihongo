import { safeGetWithMetadata } from '@api/http'
import {
  getStudyDraftAnswersRequestSchema,
  getStudyDraftAnswersTransportResponseSchema
} from '@api/study/getStudyDraftAnswers/schema'
import type { GetStudyDraftAnswersTransportResponse } from '@api/study/getStudyDraftAnswers/schema'

const requestStudyDraft = safeGetWithMetadata(
  getStudyDraftAnswersTransportResponseSchema
)

export const getStudyDraftAnswers = (
  sessionId: string
): Promise<GetStudyDraftAnswersTransportResponse> => {
  const request = getStudyDraftAnswersRequestSchema.parse({ sessionId })

  return requestStudyDraft(
    `/v1/study-sessions/${request.sessionId}/draft-answers`,
    null,
    { headers: { 'X-Nihongo-Practice-Contract': '2' } }
  )
}
