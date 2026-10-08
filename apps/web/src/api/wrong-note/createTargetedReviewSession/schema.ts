import {
  createTargetedReviewSessionBodySchema,
  createTargetedReviewSessionHeadersSchema,
  createTargetedReviewSessionLocationSchema,
  createTargetedReviewSessionParamsSchema,
  createTargetedReviewSessionResponseSchema,
  createTargetedReviewSessionResponseForQuestionSchema
} from '@nihongo/contracts/wrong-note/create-targeted-review-session'
import { z } from 'zod'
import { createPracticeTransportResponseSchema } from '@api/study/practiceTransportSchema'

export const targetedReviewSessionParamsSchema =
  createTargetedReviewSessionParamsSchema
export const targetedReviewSessionHeadersSchema =
  createTargetedReviewSessionHeadersSchema
export const targetedReviewSessionBodySchema =
  createTargetedReviewSessionBodySchema

export const targetedReviewSessionTransportSchema =
  createPracticeTransportResponseSchema(
    createTargetedReviewSessionResponseSchema,
    z.literal(201)
  ).superRefine(({ data, headers }, context) => {
    if (!/^application\/json(?:\s*;|$)/iu.test(headers['content-type'] ?? '')) {
      context.addIssue({
        code: 'custom',
        path: ['headers', 'content-type'],
        message: 'targeted review 응답은 JSON이어야 합니다.'
      })
    }
    if (headers['x-nihongo-practice-contract'] !== '2') {
      context.addIssue({
        code: 'custom',
        path: ['headers', 'x-nihongo-practice-contract'],
        message: 'targeted review 응답에는 contract 2가 필요합니다.'
      })
    }
    if (
      !createTargetedReviewSessionLocationSchema(data.session.id).safeParse(
        headers.location
      ).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['headers', 'location'],
        message: 'targeted review Location이 target session과 다릅니다.'
      })
    }
  })

export type TargetedReviewSessionTransportResponse = z.output<
  typeof targetedReviewSessionTransportSchema
>

export {
  createTargetedReviewSessionLocationSchema,
  createTargetedReviewSessionResponseForQuestionSchema
}
