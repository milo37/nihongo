import {
  getStudySessionParamsSchema,
  getStudySessionV2ResponseSchema
} from '@nihongo/contracts/study/get-study-session'
import { z } from 'zod'
import {
  createPracticeTransportResponseSchema,
  refinePracticeJsonTransportHeaders
} from '@nihongo/browser/api/study/practiceTransportSchema'

export const getStudySessionV2RequestSchema = getStudySessionParamsSchema
export const getStudySessionV2TransportResponseSchema =
  createPracticeTransportResponseSchema(
    getStudySessionV2ResponseSchema,
    z.literal(200)
  ).superRefine(({ data, headers }, context) => {
    refinePracticeJsonTransportHeaders(headers, context, false)
    // #978: the web reads contract 2 only. The API never sends a contract 1
    // body (it answers 409 PRACTICE_CONTRACT_VERSION_MISMATCH), so the
    // screens below carry no v1 branch.
    if (
      headers['x-nihongo-practice-contract'] !== '2' ||
      data.session.practiceContractVersion !== 2
    ) {
      context.addIssue({
        code: 'custom',
        path: ['headers', 'x-nihongo-practice-contract'],
        message: 'session body와 practice contract header가 모두 2여야 합니다.'
      })
    }
  })

export type GetStudySessionV2TransportResponse = z.output<
  typeof getStudySessionV2TransportResponseSchema
>
