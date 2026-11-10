import { safeGet } from '@nihongo/browser/api/http'
import {
  listReviewListRequestSchema,
  listReviewListResultSchema
} from '@api/wrong-note/listReviewList/schema'
import type { ListReviewListRequest } from '@api/wrong-note/listReviewList/schema'

const requestReviewList = safeGet(listReviewListResultSchema)

export const listReviewList = (input: ListReviewListRequest) => {
  const query = listReviewListRequestSchema.parse(input)
  return requestReviewList('/v1/review-list', query)
}
