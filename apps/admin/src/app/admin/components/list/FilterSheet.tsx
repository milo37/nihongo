import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { useId } from 'react'
import type { ReactElement } from 'react'
import type { AdminListFilter } from '@app/admin/components/list/FilterChip'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

type FilterSheetProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly filters: readonly AdminListFilter[]
  readonly resultCount: number | undefined
  readonly onReset: () => void
}

/** Narrow-screen bottom sheet: each pill applies at once, the footer closes. */
export const FilterSheet = ({
  open,
  onOpenChange,
  filters,
  resultCount,
  onReset
}: FilterSheetProps): ReactElement => {
  const { t } = useAdminPresentation()
  const { locale } = useUiLocale()
  const groupName = useId()
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('adminList.filters.button')}
      className="mb-0 mt-auto max-h-[calc(100dvh-3rem)] w-full max-w-none rounded-b-none"
      footer={
        <div className="flex gap-3">
          <Button variant="outline" onClick={onReset}>
            {t('adminList.filters.reset')}
          </Button>
          <Button className="flex-1" onClick={() => onOpenChange(false)}>
            {resultCount === undefined
              ? t('adminList.filters.sheetDonePending')
              : t('adminList.filters.sheetDone', {
                  count: formatNumber(resultCount, locale)
                })}
          </Button>
        </div>
      }
    >
      <div className="grid gap-6">
        {filters.map((filter) => (
          <fieldset key={filter.key}>
            <legend className="text-sm font-semibold">{filter.label}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {[
                { value: '', label: t('adminList.filters.all') },
                ...filter.options
              ].map((option) => (
                <label
                  key={option.value}
                  className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line-interactive bg-surface px-4 text-sm font-semibold has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand-strong has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand"
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name={`${groupName}-${filter.key}`}
                    value={option.value}
                    checked={option.value === (filter.value ?? '')}
                    onChange={() => filter.onChange(option.value || undefined)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </Dialog>
  )
}
