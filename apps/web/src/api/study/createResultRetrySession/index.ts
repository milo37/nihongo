import { safePostWithMetadata } from '@api/http'
import {
  createResultRetrySessionRequestBodySchema,
  createResultRetrySessionRequestHeadersSchema,
  createResultRetrySessionRequestParamsSchema,
  createResultRetrySessionTransportResponseSchema
} from '@api/study/createResultRetrySession/schema'
import type { CreateResultRetrySessionTransportResponse } from '@api/study/createResultRetrySession/schema'

const requestResultRetryCreation = safePostWithMetadata(
  createResultRetrySessionTransportResponseSchema
)

export const createResultRetrySession = (
  sourceSessionId: string,
  idempotencyKey: string
): Promise<CreateResultRetrySessionTransportResponse> => {
  const params = createResultRetrySessionRequestParamsSchema.parse({
    sessionId: sourceSessionId
  })
  const headers = createResultRetrySessionRequestHeadersSchema.parse({
    'idempotency-key': idempotencyKey,
    'x-nihongo-practice-contract': '2'
  })

  return requestResultRetryCreation(
    `/v1/study-sessions/${params.sessionId}/retry`,
    createResultRetrySessionRequestBodySchema.parse({}),
    {
      headers: {
        'Idempotency-Key': headers['idempotency-key'],
        'X-Nihongo-Practice-Contract': headers['x-nihongo-practice-contract']
      }
    }
  )
}
