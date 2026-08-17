import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  assertCurrentCreateBookmarkAction,
  bookmarkMutations,
  bookmarkQueries
} from '@app/bookmark/queries/bookmarkQueries'

export const useCreateBookmark = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...bookmarkMutations.create(),
    onSuccess: async (_data, input) => {
      assertCurrentCreateBookmarkAction(input)
      await queryClient.invalidateQueries({
        queryKey: bookmarkQueries.allKey()
      })
      assertCurrentCreateBookmarkAction(input)
    }
  })
}
