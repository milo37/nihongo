import { Icon } from '@nihongo/browser/common/components/Icon'
import { IconButton } from '@nihongo/browser/common/components/IconButton'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import type { ReactElement } from 'react'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

type AdminPagerProps = {
  readonly label: string
  readonly page: number
  readonly pageCount: number
  readonly disabled?: boolean
  readonly onPageChange: (page: number) => void
}

/** First, previous, `page / pageCount`, next and last page buttons. */
export const AdminPager = ({
  label,
  page,
  pageCount,
  disabled = false,
  onPageChange
}: AdminPagerProps): ReactElement => {
  const { t } = useAdminPresentation()
  const { locale } = useUiLocale()
  const atStart = disabled || page <= 1
  const atEnd = disabled || page >= pageCount
  return (
    <nav aria-label={label} className="flex items-center gap-1">
      <IconButton
        label={t('adminList.first')}
        icon={<Icon name="chevrons-left" />}
        disabled={atStart}
        onClick={() => onPageChange(1)}
      />
      <IconButton
        label={t('adminList.previous')}
        icon={<Icon name="chevron-left" />}
        disabled={atStart}
        onClick={() => onPageChange(page - 1)}
      />
      <span className="min-w-14 whitespace-nowrap px-1 text-center text-sm font-semibold tabular-nums">
        {t('adminList.pageStatus', {
          page: formatNumber(page, locale),
          pageCount: formatNumber(pageCount, locale)
        })}
      </span>
      <IconButton
        label={t('adminList.next')}
        icon={<Icon name="chevron-right" />}
        disabled={atEnd}
        onClick={() => onPageChange(page + 1)}
      />
      <IconButton
        label={t('adminList.last')}
        icon={<Icon name="chevrons-right" />}
        disabled={atEnd}
        onClick={() => onPageChange(pageCount)}
      />
    </nav>
  )
}
