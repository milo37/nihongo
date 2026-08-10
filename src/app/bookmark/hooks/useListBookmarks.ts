import { useQuery } from '@tanstack/react-query'
import { bookmarkQueries } from '@app/bookmark/queries/bookmarkQueries'

export const useListBookmarks = (enabled = true) => {
  return useQuery({
    ...bookmarkQueries.list(),
    enabled
  })
}
