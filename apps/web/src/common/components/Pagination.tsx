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
  label = '페이지 이동',
  onPageChange,
  totalPages
}: PaginationProps): ReactElement | null => {
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
    'inline-grid size-11 place-items-center rounded-lg border border-line bg-white text-sm font-semibold text-ink touch-manipulation hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <nav
      className={classNames('overflow-x-auto', className)}
      aria-label={label}
    >
      <ul className="flex min-w-max items-center justify-center gap-1 py-1">
        <li>
          <button
            className={classNames(pageButtonClassName, 'w-auto px-3')}
            type="button"
            disabled={disabled || safeCurrentPage === 1}
            aria-label="이전 페이지"
            onClick={() => onPageChange(safeCurrentPage - 1)}
          >
            이전
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
                    'border-brand bg-brand text-white hover:bg-emerald-800'
                )}
                type="button"
                disabled={disabled}
                aria-current={isCurrent ? 'page' : undefined}
                aria-label={`${item}페이지${isCurrent ? ', 현재 페이지' : ''}`}
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
            aria-label="다음 페이지"
            onClick={() => onPageChange(safeCurrentPage + 1)}
          >
            다음
          </button>
        </li>
      </ul>
    </nav>
  )
}
