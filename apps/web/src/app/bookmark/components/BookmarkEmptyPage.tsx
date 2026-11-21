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
      className={
        isFirstPage
          ? 'items-start! mx-0! px-0! text-start! [&>h2]:text-pretty [&:lang(ko)>h2]:break-keep'
          : undefined
      }
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
          <Link
            className="inline-flex min-h-11 items-center rounded-control border border-line bg-surface px-4 font-bold text-ink hover:border-line-strong hover:bg-surface-muted focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
            to={previousPageHref}
          >
            {t('empty.previousPage')}
          </Link>
        )
      }
    />
  )
}
