import {
  saveStudyDraftAnswersBodySchema,
  saveStudyDraftAnswersHeadersSchema,
  saveStudyDraftAnswersParamsSchema,
  saveStudyDraftAnswersResponseSchema
} from '@nihongo/contracts/study/save-study-draft-answers'
import { z } from 'zod'
import {
  createPracticeTransportResponseSchema,
  refinePracticeJsonTransportHeaders
} from '@api/study/practiceTransportSchema'

export const saveStudyDraftAnswersRequestParamsSchema =
  saveStudyDraftAnswersParamsSchema
export const saveStudyDraftAnswersRequestBodySchema =
  saveStudyDraftAnswersBodySchema
export const saveStudyDraftAnswersRequestHeadersSchema =
  saveStudyDraftAnswersHeadersSchema
export const saveStudyDraftAnswersTransportResponseSchema =
  createPracticeTransportResponseSchema(
    saveStudyDraftAnswersResponseSchema,
    z.literal(200)
  ).superRefine(({ headers }, context) => {
    refinePracticeJsonTransportHeaders(headers, context, true)
    if (headers['x-nihongo-practice-contract'] !== '2') {
      context.addIssue({
        code: 'custom',
        path: ['headers', 'x-nihongo-practice-contract'],
        message: 'draft 저장 응답에는 practice contract 2가 필요합니다.'
      })
    }
  })

export type SaveStudyDraftAnswersRequest = z.input<
  typeof saveStudyDraftAnswersRequestBodySchema
>
export type ParsedSaveStudyDraftAnswersRequest = z.output<
  typeof saveStudyDraftAnswersRequestBodySchema
>
export type SaveStudyDraftAnswersTransportResponse = z.output<
  typeof saveStudyDraftAnswersTransportResponseSchema
>
