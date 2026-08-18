import {
  createStudySessionBodySchema,
  createStudySessionV2ResponseSchema
} from '@nihongo/contracts/study/create-study-session'
import { z } from 'zod'
import {
  createPracticeTransportResponseSchema,
  refinePracticeJsonTransportHeaders
} from '@api/study/practiceTransportSchema'

export const createStudySessionV2RequestSchema = createStudySessionBodySchema
export const createStudySessionV2TransportResponseSchema =
  createPracticeTransportResponseSchema(
    createStudySessionV2ResponseSchema,
    z.literal(201)
  ).superRefine(({ headers }, context) => {
    refinePracticeJsonTransportHeaders(headers, context, false)
    if (headers['x-nihongo-practice-contract'] !== '2') {
      context.addIssue({
        code: 'custom',
        path: ['headers', 'x-nihongo-practice-contract'],
        message: 'v2 세션 생성 응답에는 practice contract 2가 필요합니다.'
      })
    }
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
