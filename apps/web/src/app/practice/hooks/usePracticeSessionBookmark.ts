import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { useGuestAction } from '@app/login/hooks/useGuestAction'
import { useBookmarkMutationActivity } from '@app/bookmark/hooks/useBookmarkMutationActivity'
import { useCreateBookmark } from '@app/bookmark/hooks/useCreateBookmark'
import { useDeleteBookmark } from '@app/bookmark/hooks/useDeleteBookmark'
import { useListBookmarks } from '@app/bookmark/hooks/useListBookmarks'
import type {
  StudyQuestionView,
  StudySessionView
} from '@app/practice/adapters/studySessionView'
import { toOptimisticBookmark } from '@app/bookmark/toOptimisticBookmark'
import type { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { isAuthTransitionSupersededError } from '@nihongo/browser/libs/authTransitionFence'

type UsePracticeSessionBookmarkInput = {
  role: ReturnType<typeof useAuth>['role']
  sessionData: StudySessionView | undefined
}

export const usePracticeSessionBookmark = ({
  role,
  sessionData
}: UsePracticeSessionBookmarkInput) => {
  const { t } = useTranslation('practice')
  const { t: authT } = useTranslation('auth')
  const { addToast } = useToast()
  const guestAction = useGuestAction()
  // #1262: success and failure share one bookmark toast; a failed change
  // puts the icon back (the optimistic update rolls back), no retry button.
  const notify = (
    code:
      | 'saved'
      | 'removed'
      | 'saveRollback'
      | 'removeRollback'
      | 'statusLoadFailed'
  ): void => {
    addToast({
      key: 'bookmark',
      title: t(`session.bookmark.${code}`),
      variant: code === 'saved' || code === 'removed' ? 'success' : 'warning'
    })
  }
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

  // When the list could not be read there is no cache to patch, so a
  // press that succeeded is kept here and the icon still follows it.
  const [pressedWithoutList, setPressedWithoutList] = useState<
    Record<string, boolean>
  >({})
  const isBookmarked = (questionId: string): boolean =>
    bookmarksQuery.data
      ? bookmarksQuery.data.items.some(
          (bookmark) => bookmark.questionId === questionId
        )
      : (pressedWithoutList[questionId] ?? false)
  const keepPressed = (questionId: string, pressed: boolean): void =>
    setPressedWithoutList((current) => ({ ...current, [questionId]: pressed }))
  const hasPendingMutation = mutationActivity.pendingQuestionIds.size > 0
  // A failed check leaves the icons empty (they can still be pressed) and
  // says so once per set.
  const toldLoadFailure = useRef(false)
  useEffect(() => {
    if (!bookmarksQuery.isError || toldLoadFailure.current) return
    toldLoadFailure.current = true
    notify('statusLoadFailed')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarksQuery.isError])
  const isQueryUnavailable =
    role !== 'GUEST' &&
    (bookmarksQuery.isPending || bookmarksQuery.fetchStatus === 'paused')

  const toggle = (question: StudyQuestionView): void => {
    if (guestAction(authT('guestToast.bookmark'), { sessionNotKept: true })) {
      return
    }
    if (isBookmarked(question.id)) {
      deleteBookmark.mutate(question.id, {
        onSuccess: () => {
          keepPressed(question.id, false)
          notify('removed')
        },
        onError: (error) => {
          if (!isAuthTransitionSupersededError(error)) {
            notify('removeRollback')
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
        onSuccess: () => {
          keepPressed(question.id, true)
          notify('saved')
        },
        onError: (error) => {
          if (!isAuthTransitionSupersededError(error)) {
            notify('saveRollback')
          }
        }
      }
    )
  }

  return {
    bookmarksQuery,
    hasPendingMutation,
    isBookmarked,
    isQueryUnavailable,
    toggle
  }
}

export type PracticeSessionBookmark = ReturnType<
  typeof usePracticeSessionBookmark
>
