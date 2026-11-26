import type { ReactElement } from 'react'
import type { AdminRetentionRow } from '@nihongo/contracts/admin/retention'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

/** A returned count and its share of the people it is counted against. */
const ReturnCell = ({
  returned,
  base
}: {
  returned: number | null
  base: number | null
}): ReactElement => {
  const { locale } = useUiLocale()
  const { t } = useAdminPresentation()
  if (returned === null || base === null)
    return <span className="text-muted">{t('retention.pending')}</span>
  return (
    <>
      <span className="font-semibold">{formatNumber(returned, locale)}</span>
      <span className="ml-2 text-muted">
        {base === 0
          ? t('common.none')
          : formatNumber(returned / base, locale, {
              style: 'percent',
              maximumFractionDigits: 1
            })}
      </span>
    </>
  )
}

const RetentionRow = ({ row }: { row: AdminRetentionRow }): ReactElement => {
  const { locale } = useUiLocale()
  const { t } = useAdminPresentation()
  return (
    <tr>
      <th scope="row" className="px-3 py-3 font-semibold tabular-nums">
        <time dateTime={row.cohortDate}>{row.cohortDate}</time>
      </th>
      <td className="px-3 py-3">{t(`retention.audience.${row.audience}`)}</td>
      <td className="px-3 py-3 text-right tabular-nums">
        {formatNumber(row.cohortSize, locale)}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        <ReturnCell returned={row.day1Returned} base={row.cohortSize} />
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {row.weekCohortSize === null ? (
          <span className="text-muted">{t('retention.pending')}</span>
        ) : (
          formatNumber(row.weekCohortSize, locale)
        )}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        <ReturnCell returned={row.day7Returned} base={row.weekCohortSize} />
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        <ReturnCell returned={row.week1Returned} base={row.weekCohortSize} />
      </td>
    </tr>
  )
}

/** #1266 exact numbers per cohort day, folded under the charts (#1271). */
export const RetentionTable = ({
  rows
}: {
  rows: readonly AdminRetentionRow[]
}): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <details className="mt-8 text-sm">
      <summary className="w-fit cursor-pointer rounded-sm underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
        {t('retention.tableToggle')}
      </summary>
      <div
        role="region"
        aria-label={t('retention.tableLabel')}
        tabIndex={0}
        className="mt-4 overflow-x-auto rounded-card border border-line bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
          <caption className="sr-only">{t('retention.tableLabel')}</caption>
          <thead className="border-b border-line bg-surface-muted text-muted">
            <tr>
              <th scope="col" className="px-3 py-3 font-semibold">
                {t('retention.columns.cohortDate')}
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                {t('retention.columns.audience')}
              </th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">
                {t('retention.columns.cohortSize')}
              </th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">
                {t('retention.columns.day1')}
              </th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">
                {t('retention.columns.weekCohortSize')}
              </th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">
                {t('retention.columns.day7')}
              </th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">
                {t('retention.columns.week1')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <RetentionRow
                key={`${row.cohortDate}-${row.audience}`}
                row={row}
              />
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
