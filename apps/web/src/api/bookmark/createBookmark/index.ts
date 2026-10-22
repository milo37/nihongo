import { safePutWithMetadata } from '@api/http'
import {
  createBookmarkRequestBodySchema,
  createBookmarkRequestSchema,
  createBookmarkTransportResponseSchema
} from '@api/bookmark/createBookmark/schema'
import type { CreateBookmarkTransportResponse } from '@api/bookmark/createBookmark/schema'

const requestBookmarkCreation = safePutWithMetadata(
  createBookmarkTransportResponseSchema
)

export const createBookmark = (
  questionId: string
): Promise<CreateBookmarkTransportResponse> => {
  const request = createBookmarkRequestSchema.parse({ questionId })
  const body = createBookmarkRequestBodySchema.parse({})
  return requestBookmarkCreation(`/v1/bookmarks/${request.questionId}`, body)
}
