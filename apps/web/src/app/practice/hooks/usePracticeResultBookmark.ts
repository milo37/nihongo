import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { useGuestAction } from '@app/login/hooks/useGuestAction'
import { toOptimisticBookmark } from '@app/bookmark/toOptimisticBookmark'
import type { StudyResultItemView } from '@app/practice/adapters/studyResultView'
import { useBookmarkMutationActivity } from '@app/bookmark/hooks/useBookmarkMutationActivity'
import { useCreateBookmark } from '@app/bookmark/hooks/useCreateBookmark'
import { useDeleteBookmark } from '@app/bookmark/hooks/useDeleteBookmark'
import { useListBookmarks } from '@app/bookmark/hooks/useListBookmarks'
import type { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { isAuthTransitionSupersededError } from '@nihongo/browser/libs/authTransitionFence'

type UsePracticeResultBookmarkInput = {
  resultQuestionIds: string[]
  role: ReturnType<typeof useAuth>['role']
}

export const usePracticeResultBookmark = ({
  resultQuestionIds,
  role
}: UsePracticeResultBookmarkInput) => {
  const { t } = useTranslation('result')
  const { t: authT } = useTranslation('auth')
  const { addToast } = useToast()
  const guestAction = useGuestAction()
  // #1262: one bookmark toast for every outcome; a failed change puts the
  // icon back (the optimistic update rolls back), no retry button.
  const notify = (
    code:
      | 'saved'
      | 'removed'
      | 'saveFailed'
      | 'removeFailed'
      | 'unavailable'
      | 'loadError'
  ): void => {
    addToast({
      key: 'bookmark',
      title: t(`bookmark.${code}`),
      variant:
        code === 'saved' || code === 'removed'
          ? 'success'
          : code === 'unavailable'
            ? 'info'
            : 'warning'
    })
  }
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
  // A failed check leaves the icons empty (they can still be pressed) and
  // says so once per set.
  const toldLoadFailure = useRef(false)
  useEffect(() => {
    if (!bookmarksQuery.isError || toldLoadFailure.current) return
    toldLoadFailure.current = true
    notify('loadError')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarksQuery.isError])
  // A refresh paused offline keeps the list it has; only a list not read
  // yet locks the icons (#978).
  const isUnavailable =
    role !== 'GUEST' &&
    (mutationActivity.pendingQuestionIds.size > 0 || bookmarksQuery.isPending)

  const toggle = (
    item: StudyResultItemView,
    isItemBookmarked: boolean,
    isResultSourceUnavailable: boolean
  ): void => {
    const { question } = item
    if (guestAction(authT('guestToast.bookmark'), { sessionNotKept: true })) {
      return
    }
    if (
      isResultSourceUnavailable ||
      !question.questionVersionId ||
      !question.tagSummaries
    ) {
      notify('unavailable')
      return
    }
    if (isItemBookmarked) {
      deleteBookmark.mutate(question.id, {
        onSuccess: () => {
          keepPressed(question.id, false)
          notify('removed')
        },
        onError: (error) => {
          if (!isAuthTransitionSupersededError(error)) {
            notify('removeFailed')
          }
        }
      })
      return
    }
    const optimisticBookmark = toOptimisticBookmark(question)
    createBookmark.mutate(
      { questionId: question.id, optimisticBookmark },
      {
        onSuccess: () => {
          keepPressed(question.id, true)
          notify('saved')
        },
        onError: (error) => {
          if (!isAuthTransitionSupersededError(error)) {
            notify('saveFailed')
          }
        }
      }
    )
  }

  return {
    bookmarksQuery,
    isBookmarked,
    isUnavailable,
    toggle
  }
}

export type PracticeResultBookmark = ReturnType<
  typeof usePracticeResultBookmark
>
