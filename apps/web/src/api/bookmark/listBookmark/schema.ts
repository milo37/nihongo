import {
  listBookmarksQuerySchema,
  listBookmarksResponseSchema
} from '@nihongo/contracts/bookmark/list-bookmarks'

export const listBookmarkRequestSchema = listBookmarksQuerySchema
export const listBookmarkResponseSchema = listBookmarksResponseSchema
export type {
  ListBookmarksQuery as ListBookmarkRequest,
  ListBookmarksResponse as ListBookmarkResponse
} from '@nihongo/contracts/bookmark/list-bookmarks'
