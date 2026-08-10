import { safeDel } from '@api/http'
import {
  deleteBookmarkRequestSchema,
  deleteBookmarkResponseSchema
} from '@api/bookmark/deleteBookmark/schema'
import type { DeleteBookmarkResponse } from '@api/bookmark/deleteBookmark/schema'

const requestBookmarkDeletion = safeDel(deleteBookmarkResponseSchema)

export const deleteBookmark = (
  questionId: string
): Promise<DeleteBookmarkResponse> => {
  const request = deleteBookmarkRequestSchema.parse({ questionId })

  return requestBookmarkDeletion(`/bookmark/${request.questionId}`)
}
