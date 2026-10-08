import {
  getStudyDraftAnswersParamsSchema,
  getStudyDraftAnswersResponseSchema
} from '@nihongo/contracts/study/get-study-draft-answers'
import { z } from 'zod'
import {
  createPracticeTransportResponseSchema,
  refinePracticeJsonTransportHeaders
} from '@api/study/practiceTransportSchema'

export const getStudyDraftAnswersRequestSchema =
  getStudyDraftAnswersParamsSchema
export const getStudyDraftAnswersTransportResponseSchema =
  createPracticeTransportResponseSchema(
    getStudyDraftAnswersResponseSchema,
    z.literal(200)
  ).superRefine(({ headers }, context) => {
    refinePracticeJsonTransportHeaders(headers, context, false)
    if (headers['x-nihongo-practice-contract'] !== '2') {
      context.addIssue({
        code: 'custom',
        path: ['headers', 'x-nihongo-practice-contract'],
        message: 'draft 응답에는 practice contract 2가 필요합니다.'
      })
    }
  })

export type GetStudyDraftAnswersTransportResponse = z.output<
  typeof getStudyDraftAnswersTransportResponseSchema
>
