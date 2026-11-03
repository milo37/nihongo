import { useState } from 'react'
import { useBookmarkMutationActivity } from '@app/bookmark/hooks/useBookmarkMutationActivity'
import { useCreateBookmark } from '@app/bookmark/hooks/useCreateBookmark'
import { useDeleteBookmark } from '@app/bookmark/hooks/useDeleteBookmark'
import { useListBookmarks } from '@app/bookmark/hooks/useListBookmarks'
import type {
  StudyQuestionView,
  StudySessionView
} from '@app/practice/adapters/studySessionView'
import type { BookmarkSummary } from '@nihongo/contracts/bookmark/bookmark'
import type { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { isAuthTransitionSupersededError } from '@nihongo/browser/libs/authTransitionFence'

export type BookmarkNoticeCode =
  | 'loginRequired'
  | 'removed'
  | 'removeRollback'
  | 'saved'
  | 'saveRollback'

type UsePracticeSessionBookmarkInput = {
  role: ReturnType<typeof useAuth>['role']
  sessionData: StudySessionView | undefined
}

const toOptimisticBookmark = (
  question: StudyQuestionView
): BookmarkSummary | undefined => {
  if (!question.questionVersionId || !question.tagSummaries) {
    return undefined
  }
  const characters = [...question.questionText]
  return {
    questionId: question.id,
    question: {
      id: question.id,
      questionVersionId: question.questionVersionId,
      level: question.level,
      subject: question.subject,
      questionType: question.questionType,
      difficulty: question.difficulty,
      questionTextPreview:
        characters.length <= 160
          ? question.questionText
          : `${characters.slice(0, 157).join('')}...`,
      tags: question.tagSummaries
    },
    availability: 'AVAILABLE',
    createdAt: new Date().toISOString()
  }
}

export const usePracticeSessionBookmark = ({
  role,
  sessionData
}: UsePracticeSessionBookmarkInput) => {
  const [message, setMessage] = useState<{
    code: BookmarkNoticeCode
    questionId: string
  } | null>(null)
  const createBookmark = useCreateBookmark('PRACTICE')
  const deleteBookmark = useDeleteBookmark()
  const mutationActivity = useBookmarkMutationActivity()
  const bookmarkQuestionIds =
    sessionData?.session.practiceContractVersion === 2
      ? sessionData.questions.map((question) => question.id).toSorted()
      : []
  const bookmarksQuery = useListBookmarks(
    {
      page: 1,
      pageSize: 20,
      ...(bookmarkQuestionIds.length > 0
        ? { questionIds: bookmarkQuestionIds }
        : {})
    },
    role !== 'GUEST' && bookmarkQuestionIds.length > 0
  )

  const isBookmarked = (questionId: string): boolean =>
    Boolean(
      bookmarksQuery.data?.items.some(
        (bookmark) => bookmark.questionId === questionId
      )
    )
  const hasPendingMutation = mutationActivity.pendingQuestionIds.size > 0
  const isQueryUnavailable =
    role !== 'GUEST' &&
    (bookmarksQuery.isPending ||
      bookmarksQuery.isError ||
      bookmarksQuery.fetchStatus === 'paused')

  const toggle = (question: StudyQuestionView): void => {
    if (role === 'GUEST') {
      setMessage({ code: 'loginRequired', questionId: question.id })
      return
    }
    setMessage(null)
    if (isBookmarked(question.id)) {
      deleteBookmark.mutate(question.id, {
        onSuccess: () =>
          setMessage({ code: 'removed', questionId: question.id }),
        onError: (error) => {
          if (!isAuthTransitionSupersededError(error)) {
            setMessage({ code: 'removeRollback', questionId: question.id })
          }
        }
      })
      return
    }

    createBookmark.mutate(
      {
        questionId: question.id,
        optimisticBookmark: toOptimisticBookmark(question)
      },
      {
        onSuccess: () => setMessage({ code: 'saved', questionId: question.id }),
        onError: (error) => {
          if (!isAuthTransitionSupersededError(error)) {
            setMessage({ code: 'saveRollback', questionId: question.id })
          }
        }
      }
    )
  }

  return {
    bookmarksQuery,
    hasPendingMutation,
    isBookmarked,
    isMutationPaused: mutationActivity.isPaused,
    isQueryUnavailable,
    message,
    toggle
  }
}

export type PracticeSessionBookmark = ReturnType<
  typeof usePracticeSessionBookmark
>
