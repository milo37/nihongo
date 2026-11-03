import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { Pagination } from '@nihongo/browser/common/components/Pagination'
import { BookmarkListItem } from '@app/bookmark/components/BookmarkListItem'
import {
  BookmarkEmptyPage,
  BookmarkListNotices,
  BookmarkRemoveDialog
} from '@app/bookmark/components/BookmarkPageNotices'
import { BookmarkPracticePanel } from '@app/bookmark/components/BookmarkPracticePanel'
import { useBookmarkPageController } from '@app/bookmark/hooks/useBookmarkPageController'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'

export const BookmarkPage = (): ReactElement => {
  const { i18n, t } = useTranslation('bookmark')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const formatCount = (value: number): string => formatNumber(value, locale)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const removalTriggerRef = useRef<HTMLButtonElement>(null)
  const bookmarks = useBookmarkPageController()
  const { bookmarksQuery, displayedPage, pendingRemovalQuestionId } = bookmarks

  if (bookmarksQuery.isPending && !bookmarks.isBookmarksPaused) {
    return <LoadingState message={t('loading')} />
  }

  if (!bookmarksQuery.data && bookmarks.isBookmarksPaused) {
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

  const { items, total } = bookmarksQuery.data
  const mutationStatus = bookmarks.isMutationPaused
    ? t('status.offline')
    : bookmarks.statusMessage
      ? t(`status.${bookmarks.statusMessage}`)
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
              aria-label={t('count', { formattedCount: formatCount(total) })}
            >
              {formatCount(total)}
            </output>
          </div>
          <p className="bookmark-description">{t('description')}</p>
        </div>
        {items.length > 0 ? (
          <BookmarkPracticePanel
            formatCount={formatCount}
            groups={bookmarks.bookmarkGroups}
            accountRestricted={bookmarks.accountRestricted}
            hasStartError={bookmarks.hasCreateSessionError}
            isOffline={bookmarks.isPracticeSessionPaused}
            isStarting={bookmarks.isPracticeStarting}
            noEligibleQuestions={bookmarks.noEligibleQuestions}
            onRefresh={bookmarks.refreshAfterNoEligible}
            onRetry={bookmarks.retryBookmarkPractice}
            onStart={bookmarks.startBookmarkPractice}
            pendingGroup={bookmarks.pendingPracticeGroup}
          />
        ) : null}
      </div>

      <BookmarkListNotices
        isCachedOffline={bookmarks.isBookmarksPaused}
        isStaleError={bookmarksQuery.isError}
        mutationStatus={
          bookmarks.isRemovalPromptPending ? null : mutationStatus
        }
        onRetry={() => void bookmarksQuery.refetch()}
      />

      {items.length === 0 ? (
        <BookmarkEmptyPage
          displayedPage={displayedPage}
          isNavigationLocked={bookmarks.isBookmarkNavigationLocked}
          previousPageHref={bookmarks.getPageHref(displayedPage - 1)}
        />
      ) : (
        <>
          <div className="bookmark-items" aria-busy={bookmarksQuery.isFetching}>
            {items.map((bookmark) => (
              <BookmarkListItem
                key={bookmark.questionId}
                bookmark={bookmark}
                isDeleting={bookmarks.pendingQuestionIds.has(
                  bookmark.questionId
                )}
                isRemoveDisabled={bookmarks.hasPendingBookmarkMutation}
                locale={locale}
                removeButtonRef={(element) => {
                  if (
                    element &&
                    pendingRemovalQuestionId === bookmark.questionId
                  ) {
                    removalTriggerRef.current = element
                  }
                }}
                onRemove={(event) => {
                  removalTriggerRef.current = event.currentTarget
                  bookmarks.requestRemoval(bookmark.questionId)
                }}
              />
            ))}
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
                  pageCount: formatCount(bookmarks.pageCount)
                })}
          </p>
          <Pagination
            className="mt-8"
            currentPage={displayedPage}
            requestedPage={bookmarks.page}
            disabled={bookmarks.isBookmarkNavigationLocked}
            getPageHref={bookmarks.getPageHref}
            label={t('pagination.label')}
            totalPages={bookmarks.pageCount}
            onPageChange={bookmarks.setPage}
          />
        </>
      )}

      <BookmarkRemoveDialog
        fallbackFocusRef={headingRef}
        isRemoving={bookmarks.isRemoving}
        open={pendingRemovalQuestionId !== null}
        returnFocusRef={removalTriggerRef}
        onCancel={() => bookmarks.requestRemoval(null)}
        onConfirm={bookmarks.confirmRemoval}
      />
    </section>
  )
}
