import { safeGet } from '@api/http'
import {
  listReviewEventsRequestParamsSchema,
  listReviewEventsRequestQuerySchema,
  listReviewEventsResultSchema
} from '@api/wrong-note/listReviewEvents/schema'
import type { ListReviewEventsQuery } from '@api/wrong-note/listReviewEvents/schema'

const requestReviewEvents = safeGet(listReviewEventsResultSchema)

export const listReviewEvents = (
  questionId: string,
  input: ListReviewEventsQuery
) => {
  const params = listReviewEventsRequestParamsSchema.parse({ questionId })
  const query = listReviewEventsRequestQuerySchema.parse(input)
  return requestReviewEvents(
    `/v1/wrong-notes/${params.questionId}/review-events`,
    query
  )
}
