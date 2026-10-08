import type { ListBookmarksQuery } from '@nihongo/contracts/bookmark/list-bookmarks'
import { useQuery } from '@tanstack/react-query'
import { bookmarkQueries } from '@app/bookmark/queries/bookmarkQueries'

export const useListBookmarks = (
  input: ListBookmarksQuery = {},
  enabled = true
) =>
  useQuery({
    ...bookmarkQueries.list(input),
    enabled
  })
