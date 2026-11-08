import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { AdminListIcon } from '@app/admin/components/list/AdminListIcon'
import {
  ActiveFilterChip,
  FilterChip,
  type AdminListFilter
} from '@app/admin/components/list/FilterChip'
import { FilterSheet } from '@app/admin/components/list/FilterSheet'
import { useWideLayout } from '@app/admin/components/list/useWideLayout'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

type AdminListFiltersProps = {
  /** The list's own search form. */
  readonly search?: ReactNode
  readonly filters?: readonly AdminListFilter[]
  /** Sort select, shown at the end of the chip row. */
  readonly sort?: ReactNode
  readonly resultCount?: number
  /** Clears every filter but keeps the search text. */
  readonly onReset?: () => void
}

/** Search, filter chips (a bottom sheet on narrow screens) and sort. */
export const AdminListFilters = ({
  search,
  filters = [],
  sort,
  resultCount,
  onReset
}: AdminListFiltersProps): ReactElement => {
  const { t } = useAdminPresentation()
  const { locale } = useUiLocale()
  const [sheetOpen, setSheetOpen] = useState(false)
  const filterButton = useRef<HTMLButtonElement>(null)
  const active = filters.filter((filter) => filter.value !== undefined)
  const reset = onReset ?? (() => undefined)

  const wide = useWideLayout()
  const hasFilters = filters.length > 0

  return (
    // Without search, the header's own padding is the narrow-screen gap.
    <div className={search ? 'mt-8' : 'sm:mt-8'}>
      {search}
      {hasFilters || sort ? (
        <div
          className={`${search ? 'mt-4' : 'sm:mt-4'} flex flex-wrap items-center gap-2`}
        >
          {hasFilters && wide ? (
            <>
              {filters.map((filter) => (
                <FilterChip key={filter.key} filter={filter} />
              ))}
              {active.length > 0 ? (
                <button
                  type="button"
                  className="min-h-11 rounded-control px-3 text-sm font-semibold text-brand underline underline-offset-4 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                  onClick={reset}
                >
                  {t('adminList.filters.reset')}
                </button>
              ) : null}
            </>
          ) : null}
          {hasFilters && !wide ? (
            <button
              ref={filterButton}
              type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line-interactive bg-surface px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
              aria-haspopup="dialog"
              onClick={() => setSheetOpen(true)}
            >
              <AdminListIcon name="sliders-horizontal" className="size-4" />
              {active.length > 0
                ? t('adminList.filters.buttonCount', {
                    count: formatNumber(active.length, locale)
                  })
                : t('adminList.filters.button')}
            </button>
          ) : null}
          {sort ? (
            <div
              className={`flex min-w-0 items-center justify-end gap-2 ${wide ? 'ml-auto' : 'flex-1'}`}
            >
              {wide ? (
                <span aria-hidden="true" className="text-sm text-muted">
                  {t('adminList.filters.sort')}
                </span>
              ) : null}
              {sort}
            </div>
          ) : null}
          {!wide && active.length > 0 ? (
            <div className="flex basis-full flex-wrap gap-2">
              {active.map((filter) => (
                <ActiveFilterChip
                  key={filter.key}
                  filter={filter}
                  onRemove={() => {
                    // The chip disappears; keep focus on the filter button.
                    filterButton.current?.focus()
                    filter.onChange(undefined)
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {hasFilters && !wide ? (
        <FilterSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          filters={filters}
          resultCount={resultCount}
          onReset={reset}
        />
      ) : null}
    </div>
  )
}
