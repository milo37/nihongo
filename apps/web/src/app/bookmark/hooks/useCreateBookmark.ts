import type { CreateBookmarkTransportResponse } from '@api/bookmark/createBookmark/schema'
import type { MutateOptions } from '@tanstack/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  assertCurrentCreateBookmarkAction,
  bookmarkMutations,
  bookmarkQueries,
  captureCreateBookmarkAction
} from '@app/bookmark/queries/bookmarkQueries'
import {
  optimisticallyCreateBookmark,
  replaceOptimisticBookmark,
  rollbackOptimisticCreateBookmark,
  type BookmarkCreatePatch
} from '@app/bookmark/hooks/bookmarkOptimisticCache'
import { settleBookmarkMutation } from '@app/bookmark/hooks/bookmarkMutationSettlement'
import type { CreateBookmarkActionInput } from '@app/bookmark/queries/bookmarkQueries'

type CreateBookmarkMutateOptions = MutateOptions<
  CreateBookmarkTransportResponse,
  Error,
  CreateBookmarkActionInput,
  CreateBookmarkMutationContext
>

interface CreateBookmarkMutationContext {
  patch: BookmarkCreatePatch | null
}

const isCurrentAction = (input: CreateBookmarkActionInput): boolean => {
  try {
    assertCurrentCreateBookmarkAction(input)
    return true
  } catch {
    return false
  }
}

export const useCreateBookmark = () => {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    ...bookmarkMutations.create(),
    onMutate: async (input): Promise<CreateBookmarkMutationContext> => {
      captureCreateBookmarkAction(input)
      await queryClient.cancelQueries({ queryKey: bookmarkQueries.allKey() })
      assertCurrentCreateBookmarkAction(input)
      return {
        patch: input.optimisticBookmark
          ? optimisticallyCreateBookmark(queryClient, input.optimisticBookmark)
          : null
      }
    },
    onError: (_error, input, context) => {
      if (!isCurrentAction(input)) return
      if (context?.patch && context.patch.entries.length > 0) {
        rollbackOptimisticCreateBookmark(queryClient, context.patch)
      }
    },
    onSuccess: (response, input) => {
      assertCurrentCreateBookmarkAction(input)
      replaceOptimisticBookmark(queryClient, response.data)
    },
    onSettled: async (_data, _error, input) => {
      if (!isCurrentAction(input)) return
      await settleBookmarkMutation(queryClient, () => isCurrentAction(input))
      if (!isCurrentAction(input)) return
    }
  })

  const guardOptions = (
    options: CreateBookmarkMutateOptions | undefined
  ): CreateBookmarkMutateOptions => ({
    onSuccess: (data, input, onMutateResult, context) => {
      if (!isCurrentAction(input)) return
      options?.onSuccess?.(data, input, onMutateResult, context)
    },
    onError: (error, input, onMutateResult, context) => {
      if (!isCurrentAction(input)) return
      options?.onError?.(error, input, onMutateResult, context)
    },
    onSettled: (data, error, input, onMutateResult, context) => {
      if (!isCurrentAction(input)) return
      options?.onSettled?.(data, error, input, onMutateResult, context)
    }
  })

  return {
    ...mutation,
    mutate: (
      input: CreateBookmarkActionInput,
      options?: CreateBookmarkMutateOptions
    ) => mutation.mutate(input, guardOptions(options)),
    mutateAsync: (
      input: CreateBookmarkActionInput,
      options?: CreateBookmarkMutateOptions
    ) => mutation.mutateAsync(input, guardOptions(options))
  }
}
