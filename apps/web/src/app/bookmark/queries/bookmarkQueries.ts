import { mutationOptions, queryOptions } from '@tanstack/react-query'
import { createBookmark } from '@api/bookmark/createBookmark'
import type { CreateBookmarkRequest } from '@api/bookmark/createBookmark/schema'
import { deleteBookmark } from '@api/bookmark/deleteBookmark'
import { listBookmark } from '@api/bookmark/listBookmark'

export const bookmarkQueries = {
  allKey: () => ['bookmark'] as const,
  list: () =>
    queryOptions({
      queryKey: [...bookmarkQueries.allKey(), 'list-bookmarks'] as const,
      queryFn: listBookmark,
      staleTime: 15_000
    })
} as const

export const bookmarkMutations = {
  create: () =>
    mutationOptions({
      mutationKey: [...bookmarkQueries.allKey(), 'create-bookmark'] as const,
      mutationFn: (input: CreateBookmarkRequest) =>
        createBookmark(input.questionId)
    }),
  delete: () =>
    mutationOptions({
      mutationKey: [...bookmarkQueries.allKey(), 'delete-bookmark'] as const,
      mutationFn: deleteBookmark
    })
} as const
