import { safePostWithMetadata } from '@api/http'
import { parseApiResponse } from '@api/config'
import {
  createTargetedReviewSessionLocationSchema,
  createTargetedReviewSessionResponseForQuestionSchema,
  targetedReviewSessionBodySchema,
  targetedReviewSessionHeadersSchema,
  targetedReviewSessionParamsSchema,
  targetedReviewSessionTransportSchema
} from '@api/wrong-note/createTargetedReviewSession/schema'
import type { TargetedReviewSessionTransportResponse } from '@api/wrong-note/createTargetedReviewSession/schema'

const requestTargetedReviewSession = safePostWithMetadata(
  targetedReviewSessionTransportSchema
)

export const createTargetedReviewSession = async (
  questionId: string,
  idempotencyKey: string
): Promise<TargetedReviewSessionTransportResponse> => {
  const params = targetedReviewSessionParamsSchema.parse({ questionId })
  const headers = targetedReviewSessionHeadersSchema.parse({
    'idempotency-key': idempotencyKey,
    'x-nihongo-practice-contract': '2'
  })
  const response = await requestTargetedReviewSession(
    `/v1/wrong-notes/${params.questionId}/review-session`,
    targetedReviewSessionBodySchema.parse({}),
    {
      headers: {
        'Idempotency-Key': headers['idempotency-key'],
        'X-Nihongo-Practice-Contract': headers['x-nihongo-practice-contract']
      }
    }
  )
  parseApiResponse(
    createTargetedReviewSessionResponseForQuestionSchema(params.questionId),
    response.data
  )
  parseApiResponse(
    createTargetedReviewSessionLocationSchema(response.data.session.id),
    response.headers.location
  )
  return response
}
