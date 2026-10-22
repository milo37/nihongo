import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { MouseEvent, ReactElement } from 'react'
import { classNames } from '@common/components/classNames'
import { Icon } from '@common/components/Icon'
import type { IconName } from '@common/components/Icon'
import { formatNumber } from '@libs/localeFormatters'
import { resolveUiLocale } from '@/i18n/types'

type PaginationProps = {
  currentPage: number
  totalPages: number
  requestedPage?: number
  onPageChange: (page: number) => void
  label?: string
  disabled?: boolean
  className?: string
  getPageHref?: (page: number) => string
}

const mobileQuery = '(max-width: 760px)'
const narrowMobileQuery = '(max-width: 383px)'
const subscribeToViewport = (onChange: () => void): (() => void) => {
  if (typeof window.matchMedia !== 'function') return () => undefined
  const queries = [mobileQuery, narrowMobileQuery].map((query) =>
    window.matchMedia(query)
  )
  queries.forEach((query) => query.addEventListener('change', onChange))
  return () =>
    queries.forEach((query) => query.removeEventListener('change', onChange))
}
const readPageLimit = (): number => {
  if (typeof window.matchMedia !== 'function') return 5
  if (window.matchMedia(narrowMobileQuery).matches) return 2
  return window.matchMedia(mobileQuery).matches ? 3 : 5
}

export const Pagination = ({
  className,
  currentPage,
  disabled = false,
  getPageHref,
  label,
  onPageChange,
  requestedPage,
  totalPages
}: PaginationProps): ReactElement | null => {
  const { i18n, t } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const pageLimit = useSyncExternalStore(
    subscribeToViewport,
    readPageLimit,
    () => 5
  )
  const navRef = useRef<HTMLElement>(null)
  const pendingPage = useRef<number | null>(null)
  const normalizedTotal =
    Number.isFinite(totalPages) && totalPages > 0 ? Math.floor(totalPages) : 0
  const safePage = Math.min(
    Math.max(Number.isFinite(currentPage) ? Math.floor(currentPage) : 1, 1),
    Math.max(1, normalizedTotal)
  )

  useEffect(() => {
    if (requestedPage !== undefined && pendingPage.current !== requestedPage) {
      pendingPage.current = null
    }
    if (pendingPage.current !== safePage || disabled) return
    pendingPage.current = null
    const current = navRef.current?.querySelector<HTMLElement>(
      '[aria-current="page"]'
    )
    current?.focus({ preventScroll: true })
    const rect = current?.getBoundingClientRect()
    if (
      rect &&
      (rect.top < 3 ||
        rect.bottom > window.innerHeight - 3 ||
        rect.left < 3 ||
        rect.right > window.innerWidth - 3)
    ) {
      current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    }
  }, [disabled, requestedPage, safePage])

  if (normalizedTotal === 0) return null
  const count = Math.min(pageLimit, normalizedTotal)
  const start = Math.max(
    1,
    Math.min(
      safePage - Math.floor((count - 1) / 2),
      normalizedTotal - count + 1
    )
  )
  const pages = Array.from({ length: count }, (_, index) => start + index)
  const changePage = (page: number): void => {
    if (disabled || page === safePage) return
    pendingPage.current = page
    onPageChange(page)
  }
  const renderControl = (
    page: number,
    content: ReactElement,
    ariaLabel: string,
    unavailable = false,
    current = false
  ): ReactElement => {
    const locked = disabled || unavailable
    const controlClass = classNames(
      'pagination-control',
      current && 'ui-pagination-current'
    )
    if (getPageHref) {
      return (
        <Link
          className={controlClass}
          to={getPageHref(locked ? safePage : page)}
          aria-label={ariaLabel}
          aria-current={current ? 'page' : undefined}
          aria-disabled={locked || undefined}
          tabIndex={locked ? -1 : undefined}
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            if (locked) {
              event.preventDefault()
              return
            }
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return
            event.preventDefault()
            changePage(page)
          }}
        >
          {content}
        </Link>
      )
    }
    return (
      <button
        className={controlClass}
        type="button"
        disabled={locked}
        aria-label={ariaLabel}
        aria-current={current ? 'page' : undefined}
        onClick={() => changePage(page)}
      >
        {content}
      </button>
    )
  }
  const moveControl = (
    page: number,
    icon: IconName,
    key: string,
    unavailable: boolean
  ): ReactElement =>
    renderControl(
      page,
      <Icon name={icon} />,
      t(`pagination.${key}`),
      unavailable
    )
  const previous = (
    <div className="pagination-previous" key="previous">
      {moveControl(1, 'chevrons-left', 'firstLabel', safePage === 1)}
      {moveControl(
        safePage - 1,
        'chevron-left',
        'previousLabel',
        safePage === 1
      )}
    </div>
  )
  const numbers = (
    <ol className="pagination-numbers" key="numbers">
      {pages.map((page) => (
        <li key={page}>
          {renderControl(
            page,
            <span className="tabular-nums">{formatNumber(page, locale)}</span>,
            t('pagination.pageLabel', {
              page: formatNumber(page, locale),
              current: page === safePage ? t('pagination.currentSuffix') : ''
            }),
            false,
            page === safePage
          )}
        </li>
      ))}
    </ol>
  )
  const following = (
    <div className="pagination-following" key="following">
      {moveControl(
        safePage + 1,
        'chevron-right',
        'nextLabel',
        safePage === normalizedTotal
      )}
      {moveControl(
        normalizedTotal,
        'chevrons-right',
        'lastLabel',
        safePage === normalizedTotal
      )}
    </div>
  )
  return (
    <nav
      ref={navRef}
      className={classNames('number-pagination', className)}
      aria-label={label ?? t('pagination.label')}
    >
      <div
        className="pagination-controls"
        data-mobile={pageLimit < 5 || undefined}
      >
        {[previous, numbers, following]}
      </div>
    </nav>
  )
}
