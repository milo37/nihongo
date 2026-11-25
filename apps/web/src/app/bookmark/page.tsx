import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import {
  BookmarkHeading,
  BookmarkItems
} from '@app/bookmark/components/BookmarkItems'
import { BookmarkEmptyPage } from '@app/bookmark/components/BookmarkEmptyPage'
import {
  BookmarkListNotices,
  BookmarkLoadError
} from '@app/bookmark/components/BookmarkPageNotices'
import { BookmarkRemoveDialog } from '@app/bookmark/components/BookmarkRemoveDialog'
import { BookmarkPracticePanel } from '@app/bookmark/components/BookmarkPracticePanel'
import { useBookmarkPageController } from '@app/bookmark/hooks/useBookmarkPageController'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'

export const BookmarkPage = (): ReactElement => {
  const { i18n, t } = useTranslation('bookmark')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const formatCount = (value: number): string => formatNumber(value, locale)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const removalTriggerRef = useRef<HTMLButtonElement>(null)
  const bookmarks = useBookmarkPageController()
  const { bookmarksQuery, displayedPage, pendingRemovalQuestionId } = bookmarks

  if (bookmarksQuery.isPending && !bookmarks.isBookmarksPaused) {
    return <LoadingState message={t('loading')} />
  }

  if (!bookmarksQuery.data) {
    return (
      <BookmarkLoadError
        isOffline={bookmarks.isBookmarksPaused}
        onRetry={() => void bookmarksQuery.refetch()}
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
