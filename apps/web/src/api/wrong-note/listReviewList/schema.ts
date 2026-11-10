import {
  listReviewListQuerySchema,
  listReviewListResponseSchema
} from '@nihongo/contracts/wrong-note/list-review-list'
import type { ListReviewListQuery } from '@nihongo/contracts/wrong-note/list-review-list'

export const listReviewListRequestSchema = listReviewListQuerySchema
export const listReviewListResultSchema = listReviewListResponseSchema

export type ListReviewListRequest = ListReviewListQuery
