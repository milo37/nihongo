import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import type {
  JlptLevel,
  QuestionSubject
} from '@nihongo/browser/common/types/domain'
import { Icon } from '@nihongo/browser/common/components/Icon'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { Pagination } from '@nihongo/browser/common/components/Pagination'
import { useBookmarkMutationActivity } from '@app/bookmark/hooks/useBookmarkMutationActivity'
import { useDeleteBookmark } from '@app/bookmark/hooks/useDeleteBookmark'
import { useListBookmarks } from '@app/bookmark/hooks/useListBookmarks'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { isAuthTransitionSupersededError } from '@nihongo/browser/libs/authTransitionFence'
import {
  formatDateTime,
  formatNumber
} from '@nihongo/browser/libs/localeFormatters'
import { useAppStore } from '@nihongo/browser/store/index'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
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
    <section className="bookmark-page">
      <div className="bookmark-heading">
        <div>
          <div className="bookmark-title-line">
            <h1
              ref={headingRef}
              className="bookmark-title rounded-sm focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
              tabIndex={-1}
            >
              {t('title')}
            </h1>
            <output
              className="bookmark-count"
              aria-label={t('count', {
                formattedCount: formatCount(bookmarksQuery.data.total)
              })}
            >
              {formatCount(bookmarksQuery.data.total)}
            </output>
          </div>
          <p className="bookmark-description">{t('description')}</p>
        </div>
        {bookmarksQuery.data.items.length > 0 ? (
          <details className="bookmark-practice">
            <summary className={getButtonClassName()}>
              <Icon name="rotate-ccw" />
              {t('practice.title')}
            </summary>
            <div className="bookmark-practice-options">
              <p className="mt-2 text-sm leading-6 text-muted">
                {t('practice.description')}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {bookmarkGroups.map((group) => (
                  <Button
                    key={`${group.level}:${group.subject}`}
                    variant="outline"
                    isLoading={
                      createSession.isPending || createSession.isPaused
                    }
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
            </div>
          </details>
        ) : null}
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
          <div className="bookmark-items" aria-busy={bookmarksQuery.isFetching}>
            {bookmarksQuery.data.items.map((bookmark) => {
              const { question } = bookmark
              const questionTypeLabel = commonT(
                `taxonomy.questionTypes.${question.questionType}`
              )
              const isDeleting =
                bookmarkMutationActivity.pendingQuestionIds.has(
                  bookmark.questionId
                )
              return (
                <article
                  key={bookmark.questionId}
                  className="bookmark-item content-auto"
                >
                  <div className="bookmark-content">
                    <p className="bookmark-meta">
                      <strong>
                        {question.level} ·{' '}
                        {commonT(`taxonomy.subjects.${question.subject}`)}
                      </strong>
                      <span>{questionTypeLabel}</span>
                      {question.tags
                        .filter((tag) => tag.label !== questionTypeLabel)
                        .map((tag) => (
                          <span key={tag.id}>{tag.label}</span>
                        ))}
                      {bookmark.availability === 'ARCHIVED' ? (
                        <span className="bookmark-archive">
                          {t('availability.archived')}
                        </span>
                      ) : null}
                    </p>
                    <details className="bookmark-preview">
                      <summary aria-label={t('preview.expand')}>
                        <span lang="ja">{question.questionTextPreview}</span>
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </summary>
                      <p className="bookmark-preview-note">
                        {t('preview.description')}
                      </p>
                    </details>
                    {bookmark.availability === 'ARCHIVED' ? (
                      <p className="bookmark-archive-description">
                        {t('availability.archivedDescription')}
                      </p>
                    ) : null}
                  </div>
                  <time
                    className="bookmark-added"
                    dateTime={bookmark.createdAt}
                  >
                    {formatDateTime(bookmark.createdAt, locale, {
                      month: 'numeric',
                      day: 'numeric'
                    })}
                  </time>
                  <Button
                    id={`bookmark-remove-${bookmark.questionId}`}
                    ref={(element) => {
                      if (
                        element &&
                        pendingRemovalQuestionId === bookmark.questionId
                      ) {
                        removalTriggerRef.current = element
                      }
                    }}
                    className="bookmark-remove"
                    size="sm"
                    variant="ghost"
                    aria-label={t('remove')}
                    title={t('remove')}
                    disabled={hasPendingBookmarkMutation}
                    aria-busy={isDeleting || undefined}
                    onClick={(event) => {
                      removalTriggerRef.current = event.currentTarget
                      setPendingRemovalQuestionId(bookmark.questionId)
                    }}
                  >
                    <Icon name="bookmark" />
                  </Button>
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
            requestedPage={page}
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
