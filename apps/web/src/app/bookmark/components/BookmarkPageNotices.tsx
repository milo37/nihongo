import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import type { RefObject } from 'react'

type BookmarkListNoticesProps = {
  isCachedOffline: boolean
  isStaleError: boolean
  mutationStatus: string | null
  onRetry: () => void
}

export const BookmarkListNotices = ({
  isCachedOffline,
  isStaleError,
  mutationStatus,
  onRetry
}: BookmarkListNoticesProps): ReactElement => {
  const { t } = useTranslation('bookmark')
  const { t: commonT } = useTranslation('common')
  return (
    <>
      {mutationStatus ? (
        <p
          className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
          role="status"
          aria-live="polite"
        >
          {mutationStatus}
        </p>
      ) : null}
      {isCachedOffline ? (
        <p
          className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
          role="status"
        >
          {t('error.cachedOffline')}
        </p>
      ) : null}
      {isStaleError ? (
        <div
          className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          <p className="font-semibold">{t('error.staleDescription')}</p>
          <Button className="mt-3" size="sm" onClick={onRetry}>
            {commonT('actions.retry')}
          </Button>
        </div>
      ) : null}
    </>
  )
}

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
          ? 'items-start! px-0! text-start! [&>h2]:text-pretty [&:lang(ko)>h2]:break-keep'
          : undefined
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

type BookmarkRemoveDialogProps = {
  fallbackFocusRef: RefObject<HTMLHeadingElement | null>
  isRemoving: boolean
  onCancel: () => void
  onConfirm: () => void
  open: boolean
  returnFocusRef: RefObject<HTMLButtonElement | null>
}

export const BookmarkRemoveDialog = ({
  fallbackFocusRef,
  isRemoving,
  onCancel,
  onConfirm,
  open,
  returnFocusRef
}: BookmarkRemoveDialogProps): ReactElement => {
  const { t } = useTranslation('bookmark')
  return (
    <Dialog
      fallbackFocusRef={fallbackFocusRef}
      open={open}
      preventClose={isRemoving}
      returnFocusRef={returnFocusRef}
      title={t('removeDialog.title')}
      description={t('removeDialog.description')}
      footer={
        <>
          <Button disabled={isRemoving} variant="outline" onClick={onCancel}>
            {t('removeDialog.cancel')}
          </Button>
          <Button isLoading={isRemoving} variant="danger" onClick={onConfirm}>
            {t('removeDialog.confirm')}
          </Button>
        </>
      }
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isRemoving) {
          onCancel()
        }
      }}
    />
  )
}
