import { mutationOptions, queryOptions } from '@tanstack/react-query'
import { createBookmark } from '@api/bookmark/createBookmark'
import type { CreateBookmarkRequest } from '@api/bookmark/createBookmark/schema'
import { deleteBookmark } from '@api/bookmark/deleteBookmark'
import { listBookmark } from '@api/bookmark/listBookmark'
import { isMockApiMode } from '@libs/apiMode'
import { createObjectAuthBoundActionFence } from '@libs/authTransitionFence'

export interface DeleteBookmarkActionInput {
  questionId: string
}

const createBookmarkActionFence =
  createObjectAuthBoundActionFence<CreateBookmarkRequest>()
const deleteBookmarkActionFence =
  createObjectAuthBoundActionFence<DeleteBookmarkActionInput>()

export const assertCurrentCreateBookmarkAction = (
  input: CreateBookmarkRequest
): void => createBookmarkActionFence.assertCurrent(input)

export const assertCurrentDeleteBookmarkAction = (
  input: DeleteBookmarkActionInput
): void => deleteBookmarkActionFence.assertCurrent(input)

const assertBookmarkSupport = (): void => {
  if (!isMockApiMode) {
    throw new Error('즐겨찾기는 실제 API에서 아직 지원되지 않습니다.')
  }
}

export const bookmarkQueries = {
  allKey: () => ['bookmark'] as const,
  list: () =>
    queryOptions({
      queryKey: [...bookmarkQueries.allKey(), 'list-bookmarks'] as const,
      queryFn: () => {
        assertBookmarkSupport()
        return listBookmark()
      },
      staleTime: 15_000
    })
} as const

export const bookmarkMutations = {
  create: () =>
    mutationOptions({
      mutationKey: [...bookmarkQueries.allKey(), 'create-bookmark'] as const,
      networkMode: 'always',
      onMutate: (input: CreateBookmarkRequest) =>
        createBookmarkActionFence.capture(input),
      mutationFn: async (input: CreateBookmarkRequest) => {
        assertCurrentCreateBookmarkAction(input)
        assertBookmarkSupport()
        const bookmark = await createBookmark(input.questionId)
        assertCurrentCreateBookmarkAction(input)
        return bookmark
      },
      onSuccess: (_data, input: CreateBookmarkRequest) =>
        assertCurrentCreateBookmarkAction(input)
    }),
  delete: () =>
    mutationOptions({
      mutationKey: [...bookmarkQueries.allKey(), 'delete-bookmark'] as const,
      networkMode: 'always',
      onMutate: (input: DeleteBookmarkActionInput) =>
        deleteBookmarkActionFence.capture(input),
      mutationFn: async (input: DeleteBookmarkActionInput) => {
        assertCurrentDeleteBookmarkAction(input)
        assertBookmarkSupport()
        const result = await deleteBookmark(input.questionId)
        assertCurrentDeleteBookmarkAction(input)
        return result
      },
      onSuccess: (_data, input: DeleteBookmarkActionInput) =>
        assertCurrentDeleteBookmarkAction(input)
    })
} as const
