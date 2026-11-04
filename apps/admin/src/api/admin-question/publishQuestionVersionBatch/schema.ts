import {
  publishQuestionVersionBatchRequestSchema,
  publishQuestionVersionBatchResponseSchema
} from '@nihongo/contracts/admin/review'
import type { z } from 'zod'
export {
  publishQuestionVersionBatchRequestSchema,
  publishQuestionVersionBatchResponseSchema
}
export type PublishQuestionVersionBatchRequest = z.input<
  typeof publishQuestionVersionBatchRequestSchema
>
export type PublishQuestionVersionBatchResponse = z.output<
  typeof publishQuestionVersionBatchResponseSchema
>
