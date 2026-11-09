import { useRef } from 'react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { Pagination } from '@nihongo/browser/common/components/Pagination'
import { BookmarkListItem } from '@app/bookmark/components/BookmarkListItem'
import { StudyList, StudyListHeader } from '@common/components/StudyList'
import {
  BookmarkEmptyPage,
  BookmarkListNotices,
  BookmarkRemoveDialog
} from '@app/bookmark/components/BookmarkPageNotices'
import { BookmarkPracticePanel } from '@app/bookmark/components/BookmarkPracticePanel'
import { useBookmarkPageController } from '@app/bookmark/hooks/useBookmarkPageController'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { AppErrorReportButton } from '@app/question-report/components/AppErrorReportDialog'

type BookmarkController = ReturnType<typeof useBookmarkPageController>

// The count lives in the list header line, not beside the title (ux2 §1-1).
const BookmarkHeading = ({
  headingRef
}: {
  headingRef: RefObject<HTMLHeadingElement | null>
}): ReactElement => {
  const { t } = useTranslation('bookmark')
  return (
    <div>
      <h1
        ref={headingRef}
        className="bookmark-title rounded-sm focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
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

const BookmarkItems = ({
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
            className="mt-6"
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
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void bookmarksQuery.refetch()}>
              {commonT('actions.retry')}
            </Button>
            <AppErrorReportButton />
          </div>
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
        <BookmarkHeading headingRef={headingRef} />
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
        <BookmarkItems
          bookmarks={bookmarks}
          items={items}
          total={total}
          locale={locale}
          formatCount={formatCount}
          removalTriggerRef={removalTriggerRef}
        />
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
