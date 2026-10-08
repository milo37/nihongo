import { safeGet } from '@api/http'
import {
  listReviewQueueRequestSchema,
  listReviewQueueResultSchema
} from '@api/wrong-note/listReviewQueue/schema'
import type { ListReviewQueueRequest } from '@api/wrong-note/listReviewQueue/schema'

const requestReviewQueue = safeGet(listReviewQueueResultSchema)

export const listReviewQueue = (input: ListReviewQueueRequest) => {
  const query = listReviewQueueRequestSchema.parse(input)
  return requestReviewQueue('/v1/review-queue', query)
}
