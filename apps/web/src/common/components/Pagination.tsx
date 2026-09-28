import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { classNames } from '@common/components/classNames'

type PaginationItem = number | 'start-ellipsis' | 'end-ellipsis'

type PaginationProps = {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  label?: string
  disabled?: boolean
  className?: string
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
  label,
  onPageChange,
  totalPages
}: PaginationProps): ReactElement | null => {
  const { t } = useTranslation('common')
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
  const pageButtonClassName =
    'inline-grid size-11 place-items-center rounded-control border border-line bg-surface text-sm font-semibold text-ink touch-manipulation hover:border-line-strong hover:bg-surface-muted focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <nav
      className={classNames('overflow-x-auto', className)}
      aria-label={label ?? t('pagination.label')}
    >
      <ul className="flex min-w-max items-center justify-center gap-1 py-1">
        <li>
          <button
            className={classNames(pageButtonClassName, 'w-auto px-3')}
            type="button"
            disabled={disabled || safeCurrentPage === 1}
            aria-label={t('pagination.previousLabel')}
            onClick={() => onPageChange(safeCurrentPage - 1)}
          >
            {t('pagination.previous')}
          </button>
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
              <button
                className={classNames(
                  pageButtonClassName,
                  isCurrent &&
                    'border-brand bg-brand text-on-accent hover:bg-brand-strong'
                )}
                type="button"
                disabled={disabled}
                aria-current={isCurrent ? 'page' : undefined}
                aria-label={t('pagination.pageLabel', {
                  page: item,
                  current: isCurrent ? t('pagination.currentSuffix') : ''
                })}
                onClick={() => onPageChange(item)}
              >
                <span className="tabular-nums">{item}</span>
              </button>
            </li>
          )
        })}
        <li>
          <button
            className={classNames(pageButtonClassName, 'w-auto px-3')}
            type="button"
            disabled={disabled || safeCurrentPage === normalizedTotalPages}
            aria-label={t('pagination.nextLabel')}
            onClick={() => onPageChange(safeCurrentPage + 1)}
          >
            {t('pagination.next')}
          </button>
        </li>
      </ul>
    </nav>
  )
}
