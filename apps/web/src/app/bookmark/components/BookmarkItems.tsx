import type { ReactElement, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Pagination } from '@nihongo/browser/common/components/Pagination'
import { BookmarkListItem } from '@app/bookmark/components/BookmarkListItem'
import { StudyList, StudyListHeader } from '@common/components/StudyList'
import type { useBookmarkPageController } from '@app/bookmark/hooks/useBookmarkPageController'
import type { resolveUiLocale } from '@nihongo/browser/i18n/types'

type BookmarkController = ReturnType<typeof useBookmarkPageController>

// The count lives in the list header line, not beside the title (ux2 §1-1).
export const BookmarkHeading = ({
  headingRef
}: {
  headingRef: RefObject<HTMLHeadingElement | null>
}): ReactElement => {
  const { t } = useTranslation('bookmark')
  return (
    <div>
      <h1
        ref={headingRef}
        className="bookmark-title bookmark-title-quiet"
        tabIndex={-1}
      >
        {t('title')}
      </h1>
      <p className="bookmark-description">{t('description')}</p>
    </div>
  )
}

type BookmarkItemsProps = {
  bookmarks: BookmarkController
  items: NonNullable<BookmarkController['bookmarksQuery']['data']>['items']
  total: number
  locale: ReturnType<typeof resolveUiLocale>
  formatCount: (value: number) => string
  removalTriggerRef: RefObject<HTMLButtonElement | null>
}

export const BookmarkItems = ({
  bookmarks,
  items,
  total,
  locale,
  formatCount,
  removalTriggerRef
}: BookmarkItemsProps): ReactElement => {
  const { t } = useTranslation('bookmark')
  const { bookmarksQuery, displayedPage, pendingRemovalQuestionId } = bookmarks
  return (
    <>
      <StudyList
        busy={bookmarksQuery.isFetching}
        header={
          <StudyListHeader
            count={t('listCount', { formattedCount: formatCount(total) })}
            aside={t('sortSaved')}
          />
        }
      >
        {items.map((bookmark) => (
          <BookmarkListItem
            key={bookmark.questionId}
            bookmark={bookmark}
            isDeleting={bookmarks.pendingQuestionIds.has(bookmark.questionId)}
            isRemoveDisabled={bookmarks.hasPendingBookmarkMutation}
            locale={locale}
            removeButtonRef={(element) => {
              if (element && pendingRemovalQuestionId === bookmark.questionId) {
                removalTriggerRef.current = element
              }
            }}
            onRemove={(event) => {
              removalTriggerRef.current = event.currentTarget
              bookmarks.requestRemoval(bookmark.questionId)
            }}
          />
        ))}
      </StudyList>

      {/* One page needs no pagination (ux2 §1-4). */}
      {bookmarks.pageCount > 1 ? (
        <>
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
            className="bookmark-pagination"
            currentPage={displayedPage}
            requestedPage={bookmarks.page}
            disabled={bookmarks.isBookmarkNavigationLocked}
            getPageHref={bookmarks.getPageHref}
            label={t('pagination.label')}
            totalPages={bookmarks.pageCount}
            onPageChange={bookmarks.setPage}
          />
        </>
      ) : null}
    </>
  )
}
