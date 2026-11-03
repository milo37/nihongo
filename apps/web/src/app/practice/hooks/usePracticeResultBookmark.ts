import { useState } from 'react'
import { toOptimisticBookmark } from '@app/bookmark/toOptimisticBookmark'
import type { StudyResultItemView } from '@app/practice/adapters/studyResultView'
import { useBookmarkMutationActivity } from '@app/bookmark/hooks/useBookmarkMutationActivity'
import { useCreateBookmark } from '@app/bookmark/hooks/useCreateBookmark'
import { useDeleteBookmark } from '@app/bookmark/hooks/useDeleteBookmark'
import { useListBookmarks } from '@app/bookmark/hooks/useListBookmarks'
import type { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { isAuthTransitionSupersededError } from '@nihongo/browser/libs/authTransitionFence'

export type ResultBookmarkStatusCode =
  | 'unavailable'
  | 'removed'
  | 'removeFailed'
  | 'saved'
  | 'saveFailed'

type UsePracticeResultBookmarkInput = {
  resultQuestionIds: string[]
  role: ReturnType<typeof useAuth>['role']
}

export const usePracticeResultBookmark = ({
  resultQuestionIds,
  role
}: UsePracticeResultBookmarkInput) => {
  const [message, setMessage] = useState<{
    code: ResultBookmarkStatusCode
    questionId: string
  } | null>(null)
  const createBookmark = useCreateBookmark('RESULT')
  const deleteBookmark = useDeleteBookmark()
  const mutationActivity = useBookmarkMutationActivity()
  const bookmarksQuery = useListBookmarks(
    {
      page: 1,
      pageSize: 20,
      ...(resultQuestionIds.length > 0
        ? { questionIds: resultQuestionIds }
        : {})
    },
    role !== 'GUEST' && resultQuestionIds.length > 0
  )

  const isBookmarked = (questionId: string): boolean =>
    Boolean(
      bookmarksQuery.data?.items.some(
        (bookmark) => bookmark.questionId === questionId
      )
    )
  const isUnavailable =
    mutationActivity.pendingQuestionIds.size > 0 ||
    bookmarksQuery.isPending ||
    bookmarksQuery.isError ||
    bookmarksQuery.fetchStatus === 'paused'

  const toggle = (
    item: StudyResultItemView,
    isItemBookmarked: boolean,
    isResultSourceUnavailable: boolean
  ): void => {
    const { question } = item
    if (
      isResultSourceUnavailable ||
      role === 'GUEST' ||
      !question.questionVersionId ||
      !question.tagSummaries
    ) {
      setMessage({ code: 'unavailable', questionId: question.id })
      return
    }
    setMessage(null)
    if (isItemBookmarked) {
      deleteBookmark.mutate(question.id, {
        onSuccess: () =>
          setMessage({ code: 'removed', questionId: question.id }),
        onError: (error) => {
          if (!isAuthTransitionSupersededError(error)) {
            setMessage({ code: 'removeFailed', questionId: question.id })
          }
        }
      })
      return
    }
    const optimisticBookmark = toOptimisticBookmark(question)
    createBookmark.mutate(
      { questionId: question.id, optimisticBookmark },
      {
        onSuccess: () => setMessage({ code: 'saved', questionId: question.id }),
        onError: (error) => {
          if (!isAuthTransitionSupersededError(error)) {
            setMessage({ code: 'saveFailed', questionId: question.id })
          }
        }
      }
    )
  }

  return {
    bookmarksQuery,
    isBookmarked,
    isMutationPaused: mutationActivity.isPaused,
    isUnavailable,
    message,
    toggle
  }
}

export type PracticeResultBookmark = ReturnType<
  typeof usePracticeResultBookmark
>
