import { safeDelWithMetadata } from '@api/http'
import {
  deleteBookmarkRequestSchema,
  deleteBookmarkTransportResponseSchema
} from '@api/bookmark/deleteBookmark/schema'
import type { DeleteBookmarkTransportResponse } from '@api/bookmark/deleteBookmark/schema'

const requestBookmarkDeletion = safeDelWithMetadata(
  deleteBookmarkTransportResponseSchema
)

export const deleteBookmark = (
  questionId: string
): Promise<DeleteBookmarkTransportResponse> => {
  const request = deleteBookmarkRequestSchema.parse({ questionId })
  return requestBookmarkDeletion(`/v1/bookmarks/${request.questionId}`)
}
