import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'

type BookmarkEmptyPageProps = {
  displayedPage: number
  isNavigationLocked: boolean
  previousPageHref: string
}

export const BookmarkEmptyPage = ({
  displayedPage,
  isNavigationLocked,
  previousPageHref
}: BookmarkEmptyPageProps): ReactElement => {
  const { t } = useTranslation('bookmark')
  const isFirstPage = displayedPage === 1
  // JLP-855: no manuscript paper; the first page keeps its message at the
  // start edge as before.
  return (
    <EmptyState
      className={isFirstPage ? 'bookmark-empty-first' : undefined}
      illustration={
        isFirstPage ? (
          <span className="maru-empty" aria-hidden="true" />
        ) : undefined
      }
      title={isFirstPage ? t('empty.firstTitle') : t('empty.pageTitle')}
      description={
        isFirstPage ? t('empty.firstDescription') : t('empty.pageDescription')
      }
      action={
        isFirstPage ? (
          <Link className={getButtonClassName({ size: 'lg' })} to="/practice">
            {t('empty.start')}
          </Link>
        ) : isNavigationLocked ? (
          <Button disabled>{t('empty.previousPage')}</Button>
        ) : (
          <Link className="bookmark-empty-back" to={previousPageHref}>
            {t('empty.previousPage')}
          </Link>
        )
      }
    />
  )
}
