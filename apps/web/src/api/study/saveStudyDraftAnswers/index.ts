import { safePutWithMetadata } from '@api/http'
import {
  saveStudyDraftAnswersRequestBodySchema,
  saveStudyDraftAnswersRequestHeadersSchema,
  saveStudyDraftAnswersRequestParamsSchema,
  saveStudyDraftAnswersTransportResponseSchema
} from '@api/study/saveStudyDraftAnswers/schema'
import type {
  SaveStudyDraftAnswersRequest,
  SaveStudyDraftAnswersTransportResponse
} from '@api/study/saveStudyDraftAnswers/schema'

const requestDraftSave = safePutWithMetadata(
  saveStudyDraftAnswersTransportResponseSchema
)

export const saveStudyDraftAnswers = (
  sessionId: string,
  input: SaveStudyDraftAnswersRequest,
  idempotencyKey: string
): Promise<SaveStudyDraftAnswersTransportResponse> => {
  const params = saveStudyDraftAnswersRequestParamsSchema.parse({ sessionId })
  const body = saveStudyDraftAnswersRequestBodySchema.parse(input)
  const headers = saveStudyDraftAnswersRequestHeadersSchema.parse({
    'idempotency-key': idempotencyKey,
    'x-nihongo-practice-contract': '2'
  })

  return requestDraftSave(
    `/v1/study-sessions/${params.sessionId}/draft-answers`,
    body,
    {
      headers: {
        'Idempotency-Key': headers['idempotency-key'],
        'X-Nihongo-Practice-Contract': headers['x-nihongo-practice-contract']
      }
    }
  )
}
