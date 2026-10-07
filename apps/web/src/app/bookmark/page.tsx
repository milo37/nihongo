import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import type { JlptLevel, QuestionSubject } from '@common/types/domain'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { EmptyState } from '@common/components/EmptyState'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { Pagination } from '@common/components/Pagination'
import { useBookmarkMutationActivity } from '@app/bookmark/hooks/useBookmarkMutationActivity'
import { useDeleteBookmark } from '@app/bookmark/hooks/useDeleteBookmark'
import { useListBookmarks } from '@app/bookmark/hooks/useListBookmarks'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'
import { formatNumber } from '@libs/localeFormatters'
import { useAppStore } from '@store/index'
import { resolveUiLocale } from '@/i18n/types'
import { isNoEligibleQuestionsApiError } from '@libs/apiError'

const PAGE_SIZE = 20

const getBookmarkPage = (value: string | null): number => {
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

interface BookmarkPracticeGroup {
  level: JlptLevel
  subject: QuestionSubject
}

export const BookmarkPage = (): ReactElement => {
  const { i18n, t } = useTranslation('bookmark')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const formatCount = (value: number): string => formatNumber(value, locale)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const removalTriggerRef = useRef<HTMLButtonElement>(null)
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
  const [statusMessage, setStatusMessage] = useState<
    'removed' | 'removing' | 'restoreFailed' | null
  >(null)
  const bookmarksQuery = useListBookmarks({ page, pageSize: PAGE_SIZE })
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
    ? Math.max(1, Math.ceil(bookmarksQuery.data.total / PAGE_SIZE))
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

  if (bookmarksQuery.isPending && !isBookmarksPaused) {
    return <LoadingState message={t('loading')} />
  }

  if (!bookmarksQuery.data && isBookmarksPaused) {
    return (
      <ErrorState
        autoFocus
        headingLevel={1}
        title={t('error.offlineTitle')}
        description={t('error.offlineDescription')}
      />
    )
  }

  if (!bookmarksQuery.data) {
    return (
      <ErrorState
        autoFocus
        headingLevel={1}
        title={t('error.title')}
        description={t('error.description')}
        action={
          <Button onClick={() => void bookmarksQuery.refetch()}>
            {commonT('actions.retry')}
          </Button>
        }
      />
    )
  }

  const groupByScope = new Map<string, BookmarkPracticeGroup>()
  for (const bookmark of bookmarksQuery.data.items) {
    if (bookmark.availability !== 'AVAILABLE') continue
    const { question } = bookmark
    const groupKey = `${question.level}:${question.subject}`
    const group = groupByScope.get(groupKey)
    if (!group) {
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
        count: 20
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

  const mutationStatus = bookmarkMutationActivity.isPaused
    ? t('status.offline')
    : statusMessage
      ? t(`status.${statusMessage}`)
      : null

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-5 border-b border-line pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-black tracking-[0.16em] text-brand">
            {t('eyebrow')}
          </p>
          <h1
            ref={headingRef}
            className="mt-2 rounded-sm text-4xl font-black focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
            tabIndex={-1}
          >
            {t('title')}
          </h1>
          <p className="mt-3 text-muted">{t('description')}</p>
        </div>
      </div>

      {mutationStatus ? (
        <p
          className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
          role="status"
          aria-live="polite"
        >
          {mutationStatus}
        </p>
      ) : null}

      {isBookmarksPaused && bookmarksQuery.data ? (
        <p
          className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
          role="status"
        >
          {t('error.cachedOffline')}
        </p>
      ) : null}

      {bookmarksQuery.isError && bookmarksQuery.data ? (
        <div
          className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          <p className="font-semibold">{t('error.staleDescription')}</p>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => void bookmarksQuery.refetch()}
          >
            {commonT('actions.retry')}
          </Button>
        </div>
      ) : null}

      {bookmarksQuery.data.items.length === 0 ? (
        <EmptyState
          title={
            displayedPage === 1 ? t('empty.firstTitle') : t('empty.pageTitle')
          }
          description={
            displayedPage === 1
              ? t('empty.firstDescription')
              : t('empty.pageDescription')
          }
          action={
            displayedPage === 1 ? (
              <Link
                className="inline-flex min-h-11 items-center px-1 font-bold text-brand underline hover:no-underline"
                to="/practice"
              >
                {t('empty.start')}
              </Link>
            ) : isBookmarkNavigationLocked ? (
              <Button disabled>{t('empty.previousPage')}</Button>
            ) : (
              <Link
                className="inline-flex min-h-11 items-center rounded-control border border-line bg-surface px-4 font-bold text-ink hover:border-line-strong hover:bg-surface-muted focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
                to={getPageHref(displayedPage - 1)}
              >
                {t('empty.previousPage')}
              </Link>
            )
          }
        />
      ) : (
        <>
          <section
            className="mt-8 rounded-xl border border-line bg-white p-5"
            aria-labelledby="bookmark-practice-groups"
          >
            <h2 id="bookmark-practice-groups" className="text-xl font-black">
              {t('practice.title')}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              {t('practice.description')}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {bookmarkGroups.map((group) => (
                <Button
                  key={`${group.level}:${group.subject}`}
                  variant="outline"
                  isLoading={createSession.isPending || createSession.isPaused}
                  onClick={() => startBookmarkPractice(group)}
                >
                  {t('practice.groupAction', {
                    level: group.level,
                    subject: commonT(`taxonomy.subjects.${group.subject}`),
                    formattedCount: formatCount(20)
                  })}
                </Button>
              ))}
            </div>
            {bookmarkGroups.length === 0 ? (
              <p
                className="mt-5 text-sm font-bold text-amber-800"
                role="status"
              >
                {t('practice.allArchived')}
              </p>
            ) : null}
            {createSession.isPaused ? (
              <p
                className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900"
                role="status"
              >
                {t('practice.offline')}
              </p>
            ) : null}
            {noEligibleQuestions ? (
              <div
                className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4"
                role="alert"
              >
                <p className="font-bold text-amber-900">
                  {t('practice.noneAvailable')}
                </p>
                <Button
                  className="mt-3"
                  variant="outline"
                  onClick={() => {
                    createSession.reset()
                    void bookmarksQuery.refetch()
                  }}
                >
                  {t('practice.refresh')}
                </Button>
              </div>
            ) : null}
            {hasCreateSessionError ? (
              <div
                className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4"
                role="alert"
              >
                <p className="font-bold text-red-800">
                  {t('practice.startError')}
                </p>
                <Button
                  className="mt-3"
                  variant="outline"
                  onClick={() => {
                    const input = createSession.variables
                    if (input?.mode !== 'BOOKMARK') {
                      createSession.reset()
                      return
                    }
                    startBookmarkPractice({
                      level: input.level,
                      subject: input.subject
                    })
                  }}
                >
                  {commonT('actions.retry')}
                </Button>
              </div>
            ) : null}
          </section>

          <div
            className="mt-8 grid gap-4 lg:grid-cols-2"
            aria-busy={bookmarksQuery.isFetching}
          >
            {bookmarksQuery.data.items.map((bookmark) => {
              const { question } = bookmark
              const isDeleting =
                bookmarkMutationActivity.pendingQuestionIds.has(
                  bookmark.questionId
                )
              return (
                <article
                  key={bookmark.questionId}
                  className="content-auto min-w-0 rounded-xl border border-line bg-white p-5"
                >
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="brand">{question.level}</Badge>
                    <Badge>
                      {commonT(`taxonomy.subjects.${question.subject}`)}
                    </Badge>
                    <Badge>
                      {commonT(
                        `taxonomy.questionTypes.${question.questionType}`
                      )}
                    </Badge>
                    <Badge
                      variant={
                        bookmark.availability === 'AVAILABLE'
                          ? 'success'
                          : 'warning'
                      }
                    >
                      {bookmark.availability === 'AVAILABLE'
                        ? t('availability.available')
                        : t('availability.archived')}
                    </Badge>
                  </div>
                  <h2
                    className="mt-5 line-clamp-3 break-words text-lg font-black leading-7"
                    lang="ja"
                  >
                    {question.questionTextPreview}
                  </h2>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {question.tags.map((tag) => (
                      <Badge key={tag.id}>{tag.label}</Badge>
                    ))}
                  </div>
                  {bookmark.availability === 'ARCHIVED' ? (
                    <p className="mt-4 text-sm font-bold text-amber-800">
                      {t('availability.archivedDescription')}
                    </p>
                  ) : null}
                  <div className="mt-6 border-t border-line pt-4">
                    <Button
                      ref={(element) => {
                        if (
                          element &&
                          pendingRemovalQuestionId === bookmark.questionId
                        ) {
                          removalTriggerRef.current = element
                        }
                      }}
                      variant="ghost"
                      disabled={hasPendingBookmarkMutation}
                      isLoading={isDeleting}
                      onClick={(event) => {
                        removalTriggerRef.current = event.currentTarget
                        setPendingRemovalQuestionId(bookmark.questionId)
                      }}
                    >
                      {t('remove')}
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>

          <p
            className="sr-only"
            role="status"
            aria-atomic="true"
            aria-live="polite"
          >
            {bookmarksQuery.isFetching
              ? t('pagination.refreshing')
              : t('pagination.status', {
                  page: formatCount(displayedPage),
                  pageCount: formatCount(pageCount)
                })}
          </p>
          <Pagination
            className="mt-8"
            currentPage={displayedPage}
            disabled={isBookmarkNavigationLocked}
            getPageHref={getPageHref}
            label={t('pagination.label')}
            totalPages={pageCount}
            onPageChange={setPage}
          />
        </>
      )}

      <Dialog
        fallbackFocusRef={headingRef}
        open={pendingRemovalQuestionId !== null}
        preventClose={deleteBookmark.isPending}
        returnFocusRef={removalTriggerRef}
        title={t('removeDialog.title')}
        description={t('removeDialog.description')}
        footer={
          <>
            <Button
              disabled={deleteBookmark.isPending}
              variant="outline"
              onClick={() => setPendingRemovalQuestionId(null)}
            >
              {t('removeDialog.cancel')}
            </Button>
            <Button
              isLoading={deleteBookmark.isPending}
              variant="danger"
              onClick={() => {
                if (pendingRemovalQuestionId) {
                  removeBookmark(pendingRemovalQuestionId)
                }
              }}
            >
              {t('removeDialog.confirm')}
            </Button>
          </>
        }
        onOpenChange={(open) => {
          if (!open && !deleteBookmark.isPending) {
            setPendingRemovalQuestionId(null)
          }
        }}
      />
    </section>
  )
}
