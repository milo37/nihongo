import {
  createResultRetrySessionBodySchema,
  createResultRetrySessionHeadersSchema,
  createResultRetrySessionParamsSchema,
  createResultRetrySessionResponseSchema
} from '@nihongo/contracts/study/create-result-retry-session'
import { z } from 'zod'
import { createPracticeTransportResponseSchema } from '@api/study/practiceTransportSchema'

export const createResultRetrySessionRequestParamsSchema =
  createResultRetrySessionParamsSchema
export const createResultRetrySessionRequestBodySchema =
  createResultRetrySessionBodySchema
export const createResultRetrySessionRequestHeadersSchema =
  createResultRetrySessionHeadersSchema

export const createResultRetrySessionTransportResponseSchema =
  createPracticeTransportResponseSchema(
    createResultRetrySessionResponseSchema,
    z.literal(201)
  ).superRefine(({ data, headers }, context) => {
    if (
      !headers['content-type']?.toLowerCase().startsWith('application/json')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['headers', 'content-type'],
        message: 'retry 생성 응답에는 JSON Content-Type이 필요합니다.'
      })
    }
    if (headers['x-nihongo-practice-contract'] !== '2') {
      context.addIssue({
        code: 'custom',
        path: ['headers', 'x-nihongo-practice-contract'],
        message: 'retry 생성 응답에는 practice contract 2가 필요합니다.'
      })
    }
    const expectedLocation = `/api/v1/study-sessions/${data.session.id}`
    if (headers.location !== expectedLocation) {
      context.addIssue({
        code: 'custom',
        path: ['headers', 'location'],
        message: 'retry Location은 생성된 target session을 가리켜야 합니다.'
      })
    }
  })

export type CreateResultRetrySessionTransportResponse = z.output<
  typeof createResultRetrySessionTransportResponseSchema
>
