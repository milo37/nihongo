import type { DeleteBookmarkTransportResponse } from '@api/bookmark/deleteBookmark/schema'
import type { MutateOptions } from '@tanstack/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  assertCurrentDeleteBookmarkAction,
  bookmarkMutations,
  bookmarkQueries,
  captureDeleteBookmarkAction,
  type DeleteBookmarkActionInput
} from '@app/bookmark/queries/bookmarkQueries'
import {
  optimisticallyDeleteBookmark,
  rollbackOptimisticDeleteBookmark,
  snapshotBookmarkCache,
  type BookmarkCacheSnapshot
} from '@app/bookmark/hooks/bookmarkOptimisticCache'
import { settleBookmarkMutation } from '@app/bookmark/hooks/bookmarkMutationSettlement'

type DeleteBookmarkMutateOptions = MutateOptions<
  DeleteBookmarkTransportResponse,
  Error,
  string,
  void
>

const isCurrentAction = (input: DeleteBookmarkActionInput): boolean => {
  try {
    assertCurrentDeleteBookmarkAction(input)
    return true
  } catch {
    return false
  }
}

export const useDeleteBookmark = () => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    ...bookmarkMutations.delete(),
    onMutate: async (input): Promise<BookmarkCacheSnapshot> => {
      captureDeleteBookmarkAction(input)
      await queryClient.cancelQueries({ queryKey: bookmarkQueries.allKey() })
      assertCurrentDeleteBookmarkAction(input)
      const snapshot = snapshotBookmarkCache(queryClient)
      optimisticallyDeleteBookmark(queryClient, input.questionId)
      return snapshot
    },
    onError: (_error, input, snapshot) => {
      try {
        assertCurrentDeleteBookmarkAction(input)
      } catch {
        return
      }
      if (snapshot) {
        rollbackOptimisticDeleteBookmark(
          queryClient,
          snapshot,
          input.questionId
        )
      }
    },
    onSettled: async (_data, _error, input) => {
      try {
        assertCurrentDeleteBookmarkAction(input)
      } catch {
        return
      }
      await settleBookmarkMutation(queryClient, () => isCurrentAction(input))
      assertCurrentDeleteBookmarkAction(input)
    }
  })

  const toInternalOptions = (
    options: DeleteBookmarkMutateOptions | undefined
  ): MutateOptions<
    DeleteBookmarkTransportResponse,
    Error,
    DeleteBookmarkActionInput
  > => ({
    onSuccess: (data, input, _onMutateResult, context) => {
      try {
        assertCurrentDeleteBookmarkAction(input)
      } catch {
        return
      }
      options?.onSuccess?.(data, input.questionId, undefined, context)
    },
    onError: (error, input, _onMutateResult, context) => {
      try {
        assertCurrentDeleteBookmarkAction(input)
      } catch {
        return
      }
      options?.onError?.(error, input.questionId, undefined, context)
    },
    onSettled: (data, error, input, _onMutateResult, context) => {
      try {
        assertCurrentDeleteBookmarkAction(input)
      } catch {
        return
      }
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
