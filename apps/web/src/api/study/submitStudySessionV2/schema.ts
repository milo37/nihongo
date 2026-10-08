import {
  submitStudySessionParamsSchema,
  submitStudySessionV2HeadersSchema,
  submitStudySessionV2BodySchema,
  submitStudySessionV2ResponseSchema
} from '@nihongo/contracts/study/submit-study-session'
import { z } from 'zod'
import {
  createPracticeTransportResponseSchema,
  refinePracticeJsonTransportHeaders
} from '@api/study/practiceTransportSchema'

export const submitStudySessionV2RequestParamsSchema =
  submitStudySessionParamsSchema
export const submitStudySessionV2RequestBodySchema =
  submitStudySessionV2BodySchema
export const submitStudySessionV2RequestHeadersSchema =
  submitStudySessionV2HeadersSchema
export const submitStudySessionV2TransportResponseSchema =
  createPracticeTransportResponseSchema(
    submitStudySessionV2ResponseSchema,
    z.literal(201)
  ).superRefine(({ headers }, context) => {
    refinePracticeJsonTransportHeaders(headers, context, true)
    if (headers['x-nihongo-practice-contract'] !== '2') {
      context.addIssue({
        code: 'custom',
        path: ['headers', 'x-nihongo-practice-contract'],
        message: 'v2 제출 응답에는 practice contract 2가 필요합니다.'
      })
    }
  })

export type SubmitStudySessionV2Request = z.input<
  typeof submitStudySessionV2RequestBodySchema
>
export type ParsedSubmitStudySessionV2Request = z.output<
  typeof submitStudySessionV2RequestBodySchema
>
export type SubmitStudySessionV2TransportResponse = z.output<
  typeof submitStudySessionV2TransportResponseSchema
>
