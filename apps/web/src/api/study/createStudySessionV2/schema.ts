import {
  createStudySessionV2BodySchema,
  createStudySessionV2ResponseSchema
} from '@nihongo/contracts/study/create-study-session'
import { z } from 'zod'
import {
  createPracticeTransportResponseSchema,
  refinePracticeContractV2Header,
  refinePracticeJsonTransportHeaders
} from '@nihongo/browser/api/study/practiceTransportSchema'

export const createStudySessionV2RequestSchema = createStudySessionV2BodySchema
export const createStudySessionV2TransportResponseSchema =
  createPracticeTransportResponseSchema(
    createStudySessionV2ResponseSchema,
    z.literal(201)
  ).superRefine(({ headers }, context) => {
    refinePracticeJsonTransportHeaders(headers, context, false)
    refinePracticeContractV2Header(
      headers,
      context,
      'v2 세션 생성 응답에는 practice contract 2가 필요합니다.'
    )
    if (headers['idempotency-replayed'] !== null) {
      context.addIssue({
        code: 'custom',
        path: ['headers', 'idempotency-replayed'],
        message: '세션 생성 응답에는 replay header가 없어야 합니다.'
      })
    }
  })

export type CreateStudySessionV2Request = z.input<
  typeof createStudySessionV2RequestSchema
>
export type CreateStudySessionV2TransportResponse = z.output<
  typeof createStudySessionV2TransportResponseSchema
>
