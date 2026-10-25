import {
  listResumableStudySessionsQuerySchema,
  listResumableStudySessionsResponseSchema
} from '@nihongo/contracts/study/list-resumable-study-sessions'
import { z } from 'zod'
import {
  createPracticeTransportResponseSchema,
  refinePracticeJsonTransportHeaders
} from '@api/study/practiceTransportSchema'

export const listResumableStudySessionsRequestSchema =
  listResumableStudySessionsQuerySchema
export const listResumableStudySessionsTransportResponseSchema =
  createPracticeTransportResponseSchema(
    listResumableStudySessionsResponseSchema,
    z.literal(200)
  ).superRefine(({ headers }, context) => {
    refinePracticeJsonTransportHeaders(headers, context, false)
    if (headers['x-nihongo-practice-contract'] !== '2') {
      context.addIssue({
        code: 'custom',
        path: ['headers', 'x-nihongo-practice-contract'],
        message: 'resumable 응답에는 practice contract 2가 필요합니다.'
      })
    }
  })

export type ListResumableStudySessionsRequest = z.input<
  typeof listResumableStudySessionsRequestSchema
>
export type ListResumableStudySessionsTransportResponse = z.output<
  typeof listResumableStudySessionsTransportResponseSchema
>
