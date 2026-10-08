import {
  getStudySessionParamsSchema,
  getStudySessionV2ResponseSchema
} from '@nihongo/contracts/study/get-study-session'
import { z } from 'zod'
import {
  createPracticeTransportResponseSchema,
  refinePracticeJsonTransportHeaders
} from '@api/study/practiceTransportSchema'

export const getStudySessionV2RequestSchema = getStudySessionParamsSchema
export const getStudySessionV2TransportResponseSchema =
  createPracticeTransportResponseSchema(
    getStudySessionV2ResponseSchema,
    z.literal(200)
  ).superRefine(({ data, headers }, context) => {
    refinePracticeJsonTransportHeaders(headers, context, false)
    if (
      headers['x-nihongo-practice-contract'] !==
      String(data.session.practiceContractVersion)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['headers', 'x-nihongo-practice-contract'],
        message: 'session body와 practice contract header가 일치해야 합니다.'
      })
    }
  })

export type GetStudySessionV2TransportResponse = z.output<
  typeof getStudySessionV2TransportResponseSchema
>
