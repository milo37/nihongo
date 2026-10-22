import {
  listReviewQueueQuerySchema,
  listReviewQueueResponseSchema
} from '@nihongo/contracts/wrong-note/list-review-queue'
import type { ListReviewQueueQuery } from '@nihongo/contracts/wrong-note/list-review-queue'

export const listReviewQueueRequestSchema = listReviewQueueQuerySchema
export const listReviewQueueResultSchema = listReviewQueueResponseSchema

export type ListReviewQueueRequest = ListReviewQueueQuery
