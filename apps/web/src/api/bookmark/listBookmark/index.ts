import { safeGet } from '@api/http'
import {
  listBookmarkRequestSchema,
  listBookmarkResponseSchema
} from '@api/bookmark/listBookmark/schema'
import type {
  ListBookmarkRequest,
  ListBookmarkResponse
} from '@api/bookmark/listBookmark/schema'

const requestBookmarkList = safeGet(listBookmarkResponseSchema)

export const listBookmark = (
  input: ListBookmarkRequest
): Promise<ListBookmarkResponse> => {
  const request = listBookmarkRequestSchema.parse(input)
  const searchParams = new URLSearchParams({
    page: String(request.page),
    pageSize: String(request.pageSize)
  })
  request.questionIds?.forEach((questionId) => {
    searchParams.append('questionIds', questionId)
  })
  return requestBookmarkList(`/v1/bookmarks?${searchParams.toString()}`)
}
