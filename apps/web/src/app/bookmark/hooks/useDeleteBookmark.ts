import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  bookmarkMutations,
  bookmarkQueries
} from '@app/bookmark/queries/bookmarkQueries'

export const useDeleteBookmark = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...bookmarkMutations.delete(),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: bookmarkQueries.allKey()
      })
    }
  })
}
