import {
  cancelStudySessionBodySchema,
  cancelStudySessionParamsSchema
} from '@nihongo/contracts/study/cancel-study-session'
import { z } from 'zod'
import {
  createPracticeTransportResponseSchema,
  refinePracticeContractV2Header,
  refinePracticeNoContentTransportHeaders
} from '@nihongo/browser/api/study/practiceTransportSchema'

export const cancelStudySessionRequestParamsSchema =
  cancelStudySessionParamsSchema
export const cancelStudySessionRequestBodySchema = cancelStudySessionBodySchema
export const cancelStudySessionTransportResponseSchema =
  createPracticeTransportResponseSchema(
    z.undefined(),
    z.literal(204)
  ).superRefine(({ headers }, context) => {
    refinePracticeNoContentTransportHeaders(headers, context)
    refinePracticeContractV2Header(
      headers,
      context,
      '취소 응답에는 practice contract 2가 필요합니다.'
    )
  })

export type CancelStudySessionTransportResponse = z.output<
  typeof cancelStudySessionTransportResponseSchema
>
