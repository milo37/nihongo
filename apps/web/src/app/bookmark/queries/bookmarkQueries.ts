import type { BookmarkSummary } from '@nihongo/contracts/bookmark/bookmark'
import {
  listBookmarksQuerySchema,
  type ListBookmarksQuery
} from '@nihongo/contracts/bookmark/list-bookmarks'
import { opaqueIdSchema } from '@nihongo/contracts/common/id'
import { mutationOptions, queryOptions } from '@tanstack/react-query'
import { createBookmark } from '@api/bookmark/createBookmark'
import { deleteBookmark } from '@api/bookmark/deleteBookmark'
import { listBookmark } from '@api/bookmark/listBookmark'
import { createObjectAuthBoundActionFence } from '@libs/authTransitionFence'

export interface CreateBookmarkActionInput {
  optimisticBookmark?: BookmarkSummary
  questionId: string
}

export interface DeleteBookmarkActionInput {
  questionId: string
}

export interface NormalizedBookmarkListQuery {
  page: number
  pageSize: number
  questionIds?: string[]
}

const createBookmarkActionFence =
  createObjectAuthBoundActionFence<CreateBookmarkActionInput>()
const deleteBookmarkActionFence =
  createObjectAuthBoundActionFence<DeleteBookmarkActionInput>()

export const captureCreateBookmarkAction = (
  input: CreateBookmarkActionInput
): void => createBookmarkActionFence.capture(input)

export const captureDeleteBookmarkAction = (
  input: DeleteBookmarkActionInput
): void => deleteBookmarkActionFence.capture(input)

export const assertCurrentCreateBookmarkAction = (
  input: CreateBookmarkActionInput
): void => createBookmarkActionFence.assertCurrent(input)

export const assertCurrentDeleteBookmarkAction = (
  input: DeleteBookmarkActionInput
): void => deleteBookmarkActionFence.assertCurrent(input)

export const normalizeBookmarkListQuery = (
  input: ListBookmarksQuery
): NormalizedBookmarkListQuery => {
  const questionIds = input.questionIds
    ? [
        ...new Set(
          input.questionIds.map((questionId) =>
            opaqueIdSchema.parse(questionId)
          )
        )
      ].toSorted()
    : undefined
  return listBookmarksQuerySchema.parse({
    ...input,
    ...(questionIds ? { questionIds } : {})
  })
}

export const bookmarkQueries = {
  allKey: () => ['bookmark'] as const,
  listsKey: () => [...bookmarkQueries.allKey(), 'list'] as const,
  list: (input: ListBookmarksQuery = {}) => {
    const query = normalizeBookmarkListQuery(input)
    return queryOptions({
      queryKey: [...bookmarkQueries.listsKey(), query] as const,
      queryFn: () => listBookmark(query),
      staleTime: 15_000
    })
  }
} as const

export const bookmarkMutations = {
  create: () =>
    mutationOptions({
      mutationKey: [...bookmarkQueries.allKey(), 'create'] as const,
      mutationFn: async (input: CreateBookmarkActionInput) => {
        assertCurrentCreateBookmarkAction(input)
        const response = await createBookmark(input.questionId)
        assertCurrentCreateBookmarkAction(input)
        return response
      }
    }),
  delete: () =>
    mutationOptions({
      mutationKey: [...bookmarkQueries.allKey(), 'delete'] as const,
      mutationFn: async (input: DeleteBookmarkActionInput) => {
        assertCurrentDeleteBookmarkAction(input)
        const response = await deleteBookmark(input.questionId)
        assertCurrentDeleteBookmarkAction(input)
        return response
      }
    })
} as const
