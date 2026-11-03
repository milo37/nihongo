import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import type {
  JlptLevel,
  QuestionSubject
} from '@nihongo/browser/common/types/domain'
import { useBookmarkMutationActivity } from '@app/bookmark/hooks/useBookmarkMutationActivity'
import { useDeleteBookmark } from '@app/bookmark/hooks/useDeleteBookmark'
import { useListBookmarks } from '@app/bookmark/hooks/useListBookmarks'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { isAuthTransitionSupersededError } from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import { isNoEligibleQuestionsApiError } from '@libs/apiError'

export const BOOKMARK_PAGE_SIZE = 20
export const BOOKMARK_PRACTICE_COUNT = 20

export type BookmarkStatusMessage = 'removed' | 'removing' | 'restoreFailed'

export interface BookmarkPracticeGroup {
  level: JlptLevel
  subject: QuestionSubject
}

const getBookmarkPage = (value: string | null): number => {
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

export const useBookmarkPageController = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const ownerIdentityRef = useRef<string | null | undefined>(undefined)
  const page = getBookmarkPage(searchParams.get('page'))
  const setPage = useCallback(
    (nextPage: number, replace = false): void => {
      const next = new URLSearchParams(searchParams)
      if (nextPage === 1) next.delete('page')
      else next.set('page', String(nextPage))
      setSearchParams(next, { replace })
    },
    [searchParams, setSearchParams]
  )
  const getPageHref = (nextPage: number): string => {
    const next = new URLSearchParams(searchParams)
    if (nextPage === 1) next.delete('page')
    else next.set('page', String(nextPage))
    return `?${next.toString()}`
  }
  const [pendingRemovalQuestionId, setPendingRemovalQuestionId] = useState<
    string | null
  >(null)
  const [statusMessage, setStatusMessage] =
    useState<BookmarkStatusMessage | null>(null)
  const bookmarksQuery = useListBookmarks({
    page,
    pageSize: BOOKMARK_PAGE_SIZE
  })
  const bookmarkMutationActivity = useBookmarkMutationActivity()
  const hasPendingBookmarkMutation =
    bookmarkMutationActivity.pendingQuestionIds.size > 0
  const deleteBookmark = useDeleteBookmark()
  const createSession = useCreateStudySession()
  const resetCreateSession = createSession.reset
  const resetDeleteBookmark = deleteBookmark.reset
  const beginPractice = useAppStore((state) => state.beginPractice)
  const currentUserId = useAppStore((state) => state.currentUser?.id ?? null)

  useEffect(() => {
    if (ownerIdentityRef.current === undefined) {
      ownerIdentityRef.current = currentUserId
      return
    }
    if (ownerIdentityRef.current === currentUserId) return
    ownerIdentityRef.current = currentUserId
    setPage(1, true)
    setStatusMessage(null)
    resetCreateSession()
    resetDeleteBookmark()
  }, [currentUserId, resetCreateSession, resetDeleteBookmark, setPage])

  const pageCount = bookmarksQuery.data
    ? Math.max(
        1,
        Math.ceil(bookmarksQuery.data.total / bookmarksQuery.data.pageSize)
      )
    : page
  const displayedPage = bookmarksQuery.data?.page ?? page
  const noEligibleQuestions =
    createSession.isError && isNoEligibleQuestionsApiError(createSession.error)
  const hasCreateSessionError =
    createSession.isError &&
    !noEligibleQuestions &&
    !isAuthTransitionSupersededError(createSession.error)
  const isBookmarksPaused = bookmarksQuery.fetchStatus === 'paused'
  const isBookmarkNavigationLocked =
    isBookmarksPaused || bookmarksQuery.isError || bookmarksQuery.isFetching

  useEffect(() => {
    if (!bookmarksQuery.data || bookmarksQuery.data.page !== page) return
    if (bookmarkMutationActivity.pendingQuestionIds.size > 0) return
    if (bookmarksQuery.isFetching || bookmarksQuery.isStale) return
    if (page <= pageCount) return
    const timerId = window.setTimeout(() => setPage(pageCount, true), 0)
    return () => window.clearTimeout(timerId)
  }, [
    bookmarkMutationActivity.pendingQuestionIds.size,
    bookmarksQuery.data,
    bookmarksQuery.isFetching,
    bookmarksQuery.isStale,
    page,
    pageCount,
    setPage
  ])

  const groupByScope = new Map<string, BookmarkPracticeGroup>()
  for (const bookmark of bookmarksQuery.data?.items ?? []) {
    if (bookmark.availability !== 'AVAILABLE') continue
    const { question } = bookmark
    const groupKey = `${question.level}:${question.subject}`
    if (!groupByScope.has(groupKey)) {
      groupByScope.set(groupKey, {
        level: question.level,
        subject: question.subject
      })
    }
  }
  const bookmarkGroups = [...groupByScope.values()]

  const startBookmarkPractice = (group: BookmarkPracticeGroup): void => {
    createSession.reset()
    createSession.mutate(
      {
        level: group.level,
        subject: group.subject,
        mode: 'BOOKMARK',
        count: BOOKMARK_PRACTICE_COUNT
      },
      {
        onSuccess: ({ session }, input) => {
          assertCurrentCreateStudySessionAction(input)
          beginPractice(session.id, session.startedAt)
          void navigate(`/practice/session/${session.id}`)
        }
      }
    )
  }

  const retryBookmarkPractice = (): void => {
    const input = createSession.variables
    if (input?.mode !== 'BOOKMARK') {
      createSession.reset()
      return
    }
    startBookmarkPractice({ level: input.level, subject: input.subject })
  }

  const refreshAfterNoEligible = (): void => {
    createSession.reset()
    void bookmarksQuery.refetch()
  }

  const removeBookmark = (questionId: string): void => {
    setStatusMessage('removing')
    deleteBookmark.mutate(questionId, {
      onSuccess: () => {
        setPendingRemovalQuestionId(null)
        setStatusMessage('removed')
      },
      onError: (error) => {
        if (isAuthTransitionSupersededError(error)) return
        setPendingRemovalQuestionId(null)
        setStatusMessage('restoreFailed')
      }
    })
  }

  const confirmRemoval = (): void => {
    if (pendingRemovalQuestionId) {
      removeBookmark(pendingRemovalQuestionId)
    }
  }

  const isPracticeStarting = createSession.isPending || createSession.isPaused
  const isRemovalPromptPending =
    pendingRemovalQuestionId !== null &&
    statusMessage === 'removing' &&
    !bookmarkMutationActivity.isPaused

  return {
    bookmarkGroups,
    bookmarksQuery,
    confirmRemoval,
    displayedPage,
    getPageHref,
    hasCreateSessionError,
    hasPendingBookmarkMutation,
    isBookmarkNavigationLocked,
    isBookmarksPaused,
    isMutationPaused: bookmarkMutationActivity.isPaused,
    isPracticeStarting,
    isRemovalPromptPending,
    isRemoving: deleteBookmark.isPending,
    isPracticeSessionPaused: createSession.isPaused,
    noEligibleQuestions,
    page,
    pageCount,
    pendingPracticeGroup: isPracticeStarting
      ? createSession.variables
      : undefined,
    pendingQuestionIds: bookmarkMutationActivity.pendingQuestionIds,
    pendingRemovalQuestionId,
    refreshAfterNoEligible,
    requestRemoval: setPendingRemovalQuestionId,
    retryBookmarkPractice,
    setPage,
    startBookmarkPractice,
    statusMessage
  }
}
