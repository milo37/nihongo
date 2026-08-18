import {
  cancelStudySessionBodySchema,
  cancelStudySessionParamsSchema
} from '@nihongo/contracts/study/cancel-study-session'
import { z } from 'zod'
import {
  createPracticeTransportResponseSchema,
  refinePracticeNoContentTransportHeaders
} from '@api/study/practiceTransportSchema'

export const cancelStudySessionRequestParamsSchema =
  cancelStudySessionParamsSchema
export const cancelStudySessionRequestBodySchema = cancelStudySessionBodySchema
export const cancelStudySessionTransportResponseSchema =
  createPracticeTransportResponseSchema(
    z.undefined(),
    z.literal(204)
  ).superRefine(({ headers }, context) => {
    refinePracticeNoContentTransportHeaders(headers, context)
    if (headers['x-nihongo-practice-contract'] !== '2') {
      context.addIssue({
        code: 'custom',
        path: ['headers', 'x-nihongo-practice-contract'],
        message: '취소 응답에는 practice contract 2가 필요합니다.'
      })
    }
  })

export type CancelStudySessionTransportResponse = z.output<
  typeof cancelStudySessionTransportResponseSchema
>
