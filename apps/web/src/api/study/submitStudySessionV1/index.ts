import { safePost } from '@api/http'
import {
  submitStudySessionV1HeadersSchema,
  submitStudySessionV1ParamsSchema,
  submitStudySessionV1RequestSchema
} from '@api/study/submitStudySessionV1/requestSchema'
import type { SubmitStudySessionV1Request } from '@api/study/submitStudySessionV1/requestSchema'
import { submitStudySessionV1ResponseSchema } from '@api/study/submitStudySessionV1/schema'
import type { SubmitStudySessionV1Response } from '@api/study/submitStudySessionV1/schema'

const requestSessionSubmission = safePost(submitStudySessionV1ResponseSchema)

export const submitStudySessionV1 = (
  sessionId: string,
  input: SubmitStudySessionV1Request,
  idempotencyKey: string
): Promise<SubmitStudySessionV1Response> => {
  const params = submitStudySessionV1ParamsSchema.parse({ sessionId })
  const request = submitStudySessionV1RequestSchema.parse(input)
  const headers = submitStudySessionV1HeadersSchema.parse({
    'idempotency-key': idempotencyKey
  })

  return requestSessionSubmission(
    `/v1/study-sessions/${params.sessionId}/submission`,
    request,
    { headers: { 'Idempotency-Key': headers['idempotency-key'] } }
  )
}
