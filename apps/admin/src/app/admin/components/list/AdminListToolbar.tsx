import { Select } from '@nihongo/browser/common/components/Select'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { useId, useRef } from 'react'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { AdminPager } from '@app/admin/components/list/AdminPager'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

export type AdminListPaging = {
  /** Undefined while the count is still loading or failed. */
  readonly total: number | undefined
  readonly page: number
  readonly pageSize: number
  readonly pageSizes: readonly number[]
  readonly onPageChange: (page: number) => void
  readonly onPageSizeChange: (pageSize: number) => void
  /** Paging is off while a page loads or the list is unavailable. */
  readonly disabled?: boolean
}

type AdminListToolbarProps = {
  readonly position: 'top' | 'bottom'
  readonly paging: AdminListPaging
  /** Shared by both toolbars: paging from either moves focus to the top one. */
  readonly anchorRef: RefObject<HTMLDivElement | null>
  /** Replaces the count on the top toolbar, e.g. the batch selection bar. */
  readonly leading?: ReactNode
  /** Extra controls before the page size, e.g. the column picker. */
  readonly trailing?: ReactNode
}

export const adminListPageCount = (
  total: number | undefined,
  pageSize: number
): number => Math.max(1, Math.ceil((total ?? 0) / pageSize))

/** Count, page size and pager; the same bar sits above and below a list. */
export const AdminListToolbar = ({
  position,
  paging,
  anchorRef,
  leading,
  trailing
}: AdminListToolbarProps): ReactElement => {
  const { t } = useAdminPresentation()
  const { locale } = useUiLocale()
  const pageSizeName = useId()
  const pending = useRef(0)
  const { total, page, pageSize, pageSizes, disabled = false } = paging
  const pageCount = adminListPageCount(total, pageSize)
  const from = total ? (page - 1) * pageSize + 1 : 0
  const to = total ? Math.min(total, page * pageSize) : 0
  const isTop = position === 'top'

  const goToPage = (nextPage: number): void => {
    paging.onPageChange(nextPage)
    // Bring the top of the list back into view once the new page renders.
    window.cancelAnimationFrame(pending.current)
    pending.current = window.requestAnimationFrame(() => {
      const anchor = anchorRef.current
      anchor?.scrollIntoView({ block: 'start' })
      anchor?.focus({ preventScroll: true })
    })
  }

  const count =
    total === undefined ? (
      <p className="text-sm text-muted">{t('adminList.totalPending')}</p>
    ) : (
      <p className="whitespace-nowrap text-sm tabular-nums">
        <span className="font-bold">
          {t('adminList.total', { total: formatNumber(total, locale) })}
        </span>{' '}
        {total > 0 ? (
          <span className="text-muted">
            {t('adminList.range', {
              from: formatNumber(from, locale),
              to: formatNumber(to, locale)
            })}
          </span>
        ) : null}
      </p>
    )

  return (
    <div
      className={
        isTop
          ? 'flex flex-col gap-3 border-t border-line py-3 md:flex-row md:items-center md:justify-between'
          : 'mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between'
      }
    >
      <div
        ref={isTop ? anchorRef : undefined}
        tabIndex={isTop ? -1 : undefined}
        className="min-w-0 scroll-mt-4 rounded-sm"
        aria-live={isTop ? 'polite' : undefined}
      >
        {isTop && leading ? leading : count}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 md:justify-end">
        {trailing}
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="hidden text-sm text-muted md:inline"
          >
            {t('adminList.pageSize')}
          </span>
          <Select
            name={`pageSize-${pageSizeName}`}
            label={t('adminList.pageSize')}
            hideLabel
            className="w-auto"
            value={String(pageSize)}
            onChange={(event) =>
              paging.onPageSizeChange(Number(event.currentTarget.value))
            }
          >
            {pageSizes.map((size) => (
              <option key={size} value={size}>
                {t('adminList.pageSizeOption', {
                  count: formatNumber(size, locale)
                })}
              </option>
            ))}
          </Select>
        </div>
        <AdminPager
          label={t(isTop ? 'adminList.pagerTop' : 'adminList.pagerBottom')}
          page={page}
          pageCount={pageCount}
          disabled={disabled || total === undefined}
          onPageChange={goToPage}
        />
      </div>
    </div>
  )
}
