import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { MouseEvent, ReactElement } from 'react'
import { classNames } from '@common/components/classNames'
import { formatNumber } from '@libs/localeFormatters'
import { resolveUiLocale } from '@/i18n/types'

type PaginationItem = number | 'start-ellipsis' | 'end-ellipsis'

type PaginationProps = {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  label?: string
  disabled?: boolean
  className?: string
  getPageHref?: (page: number) => string
}

const createPaginationItems = (
  currentPage: number,
  totalPages: number
): PaginationItem[] => {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  const items: PaginationItem[] = [1]
  const rangeStart = Math.max(2, currentPage - 1)
  const rangeEnd = Math.min(totalPages - 1, currentPage + 1)

  if (rangeStart > 2) {
    items.push('start-ellipsis')
  }

  for (let page = rangeStart; page <= rangeEnd; page += 1) {
    items.push(page)
  }

  if (rangeEnd < totalPages - 1) {
    items.push('end-ellipsis')
  }

  items.push(totalPages)
  return items
}

export const Pagination = ({
  className,
  currentPage,
  disabled = false,
  getPageHref,
  label,
  onPageChange,
  totalPages
}: PaginationProps): ReactElement | null => {
  const { i18n, t } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const formatPage = (page: number): string => formatNumber(page, locale)
  const normalizedTotalPages =
    Number.isFinite(totalPages) && totalPages > 0 ? Math.floor(totalPages) : 0

  if (normalizedTotalPages <= 1) {
    return null
  }

  const normalizedCurrentPage = Number.isFinite(currentPage)
    ? Math.floor(currentPage)
    : 1
  const safeCurrentPage = Math.min(
    Math.max(normalizedCurrentPage, 1),
    normalizedTotalPages
  )
  const items = createPaginationItems(safeCurrentPage, normalizedTotalPages)
  const pageButtonBaseClassName =
    'inline-grid size-11 place-items-center rounded-control border text-sm font-semibold touch-manipulation focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand aria-disabled:cursor-not-allowed aria-disabled:opacity-50 disabled:cursor-not-allowed disabled:opacity-50'
  const defaultPageClassName =
    'border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-muted'
  const currentPageClassName =
    'ui-pagination-current border-brand bg-brand text-on-accent hover:bg-brand-strong'

  const renderPageControl = (
    page: number,
    content: ReactElement,
    options: {
      readonly ariaLabel: string
      readonly className: string
      readonly isCurrent?: boolean
      readonly isDisabled?: boolean
    }
  ): ReactElement => {
    const isDisabled = disabled || Boolean(options.isDisabled)
    if (getPageHref) {
      return (
        <Link
          className={options.className}
          to={getPageHref(isDisabled ? safeCurrentPage : page)}
          aria-current={options.isCurrent ? 'page' : undefined}
          aria-disabled={isDisabled || undefined}
          aria-label={options.ariaLabel}
          tabIndex={isDisabled ? -1 : undefined}
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            if (isDisabled) {
              event.preventDefault()
              return
            }
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            ) {
              return
            }
            event.preventDefault()
            onPageChange(page)
          }}
        >
          {content}
        </Link>
      )
    }

    return (
      <button
        className={options.className}
        type="button"
        disabled={isDisabled}
        aria-current={options.isCurrent ? 'page' : undefined}
        aria-label={options.ariaLabel}
        onClick={() => onPageChange(page)}
      >
        {content}
      </button>
    )
  }

  return (
    <nav
      className={classNames('overflow-x-auto', className)}
      aria-label={label ?? t('pagination.label')}
    >
      <ul className="flex min-w-max items-center justify-center gap-1 py-1">
        <li>
          {renderPageControl(
            safeCurrentPage - 1,
            <span>{t('pagination.previous')}</span>,
            {
              ariaLabel: t('pagination.previousLabel'),
              className: classNames(
                pageButtonBaseClassName,
                defaultPageClassName,
                'w-auto px-3'
              ),
              isDisabled: safeCurrentPage === 1
            }
          )}
        </li>
        {items.map((item) => {
          if (typeof item !== 'number') {
            return (
              <li
                className="grid size-11 place-items-center text-muted"
                key={item}
                aria-hidden="true"
              >
                …
              </li>
            )
          }

          const isCurrent = item === safeCurrentPage

          return (
            <li key={item}>
              {renderPageControl(
                item,
                <span className="tabular-nums">{formatPage(item)}</span>,
                {
                  ariaLabel: t('pagination.pageLabel', {
                    page: formatPage(item),
                    current: isCurrent ? t('pagination.currentSuffix') : ''
                  }),
                  className: classNames(
                    pageButtonBaseClassName,
                    isCurrent ? currentPageClassName : defaultPageClassName
                  ),
                  isCurrent
                }
              )}
            </li>
          )
        })}
        <li>
          {renderPageControl(
            safeCurrentPage + 1,
            <span>{t('pagination.next')}</span>,
            {
              ariaLabel: t('pagination.nextLabel'),
              className: classNames(
                pageButtonBaseClassName,
                defaultPageClassName,
                'w-auto px-3'
              ),
              isDisabled: safeCurrentPage === normalizedTotalPages
            }
          )}
        </li>
      </ul>
    </nav>
  )
}
