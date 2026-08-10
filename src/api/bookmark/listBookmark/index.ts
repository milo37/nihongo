import { safeGet } from '@api/http'
import { listBookmarkResponseSchema } from '@api/bookmark/listBookmark/schema'
import type { ListBookmarkResponse } from '@api/bookmark/listBookmark/schema'

const requestBookmarkList = safeGet(listBookmarkResponseSchema)

export const listBookmark = (): Promise<ListBookmarkResponse> =>
  requestBookmarkList('/bookmark')
