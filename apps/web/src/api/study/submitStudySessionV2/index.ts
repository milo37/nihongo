import { safePostWithMetadata } from '@api/http'
import {
  submitStudySessionV2RequestBodySchema,
  submitStudySessionV2RequestHeadersSchema,
  submitStudySessionV2RequestParamsSchema,
  submitStudySessionV2TransportResponseSchema
} from '@api/study/submitStudySessionV2/schema'
import type {
  SubmitStudySessionV2Request,
  SubmitStudySessionV2TransportResponse
} from '@api/study/submitStudySessionV2/schema'

const requestSessionSubmission = safePostWithMetadata(
  submitStudySessionV2TransportResponseSchema
)

export const submitStudySessionV2 = (
  sessionId: string,
  input: SubmitStudySessionV2Request,
  idempotencyKey: string
): Promise<SubmitStudySessionV2TransportResponse> => {
  const params = submitStudySessionV2RequestParamsSchema.parse({ sessionId })
  const body = submitStudySessionV2RequestBodySchema.parse(input)
  const headers = submitStudySessionV2RequestHeadersSchema.parse({
    'idempotency-key': idempotencyKey,
    'x-nihongo-practice-contract': '2'
  })

  return requestSessionSubmission(
    `/v1/study-sessions/${params.sessionId}/submission`,
    body,
    {
      headers: {
        'Idempotency-Key': headers['idempotency-key'],
        'X-Nihongo-Practice-Contract': headers['x-nihongo-practice-contract']
      }
    }
  )
}
