import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { MutateOptions } from '@tanstack/react-query'
import type { DeleteBookmarkResponse } from '@api/bookmark/deleteBookmark/schema'
import {
  assertCurrentDeleteBookmarkAction,
  bookmarkMutations,
  bookmarkQueries
} from '@app/bookmark/queries/bookmarkQueries'
import type { DeleteBookmarkActionInput } from '@app/bookmark/queries/bookmarkQueries'

type DeleteBookmarkMutateOptions = MutateOptions<
  DeleteBookmarkResponse,
  Error,
  string,
  void
>

export const useDeleteBookmark = () => {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    ...bookmarkMutations.delete(),
    onSuccess: async (_data, input) => {
      assertCurrentDeleteBookmarkAction(input)
      await queryClient.invalidateQueries({
        queryKey: bookmarkQueries.allKey()
      })
      assertCurrentDeleteBookmarkAction(input)
    }
  })

  const toInternalOptions = (
    options: DeleteBookmarkMutateOptions | undefined
  ): MutateOptions<
    DeleteBookmarkResponse,
    Error,
    DeleteBookmarkActionInput
  > => ({
    onSuccess: (data, input, _onMutateResult, context) => {
      assertCurrentDeleteBookmarkAction(input)
      options?.onSuccess?.(data, input.questionId, undefined, context)
    },
    onError: (error, input, _onMutateResult, context) => {
      options?.onError?.(error, input.questionId, undefined, context)
    },
    onSettled: (data, error, input, _onMutateResult, context) => {
      options?.onSettled?.(data, error, input.questionId, undefined, context)
    }
  })

  return {
    ...mutation,
    variables: mutation.variables?.questionId,
    mutate: (questionId: string, options?: DeleteBookmarkMutateOptions) =>
      mutation.mutate({ questionId }, toInternalOptions(options)),
    mutateAsync: (questionId: string, options?: DeleteBookmarkMutateOptions) =>
      mutation.mutateAsync({ questionId }, toInternalOptions(options))
  }
}
