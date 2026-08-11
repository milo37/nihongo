import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  bookmarkMutations,
  bookmarkQueries
} from '@app/bookmark/queries/bookmarkQueries'

export const useCreateBookmark = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...bookmarkMutations.create(),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: bookmarkQueries.allKey()
      })
    }
  })
}
