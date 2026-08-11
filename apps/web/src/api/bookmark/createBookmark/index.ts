import { safePost } from '@api/http'
import {
  createBookmarkRequestSchema,
  createBookmarkResponseSchema
} from '@api/bookmark/createBookmark/schema'
import type { CreateBookmarkResponse } from '@api/bookmark/createBookmark/schema'

const requestBookmarkCreation = safePost(createBookmarkResponseSchema)

export const createBookmark = (
  questionId: string
): Promise<CreateBookmarkResponse> => {
  const request = createBookmarkRequestSchema.parse({ questionId })

  return requestBookmarkCreation(`/bookmark/${request.questionId}`, {})
}
