import { safePost } from '@api/http'
import {
  reviewWrongNoteParamsSchema,
  reviewWrongNoteRequestSchema,
  reviewWrongNoteResponseSchema
} from '@api/wrong-note/reviewWrongNote/schema'
import type {
  ReviewWrongNoteRequest,
  ReviewWrongNoteResponse
} from '@api/wrong-note/reviewWrongNote/schema'

const requestWrongNoteReview = safePost(reviewWrongNoteResponseSchema)

export const reviewWrongNote = (
  questionId: string,
  input: ReviewWrongNoteRequest
): Promise<ReviewWrongNoteResponse> => {
  const params = reviewWrongNoteParamsSchema.parse({ questionId })
  const request = reviewWrongNoteRequestSchema.parse(input)

  return requestWrongNoteReview(
    `/wrong-note/${params.questionId}/review`,
    request
  )
}
